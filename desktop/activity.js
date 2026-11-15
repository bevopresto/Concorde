/* What the person is playing and listening to, read on their own computer. Windows only, and only when they turn it on.
   Nothing here is sent anywhere by itself: it only tells the app page, which shares the game name or the song title. */
const { execFile, spawn } = require('child_process');
const BUILT_IN = require('./games');

/* Reads "now playing" from Windows (the same thing the volume pop-up shows), every 15 seconds, in one long-lived helper. */
const MUSIC_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); if (-not $t.Wait(4000)) { return $null }; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
while ($true) {
  $out = @{ items = @(); seen = @(); err = '' }
  try {
    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    if ($mgr -eq $null) { throw 'Windows did not answer in time' }
    $list = @(); $seen = @()
    foreach ($s in $mgr.GetSessions()) {
      $st = $s.GetPlaybackInfo().PlaybackStatus.ToString()
      $seen += @{ app = [string]$s.SourceAppUserModelId; status = $st }
      if ($st -eq 'Playing') {
        $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if ($p -ne $null) { $list += @{ title = [string]$p.Title; artist = [string]$p.Artist; app = [string]$s.SourceAppUserModelId } }
      }
    }
    $out = @{ items = $list; seen = $seen; err = '' }
  } catch { $out = @{ items = @(); seen = @(); err = [string]$_.Exception.Message } }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  Start-Sleep -Seconds 15
}`;

/* Web browsers report whatever tab is playing (including private videos), so they are never shown. */
const BROWSERS = /chrome|msedge|edge|firefox|brave|opera|vivaldi|arc|iexplore/i;
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/* Of everything Windows says is playing, choose what to show: skip browsers and empty titles, and keep the same song while it is still playing. */
function pickMusic(r, prev) {
  const items = r && r.items ? [].concat(r.items) : (r && r.playing ? [r] : []);
  const texts = [];
  items.forEach((it) => {
    if (!it || !it.title || BROWSERS.test(it.app || '')) return;
    const t = clean(it.title, 70), a = clean(it.artist, 50);
    if (t) texts.push(a ? t + ' – ' + a : t);
  });
  if (!texts.length) return null;
  return texts.indexOf(prev) >= 0 ? prev : texts[0];
}

module.exports = function createActivity(onChange) {
  let cfg = { game: false, music: false, custom: [] };
  let watchdog = null, lastLineAt = 0, gameTimer = null, helper = null, last = { game: null, music: null }, dead = false;
  const state = { game: null, music: null };
  let diag = { music: 'not started', at: 0, seen: [], err: '' };

  /* Tell the page. It is told on every check, not just on changes, so a page that was reloaded or hidden catches up by itself. */
  function emit(force) {
    const next = { game: cfg.game ? state.game : null, music: cfg.music ? state.music : null };
    last = next;
    { try { onChange({ game: next.game, music: next.music, diag: diag }); } catch (e) { /* page gone */ } }
  }

  function customMap() {
    const m = {};
    (Array.isArray(cfg.custom) ? cfg.custom : []).slice(0, 40).forEach((c) => {
      const exe = clean(c && c.exe, 80).toLowerCase(), name = clean(c && c.name, 60);
      if (exe && name) m[exe.endsWith('.exe') ? exe : exe + '.exe'] = name;
    });
    return m;
  }

  function scanGames() {
    if (process.platform !== 'win32') return;
    execFile('tasklist.exe', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err || dead || !cfg.game) return;
      const known = Object.assign({}, BUILT_IN, customMap());
      const found = [];
      String(out).split(/\r?\n/).forEach((line) => {
        const m = /^"([^"]+)"/.exec(line); if (!m) return;
        const name = known[m[1].toLowerCase()]; if (name && found.indexOf(name) < 0) found.push(name);
      });
      /* If two games are open, keep showing the one already shown. */
      state.game = found.length ? (found.indexOf(state.game) >= 0 ? state.game : found[0]) : null;
      emit();
    });
  }

  function startHelper() {
    if (helper || process.platform !== 'win32') return;
    const enc = Buffer.from(MUSIC_SCRIPT, 'utf16le').toString('base64');
    helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = ''; lastLineAt = Date.now();
    if (!watchdog) watchdog = setInterval(() => { if (helper && cfg.music && Date.now() - lastLineAt > 45000) { try { helper.kill(); } catch (e) { /* gone */ } } }, 15000);
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        lastLineAt = Date.now();
        const line = buf.slice(0, i).replace(/^\uFEFF/, '').trim(); buf = buf.slice(i + 1);
        try {
          const r = JSON.parse(line);
          state.music = pickMusic(r, state.music);
          diag = { music: 'running', at: Date.now(), seen: (r.seen || []).slice(0, 8).map((x) => ({ app: clean(x.app, 60), status: clean(x.status, 12), hidden: BROWSERS.test(x.app || '') })), err: clean(r.err, 120) };
        } catch (e) { /* not a result line */ }
        emit();
      }
    });
    helper.on('error', (e) => { diag = { music: 'could not start: ' + clean(e && e.message, 80), at: Date.now(), seen: [], err: '' }; });
    helper.on('exit', (code) => {
      helper = null; state.music = null; diag = { music: 'stopped (code ' + code + '), restarting', at: Date.now(), seen: [], err: '' }; emit();
      if (cfg.music && !dead) setTimeout(() => { if (cfg.music && !dead) startHelper(); }, 5000);
    });
  }
  function stopHelper() { if (helper) { const h = helper; helper = null; try { h.kill(); } catch (e) { /* already gone */ } } state.music = null; diag = { music: 'off', at: 0, seen: [], err: '' }; }

  function configure(next) {
    cfg = { game: !!(next && next.game), music: !!(next && next.music), custom: (next && next.custom) || [] };
    if (cfg.game && !gameTimer) { scanGames(); gameTimer = setInterval(scanGames, 30000); }
    if (!cfg.game) { if (gameTimer) { clearInterval(gameTimer); gameTimer = null; } state.game = null; }
    if (cfg.music) startHelper(); else stopHelper();
    if (cfg.game && gameTimer) scanGames();
    emit();
  }
  function stop() { dead = true; if (watchdog) clearInterval(watchdog); if (gameTimer) clearInterval(gameTimer); stopHelper(); }
  return { configure, stop, push: () => emit(true), current: () => ({ game: last.game, music: last.music, diag: diag }) };
};
module.exports.pickMusic = pickMusic;
