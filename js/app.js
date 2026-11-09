/* Concorde interface. Draws the screens and wires the buttons. All data comes from Concorde.services. */
(function () {
  var C = window.Concorde, S = C.services;
  var root = document.getElementById('app');
  var overlay = document.getElementById('overlay-root');

  /* ---------- Small helpers ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('concorde.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('concorde.' + k, v); } catch (e) { /* storage unavailable */ } }
  };
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ico(name, cls) { return '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function person(id) { return id === 'you' ? S.getCurrentUser() : S.getPerson(id); }
  function initial(name) { return (name || '?').charAt(0).toUpperCase(); }
  function groupLetter(name) {
    var w = name.split(' ').filter(function (x) { return x.toLowerCase() !== 'the'; });
    return initial(w[0] || name);
  }
  /* What shows under someone's name: their own status message if they set one, otherwise Online / Away / etc. Safe to place in HTML. */
  function statusLine(p) { return p && p.note ? esc(p.note) : statusText(p && p.status); }
  function statusText(s) { return { online: 'Online', away: 'Away', dnd: 'Do not disturb', invisible: 'Appear offline' }[s] || 'Offline'; }
  function dotKey(s) { return s === 'invisible' || !s ? 'offline' : s; }
  function quiet() { return S.getCurrentUser().status === 'dnd'; }

  function avatar(e, size, o) {
    o = o || {};
    var inner = e.avatar ? '<img src="' + esc(e.avatar) + '" alt="">' : esc(o.letter || initial(e.name));
    var dot = o.dot && e.status ? '<span class="dot ' + dotKey(e.status) + '" title="' + statusText(e.status) + '">' + ico('plane') + '</span>' : '';
    return '<span class="avatar' + (o.group ? ' group' : '') + (e.avatar ? ' has-img' : '') + '" style="--s:' + size + 'px;--c1:' + e.c1 + ';--c2:' + e.c2 + '">' + inner + dot + (o.extra || '') + '</span>';
  }
  function entity(c) {
    if (c.type === 'direct') { var p = person(c.with); return { name: p.name, c1: p.c1, c2: p.c2, avatar: p.avatar, status: p.status, group: false }; }
    return { name: c.name, c1: c.c1, c2: c.c2, avatar: c.avatar || null, status: null, group: true, letter: groupLetter(c.name) };
  }
  function avatarFor(c, size, dot) { var e = entity(c); return avatar(e, size, { group: e.group, letter: e.letter, dot: dot }); }

  var PALETTES = [
    ['#FFC9A8', '#F06BA8', '#FFF3D6', '#7C5CFA', '#4B3AB8'],
    ['#BFD4FF', '#B58CFF', '#FFFFFF', '#6E7BFF', '#3B3FA8'],
    ['#FFD9B0', '#F2A07B', '#FFF6E0', '#E0549F', '#8B3A96'],
    ['#C9F0E3', '#7FD6C0', '#FFFFFF', '#3FBF8F', '#2B7F8F'],
    ['#E3D4FF', '#F9B7D6', '#FFFFFF', '#B58CFF', '#7C5CFA'],
    ['#FFE0C2', '#B58CFF', '#FFF8E8', '#5B8DEF', '#3A3E8F']
  ];
  var sceneN = 0;
  function scene(seed, w, h) {
    var p = PALETTES[seed % PALETTES.length], id = 'sc' + (++sceneN);
    return '<svg class="scene" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Placeholder photo">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p[0] + '"/><stop offset="1" stop-color="' + p[1] + '"/></linearGradient></defs>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#' + id + ')"/>' +
      '<circle cx="' + w * 0.7 + '" cy="' + h * 0.38 + '" r="' + h * 0.14 + '" fill="' + p[2] + '" opacity="0.9"/>' +
      '<path d="M0 ' + h * 0.72 + ' Q ' + w * 0.25 + ' ' + h * 0.5 + ' ' + w * 0.5 + ' ' + h * 0.68 + ' T ' + w + ' ' + h * 0.6 + ' V ' + h + ' H0Z" fill="' + p[3] + '"/>' +
      '<path d="M0 ' + h * 0.86 + ' Q ' + w * 0.3 + ' ' + h * 0.66 + ' ' + w * 0.62 + ' ' + h * 0.84 + ' T ' + w + ' ' + h * 0.78 + ' V ' + h + ' H0Z" fill="' + p[4] + '"/></svg>';
  }

  /* ---------- State ---------- */
  var state = {
    screen: 'app', convId: 'hangar', filter: 'all', query: '', messages: [], replyTo: null,
    detailsOpen: window.innerWidth >= 1180,
    acc: { members: true, media: true, files: false, links: false },
    popover: null, settings: false, conversations: [],
    setTab: 'profile', dev: { mic: +store.get('dev.mic', 0), spk: +store.get('dev.spk', 0), cam: +store.get('dev.cam', 0) },
    vol: { inp: +store.get('vol.inp', 80), out: +store.get('vol.out', 70) }, profileMode: store.get('profileMode', 'voice'),
    mirror: store.get('mirror', 'on') === 'on', ptt: store.get('ptt', 'off') === 'on', pttKey: store.get('pttKey', 'V'), pttListening: false, micTest: false,
    alerts: store.get('alerts', 'on') === 'on', autoAway: store.get('autoAway', 'on') === 'on',
    editing: null, stageKey: null, stageBig: false, pip: null, seenStreams: {},
    theme: store.get('theme', 'auto'), palette: store.get('palette', 'vibrant'), draft: null, sounds: store.get('sounds', 'on') === 'on',
    seen: {}, callWasJoined: false, sharingWas: null, callTimer: null
  };

  /* ---------- Sound: soft synthesised chimes ---------- */
  var audioCtx = null;
  function tone(freq, start, dur, vol) {
    var o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + start;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  /* Owner-only experiment: try your own sound files for each event. Kept on this computer only. */
  var SFX_EVENTS = [['message', 'New message'], ['mention', 'Someone mentions you'], ['send', 'You send a message'], ['join', 'Joined, or something good happened'], ['leave', 'Left, or went offline'], ['ring', 'Incoming call'], ['declined', 'Call declined'], ['poke', 'Poke'], ['confetti', 'Confetti'], ['fireworks', 'Fireworks'], ['hearts', 'Hearts']];
  function sfxMap() { try { return JSON.parse(localStorage.getItem('concorde.sfx') || '{}') || {}; } catch (e) { return {}; } }
  function sfxSave(m) { try { localStorage.setItem('concorde.sfx', JSON.stringify(m)); return true; } catch (e) { return false; } }
  var sfxPlaying = {};
  function playOverride(kind, o) {
    try { if (sfxPlaying[kind]) sfxPlaying[kind].pause(); var a = new Audio(o.d); a.volume = 0.7; sfxPlaying[kind] = a; a.play().catch(function () {}); } catch (e) { /* ignore */ }
  }
  function chime(kind) {
    if (!state.sounds || quiet()) return;
    var ov = sfxMap()[kind]; if (ov && ov.d) { playOverride(kind, ov); return; }
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (kind === 'join') { tone(523.25, 0, 0.35, 0.07); tone(783.99, 0.11, 0.5, 0.06); }
      if (kind === 'leave') { tone(659.25, 0, 0.3, 0.06); tone(440, 0.11, 0.45, 0.05); }
      if (kind === 'message') { tone(880, 0, 0.4, 0.05); tone(1174.66, 0.08, 0.4, 0.035); }
      if (kind === 'send') { tone(660, 0, 0.22, 0.04); }
      if (kind === 'mention') { tone(987.77, 0, 0.3, 0.085); tone(1318.5, 0.13, 0.3, 0.08); tone(1760, 0.26, 0.7, 0.07); }
      if (kind === 'poke') { tone(392, 0, 0.14, 0.09); tone(523.25, 0.1, 0.14, 0.09); tone(329.63, 0.22, 0.45, 0.08); }
      if (kind === 'ring') { tone(784, 0, 0.4, 0.055); tone(987.77, 0.16, 0.4, 0.05); tone(1318.5, 0.32, 0.7, 0.04); }
      if (kind === 'declined') { tone(523.25, 0, 0.35, 0.05); tone(392, 0.16, 0.6, 0.045); }
    } catch (e) { /* audio unavailable */ }
  }

  function toast(text) {
    var stack = overlay.querySelector('.toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; overlay.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    stack.appendChild(t);
    while (stack.children.length > 2) stack.firstChild.remove();
    setTimeout(function () { t.remove(); }, 2400);
  }

  /* ---------- Version badge and theme ---------- */
  function renderVersion() {
    var v = C.version, d = new Date(v.date + 'T12:00:00');
    var label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    var el = $('#version-badge');
    el.textContent = 'v' + v.number + ' · ' + label;
    el.title = 'Concorde prototype build';
  }
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyPalette() { document.documentElement.setAttribute('data-palette', state.palette); }
  var PALS = [['vibrant', 'Vibrant', 'Full colour, as designed'], ['soft', 'Soft', 'Gentler, dustier tones'], ['muted', 'Muted', 'Quiet, nearly neutral']];
  function paletteChoice() {
    return '<div class="pal-row" role="group" aria-label="Colour">' + PALS.map(function (p) {
      return '<button type="button" class="pal" data-action="palette" data-value="' + p[0] + '" data-pal="' + p[0] + '" aria-pressed="' + (state.palette === p[0]) + '"><span class="pal-sw"><i></i><i></i><i></i></span><b>' + p[1] + '</b><small>' + p[2] + '</small></button>';
    }).join('') + '</div>';
  }
  function applyTheme() {
    var t = state.theme === 'auto' ? (darkQuery && darkQuery.matches ? 'dark' : 'light') : state.theme;
    document.documentElement.setAttribute('data-theme', t);
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', function () { if (state.theme === 'auto') applyTheme(); });
  /* Light, Dark or Auto (follows the computer). Used on the sign-in card and in Settings. */
  function themeSwitch(cls) {
    return '<div class="segments ' + (cls || '') + '" role="group" aria-label="Theme">' + [['auto', 'monitor', 'Auto'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(function (t) {
      return '<button type="button" data-action="theme" data-value="' + t[0] + '" aria-pressed="' + (state.theme === t[0]) + '">' + ico(t[1], 'sm') + ' ' + t[2] + '</button>';
    }).join('') + '</div>';
  }

  /* ---------- Sign-in (boarding pass) ---------- */
  function renderSignIn() {
    state.popover = null;
    var st = state.signin = state.signin || { step: 'email', email: '' }, step = st.step, h, lead, fields, btn, foot = '';
    if (step === 'email') {
      h = 'Welcome aboard'; lead = 'Enter your email and we will send you a code to sign in.';
      fields = '<label for="si-email">Email<span class="field"><input id="si-email" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email" value="' + esc(st.email) + '"></span></label>';
      btn = ico('plane', 'sm') + 'Send my code';
      foot = 'This is a preview. Any email works. Include “new” in it to see the new-person steps.';
    } else if (step === 'code') {
      h = 'Check your email'; lead = 'We sent a 6-digit code to ' + esc(st.email) + '. It can take a minute to arrive.';
      fields = '<label for="si-otp">Your code<span class="field"><input id="si-otp" class="code otp" type="text" inputmode="numeric" maxlength="9" placeholder="000 000" autocomplete="one-time-code"></span></label>';
      btn = ico('plane', 'sm') + 'Continue';
      foot = '<button type="button" class="link-btn" data-action="si-resend">Send a new code</button> · <button type="button" class="link-btn" data-action="si-back">Use a different email</button><br>This is a preview. Any 6 digits work; 000000 shows the error.';
    } else {
      h = 'One more thing'; lead = 'You are new here. Choose a name and enter the invite code your friends sent you.';
      fields = '<label for="si-name">Your name<span class="field"><input id="si-name" type="text" placeholder="How friends will see you" autocomplete="off"></span></label>' +
        '<label for="si-code">Invite code<span class="field"><input id="si-code" class="code" type="text" placeholder="CNC-2026" autocomplete="off"></span></label>';
      btn = ico('plane', 'sm') + 'Board';
      foot = '<button type="button" class="link-btn" data-action="si-back">Start again</button><br>This is a preview. Leave the code empty, or type WRONG, to see the errors.';
    }
    root.innerHTML =
      '<div class="signin"><div class="pass">' +
      '<form class="pass-main" id="signin-form" autocomplete="off" novalidate>' +
      '<div class="brand"><span class="brand-mark">' + ico('plane', 'lg') + '</span><span class="brand-name">Concorde</span></div>' +
      '<div class="pass-head"><h1>' + h + '</h1><p class="pass-lead">' + lead + '</p></div>' +
      '<div class="pass-form">' + fields +
      '<div class="pass-actions"><button class="btn-pill" type="submit" id="si-go">' + btn + '</button>' + themeSwitch('mini theme-seg') + '</div>' +
      '<p class="stub-text"><small>' + foot + '</small></p>' +
      '</div></form>' +
      '<aside class="pass-stub" aria-hidden="true"><span class="stub-plane">' + ico('plane') + '</span>' +
      '<p class="stub-text">Concorde<small>Private chat and calls for friends</small></p></aside>' +
      '</div></div>';
    var first = $(step === 'email' ? '#si-email' : step === 'code' ? '#si-otp' : '#si-name'); if (first) first.focus();
  }
  function siError(e, field) {
    var old = $('#si-error'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'si-error'; box.className = 'form-error'; box.setAttribute('role', 'alert');
    box.innerHTML = ico(e && e.code === 'offline' ? 'wifi-off' : 'triangle-alert', 'sm') + '<span>' + esc((e && e.message) || 'Something went wrong. Please try again.') + '</span>';
    $('.pass-actions').parentNode.insertBefore(box, $('.pass-actions'));
    var f = $(field); if (f) f.focus();
  }
  function siBusy(on, label) { var b = $('#si-go'); if (!b) return; b.disabled = on; if (on) { b.dataset.html = b.innerHTML; b.textContent = label; } else if (b.dataset.html) b.innerHTML = b.dataset.html; }
  function enterApp() {
    state.screen = 'app'; state.signin = null; mountApp();
    var list = state.conversations;
    openConversation(list.length ? list[0].id : null); chime('join');
  }

  /* ---------- Main shell ---------- */
  function mountApp() {
    var me = S.getCurrentUser();
    root.innerHTML =
      '<div class="shell' + (state.detailsOpen ? ' details-open' : '') + '" id="shell">' +
      '<aside class="card sidebar" aria-label="Conversations">' +
      '<div class="brand"><button type="button" class="brand-mark" id="brand-mark" tabindex="-1" aria-label="Concorde">' + ico('plane', 'lg') + '</button><span class="brand-name">Concorde</span>' +
      '<button class="btn-round accent" data-action="new-open" aria-label="New conversation">' + ico('plus') + '</button></div>' +
      '<label class="field" for="search">' + ico('search', 'sm') + '<input id="search" type="search" placeholder="Search everything" autocomplete="off"></label>' +
      '<div class="segments" role="group" aria-label="Show">' +
      '<button data-action="filter" data-value="all" aria-pressed="true">All</button>' +
      '<button data-action="filter" data-value="direct" aria-pressed="false">Direct</button>' +
      '<button data-action="filter" data-value="groups" aria-pressed="false">Groups</button></div>' +
      '<div class="chips" id="chips" role="group" aria-label="Search results type" hidden></div>' +
      '<nav class="conv-list" id="conv-list"></nav>' +
      '<div class="me-card" id="me-card"></div></aside>' +
      '<main class="card chat" aria-label="Conversation">' +
      '<header class="chat-head" id="chat-head"></header>' +
      '<div id="call-slot"></div>' +
      '<div class="messages" id="messages" aria-live="polite"></div>' +
      '<div class="composer-wrap">' +
      '<div id="reply-slot"></div><div id="draft-slot"></div>' +
      '<div class="composer">' +
      '<button class="btn-round" data-action="attach-open" aria-label="Add a file or photo">' + ico('plus') + '</button>' +
      '<div class="field"><input id="composer-input" type="text" placeholder="Write a message" autocomplete="off" aria-label="Message">' +
      '<button class="btn-round" data-action="emoji-open" aria-label="Emoji">' + ico('smile') + '</button>' +
      '<button class="btn-round" data-action="gif-open" aria-label="GIF" style="font-size:11px;font-weight:800">GIF</button></div>' +
      '<button class="btn-round lg accent" data-action="send" aria-label="Send message">' + ico('send') + '</button></div>' +
      '<div id="popover-slot"></div>' +
      '<input id="file-image" type="file" accept="image/*" multiple hidden><input id="file-any" type="file" hidden>' +
      '</div></main>' +
      '<aside class="card details" id="details" aria-label="Conversation details"></aside></div>';
    renderMe(); renderList(); renderHead(); renderCall(); renderDetails();
  }

  function renderMe() {
    var me = S.getCurrentUser();
    $('#me-card').innerHTML = '<button class="me-btn" data-action="status-open" aria-haspopup="menu" aria-label="Your status: ' + statusText(me.status) + '. Change status">' + avatar(me, 44, { dot: true }) +
      '<span class="who"><b>' + esc(me.name) + '</b><span>' + statusLine(me) + '</span></span></button>' +
      '<button class="btn-round sm" data-action="settings-open" aria-label="Settings">' + ico('settings') + '</button>';
  }

  /* ---------- Search: type chips, then results grouped by kind ---------- */
  var SKINDS = [['chat', 'users', 'Chats'], ['message', 'message-circle', 'Messages'], ['photo', 'image', 'Photos'], ['file', 'file-text', 'Files'], ['link', 'link-2', 'Links']];
  state.sf = 'all'; state.sres = []; state.sTok = 0;
  function shortDay(d) { return d === 0 ? 'Today' : d === -1 ? 'Yesterday' : new Date(2026, 10, 5 + d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function hl(text, q, around) {
    text = String(text || ''); var i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return esc(text.length > 90 ? text.slice(0, 90) + '…' : text);
    var from = around ? Math.max(0, i - 28) : 0, to = Math.min(text.length, i + q.length + 60);
    return (from > 0 ? '…' : '') + esc(text.slice(from, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, to)) + (to < text.length ? '…' : '');
  }
  function hitHTML(r, q) {
    var conv = state.conversations.filter(function (c) { return c.id === r.conversationId; })[0];
    var lead, title, sub = '', time = '';
    if (r.kind === 'chat') { lead = avatarFor(conv, 40, false); title = hl(r.title, q); sub = esc(r.text); }
    else {
      var who = r.from === 'you' ? 'You' : person(r.from).name;
      time = esc(r.d === 0 ? r.time : shortDay(r.d));
      if (r.kind === 'photo') {
        var t = r.thumb || {}, pic = t.image ? '<img src="' + esc(t.image) + '" alt="">' : scene(t.scene || 0, 80, 80);
        lead = '<span class="hit-ico thumb">' + pic + (r.count > 1 ? '<em>' + r.count + '</em>' : '') + '</span>'; title = r.title ? hl(r.title, q) : (r.count > 1 ? r.count + ' photos' : 'Photo'); sub = r.text ? hl(r.text, q) : esc(who);
      } else if (r.kind === 'message') { lead = '<span class="hit-ico">' + ico('message-circle', 'sm') + '</span>'; title = esc(who); sub = hl(r.text, q, true); }
      else { lead = '<span class="hit-ico">' + ico(r.kind === 'file' ? 'file-text' : 'link-2', 'sm') + '</span>'; title = hl(r.title, q); sub = esc(who) + ' · ' + hl(r.text, q); }
      sub += '<span class="hit-in">in ' + esc(r.convName) + '</span>';
    }
    return '<button class="hit" data-action="search-go" data-conv="' + r.conversationId + '" data-msg="' + (r.messageId || '') + '">' + lead +
      '<span class="hit-main"><span class="hit-top"><b>' + title + '</b><i>' + time + '</i></span><span class="hit-text">' + sub + '</span></span></button>';
  }
  function paintSearch(q) {
    var res = state.sres, counts = {};
    SKINDS.forEach(function (k) { counts[k[0]] = res.filter(function (r) { return r.kind === k[0]; }).length; });
    $('#chips').innerHTML = '<button data-action="search-filter" data-k="all" aria-pressed="' + (state.sf === 'all') + '">All<b>' + res.length + '</b></button>' + SKINDS.map(function (k) {
      return '<button data-action="search-filter" data-k="' + k[0] + '" aria-pressed="' + (state.sf === k[0]) + '"' + (counts[k[0]] ? '' : ' class="none"') + '>' + ico(k[1], 'sm') + k[2] + '<b>' + counts[k[0]] + '</b></button>';
    }).join('');
    var html = '';
    SKINDS.forEach(function (k) {
      if (state.sf !== 'all' && state.sf !== k[0]) return;
      var list = res.filter(function (r) { return r.kind === k[0]; }); if (!list.length) return;
      var shown = state.sf === 'all' ? list.slice(0, 4) : list;
      html += '<div class="conv-section">' + ico(k[1], 'sm') + k[2] + '</div>' + shown.map(function (r) { return hitHTML(r, q); }).join('');
      if (shown.length < list.length) html += '<button class="more-hits" data-action="search-filter" data-k="' + k[0] + '">Show all ' + list.length + ' ' + k[2].toLowerCase() + '</button>';
    });
    if (!html) html = '<div class="search-empty">' + ico('search') + '<b>Nothing found for \u201C' + esc(q) + '\u201D</b><span>Try a name, a word from a message, or a file name.</span></div>';
    $('#conv-list').innerHTML = html;
  }
  function renderList() {
    var searching = !!state.query.trim();
    var seg = document.querySelector('.segments[aria-label="Show"]'), chips = $('#chips');
    if (seg) seg.hidden = searching; if (chips) chips.hidden = !searching;
    if (searching) {
      var q = state.query.trim(), tok = ++state.sTok;
      S.search(q).then(function (res) { if (tok !== state.sTok) return; state.sres = res; paintSearch(q); });
      return;
    }
    state.sTok++;
    var q = state.query.trim().toLowerCase();
    var visible = state.conversations.filter(function (c) {
      var okType = state.filter === 'all' || (state.filter === 'direct' && c.type === 'direct') || (state.filter === 'groups' && c.type === 'group');
      return okType && (!q || entity(c).name.toLowerCase().indexOf(q) !== -1);
    });
    function item(c) {
      var e = entity(c), pv = S.getPreview(c.id), call = S.getCall(c.id);
      var prefix = pv.from === 'you' ? 'You: ' : (c.type === 'group' && pv.from ? person(pv.from).name + ': ' : '');
      var chip = call && call.participants.length
        ? '<span class="live-chip"><span class="bars"><i></i><i></i><i></i></span>' + call.participants.length + ' in call</span>' : '';
      return '<button class="conv' + (c.id === state.convId ? ' active' : '') + (c.muted ? ' muted' : '') + '" data-action="select-conv" data-id="' + c.id + '">' +
        avatarFor(c, 46, true) +
        '<span class="conv-main"><span class="conv-top"><span class="conv-name">' + esc(e.name) + '</span>' +
        (c.pinned ? '<span class="conv-flag" title="Pinned">' + ico('pin', 'sm') + '</span>' : '') + (c.muted ? '<span class="conv-flag" title="Muted">' + ico('bell-off', 'sm') + '</span>' : '') +
        '<span class="conv-time">' + esc(pv.time) + '</span></span>' +
        '<span class="conv-bottom"><span class="conv-preview">' + esc(prefix + pv.text) + '</span>' +
        (c.mention ? '<span class="badge at" title="You were mentioned" aria-label="You were mentioned">@</span>' : '') + (c.unread ? '<span class="badge' + (c.muted ? ' grey' : '') + '">' + c.unread + '</span>' : '') + '</span>' + chip + '</span></button>';
    }
    var pinned = visible.filter(function (c) { return c.pinned; });
    var rest = visible.filter(function (c) { return !c.pinned; });
    var groups = rest.filter(function (c) { return c.type === 'group'; });
    var directs = rest.filter(function (c) { return c.type === 'direct'; });
    var html = '';
    if (pinned.length) html += '<div class="conv-section">' + ico('pin', 'sm') + 'Pinned</div>' + pinned.map(item).join('');
    if (groups.length) html += '<div class="conv-section">Groups</div>' + groups.map(item).join('');
    if (directs.length) html += '<div class="conv-section">Direct messages</div>' + directs.map(item).join('');
    var sh0 = $('#shell'); if (sh0) sh0.classList.toggle('empty-world', !state.conversations.length);
    if (!html && !state.conversations.length) html = '<div class="list-empty">' + ico('plane') + '<b>No chats yet</b><span>Friends you chat with will show up here.</span><button class="btn-pill quiet" data-action="new-open">' + ico('plus', 'sm') + 'Start a chat</button></div>';
    else if (!html) html = '<p class="empty">No conversations match "' + esc(state.query) + '". Try another name.</p>';
    $('#conv-list').innerHTML = html;
  }

  function currentConv() { return state.conversations.filter(function (c) { return c.id === state.convId; })[0]; }

  function renderHead() {
    if (!currentConv()) return;
    var c = currentConv(), e = entity(c), call = S.getCall(c.id), right = '';
    var sub;
    if (c.type === 'direct') sub = person(c.with).note || statusText(person(c.with).status);
    else {
      var online = c.members.filter(function (m) { return person(m).status === 'online'; }).length;
      sub = c.members.length + ' members · ' + online + ' online';
    }
    if (c.type === 'group') {
      if (call && call.joined) right = '';
      else if (call && call.participants.length) {
        right = '<span class="call-join"><span class="stack">' +
          call.participants.slice(0, 3).map(function (p) { return avatar(person(p), 28); }).join('') + '</span>' +
          call.participants.length + ' in call' +
          '<button class="btn-pill" data-action="join-call">' + ico('headphones', 'sm') + 'Join</button></span>';
      } else {
        right = '<button class="btn-pill quiet" data-action="start-call">' + ico('headphones', 'sm') + 'Start call</button>';
      }
    }
    var title = '<div class="chat-title"><div class="title-line"><h1>' + esc(e.name) + '</h1>' +
      (c.type === 'group' ? '<button class="icon-edit" data-action="edit-group" aria-label="Rename group or change its picture" title="Rename group or change picture">' + ico('pencil', 'sm') + '</button>' : '') +
      '</div><p>' + esc(sub) + '</p></div>';
    if (c.type === 'direct') {
      var busy = !!S.getRing() || !!(call && call.joined), dis = busy ? ' disabled' : '';
      title = '<div class="title-wrap">' + title + '<div class="head-calls">' +
        '<button class="btn-round sm" data-action="call-audio"' + dis + ' aria-label="Voice call ' + esc(e.name) + '" title="Voice call">' + ico('phone', 'sm') + '</button>' +
        '<button class="btn-round sm" data-action="call-video"' + dis + ' aria-label="Video call ' + esc(e.name) + '" title="Video call">' + ico('video', 'sm') + '</button></div></div>';
    }
    var tools = '<div class="head-tools"><button class="btn-round sm" data-action="toggle-pin" aria-pressed="' + !!c.pinned + '" aria-label="' + (c.pinned ? 'Unpin chat' : 'Pin chat') + '" title="' + (c.pinned ? 'Unpin chat' : 'Pin chat to the top') + '">' + ico(c.pinned ? 'pin-off' : 'pin', 'sm') + '</button>' +
      '<button class="btn-round sm" data-action="toggle-mute-chat" aria-pressed="' + !!c.muted + '" aria-label="' + (c.muted ? 'Unmute chat' : 'Mute chat') + '" title="' + (c.muted ? 'Unmute chat' : 'Mute chat') + '">' + ico(c.muted ? 'bell-off' : 'bell', 'sm') + '</button></div>';
    $('#chat-head').innerHTML = avatarFor(c, 50, c.type === 'direct') +
      title + right + tools +
      '<button class="btn-round sm" data-action="toggle-details" aria-pressed="' + state.detailsOpen + '" aria-label="Show details">' + ico('panel-right') + '</button>';
  }

  /* ---------- Ringing (calls between two people) ---------- */
  var ringEl = null, ringShownFor = null, ringTone = null;
  function stopRingtone() { clearInterval(ringTone); ringTone = null; }
  function renderRing() {
    var r = S.getRing();
    if (!r) { stopRingtone(); ringShownFor = null; if (ringEl) { var gone = ringEl; ringEl = null; gone.classList.add('leaving'); setTimeout(function () { gone.remove(); }, 220); } renderHead(); return; }
    var them = person(r.personId), me = S.getCurrentUser(), out = r.direction === 'out', declined = r.status === 'declined' || r.status === 'dnd';
    var left = out ? me : them, right = out ? them : me;
    var kindWord = r.kind === 'video' ? 'video call' : 'voice call';
    var title = r.status === 'dnd' ? esc(them.name) + ' is on Do not disturb' : declined ? esc(them.name) + ' declined the call' : out ? 'Calling ' + esc(them.name) + '…' : esc(them.name) + ' is calling…';
    var sub = r.status === 'dnd' ? 'Their phone did not ring. They will see a missed call.' : declined ? 'Maybe try again in a moment' : (out ? 'Ringing · ' : 'Incoming ') + kindWord;
    var actions = declined
      ? '<button class="btn-pill quiet" data-action="ring-dismiss">Close</button>'
      : out ? '<button class="btn-pill leave" data-action="ring-end">' + ico('phone-off') + 'Cancel</button>'
      : '<button class="btn-pill quiet" data-action="ring-end">' + ico('phone-off', 'sm') + 'Decline</button><button class="btn-pill go" data-action="ring-answer">' + ico(r.kind === 'video' ? 'video' : 'phone', 'sm') + 'Answer</button>';
    var html = '<div class="ring-title"><span class="ring-kind">' + ico(r.kind === 'video' ? 'video' : 'phone', 'sm') + '</span><div><b>' + title + '</b><span>' + sub + '</span></div></div>' +
      '<div class="ring-stage"><div class="ring-end' + (out ? '' : ' caller') + '">' + avatar(left, 76) + '<span class="pt-name">' + (left === me ? 'You' : esc(left.name)) + '</span></div>' +
      '<div class="ring-line" aria-hidden="true"><i class="dots"></i>' + (declined ? '' : '<span class="ring-plane">' + ico('plane') + '</span>') + '</div>' +
      '<div class="ring-end target">' + avatar(right, 76) + '<span class="pt-name">' + (right === me ? 'You' : esc(right.name)) + '</span></div></div>' +
      '<div class="ring-actions">' + actions + '</div>';
    var fresh = !ringEl, key = r.conversationId + r.direction;
    if (!ringEl) { ringEl = document.createElement('section'); overlay.appendChild(ringEl); }
    ringEl.className = 'ring-box' + (declined ? ' declined' : '') + (fresh || ringShownFor !== key ? ' enter' : '');
    ringEl.setAttribute('role', 'alertdialog'); ringEl.setAttribute('aria-label', title + ' ' + sub);
    ringEl.innerHTML = html; ringShownFor = key;
    var ans = ringEl.querySelector('.go, .leave, .quiet'); if (ans && fresh && !out) ans.blur();
    stopRingtone();
    if (declined) chime('declined');
    else { chime('ring'); ringTone = setInterval(function () { chime('ring'); }, 2600); }
    renderHead();
  }

  /* ---------- Call panel ---------- */
  function callClock(call) {
    var s = Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function skey(s) { return s.kind + ':' + s.id; }
  function callSig(c) { return [c.conversationId, c.participants.join(','), c.muted, (c.streams || []).map(skey).join(','), state.stageKey, state.stageBig, state.mirror, state.theme].join('|'); }
  /* When only the active speaker changes, move the highlight without rebuilding the panel, so the pulse stays smooth. */
  function updateSpeaking(call) {
    document.querySelectorAll('#call-slot [data-person]').forEach(function (el) {
      var id = el.dataset.person;
      el.classList.toggle('speaking', call.speakingId === id && !(id === 'you' && call.muted));
    });
  }
  /* Placeholder pictures for camera and screen feeds. */
  function camArt(p, mine) {
    return '<div class="cam-art' + (mine && state.mirror ? ' mirror' : '') + '" style="--c1:' + p.c1 + ';--c2:' + p.c2 + '"><span class="cam-blob"></span><span class="cam-face">' + esc(initial(p.name)) + '</span></div>';
  }
  function screenArt() {
    return '<div class="fake-screen big"><div class="side"><b></b><b></b><b></b><b></b><b></b></div><div class="main"><b></b><b></b><b></b><b></b><b></b><b></b><b></b></div></div>';
  }
  function streamArt(s) { return s.kind === 'screen' ? screenArt() : camArt(person(s.id), s.id === 'you'); }
  function streamTag(s) {
    var n = s.id === 'you' ? 'You' : person(s.id).name;
    return '<span class="stage-tag">' + ico(s.kind === 'screen' ? 'monitor' : 'video', 'sm') + esc(s.kind === 'screen' ? (s.id === 'you' ? "You're sharing" : n + ' is sharing') : n) + '</span>';
  }
  function bindPip() {
    var pip = $('#call-slot .pip'), st = $('#call-slot .stage'); if (!pip || !st) return;
    function place(x, y) { state.pip = { x: x, y: y }; pip.style.left = x + 'px'; pip.style.top = y + 'px'; pip.style.right = 'auto'; pip.style.bottom = 'auto'; }
    function clamp(x, y) { return [Math.max(8, Math.min(st.clientWidth - pip.offsetWidth - 8, x)), Math.max(8, Math.min(st.clientHeight - pip.offsetHeight - 8, y))]; }
    if (state.pip) { var c0 = clamp(state.pip.x, state.pip.y); place(c0[0], c0[1]); }
    var d = null;
    pip.addEventListener('pointerdown', function (e) { var r = pip.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; pip.setPointerCapture(e.pointerId); pip.classList.add('drag'); e.preventDefault(); });
    pip.addEventListener('pointermove', function (e) { if (!d) return; var sr = st.getBoundingClientRect(), c = clamp(e.clientX - sr.left - d.dx, e.clientY - sr.top - d.dy); place(c[0], c[1]); });
    function end() { d = null; pip.classList.remove('drag'); }
    pip.addEventListener('pointerup', end); pip.addEventListener('pointercancel', end);
    pip.addEventListener('keydown', function (e) {
      var k = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key]; if (!k) return;
      e.preventDefault(); var r = pip.getBoundingClientRect(), sr = st.getBoundingClientRect(), c = clamp(r.left - sr.left + k[0], r.top - sr.top + k[1]); place(c[0], c[1]);
    });
  }
  /* Live calls: swap the placeholder picture for the real camera or screen. The video elements are kept between redraws so they don't flicker. */
  var videoEls = {};
  function attachMedia() {
    if (!S.getStream) return;
    var used = {};
    document.querySelectorAll('#call-slot [data-kind]').forEach(function (box) {
      var id = box.dataset.person, kind = box.dataset.kind, key = kind + ':' + id, ms = S.getStream(id, kind);
      if (!ms) return;
      used[key] = true;
      var v = videoEls[key];
      if (!v || v.srcObject !== ms) {
        if (!v) { v = document.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true; videoEls[key] = v; }
        v.srcObject = ms; v.play().catch(function () {});
      }
      v.className = 'live-video ' + kind + (id === 'you' && kind === 'camera' && state.mirror ? ' mirror' : '');
      var art = box.querySelector('.cam-art, .fake-screen'); if (art) art.style.display = 'none';
      box.insertBefore(v, box.firstChild);
    });
    Object.keys(videoEls).forEach(function (k) { if (!used[k]) { videoEls[k].srcObject = null; delete videoEls[k]; } });
  }
  function renderCall() {
    if (!currentConv()) return;
    var slot = $('#call-slot'), call = S.getCall(state.convId);
    clearInterval(state.callTimer);
    if (!call || !call.joined) { slot.innerHTML = ''; attachMedia(); state.callWasJoined = false; state.stageKey = null; state.stageBig = false; state.pip = null; return; }
    var enter = !state.callWasJoined; state.callWasJoined = true;
    var streams = call.streams || [];
    /* First person to start streaming is on the big stage. Click a thumbnail to swap. */
    var stage = streams.filter(function (x) { return skey(x) === state.stageKey; })[0] || streams[0];
    var selfCam = streams.filter(function (x) { return x.id === 'you' && x.kind === 'camera'; })[0];
    var pip = selfCam && stage && stage !== selfCam ? selfCam : null;
    var thumbs = streams.filter(function (x) { return x !== stage && x !== pip; });
    var hasCam = !!selfCam, sharing = call.sharingId === 'you';
    var audioOnly = call.participants.filter(function (id) { return !streams.some(function (x) { return x.id === id; }); });
    function pt(id) {
      var p = person(id), muted = id === 'you' && call.muted;
      var extra = muted ? '<span class="pt-mute" title="Muted">' + ico('mic-off') + '</span>' : '';
      return '<div class="pt' + (call.speakingId === id && !muted ? ' speaking' : '') + '" data-person="' + id + '">' +
        avatar(p, 68, { extra: extra }) + '<span class="pt-name">' + (id === 'you' ? 'You' : esc(p.name)) + '</span></div>';
    }
    var pts = (stage ? audioOnly : call.participants).map(pt).join('');
    var stageHTML = '';
    if (stage) {
      var fresh = !state.seenStreams[skey(stage)]; state.seenStreams[skey(stage)] = true;
      stageHTML = '<div class="stage-col"><div class="stage' + (fresh ? ' enter' : '') + (call.speakingId === stage.id && !(stage.id === 'you' && call.muted) ? ' speaking' : '') + '" data-person="' + stage.id + '" data-kind="' + stage.kind + '">' + streamArt(stage) + streamTag(stage) +
        '<div class="stage-tools"><button class="btn-round sm" data-action="stage-big" aria-pressed="' + !!state.stageBig + '" aria-label="' + (state.stageBig ? 'Make the picture smaller' : 'Make the picture bigger') + '" title="' + (state.stageBig ? 'Smaller' : 'Bigger') + '">' + ico(state.stageBig ? 'minimize-2' : 'maximize-2', 'sm') + '</button>' +
        '<button class="btn-round sm" data-action="stage-full" aria-label="Full screen" title="Full screen (or double-click)">' + ico('maximize', 'sm') + '</button></div>' +
        (pip ? '<div class="pip' + (call.speakingId === 'you' && !call.muted ? ' speaking' : '') + '" data-person="you" data-kind="camera" tabindex="0" role="group" aria-label="Your camera. Drag or use arrow keys to move.">' + camArt(person('you'), true) + '<span class="stage-tag">You</span></div>' : '') +
        '</div>' +
        (thumbs.length ? '<div class="thumbs-row">' + thumbs.map(function (x) {
          return '<button class="thumb' + (call.speakingId === x.id ? ' speaking' : '') + '" data-action="stage-pick" data-key="' + skey(x) + '" data-person="' + x.id + '" data-kind="' + x.kind + '" aria-label="Show ' + esc(x.id === 'you' ? 'your' : person(x.id).name) + (x.kind === 'screen' ? ' screen' : ' camera') + ' on the big screen">' + streamArt(x) + streamTag(x) + '</button>';
        }).join('') + '</div>' : '') + '</div>';
    }
    slot.innerHTML =
      '<section class="call-panel' + (enter ? ' enter' : '') + (stage ? '' : ' solo') + (stage && state.stageBig ? ' big' : '') + '" aria-label="Call">' +
      '<div class="call-top"><span class="bars" style="color:var(--accent-a)"><i></i><i></i><i></i></span>In call<span class="time" id="call-time">' + callClock(call) + '</span></div>' +
      '<div class="call-stage' + (stage ? ' has-screen has-stage' : '') + '">' + stageHTML + '<div class="pt-row">' + pts + '</div></div>' +
      '<div class="call-controls">' +
      '<button class="btn-round lg" data-action="toggle-mute" aria-pressed="' + call.muted + '" aria-label="' + (call.muted ? 'Unmute microphone' : 'Mute microphone') + '">' + ico(call.muted ? 'mic-off' : 'mic', 'lg') + '</button>' +
      '<button class="btn-round lg share" data-action="toggle-camera" aria-pressed="' + hasCam + '" aria-label="' + (hasCam ? 'Turn camera off' : 'Turn camera on') + '" title="' + (hasCam ? 'Turn camera off' : 'Turn camera on') + '">' + ico(hasCam ? 'video' : 'video-off', 'lg') + '</button>' +
      '<button class="btn-round lg share" data-action="toggle-share" aria-pressed="' + sharing + '" aria-label="' + (sharing ? 'Stop sharing screen' : 'Share your screen') + '" title="' + (sharing ? 'Stop sharing' : 'Share your screen') + '">' + ico('monitor-up', 'lg') + '</button>' +
      '<button class="btn-round lg share" data-action="sb-open" aria-label="Soundboard" title="Soundboard">' + ico('volume-2', 'lg') + '</button>' +
      '<button class="btn-pill leave" data-action="leave-call">' + ico('phone-off') + 'Leave</button></div></section>';
    state.callSig = callSig(call);
    bindPip(); attachMedia();
    state.callTimer = setInterval(function () {
      var el = $('#call-time'), cl = S.getCall(state.convId);
      if (el && cl) el.textContent = callClock(cl);
    }, 1000);
  }

  /* ---------- Messages ---------- */
  function snippet(m) {
    if (m.deleted) return 'Message deleted';
    return m.type === 'image' ? (m.images && m.images.length > 1 ? m.images.length + ' photos' : 'Photo') : m.type === 'file' ? m.file.name : m.type === 'gif' ? 'GIF' : m.type === 'link' ? m.link.title : m.text;
  }
  /* @names inside messages become small chips. A mention of you (or @everyone) is highlighted more strongly. */
  function mentionize(raw) {
    var me = S.getCurrentUser().name, names = Object.keys(C.data.people).map(function (id) { return C.data.people[id].name; }).concat('everyone');
    var re = new RegExp('(^|\\W)@(' + names.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![\\w])', 'gi');
    return esc(raw).replace(re, function (_, pre, nm) {
      var hot = nm.toLowerCase() === me.toLowerCase() || nm.toLowerCase() === 'everyone';
      return pre + '<span class="mention' + (hot ? ' me' : '') + '">' + nm + '</span>';
    });
  }
  /* Custom emoji: :name: turns into the picture the owner uploaded. Unknown names stay as plain text. */
  function cemojiUrl(name) { var l = S.customEmoji ? S.customEmoji() : []; for (var i = 0; i < l.length; i++) if (l[i].name === name) return l[i].url; return null; }
  var UNI_EMOJI = /(?:[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:\uFE0F|\u20E3|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic})*)/gu;
  function emojify(html) {
    return html.replace(/:([a-z0-9_]{2,24}):/g, function (all, n) { var u = cemojiUrl(n); return u ? '<img class="cemoji" src="' + esc(u) + '" alt=":' + n + ':" title=":' + n + ':">' : all; })
      .replace(UNI_EMOJI, '<span class="em">$&</span>');
  }
  /* A message that is only emoji (up to 10) gets the big, bubble-less look. Returns how many, or 0. */
  function emojiOnlyCount(m) {
    if (!m || m.type !== 'text' || m.replyTo || m.deleted || !m.text || ytIdOf(m.text)) return 0;
    var n = 0, rest = String(m.text).replace(/:([a-z0-9_]{2,24}):/g, function (all, nm) { if (cemojiUrl(nm)) { n++; return ''; } return all; }).replace(UNI_EMOJI, function () { n++; return ''; });
    return rest.trim() === '' && n >= 1 && n <= 10 ? n : 0;
  }
  function emojiHtml(e) { var m = /^:([a-z0-9_]{2,24}):$/.exec(e); if (m) { var u = cemojiUrl(m[1]); if (u) return '<img class="cemoji" src="' + esc(u) + '" alt="' + e + '" title="' + e + '">'; } return '<span class="re">' + esc(e) + '</span>'; }
  /* Links become clickable (they open in your normal browser). noLinks keeps plain text, for banners. */
  function richText(t, noLinks) {
    t = String(t || ''); if (noLinks) return emojify(mentionize(t));
    var out = '', last = 0, m, re = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
    while ((m = re.exec(t))) {
      var url = m[0], trail = '';
      while (/[.,;:!?'"\]]$/.test(url) || (/\)$/.test(url) && url.split('(').length < url.split(')').length)) { trail = url.slice(-1) + trail; url = url.slice(0, -1); }
      out += emojify(mentionize(t.slice(last, m.index))) + '<a class="msg-link" href="' + esc(/^www\./i.test(url) ? 'https://' + url : url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' + esc(trail);
      last = m.index + m[0].length;
    }
    return out + emojify(mentionize(t.slice(last)));
  }
  /* YouTube links get a small player card under the message. Press play and the video loads in place. */
  function ytIdOf(t) {
    var m = /(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i.exec(String(t || ''));
    return m ? m[1] : null;
  }
  function ytCard(t) {
    var id = ytIdOf(t); if (!id) return '';
    return '<div class="yt-card" data-yt="' + id + '"><button class="yt-play" data-action="yt-play" aria-label="Play video"><img alt="" loading="lazy" src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg"><span class="yt-btn">' + ico('play') + '</span></button>' +
      '<a class="yt-open" href="https://www.youtube.com/watch?v=' + id + '" target="_blank" rel="noopener noreferrer">Open on YouTube</a></div>';
  }
  function imagesOf(m) { return m.images && m.images.length ? m.images : [{ scene: m.scene, image: m.image, name: m.name }]; }
  function msgContent(m) {
    var out = '', text = m.text ? '<span>' + richText(m.text) + '</span>' : '';
    if (m.type === 'text') return text + ytCard(m.text);
    if (m.type === 'image') {
      var list = imagesOf(m);
      function pic(it) { return it.image ? '<img class="scene" src="' + esc(it.image) + '" alt="' + esc(it.name || 'Shared photo') + '" style="aspect-ratio:3/2;object-fit:cover">' : scene(it.scene || 0, 300, 200); }
      var card;
      if (list.length > 1) {
        card = '<button class="img-stack n' + Math.min(3, list.length) + '" data-action="view-image" data-id="' + m.id + '" data-i="0" aria-label="View ' + list.length + ' photos">' +
          (list.length > 2 ? '<span class="layer l2">' + pic(list[2]) + '</span>' : '') + '<span class="layer l1">' + pic(list[1]) + '</span><span class="layer top">' + pic(list[0]) + '</span>' +
          '<span class="count">' + ico('image', 'sm') + list.length + ' photos</span></button>';
      } else card = '<button class="img-one" data-action="view-image" data-id="' + m.id + '" data-i="0" aria-label="View photo larger">' + pic(list[0]) + '</button>';
      return '<div class="media-card">' + card + '</div>' + (text ? '<p class="cap">' + text + '</p>' : '');
    }
    if (m.type === 'file') {
      return (text ? '<p class="cap">' + text + '</p>' : '') +
        '<div class="file-card"><span class="file-icon">' + ico('file-text') + '</span><span class="file-meta"><b>' + esc(m.file.name) + '</b><span>' + esc(m.file.size) + '</span></span>' +
        '<button class="btn-round sm" aria-label="Download ' + esc(m.file.name) + '" data-action="download" data-id="' + m.id + '">' + ico('download', 'sm') + '</button></div>';
    }
    if (m.type === 'link') {
      return (text ? '<p class="cap">' + text + '</p>' : '') +
        '<div class="link-card">' + scene(m.link.scene || 0, 120, 90) + '<span><b>' + esc(m.link.title) + '</b><span>' + ico('link-2', 'sm') + esc(m.link.domain) + '</span></span></div>';
    }
    if (m.type === 'gif') {
      var g = m.gif || {};
      if (g.url) return '<div class="gif-msg"><img class="gif-img" alt="' + esc(g.label || 'GIF') + '" loading="lazy" src="' + esc(g.url) + '" style="aspect-ratio:' + (g.w || 200) + '/' + (g.h || 200) + '"><em>GIF</em></div>' + (text ? '<p class="cap">' + text + '</p>' : '');
      return '<div class="gif-tile"><strong>' + esc(g.emoji || '✨') + '</strong><em>GIF</em></div>' + (text ? '<p class="cap">' + text + '</p>' : '');
    }
    return out;
  }
  /* Prototype "today" is Thu 5 Nov 2026. Messages carry d = days ago (0 today, -1 yesterday...). */
  function dayLabel(d) {
    if (d === 0) return 'Today';
    if (d === -1) return 'Yesterday';
    var t = new Date(2026, 10, 5 + d);
    return t.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  /* Day divider: a flat dotted line either side of the label. */
  function dayDivider(label) {
    var up = '<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="M0,14 L100,14" vector-effect="non-scaling-stroke"/></svg>';
    var down = '<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="M0,14 L100,14" vector-effect="non-scaling-stroke"/></svg>';
    return '<div class="day" role="separator"><span class="arc out">' + up + '</span><span class="day-label">' + ico('plane', 'sm') + label + '</span><span class="arc in">' + down + '</span></div>';
  }
  /* Typing indicators sit in the thread itself, one row per person, in the order they started typing. */
  state.typers = {};
  function typingRow(id, enter) {
    var p = person(id);
    return '<div class="msg typing-row' + (enter ? ' enter' : '') + '" data-typer="' + id + '" role="status" aria-label="' + esc(p.name) + ' is typing">' +
      '<span class="avatar-slot">' + avatar(p, 34) + '</span><div class="msg-body"><div class="bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div></div></div>';
  }
  function typingRows(enter) { return (state.typers[state.convId] || []).map(function (id) { return typingRow(id, enter); }).join(''); }
  function syncTyping(e) {
    var list = state.typers[e.conversationId] = state.typers[e.conversationId] || [], at = list.indexOf(e.personId);
    if (e.on && at === -1) list.push(e.personId);
    if (!e.on && at !== -1) list.splice(at, 1);
    if (e.conversationId !== state.convId) return;
    var box = $('#messages'); if (!box) return;
    var near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    var row = box.querySelector('[data-typer="' + e.personId + '"]');
    if (e.on && !row) box.insertAdjacentHTML('beforeend', typingRow(e.personId, true));
    if (!e.on && row) row.remove();
    if (near) box.scrollTop = box.scrollHeight;
  }
  function editBox(m) {
    return '<span class="edit-inline"><input id="edit-input" type="text" value="' + esc(m.text) + '" aria-label="Edit message" autocomplete="off">' +
      '<span class="edit-hint">Enter to save · Esc to cancel</span><span class="edit-btns"><button class="btn-pill quiet" data-action="edit-msg-cancel">Cancel</button><button class="btn-pill" data-action="edit-msg-save">Save</button></span></span>';
  }
  /* "Ben, Plushpants and you reacted" for the hover note on a reaction. */
  function reactWho(r) {
    var ids = r.who || []; if (!ids.length) return '';
    var names = ids.filter(function (w) { return w !== 'you'; }).map(function (w) { return (person(w) || {}).name || 'Someone'; });
    if (ids.indexOf('you') !== -1) names.push('you');
    if (names.length > 6) names = names.slice(0, 5).concat((names.length - 5) + ' others');
    var out = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return out.charAt(0).toUpperCase() + out.slice(1) + ' reacted';
  }

  /* A deleted message leaves a "Message deleted" note for an hour, then disappears (the server removes it for good too). */
  var DELETED_KEEP_MS = 60 * 60 * 1000;
  function expiredDeleted(m) { return !!(m.deleted && m.deletedAt && Date.now() - m.deletedAt > DELETED_KEEP_MS); }
  function visibleMessages() { var all = state.messages; var out = all.filter(function (m) { return !expiredDeleted(m); }); state.hiddenDeleted = all.length - out.length; return out; }
  setInterval(function () { if (state.screen === 'app' && currentConv() && state.messages.filter(expiredDeleted).length !== (state.hiddenDeleted || 0)) renderMessages(); }, 60000);
  function renderMessages(opts) {
    opts = opts || {};
    if (!currentConv()) return;
    var list = visibleMessages(), c = currentConv(), isGroup = c.type === 'group', html = '';
    if (state.loadError === c.id) {
      var offline = S.getConnection && !S.getConnection().online;
      $('#messages').innerHTML = '<div class="load-error" role="alert">' + ico('wifi-off') + '<b>Couldn’t load messages</b><span>' + (offline ? 'You look to be offline. They’ll load when you’re back.' : 'Something went wrong reaching the server. Your chat is safe.') + '</span><button class="btn-pill" data-action="retry-load">' + ico('refresh-cw', 'sm') + 'Try again</button></div>';
      return;
    }
    var lastDay = null;
    list.forEach(function (m, i) {
      var dd = m.d || 0;
      if (dd !== lastDay) { html += dayDivider(dayLabel(dd)); lastDay = dd; }
      var key = c.id + ':' + m.id, isNew = !state.seen[key] && !opts.initial;
      state.seen[key] = true;
      if (m.type === 'system') { html += '<div class="system">' + ico(m.icon || (/call/i.test(m.text) && !/joined/.test(m.text) ? 'phone' : 'headphones'), 'sm') + esc(m.text) + '</div>'; return; }
      var prev = list[i - 1], next = list[i + 1];
      var runStart = !prev || prev.from !== m.from || prev.type === 'system';
      var last = !next || next.from !== m.from || next.type === 'system';
      var me = m.from === 'you', p = person(m.from);
      var q = '';
      var hot = !me && m.text && S.mentionsYou(m.text), calm = '';
      if (hot) { state.mAt = state.mAt || {}; state.mAt[key] = state.mAt[key] || Date.now(); calm = Date.now() - state.mAt[key] > 15000 ? ' calm' : ''; }
      if (m.deleted) {
        html += '<div class="msg' + (me ? ' me' : '') + (runStart ? ' run-start' : '') + (last ? '' : ' not-last') + '" data-id="' + m.id + '" tabindex="0"><span class="avatar-slot">' + (last ? '<span class="pwrap" data-person="' + m.from + '">' + avatar(p, 34) + '</span>' : '') + '</span>' +
          '<div class="msg-body">' + (isGroup && !me && runStart ? '<span class="msg-name">' + esc(p.name) + '</span>' : '') + '<div class="bubble deleted"><span class="deleted-note">' + ico('trash-2', 'sm') + 'Message deleted</span></div>' + (last ? '<span class="stamp">' + esc(m.time) + '</span>' : '') + '</div></div>';
        return;
      }
      if (m.replyTo) {
        var o = list.filter(function (x) { return x.id === m.replyTo; })[0];
        if (o) q = '<button class="quote" data-action="jump" data-id="' + o.id + '"><b>' + (o.from === 'you' ? 'You' : esc(person(o.from).name)) + '</b><span>' + esc(snippet(o)) + '</span></button>';
      }
      var mediaOnly = (m.type === 'image' || m.type === 'gif') && !q && !m.text;
      var reacts = (m.reactions && m.reactions.length) ? '<div class="reactions">' + m.reactions.map(function (r) {
        var who = reactWho(r);
        return '<button class="react' + (r.mine ? ' mine' : '') + '"' + (who ? ' data-who="' + esc(who) + '" aria-label="' + esc(r.emoji + ' ' + r.count + '. ' + who) + '"' : '') + ' data-action="react-toggle" data-id="' + m.id + '" data-emoji="' + r.emoji + '" aria-pressed="' + r.mine + '">' + emojiHtml(r.emoji) + ' ' + r.count + '</button>';
      }).join('') + '</div>' : '';
      html += '<div class="msg' + (me ? ' me' : '') + (runStart ? ' run-start' : '') + (last ? '' : ' not-last') + (isNew ? ' enter' : '') + (hot ? ' mentions-me' + calm : '') + '" data-id="' + m.id + '" tabindex="0">' +
        '<div class="msg-actions"><button class="btn-round sm" data-action="reply" data-id="' + m.id + '" aria-label="Reply">' + ico('reply', 'sm') + '</button>' +
        '<button class="btn-round sm" data-action="react-open" data-id="' + m.id + '" aria-label="Add reaction">' + ico('smile', 'sm') + '</button>' +
        '<button class="btn-round sm" data-action="msg-more" data-id="' + m.id + '" aria-label="More actions" aria-haspopup="menu">' + ico('ellipsis', 'sm') + '</button></div>' +
        '<span class="avatar-slot">' + (last ? '<span class="pwrap" data-person="' + m.from + '">' + avatar(p, 34) + '</span>' : '') + '</span>' +
        '<div class="msg-body">' +
        (isGroup && !me && runStart ? '<span class="msg-name">' + esc(p.name) + '</span>' : '') +
        '<div class="bubble' + (m.failed ? ' failed' : '') + (mediaOnly ? ' media-only' : '') + (function () { var c = state.editing === m.id ? 0 : emojiOnlyCount(m); return c ? ' emoji-only ' + (c === 1 ? 'e1' : c <= 3 ? 'e2' : 'e4') : ''; })() + (state.editing === m.id ? ' editing' : '') + '">' + q + (state.editing === m.id ? editBox(m) : msgContent(m)) + '</div>' + reacts +
        (m.failed ? '<span class="stamp failed">' + ico('triangle-alert', 'sm') + 'Not sent <button class="link-btn" data-action="msg-retry" data-id="' + m.id + '">Try again</button> <button class="link-btn" data-action="msg-discard" data-id="' + m.id + '">Delete</button></span>' : last ? '<span class="stamp">' + esc(m.time) + '</span>' : '') + '</div></div>';
    });
    var box = $('#messages');
    if (list.every(function (m) { return m.type === 'system'; }) && !(state.typers[state.convId] || []).length) {
      var cc = currentConv(), ee = entity(cc);
      html += '<div class="empty-hello">' + ico('plane') + '<b>Say hello' + (cc.type === 'group' ? ' to ' + esc(ee.name) : ' to ' + esc(ee.name)) + '</b><span>Your first message will start the conversation.</span></div>';
    }
    box.innerHTML = html + typingRows(false);
    if (opts.scroll !== false) box.scrollTop = box.scrollHeight;
    var ei = $('#edit-input'); if (ei && !opts.noFocus) { ei.focus(); ei.setSelectionRange(ei.value.length, ei.value.length); }
  }

  function renderReply() {
    var slot = $('#reply-slot');
    if (!state.replyTo) { slot.innerHTML = ''; return; }
    var m = state.messages.filter(function (x) { return x.id === state.replyTo; })[0];
    if (!m) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<div class="reply-strip"><div><b>Replying to ' + (m.from === 'you' ? 'yourself' : esc(person(m.from).name)) + '</b><span>' + esc(snippet(m)) + '</span></div>' +
      '<button class="btn-round sm" data-action="cancel-reply" aria-label="Cancel reply">' + ico('x', 'sm') + '</button></div>';
  }

  /* ---------- Popovers ---------- */
  var EMOJI_SETS = [
    ['Smileys', ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','😊','🙂','😉','😍','🥰','😘','😋','😛','😜','🤪','🤔','🫡','🤨','😐','🙄','😏','😴','😮','😲','🥺','😢','😭','😤','😡','🤯','😱','🥳','😎','🤓','🥹','🫠','🤗','🤭','🫣','😬']],
    ['Hands', ['👍','👎','👏','🙌','🙏','🤝','💪','👋','🤙','✌️','🤞','🫶','👀','🫵','🤌','👌','✊','🖖','☝️','🤘']],
    ['Hearts & stars', ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💖','✨','⭐','🌟','💫','🔥','💯','💥','🎉','🎊','🏆']],
    ['Fun & things', ['🎮','🎧','🎬','🎵','🍕','🍔','🍟','☕','🍺','🍻','🎂','🚀','✈️','🚗','🏖️','☁️','🌙','☀️','🌈','⚡','💻','📱','📸','🎁','💡','🧠','👻','💀','🤖','🐶','🐱','🦄']]
  ];
  var EMOJI = EMOJI_SETS.reduce(function (a, g) { return a.concat(g[1]); }, []);
  /* GIF picker: trending to start, search as you type, more as you scroll. */
  var gifs = { q: '', lq: '', tab: '', manage: false, draft: null, items: [], next: null, busy: false, err: '', t: null, seq: 0 };
  function paintGifs() {
    var g = $('#gif-grid'); if (!g) return;
    if (gifs.err) { g.innerHTML = '<p class="gif-empty">' + esc(gifs.err) + '</p>'; return; }
    if (!gifs.items.length) { g.innerHTML = '<p class="gif-empty">' + (gifs.busy ? 'Loading\u2026' : 'No GIFs found. Try another word.') + '</p>'; return; }
    var cols = ['', ''];
    gifs.items.forEach(function (it, i) { cols[i % 2] += '<button data-action="gif-pick" data-i="' + i + '" aria-label="' + esc(it.title) + '" style="aspect-ratio:' + it.w + '/' + it.h + '"><img alt="" loading="lazy" src="' + esc(it.preview || it.url) + '"></button>'; });
    g.innerHTML = '<div class="gif-col">' + cols[0] + '</div><div class="gif-col">' + cols[1] + '</div>' + (gifs.busy ? '<p class="gif-more">Loading\u2026</p>' : '');
  }
  /* "Our GIFs": the library the owner fills. Same box, first tab. */
  function paintLib() {
    var g = $('#gif-grid'); if (!g) return;
    var q = gifs.lq.trim().toLowerCase(), owner = S.isOwner && S.isOwner();
    var items = (S.libraryGifs ? S.libraryGifs() : []).filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) !== -1; });
    if (!items.length) g.innerHTML = '<p class="gif-empty">' + (q ? 'Nothing matches.' : owner ? 'Nothing here yet. Add your first GIF below.' : 'No GIFs in the library yet.') + '</p>';
    else {
      var cols = ['', ''];
      items.forEach(function (it, i) { cols[i % 2] += '<span class="lib-item"><button data-action="lib-pick" data-id="' + it.id + '" aria-label="' + esc(it.name) + '" title="' + esc(it.name) + '" style="aspect-ratio:' + it.w + '/' + it.h + '"><img alt="" loading="lazy" src="' + esc(it.url) + '"></button>' + (owner && gifs.manage ? '<button class="cx" data-action="lib-remove" data-id="' + it.id + '" aria-label="Remove ' + esc(it.name) + '">×</button>' : '') + '</span>'; });
      g.innerHTML = '<div class="gif-col">' + cols[0] + '</div><div class="gif-col">' + cols[1] + '</div>';
    }
    var o = $('#gif-owner'); if (!o || !owner) return;
    var d = gifs.draft;
    o.innerHTML = d ? '<div class="emoji-add"><img class="lib-prev" src="' + esc(d.url) + '" alt=""><input id="lib-name" type="text" maxlength="40" value="' + esc(d.name) + '" aria-label="GIF name" autocomplete="off"><button class="btn sm" data-action="lib-save">Add</button><button class="btn sm ghost" data-action="lib-cancel">Cancel</button>' + (d.err ? '<span class="err">' + esc(d.err) + '</span>' : '') + '</div>'
      : '<div class="emoji-add"><button class="btn sm" data-action="lib-add">+ Add GIF</button>' + ((S.libraryGifs && S.libraryGifs().length) ? '<button class="btn sm ghost" data-action="lib-manage">' + (gifs.manage ? 'Done' : 'Remove…') + '</button>' : '') + '</div>';
  }
  function libAddFlow() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/gif,image/webp,image/png,image/jpeg';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () {
        var sug = (f.name || 'GIF').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40);
        gifs.draft = { file: f, url: url, name: sug || 'GIF', w: im.naturalWidth || 200, h: im.naturalHeight || 200, err: f.size > 3000000 ? 'That file is over 3 MB.' : '' }; paintLib();
        var n = $('#lib-name'); if (n) { n.focus(); n.select(); }
      };
      im.onerror = function () { toast('That file isn’t a picture I can read'); };
      im.src = url;
    };
    inp.click();
  }
  function libSave() {
    var d = gifs.draft, n = $('#lib-name'); if (!d) return; d.name = n ? n.value : d.name;
    S.addLibraryGif(d.name, d.file, d.w, d.h).then(function (r) {
      if (!r.ok) { d.err = r.error || 'Couldn’t add it'; paintLib(); return; }
      gifs.draft = null; toast('GIF added'); paintLib();
    });
  }
  function loadGifs(q, more) {
    q = String(q || '').trim();
    if (!more) { gifs.q = q; gifs.items = []; gifs.next = null; gifs.err = ''; }
    var seq = ++gifs.seq, off = more ? gifs.next : 0; gifs.busy = true; paintGifs();
    S.searchGifs(q, off || 0).then(function (r) {
      if (seq !== gifs.seq) return;
      gifs.items = gifs.items.concat(r.items || []); gifs.next = r.next == null ? null : r.next; gifs.busy = false; paintGifs();
    }).catch(function (e) {
      if (seq !== gifs.seq) return;
      gifs.busy = false; gifs.err = e && e.code === 'not_set_up' ? 'GIF search is not set up yet. Ask the owner to finish the GIPHY step.' : e && e.code === 'busy' ? 'GIF search is busy right now. Try again in a minute.' : 'Couldn’t load GIFs. Check your connection and try again.'; paintGifs();
    });
  }
  function renderPopover() {
    var slot = $('#popover-slot'), p = state.popover;
    if (!slot) return;
    if (!p) { slot.innerHTML = ''; return; }
    if (p.type === 'emoji') {
      slot.innerHTML = '<div class="popover emoji' + (state.emojiManage ? ' manage' : '') + '" role="dialog" aria-label="Emoji">' + customEmojiHTML('emoji-pick') + EMOJI_SETS.map(function (g) { return '<h4 class="emoji-h">' + g[0] + '</h4>' + g[1].map(function (e) { return '<button data-action="emoji-pick" data-emoji="' + e + '" aria-label="' + e + '">' + e + '</button>'; }).join(''); }).join('') + '</div>';
    } else if (p.type === 'gif') {
      if (!gifs.tab) gifs.tab = ((S.libraryGifs && S.libraryGifs().length) || (S.isOwner && S.isOwner())) ? 'lib' : 'giphy';
      var lib = gifs.tab === 'lib';
      slot.innerHTML = '<div class="popover gifs" role="dialog" aria-label="GIFs"><div class="gif-tabs" role="tablist"><button role="tab" data-action="gif-tab" data-tab="lib" aria-selected="' + lib + '">Our GIFs</button><button role="tab" data-action="gif-tab" data-tab="giphy" aria-selected="' + !lib + '">GIPHY</button></div>' +
        '<label class="field" for="gif-search">' + ico('search', 'sm') + '<input id="gif-search" type="search" placeholder="' + (lib ? 'Search our GIFs' : 'Search GIFs') + '" autocomplete="off" value="' + esc(lib ? gifs.lq : gifs.q) + '"></label>' +
        '<div class="gif-grid" id="gif-grid" aria-live="polite"></div>' + (lib ? '<div id="gif-owner"></div>' : '<p class="gif-note">Powered by GIPHY</p>') + '</div>';
      var gi = $('#gif-search'); gi.focus();
      if (lib) {
        gi.addEventListener('input', function () { gifs.lq = gi.value; paintLib(); });
        paintLib();
      } else {
        gi.addEventListener('input', function () { clearTimeout(gifs.t); gifs.t = setTimeout(function () { loadGifs(gi.value, false); }, 380); });
        $('#gif-grid').addEventListener('scroll', function (e) { var g = e.target; if (gifs.next != null && !gifs.busy && g.scrollTop + g.clientHeight > g.scrollHeight - 160) loadGifs(gifs.q, true); });
        if (gifs.items.length) paintGifs(); else loadGifs('', false);
      }
    } else if (p.type === 'attach') {
      slot.innerHTML = '<div class="popover attach" role="menu"><button data-action="attach-image" role="menuitem">' + ico('image') + 'Photo</button><button data-action="attach-file" role="menuitem">' + ico('paperclip') + 'File</button><button data-action="send-effect" data-effect="confetti" role="menuitem"><span class="fx-em">🎉</span>Confetti</button><button data-action="send-effect" data-effect="fireworks" role="menuitem"><span class="fx-em">🎆</span>Fireworks</button><button data-action="send-effect" data-effect="hearts" role="menuitem"><span class="fx-em">💖</span>Hearts</button></div>';
    } else if (p.type === 'new') {
      slot.innerHTML = '<div class="popover attach" style="left:auto;right:auto;bottom:auto;top:-540px;display:none"></div>';
    }
  }
  /* The "Custom" block at the top of the emoji picker. Only the owner sees Add and the little x. */
  function customEmojiHTML(action, id) {
    var list = S.customEmoji ? S.customEmoji() : [], owner = S.isOwner && S.isOwner(), h = '';
    if (!list.length && !owner) return '';
    h += '<h4 class="emoji-h">Custom</h4>';
    h += list.map(function (e) {
      var tok = ':' + e.name + ':';
      return '<span class="cemoji-btn"><button data-action="' + action + '"' + (id ? ' data-id="' + id + '"' : '') + ' data-emoji="' + tok + '" aria-label="' + tok + '" title="' + tok + '"><img src="' + esc(e.url) + '" alt="' + tok + '"></button>' +
        (owner && !id ? '<button class="cx" data-action="emoji-remove" data-name="' + e.name + '" aria-label="Remove ' + tok + '">×</button>' : '') + '</span>';
    }).join('');
    if (owner && !id && state.emojiDraft) { var d = state.emojiDraft; h += '<div class="emoji-add"><img class="cemoji big" src="' + esc(d.url) + '" alt=""><input id="emoji-name" type="text" maxlength="24" value="' + esc(d.name) + '" aria-label="Emoji name" autocomplete="off"><button class="btn sm" data-action="emoji-save">Add</button><button class="btn sm ghost" data-action="emoji-cancel">Cancel</button>' + (d.err ? '<span class="err">' + esc(d.err) + '</span>' : '') + '</div>'; }
    else if (owner && !id) h += '<div class="emoji-add"><button class="btn sm" data-action="emoji-add-open">+ Add emoji</button>' + (list.length ? '<button class="btn sm ghost" data-action="emoji-manage">' + (state.emojiManage ? 'Done' : 'Remove…') + '</button>' : '') + '</div>';
    return h;
  }
  function renderReactPopover(btn, id) {
    closePopovers();
    var r = btn.getBoundingClientRect(), pop = document.createElement('div');
    pop.className = 'popover react-pop'; pop.dataset.popover = 'react';
    pop.innerHTML = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🎆', '🔥', '👏', '🙏', '😍', '🤔', '👀'].map(function (e) {
      return '<button data-action="react-pick" data-id="' + id + '" data-emoji="' + e + '" aria-label="React ' + e + '">' + e + '</button>';
    }).join('') + (S.customEmoji ? S.customEmoji().map(function (e) { return '<button data-action="react-pick" data-id="' + id + '" data-emoji=":' + e.name + ':" aria-label="React :' + e.name + ':"><img class="cemoji" src="' + esc(e.url) + '" alt=""></button>'; }).join('') : '');
    pop.style.top = Math.max(12, r.top - 118) + 'px';
    pop.style.left = Math.max(12, Math.min(window.innerWidth - 290, r.left - 120)) + 'px';
    overlay.appendChild(pop);
  }
  /* ---------- Soundboard (calls only) ---------- */
  var sb = { manage: false, draft: null, at: 0, anchor: null, last: 0 };
  function toggleSoundboard(btn) {
    var ex = overlay.querySelector('.sb-pop'); if (ex) { ex.remove(); return; }
    closePopovers(); sb.anchor = btn; sb.manage = false; sb.draft = null; renderSbPop();
  }
  function renderSbPop() {
    var pop = overlay.querySelector('.sb-pop'), owner = S.isOwner && S.isOwner(), list = S.sounds ? S.sounds() : [];
    if (!pop) { if (!sb.anchor) return; pop = document.createElement('div'); pop.className = 'popover react-pop sb-pop'; pop.dataset.popover = 'react'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Soundboard'); overlay.appendChild(pop); }
    var h = '<h4 class="emoji-h">Soundboard · everyone in the call hears it</h4>';
    h += list.length ? '<div class="sb-grid">' + list.map(function (c) { return '<span class="sb-item"><button class="sb-clip" data-action="sb-play" data-id="' + c.id + '" aria-label="Play ' + esc(c.name) + '"><span class="sb-em">' + esc(c.emoji) + '</span><span class="sb-nm">' + esc(c.name) + '</span></button>' + (owner && sb.manage ? '<button class="cx" data-action="sb-remove" data-id="' + c.id + '" aria-label="Remove ' + esc(c.name) + '">×</button>' : '') + '</span>'; }).join('') + '</div>'
      : '<p class="gif-empty">' + (owner ? 'No sounds yet. Add one below, or manage them all in Settings → Library.' : 'No sounds yet. The owner can add some.') + '</p>';
    if (owner) {
      var d = sb.draft;
      h += d ? '<div class="emoji-add"><input id="sb-emoji" type="text" maxlength="4" value="' + esc(d.emoji) + '" aria-label="Emoji" style="width:44px;text-align:center"><input id="sb-name" type="text" maxlength="30" value="' + esc(d.name) + '" aria-label="Sound name" autocomplete="off"><button class="btn sm" data-action="sb-save">Add</button><button class="btn sm ghost" data-action="sb-cancel">Cancel</button>' + (d.err ? '<span class="err">' + esc(d.err) + '</span>' : '') + '</div>'
        : '<div class="emoji-add"><button class="btn sm" data-action="sb-add">+ Add sound</button>' + (list.length ? '<button class="btn sm ghost" data-action="sb-manage">' + (sb.manage ? 'Done' : 'Remove…') + '</button>' : '') + '</div>';
    }
    pop.innerHTML = h;
    var r = sb.anchor && sb.anchor.isConnected ? sb.anchor.getBoundingClientRect() : { top: window.innerHeight - 80, left: window.innerWidth / 2 };
    pop.style.left = Math.max(12, Math.min(window.innerWidth - 332, r.left - 130)) + 'px';
    pop.style.top = 'auto'; pop.style.bottom = Math.max(12, window.innerHeight - r.top + 10) + 'px';
  }
  var playing = [];
  function playUrl(url) {
    if (!url) return;
    playing.forEach(function (p) { if (p._url === url) p.pause(); }); playing = playing.filter(function (p) { return p._url !== url; });
    try { var a = new Audio(url); a._url = url; a.volume = 0.85; playing.push(a); a.onended = a.onerror = function () { playing = playing.filter(function (x) { return x !== a; }); }; a.play().catch(function () {}); if (playing.length > 4) { var o = playing.shift(); o.pause(); } } catch (e) {}
  }
  function clipById(id) { return (S.sounds ? S.sounds() : []).filter(function (c) { return c.id === id; })[0]; }
  function playClip(id) {
    var now = Date.now(); if (now - sb.last < 900) return; sb.last = now;
    var c = clipById(id); if (!c) return;
    playUrl(c.url); S.playSound(id);
  }
  S.on('sound', function (e) {
    var c = clipById(e.id); if (!c) return;
    playUrl(c.url);
    var who = e.from && C.data.people[e.from] ? C.data.people[e.from].name : 'Someone';
    toast(who + ': ' + c.emoji + ' ' + c.name);
  });
  S.on('library', function () { if (overlay.querySelector('.sb-pop')) renderSbPop(); if (state.popover && state.popover.type === 'gif' && gifs.tab === 'lib') paintLib(); });
  function sbAddFlow() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,audio/*';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var sug = (f.name || 'Sound').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 30), d = { file: f, name: sug || 'Sound', emoji: '🔊', err: '' };
      sb.draft = d; renderSbPop();
      var n = document.getElementById('sb-name'); if (n) { n.focus(); n.select(); }
      try { var a = new Audio(URL.createObjectURL(f)); a.onloadedmetadata = function () { if (a.duration > 12) { d.err = 'That’s ' + Math.round(a.duration) + ' seconds. Keep it to about 10.'; renderSbPop(); } }; } catch (e) {}
    };
    inp.click();
  }
  function sbSave() {
    var d = sb.draft; if (!d) return; var n = document.getElementById('sb-name'), em = document.getElementById('sb-emoji'); if (n) d.name = n.value; if (em) d.emoji = em.value || '🔊';
    S.addSound(d.name, d.emoji, d.file).then(function (r) {
      if (!r.ok) { d.err = r.error || 'Couldn’t add it'; renderSbPop(); return; }
      sb.draft = null; toast('Sound added'); renderSbPop();
    });
  }
  function closePopovers() {
    state.popover = null; renderPopover();
    var rp = overlay.querySelector('.react-pop'); if (rp) rp.remove();
  }

  /* ---------- Details panel ---------- */
  function acc(key, icon, title, count, body) {
    var open = state.acc[key];
    return '<section class="acc' + (open ? ' open' : '') + '"><button class="acc-head" data-action="acc-toggle" data-key="' + key + '" aria-expanded="' + open + '">' +
      '<span class="lead">' + ico(icon) + '</span>' + title + (count != null ? '<span class="count">' + count + '</span>' : '') + '<span class="chev">' + ico('chevron-down', 'sm') + '</span></button>' +
      '<div class="acc-body"><div class="acc-inner"><div class="acc-pad">' + body + '</div></div></div></section>';
  }
  function renderDetails() {
    if (!currentConv()) return;
    var c = currentConv(), e = entity(c), sh = S.getShared(c.id), html;
    var sub = c.type === 'direct' ? (person(c.with).note || statusText(person(c.with).status)) : c.members.length + ' members';
    html = '<div class="details-head">' + avatarFor(c, 92, false) + '<h2>' + esc(e.name) + '</h2><p>' + esc(sub) + '</p></div>';
    if (c.type === 'group') {
      html += acc('members', 'users', 'Members', c.members.length, c.members.map(function (id) {
        var p = person(id);
        return '<div class="member" data-person="' + id + '">' + avatar(p, 34, { dot: true }) + '<div><b>' + (id === 'you' ? esc(p.name) + ' (you)' : esc(p.name)) + '</b><span>' + statusLine(p) + '</span></div></div>';
      }).join('') + '<button class="btn-pill quiet leave-btn" data-action="add-people" data-id="' + c.id + '">' + ico('user-plus', 'sm') + 'Add people</button>' + '<button class="btn-pill quiet danger leave-btn" data-action="leave-group" data-id="' + c.id + '">' + ico('log-out', 'sm') + 'Leave group</button>' + (S.isOwner() ? '<button class="btn-pill quiet danger leave-btn" data-action="delete-group" data-id="' + c.id + '">' + ico('trash-2', 'sm') + 'Delete group for everyone</button>' : ''));
    }
    html += acc('media', 'image', 'Media', sh.media.length,
      sh.media.length ? '<div class="thumbs">' + sh.media.map(function (s) { return s && s.image ? (s.mid ? '<button class="thumb-btn" data-action="view-image" data-id="' + s.mid + '" data-i="' + (s.i || 0) + '" aria-label="View ' + esc(s.name || 'photo') + ' larger">' : '') + '<img class="scene" src="' + esc(s.image) + '" alt="' + esc(s.name || 'Shared photo') + '" style="object-fit:cover">' + (s.mid ? '</button>' : '') : scene(s, 100, 100); }).join('') + '</div>' : '<p class="empty" style="padding:8px 0">Photos shared here will appear in this space.</p>');
    html += acc('files', 'file-text', 'Files', sh.files.length,
      sh.files.length ? sh.files.map(function (f) { var live = !!f.url; return '<' + (live ? 'button type="button" class="row-item" data-action="save-url" data-u="' + esc(f.url) + '" data-n="' + esc(f.name) + '" aria-label="Download ' + esc(f.name) + '"' : 'div class="row-item"') + '><span class="file-icon">' + ico('file-text', 'sm') + '</span><span style="min-width:0"><b>' + esc(f.name) + '</b><span>' + esc(f.meta) + '</span></span>' + (live ? '<span class="row-go">' + ico('download', 'sm') + '</span>' : '') + '</' + (live ? 'button' : 'div') + '>'; }).join('') : '<p class="empty" style="padding:8px 0">Files shared here will appear in this space.</p>');
    html += acc('links', 'link-2', 'Links', sh.links.length,
      sh.links.length ? sh.links.map(function (l) { return '<' + (l.url ? 'a class="row-item" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer"' : 'div class="row-item"') + '><span class="file-icon">' + ico('link-2', 'sm') + '</span><span style="min-width:0"><b>' + esc(l.name) + '</b><span>' + esc(l.meta) + '</span></span></' + (l.url ? 'a' : 'div') + '>'; }).join('') : '<p class="empty" style="padding:8px 0">Links shared here will appear in this space.</p>');
    $('#details').innerHTML = html;
  }

  /* ---------- Settings (two panes, like Discord) ---------- */
  var DEV = {
    mic: { list: ['Default microphone', 'Headset microphone', 'Built-in microphone'], icon: 'mic', label: 'Microphone' },
    spk: { list: ['Default speakers', 'Headphones', 'Monitor speakers'], icon: 'volume-2', label: 'Speaker' },
    cam: { list: ['Built-in camera', 'External webcam'], icon: 'camera', label: 'Camera' }
  };
  /* Live mode: the pickers list your real devices (js/services.calls.js, S.hardware). */
  function liveHW() { return C.config && C.config.backend === 'live' && S.hardware ? S.hardware : null; }
  function loadHardware() {
    var hw = liveHW(); if (!hw) return;
    return hw.load().then(function (d) {
      ['mic', 'spk', 'cam'].forEach(function (k) {
        var items = d[k].length ? d[k] : [{ id: '', label: d.blocked ? 'Allow access in your browser' : 'No device found' }];
        DEV[k].list = items.map(function (x) { return x.label; }); DEV[k].ids = items.map(function (x) { return x.id; });
        var i = DEV[k].ids.indexOf(hw.chosen(k)); state.dev[k] = i < 0 ? 0 : i;
      });
      state.hwReady = true;
      if (state.settings && state.setTab === 'voice') { paintPane(); }
    });
  }
  function stopPreview() { var hw = liveHW(); if (hw) hw.stopPreview(); }
  function startPreview() {
    var hw = liveHW(); if (!hw) return;
    hw.preview().then(function (ms) {
      var box = $('#cam-preview'); if (!box || !ms || state.setTab !== 'voice' || !state.settings) { if (ms && !(box && state.settings)) hw.stopPreview(); return; }
      var old = box.querySelector('video'); if (old) old.remove();
      var v = document.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = ms;
      v.className = 'live-video camera' + (state.mirror ? ' mirror' : ''); v.play().catch(function () {});
      var art = box.querySelector('.cam-art'); if (art) art.style.display = 'none';
      box.insertBefore(v, box.firstChild);
    });
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', function () { if (state.settings && state.setTab === 'voice' && liveHW()) loadHardware(); });
  var TABS = [['profile', 'user-round', 'My profile'], ['voice', 'mic', 'Voice & Video'], ['notify', 'bell', 'Notifications'], ['look', 'palette', 'Appearance'], ['tools', 'wrench', 'Prototype tools'], ['about', 'info', 'About']];
  function tabList() {
    var t = TABS.filter(function (x) { return !(x[0] === 'tools' && C.config && C.config.backend === 'live'); });
    if (S.isOwner()) { t.splice(4, 0, ['library', 'sparkles', 'Library']); t.splice(5, 0, ['invite', 'user-plus', 'Invite a friend']); t.splice(6, 0, ['sounds', 'volume-2', 'Sounds']); }
    return t;
  }
  function selectOpen() { return !!document.querySelector('.select-list:not([hidden])'); }
  function setSelect(open, wrap, focusOption) {
    document.querySelectorAll('.select-wrap').forEach(function (w) {
      var l = w.querySelector('.select-list'), b = w.querySelector('.select-btn'), on = !!open && w === wrap;
      l.hidden = !on; b.setAttribute('aria-expanded', String(on));
      if (on && focusOption) (l.querySelector('[aria-selected="true"]') || l.firstElementChild).focus();
    });
  }
  function selectHTML(key, up) {
    var d = DEV[key], i = state.dev[key];
    return '<div class="select-wrap' + (up ? ' up' : '') + '" data-sel="' + key + '"><span class="name-label" id="lbl-' + key + '">' + d.label + '</span>' +
      '<button class="select-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="lbl-' + key + '" data-action="select-toggle"><span class="lead">' + ico(d.icon, 'sm') + '</span><span class="label">' + esc(d.list[i]) + '</span><span class="chev">' + ico('chevron-down', 'sm') + '</span></button>' +
      '<ul class="select-list" role="listbox" aria-label="' + d.label + '" hidden>' + d.list.map(function (m, n) {
        return '<li role="option" tabindex="-1" data-action="select-option" data-sel="' + key + '" data-i="' + n + '" title="' + esc(m) + '" aria-selected="' + (n === i) + '"><span class="opt-t">' + esc(m) + '</span>' + (n === i ? ico('check', 'sm') : '') + '</li>';
      }).join('') + '</ul></div>';
  }
  function switchRow(label, hint, action, on) {
    return '<div class="set-row"><span class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><button class="switch" role="switch" data-action="' + action + '" aria-checked="' + on + '" aria-label="' + label + '"></button></div>';
  }
  function pttLabel() { return state.pttListening ? 'Press a key…' : state.pttKey; }
  var meterTimer = null;
  function stopMicTest() { if (meterTimer && meterTimer.stop) meterTimer.stop(); else clearInterval(meterTimer); meterTimer = null; state.micTest = false; document.querySelectorAll('#meter i').forEach(function (b) { b.classList.remove('on'); }); }
  function startMicTest() {
    var hw = liveHW();
    if (hw) {
      state.micTest = true; var bars0 = document.querySelectorAll('#meter i'), ctl = null, cancelled = false;
      hw.meter(function (lv) { var n = Math.round(lv * bars0.length); bars0.forEach(function (b, i) { b.classList.toggle('on', i < n); }); }).then(function (c) { if (cancelled) c.stop(); else { ctl = c; c.hear(state.hearSelf); } });
      meterTimer = { stop: function () { cancelled = true; if (ctl) ctl.stop(); }, hear: function (on) { if (ctl) ctl.hear(on); } };
      return;
    }
    state.micTest = true; var bars = document.querySelectorAll('#meter i'), lvl = 0.3;
    meterTimer = setInterval(function () {
      lvl = Math.max(0.05, Math.min(1, lvl + (Math.random() - 0.5) * 0.7)); var n = Math.round(lvl * bars.length);
      bars.forEach(function (b, i) { b.classList.toggle('on', i < n); });
    }, 110);
  }
  /* ---------- Settings → Library: manage custom emoji, GIFs and sounds in one place (owner only) ---------- */
  var lb = { draft: null, confirm: '' };
  function lbRemoveBtn(kind, id, label) {
    var key = kind + ':' + id, sure = lb.confirm === key;
    return '<button class="lb-x' + (sure ? ' sure' : '') + '" data-action="lb-remove" data-kind="' + kind + '" data-id="' + esc(id) + '" aria-label="Remove ' + esc(label) + '">' + (sure ? 'Remove?' : '×') + '</button>';
  }
  function lbDraftHTML(kind) {
    var d = lb.draft; if (!d || d.kind !== kind) return '';
    var prev = kind === 'sound' ? '<span class="lb-snd-ico">🔊</span>' : '<img class="lb-prev" src="' + esc(d.url) + '" alt="">';
    return '<div class="lb-draft">' + prev + (kind === 'sound' ? '<input id="lb-emoji" type="text" maxlength="4" value="' + esc(d.emoji || '🔊') + '" aria-label="Emoji" style="width:46px;text-align:center">' : '') +
      '<input id="lb-name" type="text" maxlength="' + (kind === 'emoji' ? 24 : kind === 'sound' ? 30 : 40) + '" value="' + esc(d.name) + '" aria-label="Name" autocomplete="off">' +
      '<button class="btn sm" data-action="lb-save">Add</button><button class="btn sm ghost" data-action="lb-cancel">Cancel</button>' + (d.err ? '<span class="err">' + esc(d.err) + '</span>' : '') + '</div>';
  }
  function libraryHTML() {
    var em = S.customEmoji ? S.customEmoji() : [], gf = S.libraryGifs ? S.libraryGifs() : [], sn = S.sounds ? S.sounds() : [];
    function add(kind, label) { return lb.draft && lb.draft.kind === kind ? '' : '<button class="btn sm" data-action="lb-add" data-kind="' + kind + '">+ ' + label + '</button>'; }
    return '<h3 class="lb-h">Library</h3><p class="lb-sub">Emoji, GIFs and sounds that everyone in Concorde can use. Only you can add or remove them.</p>' +
      '<section class="lb-sec"><div class="lb-head"><h4>Emoji <span class="count">' + em.length + '</span></h4>' + add('emoji', 'Add emoji') + '</div>' + lbDraftHTML('emoji') +
        (em.length ? '<div class="lb-grid">' + em.map(function (e) { return '<div class="lb-tile"><img src="' + esc(e.url) + '" alt=""><span title=":' + e.name + ':">:' + e.name + ':</span>' + lbRemoveBtn('emoji', e.name, ':' + e.name + ':') + '</div>'; }).join('') + '</div>' : '<p class="lb-empty">No custom emoji yet. Pictures are shrunk to 128 px.</p>') + '</section>' +
      '<section class="lb-sec"><div class="lb-head"><h4>GIFs <span class="count">' + gf.length + '</span></h4>' + add('gif', 'Add GIF') + '</div>' + lbDraftHTML('gif') +
        (gf.length ? '<div class="lb-grid gifs">' + gf.map(function (g) { return '<div class="lb-tile"><img src="' + esc(g.url) + '" alt=""><span title="' + esc(g.name) + '">' + esc(g.name) + '</span>' + lbRemoveBtn('gif', g.id, g.name) + '</div>'; }).join('') + '</div>' : '<p class="lb-empty">No GIFs yet. GIF, WebP, PNG or JPEG up to 3 MB.</p>') + '</section>' +
      '<section class="lb-sec"><div class="lb-head"><h4>Sounds <span class="count">' + sn.length + '</span></h4>' + add('sound', 'Add sound') + '</div>' + lbDraftHTML('sound') +
        (sn.length ? '<ul class="lb-sounds">' + sn.map(function (c) { return '<li><button class="lb-play" data-action="lb-play" data-id="' + c.id + '" aria-label="Play ' + esc(c.name) + '">' + ico('play', 'sm') + '</button><span class="lb-snd-ico">' + esc(c.emoji) + '</span><span class="lb-snd-nm">' + esc(c.name) + '</span>' + lbRemoveBtn('sound', c.id, c.name) + '</li>'; }).join('') + '</ul>' : '<p class="lb-empty">No sounds yet. Audio up to 600 KB (about 10 seconds). They play on the soundboard during calls.</p>') + '</section>';
  }
  function paintLibrary(focusName) {
    var pane = $('#set-pane'); if (!pane || state.setTab !== 'library') return;
    var top = pane.scrollTop; pane.innerHTML = libraryHTML(); pane.scrollTop = top;
    if (focusName) { var n = $('#lb-name', pane); if (n) { n.focus(); n.select(); } }
  }
  function lbAdd(kind) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = kind === 'sound' ? 'audio/*' : kind === 'gif' ? 'image/gif,image/webp,image/png,image/jpeg' : 'image/png,image/jpeg,image/gif,image/webp';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var base = (f.name || kind).replace(/\.[^.]+$/, '');
      var d = { kind: kind, file: f, url: kind === 'sound' ? '' : URL.createObjectURL(f), err: '', w: 200, h: 200, emoji: '🔊',
        name: kind === 'emoji' ? (base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'emoji') : base.replace(/[_-]+/g, ' ').trim().slice(0, kind === 'sound' ? 30 : 40) || kind };
      lb.draft = d; lb.confirm = '';
      if (kind === 'gif') { var im = new Image(); im.onload = function () { d.w = im.naturalWidth || 200; d.h = im.naturalHeight || 200; }; im.src = d.url; }
      if (kind === 'sound') { try { var a = new Audio(URL.createObjectURL(f)); a.onloadedmetadata = function () { if (a.duration > 12) { d.err = 'That’s ' + Math.round(a.duration) + ' seconds. Keep it to about 10.'; paintLibrary(); } }; } catch (e) {} }
      paintLibrary(true);
    };
    inp.click();
  }
  function lbSave() {
    var d = lb.draft; if (!d) return; var n = $('#lb-name'), em = $('#lb-emoji'); if (n) d.name = n.value; if (em) d.emoji = em.value || '🔊';
    var job = d.kind === 'emoji' ? S.addCustomEmoji(d.name, d.file) : d.kind === 'gif' ? S.addLibraryGif(d.name, d.file, d.w, d.h) : S.addSound(d.name, d.emoji, d.file);
    job.then(function (r) {
      if (!r.ok) { d.err = r.error || 'Couldn’t add it'; paintLibrary(true); return; }
      lb.draft = null; toast('Added'); paintLibrary();
    });
  }
  S.on('emoji', function () { paintLibrary(); });
  S.on('library', function () { paintLibrary(); });
  /* Update check (installed app only). */
  var updMsg = '', updBusy = false;
  function updateRowHTML() {
    if (!S.checkUpdateNow) return '';
    var u = S.getUpdate ? S.getUpdate() : {}, msg = updMsg;
    if (u.available) return '<div class="about-upd"><button class="btn-pill" data-action="update-now">' + ico('refresh-cw', 'sm') + 'Restart to update to ' + esc(u.version || 'the new version') + '</button></div>';
    return '<div class="about-upd"><button class="btn-pill quiet" data-action="about-check"' + (updBusy ? ' disabled' : '') + '>' + ico('refresh-cw', 'sm') + (updBusy ? 'Checking…' : 'Check for updates') + '</button>' + (msg ? '<span class="about-msg" role="status">' + esc(msg) + '</span>' : '') + '</div>';
  }
  function repaintAbout() { var el = document.querySelector('.about-ver'); if (el) { var row = el.querySelector('.about-upd'); if (row) row.remove(); el.insertAdjacentHTML('beforeend', updateRowHTML()); } }
  function aboutCheck() {
    if (updBusy || !S.checkUpdateNow) return; updBusy = true; updMsg = ''; repaintAbout();
    S.checkUpdateNow().then(function (res) {
      var r = res.state; updBusy = false;
      updMsg = r === 'error' && res.reason ? res.reason : { latest: 'You’re up to date.', downloading: 'Found a new version. Downloading it now. This button turns into a restart button when it’s ready.', ready: '', unavailable: 'Updates only work in the installed app.', error: 'Couldn’t check. Check your internet connection and try again.' }[r] || '';
      repaintAbout();
    });
  }
  /* Settings > Sounds (owner only): audition your own files for each app sound. */
  function soundsHTML() {
    var map = sfxMap();
    return '<h2>Sounds</h2><p class="sfx-note">Try your own sound files for each moment in the app. They are kept on this computer only, so nobody else hears them. Short clips work best (under 1 second for pings, 3 seconds at most). MP3, OGG or WAV, up to 400 KB. Tell me which ones you like and I’ll make them the default for everyone.</p>' +
      '<ul class="sfx-list">' + SFX_EVENTS.map(function (e) {
        var o = map[e[0]];
        return '<li class="sfx-row"><div class="sfx-text"><b>' + esc(e[1]) + '</b><span>' + (o ? esc(o.n) : (e[0] === 'confetti' || e[0] === 'fireworks' || e[0] === 'hearts' ? 'Silent' : 'Built-in tone')) + '</span></div>' +
          '<button class="btn-pill quiet sm" data-action="sfx-play" data-k="' + e[0] + '" aria-label="Play ' + esc(e[1]) + '">' + ico('volume-2', 'sm') + 'Play</button>' +
          '<button class="btn-pill quiet sm" data-action="sfx-pick" data-k="' + e[0] + '">' + (o ? 'Change' : 'Choose file') + '</button>' +
          (o ? '<button class="btn-pill quiet sm" data-action="sfx-reset" data-k="' + e[0] + '">Reset</button>' : '') + '</li>';
      }).join('') + '</ul><p class="sfx-msg" id="sfx-msg" role="status"></p>';
  }
  function sfxRepaint(msg) { var pane = document.getElementById('set-pane'); if (pane) { pane.innerHTML = soundsHTML(); var m = document.getElementById('sfx-msg'); if (m && msg) m.textContent = msg; } }
  function sfxPick(kind) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 400 * 1024) { sfxRepaint('That file is over 400 KB. Try a shorter clip.'); return; }
      var fr = new FileReader(); fr.onload = function () {
        var m = sfxMap(); m[kind] = { n: f.name.slice(0, 40), d: fr.result };
        if (!sfxSave(m)) { sfxRepaint('Couldn’t keep that file. Try a smaller one, or reset another sound first.'); return; }
        sfxRepaint(''); playOverride(kind, m[kind]);
      }; fr.readAsDataURL(f);
    };
    inp.click();
  }
  function aboutHTML() {
    var v = C.version, log = C.changelog || [];
    var date = function (d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); };
    return '<h2>About</h2><div class="set-section about-ver"><strong>Concorde ' + esc(v.number) + '</strong><span>Released ' + esc(date(v.date)) + '</span>' + updateRowHTML() + '</div>' +
      '<h3 class="lb-h">What’s new</h3><div class="changelog" tabindex="0" role="region" aria-label="Change log">' + log.map(function (e) {
        return '<section class="cl-entry"><h4>' + esc(e.v) + ' <span>' + esc(date(e.d)) + '</span></h4><ul>' + e.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></section>';
      }).join('') + '</div>';
  }
  function paneHTML(tab) {
    var me = S.getCurrentUser();
    if (tab === 'invite' && S.isOwner() && C.ui.inviteHTML) return C.ui.inviteHTML();
    if (tab === 'library' && S.isOwner()) return libraryHTML();
    if (tab === 'sounds' && S.isOwner()) return soundsHTML();
    if (tab === 'about') return aboutHTML();
    if (tab === 'profile') {
      return '<h2>My profile</h2><div class="set-section"><div class="avatar-row">' + avatar(me, 84) +
        '<div class="avatar-side"><button class="btn-pill quiet" data-action="change-avatar">' + ico('image', 'sm') + 'Change avatar</button><button class="btn-pill quiet" data-action="avatar-gif">' + ico('sparkles', 'sm') + 'Use a GIF</button>' +
        '<div class="ring-pick" role="radiogroup" aria-label="Ring colour">' + RINGS.map(function (r, i) {
          var on = r[0] === me.c1 && r[1] === me.c2;
          return '<button type="button" class="ring-sw" role="radio" aria-checked="' + on + '" aria-label="' + r[2] + ' ring" title="' + r[2] + '" data-action="ring-pick" data-i="' + i + '" style="--c1:' + r[0] + ';--c2:' + r[1] + '"></button>';
        }).join('') + '</div></div></div>' +
        '<label class="name-label" for="set-name">Display name</label><label class="field" for="set-name"><input id="set-name" type="text" value="' + esc(me.name) + '"></label>' +
        '<label class="name-label" for="set-note">Status message</label><div class="note-row"><label class="field" for="set-note"><input id="set-note" type="text" maxlength="60" placeholder="What are you up to? Words or an emoji" autocomplete="off" value="' + esc(me.note || '') + '"></label><button type="button" class="btn-round" id="note-emoji" aria-label="Pick an emoji" aria-expanded="false">' + ico('smile') + '</button></div><div class="note-emojis" id="note-emojis" hidden></div>' +
        '<input id="file-avatar" type="file" accept="image/*" hidden></div>' +
        '<div class="set-section"><h3>Status</h3><p class="pane-note">Change it any time by clicking your card at the bottom of the chat list.</p></div>';
    }
    if (tab === 'voice') {
      return '<h2>Voice &amp; Video</h2>' +
        '<div class="grid2">' + selectHTML('mic') + selectHTML('spk') + '</div>' +
        '<div class="grid2"><label class="vol"><span class="name-label">Input volume</span><input class="rng" type="range" min="0" max="100" value="' + state.vol.inp + '" data-vol="inp" aria-label="Input volume"></label>' +
        '<label class="vol"><span class="name-label">Output volume</span><input class="rng" type="range" min="0" max="100" value="' + state.vol.out + '" data-vol="out" aria-label="Output volume"></label></div>' +
        '<div class="mic-test"><button class="btn-pill quiet" data-action="mic-test">' + ico('mic', 'sm') + '<span id="mic-test-label">' + (state.micTest ? 'Stop test' : 'Test microphone') + '</span></button>' +
        '<div class="meter" id="meter" aria-hidden="true">' + new Array(21).join('<i></i>') + '</div></div>' +
        (liveHW() ? switchRow('Hear myself', 'Plays your microphone through your speakers while you test. Use headphones, or it will echo.', 'toggle-hear', !!state.hearSelf) : '') +
        '<div class="set-section"><h3>Input profile</h3><div class="radio-cards" role="radiogroup" aria-label="Input profile">' +
        [['voice', 'Voice isolation', 'Softens background noise. Good for most rooms.'], ['strong', 'Strong noise removal', 'Cuts keyboards, fans and room hiss hard. Uses a little more computer power.'], ['studio', 'Studio', 'Keeps your voice natural. Good with a quality microphone.']].map(function (r) {
          return '<button type="button" class="radio-card" role="radio" aria-checked="' + (state.profileMode === r[0]) + '" data-action="profile-mode" data-mode="' + r[0] + '"><b>' + r[1] + '</b><span>' + r[2] + '</span></button>';
        }).join('') + '</div></div>' +
        '<div class="set-section">' + switchRow('Push to talk', 'Hold a key to speak. Your microphone stays closed otherwise.', 'toggle-ptt', state.ptt) +
        (state.ptt ? '<div class="set-row"><span class="lbl">Talk key</span><button class="key-btn' + (state.pttListening ? ' listening' : '') + '" data-action="ptt-key">' + ico('keyboard', 'sm') + '<span id="ptt-label">' + esc(pttLabel()) + '</span></button></div>' : '') + '</div>' +
        '<div class="set-section"><h3>Video</h3><div class="cam-row"><div class="cam-preview" id="cam-preview">' + camArt(me, true) + '<span class="stage-tag">Preview</span></div>' +
        '<div class="cam-side">' + selectHTML('cam', true) + switchRow('Mirror my video', 'Flips your picture, like a mirror.', 'toggle-mirror', state.mirror) + '</div></div></div>';
    }
    if (tab === 'notify') {
      return '<h2>Notifications</h2><div class="set-section">' +
        switchRow('Gentle sounds', 'For joining, leaving and new messages', 'toggle-sounds', state.sounds) +
        switchRow('Desktop alerts', 'A banner when someone mentions you or has a new idea', 'toggle-alerts', state.alerts) +
        switchRow('Go away when idle', 'Shows you as Away after 10 minutes without activity', 'toggle-autoaway', state.autoAway) + '</div>' +
        '<div class="set-section"><h3>Do not disturb</h3><p class="pane-note">Set your status to Do not disturb and Concorde stays silent: no sounds, no banners, no ringing. Unread counts still build up so nothing is lost.</p></div>';
    }
    if (tab === 'look') {
      return '<h2>Appearance</h2><div class="set-section"><h3>Theme</h3>' + themeSwitch('wide') + '<p class="pane-note">Auto follows your computer, switching between light and dark on its own.</p></div>' +
        '<div class="set-section"><h3>Colour</h3>' + paletteChoice() + '<p class="pane-note">Soft and Muted turn the colour down. They work with light and dark.</p></div>';
    }
    return '<h2>Prototype tools</h2><p class="pane-note">Things that would normally happen on their own. Use these to see how each moment looks.</p><div class="tool-col">' +
      '<button class="btn-pill quiet" data-action="sim-call" data-kind="audio">' + ico('phone', 'sm') + 'Incoming voice call</button>' +
      '<button class="btn-pill quiet" data-action="sim-call" data-kind="video">' + ico('video', 'sm') + 'Incoming video call</button>' +
      '<button class="btn-pill quiet" data-action="sim-mention">' + ico('at-sign', 'sm') + 'Someone @mentions you</button>' +
      '<button class="btn-pill quiet" data-action="sim-idea">' + ico('lightbulb', 'sm') + 'Friend posts a new idea</button>' +
      '<button class="btn-pill quiet" data-action="sim-camera">' + ico('video', 'sm') + 'Friend turns camera on or off (in a call)</button>' +
      '<button class="btn-pill quiet" data-action="sim-idle">' + ico('moon', 'sm') + 'You go idle (auto-away)</button>' +
      '<button class="btn-pill quiet" data-action="sim-kid">' + ico('circle-minus', 'sm') + 'Change Kid\'s status</button>' +
      '<button class="btn-pill quiet" data-action="sim-offline">' + ico('wifi-off', 'sm') + 'Lose connection (offline)</button>' +
      '<button class="btn-pill quiet" data-action="sim-firstrun">' + ico('sparkles', 'sm') + 'See it as a brand new user (no chats)</button>' +
      '<button class="btn-pill quiet" data-action="sim-update">' + ico('download', 'sm') + 'An update becomes ready</button>' +
      '<button class="btn-pill quiet" data-action="sim-member">' + ico('user', 'sm') + 'See it as a normal member (no admin tools)</button>' +
      '<button class="btn-pill quiet" data-action="show-tray">' + ico('plane', 'sm') + 'Show the system tray</button></div>' +
      '<div class="set-section">' + switchRow('App window frame', 'Shows the Concorde title bar, as in the installed app', 'toggle-frame', store.get('frame', 'on') === 'on') + '</div>';
  }
  function paintPane() {
    var pane = $('#set-pane'); if (!pane) return;
    stopMicTest(); stopPreview();
    pane.innerHTML = paneHTML(state.setTab); pane.scrollTop = 0;
    document.querySelectorAll('.set-nav button[data-tab]').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.tab === state.setTab)); });
    if (state.setTab === 'voice' && liveHW()) { if (state.hwReady) startPreview(); else if (!state.hwAsked) { state.hwAsked = true; loadHardware(); } }   /* one permission request at a time: names first, then the camera preview */
    var inp = $('#set-name', pane);
    if (inp) inp.addEventListener('change', function () {
      S.updateProfile({ name: inp.value.trim() || 'bevopresto' }).then(function () { renderMe(); renderMessages({ scroll: false, initial: true, noFocus: true }); renderDetails(); });
    });
    var note = $('#set-note', pane);
    if (note) note.addEventListener('change', function () {
      S.updateProfile({ note: note.value.trim().slice(0, 60) }).then(function () { renderMe(); renderHead(); renderDetails(); });
    });
    var ne = $('#note-emoji', pane), nl = $('#note-emojis', pane);
    if (ne && note && nl) {
      nl.innerHTML = emojiDrawerHTML();
      ne.addEventListener('click', function () { nl.hidden = !nl.hidden; ne.setAttribute('aria-expanded', String(!nl.hidden)); });
      nl.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-e]'); if (!b) return;
        var v = note.value.trim(); note.value = (v ? v + ' ' : '') + b.dataset.e; note.value = note.value.slice(0, 60);
        note.dispatchEvent(new Event('change')); note.focus();
      });
    }
    var fa = $('#file-avatar', pane);
    if (fa) fa.addEventListener('change', function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      ev.target.value = '';
      pickPicture(f, function (data) { S.updateProfile({ avatar: data }).then(function () { refreshSettingsAvatar(); refreshAvatarEverywhere(); }); }, function (src) { openCrop(src); });
    });
  }
  function renderSettings() {
    if (!state.settings) { stopMicTest(); stopPreview(); state.hwAsked = false; state.hwReady = false; state.pttListening = false; overlay.querySelectorAll('.scrim').forEach(function (n) { n.remove(); }); return; }
    var existing = overlay.querySelector('.scrim'); if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'scrim'; el.dataset.action = 'settings-close';
    el.innerHTML = '<div class="modal settings2" role="dialog" aria-modal="true" aria-label="Settings">' +
      '<nav class="set-nav" aria-label="Settings sections"><h2>Settings</h2>' + tabList().map(function (t) {
        return '<button data-action="set-tab" data-tab="' + t[0] + '" aria-current="false">' + ico(t[1], 'sm') + t[2] + '</button>';
      }).join('') + '<span class="grow"></span><button class="out" data-action="sign-out">' + ico('log-out', 'sm') + 'Sign out</button></nav>' +
      '<div class="set-main"><button class="btn-round sm set-x" data-action="settings-close-btn" aria-label="Close settings">' + ico('x', 'sm') + '</button><div class="set-pane" id="set-pane"></div></div></div>';
    overlay.appendChild(el);
    paintPane();
  }

  /* Animated pictures (GIF, or WebP that moves) skip the cropper so they keep moving. 2 MB at most. */
  function pickPicture(f, onData, onCrop) {
    var r = new FileReader();
    function crop() { r.onload = function () { onCrop(r.result); }; r.readAsDataURL(f); }
    if (f.type === 'image/gif') return animated(true);
    if (f.type === 'image/webp') { var h = new FileReader(); h.onload = function () { animated(/ANIM/.test(String(h.result))); }; return h.readAsText(f.slice(0, 256)); }
    return crop();
    function animated(yes) {
      if (!yes) return crop();
      if (f.size > 2000000) { toast('Animated pictures need to be under 2 MB'); return; }
      r.onload = function () { onData(r.result); }; r.readAsDataURL(f);
    }
  }
  /* Pick a GIF (ours or GIPHY) to use as a profile or group picture. */
  var ag = null;
  function closeAG() { if (ag) { clearTimeout(ag.t); ag.el.remove(); ag = null; } }
  function openAvatarGif(onData) {
    closeAG();
    var el = document.createElement('div'); el.className = 'scrim2'; el.dataset.action = 'ag-scrim';
    var hasLib = !!(S.libraryGifs && S.libraryGifs().length);
    ag = { el: el, onData: onData, tab: hasLib ? 'lib' : 'giphy', q: '', items: [], busy: false, err: '', seq: 0, t: null, saving: false };
    el.innerHTML = '<div class="modal ag" role="dialog" aria-modal="true" aria-label="Choose a GIF picture"><h2>Choose a GIF</h2>' +
      '<div class="gif-tabs" role="tablist"><button role="tab" data-action="ag-tab" data-tab="lib">Our GIFs</button><button role="tab" data-action="ag-tab" data-tab="giphy">GIPHY</button></div>' +
      '<label class="field" for="ag-search">' + ico('search', 'sm') + '<input id="ag-search" type="search" placeholder="Search" autocomplete="off"></label>' +
      '<div class="ag-grid" id="ag-grid"></div><p class="ag-note" id="ag-note"></p>' +
      '<div class="modal-foot"><button class="btn-pill quiet" data-action="ag-close">Cancel</button></div></div>';
    overlay.appendChild(el);
    el.querySelector('#ag-search').addEventListener('input', function (e) { ag.q = e.target.value; clearTimeout(ag.t); if (ag.tab === 'giphy') ag.t = setTimeout(agLoad, 380); else agPaint(); });
    agTab(ag.tab);
  }
  function agTab(t) {
    ag.tab = t; ag.items = []; ag.err = '';
    ag.el.querySelectorAll('[data-action="ag-tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    ag.el.querySelector('#ag-search').placeholder = t === 'lib' ? 'Search our GIFs' : 'Search GIPHY';
    if (t === 'giphy') agLoad(); else agPaint();
  }
  function agLoad() {
    var seq = ++ag.seq; ag.busy = true; agPaint();
    S.searchGifs(ag.q, 0).then(function (r) { if (!ag || seq !== ag.seq) return; ag.items = r.items || []; ag.busy = false; agPaint(); })
      .catch(function (e) { if (!ag || seq !== ag.seq) return; ag.busy = false; ag.err = e && e.code === 'not_set_up' ? 'GIF search is not set up yet.' : 'Couldn’t load GIFs. Check your connection and try again.'; agPaint(); });
  }
  function agPaint() {
    var g = ag && ag.el.querySelector('#ag-grid'); if (!g) return;
    var items = ag.items;
    if (ag.tab === 'lib') { var q = ag.q.trim().toLowerCase(); items = (S.libraryGifs ? S.libraryGifs() : []).filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) !== -1; }).map(function (x) { return { id: x.id, title: x.name, url: x.url, preview: x.url }; }); ag.items = items; }
    if (ag.err) { g.innerHTML = '<p class="gif-empty">' + esc(ag.err) + '</p>'; return; }
    if (!items.length) { g.innerHTML = '<p class="gif-empty">' + (ag.busy ? 'Loading…' : ag.tab === 'lib' ? 'No GIFs here yet.' : 'No GIFs found. Try another word.') + '</p>'; return; }
    g.innerHTML = items.map(function (it, i) { return '<button data-action="ag-pick" data-i="' + i + '" aria-label="' + esc(it.title) + '"><img alt="" loading="lazy" src="' + esc(it.preview || it.url) + '"></button>'; }).join('');
  }
  function agPick(i) {
    var it = ag && ag.items[i]; if (!it || ag.saving) return;
    ag.saving = true; var note = ag.el.querySelector('#ag-note'); note.textContent = 'Getting that GIF…';
    fetch(it.url).then(function (r) { if (!r.ok) throw new Error('bad'); return r.blob(); }).then(function (b) {
      if (b.size > 2000000) { note.textContent = 'That GIF is over 2 MB. Try a smaller one.'; ag.saving = false; return; }
      var fr = new FileReader(); fr.onload = function () { var cb = ag && ag.onData; closeAG(); if (cb) cb(fr.result); }; fr.readAsDataURL(b);
    }).catch(function () { if (!ag) return; note.textContent = 'Couldn’t get that GIF. Try another.'; ag.saving = false; });
  }
  /* A small emoji drawer for any text box (status, group name). Opens under the box. */
  function attachEmojiDrawer(input, host) {
    var field = input.closest('label.field'); if (!field || field.parentNode.classList.contains('note-row')) return;
    var row = document.createElement('div'); row.className = 'note-row'; field.parentNode.insertBefore(row, field); row.appendChild(field);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn-round'; btn.setAttribute('aria-label', 'Pick an emoji'); btn.setAttribute('aria-expanded', 'false'); btn.innerHTML = ico('smile');
    row.appendChild(btn);
    var drawer = document.createElement('div'); drawer.className = 'note-emojis'; drawer.hidden = true; row.parentNode.insertBefore(drawer, row.nextSibling);
    drawer.innerHTML = emojiDrawerHTML();
    btn.addEventListener('click', function () { drawer.hidden = !drawer.hidden; btn.setAttribute('aria-expanded', String(!drawer.hidden)); if (input.selectionStart === 0 && input.selectionEnd === input.value.length) { try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {} } });
    drawer.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-e]'); if (!b) return;
      var a = input.selectionStart == null ? input.value.length : input.selectionStart, z = input.selectionEnd == null ? a : input.selectionEnd;
      var next = input.value.slice(0, a) + b.dataset.e + input.value.slice(z);
      if (input.maxLength > 0 && next.length > input.maxLength) { toast('That’s the most that fits here'); return; }
      input.value = next; var pos = a + b.dataset.e.length; input.focus(); try { input.setSelectionRange(pos, pos); } catch (e) {}
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  function emojiDrawerHTML() {
    return EMOJI_SETS.map(function (g) { return '<h4 class="emoji-h">' + g[0] + '</h4>' + g[1].map(function (e) { return '<button type="button" data-e="' + e + '" aria-label="' + e + '">' + e + '</button>'; }).join(''); }).join('');
  }

  /* ---------- Avatar ring colours and photo cropper ---------- */
  var RINGS = [
    ['#7C5CFA', '#E0549F', 'Violet to pink'], ['#F2A07B', '#E0549F', 'Peach to pink'], ['#5B8DEF', '#7C5CFA', 'Blue to violet'],
    ['#3FBF8F', '#5B8DEF', 'Mint to blue'], ['#F7C75A', '#F06BA8', 'Gold to coral'], ['#E0549F', '#5B8DEF', 'Pink to blue']
  ];
  function refreshAvatarEverywhere() { renderMe(); renderMessages({ scroll: false, initial: true }); renderDetails(); renderCall(); renderList(); renderHead(); }
  function refreshSettingsAvatar() {
    var me = S.getCurrentUser(), row = overlay.querySelector('.avatar-row .avatar');
    if (row) row.outerHTML = avatar(me, 76);
    overlay.querySelectorAll('.ring-sw').forEach(function (b) {
      var r = RINGS[+b.dataset.i]; b.setAttribute('aria-checked', String(r[0] === me.c1 && r[1] === me.c2));
    });
  }
  var crop = null, CV = 264;
  function openCrop(src, onSave, colors) {
    closeCrop();
    var me = colors || S.getCurrentUser(), img = new Image();
    img.onload = function () {
      var el = document.createElement('div');
      el.className = 'scrim2'; el.dataset.action = 'crop-scrim';
      el.innerHTML = '<div class="modal crop" role="dialog" aria-modal="true" aria-label="Adjust your photo">' +
        '<div><h2>Adjust your photo</h2><p class="crop-hint">Drag the photo to move it. Use the slider to zoom.</p></div>' +
        '<div class="crop-frame" id="crop-frame" tabindex="0" aria-label="Photo position. Use arrow keys to move." style="--c1:' + me.c1 + ';--c2:' + me.c2 + '"><div class="crop-view"><img id="crop-img" alt="" draggable="false"></div></div>' +
        '<label class="zoom">' + ico('image', 'sm') + '<input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">' + ico('image') + '</label>' +
        '<div class="modal-foot"><button class="btn-pill quiet" data-action="crop-cancel">Cancel</button><button class="btn-pill" data-action="crop-save">Use photo</button></div></div>';
      overlay.appendChild(el);
      var base = CV / Math.min(img.naturalWidth, img.naturalHeight);
      crop = { img: img, base: base, z: 1, ox: 0, oy: 0, el: el, node: el.querySelector('#crop-img'), onSave: onSave };
      crop.node.src = src;
      paintCrop();
      var frame = el.querySelector('#crop-frame'), zoom = el.querySelector('#crop-zoom'), drag = null;
      frame.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy }; frame.setPointerCapture(e.pointerId); frame.classList.add('drag'); });
      frame.addEventListener('pointermove', function (e) { if (!drag) return; crop.ox = drag.ox + e.clientX - drag.x; crop.oy = drag.oy + e.clientY - drag.y; paintCrop(); });
      function end() { drag = null; frame.classList.remove('drag'); }
      frame.addEventListener('pointerup', end); frame.addEventListener('pointercancel', end);
      frame.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(crop.z * (e.deltaY < 0 ? 1.06 : 0.94)); zoom.value = crop.z; }, { passive: false });
      frame.addEventListener('keydown', function (e) {
        var d = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
        if (d) { e.preventDefault(); crop.ox += d[0]; crop.oy += d[1]; paintCrop(); }
      });
      zoom.addEventListener('input', function () { setZoom(+zoom.value); });
      frame.focus();
    };
    img.src = src;
  }
  function setZoom(z) { crop.z = Math.max(1, Math.min(4, z)); paintCrop(); }
  function paintCrop() {
    var sc = crop.base * crop.z, w = crop.img.naturalWidth * sc, h = crop.img.naturalHeight * sc;
    var mx = (w - CV) / 2, my = (h - CV) / 2;
    crop.ox = Math.max(-mx, Math.min(mx, crop.ox)); crop.oy = Math.max(-my, Math.min(my, crop.oy));
    var n = crop.node; n.style.width = w + 'px'; n.style.height = h + 'px';
    n.style.transform = 'translate(' + (CV / 2 + crop.ox - w / 2) + 'px,' + (CV / 2 + crop.oy - h / 2) + 'px)';
  }
  function closeCrop() { if (crop) { crop.el.remove(); crop = null; } else overlay.querySelectorAll('.scrim2[data-action="crop-scrim"]').forEach(function (n) { n.remove(); }); }
  function saveCrop() {
    var sc = crop.base * crop.z, size = 320, cv = document.createElement('canvas'); cv.width = cv.height = size;
    var cx = cv.getContext('2d'), side = CV / sc;
    var sx = crop.img.naturalWidth / 2 - crop.ox / sc - side / 2, sy = crop.img.naturalHeight / 2 - crop.oy / sc - side / 2;
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, size, size);
    cx.drawImage(crop.img, sx, sy, side, side, 0, 0, size, size);
    var data = cv.toDataURL('image/jpeg', 0.9);
    if (crop.onSave) { var cb = crop.onSave; closeCrop(); cb(data); return; }
    S.updateProfile({ avatar: data }).then(function () { closeCrop(); refreshSettingsAvatar(); refreshAvatarEverywhere(); });
  }

  /* ---------- Actions ---------- */
  function openConversation(id) {
    if (!id) { state.convId = null; state.messages = []; renderList(); return Promise.resolve(); }
    state.draft = null; state.convId = id; state.replyTo = null; state.popover = null; state.mention = null; S.setViewing(id);
    S.markRead(id); state.loadError = null;
    return S.loadHistory(id).then(function (list) {
      if (state.convId !== id) return;
      state.messages = list;
      renderList(); renderHead(); renderCall(); renderMessages({ initial: true }); renderReply(); renderDraft(); renderDetails(); renderPopover();
    }).catch(function () {
      if (state.convId !== id) return;
      state.messages = []; state.loadError = id;
      renderList(); renderHead(); renderCall(); renderMessages({ initial: true }); renderReply(); renderDraft(); renderDetails(); renderPopover();
    });
  }
  /* ---------- @mentions: picker in the composer, and a louder banner when you are mentioned ---------- */
  function mentionOptions(q) {
    var c = currentConv(), ids = c.type === 'direct' ? [c.with] : c.members.filter(function (m) { return m !== 'you'; });
    var opts = ids.map(function (id) { var p = person(id); return { id: id, name: p.name, sub: statusText(p.status), p: p }; });
    if (c.type === 'group') opts.push({ id: 'everyone', name: 'everyone', sub: 'Notify all ' + c.members.length + ' members', p: null });
    q = (q || '').toLowerCase();
    return opts.filter(function (o) { return !q || o.name.toLowerCase().indexOf(q) === 0 || o.name.toLowerCase().indexOf(q) > 0; })
      .sort(function (a, b) { return (a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1); });
  }
  function updateMention() {
    var input = $('#composer-input'); if (!input) return;
    var upto = input.value.slice(0, input.selectionStart), m = /(^|\s)@(\w*)$/.exec(upto);
    if (!m) { closeMention(); return; }
    var opts = mentionOptions(m[2]);
    if (!opts.length) { closeMention(); return; }
    var keep = state.mention && state.mention.query === m[2] ? state.mention.i : 0;
    state.mention = { query: m[2], start: upto.length - m[2].length - 1, opts: opts, i: Math.min(keep, opts.length - 1) };
    paintMention();
  }
  function paintMention() {
    var mt = state.mention, slot = $('#popover-slot'); if (!mt || !slot) return;
    slot.innerHTML = '<div class="popover mention-pop" role="listbox" aria-label="Mention someone">' + mt.opts.map(function (o, i) {
      var av = o.p ? avatar(o.p, 34) : '<span class="avatar every" style="--s:34px">' + ico('users', 'sm') + '</span>';
      return '<div class="mention-opt" role="option" aria-selected="' + (i === mt.i) + '" data-action="mention-pick" data-i="' + i + '">' + av + '<span><b>' + esc(o.name) + '</b><i>' + esc(o.sub) + '</i></span></div>';
    }).join('') + '</div>';
  }
  function closeMention() { if (state.mention) { state.mention = null; if (!state.popover) { var s = $('#popover-slot'); if (s) s.innerHTML = ''; } } }
  function pickMention(i) {
    var mt = state.mention, input = $('#composer-input'); if (!mt || !input) return;
    var o = mt.opts[i], end = input.selectionStart, ins = '@' + o.name + ' ';
    input.value = input.value.slice(0, mt.start) + ins + input.value.slice(end);
    var pos = mt.start + ins.length; input.setSelectionRange(pos, pos); closeMention(); input.focus();
  }
  var bannerEl = null, bannerTimer = null;
  function closeBanner() { clearTimeout(bannerTimer); if (bannerEl) { var g = bannerEl; bannerEl = null; g.classList.add('leaving'); setTimeout(function () { g.remove(); }, 220); } }
  function showBanner(o) {
    closeBanner();
    var el = document.createElement('section');
    el.className = 'mention-banner' + (o.tone ? ' ' + o.tone : ''); el.setAttribute('role', 'alert');
    el.innerHTML = '<div class="mb-avatar">' + avatar(o.who, 46) + '<span class="mb-at">' + o.badge + '</span></div>' +
      '<div class="mb-text"><b>' + esc(o.title) + '</b><span class="mb-where">' + esc(o.where) + '</span><p>' + o.html + '</p></div>' +
      '<div class="mb-actions"><button class="btn-pill" data-action="' + o.openAction + '" data-id="' + (o.id || '') + '">Open</button>' +
      '<button class="btn-round sm" data-action="banner-close" aria-label="Dismiss">' + ico('x', 'sm') + '</button></div><i class="mb-timer"></i>';
    overlay.appendChild(el); bannerEl = el;
    bannerTimer = setTimeout(closeBanner, 9000);
    el.addEventListener('mouseenter', function () { clearTimeout(bannerTimer); el.classList.add('hold'); });
    el.addEventListener('mouseleave', function () { el.classList.remove('hold'); bannerTimer = setTimeout(closeBanner, 4000); });
  }
  function showMentionBanner(conversationId, m) {
    var c = C.data.conversations.filter(function (x) { return x.id === conversationId; })[0], who = person(m.from), where = entity(c).name;
    showBanner({ who: who, badge: '@', title: who.name + ' mentioned you', where: c.type === 'group' ? 'in ' + where : 'in a direct chat', html: richText(m.text, true), openAction: 'banner-open', id: conversationId });
  }

  /* ---------- Group picture and name (used when creating and when editing) ---------- */
  var editDlg = null;
  function activeDlg() { return editDlg || newDlg; }
  function lookHTML(d) {
    var nm = d.name || d.fallback || 'Group';
    var av = avatar({ name: nm, c1: d.c1, c2: d.c2, avatar: d.avatar }, 76, { group: true, letter: groupLetter(nm) });
    return '<button type="button" class="look-avatar" data-action="grp-photo" aria-label="Choose a group picture">' + av + '<span class="look-cam">' + ico('image', 'sm') + '</span></button>' +
      '<div class="avatar-side"><div class="look-btns"><button type="button" class="btn-pill quiet" data-action="grp-photo">' + ico('image', 'sm') + (d.avatar ? 'Change photo' : 'Add photo') + '</button>' +'<button type="button" class="btn-pill quiet" data-action="grp-gif">' + ico('sparkles', 'sm') + 'Use a GIF</button>' +
      (d.avatar ? '<button type="button" class="btn-pill quiet" data-action="grp-unphoto">Remove</button>' : '') + '</div>' +
      '<div class="ring-pick" role="radiogroup" aria-label="Ring colour">' + RINGS.map(function (r, i) {
        return '<button type="button" class="ring-sw" role="radio" aria-checked="' + (r[0] === d.c1 && r[1] === d.c2) + '" aria-label="' + r[2] + ' ring" title="' + r[2] + '" data-action="grp-ring" data-i="' + i + '" style="--c1:' + r[0] + ';--c2:' + r[1] + '"></button>';
      }).join('') + '</div></div>';
  }
  function paintLook(el, d) { var box = el.querySelector('.look'); if (box) box.innerHTML = lookHTML(d); }
  function bindGroupFile(el) {
    el.querySelector('#file-group').addEventListener('change', function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      var dlg = activeDlg(); ev.target.value = '';
      pickPicture(f, function (data) { dlg.draft.avatar = data; paintLook(dlg.el, dlg.draft); }, function (src) { openCrop(src, function (data) { dlg.draft.avatar = data; paintLook(dlg.el, dlg.draft); }, dlg.draft); });
    });
  }
  function openEdit(id) {
    var c = id ? state.conversations.filter(function (x) { return x.id === id; })[0] : currentConv(); if (!c || c.type !== 'group') return;
    closeEdit();
    var el = document.createElement('div');
    el.className = 'scrim2'; el.dataset.action = 'edit-scrim';
    el.innerHTML = '<div class="modal new-dlg" role="dialog" aria-modal="true" aria-labelledby="edit-title">' +
      '<div class="new-head"><div><h2 id="edit-title">Edit group</h2><p class="crop-hint">Change the name or picture. Everyone sees a note in the chat.</p></div>' +
      '<button class="btn-round sm" data-action="edit-cancel" aria-label="Close">' + ico('x', 'sm') + '</button></div>' +
      '<div class="name-wrap"><span class="name-label">Group picture</span><div class="look"></div>' +
      '<label class="name-label" for="edit-name">Group name</label><label class="field" for="edit-name">' + ico('users', 'sm') + '<input id="edit-name" maxlength="30" autocomplete="off"></label></div>' +
      '<div class="modal-foot"><button class="btn-pill quiet" data-action="edit-cancel">Cancel</button><button class="btn-pill" data-action="edit-save">Save changes</button></div>' +
      '<input type="file" id="file-group" accept="image/*" hidden></div>';
    overlay.appendChild(el);
    editDlg = { el: el, id: c.id, orig: { name: c.name, avatar: c.avatar || null, c1: c.c1, c2: c.c2 }, draft: { name: c.name, avatar: c.avatar || null, c1: c.c1, c2: c.c2 } };
    var input = el.querySelector('#edit-name'); input.value = c.name;
    input.addEventListener('input', function () { editDlg.draft.name = input.value; var a = el.querySelector('.look-avatar .avatar'); if (a && !editDlg.draft.avatar) a.firstChild.textContent = groupLetter(input.value.trim() || 'Group'); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') saveEdit(); });
    bindGroupFile(el); paintLook(el, editDlg.draft); attachEmojiDrawer(input); input.focus(); input.select();
  }
  function closeEdit() { if (editDlg) { editDlg.el.remove(); editDlg = null; } }
  function saveEdit() {
    if (!editDlg) return;
    var d = editDlg.draft, o = editDlg.orig, id = editDlg.id, name = d.name.trim() || o.name;
    var patch = {};
    if (name !== o.name) patch.name = name;
    if ((d.avatar || null) !== o.avatar) patch.avatar = d.avatar;
    if (d.c1 !== o.c1 || d.c2 !== o.c2) { patch.c1 = d.c1; patch.c2 = d.c2; }
    closeEdit();
    if (!Object.keys(patch).length) return;
    S.updateConversation(id, patch).then(function () { chime('send'); renderHead(); renderDetails(); renderList(); });
  }

  /* ---------- New chat / new group ---------- */
  var newDlg = null;
  function friends() { return Object.keys(C.data.people).filter(function (id) { return id !== 'you'; }).map(person); }
  function openNew() {
    closeNew();
    var el = document.createElement('div');
    el.className = 'scrim2'; el.dataset.action = 'new-scrim';
    el.innerHTML = '<div class="modal new-dlg" role="dialog" aria-modal="true" aria-labelledby="new-title">' +
      '<div class="new-head"><div><h2 id="new-title">New message</h2><p id="new-sub" class="crop-hint"></p></div>' +
      '<button class="btn-round sm" data-action="new-cancel" aria-label="Close">' + ico('x', 'sm') + '</button></div>' +
      '<label class="field" for="new-search">' + ico('search', 'sm') + '<input id="new-search" type="search" placeholder="Search friends" autocomplete="off"></label>' +
      '<ul class="pick-list" id="pick-list"></ul>' +
      '<div class="name-wrap" id="group-name" hidden><span class="name-label">Group picture <span>optional</span></span><div class="look"></div><label class="name-label" for="new-name">Group name <span>optional</span></label>' +
      '<label class="field" for="new-name">' + ico('users', 'sm') + '<input id="new-name" maxlength="30" placeholder="e.g. Late night crew" autocomplete="off"></label>' +
      '<p class="name-hint" id="name-hint"></p></div>' +
      '<div class="modal-foot"><button class="btn-pill quiet" data-action="new-cancel">Cancel</button><button class="btn-pill" id="new-go" data-action="new-create" disabled>Start chat</button></div></div>';
    overlay.appendChild(el);
    newDlg = { el: el, picked: [], query: '', draft: { name: '', fallback: '', avatar: null, c1: RINGS[0][0], c2: RINGS[0][1] } };
    el.insertAdjacentHTML('beforeend', '<input type="file" id="file-group" accept="image/*" hidden>'); bindGroupFile(el);
    paintNew();
    el.querySelector('#new-search').focus();
    el.querySelector('#new-search').addEventListener('input', function (e) { newDlg.query = e.target.value.toLowerCase(); paintNewList(); });
    el.querySelector('#pick-list').addEventListener('change', function (e) {
      var id = e.target.value, at = newDlg.picked.indexOf(id);
      if (e.target.checked && at === -1) newDlg.picked.push(id);
      if (!e.target.checked && at !== -1) newDlg.picked.splice(at, 1);
      paintNew(true);
    });
    el.querySelector('#new-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') createNew(); });
    attachEmojiDrawer(el.querySelector('#new-name'));
  }
  function paintNewList() {
    var q = newDlg.query, list = friends().filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1; });
    newDlg.el.querySelector('#pick-list').innerHTML = list.length ? list.map(function (p) {
      var on = newDlg.picked.indexOf(p.id) !== -1;
      return '<li><label class="pick' + (on ? ' on' : '') + '">' + avatar(p, 44, { dot: true }) +
        '<span class="pick-text"><b>' + esc(p.name) + '</b><span>' + esc(p.name.toLowerCase()) + ' · ' + statusText(p.status) + '</span></span>' +
        '<input type="checkbox" value="' + p.id + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(p.name) + '"><span class="chk" aria-hidden="true">' + ico('check', 'sm') + '</span></label></li>';
    }).join('') : '<li class="pick-empty">No friends match that search.</li>';
  }
  function paintNew(keepFocus) {
    var n = newDlg.picked.length, go = newDlg.el.querySelector('#new-go'), sub = newDlg.el.querySelector('#new-sub');
    sub.textContent = n === 0 ? 'Pick one person for a chat, or a few for a group.' : n === 1 ? 'A chat with ' + person(newDlg.picked[0]).name + '.' : 'A group of ' + (n + 1) + ' including you. Groups hold up to 10.';
    go.disabled = n === 0; go.textContent = n > 1 ? 'Create group' : 'Start chat';
    newDlg.el.querySelector('#group-name').hidden = n < 2;
    newDlg.draft.fallback = newDlg.picked.map(function (id) { return person(id).name; }).join(', ');
    if (n > 1) newDlg.el.querySelector('#name-hint').textContent = 'Leave it blank and the group will be called \u201C' + newDlg.picked.map(function (id) { return person(id).name; }).join(', ') + '\u201D.';
    var focused = keepFocus && document.activeElement && document.activeElement.value;
    paintNewList(); paintLook(newDlg.el, newDlg.draft);
    if (focused) { var again = newDlg.el.querySelector('input[type=checkbox][value="' + focused + '"]'); if (again) again.focus(); }
  }
  function closeNew() { if (newDlg) { newDlg.el.remove(); newDlg = null; } }
  function createNew() {
    if (!newDlg || !newDlg.picked.length) return;
    var ids = newDlg.picked.slice(), name = newDlg.el.querySelector('#new-name').value.trim(), dr = newDlg.draft;
    S.createConversation(ids, name, ids.length > 1 ? { avatar: dr.avatar, c1: dr.c1, c2: dr.c2 } : null).then(function (r) {
      closeNew();
      return openConversation(r.id).then(function () {
        if (r.created) { chime('join'); toast(ids.length > 1 ? 'Group created' : 'Chat started'); }
        else toast('Opened your chat with ' + person(ids[0]).name);
        var inp = $('#composer-input'); if (inp) inp.focus();
      });
    });
  }

  /* A photo, file or GIF waits in a tray above the box. Whatever you type goes with it as one message. */
  function sendText() {
    var input = $('#composer-input'), text = input.value.trim(), d = state.draft;
    if (!text && !d) { input.focus(); return; }
    var payload;
    var fxm = !d && /^\/(confetti|fireworks|hearts)\b\s*([\s\S]*)$/i.exec(text);
    if (fxm) { input.value = ''; closeMention(); sendEffect(fxm[1].toLowerCase(), fxm[2].trim()); return; }
    if (!d) payload = { type: 'text', text: text, replyTo: state.replyTo };
    else if (d.kind === 'image') {
      payload = d.items.length > 1 ? { type: 'image', text: text, image: d.items[0].image, images: d.items.map(function (x) { return { image: x.image, name: x.name, file: x.file }; }) } : { type: 'image', text: text, image: d.items[0].image, name: d.items[0].name, file: d.items[0].file };
      payload.replyTo = state.replyTo;
    } else if (d.kind === 'file') payload = { type: 'file', text: text, file: d.file, replyTo: state.replyTo };
    else payload = { type: 'gif', text: text, gif: d.gif, replyTo: state.replyTo };
    input.value = ''; state.replyTo = null; state.draft = null; closeMention(); closePopovers(); renderReply(); renderDraft(); chime('send');
    S.sendMessage(state.convId, payload);
  }
  function renderDraft() {
    var slot = $('#draft-slot'), input = $('#composer-input'), d = state.draft;
    if (!slot) return;
    if (input) input.placeholder = d ? 'Add a message (optional)' : 'Write a message';
    if (!d) { slot.innerHTML = ''; return; }
    var body;
    if (d.kind === 'image') {
      body = '<div class="dr-thumbs">' + d.items.map(function (it, i) {
        return '<span class="dr-thumb"><img src="' + esc(it.image) + '" alt="' + esc(it.name || 'Photo') + '"><button type="button" class="dr-x" data-action="draft-remove" data-i="' + i + '" aria-label="Remove ' + esc(it.name || 'photo') + '">' + ico('x', 'sm') + '</button></span>';
      }).join('') + '</div><span class="dr-meta"><b>' + (d.items.length > 1 ? d.items.length + ' photos' : esc(d.items[0].name || 'Photo')) + '</b><span>' + (d.items.length > 1 ? esc(d.items.map(function (x) { return x.name; }).filter(Boolean).join(', ')) : 'Photo') + '</span></span>';
    } else if (d.kind === 'file') {
      body = '<span class="dr-ico">' + ico('file-text') + '</span><span class="dr-meta"><b>' + esc(d.file.name) + '</b><span>' + esc(d.file.size) + '</span></span>';
    } else body = (d.gif.url ? '<span class="dr-thumbs"><span class="dr-thumb"><img src="' + esc(d.gif.url) + '" alt=""></span></span>' : '<span class="dr-gif">' + esc(d.gif.emoji) + '</span>') + '<span class="dr-meta"><b>GIF</b><span>' + esc(d.gif.label) + '</span></span>';
    slot.innerHTML = '<div class="draft-strip">' + body + '<button type="button" class="btn-round sm" data-action="draft-clear" aria-label="Remove attachment">' + ico('x', 'sm') + '</button></div>';
  }
  function stage(draft) {
    var d = state.draft;
    if (draft.kind === 'image' && d && d.kind === 'image') d.items = d.items.concat(draft.items).slice(0, 10); else state.draft = draft;
    renderDraft(); var i = $('#composer-input'); if (i) i.focus();
  }
  function stageFiles(files) {
    var list = [].slice.call(files || []); if (!list.length) return;
    var imgs = list.filter(function (x) { return /^image\//.test(x.type); });
    if (imgs.length) stage({ kind: 'image', items: imgs.map(function (x) { return { image: URL.createObjectURL(x), name: x.name || 'Pasted image.png', file: x }; }) });
    else stage({ kind: 'file', file: { name: list[0].name, size: fmtSize(list[0].size), blob: list[0] } });
  }
  /* Effects. A reaction of 🎉 or 🎆 sets one off (only when you are adding it, never when taking it away). */
  function reactFx(messageId, emoji) {
    var fx = C.fx && C.fx.forEmoji(emoji); if (!fx) return;
    var m = state.messages.filter(function (x) { return x.id === messageId; })[0], mine = m && (m.reactions || []).some(function (r) { return r.emoji === emoji && r.mine; });
    if (!mine) C.fx.play(fx);
  }
  function sendEffect(name, text) {
    var def = { confetti: '🎉', fireworks: '🎆', hearts: '💖' };
    sendRich({ type: 'text', text: text || def[name] || '🎉', effect: name }); if (C.fx) C.fx.play(name);
  }
  /* Owner picks a picture, types a name, presses Add. (Done inline: desktop apps can't show a pop-up question box.) */
  function addEmojiFlow() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var sug = (f.name || 'emoji').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
      state.emojiDraft = { file: f, url: URL.createObjectURL(f), name: sug.length >= 2 ? sug : 'emoji', err: '' }; renderPopover();
      var n = $('#emoji-name'); if (n) { n.focus(); n.select(); }
    };
    inp.click();
  }
  function saveEmojiDraft() {
    var d = state.emojiDraft, n = $('#emoji-name'); if (!d) return; d.name = n ? n.value : d.name;
    S.addCustomEmoji(d.name, d.file).then(function (r) {
      if (!r.ok) { d.err = r.error || 'Couldn’t add it'; renderPopover(); var x = $('#emoji-name'); if (x) x.focus(); return; }
      state.emojiDraft = null; toast(':' + r.name + ': added'); renderPopover();
    });
  }
  function sendRich(payload) {
    payload.replyTo = state.replyTo; state.replyTo = null; renderReply(); closePopovers(); chime('send');
    S.sendMessage(state.convId, payload);
  }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-action]');
    if (!t) {
      if (!ev.target.closest('.popover')) closePopovers();
      if (!ev.target.closest('.select-wrap')) setSelect(false);
      return;
    }
    var a = t.dataset.action;
    if (a === 'edit-scrim') { if (ev.target === t) closeEdit(); return; }
    if (a === 'new-scrim') { if (ev.target === t) closeNew(); return; }
    if (a === 'crop-scrim') { if (ev.target === t) closeCrop(); return; }
    if (a === 'ag-scrim') { if (ev.target === t) closeAG(); return; }
    if (a === 'settings-close') { if (ev.target === t) { state.settings = false; renderSettings(); } return; }
    if (a !== 'select-toggle' && a !== 'select-option') setSelect(false);
    if (!ev.target.closest('.popover') && a !== 'emoji-open' && a !== 'gif-open' && a !== 'attach-open' && a !== 'react-open' && a !== 'sb-open') closePopovers();

    switch (a) {
      case 'filter':
        state.filter = t.dataset.value;
        document.querySelectorAll('[data-action="filter"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); });
        renderList(); break;
      case 'select-conv': openConversation(t.dataset.id); break;
      case 'search-filter': state.sf = t.dataset.k; paintSearch(state.query.trim()); break;
      case 'search-go': {
        var cid = t.dataset.conv, mid = t.dataset.msg;
        state.query = ''; state.sf = 'all'; $('#search').value = '';
        openConversation(cid).then(function () {
          var row = mid && $('.msg[data-id="' + mid + '"]');
          if (row) { row.scrollIntoView({ block: 'center' }); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
        }); break;
      }
      case 'toggle-details':
        state.detailsOpen = !state.detailsOpen;
        $('#shell').classList.toggle('details-open', state.detailsOpen);
        t.setAttribute('aria-pressed', String(state.detailsOpen)); break;
      case 'join-call': S.joinCall(state.convId); chime('join'); break;
      case 'start-call': S.startCall(state.convId); chime('join'); break;
      case 'leave-call': S.leaveCall(); chime('leave'); break;
      case 'call-audio': S.startDirectCall(state.convId, 'audio'); break;
      case 'call-video': S.startDirectCall(state.convId, 'video'); break;
      case 'ring-answer': S.answerRing().then(function () { chime('join'); }); break;
      case 'ring-end': { var rr = S.getRing(); S.endRing(); if (rr) toast(rr.direction === 'out' ? 'Call cancelled' : 'You declined ' + person(rr.personId).name + "'s call"); break; }
      case 'ring-dismiss': S.endRing(); break;
      case 'sim-call': {
        state.settings = false; renderSettings();
        var order = ['chiroben', 'plushpants', 'kid']; state.simN = ((state.simN || 0) + 1) % order.length;
        setTimeout(function () { S.simulateIncoming(order[state.simN], t.dataset.kind); }, 350); break;
      }
      case 'toggle-mute': var cl = S.getCall(state.convId); S.setMuted(!cl.muted); break;
      case 'reply': state.replyTo = t.dataset.id; renderReply(); $('#composer-input').focus(); break;
      case 'cancel-reply': state.replyTo = null; renderReply(); break;
      case 'jump':
        var target = $('.msg[data-id="' + t.dataset.id + '"]');
        if (target) { target.scrollIntoView({ block: 'center' }); target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash'); }
        break;
      case 'react-open': renderReactPopover(t, t.dataset.id); break;
      case 'react-pick': reactFx(t.dataset.id, t.dataset.emoji); S.toggleReaction(state.convId, t.dataset.id, t.dataset.emoji); closePopovers(); break;
      case 'react-toggle': reactFx(t.dataset.id, t.dataset.emoji); S.toggleReaction(state.convId, t.dataset.id, t.dataset.emoji); break;
      case 'send-effect': sendEffect(t.dataset.effect, ''); break;
      case 'emoji-manage': state.emojiManage = !state.emojiManage; renderPopover(); break;
      case 'emoji-remove': S.removeCustomEmoji(t.dataset.name).then(function () { renderPopover(); }); break;
      case 'emoji-add-open': addEmojiFlow(); break;
      case 'emoji-save': saveEmojiDraft(); break;
      case 'emoji-cancel': state.emojiDraft = null; renderPopover(); break;
      case 'emoji-open': state.popover = state.popover && state.popover.type === 'emoji' ? null : { type: 'emoji' }; renderPopover(); break;
      case 'emoji-pick': var inp = $('#composer-input'); inp.value += t.dataset.emoji; inp.focus(); break;
      case 'gif-open': state.popover = state.popover && state.popover.type === 'gif' ? null : { type: 'gif' }; renderPopover(); break;
      case 'gif-tab': gifs.tab = t.dataset.tab; gifs.manage = false; renderPopover(); break;
      case 'lib-pick': var lg = (S.libraryGifs() || []).filter(function (x) { return x.id === t.dataset.id; })[0]; if (!lg) break; closePopovers(); stage({ kind: 'gif', gif: { label: lg.name, url: lg.url, w: lg.w, h: lg.h, id: 'lib-' + lg.id } }); break;
      case 'lib-add': libAddFlow(); break;
      case 'lib-save': libSave(); break;
      case 'lib-cancel': gifs.draft = null; paintLib(); break;
      case 'lib-manage': gifs.manage = !gifs.manage; paintLib(); break;
      case 'lib-remove': S.removeLibraryGif(t.dataset.id).then(paintLib); break;
      case 'retry-load': if (state.convId) { var btn0 = t; btn0.disabled = true; openConversation(state.convId); } break;
      case 'sb-open': toggleSoundboard(t); break;
      case 'lb-add': lbAdd(t.dataset.kind); break;
      case 'lb-save': lbSave(); break;
      case 'lb-cancel': lb.draft = null; paintLibrary(); break;
      case 'lb-play': var lc = clipById(t.dataset.id); if (lc) playUrl(lc.url); break;
      case 'lb-remove':
        var key = t.dataset.kind + ':' + t.dataset.id;
        if (lb.confirm !== key) { lb.confirm = key; paintLibrary(); clearTimeout(lb.t); lb.t = setTimeout(function () { lb.confirm = ''; paintLibrary(); }, 3500); break; }
        lb.confirm = ''; (t.dataset.kind === 'emoji' ? S.removeCustomEmoji(t.dataset.id) : t.dataset.kind === 'gif' ? S.removeLibraryGif(t.dataset.id) : S.removeSound(t.dataset.id)).then(function () { paintLibrary(); }); break;
      case 'sb-play': playClip(t.dataset.id); break;
      case 'sb-add': sbAddFlow(); break;
      case 'sb-save': sbSave(); break;
      case 'sb-cancel': sb.draft = null; renderSbPop(); break;
      case 'sb-manage': sb.manage = !sb.manage; renderSbPop(); break;
      case 'sb-remove': S.removeSound(t.dataset.id).then(renderSbPop); break;
      case 'gif-pick': var g = gifs.items[+t.dataset.i]; if (!g) break; closePopovers(); stage({ kind: 'gif', gif: { label: g.title, url: g.url, w: g.w, h: g.h, id: g.id } }); break;
      case 'draft-remove': if (state.draft && state.draft.kind === 'image') { state.draft.items.splice(+t.dataset.i, 1); if (!state.draft.items.length) state.draft = null; renderDraft(); } break;
      case 'draft-clear': state.draft = null; renderDraft(); break;
      case 'attach-open': state.popover = state.popover && state.popover.type === 'attach' ? null : { type: 'attach' }; renderPopover(); break;
      case 'attach-image': closePopovers(); $('#file-image').click(); break;
      case 'attach-file': closePopovers(); $('#file-any').click(); break;
      case 'send': sendText(); break;
      case 'new-open': openNew(); break;
      case 'mention-pick': pickMention(+t.dataset.i); break;
      case 'banner-open': closeBanner(); openConversation(t.dataset.id); break;
      case 'banner-close': closeBanner(); break;
      case 'sim-kid': { var ord = ['dnd', 'online', 'away'], cur = person('kid').status; S.setFriendStatus('kid', ord[(ord.indexOf(cur) + 1) % ord.length]).then(function () { toast('Kid is now ' + statusText(person('kid').status)); renderDetails(); renderHead(); }); break; }
      case 'sim-mention': {
        state.settings = false; renderSettings();
        var target = state.convId === 'hangar' ? 'weekend' : 'hangar', from = target === 'hangar' ? 'chiroben' : 'kid';
        setTimeout(function () { S.simulateMention(target, from); }, 500); break;
      }
      case 'new-cancel': closeNew(); break;
      case 'edit-group': openEdit(); break;
      case 'edit-cancel': closeEdit(); break;
      case 'edit-save': saveEdit(); break;
      case 'grp-photo': { var gf = overlay.querySelector('#file-group'); if (gf) gf.click(); break; }
      case 'grp-unphoto': { var ad = activeDlg(); ad.draft.avatar = null; paintLook(ad.el, ad.draft); break; }
      case 'grp-ring': { var ar = activeDlg(), rg2 = RINGS[+t.dataset.i]; ar.draft.c1 = rg2[0]; ar.draft.c2 = rg2[1]; paintLook(ar.el, ar.draft); break; }
      case 'new-create': createNew(); break;
      case 'acc-toggle':
        state.acc[t.dataset.key] = !state.acc[t.dataset.key];
        var box = t.closest('.acc'); box.classList.toggle('open', state.acc[t.dataset.key]); t.setAttribute('aria-expanded', String(state.acc[t.dataset.key])); break;
      case 'settings-open': state.settings = true; renderSettings(); break;
      case 'settings-close-btn': state.settings = false; renderSettings(); break;
      case 'si-back': state.signin = { step: 'email', email: (state.signin && state.signin.email) || '' }; renderSignIn(); break;
      case 'si-resend': S.requestCode(state.signin.email).then(function () { toast('A new code is on its way.'); }, function (e) { siError(e, '#si-otp'); }); break;
      case 'palette':
        state.palette = t.dataset.value; store.set('palette', state.palette); applyPalette();
        document.querySelectorAll('[data-action="palette"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); }); break;
      case 'theme':
        state.theme = t.dataset.value; store.set('theme', state.theme); applyTheme();
        document.querySelectorAll('[data-action="theme"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); }); break;
      case 'toggle-sounds':
        state.sounds = !state.sounds; store.set('sounds', state.sounds ? 'on' : 'off');
        t.setAttribute('aria-checked', String(state.sounds)); if (state.sounds) chime('join'); break;
      case 'select-toggle': { var wrap = t.closest('.select-wrap'); setSelect(wrap.querySelector('.select-list').hidden, wrap, false); break; }
      case 'select-option': {
        var wrap2 = t.closest('.select-wrap'), key = t.dataset.sel, n = +t.dataset.i;
        state.dev[key] = n; store.set('dev.' + key, n);
        if (liveHW() && DEV[key].ids) { var chosenP = liveHW().choose(key, DEV[key].ids[n]); if (key === 'spk') setTimeout(function () { liveHW().ping(); }, 120); }
        wrap2.querySelector('.label').textContent = DEV[key].list[n];
        wrap2.querySelectorAll('li').forEach(function (li, i) {
          li.setAttribute('aria-selected', String(i === n));
          var chk = li.querySelector('.ico'); if (chk) chk.remove();
          if (i === n) li.insertAdjacentHTML('beforeend', ico('check', 'sm'));
        });
        setSelect(false); wrap2.querySelector('.select-btn').focus(); break;
      }
      case 'set-tab': state.setTab = t.dataset.tab; state.pttListening = false; paintPane(); break;
      case 'mic-test': if (state.micTest) stopMicTest(); else startMicTest(); $('#mic-test-label').textContent = state.micTest ? 'Stop test' : 'Test microphone'; break;
      case 'toggle-hear': state.hearSelf = !state.hearSelf; t.setAttribute('aria-checked', String(state.hearSelf)); if (meterTimer && meterTimer.hear) meterTimer.hear(state.hearSelf); break;
      case 'profile-mode': state.profileMode = t.dataset.mode; store.set('profileMode', state.profileMode); if (liveHW()) liveHW().setProfile(state.profileMode); if (state.micTest) { stopMicTest(); startMicTest(); } document.querySelectorAll('.radio-card').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.mode === state.profileMode)); }); break;
      case 'toggle-ptt': { state.ptt = !state.ptt; store.set('ptt', state.ptt ? 'on' : 'off'); state.pttListening = false; paintPane(); var pcl = S.getCall(state.convId); if (pcl && pcl.joined) S.setMuted(state.ptt); break; }
      case 'ptt-key': state.pttListening = true; $('#ptt-label').textContent = pttLabel(); t.classList.add('listening'); t.focus(); break;
      case 'toggle-mirror':
        state.mirror = !state.mirror; store.set('mirror', state.mirror ? 'on' : 'off'); t.setAttribute('aria-checked', String(state.mirror));
        var cp = $('#cam-preview .cam-art'); if (cp) cp.classList.toggle('mirror', state.mirror); var cv = $('#cam-preview .live-video'); if (cv) cv.classList.toggle('mirror', state.mirror); break;
      case 'toggle-alerts': state.alerts = !state.alerts; store.set('alerts', state.alerts ? 'on' : 'off'); t.setAttribute('aria-checked', String(state.alerts)); break;
      case 'toggle-autoaway': state.autoAway = !state.autoAway; store.set('autoAway', state.autoAway ? 'on' : 'off'); t.setAttribute('aria-checked', String(state.autoAway)); break;
      case 'change-avatar': $('#file-avatar').click(); break;
      case 'avatar-gif': openAvatarGif(function (data) { S.updateProfile({ avatar: data }).then(function () { refreshSettingsAvatar(); refreshAvatarEverywhere(); }); }); break;
      case 'grp-gif': { var gd = activeDlg(); if (gd) openAvatarGif(function (data) { gd.draft.avatar = data; paintLook(gd.el, gd.draft); }); break; }
      case 'ag-tab': if (ag) agTab(t.dataset.tab); break;
      case 'ag-pick': agPick(+t.dataset.i); break;
      case 'ag-close': closeAG(); break;
      case 'about-check': aboutCheck(); break;
      case 'sfx-play': { var so = sfxMap()[t.dataset.k]; if (so) playOverride(t.dataset.k, so); else chime(t.dataset.k); break; }
      case 'sfx-pick': sfxPick(t.dataset.k); break;
      case 'sfx-reset': { var rm = sfxMap(); delete rm[t.dataset.k]; sfxSave(rm); sfxRepaint(''); break; }
      case 'ring-pick': { var rg = RINGS[+t.dataset.i]; S.updateProfile({ c1: rg[0], c2: rg[1] }).then(function () { refreshSettingsAvatar(); refreshAvatarEverywhere(); }); break; }
      case 'crop-cancel': closeCrop(); break;
      case 'crop-save': saveCrop(); break;
      case 'sign-out':
        state.settings = false; renderSettings();
        S.signOut().then(function () { state.screen = 'signin'; state.signin = { step: 'email', email: '' }; renderSignIn(); }); break;
      default: if (C.actions && C.actions[a]) C.actions[a](t, ev);
    }
  });

  document.addEventListener('mousedown', function (ev) { if (ev.target.closest && ev.target.closest('.mention-opt')) ev.preventDefault(); });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'search') { state.query = ev.target.value; renderList(); }
    if (ev.target.dataset && ev.target.dataset.vol) { state.vol[ev.target.dataset.vol] = +ev.target.value; store.set('vol.' + ev.target.dataset.vol, ev.target.value); var hwv = liveHW(); if (hwv) { if (ev.target.dataset.vol === 'inp') hwv.setInputVolume(+ev.target.value); else { hwv.setOutputVolume(+ev.target.value); hwv.ping(); } } }
    if (ev.target.id === 'composer-input') { updateMention(); if (S.sendTyping && state.convId && ev.target.value) S.sendTyping(state.convId); }
  });
  document.addEventListener('keydown', function (ev) {
    if (state.pttListening) {
      ev.preventDefault(); ev.stopPropagation(); state.pttListening = false;
      if (ev.key !== 'Escape') { state.pttKey = ev.key === ' ' ? 'Space' : ev.key.length === 1 ? ev.key.toUpperCase() : ev.key; store.set('pttKey', state.pttKey); }
      var pl = $('#ptt-label'); if (pl) { pl.textContent = pttLabel(); pl.parentNode.classList.remove('listening'); }
      return;
    }
    var inList = ev.target.closest && ev.target.closest('.select-list');
    if (ev.target.classList && ev.target.classList.contains('select-btn') && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) { ev.preventDefault(); setSelect(true, ev.target.closest('.select-wrap'), true); return; }
    if (inList) {
      var li = ev.target.closest('li');
      if (ev.key === 'ArrowDown') { ev.preventDefault(); (li.nextElementSibling || li.parentNode.firstElementChild).focus(); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); (li.previousElementSibling || li.parentNode.lastElementChild).focus(); return; }
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); li.click(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); var sb = inList.closest('.select-wrap').querySelector('.select-btn'); setSelect(false); sb.focus(); return; }
    }
    if (ev.key === 'Escape' && selectOpen()) { setSelect(false); return; }
    if (state.mention && ev.target.id === 'composer-input') {
      var mt = state.mention;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); mt.i = (mt.i + (ev.key === 'ArrowDown' ? 1 : mt.opts.length - 1)) % mt.opts.length; paintMention(); return; }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pickMention(mt.i); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeMention(); return; }
    }
    if (ev.key === 'Enter' && ev.target.id === 'composer-input') { ev.preventDefault(); sendText(); }
    if (ev.key === 'Escape' && ev.target.id === 'search' && state.query) { ev.preventDefault(); ev.stopPropagation(); state.query = ''; ev.target.value = ''; renderList(); return; }
    if (ev.key === 'ArrowDown' && ev.target.id === 'search' && state.query) { var h0 = $('#conv-list .hit'); if (h0) { ev.preventDefault(); h0.focus(); } }
    if (ev.key === 'Escape') {
      if (C.ui.escape && C.ui.escape()) return;
      if (crop) { closeCrop(); return; }
      if (newDlg) { closeNew(); return; }
      if (editDlg) { closeEdit(); return; }
      if (state.settings) { state.settings = false; renderSettings(); }
      else if (state.popover || overlay.querySelector('.react-pop')) closePopovers();
      else if (state.draft) { state.draft = null; renderDraft(); }
      else if (state.replyTo) { state.replyTo = null; renderReply(); }
    }
  });
  function pttMatch(ev) { var k = ev.key === ' ' ? 'Space' : ev.key.length === 1 ? ev.key.toUpperCase() : ev.key; return k === state.pttKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target.tagName || '')); }
  document.addEventListener('keydown', function (ev) { if (state.ptt && !ev.repeat && !state.pttListening && state.screen === 'app' && pttMatch(ev)) { var cl = S.getCall(state.convId); if (cl && cl.joined) S.setMuted(false); } });
  document.addEventListener('keyup', function (ev) { if (state.ptt && state.screen === 'app' && pttMatch(ev)) { var cl = S.getCall(state.convId); if (cl && cl.joined) S.setMuted(true); } });
  document.addEventListener('paste', function (ev) {
    if (state.screen !== 'app' || !state.convId || !ev.clipboardData) return;
    var files = [].slice.call(ev.clipboardData.files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (files.length) { ev.preventDefault(); stageFiles(files); }
  });
  document.addEventListener('dragover', function (ev) { if (state.screen === 'app' && state.convId && ev.dataTransfer && [].indexOf.call(ev.dataTransfer.types || [], 'Files') > -1) { ev.preventDefault(); document.body.classList.add('dropping'); } });
  document.addEventListener('dragleave', function (ev) { if (!ev.relatedTarget) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', function (ev) {
    document.body.classList.remove('dropping');
    if (state.screen !== 'app' || !state.convId || !ev.dataTransfer || !ev.dataTransfer.files.length) return;
    ev.preventDefault(); stageFiles(ev.dataTransfer.files);
  });
  document.addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (ev.target.id === 'file-image' || ev.target.id === 'file-any') stageFiles(ev.target.files);
    ev.target.value = '';
  });
  document.addEventListener('submit', function (ev) {
    if (ev.target.id !== 'signin-form') return;
    ev.preventDefault();
    var old = $('#si-error'); if (old) old.remove();
    var st = state.signin = state.signin || { step: 'email', email: '' };
    if (st.step === 'email') {
      var email = $('#si-email').value.trim(); siBusy(true, 'Sending…');
      S.requestCode(email).then(function () { st.email = email; st.step = 'code'; renderSignIn(); },
        function (e) { siBusy(false); siError(e, '#si-email'); });
    } else if (st.step === 'code') {
      siBusy(true, 'Checking…');
      S.verifyCode(st.email, $('#si-otp').value).then(function (r) { if (r && r.isNew) { st.step = 'join'; renderSignIn(); } else enterApp(); },
        function (e) { siBusy(false); siError(e, '#si-otp'); });
    } else {
      siBusy(true, 'Joining…');
      S.joinWithInvite({ name: $('#si-name').value, inviteCode: $('#si-code').value }).then(enterApp,
        function (e) { siBusy(false); siError(e, e && (e.code === 'no-name') ? '#si-name' : '#si-code'); });
    }
  });


  document.addEventListener('keydown', function (e) { var id = e.target && e.target.id; if (e.key === 'Enter' && id) { if (id === 'emoji-name') { e.preventDefault(); saveEmojiDraft(); } else if (id === 'lib-name') { e.preventDefault(); libSave(); } else if (id === 'sb-name' || id === 'sb-emoji') { e.preventDefault(); sbSave(); } else if (id === 'lb-name' || id === 'lb-emoji') { e.preventDefault(); lbSave(); } } });

  /* ---------- Live events ---------- */
  S.on('reacted', function (e) { var fx = C.fx && C.fx.forEmoji(e.emoji); if (fx && (!e.conversationId || e.conversationId === state.convId)) C.fx.play(fx); });
  S.on('emoji', function () { if (state.popover && state.popover.type === 'emoji') renderPopover(); if (state.convId) renderMessages({ scroll: false }); });
  S.on('connection', function (e) { if (e && e.online && !e.reconnecting && state.loadError && state.convId === state.loadError) openConversation(state.convId); });
  S.on('message', function (e) {
    if (e.conversationId === state.convId) {
      S.loadHistory(e.conversationId).then(function (list) {
        if (state.loadError === e.conversationId) state.loadError = null;
        state.messages = list;
        var box = $('#messages'), nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
        renderMessages({ scroll: nearBottom || !e.updated });
        renderReply();
        if (state.detailsOpen && $('#details')) renderDetails();
      });
      var cvv = state.conversations.filter(function (x) { return x.id === e.conversationId; })[0];
      if (e.incoming && !(cvv && cvv.muted && !S.mentionsYou(e.message.text))) chime(S.mentionsYou(e.message.text) ? 'mention' : 'message');
      if (e.incoming && !e.updated && e.message && e.message.effect && C.fx) C.fx.play(e.message.effect);
      if (e.incoming && S.mentionsYou(e.message.text)) setTimeout(function () { var row = document.querySelector('.msg[data-id="' + e.message.id + '"]'); if (row) row.classList.add('ping'); }, 120);
    } else if (e.incoming && S.mentionsYou(e.message.text)) {
      /* @mentions break through muted chats, but never through Do not disturb. */
      chime('mention'); if (state.alerts && !quiet()) showMentionBanner(e.conversationId, e.message);
    } else if (e.incoming) {
      var cv2 = state.conversations.filter(function (x) { return x.id === e.conversationId; })[0];
      if (!(cv2 && cv2.muted)) chime('message');
    }
  });
  S.on('typing', syncTyping);
  S.on('ring', function () { if (state.screen === 'app') renderRing(); });
  S.on('update', function () { repaintAbout(); });
  S.on('conversations', function () { if (state.screen === 'app' && state.convId && !currentConv() && state.conversations.length) { openConversation(state.conversations[0].id); } if (state.screen === 'app') { renderList(); if ($('#me-card')) renderMe(); if ($('#chat-head') && currentConv()) renderHead(); } });
  S.on('call', function (e) {
    if (state.screen === 'app' && e && e.joined && e.conversationId !== state.convId && (e.focus || /^(chiroben|plushpants|kid)$/.test(e.conversationId))) { chime('join'); openConversation(e.conversationId); return; }
    if (state.screen !== 'app' || e.conversationId !== state.convId) { renderList(); return; }
    var cl = S.getCall(state.convId);
    if (cl && cl.joined && state.callSig === callSig(cl) && document.querySelector('#call-slot [data-person]')) { updateSpeaking(cl); renderHead(); renderList(); return; }
    renderCall(); renderHead(); renderList();
  });

  /* ---------- Hand a few helpers to extras.js (menus, status, Tower, screen-share picker) ---------- */
  C.actions = C.actions || {};
  C.ui = C.ui || {};
  C.ui.setProfileMode = function (m) { state.profileMode = m; document.querySelectorAll('.radio-card').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.mode === m)); }); };
  Object.assign(C.ui, {
    state: state, store: store, overlay: overlay, esc: esc, ico: ico, avatar: avatar, person: person, entity: entity, initial: initial, statusText: statusText,
    chime: chime, toast: toast, scene: scene, imagesOf: imagesOf, quiet: quiet, richText: richText, snippet: snippet, camArt: camArt, screenArt: screenArt,
    currentConv: currentConv, openConversation: openConversation, openEdit: openEdit, closePopovers: closePopovers, renderReactPopover: renderReactPopover,
    renderList: renderList, renderHead: renderHead, renderMessages: renderMessages, renderDetails: renderDetails, renderMe: renderMe, renderCall: renderCall, renderSettings: renderSettings, paintPane: paintPane,
    showBanner: showBanner, closeBanner: closeBanner
  });

  /* ---------- Start ---------- */
  applyTheme(); applyPalette();
  renderVersion();
  var live = C.config && C.config.backend === 'live';
  (live && S.restoreSession ? S.restoreSession() : Promise.resolve(true)).then(function (ok) {
    if (!ok) state.screen = 'signin';
    return S.listConversations();
  }).then(function (list) {
    state.conversations = list;
    if (state.screen === 'signin') renderSignIn();
    else { mountApp(); openConversation(live ? (list.length ? list[0].id : null) : state.convId); }
  });
})();
