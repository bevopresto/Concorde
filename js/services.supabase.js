/*
  Concorde live accounts and chat (workstream A), built on Supabase.

  Loads after services.js and, in live mode only (config.backend === 'live'), replaces every account, chat,
  invite and Tell the Tower function with the real thing. The screens never know the difference: same names,
  same shapes (see backend/SERVICES.md). Calls and ringing are in js/services.calls.js.
*/
(function () {
  var C = window.Concorde, cfg = C.config || {};
  if (cfg.backend !== 'live') return;
  var S = C.services, D = C.data;
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) { console.error('Concorde: live mode needs the Supabase library and keys (js/config.js).'); return; }

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 12 } }
  });

  /* ---------------------------------------------------------------- events */
  var bus = { message: [], typing: [], call: [], conversations: [], ring: [], tower: [], update: [], connection: [], invites: [] };
  var quiet = false;                                  // no events while restoring a saved sign-in (the screens are not drawn yet)
  function emit(type, payload) { if (quiet) return; (bus[type] || []).slice().forEach(function (fn) { try { fn(payload); } catch (e) { console.error(e); } }); }
  S.on = function (type, fn) { if (bus[type]) bus[type].push(fn); };

  /* ---------------------------------------------------------------- state */
  var myId = null, signedIn = false, isOwnerFlag = false, viewing = null, towerSeenAt = 0;
  var net = { online: navigator.onLine !== false, reconnecting: false };
  var present = {};                                   // who is online right now (realtime presence)
  var urlCache = {};                                  // storage path -> loadable url
  var msgs = {}, loaded = {}, pendingByClient = {};   // conversation id -> live message array
  var invites = [], tower = [];
  var channels = [];
  var hooks = { boot: [], listen: [], reset: [] };   // js/services.calls.js plugs in here

  // Fill the shared data object in place so the screens' references stay valid.
  D.people = D.people || {}; D.conversations = D.conversations || []; D.messages = {}; D.shared = {};
  function clearAll() {
    Object.keys(D.people).forEach(function (k) { delete D.people[k]; });
    D.conversations.length = 0; invites.length = 0; tower.length = 0;
    msgs = {}; loaded = {}; pendingByClient = {}; present = {}; urlCache = {}; typingCh = null;
    hooks.reset.forEach(function (fn) { fn(); });
    myId = null; signedIn = false; isOwnerFlag = false; viewing = null;
    D.people.you = { id: 'you', name: '', c1: '#7C5CFA', c2: '#E0549F', status: 'offline', avatar: null };
  }
  clearAll();

  /* ---------------------------------------------------------------- helpers */
  var OFFLINE = 'Concorde can’t reach the server. Check your internet and try again.';
  function fail(code, message) { return { code: code, message: message }; }
  function isNetErr(e) { return !navigator.onLine || (e && /fetch|network|failed to|load failed/i.test(String(e.message || e))); }
  function wrapErr(e, fallbackCode, fallbackMsg) {
    if (e && typeof e.code === 'string' && /^[a-z]+(-[a-z]+)*$/.test(e.code) && e.message) return e;
    if (isNetErr(e)) return fail('offline', OFFLINE);
    return fail(fallbackCode || 'unknown', fallbackMsg || 'Something went wrong. Please try again.');
  }
  function mine(id) { return id === 'you' ? myId : id; }
  function pid(id) { return id && id === myId ? 'you' : id; }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function clock(iso) {
    var d = new Date(iso), h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12; return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function dayDiff(iso) { return Math.round((dayStart(new Date(iso)) - dayStart(new Date())) / 86400000); }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function whenLabel(iso) {            // for the chat list and the invite list
    var d = new Date(iso), n = dayDiff(iso);
    if (n === 0) return clock(iso);
    if (n === -1) return 'Yesterday';
    if (n > -7) return WD[d.getDay()];
    return d.getDate() + ' ' + MO[d.getMonth()];
  }
  function agoLabel(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return 'Just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
    var n = dayDiff(iso); if (n === 0) return 'Today'; if (n === -1) return 'Yesterday'; if (n > -14) return -n + ' days ago';
    var d = new Date(iso); return d.getDate() + ' ' + MO[d.getMonth()];
  }
  function fmtSize(b) { b = +b || 0; return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (Math.round(b / 104857.6) / 10) + ' MB'; }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function safeName(n) { return String(n || 'file').replace(/[^\w.\-]+/g, '_').slice(-80); }
  function publicUrl(bucket, path, bust) { var u = sb.storage.from(bucket).getPublicUrl(path).data.publicUrl; return bust ? u + '?v=' + bust : u; }
  function conv(id) { return D.conversations.filter(function (c) { return c.id === id; })[0]; }
  /* Calls (js/services.calls.js) plug in here: it borrows these helpers and gets told when to load, listen and reset. */
  C.live = { sb: sb, emit: emit, conv: conv, pid: pid, mine: mine, fail: fail, wrapErr: wrapErr, me: function () { return myId; }, hooks: hooks };
  function mentionsYou(text) {
    var n = D.people.you && D.people.you.name; if (!text) return false;
    return new RegExp('(^|\\W)@(' + (n ? esc(n) + '|' : '') + 'everyone)(?![\\w])', 'i').test(text);
  }
  S.mentionsYou = mentionsYou;

  /* ---------------------------------------------------------------- people */
  function toPerson(r) {
    var st = r.status;
    if (r.id !== myId) st = (st === 'invisible' || !present[r.id]) ? 'offline' : st;
    return { id: pid(r.id), name: r.name, c1: r.c1, c2: r.c2, status: st, avatar: r.avatar_path ? publicUrl('avatars', r.avatar_path, r._v) : null, _row: r };
  }
  function putPerson(r) {
    var key = pid(r.id), p = toPerson(r), cur = D.people[key];
    if (cur) Object.assign(cur, p); else D.people[key] = p;
    return D.people[key];
  }
  function refreshStatuses() { Object.keys(D.people).forEach(function (k) { var p = D.people[k]; if (k !== 'you' && p._row) putPerson(p._row); }); }
  function loadProfiles() {
    return sb.from('profiles').select('*').then(function (r) {
      if (r.error) throw r.error;
      r.data.forEach(function (row) {
        if (row.id === myId) { isOwnerFlag = !!row.is_owner; towerSeenAt = new Date(row.tower_seen_at).getTime(); }
        putPerson(row);
      });
    });
  }

  /* ---------------------------------------------------------------- storage urls */
  function signPaths(paths) {
    var need = paths.filter(function (p) { return p && !urlCache[p]; });
    if (!need.length) return Promise.resolve();
    return sb.storage.from('attachments').createSignedUrls(need, 21600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) urlCache[x.path] = x.signedUrl; });
    }).catch(function () { /* images just stay blank until the next load */ });
  }
  function pathsOf(row) {
    var p = row.payload || {}, out = [];
    (p.images || []).forEach(function (i) { out.push(i.path); });
    if (p.file && p.file.path) out.push(p.file.path);
    return out;
  }
  function uploadTo(bucket, path, blob) {
    return sb.storage.from(bucket).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false }).then(function (r) { if (r.error) throw r.error; });
  }

  /* ---------------------------------------------------------------- messages */
  function groupReacts(rows) {
    var order = [], by = {};
    (rows || []).forEach(function (r) {
      var g = by[r.emoji]; if (!g) { g = by[r.emoji] = { emoji: r.emoji, count: 0, mine: false }; order.push(g); }
      g.count++; if (r.user_id === myId) g.mine = true;
    });
    return order;
  }
  function mapMsg(r) {
    var p = r.payload || {};
    var m = { id: r.id, from: r.sender_id ? pid(r.sender_id) : 'system', type: r.type, text: r.text || '', createdAt: r.created_at,
      time: clock(r.created_at), d: dayDiff(r.created_at), replyTo: r.reply_to || null, reactions: groupReacts(r.reactions) };
    if (r.edited_at) m.edited = true;
    if (r.deleted_at) { m.deleted = true; m.reactions = []; m.text = ''; return m; }
    if (r.type === 'image') {
      m.images = (p.images || []).map(function (i) { return { image: urlCache[i.path] || '', name: i.name }; });
      if (m.images.length === 1) { m.image = m.images[0].image; m.name = m.images[0].name; }
    } else if (r.type === 'file' && p.file) {
      m.file = { name: p.file.name, size: fmtSize(p.file.size), url: urlCache[p.file.path] || '' };
    } else if (r.type === 'gif') m.gif = p.gif || { label: 'GIF', emoji: '🎞️' };
    else if (r.type === 'link') m.link = p.link || { title: m.text, domain: '' };
    else if (r.type === 'system') m.icon = p.icon || 'pencil';
    return m;
  }
  function previewOf(m) {
    if (!m) return { text: 'No messages yet', time: '', from: null };
    if (m.deleted) return { text: 'Message deleted', time: whenLabel(m.createdAt), from: m.from };
    var text = m.type === 'image' ? (m.images && m.images.length > 1 ? m.images.length + ' photos' : 'Photo') : m.type === 'file' ? (m.file ? m.file.name : 'File')
      : m.type === 'gif' ? 'GIF' : m.type === 'link' ? (m.link ? m.link.title : 'Link') : m.text;
    return { text: text, time: whenLabel(m.createdAt), from: m.from };
  }
  function lastReal(id) { var l = (msgs[id] || []).filter(function (m) { return m.type !== 'system'; }); return l[l.length - 1]; }
  function bump(id, m) {
    var c = conv(id); if (!c) return;
    if (m && m.type !== 'system') { c._prev = previewOf(m); c._lastAt = new Date(m.createdAt).getTime(); }
    sortConvs();
  }
  function sortConvs() { D.conversations.sort(function (a, b) { return (b._lastAt || 0) - (a._lastAt || 0); }); }

  function loadHistory(id) {
    if (loaded[id]) return Promise.resolve(msgs[id]);
    return sb.from('messages').select('*, reactions(emoji,user_id)').eq('conversation_id', id).order('created_at', { ascending: false }).limit(500).then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data.reverse(), paths = []; rows.forEach(function (x) { paths = paths.concat(pathsOf(x)); });
      return signPaths(paths).then(function () {
        var list = msgs[id] = msgs[id] || [], keep = list.filter(function (m) { return m._local; });
        list.length = 0; rows.forEach(function (x) { list.push(mapMsg(x)); });
        keep.forEach(function (m) { if (!list.some(function (x) { return x.id === m.id; })) list.push(m); });
        loaded[id] = true; return list;
      });
    }).catch(function (e) { throw wrapErr(e, 'unknown', 'Couldn’t load this chat. Try again in a moment.'); });
  }

  function findMsg(messageId) {
    var ids = Object.keys(msgs);
    for (var i = 0; i < ids.length; i++) { var m = msgs[ids[i]].filter(function (x) { return x.id === messageId; })[0]; if (m) return { cid: ids[i], m: m }; }
    return null;
  }

  var readTimers = {};
  function markReadSoon(id) { clearTimeout(readTimers[id]); readTimers[id] = setTimeout(function () { sb.rpc('mark_read', { p_conv: id }).then(function () {}); }, 600); }

  function onInsert(row) {
    var cid = row.conversation_id;
    if (row.client_id && pendingByClient[row.client_id]) return;          // our own send; sendMessage swaps it in
    var have = msgs[cid] && msgs[cid].some(function (m) { return m.id === row.id; }); if (have) return;
    var go = function () {
      signPaths(pathsOf(row)).then(function () {
        var m = mapMsg(row), c = conv(cid); if (!c) return;
        if (msgs[cid] && loaded[cid]) msgs[cid].push(m);
        bump(cid, m);
        var incoming = !!row.sender_id && row.sender_id !== myId;
        if (incoming) setTyper(cid, row.sender_id, false);
        if (incoming) {
          if (viewing === cid) markReadSoon(cid);
          else { c.unread = (c.unread || 0) + 1; if (mentionsYou(m.text)) c.mention = true; }
        }
        var ev = { conversationId: cid, message: m }; if (incoming) ev.incoming = true;
        emit('message', ev); emit('conversations');
      });
    };
    if (!conv(cid)) loadConversations().then(go); else go();
  }
  function onUpdate(row) {
    var f = findMsg(row.id), c = conv(row.conversation_id);
    if (f) {
      var fresh = mapMsg(Object.assign({}, row, { reactions: [] }));
      fresh.reactions = row.deleted_at ? [] : f.m.reactions;
      Object.keys(f.m).forEach(function (k) { if (k !== '_local' && !(k in fresh)) delete f.m[k]; });
      Object.assign(f.m, fresh);
      bump(f.cid, lastReal(f.cid));
      emit('message', { conversationId: f.cid, message: f.m, updated: true });
    }
    if (c) { var l = lastReal(c.id); if (l) c._prev = previewOf(l); emit('conversations'); }
  }
  function onReaction(ev, row) {
    if (row.user_id === myId) return;
    var f = findMsg(row.message_id); if (!f) return;
    var m = f.m, r = m.reactions.filter(function (x) { return x.emoji === row.emoji; })[0];
    if (ev === 'INSERT') { if (r) r.count++; else m.reactions.push({ emoji: row.emoji, count: 1, mine: false }); }
    else if (r) { r.count--; if (r.count <= 0) m.reactions = m.reactions.filter(function (x) { return x !== r; }); }
    emit('message', { conversationId: f.cid, message: m, updated: true });
  }

  /* ---------------------------------------------------------------- conversations */
  function loadConversations() {
    return Promise.all([sb.rpc('my_conversations'), sb.from('conversation_members').select('conversation_id,user_id')]).then(function (res) {
      if (res[0].error) throw res[0].error; if (res[1].error) throw res[1].error;
      var members = {}; res[1].data.forEach(function (x) { (members[x.conversation_id] = members[x.conversation_id] || []).push(pid(x.user_id)); });
      var unknown = res[1].data.some(function (x) { return !D.people[pid(x.user_id)]; });
      return (unknown ? loadProfiles() : Promise.resolve()).then(function () {
        var seen = {};
        res[0].data.forEach(function (r) {
          var c = conv(r.id) || (D.conversations.push({ id: r.id, call: null }), D.conversations[D.conversations.length - 1]); seen[r.id] = true;
          Object.assign(c, {
            type: r.type, name: r.type === 'group' ? r.name : undefined, c1: r.c1 || undefined, c2: r.c2 || undefined,
            avatar: r.avatar_path ? publicUrl('avatars', r.avatar_path) : null,
            members: members[r.id] || ['you'], pinned: !!r.pinned, muted: !!r.muted, unread: Number(r.unread) || 0, mention: !!r.mention
          });
          if (r.type === 'direct') c.with = pid(r.other_id);
          var live = lastReal(r.id);
          c._prev = live ? previewOf(live) : (r.last_at ? { text: r.last_deleted ? 'Message deleted' : ({ image: 'Photo', file: 'File', gif: 'GIF', link: 'Link' }[r.last_type] || r.last_text || ''), time: whenLabel(r.last_at), from: pid(r.last_sender) } : { text: 'No messages yet', time: '', from: null });
          c._lastAt = r.last_at ? new Date(r.last_at).getTime() : 0;
        });
        for (var i = D.conversations.length - 1; i >= 0; i--) if (!seen[D.conversations[i].id]) D.conversations.splice(i, 1);
        sortConvs(); emit('conversations'); return D.conversations;
      });
    });
  }

  /* ---------------------------------------------------------------- realtime */
  function subscribe() {
    unsubscribe();
    var db = sb.channel('concorde-db');
    function on(table, ev, fn) { db.on('postgres_changes', { event: ev, schema: 'public', table: table }, fn); }
    on('messages', 'INSERT', function (p) { onInsert(p.new); });
    on('messages', 'UPDATE', function (p) { onUpdate(p.new); });
    on('reactions', 'INSERT', function (p) { onReaction('INSERT', p.new); });
    on('reactions', 'DELETE', function (p) { onReaction('DELETE', p.old); });
    on('conversation_members', '*', function () { clearTimeout(subscribe._t); subscribe._t = setTimeout(loadConversations, 400); });
    on('profiles', '*', function (p) { if (p.new && p.new.id) { putPerson(p.new); emit('conversations'); } });
    ['ideas', 'idea_plus', 'idea_comments'].forEach(function (t) { on(t, '*', function () { clearTimeout(subscribe._ti); subscribe._ti = setTimeout(function () { loadIdeas(true); }, 350); }); });
    hooks.listen.forEach(function (fn) { fn(db, on); });
    var wasDown = false;
    db.subscribe(function (status) {
      if (status === 'SUBSCRIBED') { if (wasDown) { wasDown = false; net.reconnecting = false; resync(); } }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { wasDown = true; }
    });
    channels.push(db);

    var pr = sb.channel('concorde-presence', { config: { presence: { key: myId } } });
    pr.on('presence', { event: 'sync' }, function () {
      var st = pr.presenceState(); present = {}; Object.keys(st).forEach(function (k) { present[k] = true; });
      refreshStatuses(); emit('conversations');
    });
    pr.subscribe(function (status) { if (status === 'SUBSCRIBED') pr.track({ at: Date.now() }); });
    channels.push(pr);

    // Typing indicators: a light broadcast, nothing is stored.
    var ty = sb.channel('concorde-typing');
    ty.on('broadcast', { event: 'typing' }, function (m) {
      var d = m.payload || {}; if (!d.u || d.u === myId || !conv(d.c)) return;
      setTyper(d.c, d.u, !!d.on);
    });
    ty.subscribe(); typingCh = ty; channels.push(ty);
  }
  var typingCh = null, typers = {}, lastSent = {}, stopTimers = {};
  function setTyper(c, u, on) {
    var key = c + '|' + u; clearTimeout(typers[key]);
    if (on) typers[key] = setTimeout(function () { emit('typing', { conversationId: c, personId: pid(u), on: false }); }, 5000);
    emit('typing', { conversationId: c, personId: pid(u), on: on });
  }
  function sayTyping(c, on) {
    if (typingCh && signedIn && net.online) typingCh.send({ type: 'broadcast', event: 'typing', payload: { c: c, u: myId, on: on } });
  }
  S.sendTyping = function (id) {
    var t = Date.now();
    if (!lastSent[id] || t - lastSent[id] > 2500) { lastSent[id] = t; sayTyping(id, true); }
    clearTimeout(stopTimers[id]); stopTimers[id] = setTimeout(function () { lastSent[id] = 0; sayTyping(id, false); }, 3000);
  };
  function stopTyping(id) { clearTimeout(stopTimers[id]); if (lastSent[id]) { lastSent[id] = 0; sayTyping(id, false); } }
  function unsubscribe() { channels.forEach(function (ch) { try { sb.removeChannel(ch); } catch (e) { /* already closed */ } }); channels = []; }

  function resync() {
    if (!signedIn) return Promise.resolve();
    return loadConversations().then(function () {
      var ids = Object.keys(loaded).filter(function (k) { return loaded[k]; });
      return Promise.all(ids.map(function (id) {
        var list = msgs[id], real = list.filter(function (m) { return !m._local; }), last = real[real.length - 1];
        var q = sb.from('messages').select('*, reactions(emoji,user_id)').eq('conversation_id', id).order('created_at', { ascending: true }).limit(200);
        if (last) q = q.gt('created_at', last.createdAt);
        return q.then(function (r) {
          if (r.error || !r.data.length) return;
          var paths = []; r.data.forEach(function (x) { paths = paths.concat(pathsOf(x)); });
          return signPaths(paths).then(function () {
            r.data.forEach(function (x) { if (!list.some(function (m) { return m.id === x.id; })) list.push(mapMsg(x)); });
            emit('message', { conversationId: id, message: list[list.length - 1], updated: true });
          });
        });
      }));
    }).then(function () { return loadIdeas(true); }).then(function () { return Promise.all(hooks.boot.map(function (fn) { return fn(); })); }).catch(function () {});
  }

  /* ---------------------------------------------------------------- boot after sign-in */
  function bootData() {
    return loadProfiles().then(function () { return Promise.all([loadConversations(), loadIdeas(true), loadInvites()]); }).then(function () {
      return Promise.all(hooks.boot.map(function (fn) { return fn(); })).catch(function () {});
    }).then(function () {
      signedIn = true; subscribe(); startInvitePoll(); return true;
    });
  }
  function loadMyProfile() {
    return sb.auth.getUser().then(function (u) {
      if (u.error || !u.data.user) return null;
      myId = u.data.user.id;
      return sb.from('profiles').select('id').eq('id', myId).maybeSingle().then(function (r) { return r.data ? myId : null; });
    });
  }

  /* ---------------------------------------------------------------- accounts */
  S.restoreSession = function () {
    quiet = true;
    return sb.auth.getSession().then(function (r) {
      if (!r.data || !r.data.session) return false;
      return loadMyProfile().then(function (has) { return has ? bootData() : false; });
    }).catch(function () { return false; }).then(function (ok) { quiet = false; return ok; });
  };
  S.getCurrentUser = function () { return D.people.you; };
  S.requestCode = function (email) {
    email = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.reject(fail('bad-email', 'That email doesn’t look right. Check it and try again.'));
    if (!navigator.onLine) return Promise.reject(fail('offline', OFFLINE));
    return sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } }).then(function (r) {
      if (r.error) {
        if (r.error.status === 429 || /rate|seconds|too many/i.test(r.error.message)) throw fail('rate-limit', 'Too many codes asked for. Wait a minute and try again.');
        throw wrapErr(r.error, 'unknown', 'The code couldn’t be sent. Try again in a minute.');
      }
      return true;
    }).catch(function (e) { throw wrapErr(e); });
  };
  S.verifyCode = function (email, code) {
    var token = String(code || '').replace(/\s/g, '');
    return sb.auth.verifyOtp({ email: String(email || '').trim(), token: token, type: 'email' }).then(function (r) {
      if (r.error || !r.data.session) throw fail('bad-code', 'That code didn’t match, or it has expired. Check the email and try again.');
      return loadMyProfile().then(function (has) { return has ? bootData().then(function () { return { isNew: false }; }) : { isNew: true }; });
    }).catch(function (e) { throw wrapErr(e); });
  };
  S.joinWithInvite = function (details) {
    var name = String((details && details.name) || '').trim(), code = String((details && details.inviteCode) || '').trim();
    if (!name) return Promise.reject(fail('no-name', 'Choose the name your friends will see.'));
    return sb.rpc('redeem_invite', { p_code: code, p_name: name, p_c1: null, p_c2: null }).then(function (r) {
      if (r.error) {
        var m = r.error.message || '';
        if (/bad_code/.test(m)) throw fail('bad-invite', 'That invite code didn’t work. Check it with whoever invited you.');
        if (/name_taken/.test(m)) throw fail('name-taken', 'Someone already has that name. Try another.');
        if (/no_name/.test(m)) throw fail('no-name', 'Choose the name your friends will see.');
        throw wrapErr(r.error);
      }
      return loadMyProfile().then(function () { return bootData(); }).then(function () { return D.people.you; });
    }).catch(function (e) { throw wrapErr(e); });
  };
  S.signOut = function () {
    unsubscribe(); stopInvitePoll();
    return Promise.resolve(S.leaveCall()).catch(function () {}).then(function () { return sb.auth.signOut(); }).catch(function () {}).then(function () { clearAll(); emit('conversations'); });
  };
  S.setStatus = function (status) {
    var me = D.people.you; me.status = status; emit('conversations');
    if (signedIn) sb.from('profiles').update({ status: status }).eq('id', myId).then(function () {});
    return Promise.resolve(me);
  };
  S.updateProfile = function (patch) {
    var me = D.people.you, upd = {}, work = Promise.resolve();
    if (patch.name && patch.name !== me.name) upd.name = patch.name;
    if (patch.c1) { upd.c1 = patch.c1; upd.c2 = patch.c2 || me.c2; }
    if ('avatar' in patch) {
      if (patch.avatar) {
        work = fetch(patch.avatar).then(function (r) { return r.blob(); }).then(function (b) {
          var path = myId + '/avatar-' + Date.now() + '.png';
          return uploadTo('avatars', path, b).then(function () { upd.avatar_path = path; });
        });
      } else upd.avatar_path = null;
    }
    return work.then(function () {
      if (!Object.keys(upd).length) return me;
      return sb.from('profiles').update(upd).eq('id', myId).select().single().then(function (r) {
        if (r.error) { if (r.error.code === '23505') throw fail('name-taken', 'Someone already has that name. Try another.'); throw r.error; }
        r.data._v = Date.now(); putPerson(r.data); loadConversations(); return D.people.you;
      });
    }).catch(function (e) { throw wrapErr(e); });
  };
  S.getPerson = function (id) { return D.people[id]; };
  S.isOwner = function () { return isOwnerFlag; };
  S.setOwnerView = function () { return Promise.resolve(isOwnerFlag); };

  /* ---------------------------------------------------------------- invites (owner only) */
  var invTimer = null;
  function mapInvite(r) {
    var expired = r.expires_at && new Date(r.expires_at) < new Date();
    return { id: r.code, email: r.email, status: r.revoked_at || (expired && r.uses < r.max_uses) ? 'revoked' : r.uses >= r.max_uses ? 'joined' : 'pending', time: agoLabel(r.used_at || r.sent_at || r.created_at) };
  }
  function loadInvites() {
    if (!isOwnerFlag) return Promise.resolve();
    return sb.from('invites').select('*').not('email', 'is', null).order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return;
      var sig = JSON.stringify(invites);
      invites.length = 0; r.data.map(mapInvite).forEach(function (i) { invites.push(i); });
      if (sig !== JSON.stringify(invites)) emit('invites', {});
    });
  }
  function startInvitePoll() { stopInvitePoll(); if (isOwnerFlag) invTimer = setInterval(loadInvites, 45000); }
  function stopInvitePoll() { clearInterval(invTimer); invTimer = null; }
  S.listInvites = function () { return invites; };
  function callInviteFn(body) {
    if (!navigator.onLine) return Promise.reject(fail('offline', 'You are offline. Reconnect and try again.'));
    return sb.functions.invoke('send-invite', { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      if (ctx && typeof ctx.json === 'function') {
        return ctx.json().catch(function () { return {}; }).then(function (j) {
          var key = String(j.error || 'email_failed').replace(/_/g, '-');
          throw fail(key, j.message || 'The invite email couldn’t be sent.');
        });
      }
      throw fail('email-failed', 'The invite email isn’t set up yet. See backend/SETUP.md (step: Inviting from inside the app).');
    });
  }
  S.sendInvite = function (email) {
    email = String(email || '').trim().toLowerCase();
    if (!isOwnerFlag) return Promise.reject(fail('not-owner', 'Only the owner can invite people.'));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.reject(fail('bad-email', 'That email address doesn’t look right.'));
    return callInviteFn({ email: email }).then(function () { return loadInvites(); }).then(function () {
      emit('invites', {}); return invites.filter(function (i) { return i.email === email; })[0]; });
  };
  S.resendInvite = function (id) {
    return callInviteFn({ code: id }).then(function () { return loadInvites(); }).then(function () { emit('invites', {}); return invites.filter(function (i) { return i.id === id; })[0]; });
  };
  S.revokeInvite = function (id) {
    return sb.rpc('revoke_invite', { p_code: id }).then(function () { return loadInvites(); }).then(function () { emit('invites', {}); });
  };

  /* ---------------------------------------------------------------- conversations (API) */
  S.listConversations = function () { return Promise.resolve(D.conversations); };
  S.createConversation = function (memberIds, name, look) {
    var ids = (memberIds || []).map(mine).filter(function (x) { return x && x !== myId; });
    if (!ids.length) return Promise.reject(fail('unknown', 'Pick at least one person.'));
    var existing = ids.length === 1 && D.conversations.filter(function (c) { return c.type === 'direct' && mine(c.with) === ids[0]; })[0];
    var call = ids.length === 1 ? sb.rpc('open_direct', { p_other: ids[0] })
      : sb.rpc('create_group', { p_name: name || '', p_members: ids, p_c1: look && look.c1 || null, p_c2: look && look.c2 || null });
    return call.then(function (r) {
      if (r.error) throw r.error;
      var id = r.data;
      var pic = (ids.length > 1 && look && look.avatar) ? fetch(look.avatar).then(function (x) { return x.blob(); }).then(function (b) {
        var path = myId + '/group-' + id + '-' + Date.now() + '.png';
        return uploadTo('avatars', path, b).then(function () { return sb.from('conversations').update({ avatar_path: path }).eq('id', id); });
      }).catch(function () {}) : Promise.resolve();
      return pic.then(loadConversations).then(function () { return { id: id, created: !existing }; });
    }).catch(function (e) { throw wrapErr(e, 'unknown', 'Couldn’t start that chat. Try again.'); });
  };
  S.updateConversation = function (id, patch) {
    var c = conv(id); if (!c || c.type !== 'group') return Promise.resolve(null);
    var who = D.people.you.name, upd = {}, notes = [], work = Promise.resolve();
    if (patch.name && patch.name !== c.name) { upd.name = patch.name; notes.push([who + ' changed the group name to “' + patch.name + '”', 'pencil']); }
    var look = ('avatar' in patch && (patch.avatar || null) !== (c.avatar || null)) || (patch.c1 && (patch.c1 !== c.c1 || patch.c2 !== c.c2));
    if (patch.c1) { upd.c1 = patch.c1; upd.c2 = patch.c2; }
    if ('avatar' in patch) {
      if (patch.avatar && patch.avatar !== c.avatar) work = fetch(patch.avatar).then(function (r) { return r.blob(); }).then(function (b) {
        var path = myId + '/group-' + id + '-' + Date.now() + '.png'; return uploadTo('avatars', path, b).then(function () { upd.avatar_path = path; });
      }); else if (!patch.avatar) upd.avatar_path = null;
    }
    if (look) notes.push([who + ' changed the group picture', 'image']);
    return work.then(function () {
      if (!Object.keys(upd).length) return c;
      return sb.from('conversations').update(upd).eq('id', id).then(function (r) { if (r.error) throw r.error; });
    }).then(function () { return Promise.all(notes.map(function (n) { return sb.rpc('add_system_note', { p_conv: id, p_text: n[0], p_icon: n[1] }); })); })
      .then(loadConversations).then(function () { return conv(id); })
      .catch(function (e) { throw wrapErr(e, 'unknown', 'Couldn’t save the group changes. Try again.'); });
  };
  function memberFlag(id, patch) {
    var c = conv(id); if (c) { Object.assign(c, patch.local); emit('conversations'); }
    return sb.from('conversation_members').update(patch.row).eq('conversation_id', id).eq('user_id', myId).then(function () { return c; });
  }
  S.setPinned = function (id, on) { return memberFlag(id, { local: { pinned: !!on }, row: { pinned: !!on } }); };
  S.setChatMuted = function (id, on) { return memberFlag(id, { local: { muted: !!on }, row: { muted: !!on } }); };
  S.leaveGroup = function (id) {
    var c = conv(id); if (!c || c.type !== 'group') return Promise.resolve(false);
    return sb.rpc('leave_group', { p_conv: id }).then(function (r) {
      if (r.error || !r.data) return false;
      var at = D.conversations.indexOf(c); if (at !== -1) D.conversations.splice(at, 1);
      delete msgs[id]; delete loaded[id]; emit('conversations'); return true;
    }).catch(function () { return false; });
  };
  S.markRead = function (id) {
    var c = conv(id); if (c && (c.unread || c.mention)) { c.unread = 0; c.mention = false; emit('conversations'); }
    sb.rpc('mark_read', { p_conv: id }).then(function () {});
  };
  S.setViewing = function (id) { viewing = id; };
  S.getPreview = function (id) { var c = conv(id), l = lastReal(id); return l ? previewOf(l) : (c && c._prev) || { text: 'No messages yet', time: '', from: null }; };
  S.getShared = function (id) {
    var out = { media: [], files: [], links: [] };
    (msgs[id] || []).slice().reverse().forEach(function (m) {
      if (m.deleted) return;
      var who = (D.people[m.from] || {}).name || '';
      if (m.type === 'image') (m.images && m.images.length ? m.images : (m.image ? [{ image: m.image, name: m.name }] : [])).forEach(function (i) { if (i.image) out.media.push(i); });
      else if (m.type === 'file' && m.file) out.files.push({ name: m.file.name, meta: m.file.size + (who ? ' · ' + who : '') });
      else if (m.type === 'link' && m.link) out.links.push({ name: m.link.title, meta: m.link.domain });
    });
    return out;
  };

  /* ---------------------------------------------------------------- messages (API) */
  S.loadHistory = loadHistory;
  /* Big photos are shrunk before they upload: long edge at most 2000 px, saved as JPEG (PNG screenshots stay PNG unless huge).
     GIFs and already-small pictures go up untouched. If anything goes wrong, the original is sent. */
  var MAX_EDGE = 2000, KEEP_UNDER = 1500000;
  function shrink(blob, name) {
    var keep = { blob: blob, name: name };
    if (!/^image\/(jpeg|png|webp)$/.test(blob.type) || typeof createImageBitmap !== 'function') return Promise.resolve(keep);
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).then(function (bmp) {
      var scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      if (scale === 1 && blob.size <= KEEP_UNDER) { if (bmp.close) bmp.close(); return keep; }
      var w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale), cv = document.createElement('canvas'), g = cv.getContext('2d');
      cv.width = w; cv.height = h;
      function out(type, q) { return new Promise(function (res) { cv.toBlob(res, type, q); }); }
      function paint(white) { g.clearRect(0, 0, w, h); if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); } g.drawImage(bmp, 0, 0, w, h); }
      var isPng = blob.type === 'image/png', job;
      if (isPng) { paint(false); job = out('image/png').then(function (p) { if (p && p.size <= KEEP_UNDER) return { b: p, jpg: false }; paint(true); return out('image/jpeg', 0.85).then(function (j) { return { b: j, jpg: true }; }); }); }
      else { paint(true); job = out('image/jpeg', 0.85).then(function (j) { return { b: j, jpg: blob.type !== 'image/jpeg' }; }); }
      return job.then(function (r) {
        if (bmp.close) bmp.close();
        if (!r.b || r.b.size >= blob.size) return keep;
        return { blob: r.b, name: r.jpg ? name.replace(/\.[^.]+$/, '') + '.jpg' : name };
      });
    }).catch(function () { return keep; });
  }
  function stamp(local) { local.time = clock(local.createdAt); local.d = 0; }
  function doSend(cid, local) {
    var payload = local._payload || {}, row = { conversation_id: cid, sender_id: myId, type: local.type, text: local.text || '', client_id: local._client, payload: {} };
    var reply = local.replyTo && !/^local-/.test(local.replyTo) ? local.replyTo : null; if (reply) row.reply_to = reply;
    var uploads = [];
    var imageJob = null;
    if (local.type === 'image') {
      var items = payload.images && payload.images.length ? payload.images : [{ file: payload.file, name: payload.name, image: payload.image }];
      items = items.filter(function (it) { return it.file || it.blob; });
      if (!items.length) return Promise.reject(fail('unknown', 'That photo couldn\u2019t be read.'));
      imageJob = Promise.all(items.map(function (it) {
        var blob = it.file || it.blob;
        return shrink(blob, it.name || blob.name || 'photo').then(function (r) {
          var path = cid + '/' + uuid() + '-' + safeName(r.name);
          if (it.image) urlCache[path] = it.image;
          return uploadTo('attachments', path, r.blob).then(function () { return { path: path, name: r.name }; });
        });
      })).then(function (list) { row.payload.images = list; });
    } else if (local.type === 'file') {
      var f = payload.file || {}, blob2 = f.blob || f.file;
      if (!blob2) return Promise.reject(fail('unknown', 'That file couldn’t be read.'));
      var p2 = cid + '/' + uuid() + '-' + safeName(f.name || blob2.name);
      row.payload.file = { path: p2, name: f.name || blob2.name, size: blob2.size };
      uploads.push(uploadTo('attachments', p2, blob2));
    } else if (local.type === 'gif' && payload.gif) row.payload.gif = { label: payload.gif.label, emoji: payload.gif.emoji };
    else if (local.type === 'link' && payload.link) row.payload.link = { title: payload.link.title, domain: payload.link.domain, url: payload.link.url || null };
    return Promise.all(uploads.concat(imageJob ? [imageJob] : [])).then(function () { return sb.from('messages').insert(row).select('*').single(); }).then(function (r) {
      if (r.error && r.error.code === '23505') return sb.from('messages').select('*').eq('sender_id', myId).eq('client_id', local._client).single();
      return r;
    }).then(function (r) {
      if (r.error) throw r.error;
      var real = mapMsg(Object.assign({}, r.data, { reactions: [] }));
      // keep the pictures we already have on screen so they do not flicker
      if (local.images) real.images = local.images; if (local.image) real.image = local.image;
      local.id = real.id; local.createdAt = real.createdAt; stamp(local); delete local.failed; delete local._local;
      Object.keys(real).forEach(function (k) { if (k !== 'images' && k !== 'image') local[k] = real[k]; });
      if (!local.images && real.images) local.images = real.images; if (!local.image && real.image) local.image = real.image;
      delete pendingByClient[local._client]; return local;
    });
  }
  function runSend(cid, local) {
    pendingByClient[local._client] = true;
    return doSend(cid, local).then(function (m) {
      bump(cid, m); emit('message', { conversationId: cid, message: m, updated: true }); emit('conversations'); return m;
    }, function (e) {
      delete pendingByClient[local._client]; local.failed = true;
      emit('message', { conversationId: cid, message: local, updated: true }); return local;
    });
  }
  S.sendMessage = function (id, payload) {
    var now = new Date().toISOString();
    var local = { id: 'local-' + uuid(), _local: true, _client: uuid(), _payload: payload, from: 'you', type: payload.type || 'text', text: payload.text || '', createdAt: now, replyTo: payload.replyTo || null, reactions: [] };
    stamp(local);
    ['file', 'link', 'gif', 'image', 'images', 'name'].forEach(function (k) {
      if (!payload[k]) return;
      if (k === 'file') local.file = { name: payload.file.name, size: payload.file.size && typeof payload.file.size === 'string' ? payload.file.size : fmtSize(payload.file.blob && payload.file.blob.size) };
      else if (k === 'images') local.images = payload.images.map(function (i) { return { image: i.image, name: i.name }; });
      else local[k] = payload[k];
    });
    stopTyping(id);
    (msgs[id] = msgs[id] || []).push(local);
    bump(id, local);
    if (!net.online) local.failed = true;
    emit('message', { conversationId: id, message: local }); emit('conversations');
    if (!local.failed) runSend(id, local);
    return Promise.resolve(local);
  };
  S.retryMessage = function (id, messageId) {
    var m = (msgs[id] || []).filter(function (x) { return x.id === messageId && x.failed; })[0]; if (!m) return Promise.resolve(false);
    delete m.failed; emit('message', { conversationId: id, message: m, updated: true });
    return runSend(id, m).then(function (x) { return !x.failed; });
  };
  S.discardMessage = function (id, messageId) {
    var list = msgs[id] || [], at = -1; list.forEach(function (x, i) { if (x.id === messageId && x.failed) at = i; });
    if (at === -1) return Promise.resolve(false);
    list.splice(at, 1); emit('message', { conversationId: id, updated: true, message: list[list.length - 1] || { text: '' } }); emit('conversations'); return Promise.resolve(true);
  };
  S.editMessage = function (id, messageId, text) {
    var m = (msgs[id] || []).filter(function (x) { return x.id === messageId && x.from === 'you'; })[0];
    text = String(text || '').trim(); if (!m || m.deleted || !text || m._local) return Promise.resolve(null);
    var before = m.text; m.text = text; m.edited = true; emit('message', { conversationId: id, message: m, updated: true }); bump(id, lastReal(id));
    return sb.from('messages').update({ text: text, edited_at: new Date().toISOString() }).eq('id', messageId).then(function (r) {
      if (r.error) { m.text = before; emit('message', { conversationId: id, message: m, updated: true }); return null; }
      emit('conversations'); return m;
    });
  };
  S.deleteMessage = function (id, messageId) {
    var m = (msgs[id] || []).filter(function (x) { return x.id === messageId && x.from === 'you'; })[0]; if (!m || m._local) return Promise.resolve(null);
    m.deleted = true; m.reactions = []; m.text = ''; emit('message', { conversationId: id, message: m, updated: true }); emit('conversations');
    return sb.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId).then(function () { return m; });
  };
  S.toggleReaction = function (id, messageId, emoji) {
    var m = (msgs[id] || []).filter(function (x) { return x.id === messageId; })[0]; if (!m || m._local) return Promise.resolve();
    m.reactions = m.reactions || [];
    var r = m.reactions.filter(function (x) { return x.emoji === emoji; })[0], adding;
    if (r) { r.mine = !r.mine; adding = r.mine; r.count += adding ? 1 : -1; if (r.count <= 0) m.reactions = m.reactions.filter(function (x) { return x !== r; }); }
    else { adding = true; m.reactions.push({ emoji: emoji, count: 1, mine: true }); }
    emit('message', { conversationId: id, message: m, updated: true });
    var q = adding ? sb.from('reactions').insert({ message_id: messageId, user_id: myId, emoji: emoji })
      : sb.from('reactions').delete().eq('message_id', messageId).eq('user_id', myId).eq('emoji', emoji);
    return q.then(function (res) { if (res.error && res.error.code !== '23505') return loadHistoryAgain(id); return m; });
  };
  function loadHistoryAgain(id) { loaded[id] = false; return loadHistory(id).then(function (l) { emit('message', { conversationId: id, message: l[l.length - 1], updated: true }); }); }

  S.search = function (query) {
    var q = String(query || '').trim().toLowerCase(), res = [];
    if (!q) return Promise.resolve(res);
    D.conversations.forEach(function (c) {
      var name = c.type === 'direct' ? (D.people[c.with] || {}).name : c.name;
      if (name && name.toLowerCase().indexOf(q) !== -1) res.push({ kind: 'chat', conversationId: c.id, title: name, text: c.type === 'direct' ? 'Direct message' : c.members.length + ' members' });
    });
    var photoWord = q.length >= 3 && ['photo', 'photos', 'picture', 'pictures', 'image', 'images'].some(function (w) { return w.indexOf(q) === 0; });
    var jobs = [sb.rpc('search_all', { q: q })];
    if (photoWord) jobs.push(sb.from('messages').select('*').eq('type', 'image').is('deleted_at', null).order('created_at', { ascending: false }).limit(60));
    return Promise.all(jobs).then(function (out) {
      var rows = [], seen = {};
      (out[0].data || []).forEach(function (r) { rows.push({ kind: r.kind, conversation_id: r.conversation_id, id: r.message_id, sender_id: r.sender_id, created_at: r.created_at, text: r.snippet, payload: r.payload || {}, title: r.title }); seen[r.message_id] = true; });
      if (out[1] && out[1].data) out[1].data.forEach(function (r) { if (!seen[r.id]) rows.push({ kind: 'photo', conversation_id: r.conversation_id, id: r.id, sender_id: r.sender_id, created_at: r.created_at, text: r.text, payload: r.payload || {}, title: '' }); });
      var paths = []; rows.forEach(function (x) { paths = paths.concat(pathsOf(x)); });
      return signPaths(paths).then(function () {
        rows.forEach(function (r) {
          var c = conv(r.conversation_id); if (!c) return;
          var name = c.type === 'direct' ? (D.people[c.with] || {}).name : c.name;
          var item = { conversationId: r.conversation_id, messageId: r.id, from: pid(r.sender_id), time: clock(r.created_at), d: dayDiff(r.created_at), convName: name, convType: c.type, kind: r.kind };
          if (r.kind === 'photo') {
            var imgs = (r.payload.images || []).map(function (i) { return { image: urlCache[i.path] || '', name: i.name }; });
            var hit = imgs.filter(function (i) { return (i.name || '').toLowerCase().indexOf(q) !== -1; })[0];
            item.title = hit ? hit.name : ''; item.text = r.text || ''; item.thumb = hit || imgs[0]; item.count = imgs.length;
          } else if (r.kind === 'file') { item.title = (r.payload.file && r.payload.file.name) || r.title; item.text = fmtSize(r.payload.file && r.payload.file.size) + (r.text ? ' · ' + r.text : ''); }
          else if (r.kind === 'link') { item.title = (r.payload.link && r.payload.link.title) || r.title; item.text = (r.payload.link && r.payload.link.domain) || ''; }
          else { item.title = ''; item.text = r.text; }
          res.push(item);
        });
        return res;
      });
    }).catch(function () { return res; });
  };

  /* ---------------------------------------------------------------- connection */
  S.getConnection = function () { return { online: net.online, reconnecting: net.reconnecting }; };
  function flushFailed() {
    var jobs = [];
    Object.keys(msgs).forEach(function (cid) { msgs[cid].forEach(function (m) { if (m.failed && m._local) jobs.push([cid, m]); }); });
    return jobs.reduce(function (p, j) { return p.then(function () { return S.retryMessage(j[0], j[1].id); }); }, Promise.resolve());
  }
  window.addEventListener('offline', function () { net.online = false; emit('connection', { online: false, reconnecting: false, dropped: true }); });
  window.addEventListener('online', function () {
    net.online = true; net.reconnecting = true; emit('connection', { online: true, reconnecting: true });
    setTimeout(function () { resync().then(flushFailed).then(function () { net.reconnecting = false; emit('connection', { online: true, reconnecting: false, restored: true }); }); }, 800);
  });
  S.reconnect = function () { if (!navigator.onLine) { emit('connection', { online: false, reconnecting: false, stillOffline: true }); return Promise.resolve(); } window.dispatchEvent(new Event('online')); return Promise.resolve(); };
  S.setOnline = function () { return Promise.resolve(); };
  S._flush = flushFailed;

  /* ---------------------------------------------------------------- Tell the Tower */
  function mapIdea(r) {
    var at = new Date(r.created_at).getTime(), from = pid(r.author_id);
    return { id: r.id, from: from, type: r.type, text: r.text, status: r.status, plus: (r.idea_plus || []).map(function (p) { return pid(p.user_id); }),
      comments: (r.idea_comments || []).slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }).map(function (c) { return { from: pid(c.author_id), text: c.text }; }),
      seen: from === 'you' || at <= towerSeenAt, time: agoLabel(r.created_at) };
  }
  function loadIdeas(notify) {
    return sb.from('ideas').select('*, idea_plus(user_id), idea_comments(author_id,text,created_at)').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return;
      var had = {}; tower.forEach(function (i) { had[i.id] = true; });
      var fresh = r.data.map(mapIdea), added = fresh.filter(function (i) { return !had[i.id] && tower.length && i.from !== 'you'; })[0];
      tower.length = 0; fresh.forEach(function (i) { tower.push(i); });
      if (notify) emit('tower', added ? { idea: added, incoming: true } : {});
    });
  }
  S.listIdeas = function () { return tower; };
  S.towerUnread = function () { return tower.filter(function (i) { return i.from !== 'you' && !i.seen; }).length; };
  S.markTowerSeen = function () {
    tower.forEach(function (i) { i.seen = true; }); towerSeenAt = Date.now(); emit('tower', {});
    sb.from('profiles').update({ tower_seen_at: new Date().toISOString() }).eq('id', myId).then(function () {});
  };
  S.addIdea = function (payload) {
    var text = String((payload && payload.text) || '').trim(); if (!text) return Promise.resolve();
    return sb.from('ideas').insert({ author_id: myId, type: payload.type === 'bug' ? 'bug' : 'idea', text: text }).select('*').single().then(function (r) {
      if (r.error) throw wrapErr(r.error);
      var idea = mapIdea(Object.assign({}, r.data, { idea_plus: [], idea_comments: [] })); idea.seen = true; idea.plus = ['you'];
      tower.unshift(idea); emit('tower', { idea: idea });
      sb.from('idea_plus').insert({ idea_id: r.data.id, user_id: myId }).then(function () {});
      return idea;
    });
  };
  S.toggleIdeaPlus = function (id) {
    var i = tower.filter(function (x) { return x.id === id; })[0]; if (!i) return Promise.resolve();
    var at = i.plus.indexOf('you'), adding = at === -1; if (adding) i.plus.push('you'); else i.plus.splice(at, 1); emit('tower', {});
    var q = adding ? sb.from('idea_plus').insert({ idea_id: id, user_id: myId }) : sb.from('idea_plus').delete().eq('idea_id', id).eq('user_id', myId);
    return q.then(function () { return i; });
  };
  S.addIdeaComment = function (id, text) {
    var i = tower.filter(function (x) { return x.id === id; })[0]; text = String(text || '').trim(); if (!i || !text) return Promise.resolve();
    i.comments.push({ from: 'you', text: text }); emit('tower', {});
    return sb.from('idea_comments').insert({ idea_id: id, author_id: myId, text: text }).then(function () { return i; });
  };
  S.setIdeaStatus = function (id, status) {
    var i = tower.filter(function (x) { return x.id === id; })[0]; if (!i || !isOwnerFlag) return Promise.resolve();
    i.status = status; emit('tower', {});
    return sb.from('ideas').update({ status: status }).eq('id', id).then(function () { return i; });
  };

  /* ---------------------------------------------------------------- calls: coming in the next update (workstream B) */
  /* Calls and ringing live in js/services.calls.js. */
  S.getUpdate = function () { return { available: false, version: null, installing: false }; };
  S.installUpdate = function () { return Promise.resolve(null); };
})();
