/* Concorde for Windows: the window, the tray icon, alerts, screen-share sources and updates. */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, protocol, net, session, desktopCapturer, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, 'app');
const ASSETS = path.join(__dirname, 'assets');
const ORIGIN = 'app://concorde';
const SMOKE = process.env.CONCORDE_SMOKE === '1';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.concorde.app');

let win = null, tray = null, quitting = false;
let st = { status: 'online', muted: false, unread: 0, mention: false };
let update = { available: false, version: null, installing: false };
let pendingPick = null;

const img = (n) => nativeImage.createFromPath(path.join(ASSETS, n));

/* ---------- remembers the window size ---------- */
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); } catch (e) { return {}; } }
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(boundsFile(), JSON.stringify({ bounds: win.getNormalBounds(), max: win.isMaximized() })); } catch (e) { /* not important */ }
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  const saved = loadBounds(), b = saved.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 820, x: b.x, y: b.y, minWidth: 940, minHeight: 600,
    frame: false, show: false, backgroundColor: '#f4f1fb', title: 'Concorde', icon: path.join(ASSETS, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  if (saved.max) win.maximize();
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.loadURL(ORIGIN + '/index.html');
  win.on('maximize', () => win.webContents.send('desktop:maximized', true));
  win.on('unmaximize', () => win.webContents.send('desktop:maximized', false));
  win.on('resize', saveBounds); win.on('move', saveBounds);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  // Links to websites open in the normal browser, never inside Concorde.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
}

/* ---------- tray ---------- */
function trayImage() { return img(update.available ? 'tray-update.png' : st.mention ? 'tray-mention.png' : st.unread ? 'tray-unread.png' : 'tray.png'); }
function sendCmd(c) { showWindow(); if (win) win.webContents.send('desktop:cmd', c); }
function buildTrayMenu() {
  const STAT = [['online', 'Online'], ['away', 'Away'], ['dnd', 'Do not disturb'], ['invisible', 'Appear offline']];
  const items = [
    { label: 'Open Concorde', click: showWindow }, { type: 'separator' },
    ...STAT.map(([v, l]) => ({ label: l, type: 'radio', checked: st.status === v, click: () => win && win.webContents.send('desktop:cmd', { type: 'status', value: v }) })),
    { type: 'separator' },
    { label: 'Mute notifications', type: 'checkbox', checked: st.muted, click: () => win && win.webContents.send('desktop:cmd', { type: 'mute' }) },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked, args: ['--hidden'] }) },
    { type: 'separator' }
  ];
  if (update.available) items.push({ label: 'Restart to update to v' + update.version, click: installNow }, { type: 'separator' });
  items.push({ label: 'Quit Concorde', click: () => { quitting = true; app.quit(); } });
  return Menu.buildFromTemplate(items);
}
function refreshTray() {
  if (!tray) return;
  tray.setImage(trayImage());
  const bits = ['Concorde']; if (st.mention) bits.push('you were mentioned'); else if (st.unread) bits.push(st.unread + ' unread'); if (update.available) bits.push('update ready');
  tray.setToolTip(bits.join(' · '));
  tray.setContextMenu(buildTrayMenu());
  if (win && process.platform === 'win32') {
    const o = update.available && !st.mention && !st.unread ? 'badge-update.png' : st.mention ? 'badge-mention.png' : st.unread ? 'badge-unread.png' : null;
    win.setOverlayIcon(o ? img(o) : null, o ? (st.mention ? 'Mentioned' : st.unread ? 'Unread messages' : 'Update ready') : '');
  }
}
function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', showWindow);
  refreshTray();
}

/* ---------- updates (installed app only; it checks the GitHub release page) ---------- */
let autoUpdater = null;
function setupUpdates() {
  if (!app.isPackaged) return;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { return; }
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => { update = { available: true, version: info.version, installing: false }; pushUpdate(); refreshTray(); });
  autoUpdater.on('error', () => { /* offline or no release yet: try again later */ });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 12000); setInterval(check, 4 * 60 * 60 * 1000);
}
function pushUpdate() { if (win && !win.isDestroyed()) win.webContents.send('desktop:update', update); }
function installNow() {
  if (!autoUpdater || !update.available) return;
  update.installing = true; pushUpdate(); quitting = true;
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 900);
}

