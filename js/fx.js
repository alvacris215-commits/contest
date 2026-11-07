'use strict';

/** Canvas effects: warp starfield + nebula background, particles, shockwaves, confetti, sparkles. */
const FX = (() => {
  let bg, fx, bx, fc, W = 0, H = 0, dpr = 1, raf = 0, running = false, last = 0;
  const stars = [], parts = [], rings = [], emitters = [], blobs = [];
  let warp = 0, warpTarget = 0;

  const GOLD = ['#fff7d6', '#f5c451', '#ffd98a', '#ffe9b0', '#fbbf24', '#ffffff'];
  const MAGIC = ['#ffffff', '#f5c451', '#c4b5fd', '#8b5cf6', '#ec4899', '#38bdf8', '#ffe9b0'];
  const CONF = ['#f5c451', '#ec4899', '#8b5cf6', '#38bdf8', '#34d399', '#f87171', '#ffffff'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rp = a => a[Math.floor(Math.random() * a.length)];
  const TAU = Math.PI * 2;

  function init(bgCanvas, fxCanvas) {
    bg = bgCanvas; fx = fxCanvas;
    bx = bg.getContext('2d'); fc = fx.getContext('2d');
    resize();
    addEventListener('resize', resize);
    for (let i = 0; i < 320; i++) stars.push(newStar());
    [265, 295, 220, 320, 200].forEach((hue, i) => blobs.push({
      x: [0.2, 0.8, 0.5, 0.15, 0.85][i], y: [0.25, 0.3, 0.8, 0.75, 0.8][i],
      r: rnd(0.35, 0.55), hue, ph: rnd(0, TAU), sp: rnd(0.00008, 0.00018)
    }));
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    for (const c of [bg, fx]) { c.width = W * dpr; c.height = H * dpr; }
    bx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function newStar(z) {
    return { x: rnd(-1, 1), y: rnd(-1, 1), z: z ?? rnd(0.05, 1), tw: rnd(0, TAU), hue: rp([220, 260, 45, 0]) };
  }

  function drawBg(dt, now) {
    bx.globalCompositeOperation = 'source-over';
    bx.fillStyle = '#05031a';
    bx.fillRect(0, 0, W, H);

    bx.globalCompositeOperation = 'lighter';
    const M = Math.max(W, H);
    for (const b of blobs) {
      const x = (b.x + Math.sin(now * b.sp + b.ph) * 0.1) * W;
      const y = (b.y + Math.cos(now * b.sp * 1.3 + b.ph) * 0.1) * H;
      const r = b.r * M;
      const g = bx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${b.hue},85%,50%,${0.13 + warp * 0.07})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      bx.fillStyle = g;
      bx.fillRect(0, 0, W, H);
    }

    warp += (warpTarget - warp) * Math.min(1, dt * 0.003);
    const speed = 0.00003 + warp * 0.0011;
    const cx = W / 2, cy = H / 2, sc = Math.max(cx, cy);
    for (const s of stars) {
      s.z -= speed * dt;
      if (s.z <= 0.03) { Object.assign(s, newStar(1)); continue; }
      const x = cx + s.x / s.z * sc, y = cy + s.y / s.z * sc;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) { Object.assign(s, newStar(1)); continue; }
      const k = 1 - s.z;
      const size = k * 2.3 + 0.25;
      const a = Math.min(1, k * 1.7) * (0.6 + 0.4 * Math.sin(now * 0.004 + s.tw));
      const col = s.hue === 0 ? `rgba(255,255,255,${a})` : `hsla(${s.hue},90%,85%,${a})`;
      if (warp > 0.06) {
        const z2 = Math.min(1, s.z + warp * 0.07);
        bx.strokeStyle = col;
        bx.lineWidth = size;
        bx.beginPath();
        bx.moveTo(cx + s.x / z2 * sc, cy + s.y / z2 * sc);
        bx.lineTo(x, y);
        bx.stroke();
      } else {
        bx.fillStyle = col;
        bx.beginPath(); bx.arc(x, y, size * 0.6, 0, TAU); bx.fill();
      }
    }
    bx.globalCompositeOperation = 'source-over';
  }

  function star4(x, y, r, rot) {
    fc.save();
    fc.translate(x, y); fc.rotate(rot);
    fc.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.28 : r;
      const a = i * Math.PI / 4;
      fc.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    fc.closePath(); fc.fill();
    fc.restore();
  }

  function drawFx(dt, now) {
    fc.clearRect(0, 0, W, H);
    const f = dt / 16.67;

    for (let i = emitters.length - 1; i >= 0; i--) {
      const e = emitters[i];
      if (now > e.until) { emitters.splice(i, 1); continue; }
      if (e.type === 'confetti') {
        const n = Math.round(4 * f);
        for (let k = 0; k < n; k++) parts.push({
          x: rnd(0, W), y: -12, vx: rnd(-1.5, 1.5), vy: rnd(2, 5), life: 0, max: rnd(3.5, 5.5),
          size: rnd(6, 12), color: rp(CONF), g: 0.035, drag: 0.992, shape: 'confetti',
          rot: rnd(0, TAU), vr: rnd(-0.2, 0.2), wob: rnd(0, TAU)
        });
      } else if (e.type === 'sparkle') {
        if (!e.el.isConnected) continue;
        const r = e.el.getBoundingClientRect();
        if (!r.width) continue;
        const n = Math.max(1, Math.round(2.5 * f));
        for (let k = 0; k < n; k++) {
          const a = rnd(0, TAU);
          const rx = r.width / 2 * rnd(0.92, 1.3), ry = r.height / 2 * rnd(0.92, 1.3);
          parts.push({
            x: r.left + r.width / 2 + Math.cos(a) * rx, y: r.top + r.height / 2 + Math.sin(a) * ry,
            vx: rnd(-0.4, 0.4), vy: rnd(-1.6, -0.3), life: 0, max: rnd(0.8, 1.7), size: rnd(1.5, 4),
            color: rp(GOLD), g: -0.004, drag: 0.99, shape: Math.random() < 0.45 ? 'star' : 'spark',
            rot: rnd(0, TAU), vr: rnd(-0.08, 0.08)
          });
        }
      }
    }

    fc.globalCompositeOperation = 'lighter';
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life += dt / 1000;
      const p = r.life / r.dur;
      if (p >= 1) { rings.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - p, 3);
      const rad = r.r0 + (r.max - r.r0) * e;
      fc.strokeStyle = `rgba(${r.color},${(1 - p) * 0.9})`;
      fc.lineWidth = r.width * (1 - p) + 0.5;
      fc.beginPath(); fc.arc(r.x, r.y, rad, 0, TAU); fc.stroke();
      fc.strokeStyle = `rgba(${r.color},${(1 - p) * 0.25})`;
      fc.lineWidth = r.width * 4 * (1 - p);
      fc.beginPath(); fc.arc(r.x, r.y, rad * 0.97, 0, TAU); fc.stroke();
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt / 1000;
      if (p.life >= p.max || p.y > H + 40) { parts.splice(i, 1); continue; }
      const dk = Math.pow(p.drag, f);
      p.vx *= dk;
      p.vy = p.vy * dk + p.g * f;
      p.x += p.vx * f; p.y += p.vy * f;
      p.rot += p.vr * f;
      const t = 1 - p.life / p.max;

      if (p.shape === 'confetti') {
        fc.globalCompositeOperation = 'source-over';
        fc.save();
        fc.translate(p.x + Math.sin(p.life * 3 + p.wob) * 8, p.y);
        fc.rotate(p.rot);
        fc.scale(1, Math.sin(p.life * 6 + p.wob));
        fc.globalAlpha = Math.min(1, t * 3);
        fc.fillStyle = p.color;
        fc.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        fc.restore();
        fc.globalCompositeOperation = 'lighter';
      } else if (p.shape === 'star') {
        fc.globalAlpha = Math.min(1, t * 1.5);
        fc.fillStyle = p.color;
        star4(p.x, p.y, p.size * 2.4 * (0.4 + t * 0.6), p.rot);
      } else {
        fc.globalAlpha = t * 0.22;
        fc.fillStyle = p.color;
        fc.beginPath(); fc.arc(p.x, p.y, p.size * 3.2 * t + 0.5, 0, TAU); fc.fill();
        fc.globalAlpha = t;
        fc.beginPath(); fc.arc(p.x, p.y, p.size * t + 0.3, 0, TAU); fc.fill();
      }
    }
    fc.globalAlpha = 1;
    fc.globalCompositeOperation = 'source-over';
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(50, now - last || 16);
    last = now;
    drawBg(dt, now);
    drawFx(dt, now);
    raf = requestAnimationFrame(loop);
  }

  return {
    GOLD, MAGIC, CONF,
    init,
    start() {
      if (running) return;
      resize();
      running = true; last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    stop() { running = false; cancelAnimationFrame(raf); this.clear(); },
    clear() { parts.length = 0; rings.length = 0; emitters.length = 0; },
    stopEmitters() { emitters.length = 0; },
    warpTo(v) { warpTarget = v; },

    burst(x, y, o = {}) {
      const n = o.count ?? 120;
      const [s0, s1] = o.speed || [2, 10], [l0, l1] = o.life || [0.8, 1.8], [z0, z1] = o.size || [1.5, 4];
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), sp = rnd(s0, s1);
        parts.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift || 0), life: 0, max: rnd(l0, l1),
          size: rnd(z0, z1), color: rp(o.colors || MAGIC), g: o.gravity ?? 0.05, drag: o.drag ?? 0.965,
          shape: o.shape || 'spark', rot: rnd(0, TAU), vr: rnd(-0.15, 0.15), wob: rnd(0, TAU)
        });
      }
    },

    /** particles rushing into a point (used right before a reveal) */
    implode(x, y, o = {}) {
      const n = o.count ?? 160, T = (o.time ?? 0.6) * 60;
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), d = rnd(180, Math.max(W, H) * 0.45), fr = T * rnd(0.75, 1);
        parts.push({
          x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
          vx: -Math.cos(a) * d / fr, vy: -Math.sin(a) * d / fr, life: 0, max: fr / 60,
          size: rnd(1.5, 3.5), color: rp(MAGIC), g: 0, drag: 1, shape: 'spark', rot: 0, vr: 0
        });
      }
    },

    shockwave(x, y, o = {}) {
      rings.push({ x, y, r0: o.r0 ?? 10, max: o.max ?? Math.max(W, H) * 0.6, life: 0, dur: o.dur ?? 0.9, color: o.color || '245,196,81', width: o.width ?? 6 });
    },
    confetti(ms = 2500) { emitters.push({ type: 'confetti', until: performance.now() + ms }); },
    sparkle(el, ms = 4000) { emitters.push({ type: 'sparkle', el, until: performance.now() + ms }); },
  };
})();
