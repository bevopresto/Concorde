/* Concorde desktop glue. Only runs inside the installed Windows app (window.concordeDesktop comes from desktop/preload.js).
   Wires the title bar buttons, the tray icon and taskbar badge, desktop alerts, the screen-share picker and updates.
   In a normal browser this file does nothing. Loads last, after extras.js. */
(function () {
  var D = window.concordeDesktop; if (!D) return;
  var C = window.Concorde, S = C.services, U = C.ui, A = C.actions, st = U.state;
  var emit = C.live && C.live.emit;
  document.body.classList.add('desktop', 'framed');
  try { U.store.set('frame', 'on'); } catch (e) { /* ignore */ }
  function $(s, c) { return (c || document).querySelector(s); }

  /* ---------- Title bar buttons ---------- */
  A['win-min'] = function () { D.minimize(); };
  A['win-max'] = function () { D.toggleMaximize(); };
  A['win-close'] = function () { D.close(); };
  A['tray-quit'] = function () { D.quit(); };
  A['toggle-frame'] = function (t) { t.setAttribute('aria-checked', 'true'); U.toast('The title bar is part of the Concorde window.'); };
  function paintMax(on) {
    var b = $('[data-action="win-max"]'); if (!b) return;
    b.setAttribute('aria-label', on ? 'Restore' : 'Maximise'); b.title = on ? 'Restore' : 'Maximise';
    b.innerHTML = U.ico(on ? 'copy' : 'square', 'sm');
  }
  D.onMaximized(paintMax); D.isMaximized().then(paintMax);
  var tb = $('#titlebar'); if (tb) tb.addEventListener('dblclick', function (e) { if (!e.target.closest('button')) D.toggleMaximize(); });

  /* ---------- Updates ---------- */
  var upd = { available: false, version: null, installing: false };
  S.getUpdate = function () { return JSON.parse(JSON.stringify(upd)); };
  S.installUpdate = function () { D.installUpdate(); return Promise.resolve(null); };
  function setUpd(u) { upd = { available: !!u.available, version: u.version || null, installing: !!u.installing }; if (emit) emit('update', S.getUpdate()); }
  D.onUpdate(setUpd); D.getUpdate().then(setUpd);
  A['update-now'] = function () { S.installUpdate(); };

  /* ---------- Tray icon, taskbar badge, tray menu commands ---------- */
  var last = '';
  function pushState() {
    S.listConversations().then(function (list) {
      list = list || []; var unread = 0, mention = false;
      list.forEach(function (c) { if (c.muted && !c.mention) return; unread += (c.unread || 0); if (c.mention) mention = true; });
      var me = S.getCurrentUser() || {}, s = { status: me.status || 'online', muted: !st.sounds && !st.alerts, unread: unread, mention: mention };
      var sig = JSON.stringify(s); if (sig === last) return; last = sig; D.setState(s);
    }).catch(function () {});
  }
  S.on('conversations', pushState); S.on('update', pushState); setInterval(pushState, 2000); setTimeout(pushState, 1500);
  D.onCommand(function (c) {
    if (c.type === 'status') S.setStatus(c.value).then(function () { U.renderMe(); U.renderDetails(); pushState(); });
    else if (c.type === 'mute') { A['tray-mute'](); pushState(); }
    else if (c.type === 'open' && c.conversationId) U.openConversation(c.conversationId);
  });

  /* ---------- Desktop alerts (only when Concorde is not the window you are looking at) ---------- */
  function plain(t) { return String(t || '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140); }
  function away() { return document.hidden || !document.hasFocus(); }
  function quiet() { var me = S.getCurrentUser() || {}; return me.status === 'dnd'; }
  S.on('message', function (e) {
    if (!e || !e.incoming || !e.message || !away() || !st.alerts || quiet()) return;
    var m = e.message, mention = S.mentionsYou(m.text), c = st.conversations.filter(function (x) { return x.id === e.conversationId; })[0];
    if (c && c.muted && !mention) return;
    var who = U.person(m.from) || { name: 'Someone' }, where = c ? U.entity(c).name : '';
    var body = m.type === 'image' ? 'Sent a photo' : m.type === 'gif' ? 'Sent a GIF' : m.type === 'file' ? 'Sent a file' : plain(m.text);
    D.notify({ title: mention ? who.name + ' mentioned you' : (c && c.type === 'group' ? who.name + ' in ' + where : who.name), body: body, conversationId: e.conversationId });
  });
  var ringSeen = null;
  S.on('ring', function (r) {
    if (!r || r.direction === 'out' || r.status === 'declined' || r.status === 'dnd') { ringSeen = null; return; }
    if (ringSeen === (r.id || r.personId) || !away()) return; ringSeen = r.id || r.personId;
    var who = U.person(r.personId) || { name: 'Someone' };
    D.notify({ title: who.name + ' is calling', body: r.kind === 'video' ? 'Video call' : 'Voice call', conversationId: r.conversationId || null });
  });

  /* ---------- Screen-share picker (real windows and screens) ---------- */
  var pick = null;
  function closePick(id) { if (!pick) return; pick.remove(); pick = null; document.removeEventListener('keydown', onKey, true); D.pickedSource(id); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePick(null); } }
  D.onPickSource(function (list) {
    if (pick) pick.remove();
    var esc = U.esc, screens = list.filter(function (s) { return s.screen; }), wins = list.filter(function (s) { return !s.screen; });
    function tiles(arr) {
      return arr.map(function (s) {
        return '<button class="dk-tile" data-src="' + esc(s.id) + '"><img alt="" src="' + s.thumb + '"><span>' + esc(s.name) + '</span></button>';
      }).join('');
    }
    pick = document.createElement('div'); pick.className = 'dk-pick'; pick.setAttribute('role', 'dialog'); pick.setAttribute('aria-modal', 'true'); pick.setAttribute('aria-label', 'Choose what to share');
    pick.innerHTML = '<div class="dk-card"><div class="dk-head"><b>Share your screen</b><button class="btn-round sm" data-close aria-label="Cancel">' + U.ico('x', 'sm') + '</button></div>' +
      '<div class="dk-body">' + (screens.length ? '<h4>Screens</h4><div class="dk-grid">' + tiles(screens) + '</div>' : '') +
      (wins.length ? '<h4>Windows</h4><div class="dk-grid">' + tiles(wins) + '</div>' : '') + '</div></div>';
    pick.addEventListener('click', function (e) {
      var t = e.target.closest('[data-src]'); if (t) return closePick(t.getAttribute('data-src'));
      if (e.target.closest('[data-close]') || e.target === pick) closePick(null);
    });
    document.body.appendChild(pick); document.addEventListener('keydown', onKey, true);
    var f = pick.querySelector('.dk-tile'); if (f) f.focus();
  });
})();
