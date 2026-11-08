/* Celebration effects: confetti, fireworks and floating hearts.
   One see-through canvas sits over the whole window for a few seconds, then goes away.
   No libraries. People who ask their computer for less motion get nothing (the message still sends). */
(function () {
  'use strict';
  var C = (window.Concorde = window.Concorde || {});
  var COLORS = ['#f03e3e', '#f59f00', '#37b24d', '#1c7ed6', '#ae3ec9', '#f06595', '#fcc419'];
  var cv = null, g = null, parts = [], raf = 0, last = 0, queue = [];

  function calm() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function ensure() {
    if (cv) return;
    cv = document.createElement('canvas'); cv.className = 'fx-canvas'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv); g = cv.getContext('2d'); size();
    window.addEventListener('resize', size);
  }
  function size() { if (!cv) return; var d = window.devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; g.setTransform(d, 0, 0, d, 0, 0); }

  function confetti() {
    for (var side = 0; side < 2; side++) for (var i = 0; i < 70; i++) {
      var a = side ? rnd(-2.6, -2.0) : rnd(-1.14, -0.54), v = rnd(9, 17);
      parts.push({ k: 'c', x: side ? innerWidth + 10 : -10, y: innerHeight * 0.75, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(6, 11), h: rnd(4, 7), r: rnd(0, 6), vr: rnd(-0.3, 0.3), col: pick(COLORS), life: rnd(160, 230), t: 0, grav: 0.24, drag: 0.985 });
    }
  }
  function burst(x, y) {
    var col = pick(COLORS), n = 54;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05), v = rnd(2, 6.5);
      parts.push({ k: 's', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: Math.random() < 0.25 ? '#fff' : col, life: rnd(55, 85), t: 0, grav: 0.07, drag: 0.965, tr: [] });
    }
  }
  function fireworks() {
    for (var i = 0; i < 6; i++) (function (n) {
      queue.push({ at: performance.now() + n * 420 + rnd(0, 150), fn: function () { burst(rnd(innerWidth * 0.15, innerWidth * 0.85), rnd(innerHeight * 0.12, innerHeight * 0.5)); } });
    })(i);
  }
  function hearts() {
    for (var i = 0; i < 38; i++) parts.push({ k: 'h', x: rnd(0, innerWidth), y: innerHeight + rnd(10, 220), vx: rnd(-0.6, 0.6), vy: rnd(-3.6, -1.8), s: rnd(16, 34), ch: pick(['❤️', '💖', '💗', '💕', '🩷']), life: rnd(230, 330), t: 0, grav: 0, drag: 1, sw: rnd(0, 6) });
  }

  function frame(now) {
    var dt = Math.min(2, (now - last) / 16.7 || 1); last = now;
    for (var q = queue.length - 1; q >= 0; q--) if (queue[q].at <= now) { queue[q].fn(); queue.splice(q, 1); }
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i]; p.t += dt;
      if (p.t > p.life) { parts.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt); p.vy = p.vy * Math.pow(p.drag, dt) + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      var fade = Math.max(0, Math.min(1, (p.life - p.t) / 30));
      g.globalAlpha = fade;
      if (p.k === 'c') { p.r += p.vr * dt; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.cos(p.r * 1.3)); g.fillStyle = p.col; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); }
      else if (p.k === 's') {
        p.tr.push([p.x, p.y]); if (p.tr.length > 5) p.tr.shift();
        g.strokeStyle = p.col; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(p.tr[0][0], p.tr[0][1]); for (var j = 1; j < p.tr.length; j++) g.lineTo(p.tr[j][0], p.tr[j][1]); g.stroke();
      } else { g.font = p.s + 'px serif'; g.fillText(p.ch, p.x + Math.sin((p.t + p.sw * 20) / 22) * 18, p.y); }
    }
    g.globalAlpha = 1;
    if (parts.length || queue.length) raf = requestAnimationFrame(frame);
    else { raf = 0; if (cv) { cv.remove(); cv = null; g = null; window.removeEventListener('resize', size); } }
  }

  var EFFECTS = { confetti: confetti, fireworks: fireworks, hearts: hearts };
  C.fx = {
    names: ['confetti', 'fireworks', 'hearts'],
    play: function (name) {
      if (!EFFECTS[name] || calm()) return false;
      ensure(); EFFECTS[name]();
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      return true;
    },
    /* a reaction can set one off too */
    forEmoji: function (e) { return e === '🎉' ? 'confetti' : (e === '🎆' || e === '🎇') ? 'fireworks' : null; }
  };
})();
