'use strict';

/**
 * The opening title: hand-built gold lettering drawn on a canvas.
 * Sparks swirl in and gather into the letters, a beam of light turns them into
 * solid 3D gold, then a shine sweeps across and stars twinkle while it waits.
 */
const TitleFX = (() => {
  const FONT = '"Arial Black", "Segoe UI Black", "Franklin Gothic Heavy", Impact, "Noto Sans", "DejaVu Sans", Arial, sans-serif';
  const SPARK_COLORS = ['#fff7d6', '#ffd86b', '#f5c451', '#ff9de2', '#c4b5fd', '#7dd3fc'];
  const T0 = 1.8;       // when the light beam starts turning sparks into gold
  const SWEEP = 0.95;   // how long the beam takes to cross the title
  const END = T0 + SWEEP;
  const GLINT_EVERY = 4.2;

  let cv = null, ctx = null, box = null, W = 0, H = 0, dpr = 1;
  let bx = 0, by = 0, bw = 0, bh = 0, R = null;  // text area and the padded area we redraw
  let lines = [], layers = null, parts = [], targets = [], stars = [];
  let raf = 0, start = 0, text = '', hooks = {}, impacted = false, ready = false;

  const font = s => `900 ${s}px ${FONT}`;
  const spacing = s => `${(s * 0.03).toFixed(2)}px`;
  const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  /* ---------- text → lines → runs ---------- */
  function splitLines(s) {
    s = s.trim().replace(/'/g, '’').replace(/\s+/g, ' ');
    if (s.includes('|')) return s.split('|').map(x => x.trim()).filter(Boolean);
    const w = s.split(' ');
    if (s.length <= 16 || w.length < 2) return [s];
    const join = (a, b) => w.slice(a, b).join(' ');
    let best = null;
    if (s.length <= 46 || w.length < 3) {
      for (let i = 1; i < w.length; i++) {
        const parts = [join(0, i), join(i)];
        const score = Math.max(...parts.map(p => p.length));
        if (!best || score < best.score) best = { parts, score };
      }
    } else {
      for (let i = 1; i < w.length - 1; i++) for (let j = i + 1; j < w.length; j++) {
        const parts = [join(0, i), join(i, j), join(j)];
        const score = Math.max(...parts.map(p => p.length));
        if (!best || score < best.score) best = { parts, score };
      }
    }
    return best.parts;
  }

  /** "2ND" → "2" + raised "ND". */
  function toRuns(line) {
    const runs = [];
    line.split(' ').forEach((word, i) => {
      if (i) runs.push({ t: ' ' });
      const m = word.match(/^(\d+)(ST|ND|RD|TH)(\W*)$/);
      if (m) { runs.push({ t: m[1] }, { t: m[2], sup: true }); if (m[3]) runs.push({ t: m[3] }); }
      else runs.push({ t: word });
    });
    return runs;
  }

  /** Run a drawing operation over every run of a line (handles the raised suffixes). */
  function paint(c, l, op, dx = 0, dy = 0) {
    let x = l.x + dx;
    for (const r of l.runs) {
      const s = r.sup ? l.size * 0.52 : l.size;
      c.font = font(s);
      c.letterSpacing = spacing(l.size);
      op(c, r.t, x, l.y + dy - (r.sup ? l.size * 0.34 : 0));
      x += c.measureText(r.t).width;
    }
  }
  const fill = (c, t, x, y) => c.fillText(t, x, y);
  const stroke = (c, t, x, y) => c.strokeText(t, x, y);

  function measure(runs, size) {
    const c = ctx;
    let w = 0;
    for (const r of runs) {
      c.font = font(r.sup ? size * 0.52 : size);
      c.letterSpacing = spacing(size);
      w += c.measureText(r.t).width;
    }
    return w;
  }

  function layout() {
    const rect = cv.getBoundingClientRect(), b = box.getBoundingClientRect();
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = cv.width = Math.max(10, Math.round(rect.width * dpr));
    H = cv.height = Math.max(10, Math.round(rect.height * dpr));
    bx = (b.left - rect.left) * dpr; by = (b.top - rect.top) * dpr;
    bw = Math.max(10, b.width * dpr); bh = Math.max(10, b.height * dpr);
    const px = bw * 0.06, py = bh * 0.12;
    R = { x: Math.max(0, Math.floor(bx - px)), y: Math.max(0, Math.floor(by - py)) };
    R.w = Math.min(W, Math.ceil(bx + bw + px)) - R.x;
    R.h = Math.min(H, Math.ceil(by + bh + py)) - R.y;
    lines = splitLines(text.toUpperCase()).map(t => ({ runs: toRuns(t) }));
    const lh = 1.2;
    const cap = (bh * 0.9) / (lines.length * lh);
    lines.forEach(l => { l.size = Math.min(cap, ((bw * 0.9) / measure(l.runs, 100)) * 100); });
    const smallest = Math.min(...lines.map(l => l.size));
    lines.forEach(l => { l.size = Math.min(l.size, smallest * 1.55); });
    const total = lines.reduce((a, l) => a + l.size * lh, 0);
    let y = by + (bh - total) / 2;
    lines.forEach(l => {
      l.y = y + l.size * 0.98;
      l.x = bx + (bw - measure(l.runs, l.size)) / 2;
      y += l.size * lh;
    });
  }

  /* ---------- the lettering itself ---------- */
  function canvas() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.lineJoin = 'round'; x.lineCap = 'round'; x.textBaseline = 'alphabetic';
    return [c, x];
  }

  function build() {
    const [mask, mc] = canvas();
    mc.fillStyle = '#fff';
    lines.forEach(l => paint(mc, l, fill));

    // Gold face: chrome-like gradient with a hard "horizon" reflection in the middle.
    const [face, fc] = canvas();
    lines.forEach(l => {
      const top = l.y - l.size * 0.76, bot = l.y + l.size * 0.02;
      const g = fc.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, '#fffef5');
      g.addColorStop(0.22, '#ffeaa0');
      g.addColorStop(0.47, '#ffc94a');
      g.addColorStop(0.5, '#c8700f');
      g.addColorStop(0.56, '#f29a1f');
      g.addColorStop(0.8, '#ffe39a');
      g.addColorStop(1, '#a95509');
      fc.fillStyle = g;
      paint(fc, l, fill);
    });
    fc.globalCompositeOperation = 'source-atop';
    lines.forEach(l => {
      const top = l.y - l.size * 0.76;
      const g = fc.createLinearGradient(0, top, 0, top + l.size * 0.34);
      g.addColorStop(0, 'rgba(255,255,255,.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      fc.fillStyle = g;
      fc.fillRect(0, top, W, l.size * 0.34);
      // bevel: dark inner edge, then a light edge shifted up-left
      fc.lineWidth = l.size * 0.04; fc.strokeStyle = 'rgba(120,48,0,.6)';
      paint(fc, l, stroke);
      fc.lineWidth = l.size * 0.018; fc.strokeStyle = 'rgba(255,255,235,.9)';
      paint(fc, l, stroke, -l.size * 0.012, -l.size * 0.016);
    });
    // fine sparkle grain in the gold
    for (let i = 0; i < (R.w * R.h) / 700; i++) {
      fc.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.55)' : 'rgba(150,70,0,.25)';
      fc.fillRect(R.x + Math.random() * R.w, R.y + Math.random() * R.h, dpr, dpr);
    }
    fc.globalCompositeOperation = 'source-over';

    // Full logo: pink rim → dark outline → 3D extrusion → gold face.
    const [sty, sc] = canvas();
    const [rim, rc] = canvas();
    const depthOf = l => Math.max(4, Math.round(l.size * 0.075));
    const off = i => [i * 0.35, i];
    lines.forEach(l => {
      rc.lineWidth = l.size * 0.22; rc.strokeStyle = '#ff79d6';
      for (let i = 0; i <= depthOf(l); i += 2) paint(rc, l, stroke, ...off(i));
    });
    sc.save();
    sc.shadowColor = 'rgba(236,72,153,.85)'; sc.shadowBlur = Math.min(...lines.map(l => l.size)) * 0.22;
    sc.drawImage(rim, 0, 0);
    sc.restore();
    lines.forEach(l => {
      const s = l.size, depth = depthOf(l);
      sc.lineWidth = s * 0.16; sc.strokeStyle = '#1b0940';
      for (let i = 0; i <= depth; i++) paint(sc, l, stroke, ...off(i));
      for (let i = depth; i >= 1; i--) {
        const k = i / depth;
        sc.fillStyle = `rgb(${Math.round(150 - 70 * k)},${Math.round(70 - 40 * k)},${Math.round(10 + 30 * k)})`;
        paint(sc, l, fill, ...off(i));
      }
      sc.lineWidth = s * 0.03; sc.strokeStyle = '#ffe9a3';
      paint(sc, l, stroke);
    });
    sc.drawImage(face, 0, 0);

    const [glow, gc] = canvas();
    gc.filter = `blur(${Math.round(bh * 0.035)}px)`;
    gc.drawImage(sty, 0, 0);

    const [tmp, tc] = canvas();
    layers = { mask, face, sty, glow, tmp, tc };

    // spark targets sampled from the letter shapes
    const data = mc.getImageData(R.x, R.y, R.w, R.h).data;
    const step = Math.max(2, Math.round(2.5 * dpr));
    targets = [];
    for (let y = 0; y < R.h; y += step) for (let x = 0; x < R.w; x += step) {
      if (data[(y * R.w + x) * 4 + 3] > 140) targets.push([x + R.x, y + R.y]);
    }
    for (let i = targets.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [targets[i], targets[j]] = [targets[j], targets[i]]; }
    const far = Math.max(W, H) * 0.5, cx = bx + bw / 2, cy = by + bh / 2;
    parts = targets.slice(0, 3600).map(([x, y]) => {
      const a = Math.random() * Math.PI * 2, r = far * (0.7 + Math.random() * 0.7);
      return {
        tx: x, ty: y,
        sx: cx + Math.cos(a) * r, sy: cy + Math.sin(a) * r * 0.8,
        delay: SWEEP * ((x - bx) / bw) + Math.random() * 0.3,
        dur: 1.3 + Math.random() * 0.2,
        swirl: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.5) * bh,
        c: (Math.random() * SPARK_COLORS.length) | 0,
        s: (0.9 + Math.random() * 1.5) * dpr,
      };
    });
  }

  /* ---------- animation ---------- */
  const wipeAt = x => T0 + SWEEP * ((x - bx) / bw);

  function sparkPos(p, t) {
    const k = easeInOut(Math.min(1, Math.max(0, (t - p.delay) / p.dur)));
    const dx = p.tx - p.sx, dy = p.ty - p.sy, len = Math.hypot(dx, dy) || 1;
    const bend = Math.sin(Math.PI * k) * p.swirl;
    return [p.sx + dx * k - (dy / len) * bend, p.sy + dy * k + (dx / len) * bend];
  }

  function drawSparks(t) {
    ctx.globalCompositeOperation = 'lighter';
    const buckets = SPARK_COLORS.map(() => []);
    for (const p of parts) {
      if (t < p.delay) continue;
      const fade = t > wipeAt(p.tx) ? 1 - (t - wipeAt(p.tx)) / 0.35 : 1;
      if (fade <= 0) continue;
      buckets[p.c].push(p, fade);
    }
    SPARK_COLORS.forEach((col, ci) => {
      const b = buckets[ci];
      if (!b.length) return;
      ctx.strokeStyle = col;
      for (let i = 0; i < b.length; i += 2) {
        const p = b[i], fade = b[i + 1];
        const [x, y] = sparkPos(p, t), [qx, qy] = sparkPos(p, t - 0.022);
        let dx = qx - x, dy = qy - y;
        const len = Math.hypot(dx, dy), max = 22 * dpr;
        if (len > max) { dx *= max / len; dy *= max / len; }
        ctx.globalAlpha = Math.min(1, (t - p.delay) * 6) * fade;
        ctx.lineWidth = p.s;
        ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + 0.01, y); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Copy only the title area of a layer. */
  const blit = (c, src) => c.drawImage(src, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);

  /** A soft light band, clipped to the letters, centred at x. */
  function lightBand(src, x, width, alpha, slant = 0) {
    const { tmp, tc } = layers;
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(R.x, R.y, R.w, R.h);
    blit(tc, src);
    tc.globalCompositeOperation = 'source-in';
    const g = tc.createLinearGradient(x - width, R.y, x + width, R.y + slant);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    tc.fillStyle = g;
    tc.fillRect(R.x, R.y, R.w, R.h);
    ctx.globalCompositeOperation = 'lighter';
    blit(ctx, tmp);
    ctx.globalCompositeOperation = 'source-over';
  }

  function star(x, y, r, a) {
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.18, 0, 7); ctx.fill();
  }

  function frame(now) {
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    const { sty, glow, face } = layers;

    if (t >= T0) {
      const wx = bx + Math.min(1, (t - T0) / SWEEP) * bw;
      const done = t >= END;
      ctx.globalAlpha = done ? 0.55 + 0.25 * Math.sin((t - END) * 2.2) : Math.min(1, (t - T0) / SWEEP) * 0.8;
      blit(ctx, glow);
      ctx.globalAlpha = 1;
      if (done) blit(ctx, sty);
      else {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, wx, H); ctx.clip();
        blit(ctx, sty);
        ctx.restore();
        lightBand(sty, wx, bw * 0.05, 1);
        // the beam itself
        const bwid = bw * 0.012;
        const g = ctx.createLinearGradient(wx - bwid, 0, wx + bwid, 0);
        g.addColorStop(0, 'rgba(255,240,200,0)'); g.addColorStop(0.5, 'rgba(255,250,230,.55)'); g.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = g; ctx.globalCompositeOperation = 'lighter';
        ctx.fillRect(wx - bwid, R.y, bwid * 2, R.h);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (done) {
        const ph = ((t - END + 1.2) % GLINT_EVERY) / 1.1;
        if (ph < 1) lightBand(face, bx - bw * 0.15 + ph * bw * 1.3, bw * 0.07, 0.85, bh * 0.5);
        if (Math.random() < 0.35 && targets.length) {
          const [x, y] = targets[(Math.random() * targets.length) | 0];
          stars.push({ x, y, t, life: 0.7 + Math.random() * 0.6, r: (6 + Math.random() * 12) * dpr });
        }
      }
    }
    if (t < END + 0.4) drawSparks(t);

    if (stars.length) {
      ctx.fillStyle = '#fffbe8';
      ctx.globalCompositeOperation = 'lighter';
      stars = stars.filter(s => t - s.t < s.life);
      for (const s of stars) {
        const k = Math.sin(Math.PI * ((t - s.t) / s.life));
        star(s.x, s.y, s.r * k, k);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    if (!impacted && t >= END) {
      impacted = true;
      const r = box.getBoundingClientRect();
      hooks.onImpact && hooks.onImpact(r.left + r.width / 2, r.top + r.height / 2);
    }
    raf = requestAnimationFrame(frame);
  }

  function onResize() {
    if (!raf) return;
    layout(); build();
    start = performance.now() - (END + 0.01) * 1000;
    impacted = true;
  }
  window.addEventListener('resize', debounce(onResize, 200));

  return {
    /** Draw `title` (fitted into `boxEl`) on the full-screen `canvasEl`, with the full entrance. */
    play(canvasEl, boxEl, title, h = {}) {
      this.stop();
      cv = canvasEl; box = boxEl; ctx = cv.getContext('2d');
      text = title || 'Contest';
      hooks = h;
      impacted = false; stars = [];
      layout(); build();
      ctx.lineCap = 'round';
      ready = true;
      start = performance.now();
      raf = requestAnimationFrame(frame);
    },
    /** Has the gold title fully appeared? */
    done() { return !ready || impacted; },
    /** Jump straight to the finished title. */
    finish() { if (raf && !impacted) start = performance.now() - END * 1000; },
    stop() { cancelAnimationFrame(raf); raf = 0; ready = false; },
  };
})();
