/* The only door between the app page and the computer. Nothing here reads files or runs programs. */
const { contextBridge, ipcRenderer } = require('electron');
const listeners = {};
function on(ch, fn) { (listeners[ch] = listeners[ch] || []).push(fn); }
['desktop:maximized', 'desktop:update', 'desktop:cmd', 'desktop:pick-source'].forEach((ch) => {
  ipcRenderer.on(ch, (_e, data) => (listeners[ch] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }));
});
contextBridge.exposeInMainWorld('concordeDesktop', {
  isDesktop: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send('desktop:min'),
  toggleMaximize: () => ipcRenderer.send('desktop:max'),
  close: () => ipcRenderer.send('desktop:close'),
  quit: () => ipcRenderer.send('desktop:quit'),
  isMaximized: () => ipcRenderer.invoke('desktop:is-max'),
  onMaximized: (fn) => on('desktop:maximized', fn),
  setState: (s) => ipcRenderer.send('desktop:state', s),
  notify: (n) => ipcRenderer.send('desktop:notify', n),
  onCommand: (fn) => on('desktop:cmd', fn),
  getUpdate: () => ipcRenderer.invoke('desktop:get-update'),
  installUpdate: () => ipcRenderer.send('desktop:install-update'),
  checkUpdate: () => ipcRenderer.invoke('desktop:check-update'),
  onUpdate: (fn) => on('desktop:update', fn),
  onPickSource: (fn) => on('desktop:pick-source', fn),
  pickedSource: (id) => ipcRenderer.send('desktop:picked-source', id || null),
  version: () => ipcRenderer.invoke('desktop:version')
});
