/* Concorde extras: right-click menus, status, Pin and Mute, leaving groups, message edit/delete,
   camera and screen-share controls, and Tell the Tower. Uses the helpers app.js hands over in Concorde.ui. */
(function () {
  var C = window.Concorde, S = C.services, U = C.ui, A = C.actions;
  var st = U.state, esc = U.esc, ico = U.ico, avatar = U.avatar, person = U.person, overlay = U.overlay, toast = U.toast;
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function convById(id) { return st.conversations.filter(function (c) { return c.id === id; })[0]; }
  function msgById(id) { return st.messages.filter(function (m) { return m.id === id; })[0]; }

  /* ---------- Context menu ---------- */
  var menu = null;
  function closeMenu(refocus) {
    if (!menu) return;
    var m = menu; menu = null; m.el.remove();
    if (refocus && m.opener && document.body.contains(m.opener)) m.opener.focus();
  }
  function openMenu(x, y, items, opener) {
    closeMenu();
    var el = document.createElement('div');
    el.className = 'ctx-menu'; el.setAttribute('role', 'menu');
    el.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<hr role="separator">';
      return '<button role="menuitem" tabindex="-1" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + (it.danger ? ' class="danger"' : '') + '>' + ico(it.icon, 'sm') + '<span>' + esc(it.label) + '</span>' + (it.checked ? ico('check', 'sm') : '') + '</button>';
    }).join('');
    overlay.appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(10, Math.min(window.innerWidth - w - 10, x)) + 'px';
    el.style.top = Math.max(10, Math.min(window.innerHeight - h - 10, y)) + 'px';
    menu = { el: el, items: items, opener: opener || document.activeElement };
    var first = el.querySelector('button:not([disabled])'); if (first) first.focus();
  }
  document.addEventListener('mousedown', function (ev) { if (menu && !ev.target.closest('.ctx-menu')) closeMenu(); }, true);
  window.addEventListener('blur', function () { closeMenu(); });
  window.addEventListener('resize', function () { closeMenu(); });
  document.addEventListener('wheel', function (ev) { if (menu && !ev.target.closest('.ctx-menu')) closeMenu(); }, { passive: true });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.ctx-menu button');
    if (!b || !menu) return;
    ev.stopPropagation();
    var it = menu.items[+b.dataset.i], opener = menu.opener; closeMenu(false);
    if (it && it.run) it.run(opener);
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (!menu) return;
    var btns = [].slice.call(menu.el.querySelectorAll('button:not([disabled])')), at = btns.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); btns[(at + 1) % btns.length].focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); btns[(at - 1 + btns.length) % btns.length].focus(); }
    else if (ev.key === 'Home') { ev.preventDefault(); btns[0].focus(); }
    else if (ev.key === 'End') { ev.preventDefault(); btns[btns.length - 1].focus(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeMenu(true); }
    else if (ev.key === 'Tab') { ev.preventDefault(); closeMenu(true); }
  }, true);

  /* ---------- Small confirm dialog ---------- */
  var dlg = null;
  function closeConfirm() { if (dlg) { dlg.remove(); dlg = null; } }
  function confirmBox(o) {
    closeConfirm();
    dlg = document.createElement('div'); dlg.className = 'scrim2'; dlg.dataset.action = 'confirm-scrim';
    dlg.innerHTML = '<div class="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-t"><div><h2 id="cf-t">' + esc(o.title) + '</h2><p class="crop-hint">' + esc(o.body) + '</p></div>' +
      '<div class="modal-foot"><button class="btn-pill quiet" data-action="confirm-no">Cancel</button><button class="btn-pill danger-fill" data-action="confirm-yes">' + esc(o.yes) + '</button></div></div>';
    overlay.appendChild(dlg); dlg._yes = o.onYes;
    dlg.querySelector('[data-action="confirm-no"]').focus();
  }
  A['confirm-scrim'] = function (t, ev) { if (ev.target === t) closeConfirm(); };
  A['confirm-no'] = function () { closeConfirm(); };
  A['confirm-yes'] = function () { var f = dlg && dlg._yes; closeConfirm(); if (f) f(); };

  /* ---------- Pin, mute, leave ---------- */
  function togglePin(id) { var c = convById(id); S.setPinned(id, !c.pinned).then(function () { toast(c.pinned ? 'Pinned to the top' : 'Unpinned'); }); }
  function toggleMuteChat(id) { var c = convById(id); S.setChatMuted(id, !c.muted).then(function () { toast(c.muted ? 'Muted. Only @mentions will get through.' : 'Unmuted'); }); }
  function askLeave(id) {
    var c = convById(id); if (!c || c.type !== 'group') return;
    confirmBox({ title: 'Leave ' + c.name + '?', body: 'Everyone will see that you left. Someone will need to add you back if you change your mind.', yes: 'Leave group', onYes: function () {
      var wasHere = st.convId === id;
      S.leaveGroup(id).then(function () {
        U.chime('leave'); toast('You left ' + c.name);
        if (wasHere) { var next = st.conversations[0]; if (next) U.openConversation(next.id); }
        U.renderList();
      });
    } });
  }
  function askDeleteGroup(id) {
    var c = convById(id); if (!c || c.type !== 'group' || !S.isOwner()) return;
    confirmBox({ title: 'Delete ' + c.name + ' for everyone?', body: 'The group and all of its messages, photos and files will be gone for every member. This can’t be undone.', yes: 'Delete group', onYes: function () {
      var wasHere = st.convId === id;
      S.deleteGroup(id).then(function (ok) {
        if (!ok) { toast('Couldn’t delete the group. Try again.'); return; }
        toast(c.name + ' was deleted');
        if (wasHere) { var next = st.conversations[0]; if (next) U.openConversation(next.id); }
        U.renderList();
      });
    } });
  }
  function askHide(id) {
    var c = convById(id); if (!c || c.type !== 'direct') return;
    var name = person(c.with).name;
    confirmBox({ title: 'Remove this chat?', body: 'It disappears from your list. ' + name + ' keeps theirs, and the chat comes back if either of you writes again.', yes: 'Remove chat', onYes: function () {
      var wasHere = st.convId === id;
      S.hideChat(id).then(function (ok) {
        if (!ok) return toast('Couldn’t remove that chat. Try again.');
        toast('Chat removed from your list');
        if (wasHere) { var next = st.conversations[0]; if (next) U.openConversation(next.id); }
        U.renderList();
      });
    } });
  }
  function askRemoveFromGroup(convId, personId) {
    var c = convById(convId), p = person(personId); if (!c || !p) return;
    confirmBox({ title: 'Remove ' + p.name + ' from ' + c.name + '?', body: 'Everyone in the group will see a note that they were removed. They keep their account and other chats.', yes: 'Remove from group', onYes: function () {
      S.removeFromGroup(convId, personId).then(function (ok) { toast(ok ? p.name + ' was removed from the group' : 'Couldn’t remove them. Try again.'); if (ok) { U.renderList(); U.renderDetails(); } });
    } });
  }
  function askRemovePerson(personId) {
    var p = person(personId); if (!p || personId === 'you') return;
    confirmBox({ title: 'Remove ' + p.name + ' from Concorde?', body: 'This deletes their account, their one-to-one chats and every message they sent. It can’t be undone. They could rejoin later with a new invite.', yes: 'Remove ' + p.name, onYes: function () {
      S.removePerson(personId).then(function (ok) {
        if (!ok) return toast('Couldn’t remove them. Try again.');
        toast(p.name + ' was removed from Concorde');
        if (!convById(st.convId)) { var next = st.conversations[0]; if (next) U.openConversation(next.id); }
        U.renderList(); U.renderDetails();
      });
    } });
  }
  A['toggle-pin'] = function () { togglePin(st.convId); };
  A['toggle-mute-chat'] = function () { toggleMuteChat(st.convId); };
  A['leave-group'] = function (t) { askLeave(t.dataset.id); };
  A['delete-group'] = function (t) { askDeleteGroup(t.dataset.id); };

  /* ---------- Right-click menus ---------- */
  function convMenu(c) {
    var items = [];
    if (c.type === 'direct') {
      var busy = !!S.getRing() || !!(S.getCall(c.id) && S.getCall(c.id).joined);
      items.push({ icon: 'hand', label: 'Poke ' + person(c.with).name, run: function () { sendPoke(c.with); } });
      items.push({ icon: 'phone', label: 'Start a call', disabled: busy, run: function () { U.openConversation(c.id).then(function () { S.startDirectCall(c.id, 'audio'); }); } });
    }
    items.push({ icon: c.pinned ? 'pin-off' : 'pin', label: c.pinned ? 'Unpin' : 'Pin to top', run: function () { togglePin(c.id); } });
    items.push({ icon: c.muted ? 'bell' : 'bell-off', label: c.muted ? 'Unmute' : 'Mute', run: function () { toggleMuteChat(c.id); } });
    if (c.type === 'group') {
      items.push({ sep: true });
      items.push({ icon: 'pencil', label: 'Edit group', run: function () { U.openEdit(c.id); } });
      items.push({ icon: 'log-out', label: 'Leave group', danger: true, run: function () { askLeave(c.id); } });
      if (S.isOwner()) items.push({ icon: 'trash-2', label: 'Delete group for everyone…', danger: true, run: function () { askDeleteGroup(c.id); } });
    } else {
      items.push({ sep: true });
      items.push({ icon: 'eye-off', label: 'Remove chat', run: function () { askHide(c.id); } });
      if (S.isOwner()) items.push({ icon: 'user-x', label: 'Remove ' + person(c.with).name + ' from Concorde…', danger: true, run: function () { askRemovePerson(c.with); } });
    }
    return items;
  }
  function copyText(text, msg) {
    try { navigator.clipboard.writeText(text).then(function () { toast(msg); }, function () { toast(msg); }); } catch (e) { toast(msg); }
  }
  function messageMenu(m) {
    var items = [
      { icon: 'reply', label: 'Reply', run: function () { A._reply(m.id); } },
      { icon: 'smile', label: 'React', run: function () { var r = $('.msg[data-id="' + m.id + '"] .bubble'); U.renderReactPopover({ getBoundingClientRect: function () { return r ? r.getBoundingClientRect() : { top: 200, left: 300 }; } }, m.id); } }
    ];
    if (m.type === 'text' && m.text) items.push({ icon: 'copy', label: 'Copy text', run: function () { copyText(m.text, 'Text copied'); } });
    if (m.type === 'link') items.push({ icon: 'link-2', label: 'Copy link', run: function () { copyText('https://' + m.link.domain, 'Link copied'); } });
    if (m.type === 'image' || m.type === 'file') items.push({ icon: 'download', label: 'Save', run: function () { saveMessage(m); } });
    if (m.from === 'you') {
      items.push({ sep: true });
      if (m.type === 'text') items.push({ icon: 'pencil', label: 'Edit', run: function () { startEdit(m.id); } });
      items.push({ icon: 'trash-2', label: 'Delete', danger: true, run: function () { S.deleteMessage(st.convId, m.id).then(function () { toast('Message deleted'); }); } });
    }
    return items;
  }
  A._reply = function (id) { st.replyTo = id; var rs = $('#reply-slot'); if (rs) { var m = msgById(id); rs.innerHTML = '<div class="reply-strip"><div><b>Replying to ' + (m.from === 'you' ? 'yourself' : esc(person(m.from).name)) + '</b><span>' + esc(U.snippet(m)) + '</span></div><button class="btn-round sm" data-action="cancel-reply" aria-label="Cancel reply">' + ico('x', 'sm') + '</button></div>'; } var ci = $('#composer-input'); if (ci) ci.focus(); };
  function ownerPersonItems(id) {
    var out = [{ sep: true }], cc = U.currentConv();
    if (cc && cc.type === 'group' && cc.members.indexOf(id) !== -1) out.push({ icon: 'log-out', label: 'Remove from ' + cc.name, danger: true, run: function () { askRemoveFromGroup(cc.id, id); } });
    out.push({ icon: 'user-x', label: 'Remove ' + person(id).name + ' from Concorde…', danger: true, run: function () { askRemovePerson(id); } });
    return out;
  }
  var lastCtx = { x: 200, y: 200 };
  function inCallWith(id) {
    return st.conversations.some(function (c) { var k = S.getCall(c.id); return k && k.joined && k.participants.indexOf(id) !== -1; });
  }
  /* A small slider for one person's volume, for the friend who is louder than the rest. Only turns them down, only for you. */
  var pvol = null;
  function closeVol() { if (pvol) { pvol.remove(); pvol = null; document.removeEventListener('mousedown', onVolAway, true); document.removeEventListener('keydown', onVolKey, true); } }
  function onVolAway(e) { if (pvol && !pvol.contains(e.target)) closeVol(); }
  function onVolKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeVol(); } }
  function openVol(id, x, y) {
    closeVol(); var p = person(id), v = S.getPersonVolume ? S.getPersonVolume(id) : 100;
    pvol = document.createElement('div'); pvol.className = 'pvol'; pvol.setAttribute('role', 'dialog'); pvol.setAttribute('aria-label', 'Volume for ' + p.name);
    pvol.innerHTML = '<div class="pvol-head">' + avatar(p, 30) + '<b>' + esc(p.name) + '</b><button class="btn-round sm" data-pvol-x aria-label="Close">' + ico('x', 'sm') + '</button></div>' +
      '<label class="pvol-row"><span>' + ico('volume-2', 'sm') + '</span><input class="rng" type="range" min="0" max="100" value="' + v + '" aria-label="Volume for ' + esc(p.name) + '"><output>' + v + '%</output></label>' +
      '<button class="btn-pill quiet pvol-reset" data-pvol-reset>Reset to 100%</button><p class="pvol-note">Only you hear this change. It is remembered for next time.</p>';
    document.body.appendChild(pvol);
    var w = pvol.offsetWidth, h = pvol.offsetHeight;
    pvol.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px'; pvol.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
    var rng = pvol.querySelector('input'), out = pvol.querySelector('output');
    rng.addEventListener('input', function () { out.textContent = rng.value + '%'; S.setPersonVolume(id, +rng.value); });
    pvol.addEventListener('click', function (e) {
      if (e.target.closest('[data-pvol-x]')) closeVol();
      else if (e.target.closest('[data-pvol-reset]')) { rng.value = 100; out.textContent = '100%'; S.setPersonVolume(id, 100); }
    });
    setTimeout(function () { document.addEventListener('mousedown', onVolAway, true); document.addEventListener('keydown', onVolKey, true); }, 0);
    rng.focus();
  }
  function personMenu(id) {
    if (id === 'you') return null;
    var c = st.conversations.filter(function (x) { return x.type === 'direct' && x.with === id; })[0];
    function open(after) { S.createConversation([id]).then(function (r) { return U.openConversation(r.id).then(function () { if (after) after(r.id); }); }); }
    var vol = (S.setPersonVolume && inCallWith(id)) ? [{ icon: 'volume-2', label: 'Adjust volume', run: function () { openVol(id, lastCtx.x, lastCtx.y); } }, { sep: true }] : [];
    return vol.concat([
      { icon: 'message-circle', label: 'Send message', run: function () { open(function () { var i = $('#composer-input'); if (i) i.focus(); }); } },
      { icon: 'phone', label: 'Voice call', run: function () { open(function (cid) { S.startDirectCall(cid, 'audio'); }); } },
      { icon: 'video', label: 'Video call', run: function () { open(function (cid) { S.startDirectCall(cid, 'video'); }); } },
      { icon: 'hand', label: 'Poke', run: function () { sendPoke(id); } },
      { icon: 'at-sign', label: 'Mention', run: function () {
        var cc = U.currentConv(), ok = cc.type === 'direct' ? cc.with === id : cc.members.indexOf(id) !== -1;
        function put() { var i = $('#composer-input'); if (!i) return; i.value += (i.value && !/\s$/.test(i.value) ? ' ' : '') + '@' + person(id).name + ' '; i.focus(); }
        if (ok) put(); else { toast('They are not in this chat.'); }
      } }
    ]).concat(S.isOwner() ? ownerPersonItems(id) : []);
  }
  document.addEventListener('contextmenu', function (ev) {
    var t = ev.target; if (!t.closest || t.closest('input, textarea')) return;
    var pt = t.closest('.avatar'); var pp = pt && pt.closest('[data-person]');
    var x = ev.clientX, y = ev.clientY, items = null; lastCtx = { x: x, y: y };
    if (!x && !y) { var r = t.getBoundingClientRect(); x = r.left + 20; y = r.top + 20; }
    if (pp && pp.dataset.person) items = personMenu(pp.dataset.person);
    else if (t.closest('.member[data-person]')) items = personMenu(t.closest('.member').dataset.person);
    else if (t.closest('.pt[data-person]')) items = personMenu(t.closest('.pt').dataset.person);
    else if (t.closest('#call-slot [data-person]')) items = personMenu(t.closest('#call-slot [data-person]').dataset.person);
    else if (t.closest('.conv[data-id]')) items = convMenu(convById(t.closest('.conv').dataset.id));
    else if (t.closest('.msg[data-id]') && !t.closest('.msg').classList.contains('typing-row')) {
      var m = msgById(t.closest('.msg').dataset.id); if (m && !m.deleted) items = messageMenu(m);
    }
    if (!items) return;
    ev.preventDefault(); openMenu(x, y, items, t.closest('.conv, .msg, .member, .pt') || t);
  });
  A['msg-more'] = function (t) {
    var m = msgById(t.dataset.id); if (!m) return; var r = t.getBoundingClientRect();
    openMenu(r.left, r.bottom + 6, messageMenu(m), t);
  };

  /* ---------- Edit your own message ---------- */
  function startEdit(id) { st.editing = id; U.renderMessages({ scroll: false, initial: true }); }
  function stopEdit() { st.editing = null; U.renderMessages({ scroll: false, initial: true, noFocus: true }); }
  function saveEditMsg() {
    var i = $('#edit-input'); if (!i || !st.editing) return;
    var id = st.editing, text = i.value.trim();
    if (!text) { toast('A message cannot be empty. Delete it instead?'); return; }
    st.editing = null; S.editMessage(st.convId, id, text);
  }
  A['edit-msg-save'] = saveEditMsg;
  A['edit-msg-cancel'] = stopEdit;
  document.addEventListener('keydown', function (ev) {
    if (ev.target.id !== 'edit-input') return;
    if (ev.key === 'Enter') { ev.preventDefault(); saveEditMsg(); }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); stopEdit(); }
  }, true);

  /* ---------- Your status ---------- */
  var STATUSES = [['online', 'Online', 'Friends see you around'], ['away', 'Away', 'Shown when you step out'], ['dnd', 'Do not disturb', 'No sounds, banners or ringing'], ['invisible', 'Appear offline', 'Friends see you as offline. Everything still works for you.']];
  A['status-open'] = function (t) {
    var me = S.getCurrentUser(), r = t.getBoundingClientRect();
    closeMenu();
    var el = document.createElement('div'); el.className = 'ctx-menu status-menu'; el.setAttribute('role', 'menu');
    el.innerHTML = STATUSES.map(function (s, i) {
      return '<button role="menuitemradio" aria-checked="' + (me.status === s[0]) + '" tabindex="-1" data-i="' + i + '"><span class="st-dot ' + (s[0] === 'invisible' ? 'offline' : s[0]) + '">' + ico('plane') + '</span><span class="st-text"><b>' + s[1] + '</b><i>' + s[2] + '</i></span>' + (me.status === s[0] ? ico('check', 'sm') : '') + '</button>';
    }).join('');
    overlay.appendChild(el);
    el.style.left = Math.max(10, r.left) + 'px'; el.style.top = Math.max(10, r.top - el.offsetHeight - 10) + 'px';
    var items = STATUSES.map(function (s) { return { run: function () { setStatus(s[0]); } }; });
    menu = { el: el, items: items, opener: t };
    (el.querySelector('[aria-checked="true"]') || el.firstChild).focus();
  };
  function setStatus(s, auto) {
    var me = S.getCurrentUser();
    if (me.status === s) return;
    if (!auto) idle.auto = false;
    S.setStatus(s).then(function () { U.renderMe(); U.renderDetails(); if (!auto) toast(s === 'invisible' ? 'Friends will see you as offline.' : s === 'dnd' ? 'Do not disturb is on. Quiet skies.' : 'You are ' + U.statusText(s).toLowerCase() + '.'); });
  }

  /* ---------- Auto-away when idle ---------- */
  var idle = { t: null, auto: false, ms: 10 * 60 * 1000 };
  function wake() {
    if (idle.auto && S.getCurrentUser().status === 'away') { idle.auto = false; setStatus('online', true); toast('Welcome back. You are online again.'); }
    clearTimeout(idle.t);
    if (st.autoAway) idle.t = setTimeout(goIdle, idle.ms);
  }
  function goIdle() {
    if (st.screen === 'app' && st.autoAway && S.getCurrentUser().status === 'online') { idle.auto = true; setStatus('away', true); toast('You look away, so Concorde marked you Away.'); }
  }
  ['mousemove', 'keydown', 'mousedown', 'touchstart'].forEach(function (e) {
    document.addEventListener(e, function (ev) {
      /* A pretend idle period lasts until your next click or key press, so you have time to look at the Away state. */
      if (idle.simulated) { if (ev.type === 'mousemove') return; idle.simulated = false; }
      wake();
    }, { passive: true });
  });
  A['sim-idle'] = function () {
    U.state.settings = false; U.renderSettings(); idle.simulated = true;
    st.autoAway = true; goIdle();
  };
  wake();

  /* ---------- Camera and screen share ---------- */
  A['toggle-camera'] = function () { var cl = S.getCall(st.convId); var has = (cl.streams || []).some(function (s) { return s.id === 'you' && s.kind === 'camera'; }); S.setCamera(!has); };
  A['stage-pick'] = function (t) { st.stageKey = t.dataset.key; U.renderCall(); };
  /* Bigger picture, and full screen. Full screen takes the whole call area (picture and controls), which survives the call redrawing. */
  A['stage-big'] = function () { st.stageBig = !st.stageBig; U.renderCall(); };
  function toggleFull() {
    var slot = $('#call-slot'); if (!slot) return;
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    if (slot.requestFullscreen) slot.requestFullscreen().catch(function () { toast('Full screen isn’t available here.'); });
  }
  A['stage-full'] = toggleFull;
  document.addEventListener('dblclick', function (ev) { if (ev.target.closest && ev.target.closest('#call-slot .stage') && !ev.target.closest('.stage-tools, .pip')) toggleFull(); });
  document.addEventListener('fullscreenchange', function () { var b = document.querySelector('#call-slot [data-action="stage-full"]'); if (b) b.innerHTML = U.ico(document.fullscreenElement ? 'minimize' : 'maximize', 'sm'); });
  A['sim-camera'] = function () {
    U.state.settings = false; U.renderSettings();
    var cl = S.getCall(st.convId);
    if (!cl || !cl.joined) { toast('Join a call first, then try this again.'); return; }
    var friend = cl.participants.filter(function (p) { return p !== 'you'; })[0] || 'chiroben';
    S.simulateFriendCamera(friend);
  };
  var share = null;
  function closeShare() { if (share) { share.el.remove(); share = null; } }
  var SOURCES = {
    screen: [['screen-1', 'Screen 1', 'Main display'], ['screen-2', 'Screen 2', 'Second display']],
    window: [['win-1', 'Design file', 'Sketchbook'], ['win-2', 'Web browser', 'Concorde preview'], ['win-3', 'Notes', 'Weekend plans'], ['win-4', 'Music player', 'Late night mix']]
  };
  function paintShare() {
    var d = share, list = SOURCES[d.tab];
    d.el.querySelector('.share-tabs').innerHTML = [['screen', 'monitor', 'Screen'], ['window', 'app-window', 'Window']].map(function (t) {
      return '<button data-action="share-tab" data-tab="' + t[0] + '" aria-pressed="' + (d.tab === t[0]) + '">' + ico(t[1], 'sm') + t[2] + '</button>';
    }).join('');
    d.el.querySelector('.share-grid').innerHTML = list.map(function (s, i) {
      return '<button class="share-tile" role="radio" aria-checked="' + (d.pick === s[0]) + '" data-action="share-pick" data-id="' + s[0] + '"><span class="share-thumb t' + (i % 4) + '">' + (d.tab === 'screen' ? '<span class="desk"><b></b><b></b><b></b></span>' : '<span class="win"><i></i><i></i><i></i></span>') + '</span><b>' + s[1] + '</b><span>' + s[2] + '</span></button>';
    }).join('');
    d.el.querySelector('[data-action="share-go"]').disabled = !d.pick;
  }
  function openShare() {
    closeShare();
    var el = document.createElement('div'); el.className = 'scrim2'; el.dataset.action = 'share-scrim';
    el.innerHTML = '<div class="modal share-dlg" role="dialog" aria-modal="true" aria-labelledby="sh-t"><div class="new-head"><div><h2 id="sh-t">Share your screen</h2><p class="crop-hint">Choose what everyone in the call will see.</p></div><button class="btn-round sm" data-action="share-cancel" aria-label="Close">' + ico('x', 'sm') + '</button></div>' +
      '<div class="segments share-tabs" role="group" aria-label="What to share"></div><div class="share-grid" role="radiogroup" aria-label="Sources"></div>' +
      '<div class="set-row"><span class="lbl">Share sound<small>Let everyone hear what your computer plays</small></span><button class="switch" role="switch" data-action="share-sound" aria-checked="false" aria-label="Share sound"></button></div>' +
      '<div class="modal-foot"><button class="btn-pill quiet" data-action="share-cancel">Cancel</button><button class="btn-pill" data-action="share-go">' + ico('monitor-up', 'sm') + 'Share</button></div></div>';
    overlay.appendChild(el);
    share = { el: el, tab: 'screen', pick: 'screen-1', sound: false }; paintShare();
    el.querySelector('.share-tile').focus();
  }
  A['toggle-share'] = function () {
    var cl = S.getCall(st.convId);
    if (cl && cl.sharingId === 'you') S.stopScreenShare();
    else if (C.config && C.config.backend === 'live') { S.startScreenShare({}); }   /* the browser (or the desktop app) shows its own picker */
    else openShare();
  };
  A['share-scrim'] = function (t, ev) { if (ev.target === t) closeShare(); };
  A['share-cancel'] = closeShare;
  A['share-tab'] = function (t) { share.tab = t.dataset.tab; share.pick = SOURCES[share.tab][0][0]; paintShare(); };
  A['share-pick'] = function (t) { share.pick = t.dataset.id; paintShare(); var b = share.el.querySelector('[data-id="' + share.pick + '"]'); if (b) b.focus(); };
  A['share-sound'] = function (t) { share.sound = !share.sound; t.setAttribute('aria-checked', String(share.sound)); };
  A['share-go'] = function () { var o = { source: share.pick, sound: share.sound }; closeShare(); S.startScreenShare(o); U.chime('join'); };

  /* ---------- Tell the Tower ---------- */
  var tw = null;
  function towerBtnDot() {
    var b = $('#tower-btn'); if (!b) return;
    var n = S.towerUnread(); b.classList.toggle('has-dot', n > 0);
    b.setAttribute('aria-label', 'Tell the Tower' + (n ? ', ' + n + ' new' : ''));
  }
  var TSTAT = [['new', 'New'], ['planned', 'Planned'], ['done', 'Done']];
  function cardHTML(i) {
    var p = person(i.from), mine = i.plus.indexOf('you') !== -1, open = tw.open[i.id], owner = S.isOwner();
    var status = owner
      ? '<div class="segments mini" role="group" aria-label="Status">' + TSTAT.map(function (s) { return '<button data-action="tower-status" data-id="' + i.id + '" data-s="' + s[0] + '" aria-pressed="' + (i.status === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div>'
      : '<span class="tstat ' + i.status + '">' + TSTAT.filter(function (s) { return s[0] === i.status; })[0][1] + '</span>';
    return '<article class="tcard' + (i.status === 'done' ? ' done' : '') + '" data-id="' + i.id + '"><header>' + avatar(p, 38) + '<div><b>' + (i.from === 'you' ? 'You' : esc(p.name)) + '</b><span>' + esc(i.time) + '</span></div>' +
      '<span class="ttype ' + i.type + '">' + ico(i.type === 'bug' ? 'bug' : 'lightbulb', 'sm') + (i.type === 'bug' ? 'Bug' : 'Idea') + '</span></header>' +
      '<p>' + esc(i.text) + '</p>' +
      ((i.images && i.images.length) ? '<div class="tshots">' + i.images.map(function (u, n) { return '<button class="tshot" data-action="tower-shot" data-u="' + esc(u) + '" aria-label="View screenshot ' + (n + 1) + '"><img alt="" loading="lazy" src="' + esc(u) + '"></button>'; }).join('') + '</div>' : '') +
      '<footer><button class="plus' + (mine ? ' mine' : '') + '" data-action="tower-plus" data-id="' + i.id + '" aria-pressed="' + mine + '" aria-label="Plus one. ' + i.plus.length + ' so far.">' + ico('thumbs-up', 'sm') + '+1 <b>' + i.plus.length + '</b></button>' +
      '<button class="cmt" data-action="tower-comments" data-id="' + i.id + '" aria-expanded="' + !!open + '">' + ico('message-circle', 'sm') + (i.comments.length || 'Comment') + '</button><span class="grow"></span>' + status + '</footer>' +
      (open ? '<div class="tcomments">' + i.comments.map(function (c) { return '<div class="tc">' + avatar(person(c.from), 26) + '<span><b>' + (c.from === 'you' ? 'You' : esc(person(c.from).name)) + '</b> ' + esc(c.text) + '</span></div>'; }).join('') +
        '<label class="field tc-field" for="tc-' + i.id + '"><input id="tc-' + i.id + '" data-comment="' + i.id + '" placeholder="Add a short comment" maxlength="140" autocomplete="off"><button class="btn-round sm" data-action="tower-comment-send" data-id="' + i.id + '" aria-label="Send comment">' + ico('send', 'sm') + '</button></label></div>' : '') + '</article>';
  }
  function paintTower() {
    if (!tw) return;
    var list = S.listIdeas().filter(function (i) { return tw.filter === 'all' || i.type === tw.filter; });
    /* finished items tuck into a collapsed "Done" group at the bottom */
    var open = list.filter(function (i) { return i.status !== 'done'; }), done = list.filter(function (i) { return i.status === 'done'; });
    var html = open.map(cardHTML).join('');
    if (!open.length && !done.length) html = '<p class="empty">Nothing here yet. Be the first to tell the Tower something.</p>';
    if (done.length) html += '<section class="tdone' + (tw.doneOpen ? ' open' : '') + '"><button class="tdone-head" data-action="tower-done-toggle" aria-expanded="' + !!tw.doneOpen + '">' + ico('check', 'sm') + '<span>Done</span><span class="count">' + done.length + '</span><span class="chev">' + ico('chevron-down', 'sm') + '</span></button>' + (tw.doneOpen ? '<div class="tdone-body">' + done.map(cardHTML).join('') + '</div>' : '') + '</section>';
    tw.el.querySelector('.tower-list').innerHTML = html;
    tw.el.querySelectorAll('.tower-filter button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.f === tw.filter)); });
  }
  function openTower() {
    if (tw) return;
    var el = document.createElement('div'); el.className = 'scrim2'; el.dataset.action = 'tower-scrim';
    el.innerHTML = '<div class="modal tower" role="dialog" aria-modal="true" aria-labelledby="tw-t"><div class="new-head"><div><h2 id="tw-t">Tell the Tower</h2><p class="crop-hint">Ideas and bugs for Concorde. Everyone can see them and add a +1.</p></div><button class="btn-round sm" data-action="tower-close" aria-label="Close">' + ico('x', 'sm') + '</button></div>' +
      '<div class="tower-new"><div class="segments mini" role="group" aria-label="Type"><button data-action="tower-type" data-t="idea" aria-pressed="true">' + ico('lightbulb', 'sm') + 'Idea</button><button data-action="tower-type" data-t="bug" aria-pressed="false">' + ico('bug', 'sm') + 'Bug</button></div>' +
      '<label class="field" for="tower-text"><input id="tower-text" maxlength="200" placeholder="What should the Tower know?" autocomplete="off"></label><button class="btn-round" data-action="tower-attach" aria-label="Add a screenshot" title="Add a screenshot (or paste one)">' + ico('image', 'sm') + '</button><input type="file" id="tower-file" accept="image/*" multiple hidden><button class="btn-pill" data-action="tower-post">' + ico('send', 'sm') + 'Post</button><div class="tower-shots" id="tower-shots" hidden></div></div>' +
      '<div class="segments tower-filter" role="group" aria-label="Show"><button data-action="tower-filter" data-f="all" aria-pressed="true">All</button><button data-action="tower-filter" data-f="idea" aria-pressed="false">Ideas</button><button data-action="tower-filter" data-f="bug" aria-pressed="false">Bugs</button></div>' +
      '<div class="tower-list"></div></div>';
    overlay.appendChild(el);
    tw = { el: el, type: 'idea', filter: 'all', open: {}, shots: [] };
    paintTower(); $('#tower-text', el).focus();
    $('#tower-text', el).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); A['tower-post'](); } });
    $('#tower-text', el).addEventListener('paste', function (e) {
      var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); addShots(files); }
    });
    $('#tower-file', el).addEventListener('change', function (e) { addShots(e.target.files); e.target.value = ''; });
    el.addEventListener('keydown', function (e) { var c = e.target.dataset && e.target.dataset.comment; if (c && e.key === 'Enter') { e.preventDefault(); sendComment(c); } });
    S.markTowerSeen();
  }
  function closeTower() { if (tw) { tw.el.remove(); tw = null; } }
  function sendComment(id) { var i = $('#tc-' + id); if (!i || !i.value.trim()) return; var v = i.value; S.addIdeaComment(id, v); }
  A['tower-open'] = openTower;
  A['yt-play'] = function (t) {
    var card = t.closest('.yt-card'); if (!card) return;
    var f = document.createElement('iframe'); f.className = 'yt-frame'; f.title = 'YouTube video';
    f.src = 'https://www.youtube-nocookie.com/embed/' + card.dataset.yt + '?autoplay=1&rel=0&modestbranding=1';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin';
    card.querySelector('.yt-play').replaceWith(f); card.classList.add('playing');
  };
  A['tower-close'] = closeTower;
  A['tower-scrim'] = function (t, ev) { if (ev.target === t) closeTower(); };
  A['tower-type'] = function (t) { tw.type = t.dataset.t; tw.el.querySelectorAll('[data-action="tower-type"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); }); };
  A['tower-done-toggle'] = function () { tw.doneOpen = !tw.doneOpen; paintTower(); };
  A['tower-filter'] = function (t) { tw.filter = t.dataset.f; paintTower(); };
  /* Screenshots on an idea or bug: up to four, pasted or picked. */
  var MAX_SHOTS = 4;
  function paintShots() {
    var box = $('#tower-shots', tw.el); if (!box) return;
    box.hidden = !tw.shots.length;
    box.innerHTML = tw.shots.map(function (sh, n) {
      return '<span class="tshot-chip"><img alt="Screenshot ' + (n + 1) + '" src="' + sh.url + '"><button data-action="tower-shot-x" data-n="' + n + '" aria-label="Remove screenshot ' + (n + 1) + '">' + ico('x', 'sm') + '</button></span>';
    }).join('');
  }
  function addShots(files) {
    var list = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type); });
    if (!list.length) return;
    var room = MAX_SHOTS - tw.shots.length;
    if (list.length > room) toast('Up to ' + MAX_SHOTS + ' screenshots per post.');
    list.slice(0, Math.max(0, room)).forEach(function (f) { tw.shots.push({ file: f, url: URL.createObjectURL(f) }); });
    paintShots(); var t = $('#tower-text', tw.el); if (t) t.focus();
  }
  A['tower-attach'] = function () { var f = $('#tower-file', tw.el); if (f) f.click(); };
  A['tower-shot-x'] = function (t) { var sh = tw.shots.splice(+t.dataset.n, 1)[0]; if (sh) URL.revokeObjectURL(sh.url); paintShots(); };
  A['tower-post'] = function () {
    var i = $('#tower-text', tw.el), v = i.value.trim(), shots = tw.shots.slice();
    if (!v && !shots.length) { i.focus(); return; }
    if (!v) v = tw.type === 'bug' ? 'Screenshot of a bug' : 'Screenshot';
    var btn = $('[data-action="tower-post"]', tw.el), type = tw.type;
    i.value = ''; tw.shots = []; paintShots(); if (btn) btn.disabled = true;
    S.addIdea({ type: type, text: v, images: shots.map(function (x) { return x.file; }) }).then(function () {
      shots.forEach(function (x) { URL.revokeObjectURL(x.url); }); U.chime('send'); toast('Posted to the Tower');
    }).catch(function () {
      if (tw) { i.value = v; tw.shots = shots; paintShots(); }
      toast('Couldn’t post that. Try again.');
    }).then(function () { if (btn) btn.disabled = false; });
  };
  A['tower-shot'] = function (t) { peekImage(t.dataset.u); };
  function peekImage(url) {
    var el = document.createElement('div'); el.className = 'peek'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Screenshot');
    el.innerHTML = '<img alt="Screenshot" src="' + esc(url) + '"><button class="btn-round" aria-label="Close">' + ico('x') + '</button>';
    function close() { el.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    el.addEventListener('click', close); document.addEventListener('keydown', onKey, true); document.body.appendChild(el);
  }
  A['tower-plus'] = function (t) { S.toggleIdeaPlus(t.dataset.id); };
  A['tower-comments'] = function (t) { tw.open[t.dataset.id] = !tw.open[t.dataset.id]; paintTower(); if (tw.open[t.dataset.id]) { var i = $('#tc-' + t.dataset.id); if (i) i.focus(); } };
  A['tower-comment-send'] = function (t) { sendComment(t.dataset.id); };
  A['tower-status'] = function (t) { S.setIdeaStatus(t.dataset.id, t.dataset.s); };
  A['tower-banner-open'] = function () { U.closeBanner(); openTower(); };
  A['sim-idea'] = function () {
    U.state.settings = false; U.renderSettings();
    setTimeout(function () { S.simulateIdea(['kid', 'chiroben', 'plushpants'][Math.floor(Math.random() * 3)]); }, 500);
  };
  /* ---------- Pokes: a small "hey" that shakes the window ---------- */
  function sendPoke(id) {
    var p = person(id); if (!p || id === 'you') return;
    S.poke(id).then(function (r) {
      if (r === true) { U.chime('send'); toast('Poked ' + p.name); }
      else if (r === 'slow') toast('Easy. Give ' + p.name + ' a few seconds.');
      else toast('Couldn’t send that poke.');
    });
  }
  A['poke'] = function (t) { sendPoke(t.dataset.id); };
  A['poke-back'] = function (t) { U.closeBanner(); sendPoke(t.dataset.id); };
  S.on('poked', function (e) {
    var p = e && person(e.from); if (!p || U.quiet()) return;
    var app = document.getElementById('app') || document.body;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { app.classList.remove('poked'); void app.offsetWidth; app.classList.add('poked'); setTimeout(function () { app.classList.remove('poked'); }, 700); }
    if (st.sounds !== false) U.chime('poke');
    U.showBanner({ who: p, badge: ico('hand', 'sm'), title: p.name + ' poked you', where: 'Right now', html: 'Poke them back?', openAction: 'poke-back', id: e.from });
  });
  /* Someone new joined with an invite: everyone gets a friendly note with a shortcut to say hello. */
  S.on('joined', function (e) {
    var p = e && e.person; if (!p || U.quiet() || !st.alerts) return;
    U.chime('mention');
    U.showBanner({ who: p, badge: ico('user-plus', 'sm'), title: p.name + ' just joined Concorde', where: 'New friend', html: 'Say hello \uD83D\uDC4B', openAction: 'say-hi', id: p.id });
  });
  A['say-hi'] = function (t) {
    U.closeBanner();
    S.createConversation([t.dataset.id]).then(function (r) { var id = r && (r.id || r); if (id) U.openConversation(id); }).catch(function () { toast('Couldn’t start that chat.'); });
  };
  S.on('tower', function (e) {
    towerBtnDot();
    if (tw) {
      var keepText = ($('#tower-text', tw.el) || {}).value, active = document.activeElement && document.activeElement.id;
      paintTower(); if (active && $('#' + active)) $('#' + active).focus();
      if (e && e.incoming) S.markTowerSeen();
    } else if (e && e.incoming && !U.quiet() && st.alerts) {
      var p = person(e.idea.from);
      U.chime('mention');
      U.showBanner({ who: p, badge: ico(e.idea.type === 'bug' ? 'bug' : 'lightbulb', 'sm'), title: p.name + ' has a new ' + (e.idea.type === 'bug' ? 'bug report' : 'idea'), where: 'in Tell the Tower', html: esc(e.idea.text), openAction: 'tower-banner-open', tone: 'tower' });
    }
  });
  // Add the Tower button to the sidebar once the app is drawn.
  new MutationObserver(function () {
    var brand = $('.sidebar .brand');
    if (brand && !$('#tower-btn')) {
      var plus = brand.querySelector('[data-action="new-open"]');
      var b = document.createElement('button'); b.id = 'tower-btn'; b.className = 'btn-round sm tower-btn'; b.dataset.action = 'tower-open'; b.title = 'Tell the Tower';
      b.innerHTML = ico('lightbulb', 'sm'); brand.insertBefore(b, plus); towerBtnDot();
    }
    if (typeof paintWorld === 'function') paintWorld();
    var bm = $('#brand-mark'); if (bm && typeof paintMark === 'function' && bm.dataset.painted !== '1') { bm.dataset.painted = '1'; paintMark(); }
  }).observe(document.getElementById('app'), { childList: true, subtree: true });

  /* ---------- Mention note: a small green pane above your card that appears briefly ---------- */
  var noteEl = null, noteTimer = null;
  function showNote(who, where, convId) {
    var card = $('#me-card'); if (!card) return;
    clearTimeout(noteTimer); if (noteEl) noteEl.remove();
    var r = card.getBoundingClientRect(), el = document.createElement('button');
    el.className = 'note-pane'; el.dataset.action = 'note-open'; el.dataset.id = convId;
    el.style.left = r.left + 'px'; el.style.width = r.width + 'px'; el.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    el.innerHTML = '<span class="note-at">@</span><span><b>' + esc(who) + ' mentioned you</b><i>' + esc(where) + '</i></span>';
    overlay.appendChild(el); noteEl = el;
    noteTimer = setTimeout(function () { el.classList.add('fade'); setTimeout(function () { if (noteEl === el) noteEl = null; el.remove(); }, 700); }, 4500);
  }
  A['note-open'] = function (t) { var id = t.dataset.id; if (noteEl) { noteEl.remove(); noteEl = null; } U.openConversation(id); };
  S.on('message', function (e) {
    if (!e.incoming || !S.mentionsYou(e.message.text) || U.quiet() || st.screen !== 'app') return;
    var c = convById(e.conversationId); if (!c) return;
    showNote(person(e.message.from).name, c.type === 'group' ? 'in ' + c.name : 'in a direct chat', c.id);
  });

  /* ---------- Photo viewer ---------- */
  var vw = null;
  function paintViewer() {
    var d = vw, it = d.list[d.i], multi = d.list.length > 1;
    var pic = it.image ? '<img src="' + esc(it.image) + '" alt="Photo ' + (d.i + 1) + ' of ' + d.list.length + '">' : U.scene(it.scene || 0, 900, 600);
    d.el.querySelector('.v-pic').innerHTML = pic;
    d.el.querySelector('.v-name span').textContent = it.name || ('Photo from ' + d.who);
    d.el.querySelector('.v-count').textContent = multi ? (d.i + 1) + ' of ' + d.list.length : '';
    d.el.querySelector('.v-prev').hidden = d.el.querySelector('.v-next').hidden = !multi;
    d.el.querySelector('.v-prev').disabled = d.i === 0; d.el.querySelector('.v-next').disabled = d.i === d.list.length - 1;
    d.el.querySelector('.v-dots').innerHTML = multi ? d.list.map(function (x, n) { return '<button data-action="viewer-go" data-i="' + n + '" aria-label="Photo ' + (n + 1) + '" aria-current="' + (n === d.i) + '"></button>'; }).join('') : '';
  }
  function openViewer(id, i) {
    var m = st.messages.filter(function (x) { return x.id === id; })[0]; if (!m) return;
    closeViewer();
    var el = document.createElement('div'); el.className = 'scrim2 viewer'; el.dataset.action = 'viewer-scrim';
    var who = m.from === 'you' ? 'You' : person(m.from).name;
    el.innerHTML = '<div class="v-wrap" role="dialog" aria-modal="true" aria-label="Photo viewer">' +
      '<div class="v-frame"><div class="v-pic"></div></div>' +
      '<div class="v-name">' + ico('image', 'sm') + '<span></span></div>' +
      '<button class="btn-round v-prev" data-action="viewer-prev" aria-label="Previous photo">' + ico('chevron-down') + '</button>' +
      '<button class="btn-round v-next" data-action="viewer-next" aria-label="Next photo">' + ico('chevron-down') + '</button>' +
      '<div class="v-bar"><div class="v-meta"><b>' + esc(who) + '</b><span>' + esc(m.time) + (m.text ? ' · ' + esc(m.text) : '') + '</span></div>' +
      '<div class="v-dots" role="group" aria-label="Photos"></div><span class="v-count" aria-live="polite"></span>' +
      '<button class="btn-round sm" data-action="viewer-save" aria-label="Save photo">' + ico('download', 'sm') + '</button></div>' +
      '<button class="btn-round v-close" data-action="viewer-close" aria-label="Close viewer">' + ico('x') + '</button></div>';
    overlay.appendChild(el);
    vw = { el: el, who: who, list: U.imagesOf(m), i: Math.max(0, +i || 0) }; paintViewer();
    el.querySelector('.v-close').focus();
  }
  function closeViewer() { if (vw) { vw.el.remove(); vw = null; } }
  function step(n) { if (!vw) return; var j = vw.i + n; if (j < 0 || j >= vw.list.length) return; vw.i = j; paintViewer(); }
  A['view-image'] = function (t) { openViewer(t.dataset.id, t.dataset.i); };
  A['viewer-close'] = closeViewer;
  A['viewer-scrim'] = function (t, ev) { if (ev.target === t || ev.target.classList.contains('v-wrap')) closeViewer(); };
  A['viewer-prev'] = function () { step(-1); };
  A['viewer-next'] = function () { step(1); };
  A['viewer-go'] = function (t) { vw.i = +t.dataset.i; paintViewer(); };
  A['viewer-save'] = function () { var it = vw && vw.list[vw.i]; saveUrl(it && it.image, (it && it.name) || 'photo.jpg'); };
  /* One way to save anything: photos, files and the Files tray all come through here. */
  function saveUrl(url, name) {
    if (!url) { toast('Nothing to save here yet.'); return; }
    name = String(name || 'download').replace(/[\\/:*?"<>|]+/g, '_');
    fetch(url).then(function (r) { if (!r.ok) throw new Error('bad'); return r.blob(); }).then(function (b) {
      var a = document.createElement('a'), u = URL.createObjectURL(b); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000); toast('Saved ' + name);
    }).catch(function () { window.open(url, '_blank', 'noopener'); toast('Opened in your browser instead.'); });
  }
  function saveMessage(m) {
    if (m.type === 'file' && m.file) return saveUrl(m.file.url, m.file.name);
    var l = U.imagesOf(m), it = l[0]; saveUrl(it && it.image, (it && it.name) || 'photo.jpg');
  }
  A['download'] = function (t) { var m = st.messages.filter(function (x) { return x.id === t.dataset.id; })[0]; if (m) saveMessage(m); };
  A['save-url'] = function (t) { saveUrl(t.dataset.u, t.dataset.n); };
  document.addEventListener('keydown', function (ev) {
    if (!vw) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); }
    else if (ev.key === 'Tab') {
      var f = [].slice.call(vw.el.querySelectorAll('button:not([disabled]):not([hidden])')), at = f.indexOf(document.activeElement);
      ev.preventDefault(); f[(at + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }, true);


  /* ---------- Update ready: the plane by the app name turns green and pulses ---------- */
  var upPop = null, upTimer = null;
  function paintMark() {
    var m = $('#brand-mark'); if (!m) return;
    var u = S.getUpdate();
    m.classList.toggle('update', u.available && !u.installing); m.classList.toggle('installing', u.installing);
    m.tabIndex = u.available ? 0 : -1;
    m.setAttribute('aria-label', u.available ? 'Concorde. An update is ready' : 'Concorde');
    m.setAttribute('aria-haspopup', u.available ? 'menu' : 'false');
    if (!u.available && upPop) closeUpPop();
    else if (upPop) paintUpPop();
    paintTray();
  }
  function paintUpPop() {
    var u = S.getUpdate(); if (!upPop) return;
    upPop.innerHTML = u.installing
      ? '<div class="up-head"><span class="bars" style="color:var(--ok-ink)"><i></i><i></i><i></i></span><div><b>Updating…</b><i>Concorde will restart in a moment</i></div></div>'
      : '<div class="up-head"><span class="up-dot"></span><div><b>Update ready</b><i>Concorde v' + esc(u.version) + '</i></div></div><button role="menuitem" data-action="update-now">' + ico('download', 'sm') + 'Update now</button>';
  }
  function openUpPop() {
    var m = $('#brand-mark'); if (!m || !S.getUpdate().available) return;
    clearTimeout(upTimer);
    if (!upPop) {
      upPop = document.createElement('div'); upPop.className = 'update-pop'; upPop.setAttribute('role', 'menu'); overlay.appendChild(upPop);
      upPop.addEventListener('mouseenter', function () { clearTimeout(upTimer); });
      upPop.addEventListener('mouseleave', function () { closeUpPopSoon(); });
    }
    var r = m.getBoundingClientRect(); upPop.style.left = r.left + 'px'; upPop.style.top = (r.bottom + 10) + 'px';
    paintUpPop();
  }
  function closeUpPop() { clearTimeout(upTimer); if (upPop) { upPop.remove(); upPop = null; } }
  function closeUpPopSoon() { clearTimeout(upTimer); upTimer = setTimeout(closeUpPop, 280); }
  document.addEventListener('mouseover', function (ev) { if (ev.target.closest && ev.target.closest('#brand-mark')) openUpPop(); });
  document.addEventListener('mouseout', function (ev) { if (ev.target.closest && ev.target.closest('#brand-mark') && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('#brand-mark'))) closeUpPopSoon(); });
  document.addEventListener('focusin', function (ev) { if (ev.target.id === 'brand-mark') openUpPop(); });
  document.addEventListener('focusout', function (ev) { if (ev.target.id === 'brand-mark' && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.update-pop'))) closeUpPopSoon(); });
  A['brand-click'] = function () { openUpPop(); };
  A['update-now'] = function () {
    S.installUpdate().then(function (v) { if (v) { U.chime('join'); toast('Updated to v' + v + '. In the installed app, Concorde restarts here.'); } });
  };
  A['sim-update'] = function () { U.state.settings = false; U.renderSettings(); setTimeout(function () { S.simulateUpdate(); }, 400); };
  S.on('update', function () { paintMark(); });

  /* ---------- App window frame (title bar) ---------- */
  function applyFrame() { document.body.classList.toggle('framed', U.store.get('frame', 'on') === 'on'); }
  (function buildFrame() {
    var bar = document.createElement('div'); bar.className = 'titlebar'; bar.id = 'titlebar';
    bar.innerHTML = '<span class="tb-mark">' + ico('plane', 'sm') + '</span><span class="tb-name">Concorde</span><span class="tb-grow"></span>' +
      '<button class="tb-btn" data-action="win-min" aria-label="Minimise" title="Minimise">' + ico('minus', 'sm') + '</button>' +
      '<button class="tb-btn" data-action="win-max" aria-label="Maximise" title="Maximise">' + ico('square', 'sm') + '</button>' +
      '<button class="tb-btn close" data-action="win-close" aria-label="Close" title="Close">' + ico('x', 'sm') + '</button>';
    document.body.insertBefore(bar, document.body.firstChild); applyFrame();
  })();
  A['win-min'] = function () { toast('In the installed app this minimises Concorde to the taskbar.'); };
  A['win-max'] = function () { toast('In the installed app this fills your screen.'); };
  A['win-close'] = function () { toast('In the installed app, closing keeps Concorde running in the system tray.'); };
  A['toggle-frame'] = function (t) {
    var on = U.store.get('frame', 'on') !== 'on'; U.store.set('frame', on ? 'on' : 'off'); t.setAttribute('aria-checked', String(on)); applyFrame();
  };

  /* ---------- System tray preview ---------- */
  var tray = null, trayMenuOpen = true, trayConvs = [];
  function refreshTrayConvs() { S.listConversations().then(function (l) { trayConvs = l || []; paintTray(); }); }
  function trayBadge() {
    var u = S.getUpdate(); if (u.available) return 'update';
    return trayConvs.some(function (c) { return c.mention; }) ? 'mention' : '';
  }
  function paintTray() {
    if (!tray) return;
    var me = S.getCurrentUser(), b = trayBadge(), u = S.getUpdate(), muted = !st.sounds && !st.alerts;
    var menuHTML = trayMenuOpen ? '<div class="tray-menu" role="menu">' +
      '<div class="tm-head">' + avatar(me, 34) + '<div><b>' + esc(me.name) + '</b><i>' + U.statusText(me.status) + '</i></div></div>' +
      '<button role="menuitem" data-action="tray-open">' + ico('plane', 'sm') + '<span>Open Concorde</span></button><hr>' +
      STATUSES.map(function (x) { return '<button role="menuitemradio" aria-checked="' + (me.status === x[0]) + '" data-action="tray-status" data-s="' + x[0] + '"><span class="st-dot ' + (x[0] === 'invisible' ? 'offline' : x[0]) + '">' + ico('plane') + '</span><span>' + x[1] + '</span>' + (me.status === x[0] ? ico('check', 'sm') : '') + '</button>'; }).join('') + '<hr>' +
      (u.available && !u.installing ? '<button role="menuitem" data-action="update-now">' + ico('download', 'sm') + '<span>Update now · v' + esc(u.version) + '</span></button>' : '') +
      '<button role="menuitemcheckbox" aria-checked="' + muted + '" data-action="tray-mute">' + ico(muted ? 'bell-off' : 'bell', 'sm') + '<span>Mute notifications</span>' + (muted ? ico('check', 'sm') : '') + '</button><hr>' +
      '<button role="menuitem" data-action="tray-quit">' + ico('power', 'sm') + '<span>Quit Concorde</span></button></div>' : '';
    tray.innerHTML = menuHTML + '<div class="tray-strip"><span class="tray-cap">System tray preview</span><button class="tray-icon" data-action="tray-toggle" aria-label="Concorde tray icon" aria-expanded="' + trayMenuOpen + '"><span class="tray-plane">' + ico('plane', 'sm') + '</span>' + (b ? '<i class="tray-badge ' + b + '"></i>' : '') + '</button>' +
      '<button class="btn-round sm" data-action="tray-close" aria-label="Hide tray preview">' + ico('x', 'sm') + '</button></div>';
  }
  A['show-tray'] = function () {
    U.state.settings = false; U.renderSettings();
    if (!tray) { tray = document.createElement('div'); tray.className = 'tray-demo'; overlay.appendChild(tray); }
    trayMenuOpen = true; refreshTrayConvs(); paintTray();
  };
  A['tray-toggle'] = function () { trayMenuOpen = !trayMenuOpen; paintTray(); };
  A['tray-close'] = function () { if (tray) { tray.remove(); tray = null; } };
  A['tray-open'] = function () { trayMenuOpen = false; paintTray(); toast('Concorde comes to the front.'); };
  A['tray-status'] = function (t) { setStatus(t.dataset.s); };
  A['tray-mute'] = function () {
    var muted = !st.sounds && !st.alerts; st.sounds = st.alerts = muted;
    U.store.set('sounds', st.sounds ? 'on' : 'off'); U.store.set('alerts', st.alerts ? 'on' : 'off'); paintTray();
    toast(muted ? 'Notifications are back on.' : 'Notifications muted. @mentions will still mark your chats.');
  };
  A['tray-quit'] = function () { toast('In the installed app this closes Concorde completely.'); };
  S.on('conversations', function () { refreshTrayConvs(); });
  S.on('message', function () { refreshTrayConvs(); });


  /* ---------- First run: nobody here yet ---------- */
  var CODE = 'CNC-2026';
  function paintWorld() {
    var sh = $('#shell'); if (!sh) return;
    var empty = !st.conversations.length, w = $('#welcome');
    sh.classList.toggle('empty-world', empty);
    if (!empty) { if (w) w.remove(); return; }
    if (w) return;
    var me = S.getCurrentUser();
    w = document.createElement('section'); w.id = 'welcome'; w.className = 'card welcome'; w.setAttribute('aria-label', 'Welcome');
    w.innerHTML = '<div class="wl-tile">' + ico('plane', 'lg') + '</div>' +
      '<h1>Welcome aboard, ' + esc(me.name) + '</h1><p class="wl-lead">It is quiet in here, for now. Share your invite code and your friends can join you.</p>' +
      '<div class="wl-code"><span><i>Your invite code</i><b>' + CODE + '</b></span><button class="btn-pill quiet" data-action="copy-code">' + ico('copy', 'sm') + 'Copy code</button></div>' +
      '<div class="wl-steps"><div><span>' + ico('ticket') + '</span><b>1. Share the code</b><i>Send it to a friend, any way you like.</i></div>' +
      '<div><span>' + ico('message-circle') + '</span><b>2. Say hello</b><i>Your first chat appears here.</i></div>' +
      '<div><span>' + ico('headphones') + '</span><b>3. Hop on a call</b><i>Voice, video or screen share.</i></div></div>' +
      '<button class="btn-pill" data-action="new-open">' + ico('plus', 'sm') + 'Start a chat</button>';
    sh.appendChild(w);
  }
  A['copy-code'] = function (t) {
    try { navigator.clipboard.writeText(CODE); } catch (e) {}
    toast('Invite code copied.'); t.innerHTML = ico('check', 'sm') + 'Copied';
  };
  A['sim-firstrun'] = function () {
    U.state.settings = false; U.renderSettings();
    if (S.isFirstRun()) { S.restoreWorld(); U.openConversation('hangar'); toast('Your chats are back.'); return; }
    S.simulateFirstRun(); U.state.convId = null; U.state.messages = []; paintWorld(); U.renderList();
  };
  S.on('conversations', function () { paintWorld(); });

  /* ---------- Offline and reconnecting ---------- */
  var conn = null, connTimer = null;
  function paintConn() {
    var c = S.getConnection();
    document.body.classList.toggle('offline', !c.online);
    if (c.online) { if (conn) { conn.remove(); conn = null; } return; }
    if (!conn) { conn = document.createElement('div'); conn.className = 'conn-banner'; conn.setAttribute('role', 'status'); overlay.appendChild(conn); }
    conn.classList.toggle('trying', c.reconnecting);
    conn.innerHTML = c.reconnecting
      ? '<span class="bars"><i></i><i></i><i></i></span><div><b>Reconnecting…</b><i>Hang on, nearly there.</i></div>'
      : '<span class="conn-ico">' + ico('wifi-off', 'sm') + '</span><div><b>You are offline</b><i>Messages you write will send when you are back.</i></div><button class="btn-pill quiet" data-action="conn-retry">' + ico('refresh-cw', 'sm') + 'Try again</button>';
  }
  S.on('connection', function (e) {
    paintConn();
    if (e.dropped) { U.chime('leave'); toast('Connection lost.' ); }
    if (e.restored) { U.chime('join'); toast('Back online. Anything waiting has been sent.'); }
    if (e.stillOffline) toast('Still offline. It will send as soon as you are back.');
  });
  A['conn-retry'] = function () {
    S.reconnect();
  };
  A['sim-offline'] = function () {
    U.state.settings = false; U.renderSettings();
    var c = S.getConnection(); if (c.online) S.setOnline(false); else S.setOnline(true);
  };
  A['msg-retry'] = function (t) { S.retryMessage(U.state.convId, t.dataset.id); };
  A['msg-discard'] = function (t) { S.discardMessage(U.state.convId, t.dataset.id); };

  /* ---------- Escape: close whichever of our layers is on top ---------- */
  U.escape = function () {
    if (upPop) { closeUpPop(); return true; }
    if (vw) { closeViewer(); return true; }
    if (dlg) { closeConfirm(); return true; }
    if (share) { closeShare(); return true; }
    if (tw) { closeTower(); return true; }
    return false;
  };

  /* ---------- Invite a friend (owner only) ---------- */
  var invBusy = null;
  function inviteHTML() {
    var list = S.listInvites();
    var rows = list.filter(function (i) { return i.status !== 'revoked'; }).map(function (i) {
      var pend = i.status === 'pending';
      return '<li class="inv-row" data-id="' + i.id + '"><span class="inv-mail">' + ico('mail', 'sm') + '<span class="inv-addr">' + esc(i.email) + '</span></span>' +
        '<span class="inv-chip ' + i.status + '">' + (pend ? 'Waiting' : 'Joined') + '</span><span class="inv-time">' + esc(i.time) + '</span>' +
        (pend ? '<span class="inv-acts"><button class="btn-pill quiet sm" data-action="invite-resend" data-id="' + i.id + '">Resend</button>' +
          '<button class="btn-pill quiet sm" data-action="invite-cancel" data-id="' + i.id + '">Cancel</button></span>' : '<span class="inv-acts"></span>') + '</li>';
    }).join('');
    return '<h2>Invite a friend</h2><div class="set-section"><p class="pane-note">Type a friend\'s email. Concorde emails them a one-time code that only works for that address. When they first sign in, they enter it on the set-up screen.</p>' +
      '<form id="inv-form" class="inv-form" novalidate><label class="field">' + ico('mail', 'sm') + '<input id="inv-email" type="email" placeholder="friend@example.com" autocomplete="off" aria-label="Friend\'s email"></label>' +
      '<button class="btn-pill" id="inv-go" type="submit">' + ico('send', 'sm') + 'Send invite</button></form><div id="inv-error-slot"></div></div>' +
      '<div class="set-section"><h3>Invites</h3>' + (rows ? '<ul class="inv-list">' + rows + '</ul>' : '<p class="pane-note">No invites yet. Once you send one, it shows up here.</p>') + '</div>';
  }
  U.inviteHTML = inviteHTML;
  function invError(e) {
    var slot = $('#inv-error-slot'); if (!slot) return;
    slot.innerHTML = e ? '<div class="form-error" id="inv-error" role="alert">' + ico(e.code === 'offline' ? 'wifi-off' : 'triangle-alert', 'sm') + '<span>' + esc(e.message || 'Something went wrong.') + '</span></div>' : '';
  }
  function repaintInvites() { if (st.settings && st.setTab === 'invite') { var keep = ($('#inv-email') || {}).value || ''; U.paintPane(); var i = $('#inv-email'); if (i) i.value = keep; } }
  S.on('invites', function () { repaintInvites(); });
  document.addEventListener('submit', function (ev) {
    if (!ev.target || ev.target.id !== 'inv-form') return;
    ev.preventDefault();
    var inp = $('#inv-email'), btn = $('#inv-go'); if (btn.disabled) return;
    invError(null); btn.disabled = true; btn.lastChild.textContent = 'Sending…';
    S.sendInvite(inp.value).then(function (inv) {
      toast('Invite sent to ' + inv.email);
      st.setTab = 'invite'; U.paintPane(); var n = $('#inv-email'); if (n) n.focus();
    }, function (e) { btn.disabled = false; btn.lastChild.textContent = 'Send invite'; invError(e); inp.focus(); });
  });
  A['invite-resend'] = function (t) {
    t.disabled = true; var old = t.textContent; t.textContent = 'Sending…';
    S.resendInvite(t.dataset.id).then(function (inv) { toast('Invite sent again to ' + inv.email); t.textContent = 'Sent ✓'; setTimeout(function () { if (document.body.contains(t)) { t.textContent = old; t.disabled = false; } }, 1800); },
      function (e) { t.textContent = old; t.disabled = false; invError(e); });
  };
  A['invite-cancel'] = function (t) { S.revokeInvite(t.dataset.id); toast('Invite cancelled'); };
  A['sim-member'] = function () {
    var next = !S.isOwner(); S.setOwnerView(next);
    if (!next && st.setTab === 'invite') st.setTab = 'tools';
    U.renderSettings(); toast(next ? 'Back to the owner view' : 'Viewing as a normal member');
  };
})();
