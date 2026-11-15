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
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
while ($true) {
  $out = @{ playing = $false }
  try {
    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    foreach ($s in $mgr.GetSessions()) {
      if ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') {
        $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $out = @{ playing = $true; title = [string]$p.Title; artist = [string]$p.Artist; app = [string]$s.SourceAppUserModelId }
        break
      }
    }
  } catch {}
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  Start-Sleep -Seconds 15
}`;

/* Web browsers report whatever tab is playing (including private videos), so they are never shown. */
const BROWSERS = /chrome|msedge|edge|firefox|brave|opera|vivaldi|arc|iexplore/i;
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = function createActivity(onChange) {
  let cfg = { game: false, music: false, custom: [] };
  let gameTimer = null, helper = null, last = { game: null, music: null }, dead = false;
  const state = { game: null, music: null };

  function emit() {
    const next = { game: cfg.game ? state.game : null, music: cfg.music ? state.music : null };
    if (next.game !== last.game || next.music !== last.music) { last = next; try { onChange(next); } catch (e) { /* page gone */ } }
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
    let buf = '';
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/^\uFEFF/, '').trim(); buf = buf.slice(i + 1);
        try {
          const r = JSON.parse(line);
          if (r && r.playing && r.title && !BROWSERS.test(r.app || '')) {
            const t = clean(r.title, 70), a = clean(r.artist, 50);
            state.music = a ? t + ' – ' + a : t;
          } else state.music = null;
        } catch (e) { /* not a result line */ }
        emit();
      }
    });
    helper.on('exit', () => { helper = null; state.music = null; emit(); });
  }
  function stopHelper() { if (helper) { try { helper.kill(); } catch (e) { /* already gone */ } helper = null; } state.music = null; }

  function configure(next) {
    cfg = { game: !!(next && next.game), music: !!(next && next.music), custom: (next && next.custom) || [] };
    if (cfg.game && !gameTimer) { scanGames(); gameTimer = setInterval(scanGames, 30000); }
    if (!cfg.game) { if (gameTimer) { clearInterval(gameTimer); gameTimer = null; } state.game = null; }
    if (cfg.music) startHelper(); else stopHelper();
    if (cfg.game && gameTimer) scanGames();
    emit();
  }
  function stop() { dead = true; if (gameTimer) clearInterval(gameTimer); stopHelper(); }
  return { configure, stop, current: () => last };
};