/* ---------- messages from the app page ---------- */
ipcMain.on('desktop:min', () => win && win.minimize());
ipcMain.on('desktop:max', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('desktop:close', () => win && win.hide());
ipcMain.on('desktop:quit', () => { quitting = true; app.quit(); });
ipcMain.handle('desktop:is-max', () => !!(win && win.isMaximized()));
ipcMain.handle('desktop:version', () => app.getVersion());
ipcMain.handle('desktop:get-update', () => update);
ipcMain.handle('desktop:check-update', async () => { if (!autoUpdater) return update; try { await autoUpdater.checkForUpdates(); } catch (e) { /* ignore */ } return update; });
ipcMain.on('desktop:install-update', installNow);
ipcMain.on('desktop:state', (_e, s) => {
  const next = { status: String(s.status || 'online'), muted: !!s.muted, unread: Math.max(0, s.unread | 0), mention: !!s.mention };
  if (JSON.stringify(next) === JSON.stringify(st)) return;
  st = next; refreshTray();
});
ipcMain.on('desktop:notify', (_e, n) => {
  if (!Notification.isSupported() || !n) return;
  const note = new Notification({ title: String(n.title || 'Concorde').slice(0, 80), body: String(n.body || '').slice(0, 200), icon: path.join(ASSETS, 'icon.png'), silent: true });
  note.on('click', () => sendCmd({ type: 'open', conversationId: n.conversationId || null }));
  note.show();
  if (win && !win.isFocused() && process.platform === 'win32') win.flashFrame(true);
});
ipcMain.on('desktop:picked-source', (_e, id) => {
  if (!pendingPick) return;
  const cb = pendingPick.cb, sources = pendingPick.sources; pendingPick = null;
  const s = id && sources.find((x) => x.id === id);
  if (!s) return cb(null);
  cb({ video: s, audio: 'loopback' });
});

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* stays in the tray */ });

app.whenReady().then(() => {
  // app://concorde/… serves the files in the app folder, and nothing outside it.
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname); if (rel === '/' || rel === '') rel = '/index.html';
    const full = path.normalize(path.join(APP_DIR, rel));
    if (!full.startsWith(APP_DIR)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });

  const ses = session.defaultSession;
  const ok = new Set(['media', 'audioCapture', 'videoCapture', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);
  const mine = (wc, url) => (url || '').startsWith(ORIGIN);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ok.has(perm) && mine(wc, details.requestingUrl)));
  ses.setPermissionCheckHandler((wc, perm, origin) => ok.has(perm) && (origin || '').startsWith(ORIGIN));

  // YouTube refuses to play embedded videos when the page has no web address of its own, so tell it where we are from.
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.googlevideo.com/*', '*://*.ytimg.com/*'] }, (details, cb) => {
    details.requestHeaders['Referer'] = 'https://concorde.app/';
    cb({ requestHeaders: details.requestHeaders });
  });

  // Sharing the screen: ask the app page to show its picker, then hand back the chosen window or screen.
  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
      if (!list.length) return cb(null);
      if (pendingPick) pendingPick.cb(null);
      pendingPick = { cb, sources: list };
      const payload = list.map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith('screen:'), thumb: s.thumbnail.toDataURL() }));
      if (!win) return cb(null);
      win.webContents.send('desktop:pick-source', payload);
    } catch (e) { cb(null); }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'View', submenu: [
    { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }
  ] }]));
  createWindow(); createTray(); setupUpdates();
  if (SMOKE) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const r = await win.webContents.executeJavaScript('JSON.stringify({desktop:!!window.concordeDesktop,backend:window.Concorde&&Concorde.config.backend,proto:location.protocol,framed:document.body.classList.contains("framed"),dsk:document.body.classList.contains("desktop")})');
      console.log('SMOKE ' + r); quitting = true; app.quit();
    }, 2500));
  }
});
