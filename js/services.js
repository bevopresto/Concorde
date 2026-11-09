/*
  Pretend services for the first click-through.

  This file is the "agreement" the real workstreams will build against. The interface only talks to
  Concorde.services, never to the data directly. Later:
    - the chat and accounts agent replaces the account and chat functions with real storage,
    - the calls agent replaces the call functions with real voice and screen sharing.
  The interface should not need to change. Every function that will touch the network is async here too.
*/
(function () {
  var C = (window.Concorde = window.Concorde || {});
  var D = C.data;

  function svgEmoji(c) { return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="' + c + '"/><circle cx="11" cy="13" r="2" fill="#fff"/><circle cx="21" cy="13" r="2" fill="#fff"/><path d="M9 20q7 7 14 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>'); }
  var mockEmoji = [{ name: 'partyblob', url: svgEmoji('#e8590c') }, { name: 'sadblob', url: svgEmoji('#4263eb') }];
  var mockLib = [{ id: 'lg1', name: 'happy dance', url: svgEmoji('#2b8a3e'), w: 200, h: 200 }];
  var mockSounds = [{ id: 'sn1', name: 'Airhorn', emoji: '📯', url: '' }, { id: 'sn2', name: 'Sad trombone', emoji: '🎺', url: '' }];
  var listeners = { message: [], typing: [], call: [], conversations: [], ring: [], tower: [], update: [], connection: [], invites: [], joined: [], poked: [], emoji: [], reacted: [], library: [], sound: [] };
  function emit(type, payload) { listeners[type].forEach(function (fn) { fn(payload); }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Prototype clock: continues from the last made-up message (8:30 pm) so new messages stay in order.
  var fakeMinutes = 20 * 60 + 33;
  function nowLabel() {
    fakeMinutes += 1;
    var h = Math.floor(fakeMinutes / 60) % 24, m = fakeMinutes % 60, ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function conv(id) { return D.conversations.filter(function (c) { return c.id === id; })[0]; }
  var uid = 0;

  var me = D.people.you;
  function U_store() { return (window.Concorde && Concorde.ui && Concorde.ui.store) || { get: function (k, d) { return d; }, set: function () {} }; }
  var FORMER = { id: 'former', name: 'Former member', c1: '#b9b2cf', c2: '#8f87ad', status: 'invisible', avatar: null };
  var update = { available: false, version: null, installing: false };
  var net = { online: true, reconnecting: false }, stash = null, ownerView = true;
  var invites = [{ id: 'iv1', email: 'mate@example.com', status: 'joined', time: '3 days ago' }, { id: 'iv2', email: 'cousin@example.com', status: 'pending', time: 'Yesterday' }];
  var tower = [
    { id: 't1', from: 'kid', type: 'idea', text: 'A quiet mode for the call screen that hides everyone except whoever is talking.', status: 'planned', plus: ['kid', 'chiroben', 'plushpants'], comments: [{ from: 'chiroben', text: 'Yes please, this would be great on my laptop.' }], seen: true, time: 'Yesterday' },
    { id: 't2', from: 'plushpants', type: 'bug', text: 'The unread number stays on a chat for a second after I open it.', status: 'new', plus: ['plushpants'], comments: [], seen: true, time: '2 days ago' },
    { id: 't3', from: 'chiroben', type: 'idea', text: 'Little birthday messages that pop up on the day.', status: 'done', plus: ['chiroben', 'you'], comments: [], seen: true, time: 'Last week' }
  ];
  var ring = null, ringTimer = null, attempt = 0;
  function setRing(r) { clearTimeout(ringTimer); ring = r; emit('ring', r ? JSON.parse(JSON.stringify(r)) : null); }
  function connectDirect(conversationId, kind) {
    var c = conv(conversationId);
    setRing(null);
    /* A video call starts with both cameras on; the friend comes first, so they are on the big stage and you are the small corner box. */
    c.call = { participants: [c.with], sharing: null, startedAt: Date.now(),
      streams: kind === 'video' ? [{ id: c.with, kind: 'camera' }, { id: 'you', kind: 'camera' }] : [] };
    C.services.joinCall(conversationId);
  }
  var call = null;       // { conversationId, joined, muted, sharing, startedAt, speakingId }
  function dropStream(c, id, kind) { if (c.call && c.call.streams) c.call.streams = c.call.streams.filter(function (s) { return !(s.id === id && s.kind === kind); }); }
  function addStream(c, id, kind) { c.call.streams = c.call.streams || []; dropStream(c, id, kind); c.call.streams.push({ id: id, kind: kind }); }
  var speakTimer = null;

  var replyPool = [
    'Ha, nice one.', 'Sounds good to me.', 'Give me two minutes.', 'Agreed. Let us do it.',
    'Oh that is great.', 'I can do that.', 'Love that.', 'Let me check and get back to you.'
  ];

  var mentionPool = ['@bevopresto what do you think?', '@bevopresto are you around for this?', 'Over to you @bevopresto', '@bevopresto can you jump in?'];
  var viewing = null;
  function mentionsYou(text) { return /(^|\W)@(bevopresto|everyone)\b/i.test(text || ''); }
  /* An incoming message in a chat you are not looking at adds to its unread count, and a mention marks it with an @. */
  function noteIncoming(id, msg) {
    var c = conv(id); if (!c || viewing === id) return;
    c.unread = (c.unread || 0) + 1;
    if (mentionsYou(msg.text)) c.mention = true;
  }
  function otherMemberIds(c) {
    return c.type === 'direct' ? [c.with] : c.members.filter(function (m) { return m !== 'you'; });
  }

  C.services = {
    /* ----- Accounts ----- */
    getCurrentUser: function () { return me; },
    /* Signing in has three steps. 1) requestCode: an email with a 6-digit one-time code is sent. 2) verifyCode: the code is checked;
       the answer says whether this email already has an account. 3) New people only: joinWithInvite with a display name and an invite code.
       Prototype: any 6 digits work, 000000 fails, and an email containing "new" is treated as a brand new person. */
    requestCode: function (email) {
      return wait(450).then(function () {
        if (!net.online) throw { code: 'offline', message: 'Concorde can\u2019t reach the server. Check your internet and try again.' };
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim())) throw { code: 'bad-email', message: 'That email doesn\u2019t look right. Check it and try again.' };
        return true;
      });
    },
    verifyCode: function (email, code) {
      return wait(450).then(function () {
        if (!net.online) throw { code: 'offline', message: 'Concorde can\u2019t reach the server. Check your internet and try again.' };
        var c = String(code || '').replace(/\s/g, '');
        if (!/^\d{6}$/.test(c) || c === '000000') throw { code: 'bad-code', message: 'That code didn\u2019t match, or it has expired. Check the email and try again.' };
        return { isNew: /new/i.test(email) };
      });
    },
    joinWithInvite: function (details) {
      return wait(300).then(function () {
        var name = String((details && details.name) || '').trim(), code = String((details && details.inviteCode) || '').trim().toUpperCase();
        if (!net.online) throw { code: 'offline', message: 'Concorde can\u2019t reach the server. Check your internet and try again.' };
        if (!name) throw { code: 'no-name', message: 'Choose the name your friends will see.' };
        if (!code) throw { code: 'no-code', message: 'Enter the invite code your friends sent you.' };
        if (code === 'WRONG') throw { code: 'bad-invite', message: 'That invite code didn\u2019t work. Check it with whoever invited you.' };
        me.name = name; return me;
      });
    },
    signOut: function () { return wait(100).then(function () { call = null; clearInterval(speakTimer); }); },
    /* status is 'online', 'away', 'dnd' (do not disturb) or 'invisible' (friends see you as offline, everything still works for you). */
    setStatus: function (status) {
      me.status = status; emit('conversations'); return Promise.resolve(me);
    },
    getPersonVolume: function (id) { return +(U_store().get('vol.p.' + id, 100)); },
    setPersonVolume: function (id, pct) { U_store().set('vol.p.' + id, Math.round(+pct)); },
    updateProfile: function (patch) {
      return wait(80).then(function () { Object.keys(patch).forEach(function (k) { me[k] = patch[k]; }); return me; });
    },

    /* ----- People and conversations ----- */
    getPerson: function (id) { return D.people[id] || FORMER; },
    listConversations: function () { return Promise.resolve(D.conversations); },
    /* Start a chat. One person opens (or makes) a one-to-one chat; several people make a group. Resolves with the conversation id. */
    createConversation: function (memberIds, name, look) {
      var ids = memberIds.filter(function (x) { return x !== 'you'; });
      var found = D.conversations.filter(function (c) {
        /* Only one-to-one chats are reused. Groups are always new, so a friend group can have several. */
        return ids.length === 1 && c.type === 'direct' && c.with === ids[0];
      })[0];
      if (found) return wait(120).then(function () { return { id: found.id, created: false }; });
      var id = (ids.length === 1 ? ids[0] : 'g' + (++uid) + Date.now()), cols = [['#7C5CFA', '#E0549F'], ['#F2A07B', '#7C5CFA'], ['#3FBF8F', '#5B8DEF'], ['#5B8DEF', '#E0549F']][Math.floor(Math.random() * 4)];
      var names = ids.map(function (m) { return D.people[m].name; });
      var c = ids.length === 1 ? { id: id, type: 'direct', with: ids[0], unread: 0, call: null }
        : { id: id, type: 'group', name: name || names.join(', '), members: ['you'].concat(ids), c1: look ? look.c1 : cols[0], c2: look ? look.c2 : cols[1], avatar: look ? look.avatar : null, unread: 0, call: null };
      D.conversations.unshift(c);
      D.messages[id] = [{ id: 'u' + (++uid), from: 'system', type: 'system', time: nowLabel(),
        text: ids.length === 1 ? 'You started a chat with ' + names[0] : 'You created ' + c.name }];
      emit('conversations');
      return wait(160).then(function () { return { id: id, created: true }; });
    },
    /* Rename a group or change its picture. Each change leaves a note in the thread. */
    updateConversation: function (id, patch) {
      var c = conv(id); if (!c || c.type !== 'group') return Promise.resolve(null);
      var who = D.people.you.name, notes = [];
      if (patch.name && patch.name !== c.name) { c.name = patch.name; notes.push({ text: who + ' changed the group name to \u201C' + patch.name + '\u201D', icon: 'pencil' }); }
      var look = ('avatar' in patch && (patch.avatar || null) !== (c.avatar || null)) || (patch.c1 && (patch.c1 !== c.c1 || patch.c2 !== c.c2));
      if ('avatar' in patch) c.avatar = patch.avatar || null;
      if (patch.c1) { c.c1 = patch.c1; c.c2 = patch.c2; }
      if (look) notes.push({ text: who + ' changed the group picture', icon: 'image' });
      notes.forEach(function (n) {
        var msg = { id: 'u' + (++uid), from: 'system', type: 'system', icon: n.icon, text: n.text, time: nowLabel() };
        D.messages[id].push(msg); emit('message', { conversationId: id, message: msg });
      });
      emit('conversations');
      return wait(120).then(function () { return c; });
    },
    setPinned: function (id, on) { var c = conv(id); if (c) { c.pinned = !!on; emit('conversations'); } return Promise.resolve(c); },
    setChatMuted: function (id, on) { var c = conv(id); if (c) { c.muted = !!on; emit('conversations'); } return Promise.resolve(c); },
    /* Hide a one-to-one chat from your list. */
    poke: function (personId) {
      var now = Date.now(); this._pk = this._pk || {};
      if (this._pk[personId] && now - this._pk[personId] < 8000) return Promise.resolve('slow');
      this._pk[personId] = now; return Promise.resolve(true);
    },
    customEmoji: function () { return mockEmoji.slice(); },
    addCustomEmoji: function (name, file) {
      name = String(name || '').toLowerCase().replace(/^:|:$/g, '');
      if (!/^[a-z0-9_]{2,24}$/.test(name)) return Promise.resolve({ ok: false, error: 'Use 2 to 24 letters, numbers or _ for the name.' });
      if (mockEmoji.some(function (e) { return e.name === name; })) return Promise.resolve({ ok: false, error: 'That name is taken.' });
      mockEmoji.push({ name: name, url: (file && file.type && window.URL) ? URL.createObjectURL(file) : svgEmoji('#888') }); emit('emoji'); return Promise.resolve({ ok: true, name: name });
    },
    removeCustomEmoji: function (name) { mockEmoji = mockEmoji.filter(function (e) { return e.name !== name; }); emit('emoji'); return Promise.resolve(true); },
    simulateReacted: function (emoji) { emit('reacted', { conversationId: null, emoji: emoji, from: 'chiroben' }); },
    libraryGifs: function () { return mockLib.slice(); },
    addLibraryGif: function (name, file, w, h) { if (!String(name || '').trim()) return Promise.resolve({ ok: false, error: 'Give it a name.' }); mockLib.unshift({ id: 'lg' + Date.now(), name: name, url: (file && window.URL && file.size != null) ? URL.createObjectURL(file) : svgEmoji('#2b8a3e'), w: w || 200, h: h || 200 }); emit('library'); return Promise.resolve({ ok: true }); },
    removeLibraryGif: function (id) { mockLib = mockLib.filter(function (g) { return g.id !== id; }); emit('library'); return Promise.resolve(true); },
    sounds: function () { return mockSounds.slice(); },
    addSound: function (name, emoji, file) { if (!String(name || '').trim()) return Promise.resolve({ ok: false, error: 'Give it a name.' }); mockSounds.push({ id: 'sn' + Date.now(), name: name, emoji: emoji || '🔊', url: (file && window.URL && file.size != null) ? URL.createObjectURL(file) : '' }); emit('library'); return Promise.resolve({ ok: true }); },
    removeSound: function (id) { mockSounds = mockSounds.filter(function (g) { return g.id !== id; }); emit('library'); return Promise.resolve(true); },
    playSound: function (id) { return Promise.resolve(true); },
    simulateSound: function (id, from) { emit('sound', { id: id, from: from || 'chiroben' }); },
    simulatePoke: function (from) { emit('poked', { from: from }); },
    hideChat: function (id) {
      var c = conv(id); if (!c || c.type !== 'direct') return Promise.resolve(false);
      D.conversations.splice(D.conversations.indexOf(c), 1); emit('conversations'); return Promise.resolve(true);
    },
    /* Owner or group creator removes someone from a group. */
    removeFromGroup: function (id, personId) {
      var c = conv(id); if (!c || c.type !== 'group' || personId === 'you') return Promise.resolve(false);
      var p = D.people[personId]; c.members = c.members.filter(function (m) { return m !== personId; });
      var msg = { id: 'u' + (++uid), from: 'system', type: 'system', icon: 'log-out', text: (p ? p.name : 'Someone') + ' was removed from the group', time: nowLabel() };
      D.messages[id].push(msg); emit('message', { conversationId: id, message: msg }); emit('conversations'); return Promise.resolve(true);
    },
    /* Owner removes a person from Concorde entirely. */
    removePerson: function (personId) {
      if (!ownerView || personId === 'you' || !D.people[personId]) return Promise.resolve(false);
      D.conversations.filter(function (c) { return c.type === 'direct' && c.with === personId; }).forEach(function (c) { D.conversations.splice(D.conversations.indexOf(c), 1); delete D.messages[c.id]; });
      Object.keys(D.messages).forEach(function (k) { D.messages[k] = D.messages[k].filter(function (m) { return m.from !== personId; }); });
      D.conversations.forEach(function (c) { if (c.members) c.members = c.members.filter(function (m) { return m !== personId; }); });
      delete D.people[personId]; emit('conversations'); return Promise.resolve(true);
    },
    /* Leave a group. Others see a note in the thread; the group then drops out of your list. */
    leaveGroup: function (id) {
      var c = conv(id); if (!c || c.type !== 'group') return Promise.resolve(false);
      if (call && call.conversationId === id) C.services.leaveCall();
      var msg = { id: 'u' + (++uid), from: 'system', type: 'system', icon: 'log-out', text: me.name + ' left the group', time: nowLabel() };
      D.messages[id].push(msg);
      c.members = c.members.filter(function (m) { return m !== 'you'; });
      D.conversations.splice(D.conversations.indexOf(c), 1);
      emit('conversations');
      return wait(120).then(function () { return true; });
    },
    /* Owner only: delete a group for everyone. */
    deleteGroup: function (id) {
      var c = conv(id); if (!c || c.type !== 'group') return Promise.resolve(false);
      if (call && call.conversationId === id) C.services.leaveCall();
      D.conversations.splice(D.conversations.indexOf(c), 1); delete D.messages[id];
      emit('conversations');
      return wait(120).then(function () { return true; });
    },
    getShared: function (id) { return D.shared[id] || { media: [], files: [], links: [] }; },
    markRead: function (id) { var c = conv(id); if (c) { c.unread = 0; c.mention = false; emit('conversations'); } },
    setViewing: function (id) { viewing = id; },
    /* Tell the others you are typing in this chat (called on every keystroke; the real service throttles). Mock: nothing to send. */
    sendTyping: function () {},
    mentionsYou: mentionsYou,
    getPreview: function (id) {
      var list = (D.messages[id] || []).filter(function (m) { return m.type !== 'system'; });
      var m = list[list.length - 1];
      if (!m) return { text: 'No messages yet', time: '', from: null };
      if (m.deleted) return { text: 'Message deleted', time: m.time, from: m.from };
      var text = m.type === 'image' ? (m.images && m.images.length > 1 ? m.images.length + ' photos' : 'Photo') : m.type === 'file' ? m.file.name : m.type === 'gif' ? 'GIF'
        : m.type === 'link' ? m.link.title : m.text;
      return { text: text, time: m.time, from: m.from };
    },

    /* ----- Messages ----- */
    loadHistory: function (id) { return wait(60).then(function () { return D.messages[id] || []; }); },
    sendMessage: function (id, payload) {
      var msg = {
        id: 'u' + (++uid), from: 'you', type: payload.type || 'text', text: payload.text || '',
        time: nowLabel(), replyTo: payload.replyTo || null
      };
      ['scene', 'file', 'link', 'gif', 'image', 'images', 'name'].forEach(function (k) { if (payload[k]) msg[k] = payload[k]; });
      if (!net.online) msg.failed = true;
      (D.messages[id] = D.messages[id] || []).push(msg);
      emit('message', { conversationId: id, message: msg });
      emit('conversations');
      if (!msg.failed) C.services._fakeReply(id);
      return Promise.resolve(msg);
    },
    /* Connection. Offline: sending keeps messages as "not sent"; coming back sends them. Calls drop. */
    getConnection: function () { return { online: net.online, reconnecting: net.reconnecting }; },
    setOnline: function (on) {
      if (on === net.online && !net.reconnecting) return Promise.resolve(net);
      net.reconnecting = false;
      if (!on) { net.online = false; if (call) C.services.leaveCall(); emit('connection', { online: false, reconnecting: false, dropped: true }); return Promise.resolve(net); }
      net.online = true; emit('connection', { online: true, reconnecting: false, restored: true });
      C.services._flush();
      return Promise.resolve(net);
    },
    reconnect: function () {
      if (net.online || net.reconnecting) return Promise.resolve(net);
      net.reconnecting = true; emit('connection', { online: false, reconnecting: true });
      return wait(1700).then(function () { if (!net.reconnecting) return net; return C.services.setOnline(true); });
    },
    _flush: function () {
      Object.keys(D.messages).forEach(function (id) {
        (D.messages[id] || []).forEach(function (m) {
          if (m.failed) { m.failed = false; emit('message', { conversationId: id, message: m, updated: true }); C.services._fakeReply(id); }
        });
      });
      emit('conversations');
    },
    retryMessage: function (id, messageId) {
      var m = (D.messages[id] || []).filter(function (x) { return x.id === messageId; })[0];
      if (!m || !m.failed) return Promise.resolve(false);
      if (!net.online) { emit('connection', { online: false, reconnecting: false, stillOffline: true }); return Promise.resolve(false); }
      m.failed = false; emit('message', { conversationId: id, message: m, updated: true }); C.services._fakeReply(id); return Promise.resolve(true);
    },
    discardMessage: function (id, messageId) {
      var list = D.messages[id] || [], i = list.map(function (x) { return x.id; }).indexOf(messageId);
      if (i > -1 && list[i].failed) { list.splice(i, 1); emit('message', { conversationId: id, updated: true }); emit('conversations'); }
      return Promise.resolve(true);
    },
    /* Prototype only: pretend to be brand new, with no chats. */
    simulateFirstRun: function () {
      if (stash) return; stash = D.conversations.splice(0); emit('conversations');
    },
    restoreWorld: function () {
      if (!stash) return; stash.forEach(function (c) { D.conversations.push(c); }); stash = null; emit('conversations');
    },
    isFirstRun: function () { return !!stash; },
    /* Edit or delete your own message. No "edited" label is kept; a deleted message becomes a soft placeholder. */
    editMessage: function (id, messageId, text) {
      var m = (D.messages[id] || []).filter(function (x) { return x.id === messageId && x.from === 'you'; })[0];
      if (!m || m.deleted || !text.trim()) return Promise.resolve(null);
      m.text = text.trim(); emit('message', { conversationId: id, message: m, updated: true }); emit('conversations');
      return Promise.resolve(m);
    },
    deleteMessage: function (id, messageId) {
      var m = (D.messages[id] || []).filter(function (x) { return x.id === messageId && x.from === 'you'; })[0];
      if (!m) return Promise.resolve(null);
      m.deleted = true; m.reactions = []; emit('message', { conversationId: id, message: m, updated: true }); emit('conversations');
      return Promise.resolve(m);
    },
    toggleReaction: function (id, messageId, emoji) {
      var list = D.messages[id] || [];
      var m = list.filter(function (x) { return x.id === messageId; })[0];
      if (!m) return Promise.resolve();
      m.reactions = m.reactions || [];
      var r = m.reactions.filter(function (x) { return x.emoji === emoji; })[0];
      if (r) {
        r.mine = !r.mine; r.count += r.mine ? 1 : -1;
        r.who = (r.who || []).filter(function (w) { return w !== 'you'; }); if (r.mine) r.who.push('you');
        if (r.count <= 0) m.reactions = m.reactions.filter(function (x) { return x !== r; });
      } else {
        m.reactions.push({ emoji: emoji, count: 1, mine: true, who: ['you'] });
      }
      emit('message', { conversationId: id, message: m, updated: true });
      return Promise.resolve(m);
    },
    /* Pretend GIF search: coloured tiles, so the picker can be tried without a real library. */
    searchGifs: function (q, offset) {
      var words = (String(q || '').trim() || 'trending').split(/\s+/).slice(0, 2).join(' '), cols = [['#F2A07B', '#E0549F'], ['#5B8DEF', '#7C5CFA'], ['#3FBF8F', '#5B8DEF'], ['#B58CFF', '#F06BA8']], items = [];
      for (var n = 0; n < 8; n++) {
        var c = cols[n % 4], h = 120 + (n % 3) * 40, svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs><rect width="200" height="' + h + '" fill="url(#g)"/><circle cx="100" cy="' + h / 2 + '" r="26" fill="#fff" opacity=".55"><animate attributeName="r" values="18;34;18" dur="2s" repeatCount="indefinite"/></circle></svg>', u = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        items.push({ id: 'mock' + n + words, title: words + ' ' + (n + 1), url: u, preview: u, w: 200, h: h });
      }
      return Promise.resolve({ items: items, next: null });
    },
    _fakeJoin: function () {
      var p = { id: 'newbie', name: 'Newbie', c1: '#4fb3a5', c2: '#7c5cfa', status: 'online', avatar: null };
      D.people[p.id] = p; emit('joined', { person: p });
    },
    _fakeReply: function (id) {
      var c = conv(id), ids = otherMemberIds(c);
      function reply(from, typeAt, sendAt) {
        setTimeout(function () { emit('typing', { conversationId: id, personId: from, on: true }); }, typeAt);
        setTimeout(function () {
          emit('typing', { conversationId: id, personId: from, on: false });
          var pool = c.type === 'group' && Math.random() < 0.3 ? mentionPool : replyPool;
          var msg = { id: 'u' + (++uid), from: from, type: 'text', time: nowLabel(), text: pool[Math.floor(Math.random() * pool.length)] };
          D.messages[id].push(msg); noteIncoming(id, msg);
          emit('message', { conversationId: id, message: msg, incoming: true });
          emit('conversations');
        }, sendAt);
      }
      var first = ids[Math.floor(Math.random() * ids.length)];
      reply(first, 700, 2600);
      /* In groups, a second person sometimes starts typing a little later, so you can see several at once. */
      var rest = ids.filter(function (x) { return x !== first; });
      if (rest.length && Math.random() < 0.6) reply(rest[Math.floor(Math.random() * rest.length)], 1400, 3800);
    },

    /* ----- Calls (group voice and screen sharing; camera video comes later) ----- */
    getCall: function (id) {
      var c = conv(id);
      if (!c || !c.call) return null;
      var joined = !!(call && call.conversationId === id && call.joined);
      var ids = c.call.participants.slice();
      if (joined && ids.indexOf('you') === -1) ids.push('you');
      return {
        conversationId: id, joined: joined, participants: ids,
        muted: joined ? call.muted : false,
        sharingId: c.call.sharing, startedAt: c.call.startedAt || Date.now() - 12 * 60 * 1000,
        streams: (c.call.streams || []).slice(),
        speakingId: call ? call.speakingId : null
      };
    },
    startCall: function (id) {
      var c = conv(id);
      if (c && !c.call) { c.call = { participants: [], sharing: null, startedAt: Date.now() }; emit('conversations'); }
      return C.services.joinCall(id);
    },
    joinCall: function (id) {
      var c = conv(id);
      call = { conversationId: id, joined: true, muted: false, speakingId: null };
      clearInterval(speakTimer);
      speakTimer = setInterval(function () {
        if (!call) return;
        var ids = C.services.getCall(id).participants.filter(function (p) { return p !== 'you' || !call.muted; });
        call.speakingId = ids[Math.floor(Math.random() * ids.length)];
        emit('call', C.services.getCall(id));
      }, 1700);
      emit('call', C.services.getCall(id)); emit('conversations');
      return wait(120).then(function () { return C.services.getCall(id); });
    },
    leaveCall: function () {
      if (!call) return Promise.resolve();
      var id = call.conversationId, c = conv(id);
      if (c.call && c.call.sharing === 'you') c.call.sharing = null;
      if (c.call) { dropStream(c, 'you', 'screen'); dropStream(c, 'you', 'camera'); }
      if (c.type === 'direct') {
        /* A one-to-one call ends for both people when either leaves. */
        var secs = Math.max(1, Math.round((Date.now() - (c.call.startedAt || Date.now())) / 1000));
        c.call = null;
        var msg = { id: 'u' + (++uid), from: 'system', type: 'system', time: nowLabel(),
          text: 'Call ended · ' + Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2) };
        D.messages[id].push(msg);
        call = null; clearInterval(speakTimer);
        emit('message', { conversationId: id, message: msg });
        emit('call', { conversationId: id, joined: false, participants: [], muted: false, sharingId: null, streams: [], startedAt: Date.now(), speakingId: null }); emit('conversations');
        return Promise.resolve();
      }
      call = null; clearInterval(speakTimer);
      emit('call', C.services.getCall(id)); emit('conversations');
      return Promise.resolve();
    },
    setMuted: function (muted) {
      if (call) { call.muted = muted; emit('call', C.services.getCall(call.conversationId)); }
      return Promise.resolve();
    },
    /* opts: { source: 'screen-1' | 'window-2' ..., sound: true|false } */
    startScreenShare: function (opts) {
      if (call) { var c = conv(call.conversationId); c.call.sharing = 'you'; c.call.shareInfo = opts || {}; addStream(c, 'you', 'screen'); emit('call', C.services.getCall(call.conversationId)); }
      return Promise.resolve();
    },
    stopScreenShare: function () {
      if (call) { var c = conv(call.conversationId); c.call.sharing = null; dropStream(c, 'you', 'screen'); emit('call', C.services.getCall(call.conversationId)); }
      return Promise.resolve();
    },
    /* Camera on or off. Anyone in a call can switch between audio only and video at any time. */
    setCamera: function (on) {
      if (!call) return Promise.resolve();
      var c = conv(call.conversationId);
      if (on) addStream(c, 'you', 'camera'); else dropStream(c, 'you', 'camera');
      emit('call', C.services.getCall(call.conversationId)); return Promise.resolve();
    },
    /* Prototype helper: a friend in the call turns their camera on or off. */
    simulateFriendCamera: function (personId) {
      if (!call) return Promise.resolve();
      var c = conv(call.conversationId), has = (c.call.streams || []).some(function (s) { return s.id === personId && s.kind === 'camera'; });
      if (has) dropStream(c, personId, 'camera'); else { if (c.call.participants.indexOf(personId) === -1) c.call.participants.push(personId); addStream(c, personId, 'camera'); }
      emit('call', C.services.getCall(call.conversationId)); return Promise.resolve();
    },

    /* Prototype helper: a friend @mentions you in a chat. */
    simulateMention: function (id, personId) {
      var c = conv(id), msg = { id: 'u' + (++uid), from: personId, type: 'text', time: nowLabel(),
        text: mentionPool[Math.floor(Math.random() * mentionPool.length)] };
      D.messages[id].push(msg); noteIncoming(id, msg);
      emit('message', { conversationId: id, message: msg, incoming: true }); emit('conversations');
      return Promise.resolve(msg);
    },

    /* ----- Ringing (one-to-one calls). kind is 'audio' or 'video'. direction is 'out' (you are calling) or 'in'. ----- */
    getRing: function () { return ring ? JSON.parse(JSON.stringify(ring)) : null; },
    startDirectCall: function (conversationId, kind) {
      if (ring || call) return Promise.resolve(null);
      var c = conv(conversationId); attempt++;
      if (D.people[c.with].status === 'dnd') {
        /* The friend is on Do not disturb: their phone does not ring and you are told straight away. */
        setRing({ conversationId: conversationId, personId: c.with, kind: kind, direction: 'out', status: 'dnd' });
        ringTimer = setTimeout(function () { setRing(null); }, 3600);
        return Promise.resolve(ring);
      }
      setRing({ conversationId: conversationId, personId: c.with, kind: kind, direction: 'out', status: 'ringing' });
      /* Prototype: friends alternate between picking up and declining so both outcomes can be seen. */
      ringTimer = setTimeout(function () {
        if (!ring) return;
        if (attempt % 2 === 1) connectDirect(conversationId, kind);
        else {
          ring.status = 'declined'; emit('ring', C.services.getRing());
          ringTimer = setTimeout(function () { setRing(null); }, 3400);
        }
      }, 4800);
      return Promise.resolve(ring);
    },
    simulateIncoming: function (personId, kind) {
      if (ring || call) return Promise.resolve(null);
      var c = D.conversations.filter(function (x) { return x.type === 'direct' && x.with === personId; })[0];
      if (me.status === 'dnd') {
        /* Do not disturb: no ringing, no banner. The call shows up as a missed call in the chat. */
        var miss = { id: 'u' + (++uid), from: 'system', type: 'system', time: nowLabel(), text: 'Missed ' + (kind === 'video' ? 'video' : 'voice') + ' call from ' + D.people[personId].name + ' (you were on Do not disturb)' };
        D.messages[c.id].push(miss); emit('message', { conversationId: c.id, message: miss }); emit('conversations');
        return Promise.resolve({ blocked: 'dnd' });
      }
      setRing({ conversationId: c.id, personId: personId, kind: kind, direction: 'in', status: 'ringing' });
      ringTimer = setTimeout(function () {
        if (!ring) return;
        setRing(null);
        var msg = { id: 'u' + (++uid), from: 'system', type: 'system', time: nowLabel(), text: 'Missed ' + (kind === 'video' ? 'video' : 'voice') + ' call from ' + D.people[personId].name };
        D.messages[c.id].push(msg);
        emit('message', { conversationId: c.id, message: msg }); emit('conversations');
      }, 30000);
      return Promise.resolve(ring);
    },
    answerRing: function () {
      if (!ring || ring.direction !== 'in') return Promise.resolve();
      connectDirect(ring.conversationId, ring.kind); return Promise.resolve();
    },
    /* Cancel your own outgoing call, or decline an incoming one. */
    endRing: function () {
      if (!ring) return Promise.resolve(null);
      var r = ring; setRing(null); return Promise.resolve(r);
    },

    /* Prototype helper: change a friend's status (away, dnd, online, offline). */
    setFriendStatus: function (personId, status) { D.people[personId].status = status; emit('conversations'); return Promise.resolve(); },

    /* ----- Tell the Tower: a shared board where everyone posts ideas and bugs. Only the owner changes the status. ----- */
    isOwner: function () { return ownerView; },
    /* Prototype helper: look at the app as a normal member (no admin tools). */
    setOwnerView: function (on) { ownerView = !!on; emit('invites', {}); return Promise.resolve(ownerView); },

    /* ----- Invites: only the owner. The app emails a friend a one-time code; the list shows who has joined. ----- */
    listInvites: function () { return invites; },
    sendInvite: function (email) {
      email = String(email || '').trim().toLowerCase();
      if (!net.online) return Promise.reject({ code: 'offline', message: 'You are offline. Reconnect and try again.' });
      if (!ownerView) return Promise.reject({ code: 'not-owner', message: 'Only the owner can invite people.' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.reject({ code: 'bad-email', message: 'That email address doesn\'t look right.' });
      if (/^chiro/.test(email)) return Promise.reject({ code: 'already-member', message: 'That person is already in Concorde.' });
      if (invites.some(function (i) { return i.email === email && i.status === 'pending'; })) return Promise.reject({ code: 'already-invited', message: 'They already have a pending invite. Use Resend instead.' });
      return new Promise(function (res) { setTimeout(function () {
        var inv = { id: 'iv' + (++uid), email: email, status: 'pending', time: 'Just now' };
        invites.unshift(inv); emit('invites', {}); res(inv);
        setTimeout(function () { if (inv.status === 'pending' && /join/.test(email)) { inv.status = 'joined'; emit('invites', {}); } }, 7000);
      }, 500); });
    },
    resendInvite: function (id) {
      var inv = invites.filter(function (i) { return i.id === id; })[0];
      if (!net.online) return Promise.reject({ code: 'offline', message: 'You are offline. Reconnect and try again.' });
      if (!inv || inv.status !== 'pending') return Promise.reject({ code: 'not-pending', message: 'That invite can\'t be resent.' });
      return new Promise(function (res) { setTimeout(function () { inv.time = 'Just now'; emit('invites', {}); res(inv); }, 400); });
    },
    revokeInvite: function (id) {
      var inv = invites.filter(function (i) { return i.id === id; })[0];
      if (inv && inv.status === 'pending') { inv.status = 'revoked'; emit('invites', {}); }
      return Promise.resolve();
    },
    listIdeas: function () { return tower; },
    towerUnread: function () { return tower.filter(function (i) { return i.from !== 'you' && !i.seen; }).length; },
    markTowerSeen: function () { tower.forEach(function (i) { i.seen = true; }); emit('tower', {}); },
    addIdea: function (payload) {
      var idea = { id: 't' + (++uid), from: 'you', type: payload.type === 'bug' ? 'bug' : 'idea', text: payload.text, images: (payload.images || []).map(function (f) { return URL.createObjectURL(f); }), status: 'new', plus: ['you'], comments: [], seen: true, time: 'Just now' };
      tower.unshift(idea); emit('tower', { idea: idea }); return Promise.resolve(idea);
    },
    toggleIdeaPlus: function (id) {
      var i = tower.filter(function (x) { return x.id === id; })[0]; if (!i) return Promise.resolve();
      var at = i.plus.indexOf('you'); if (at === -1) i.plus.push('you'); else i.plus.splice(at, 1);
      emit('tower', {}); return Promise.resolve(i);
    },
    addIdeaComment: function (id, text) {
      var i = tower.filter(function (x) { return x.id === id; })[0]; if (!i || !text.trim()) return Promise.resolve();
      i.comments.push({ from: 'you', text: text.trim() }); emit('tower', {}); return Promise.resolve(i);
    },
    setIdeaStatus: function (id, status) {
      var i = tower.filter(function (x) { return x.id === id; })[0]; if (!i || !C.services.isOwner()) return Promise.resolve();
      i.status = status; emit('tower', {}); return Promise.resolve(i);
    },
    /* Prototype helper: a friend posts a new idea. */
    simulateIdea: function (personId) {
      var pool = ['Let us pick a custom ringtone for each friend.', 'Could the call screen show who is talking in bigger text?', 'A shared photo album for the group would be lovely.', 'Bug: my GIF picker closes when I click the search box.'];
      var text = pool[uid % pool.length], idea = { id: 't' + (++uid), from: personId, type: /^Bug/.test(text) ? 'bug' : 'idea', text: text.replace(/^Bug: /, ''), status: 'new', plus: [personId], comments: [], seen: false, time: 'Just now' };
      tower.unshift(idea); emit('tower', { idea: idea, incoming: true }); return Promise.resolve(idea);
    },

    /* ----- Search across everything: chats, messages, photos, files and links ----- */
    search: function (query) {
      var q = (query || '').trim().toLowerCase(), res = [];
      if (!q) return Promise.resolve(res);
      var photoWord = q.length >= 3 && ['photo', 'photos', 'picture', 'pictures', 'image', 'images'].some(function (w) { return w.indexOf(q) === 0; });
      function has(s) { return (s || '').toLowerCase().indexOf(q) !== -1; }
      D.conversations.forEach(function (c) {
        var name = c.type === 'direct' ? D.people[c.with].name : c.name;
        if (has(name)) res.push({ kind: 'chat', conversationId: c.id, title: name, text: c.type === 'direct' ? 'Direct message' : c.members.length + ' members' });
        (D.messages[c.id] || []).slice().reverse().forEach(function (m) {
          if (m.type === 'system' || m.deleted) return;
          var base = { conversationId: c.id, messageId: m.id, from: m.from, time: m.time, d: m.d || 0, convName: name, convType: c.type };
          function add(kind, title, text, extra) { var r = { kind: kind, title: title, text: text }; Object.keys(base).forEach(function (k) { r[k] = base[k]; }); Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; }); res.push(r); }
          if (m.type === 'text' && has(m.text)) add('message', '', m.text);
          else if (m.type === 'image') {
            var items = (m.images && m.images.length) ? m.images : [{ scene: m.scene, image: m.image, name: m.name }];
            var hit = items.filter(function (x) { return has(x.name); })[0];
            if (hit || has(m.text) || photoWord) add('photo', hit ? hit.name : '', m.text || '', { thumb: hit || items[0], count: items.length });
          }
          else if (m.type === 'file' && (has(m.file.name) || has(m.text))) add('file', m.file.name, m.file.size + (m.text ? ' · ' + m.text : ''));
          else if (m.type === 'link' && (has(m.link.title) || has(m.link.domain) || has(m.text))) add('link', m.link.title, m.link.domain);
        });
      });
      return wait(70).then(function () { return res; });
    },

    /* ----- App updates ----- */
    getUpdate: function () { return JSON.parse(JSON.stringify(update)); },
    /* Prototype helper: pretend a newer version has been downloaded and is ready. */
    simulateUpdate: function () {
      var v = C.version.number.split('.'); v[2] = +v[2] + 1;
      update = { available: true, version: v.join('.'), installing: false };
      emit('update', C.services.getUpdate()); return Promise.resolve(update);
    },
    installUpdate: function () {
      if (!update.available || update.installing) return Promise.resolve(false);
      update.installing = true; emit('update', C.services.getUpdate());
      return wait(2000).then(function () { var v = update.version; update = { available: false, version: null, installing: false }; emit('update', C.services.getUpdate()); return v; });
    },

    /* ----- Events ----- */
    on: function (type, fn) { listeners[type].push(fn); }
  };
})();
