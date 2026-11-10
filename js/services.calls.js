/*
  Concorde live calls and ringing (workstream B), built on LiveKit.

  Loads after services.supabase.js, live mode only. Who is in which call, and who is ringing whom, is kept in
  Supabase (so every friend can see "3 in call · Join"). The sound and pictures travel through LiveKit.
  Room name = conversation id. Identity = the person's id. See backend/SERVICES.md, section "Calls".
*/
(function () {
  var C = window.Concorde, cfg = C.config || {};
  if (cfg.backend !== 'live' || !C.live) return;
  var LK = window.LivekitClient;
  if (!LK) { console.error('Concorde: live calls need the LiveKit library (js/vendor/livekit-client.js).'); return; }
  var S = C.services, L = C.live, sb = L.sb, emit = L.emit, pid = L.pid, fail = L.fail;
  var TOKEN_FN = cfg.livekitTokenFunction || 'livekit-token';
  var STALE_MS = 100000;                              // a person with no heartbeat for this long is shown as gone
  var RING_MS = 30000;                                // unanswered rings stop after this long

  var calls = {};                                     // conversation id -> { sessionId, startedAt, people: { userId: {muted,camera,sharing} } }
  var room = null, joinedConv = null, joining = false, leaving = false;
  var speakingId = null, beat = null, sweep = null, audioBox = null, liveSig = {};
  var streamCache = {};                               // "kind:id" -> { track, stream }
  var ring = null, ringTimer = null;

  function toast(t) { if (C.ui && C.ui.toast) C.ui.toast(t); }
  function nameOf(id) { var p = C.data.people[id]; return p ? p.name : 'Someone'; }

  /* ---------------------------------------------------------------- what the screens read */
  function roomStreams() {
    var out = [];
    if (!room) return out;
    function add(p, id) {
      var cam = p.getTrackPublication(LK.Track.Source.Camera), scr = p.getTrackPublication(LK.Track.Source.ScreenShare);
      if (cam && cam.track && !cam.isMuted) out.push({ id: id, kind: 'camera' });
      if (scr && scr.track && !scr.isMuted) out.push({ id: id, kind: 'screen' });
    }
    room.remoteParticipants.forEach(function (p) { add(p, pid(p.identity)); });   // friends first, so they get the big stage
    add(room.localParticipant, 'you');
    // Whoever is sharing a screen goes on the big stage first.
    out.sort(function (a, b) { return (b.kind === 'screen') - (a.kind === 'screen'); });
    return out;
  }
  function peopleIn(cid) {
    var c = calls[cid], ids = c ? Object.keys(c.people).map(pid) : [];
    if (cid === joinedConv && ids.indexOf('you') === -1) ids.push('you');
    ids.sort(function (a, b) { return (b === 'you') - (a === 'you'); });
    return ids;
  }
  function stateOf(cid) {
    var c = calls[cid], joined = cid === joinedConv;
    if (!c && !joined) return null;
    var ppl = peopleIn(cid), sharer = null;
    if (c) Object.keys(c.people).forEach(function (u) { if (c.people[u].sharing) sharer = pid(u); });
    var lp = room && joined ? room.localParticipant : null;
    if (lp && lp.isScreenShareEnabled) sharer = 'you';
    return {
      conversationId: cid, joined: joined, participants: ppl,
      muted: joined && lp ? !lp.isMicrophoneEnabled : false, sharingId: sharer,
      startedAt: c ? c.startedAt : Date.now(), streams: joined ? roomStreams() : [], speakingId: joined ? speakingId : null
    };
  }
  S.getCall = function (cid) { return stateOf(cid); };
  function announce(cid, extra) {
    var st = stateOf(cid) || { conversationId: cid, joined: false, participants: [], muted: false, sharingId: null, startedAt: Date.now(), streams: [], speakingId: null };
    if (extra) Object.assign(st, extra);
    var cv = L.conv(cid); if (cv) cv.call = stateOf(cid) ? { participants: st.participants, sharing: st.sharingId, startedAt: st.startedAt, streams: st.streams } : null;
    emit('call', st);
  }

  /* A real picture for the screens to show: a camera or screen track as a MediaStream (null if there isn't one). */
  S.getStream = function (id, kind) {
    if (!room) return null;
    var p = id === 'you' ? room.localParticipant : null;
    if (!p) room.remoteParticipants.forEach(function (rp) { if (pid(rp.identity) === id) p = rp; });
    if (!p) return null;
    var pub = p.getTrackPublication(kind === 'screen' ? LK.Track.Source.ScreenShare : LK.Track.Source.Camera);
    var t = pub && pub.track && pub.track.mediaStreamTrack;
    if (!t) return null;
    var key = kind + ':' + id, hit = streamCache[key];
    if (hit && hit.track === t) return hit.stream;
    var ms = new MediaStream([t]); streamCache[key] = { track: t, stream: ms }; return ms;
  };

  /* ---------------------------------------------------------------- who is in which call (from the database) */
  function loadCalls() {
    return Promise.all([
      sb.from('call_sessions').select('id,conversation_id,started_at').is('ended_at', null),
      sb.from('call_participants').select('session_id,user_id,muted,camera,sharing,last_seen').is('left_at', null)
    ]).then(function (r) {
      if (r[0].error || r[1].error) return;
      var next = {}, bySession = {};
      r[0].data.forEach(function (x) { next[x.conversation_id] = { sessionId: x.id, startedAt: new Date(x.started_at).getTime(), people: {} }; bySession[x.id] = next[x.conversation_id]; });
      r[1].data.forEach(function (x) {
        var s = bySession[x.session_id]; if (!s) return;
        if (x.user_id !== L.me() && Date.now() - new Date(x.last_seen).getTime() > STALE_MS) return;
        s.people[x.user_id] = { muted: x.muted, camera: x.camera, sharing: x.sharing };
      });
      Object.keys(next).forEach(function (k) { if (!Object.keys(next[k].people).length && k !== joinedConv) delete next[k]; });
      var before = calls; calls = next;
      var ids = {}; Object.keys(before).concat(Object.keys(next)).forEach(function (k) { ids[k] = 1; });
      Object.keys(ids).forEach(function (cid) {
        var sig = JSON.stringify(next[cid] ? [next[cid].sessionId, next[cid].people] : null);
        if (sig !== liveSig[cid]) { liveSig[cid] = sig; announce(cid); }
      });
      // The call I am in was ended from the other side (one-to-one: they left) or the server dropped me.
      if (joinedConv && !joining && !leaving) {
        if (!next[joinedConv]) { teardown('The call ended.'); }
        else if (!next[joinedConv].people[L.me()]) { sb.rpc('join_call', { p_conv: joinedConv }).then(function () {}); }   // swept while asleep: come back in
      }
    });
  }
  var loadSoon = (function () { var t; return function () { clearTimeout(t); t = setTimeout(loadCalls, 150); }; })();


  /* ---------------------------------------------------------------- microphone, speaker and camera choices */
  var KINDS = { mic: 'audioinput', spk: 'audiooutput', cam: 'videoinput' };
  var DEFAULT_IN = 80;
  function pref(k, d) { return C.ui && C.ui.store ? C.ui.store.get(k, d) : d; }
  function putPref(k, v) { if (C.ui && C.ui.store) C.ui.store.set(k, v); }
  var HW = S.hardware = {};
  var gainNode = null, previewStream = null;
  function constraintsFor(mode) {
    if (mode === 'strong') return { echoCancellation: true, noiseSuppression: false, autoGainControl: true };   // RNNoise does the cleaning instead of the browser
    return mode === 'studio' ? { echoCancellation: true, noiseSuppression: false, autoGainControl: false } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  }
  /* ---- Strong noise removal: RNNoise (open source, runs on your own computer; nothing is sent anywhere) ---- */
  var rnLib = null, rnWasm = null;
  function assetUrl(p) { return new URL(p, document.baseURI).href; }
  function loadRnLib() {
    if (rnLib) return rnLib;
    rnLib = new Promise(function (res, rej) {
      if (window.RnnoiseLib) return res(window.RnnoiseLib);
      var el = document.createElement('script'); el.src = assetUrl('js/vendor/rnnoise/rnnoise-lib.js');
      el.onload = function () { window.RnnoiseLib ? res(window.RnnoiseLib) : rej(new Error('rnnoise')); }; el.onerror = function () { rej(new Error('rnnoise')); };
      document.head.appendChild(el);
    }).then(function (L) {
      rnWasm = L.loadRnnoise({ url: assetUrl('js/vendor/rnnoise/rnnoise.wasm'), simdUrl: assetUrl('js/vendor/rnnoise/rnnoise_simd.wasm') });
      return rnWasm.then(function () { return L; });
    }).catch(function (e) { rnLib = null; throw e; });
    return rnLib;
  }
  var rnReady = new WeakSet();
  /* RNNoise wants 48 kHz audio. Returns { node, ctx, own } where own means we made the audio context ourselves. */
  function makeRnnoise(baseCtx) {
    var own = false, ctx = baseCtx;
    return loadRnLib().then(function (L) {
      if (!ctx || ctx.sampleRate !== 48000 || ctx.state === 'closed') { ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 }); own = true; }
      var ready = rnReady.has(ctx) ? Promise.resolve() : ctx.audioWorklet.addModule(assetUrl('js/vendor/rnnoise/worklet.js')).then(function () { rnReady.add(ctx); });
      return Promise.all([ready, rnWasm]).then(function (r) { return { node: new L.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: r[1] }), ctx: ctx, own: own }; });
    });
  }
  var rnFailedNote = false;
  function strongFailed() {
    putPref('profileMode', 'voice');
    if (C.ui && C.ui.store) C.ui.store.set('profileMode', 'voice');
    if (!rnFailedNote) { rnFailedNote = true; toast('Strong noise removal isn’t available on this computer. Switched back to Voice isolation.'); }
    var t = micTrack(); if (t && t.restartTrack) t.restartTrack(constraintsFor('voice')).catch(function () {});
    if (C.ui && C.ui.setProfileMode) C.ui.setProfileMode('voice');
  }
  function gainFor() { return Math.max(0, (+pref('vol.inp', DEFAULT_IN)) / DEFAULT_IN); }
  function listDevices() {
    var md = navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return Promise.resolve([]);
    return md.enumerateDevices().catch(function () { return []; });
  }
  /* Asks the browser for permission once (so the devices have real names), then lists them. */
  HW.load = function () {
    var md = navigator.mediaDevices, empty = { mic: [], spk: [], cam: [], blocked: false };
    if (!md || !md.getUserMedia) return Promise.resolve(empty);
    function ask() {
      return md.getUserMedia({ audio: true, video: true }).catch(function () { return md.getUserMedia({ audio: true }).catch(function () { return null; }); });
    }
    return ask().then(function (st) {
      var blocked = !st, known = {}, inUse = {};
      if (st) st.getTracks().forEach(function (t) { inUse[t.kind === 'audio' ? 'mic' : 'cam'] = t.label; try { known[t.getSettings().deviceId] = t.label; } catch (e) { /* no settings */ } });
      function readNames() {
        return listDevices().then(function (list) {
          if (st && list.length && list.every(function (d) { return !d.label; })) return new Promise(function (r) { setTimeout(r, 400); }).then(listDevices);   // names can take a moment to appear
          return list;
        });
      }
      return readNames().then(function (list) {
        if (st) st.getTracks().forEach(function (t) { t.stop(); });
        var out = { mic: [], spk: [], cam: [], blocked: blocked };
        Object.keys(KINDS).forEach(function (k) {
          var n = 0;
          list.filter(function (d) { return d.kind === KINDS[k] && d.deviceId !== 'communications'; }).forEach(function (d) {
            n++; out[k].push({ id: d.deviceId, label: d.label || known[d.deviceId] || ({ mic: 'Microphone ', spk: 'Speaker ', cam: 'Camera ' }[k] + n) });
          });
        });
        // Pages opened from a file hide every device name. Show what is in use, so the box is not blank.
        ['mic', 'cam'].forEach(function (k) { if (out[k].length === 1 && !out[k][0].id && inUse[k]) out[k][0].label = inUse[k]; });
        if (out.spk.length === 1 && !out.spk[0].id) out.spk[0].label = 'Default speaker';
        return out;
      });
    }).catch(function () { return empty; });
  };
  HW.chosen = function (k) { return pref('dev.' + k + 'Id', ''); };
  HW.choose = function (k, id) {
    putPref('dev.' + k + 'Id', id || '');
    if (k === 'cam' && previewStream) HW.preview();
    if (!room || !id) return Promise.resolve();
    if (k === 'spk' && outCtx && outCtx.setSinkId) outCtx.setSinkId(id).catch(function () {});
    return room.switchActiveDevice(KINDS[k], id).catch(function () { toast('Couldn’t switch to that device.'); });
  };
  /* The saved choices, checked against what is plugged in now, as LiveKit room settings. */
  HW.roomOptions = function () {
    return listDevices().then(function (list) {
      function pick(k) { var id = HW.chosen(k); return id && list.some(function (d) { return d.deviceId === id && d.kind === KINDS[k]; }) ? id : undefined; }
      var mic = pick('mic'), cam = pick('cam'), spk = pick('spk');
      var audio = constraintsFor(pref('profileMode', 'voice')); if (mic) audio.deviceId = mic;
      // Screen shares go out as one sharp 1080p picture (text stays readable) instead of the small default.
      var o = { adaptiveStream: { pixelDensity: 'screen' }, dynacast: true, audioCaptureDefaults: audio,
        publishDefaults: { screenShareEncoding: { maxBitrate: 6000000, maxFramerate: 30 }, screenShareSimulcastLayers: [], degradationPreference: 'maintain-resolution' } };
      if (cam) o.videoCaptureDefaults = { deviceId: cam };
      if (spk) o.audioOutput = { deviceId: spk };
      return o;
    });
  };
  function micTrack() { var pub = room && room.localParticipant.getTrackPublication(LK.Track.Source.Microphone); return pub && pub.audioTrack ? pub.audioTrack : null; }
  var procOwnCtx = null;
  function micProcessor() {
    var ctx, src, dest, rn = null, merger = null, own = false, strong = pref('profileMode', 'voice') === 'strong';
    return {
      name: 'concorde-mic', kind: 'audio', processedTrack: undefined,
      init: function (o) {
        var me = this, base = o.audioContext || null;
        var pre = strong ? makeRnnoise(base).catch(function () { strong = false; strongFailed(); return null; }) : Promise.resolve(null);
        return pre.then(function (r) {
          if (r) { rn = r.node; ctx = r.ctx; own = r.own; } else { ctx = base || new (window.AudioContext || window.webkitAudioContext)(); own = !base; }
          if (own && ctx.state === 'suspended') ctx.resume().catch(function () {});
          src = ctx.createMediaStreamSource(new MediaStream([o.track]));
          gainNode = ctx.createGain(); gainNode.gain.value = gainFor();
          dest = ctx.createMediaStreamDestination();
          if (rn) { src.connect(rn); merger = bothEars(ctx, rn, gainNode); } else src.connect(gainNode);
          gainNode.connect(dest);
          me.processedTrack = dest.stream.getAudioTracks()[0];
        });
      },
      restart: function (o) { var me = this; return this.destroy().then(function () { return me.init(o); }); },
      destroy: function () {
        try { if (src) src.disconnect(); if (merger) merger.disconnect(); if (rn) { rn.disconnect(); rn.destroy(); } if (gainNode) gainNode.disconnect(); if (own && ctx) ctx.close(); } catch (e) { /* closed */ }
        gainNode = null; rn = null; merger = null; return Promise.resolve();
      }
    };
  }
  /* RNNoise gives one channel. Copy it to both left and right so it doesn't play from one side only. */
  function bothEars(ctx, node, out) {
    var m = ctx.createChannelMerger(2); node.connect(m, 0, 0); node.connect(m, 0, 1); m.connect(out); return m;
  }
  var gainOn = false, gainStrong = false;
  HW._test = { micProcessor: function () { return micProcessor(); }, makeRnnoise: makeRnnoise };
  function applyInputVolume() {
    var t = micTrack(); if (!t) return Promise.resolve();
    var strong = pref('profileMode', 'voice') === 'strong', want = strong || Math.abs(gainFor() - 1) >= 0.01;
    if (gainNode && gainOn && gainStrong === strong) { gainNode.gain.value = gainFor(); return Promise.resolve(); }
    if (!want) {                                                                  // back to normal level and no RNNoise: leave the microphone untouched
      if (!gainOn) return Promise.resolve();
      gainOn = false; gainNode = null; return Promise.resolve().then(function () { return t.stopProcessor(); }).catch(function () {});
    }
    var wasOn = gainOn; gainOn = true; gainStrong = strong;
    return Promise.resolve().then(function () { return wasOn ? t.stopProcessor() : null; }).then(function () { return t.setProcessor(micProcessor()); }).catch(function () { gainOn = false; });
  }
  HW.setInputVolume = function (v) { putPref('vol.inp', v); return applyInputVolume(); };
  /* One friend louder than the rest? Turn just them down. Percent, 0 to 100, remembered per person. */
  /* Percent, 0 to 300 (above 100 is a boost for a quiet friend), remembered per person. */
  var MAX_PERSON = 300;
  function personVol(id) { var v = +pref('vol.p.' + id, 100); return isFinite(v) ? Math.max(0, Math.min(MAX_PERSON, v)) : 100; }
  function elGain(el) { return outVolume() * personVol(el.dataset.pid || '') / 100; }
  function elVolume(el) { return Math.max(0, Math.min(1, elGain(el))); }
  /* A normal audio element cannot go louder than 100%. For a boost, that person's voice goes through a gain control
     (with a limiter so it does not crackle), and the element itself is silenced so you do not hear it twice. */
  var outCtx = null;
  function boostCtx() {
    if (!outCtx) {
      outCtx = new (window.AudioContext || window.webkitAudioContext)();
      var sink = HW.chosen('spk'); if (sink && outCtx.setSinkId) outCtx.setSinkId(sink).catch(function () {});
    }
    if (outCtx.state === 'suspended') outCtx.resume().catch(function () {});
    return outCtx;
  }
  function dropBoost(el) { var b = el._boost; if (!b) return; el._boost = null; try { b.src.disconnect(); b.gn.disconnect(); b.comp.disconnect(); } catch (e) { /* already gone */ } }
  function applyEl(el) {
    var g = elGain(el);
    if (g <= 1 || !el.srcObject || !(window.AudioContext || window.webkitAudioContext)) { dropBoost(el); el.volume = Math.min(1, g); return; }
    try {
      var b = el._boost;
      if (!b) {
        var ctx = boostCtx(), src = ctx.createMediaStreamSource(el.srcObject), gn = ctx.createGain(), comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.2;
        src.connect(gn); gn.connect(comp); comp.connect(ctx.destination); b = el._boost = { src: src, gn: gn, comp: comp };
      }
      b.gn.gain.value = g; el.volume = 0;
    } catch (e) { dropBoost(el); el.volume = 1; }
  }
  function outVolume() { return Math.max(0, Math.min(1, (+pref('vol.out', 70)) / 100)); }
  /* A short two-note chime through the chosen speaker at the current output volume, so you can hear what you're setting. */
  var pingUrl = null, lastPing = 0;
  function makeChime() {
    var rate = 22050, n = Math.floor(rate * 0.45), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function str(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var t = i / rate, f = t < 0.16 ? 880 : 1318.5, local = t < 0.16 ? t : t - 0.16, env = Math.min(1, local * 120) * Math.exp(-local * 9);
      v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * f * t) * env * 0.55 * 32767), true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  HW.ping = function () {
    var now = Date.now(); if (now - lastPing < 250) return; lastPing = now;
    if (!pingUrl) pingUrl = makeChime();
    var a = new Audio(pingUrl); a.volume = outVolume();
    var sink = HW.chosen('spk'); var go = function () { a.play().catch(function () {}); };
    if (sink && a.setSinkId) a.setSinkId(sink).then(go, go); else go();
  };
  HW.setOutputVolume = function (v) {
    putPref('vol.out', v);
    if (audioBox) audioBox.querySelectorAll('audio').forEach(applyEl);
  };
  S.getPersonVolume = personVol;
  S.setPersonVolume = function (id, pct) {
    putPref('vol.p.' + id, Math.max(0, Math.min(MAX_PERSON, Math.round(+pct))));
    if (audioBox) audioBox.querySelectorAll('audio[data-pid="' + String(id).replace(/"/g, '') + '"]').forEach(applyEl);
  };
  HW.setProfile = function (mode) {
    putPref('profileMode', mode);
    var t = micTrack(); if (!t || !t.restartTrack) return Promise.resolve();
    return t.restartTrack(constraintsFor(mode)).catch(function () {}).then(function () { return applyInputVolume(); });
  };
  /* Live microphone level for the settings meter. Returns a function that stops it. */
  HW.meter = function (onLevel) {
    var md = navigator.mediaDevices; if (!md) return Promise.resolve({ hear: function () {}, stop: function () {} });
    var id = HW.chosen('mic'), audio = constraintsFor(pref('profileMode', 'voice')); if (id) audio.deviceId = { exact: id };
    var strongMode = pref('profileMode', 'voice') === 'strong';
    return md.getUserMedia({ audio: audio }).catch(function () { return md.getUserMedia({ audio: true }); }).then(function (raw) {
      if (!strongMode) return { st: raw, raw: raw, extra: null };
      return makeRnnoise(null).then(function (r) {
        var src = r.ctx.createMediaStreamSource(raw), dst = r.ctx.createMediaStreamDestination(); src.connect(r.node); var mg = bothEars(r.ctx, r.node, dst);
        if (r.ctx.state === 'suspended') r.ctx.resume().catch(function () {});
        return { st: dst.stream, raw: raw, extra: function () { try { src.disconnect(); mg.disconnect(); r.node.disconnect(); r.node.destroy(); r.ctx.close(); } catch (e) { /* closed */ } } };
      }).catch(function () { strongFailed(); return { st: raw, raw: raw, extra: null }; });
    }).then(function (pack) {
      var st = pack.st;
      var ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(), buf = new Uint8Array(512);
      an.fftSize = 512; ctx.createMediaStreamSource(st).connect(an);
      var tm = setInterval(function () {
        an.getByteTimeDomainData(buf); var sum = 0; for (var i = 0; i < buf.length; i++) { var d = (buf[i] - 128) / 128; sum += d * d; }
        onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4 * gainFor()));
      }, 70);
      var ear = null;
      return {
        hear: function (on) {                       // play the microphone back through the chosen speaker (headphones advised)
          if (!on) { if (ear) { ear.pause(); ear.srcObject = null; ear = null; } return; }
          if (ear) return;
          ear = new Audio(); ear.srcObject = st; ear.volume = outVolume();
          var sink = HW.chosen('spk'); if (sink && ear.setSinkId) ear.setSinkId(sink).catch(function () {});
          ear.play().catch(function () {});
        },
        stop: function () { if (ear) { ear.pause(); ear.srcObject = null; ear = null; } clearInterval(tm); if (pack.extra) pack.extra(); pack.raw.getTracks().forEach(function (t) { t.stop(); }); try { ctx.close(); } catch (e) { /* closed */ } }
      };
    }).catch(function () { toast('Couldn’t reach your microphone. Check that Concorde is allowed to use it.'); return { hear: function () {}, stop: function () {} }; });
  };
  HW.preview = function () {
    HW.stopPreview();
    var md = navigator.mediaDevices; if (!md) return Promise.resolve(null);
    var id = HW.chosen('cam');
    return md.getUserMedia({ video: id ? { deviceId: { ideal: id } } : true }).then(function (st) { previewStream = st; return st; }).catch(function () { return null; });
  };
  HW.stopPreview = function () { if (previewStream) { previewStream.getTracks().forEach(function (t) { t.stop(); }); previewStream = null; } };

  /* ---------------------------------------------------------------- joining and leaving */
  function ensureAudioBox() { if (!audioBox) { audioBox = document.createElement('div'); audioBox.style.display = 'none'; audioBox.id = 'call-audio'; document.body.appendChild(audioBox); } return audioBox; }
  function wireRoom(r, cid) {
    var E = LK.RoomEvent;
    function changed() { if (joinedConv === cid) announce(cid); }
    r.on(E.TrackSubscribed, function (track, pub, part) {
      if (track.kind === 'audio') { var el = track.attach(); el.dataset.pid = (part && part.identity) || ''; ensureAudioBox().appendChild(el); applyEl(el); }
      changed();
    });
    r.on(E.TrackUnsubscribed, function (track) {
      if (track.kind === 'audio') track.detach().forEach(function (el) { dropBoost(el); el.remove(); });
      changed();
    });
    [E.TrackMuted, E.TrackUnmuted, E.LocalTrackPublished, E.ParticipantConnected, E.ParticipantDisconnected].forEach(function (ev) { r.on(ev, changed); });
    r.on(E.LocalTrackUnpublished, function () { changed(); pushState(); });
    r.on(E.ActiveSpeakersChanged, function (list) {
      var top = null;
      (list || []).forEach(function (p) { if (!top || p.audioLevel > top.audioLevel) top = p; });
      var id = top ? pid(top.identity) : null;
      if (id !== speakingId) { speakingId = id; changed(); }
    });
    r.on(E.DataReceived, function (data, part, kind, topic) {
      if (topic !== 'sfx') return;
      try { var m = JSON.parse(new TextDecoder().decode(data)); emit('sound', { id: m.id, from: part ? pid(part.identity) : null }); } catch (e) {}
    });
    r.on(E.Reconnecting, function () { toast('Reconnecting to the call…'); });
    r.on(E.Reconnected, function () { toast('Back in the call'); });
    r.on(E.Disconnected, function () { if (joinedConv === cid && !leaving) teardown('You were disconnected from the call.'); });
    r.on(E.AudioPlaybackStatusChanged, function () {
      if (!r.canPlaybackAudio) {
        toast('Click anywhere to hear the call');
        var go = function () { document.removeEventListener('click', go, true); r.startAudio().catch(function () {}); };
        document.addEventListener('click', go, true);
      }
    });
  }
  /* Soundboard: tell everyone in the call which clip to play. Each person's app plays it. */
  S.playSound = function (id) {
    if (!room || !joinedConv) return Promise.resolve(false);
    var data = new TextEncoder().encode(JSON.stringify({ id: id }));
    return room.localParticipant.publishData(data, { reliable: true, topic: 'sfx' }).then(function () { return true; }, function () { return false; });
  };
  function pushState() {
    if (!joinedConv || !room) return;
    var lp = room.localParticipant;
    sb.rpc('touch_call', { p_conv: joinedConv, p_muted: !lp.isMicrophoneEnabled, p_camera: !!lp.isCameraEnabled, p_sharing: !!lp.isScreenShareEnabled }).then(function () {});
  }
  function startTimers() {
    clearInterval(beat); beat = setInterval(pushState, 30000);
  }
  /* Everything local is cleaned up. Used on leave, on being dropped, and when the other side ends a one-to-one call. */
  function teardown(message) {
    var cid = joinedConv; if (!cid) return;
    clearInterval(beat); beat = null;
    var r = room; room = null; joinedConv = null; speakingId = null; streamCache = {}; gainOn = false; gainNode = null;
    try { if (r) r.disconnect(); } catch (e) { /* already closed */ }
    if (audioBox) audioBox.innerHTML = '';
    delete liveSig[cid];
    if (message) toast(message);
    sb.rpc('leave_call', { p_conv: cid }).then(function () {});
    loadCalls().then(function () { announce(cid); });
    announce(cid);
  }

  function connect(cid, opts) {
    opts = opts || {};
    if (!navigator.mediaDevices) { toast('Calls need a secure page and a microphone. Open Concorde from the app or https.'); return Promise.resolve(null); }
    var go = joinedConv === cid ? Promise.resolve() : (joinedConv ? S.leaveCall() : Promise.resolve());
    return go.then(function () {
      if (joinedConv === cid) return stateOf(cid);
      joining = true;
      var r = null;
      return HW.roomOptions().then(function (ro) { r = new LK.Room(ro); return sb.rpc('join_call', { p_conv: cid }); }).then(function (j) {
        if (j.error) throw j.error;
        return sb.functions.invoke(TOKEN_FN, { body: { conversationId: cid } });
      })      .then(function (t) {
        if (t.error || !t.data || !t.data.token) throw t.error || new Error('no token');
        wireRoom(r, cid);
        room = r; joinedConv = cid;
        return r.connect(t.data.url || cfg.livekitUrl, t.data.token);
      }).then(function () {
        try { r.startAudio().catch(function () {}); } catch (e) { /* needs a click: handled by AudioPlaybackStatusChanged */ }
        var ptt = C.ui && C.ui.state && C.ui.state.ptt;
        return (ptt ? Promise.resolve() : r.localParticipant.setMicrophoneEnabled(true).then(applyInputVolume)).catch(function () { toast('Couldn’t reach your microphone. You can listen, but not talk.'); });
      }).then(function () {
        joining = false; startTimers(); pushState();
        return loadCalls().then(function () { announce(cid, { focus: !!opts.focus }); return stateOf(cid); });
      }).catch(function (e) {
        joining = false;
        try { if (r) r.disconnect(); } catch (x) { /* never connected */ }
        if (joinedConv === cid) { room = null; joinedConv = null; }
        sb.rpc('leave_call', { p_conv: cid }).then(function () {});
        var offline = !navigator.onLine;
        toast(offline ? 'Concorde can’t reach the server. Check your internet.' : 'Couldn’t join the call. Try again in a moment.');
        console.error('Concorde call:', e);
        announce(cid);
        throw L.wrapErr(e, 'call-failed', 'Couldn’t join the call.');
      });
    });
  }
  S.startCall = function (cid) { return connect(cid, {}).catch(function () { return null; }); };
  S.joinCall = S.startCall;
  S.leaveCall = function () {
    if (!joinedConv) return Promise.resolve();
    leaving = true;
    teardown(null);
    leaving = false;
    return Promise.resolve();
  };

  /* ---------------------------------------------------------------- mic, camera, screen */
  S.setMuted = function (m) {
    if (!room) return Promise.resolve();
    return room.localParticipant.setMicrophoneEnabled(!m).catch(function () { toast('Couldn’t reach your microphone.'); }).then(function () { announce(joinedConv); pushState(); });
  };
  S.setCamera = function (on) {
    if (!room) return Promise.resolve();
    return room.localParticipant.setCameraEnabled(!!on).catch(function () { toast('Couldn’t reach your camera. Check that Concorde is allowed to use it.'); }).then(function () { announce(joinedConv); pushState(); });
  };
  S.startScreenShare = function (opts) {
    if (!room) return Promise.resolve();
    return room.localParticipant.setScreenShareEnabled(true, { audio: !!(opts && opts.sound), resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'detail' }).catch(function (e) {
      if (e && /permission|denied|abort|cancel/i.test(String(e.name || e.message))) return;   // they closed the picker
      toast('Couldn’t share your screen.');
    }).then(function () { announce(joinedConv); pushState(); });
  };
  S.stopScreenShare = function () {
    if (!room) return Promise.resolve();
    return room.localParticipant.setScreenShareEnabled(false).catch(function () {}).then(function () { announce(joinedConv); pushState(); });
  };

  /* ---------------------------------------------------------------- ringing (one-to-one) */
  function setRing(r) { ring = r; emit('ring', ring); }
  function clearRing(why) { clearTimeout(ringTimer); ringTimer = null; if (!ring) return; ring = null; emit('ring', null); if (why) toast(why); }
  function armTimeout(row) {
    clearTimeout(ringTimer);
    ringTimer = setTimeout(function () {
      if (!ring || ring.id !== row.id || ring.status !== 'ringing') return;
      var out = ring.direction === 'out', who = ring.personId;
      sb.rpc('miss_ring', { p_ring: row.id }).then(function () {});
      clearRing(out ? nameOf(who) + ' didn’t answer' : null);
    }, Math.max(1000, RING_MS - (Date.now() - new Date(row.created_at).getTime())));
  }
  S.getRing = function () { return ring; };
  S.startDirectCall = function (cid, kind) {
    if (ring || joinedConv) { toast(joinedConv ? 'You’re already in a call.' : 'Finish the current call first.'); return Promise.resolve(null); }
    var cv = L.conv(cid); if (!cv || cv.type !== 'direct') return Promise.resolve(null);
    return sb.rpc('create_ring', { p_conv: cid, p_kind: kind }).then(function (r) {
      if (r.error) throw r.error;
      var row = r.data;
      setRing({ id: row.id, conversationId: cid, personId: cv.with, kind: kind, direction: 'out', status: row.status === 'dnd' ? 'dnd' : 'ringing', _kind: kind });
      if (row.status !== 'dnd') armTimeout(row);
      return ring;
    }).catch(function (e) { toast(navigator.onLine ? 'Couldn’t start the call. Try again.' : 'Concorde can’t reach the server.'); console.error(e); return null; });
  };
  S.answerRing = function () {
    var r = ring; if (!r || r.direction !== 'in' || r.status !== 'ringing') return Promise.resolve(null);
    clearRing();
    return sb.rpc('end_ring', { p_ring: r.id, p_status: 'answered' }).then(function () {
      return connect(r.conversationId, { focus: true });
    }).then(function (st) { if (r.kind === 'video') return S.setCamera(true).then(function () { return st; }); return st; }).catch(function () { return null; });
  };
  S.endRing = function () {
    var r = ring; if (!r) return Promise.resolve(null);
    var done = r.status === 'declined' || r.status === 'dnd';
    clearRing();
    if (done) return Promise.resolve(null);
    return sb.rpc('end_ring', { p_ring: r.id, p_status: r.direction === 'out' ? 'cancelled' : 'declined' }).then(function () { return null; });
  };
  function onRing(ev, row) {
    if (!row || !row.id) return;
    var me = L.me();
    if (ev === 'INSERT' && row.callee_id === me && row.status === 'ringing') {
      if (new Date(row.created_at).getTime() < Date.now() - RING_MS) return;
      if (ring || joinedConv) { sb.rpc('end_ring', { p_ring: row.id, p_status: 'declined' }).then(function () {}); return; }   // already busy
      setRing({ id: row.id, conversationId: row.conversation_id, personId: pid(row.caller_id), kind: row.kind, direction: 'in', status: 'ringing' });
      armTimeout(row);
      return;
    }
    if (ev !== 'UPDATE' || !ring || ring.id !== row.id) return;
    if (row.status === 'answered' && ring.direction === 'out') {
      var r = ring; clearRing();
      connect(r.conversationId, { focus: true }).then(function () { if (r.kind === 'video') S.setCamera(true); }).catch(function () {});
    } else if (row.status === 'declined' && ring.direction === 'out') {
      clearTimeout(ringTimer); ring.status = 'declined'; emit('ring', ring);
    } else if (row.status === 'cancelled' || row.status === 'missed' || row.status === 'declined' || row.status === 'answered') {
      clearRing();
    }
  }

  /* ---------------------------------------------------------------- hooks into the live adapter */
  L.hooks.listen.push(function (db, on) {
    on('call_sessions', '*', loadSoon);
    on('call_participants', '*', loadSoon);
    on('rings', 'INSERT', function (p) { onRing('INSERT', p.new); });
    on('rings', 'UPDATE', function (p) { onRing('UPDATE', p.new); });
  });
  L.hooks.boot.push(function () {
    clearInterval(sweep); sweep = setInterval(loadCalls, 45000);       // also drops people whose heartbeat stopped
    return loadCalls();
  });
  L.hooks.reset.push(function () {
    clearInterval(sweep); sweep = null; clearInterval(beat); beat = null; clearTimeout(ringTimer);
    try { if (room) room.disconnect(); } catch (e) { /* closed */ }
    room = null; joinedConv = null; calls = {}; liveSig = {}; ring = null; speakingId = null; streamCache = {};
  });
})();
