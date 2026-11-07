'use strict';

/** Spins through items, then slows down dramatically and lands on a chosen one. */
class Roller {
  constructor(items, render, { interval = 55, sound = 'tick' } = {}) {
    this.items = items; this.render = render; this.interval = interval; this.sound = sound;
    this.cur = null; this.t = 0;
  }
  next(exclude) {
    if (this.items.length < 2) return this.items[0];
    const opts = this.items.filter(x => x !== this.cur && x !== exclude);
    return opts.length ? pick(opts) : this.items.find(x => x !== this.cur) || this.items[0];
  }
  show(x) { this.cur = x; this.render(x); Sound[this.sound](); }
  start() {
    const step = () => { this.show(this.next()); this.t = setTimeout(step, this.interval); };
    step();
  }
  stop(final) {
    clearTimeout(this.t);
    const delays = [70, 80, 95, 115, 140, 170, 210, 260, 320, 400, 500, 620];
    return new Promise(res => {
      let i = 0;
      const step = () => {
        if (i < delays.length) { this.show(this.next(final)); this.t = setTimeout(step, delays[i++]); }
        else { this.show(final); res(final); }
      };
      step();
    });
  }
  kill() { clearTimeout(this.t); }
}

const Contest = (() => {
  const st = {
    mode: null, busy: false, gen: 0, roller: null, round: null,
    pool: [], tpool: [], phaseIdx: -1, tm: null, raf: 0, cd: null, cdFn: null, menu: false,
  };
  const CIRC = 2 * Math.PI * 90;
  let uiTimer = 0;

  /* ---------------- setup ---------------- */
  function init() {
    FX.init(byId('bgCanvas'), byId('fxCanvas'));
    document.addEventListener('keydown', onKey, true);
    const stage = byId('stage');
    stage.addEventListener('pointerdown', onPointer);
    stage.addEventListener('mousemove', showUI);
    byId('tbFull').onclick = e => { e.currentTarget.blur(); toggleFullscreen(); };
    byId('tbSound').onclick = e => { e.currentTarget.blur(); toggleSound(); };
    byId('tbMenu').onclick = e => { e.currentTarget.blur(); toggleMenu(true); };
    byId('mResume').onclick = () => toggleMenu(false);
    byId('mRedo').onclick = redoRound;
    byId('mEnd').onclick = endRoundNow;
    byId('mExit').onclick = close;
    $$('.tm-controls button').forEach(b => b.onclick = () => { b.blur(); if (st.mode === 'timer') timerKey(b.dataset.k); });
    byId('ringFg').style.strokeDasharray = CIRC;
  }

  function open() {
    if (!S.contesters.length) { toast('Register at least one contester first', 'error'); return; }
    Sound.setEnabled(S.settings.sound);
    Sound.unlock();
    updateSoundBtn();
    byId('stage').hidden = false;
    document.body.classList.add('staging');
    if (S.settings.autoFullscreen) enterFullscreen();
    FX.start();
    showUI();
    intro();
  }

  function close() {
    toggleMenu(false);
    reset();
    FX.stop();
    byId('stage').hidden = true;
    document.body.classList.remove('staging');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    Admin.refreshAll();
  }

  /** Cancel anything in progress (timers, rollers, animations awaiting). */
  function reset() {
    st.gen++;
    st.busy = false;
    if (st.roller) st.roller.kill();
    st.roller = null;
    cancelAnimationFrame(st.raf); st.raf = 0; st.tm = null;
    clearInterval(st.cd); st.cd = null; st.cdFn = null;
    FX.clear(); FX.warpTo(0);
    byId('tmPaused').classList.remove('on');
  }

  /* ---------------- helpers ---------------- */
  function show(id, fast = false) {
    $$('#screens .scr').forEach(s => {
      if (s.id === id) { s.classList.toggle('fast', fast); s.classList.add('on'); }
      else { s.classList.remove('on', 'fast'); }
    });
  }
  function replay(id) {
    const el = byId(id);
    el.classList.remove('play'); void el.offsetWidth; el.classList.add('play');
  }
  function flash(op = 0.9, color = '#ffffff') {
    const f = byId('flash');
    f.style.background = color;
    f.animate([{ opacity: op }, { opacity: 0 }], { duration: 750, easing: 'ease-out' });
  }
  function center(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  const words = name => String(name).trim().split(/\s+/).map((w, i) => `<span style="--i:${i}">${esc(w)}</span>`).join(' ');

  function personCard(c, role = '') {
    return `<div class="pc">
      ${role ? `<div class="pc-role">${esc(role)}</div>` : ''}
      <div class="photo-frame"><img src="${esc(avatarFor(c))}" alt=""></div>
      <div class="pc-num">#${c.num}</div>
      <div class="pc-name">${esc(c.name)}</div>
    </div>`;
  }
  function mysteryCard(role) {
    return `<div class="pc mystery">
      <div class="pc-role">${esc(role)}</div>
      <div class="photo-frame"><div class="q">?</div></div>
      <div class="pc-num">#?</div>
      <div class="pc-name">· · ·</div>
    </div>`;
  }
  function teamChips() {
    const r = st.round;
    return [r.a, r.b].filter(Boolean).map(c =>
      `<div class="chip"><img src="${esc(avatarFor(c))}" alt=""><span><b>#${c.num}</b> ${esc(c.name)}</span></div>`
    ).join('<div class="chip-amp">&amp;</div>');
  }
  function availableTickets() {
    return S.settings.uniqueTickets ? (S.tickets.filter(t => !t.used).length || S.tickets.length) : S.tickets.length;
  }

  /* ---------------- input ---------------- */
  const IGNORE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'F5', 'F11', 'F12', 'ContextMenu', 'NumLock', 'AltGraph', 'OS']);

  function onKey(e) {
    if (byId('stage').hidden) return;
    if (IGNORE.has(e.key) || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); toggleMenu(); return; }
    e.preventDefault();
    if (st.menu || e.repeat) return;
    action(e.key);
  }

  function onPointer(e) {
    if (e.button !== 0 || st.menu) return;
    if (e.target.closest('button, #stageToolbar, #stageMenu, .msg-actions, .tm-controls')) return;
    if (st.mode === 'timer') return;
    action('click');
  }

  function action(key) {
    if (st.busy) return;
    switch (st.mode) {
      case 'intro': return newRound();
      case 'roll1':
      case 'roll2': return stopRoll();
      case 'reveal1': {
        const p = partnerPool();
        return p.list.length
          ? startRoll('b', p.list, p.fromDone ? 'Everyone else has already presented, so the partner is drawn from earlier presenters' : '')
          : showPair();
      }
      case 'pairShown': return startTicketRoll();
      case 'ticketRoll': return stopTicket();
      case 'countdown': return st.cdFn && st.cdFn();
      case 'ticketShown': return startTimers();
      case 'timer': return timerKey(key);
      case 'phaseWait': return startPhase(st.phaseIdx + 1);
      case 'done': return newRound();
    }
  }

  function showUI() {
    const stage = byId('stage');
    stage.classList.add('show-ui');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => stage.classList.remove('show-ui'), 2600);
  }

  function enterFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else enterFullscreen();
  }
  function toggleSound() {
    S.settings.sound = !S.settings.sound;
    Sound.setEnabled(S.settings.sound);
    saveSettings();
    updateSoundBtn();
  }
  function updateSoundBtn() { byId('tbSound').textContent = S.settings.sound ? '🔊' : '🔇'; }

  function toggleMenu(force) {
    st.menu = force ?? !st.menu;
    byId('stageMenu').hidden = !st.menu;
    if (st.menu) {
      const r = st.round;
      byId('mRedo').disabled = !(r && r.a);
      byId('mEnd').disabled = !(r && r.committed);
      showUI();
    }
  }

  /* ---------------- flow: intro ---------------- */
  function intro() {
    reset();
    byId('introTitle').textContent = S.settings.title || 'Contest';
    byId('introSub').textContent = S.settings.subtitle || '';
    const w = waiting().length, t = availableTickets();
    byId('introInfo').textContent = `${w} contester${w === 1 ? '' : 's'} waiting · ${t} ticket${t === 1 ? '' : 's'} in the deck`;
    replay('scrIntro'); show('scrIntro');
    FX.warpTo(0.12);
    st.mode = 'intro';
  }

  function newRound() {
    reset();
    const pool = waiting();
    if (!pool.length) {
      return message('Everyone has presented! 🎉', 'There are no contesters left who are waiting.', [
        { label: '↺ Start over (mark everyone as waiting)', fn: async () => { await Admin.resetStatuses(); intro(); } },
        { label: '✕ Back to dashboard', fn: close },
      ]);
    }
    st.round = { num: S.history.length + 1, a: null, b: null, ticket: null, committed: false, reshuffle: false };
    startRoll('a', pool);
  }

  function message(title, text, actions) {
    byId('msgTitle').textContent = title;
    byId('msgText').textContent = text;
    const box = byId('msgActions');
    box.innerHTML = '';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'stage-btn';
      b.textContent = a.label;
      b.onclick = () => { b.blur(); a.fn(); };
      box.appendChild(b);
    });
    replay('scrMessage'); show('scrMessage');
    FX.confetti(2500); Sound.fanfare();
    st.mode = 'message';
  }

  /* ---------------- flow: contester draw ---------------- */
  function startRoll(which, pool, note = '') {
    st.pool = pool;
    const r = st.round;
    byId('rollLabel').textContent = `Round ${r.num}`;
    byId('rollTitle').textContent = which === 'a' ? 'Who steps up next?' : `Choose a partner for ${r.a.name}`;
    byId('rollNote').textContent = note;
    const left = byId('rollLeft'), right = byId('rollRight');
    if (which === 'b') {
      left.innerHTML = personCard(r.a, 'Contester');
      right.innerHTML = mysteryCard('Partner');
      left.hidden = right.hidden = false;
    } else {
      left.hidden = right.hidden = true;
    }
    const strip = byId('poolStrip');
    strip.innerHTML = pool.length <= 150 ? pool.map(c => `<span data-id="${c.id}">${c.num}</span>`).join('') : '';
    const orb = byId('orb');
    orb.className = 'orb spinning';
    const num = byId('orbNum');
    const maxLen = Math.max(...pool.map(c => String(c.num).length));
    num.dataset.len = maxLen;
    byId('rollPrompt').innerHTML = '<span class="key">⌨</span> Press any key to stop';
    replay('scrRoll'); show('scrRoll');
    FX.warpTo(1);
    Sound.whoosh();

    let chip = null;
    st.roller = new Roller(pool, c => {
      num.textContent = c.num;
      num.animate([{ transform: 'translateY(-16%) scale(1.07)', opacity: 0.45 }, { transform: 'none', opacity: 1 }], { duration: 110, easing: 'ease-out' });
      if (chip) chip.classList.remove('hot');
      chip = strip.querySelector(`[data-id="${c.id}"]`);
      if (chip) chip.classList.add('hot');
    });
    st.roller.start();
    st.mode = which === 'a' ? 'roll1' : 'roll2';
  }

  async function stopRoll() {
    const g = st.gen;
    const which = st.mode === 'roll1' ? 'a' : 'b';
    st.busy = true; st.mode = 'stopping';
    byId('rollPrompt').textContent = '';
    const chosen = pick(st.pool);
    await st.roller.stop(chosen);
    if (g !== st.gen) return;
    st.roller = null;
    FX.warpTo(0.08);
    const orb = byId('orb');
    orb.classList.remove('spinning'); orb.classList.add('locked');
    Sound.lock();
    const [ox, oy] = center(orb);
    FX.shockwave(ox, oy, { max: orb.offsetWidth * 0.9, dur: 0.7, width: 3 });
    FX.burst(ox, oy, { count: 40, speed: [1, 5], colors: FX.GOLD, gravity: 0 });

    await wait(S.settings.revealDelay);
    if (g !== st.gen) return;
    st.round[which] = chosen;
    await reveal(chosen, which === 'a' ? 'Contester' : 'Partner', g);
    if (g !== st.gen) return;

    if (which === 'a') {
      const p = partnerPool();
      byId('revealPrompt').innerHTML = `<span class="key">⌨</span> ${p.list.length ? 'Press any key to choose your partner' : 'Press any key to continue'}`;
      st.mode = 'reveal1';
      st.busy = false;
    } else {
      await wait(2200);
      if (g !== st.gen) return;
      showPair();
    }
  }

  /** The magical reveal of a contester. */
  async function reveal(c, role, g) {
    const orb = byId('orb');
    const [ox, oy] = center(orb);
    orb.classList.add('implode');
    FX.implode(ox, oy, { count: 200, time: 0.65 });
    Sound.rise();
    await wait(700);
    if (g !== st.gen) return;

    byId('revealImg').src = avatarFor(c);
    byId('revealNum').textContent = '#' + c.num;
    byId('revealRole').textContent = role;
    byId('revealName').innerHTML = words(c.name);
    byId('revealPrompt').textContent = '';
    replay('scrReveal'); show('scrReveal', true);

    flash(0.95);
    Sound.boom(); Sound.chime();
    const photo = byId('revealPhoto');
    const [px, py] = center(photo);
    FX.shockwave(px, py);
    FX.shockwave(px, py, { dur: 1.4, color: '196,181,253', width: 3 });
    FX.burst(px, py, { count: 240, speed: [3, 17], life: [0.8, 2.1], gravity: 0.07 });
    FX.burst(px, py, { count: 70, shape: 'star', colors: FX.GOLD, speed: [1, 8], life: [1.2, 2.4], gravity: 0.015 });
    setTimeout(() => { if (g === st.gen) FX.confetti(2400); }, 450);
    setTimeout(() => { if (g === st.gen) FX.sparkle(photo, 7000); }, 600);
    await wait(2000);
    orb.classList.remove('implode', 'locked');
  }

  function partnerPool() {
    const a = st.round.a;
    let list = waiting().filter(c => c.id !== a.id), fromDone = false;
    if (!list.length) {
      list = S.contesters.filter(c => c.id !== a.id);
      fromDone = list.length > 0;
    }
    return { list, fromDone };
  }

  async function showPair() {
    const g = st.gen;
    st.busy = true; st.mode = 'pair';
    const { a, b, num } = st.round;
    byId('pairLabel').textContent = `Round ${num}`;
    byId('pairTitle').textContent = b ? 'Meet the team' : 'Solo performance';
    byId('pairA').innerHTML = personCard(a);
    byId('pairB').innerHTML = b ? personCard(b) : '';
    byId('scrPair').classList.toggle('solo', !b);
    byId('pairPrompt').textContent = '';
    FX.stopEmitters();
    replay('scrPair'); show('scrPair');
    Sound.whoosh();

    await wait(820);
    if (g !== st.gen) return;
    const [cx, cy] = center(byId(b ? 'pairLink' : 'pairA'));
    flash(0.55);
    Sound.boom(); Sound.fanfare();
    FX.shockwave(cx, cy);
    FX.burst(cx, cy, { count: 200, speed: [2, 14] });
    FX.burst(cx, cy, { count: 50, shape: 'star', colors: FX.GOLD, speed: [1, 7], gravity: 0.02 });
    FX.confetti(2600);
    $$('#scrPair .photo-frame').forEach(el => FX.sparkle(el, 6000));

    await wait(1300);
    if (g !== st.gen) return;
    byId('pairPrompt').innerHTML = `<span class="key">⌨</span> ${S.tickets.length ? 'Press any key to draw your ticket' : 'Press any key to start the timer'}`;
    st.mode = 'pairShown';
    st.busy = false;
  }

  /* ---------------- flow: ticket draw ---------------- */
  function ticketPool() {
    const all = S.tickets;
    if (!S.settings.uniqueTickets) return { list: all, reshuffle: false };
    const unused = all.filter(t => !t.used);
    return unused.length ? { list: unused, reshuffle: false } : { list: all, reshuffle: all.length > 0 };
  }

  async function startTicketRoll() {
    const { list, reshuffle } = ticketPool();
    if (!list.length) {
      await commitRound(null);
      return startTimers();
    }
    st.tpool = list;
    st.round.reshuffle = reshuffle;
    byId('tkTeam').innerHTML = teamChips();
    byId('tkNote').textContent = reshuffle
      ? 'Every ticket has been used, so the whole deck has been reshuffled'
      : `${list.length} ticket${list.length > 1 ? 's' : ''} in the deck`;
    const grid = byId('tkGrid');
    grid.innerHTML = list.map((t, i) =>
      `<div class="tk" data-id="${t.id}" style="--d:${i}"><div class="tk-in"><span class="tk-star">✦</span><b>${t.num}</b><small>TICKET</small></div></div>`
    ).join('');
    layoutTickets(list.length);
    byId('tkPrompt').innerHTML = '<span class="key">⌨</span> Press any key to stop';
    replay('scrTickets'); show('scrTickets');
    FX.warpTo(0.45);
    Sound.whoosh();

    let hot = null;
    st.roller = new Roller(list, t => {
      if (hot) hot.classList.remove('hot');
      hot = grid.querySelector(`[data-id="${t.id}"]`);
      if (hot) hot.classList.add('hot');
    }, { interval: 80, sound: 'softTick' });
    st.roller.start();
    st.mode = 'ticketRoll';
  }

  function layoutTickets(n) {
    const grid = byId('tkGrid');
    const aw = innerWidth * 0.9, ah = innerHeight * 0.5, gap = Math.max(8, Math.min(16, innerWidth / 100)), ratio = 0.72;
    let best = { w: 0, cols: 1 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((aw - gap * (cols - 1)) / cols, ((ah - gap * (rows - 1)) / rows) * ratio);
      if (w > best.w) best = { w, cols };
    }
    grid.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(Math.min(best.w, 190))}px)`;
    grid.style.gap = gap + 'px';
  }

  async function stopTicket() {
    const g = st.gen;
    st.busy = true; st.mode = 'stopping';
    byId('tkPrompt').textContent = '';
    const t = pick(st.tpool);
    await st.roller.stop(t);
    if (g !== st.gen) return;
    st.roller = null;
    const card = byId('tkGrid').querySelector(`[data-id="${t.id}"]`);
    card.classList.add('chosen');
    FX.warpTo(0);
    Sound.lock();
    const [kx, ky] = center(card);
    FX.burst(kx, ky, { count: 70, speed: [1, 7], colors: FX.GOLD, gravity: 0.02 });
    FX.shockwave(kx, ky, { max: card.offsetWidth * 2, dur: 0.6, width: 3 });

    await wait(S.settings.revealDelay);
    if (g !== st.gen) return;
    await commitRound(t);

    const r = card.getBoundingClientRect();
    byId('btNum').textContent = t.num;
    byId('btFront').innerHTML = ticketHTML(t);
    const inner = byId('btInner');
    inner.classList.remove('flipped');
    byId('btPrompt').textContent = '';
    show('scrTicketReveal', true);
    const big = byId('bigTicket');
    const T = big.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - (T.left + T.width / 2);
    const dy = (r.top + r.height / 2) - (T.top + T.height / 2);
    Sound.whoosh();
    await big.animate([
      { transform: `translate(${dx}px,${dy}px) scale(${r.width / T.width},${r.height / T.height})` },
      { transform: 'translate(0,0) scale(1.04)', offset: 0.8 },
      { transform: 'none' },
    ], { duration: 950, easing: 'cubic-bezier(.2,.85,.25,1)' }).finished.catch(() => {});
    if (g !== st.gen) return;

    inner.classList.add('flipped');
    Sound.rise();
    await wait(480);
    if (g !== st.gen) return;
    flash(0.6);
    Sound.chime();
    const [bx, by] = center(big);
    FX.shockwave(bx, by);
    FX.burst(bx, by, { count: 180, speed: [3, 15] });
    FX.confetti(1800);

    await wait(1000);
    if (g !== st.gen) return;
    st.busy = false;
    const first = S.phases[0];
    if (!first) {
      byId('btPrompt').innerHTML = '<span class="key">⌨</span> Press any key to finish the round';
      st.mode = 'ticketShown';
    } else if (S.settings.autoAdvance) {
      countdown(byId('btPrompt'), `${first.name} starts in`, S.settings.autoDelay, startTimers);
    } else {
      byId('btPrompt').innerHTML = `<span class="key">⌨</span> Press any key to start ${esc(first.name)}`;
      st.mode = 'ticketShown';
    }
  }

  function countdown(el, label, secs, fn) {
    clearInterval(st.cd);
    const g = st.gen;
    let n = Math.max(1, secs | 0);
    const draw = () => {
      el.innerHTML = `${esc(label)} <b class="cd">${n}</b><span class="cd-skip">press any key to start now</span>`;
    };
    draw();
    st.mode = 'countdown';
    st.cdFn = () => {
      clearInterval(st.cd); st.cd = null; st.cdFn = null;
      if (g === st.gen) fn();
    };
    st.cd = setInterval(() => {
      n--;
      if (n <= 0) st.cdFn();
      else { draw(); Sound.softTick(); }
    }, 1000);
  }

  /* ---------------- round bookkeeping ---------------- */
  async function commitRound(t) {
    const r = st.round;
    if (!r || r.committed) return;
    r.ticket = t || null;
    r.undo = { status: {}, used: null };
    const people = [r.a, r.b].filter(Boolean);
    people.forEach(c => { r.undo.status[c.id] = c.status; c.status = 'done'; });
    let changedTickets = [];
    if (t && S.settings.uniqueTickets) {
      r.undo.used = Object.fromEntries(S.tickets.map(x => [x.id, !!x.used]));
      if (r.reshuffle) { S.tickets.forEach(x => { x.used = false; }); changedTickets = S.tickets.slice(); }
      t.used = true;
      if (!r.reshuffle) changedTickets = [t];
    }
    const brief = c => ({ num: c.num, name: c.name });
    const h = {
      id: uid(), round: r.num, at: Date.now(),
      a: brief(r.a), b: r.b ? brief(r.b) : null,
      ticket: t ? { num: t.num, title: t.title || '' } : null,
    };
    S.history.push(h);
    r.histId = h.id;
    r.committed = true;
    try {
      await Promise.all([DB.putMany('contesters', people), DB.putMany('tickets', changedTickets), DB.set('history', S.history)]);
    } catch (e) { console.error(e); }
  }

  async function undoRound() {
    const r = st.round;
    if (!r || !r.committed) return;
    const changed = [], tch = [];
    for (const [id, s] of Object.entries(r.undo.status)) {
      const c = S.contesters.find(x => x.id === id);
      if (c) { c.status = s; changed.push(c); }
    }
    if (r.undo.used) {
      for (const t of S.tickets) {
        const u = r.undo.used[t.id];
        if (u !== undefined && !!t.used !== u) { t.used = u; tch.push(t); }
      }
    }
    S.history = S.history.filter(h => h.id !== r.histId);
    r.committed = false;
    await Promise.all([DB.putMany('contesters', changed), DB.putMany('tickets', tch), DB.set('history', S.history)]);
  }

  async function redoRound() {
    toggleMenu(false);
    reset();
    await undoRound();
    newRound();
  }

  function endRoundNow() {
    toggleMenu(false);
    if (!(st.round && st.round.committed)) return;
    reset();
    showDone();
  }

  /* ---------------- flow: timers ---------------- */
  async function startTimers() {
    const r = st.round;
    if (!r.committed) await commitRound(r.ticket);
    clearInterval(st.cd); st.cd = null;
    const prob = byId('tmProblem');
    if (r.ticket) { prob.innerHTML = ticketHTML(r.ticket); prob.hidden = false; }
    else { prob.innerHTML = ''; prob.hidden = true; }
    byId('scrTimer').classList.toggle('no-problem', !r.ticket);
    byId('tmTeam').innerHTML = teamChips();
    byId('tmSteps').innerHTML = S.phases.map((p, i) => `<span data-i="${i}">${esc(p.name)}</span>`).join('<i>›</i>');
    FX.stopEmitters();
    if (!S.phases.length) return showDone();
    show('scrTimer');
    startPhase(0);
  }

  function startPhase(i) {
    const p = S.phases[i];
    if (!p) return showDone();
    st.phaseIdx = i;
    const total = Math.max(1, p.sec) * 1000;
    st.tm = { total, end: performance.now() + total, paused: false, remain: total, lastSec: null };
    const scr = byId('scrTimer');
    scr.style.setProperty('--pc', p.color || '#f5c451');
    scr.classList.remove('warn', 'danger', 'over');
    byId('tmPhase').textContent = p.name;
    $$('#tmSteps span').forEach(s => {
      const k = +s.dataset.i;
      s.className = k < i ? 'past' : k === i ? 'cur' : '';
    });
    byId('tmPrompt').innerHTML = '<span class="kb">Space</span> pause · <span class="kb">Enter</span> next · <span class="kb">↑↓</span> ±10s';
    byId('tmPaused').classList.remove('on');
    banner(p.name, fmtTime(total));
    Sound.start();
    st.mode = 'timer';
    cancelAnimationFrame(st.raf);
    st.raf = requestAnimationFrame(tick);
  }

  function tick() {
    const tm = st.tm;
    if (!tm) return;
    const rem = tm.paused ? tm.remain : tm.end - performance.now();
    renderTime(rem);
    if (rem <= 0) { phaseEnd(false); return; }
    st.raf = requestAnimationFrame(tick);
  }

  function renderTime(rem) {
    const tm = st.tm;
    const ratio = Math.max(0, Math.min(1, rem / tm.total));
    byId('ringFg').style.strokeDashoffset = CIRC * (1 - ratio);
    byId('tmTime').textContent = fmtTime(rem);
    const sec = Math.ceil(rem / 1000);
    if (sec !== tm.lastSec) {
      tm.lastSec = sec;
      const s = S.settings, scr = byId('scrTimer');
      scr.classList.toggle('danger', sec > 0 && sec <= s.dangerAt);
      scr.classList.toggle('warn', sec > s.dangerAt && sec <= s.warnAt);
      if (!tm.paused && sec > 0 && sec <= s.beepLast) Sound.beep(false);
    }
  }

  function timerKey(k) {
    const tm = st.tm;
    if (!tm) return;
    if (k === ' ' || k === 'p' || k === 'P' || k === 'Spacebar') togglePause();
    else if (k === 'Enter' || k === 'ArrowRight' || k === 'PageDown') phaseEnd(true);
    else if (k === 'ArrowUp' || k === '+' || k === '=') adjust(10000);
    else if (k === 'ArrowDown' || k === '-') adjust(-10000);
  }

  function togglePause() {
    const tm = st.tm;
    if (tm.paused) { tm.end = performance.now() + tm.remain; tm.paused = false; }
    else { tm.remain = tm.end - performance.now(); tm.paused = true; }
    byId('tmPaused').classList.toggle('on', tm.paused);
    Sound.softTick();
  }

  function adjust(ms) {
    const tm = st.tm, now = performance.now();
    if (tm.paused) {
      tm.remain = Math.max(1000, tm.remain + ms);
      tm.total = Math.max(tm.total, tm.remain);
    } else {
      tm.end = Math.max(now + 1000, tm.end + ms);
      tm.total = Math.max(tm.total, tm.end - now);
    }
    tm.lastSec = null;
    Sound.softTick();
    const t = byId('tmTime');
    t.animate([{ transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 250 });
  }

  function banner(big, small = '') {
    const b = byId('tmBanner');
    b.innerHTML = `<b>${esc(big)}</b>${small ? `<small>${esc(small)}</small>` : ''}`;
    b.classList.remove('play'); void b.offsetWidth; b.classList.add('play');
  }

  async function phaseEnd(skipped) {
    const g = st.gen;
    cancelAnimationFrame(st.raf); st.raf = 0;
    st.tm = null;
    st.busy = true; st.mode = 'phaseEnd';
    byId('tmPaused').classList.remove('on');
    const scr = byId('scrTimer');
    scr.classList.remove('warn', 'danger'); scr.classList.add('over');
    byId('ringFg').style.strokeDashoffset = CIRC;
    byId('tmTime').textContent = '0:00';
    byId('tmPrompt').textContent = '';
    if (skipped) Sound.whoosh();
    else { Sound.beep(true); Sound.gong(); flash(0.45, '#ff3d6e'); }
    const next = S.phases[st.phaseIdx + 1];
    banner(next ? 'Time!' : "Time's up!", next ? `Next: ${next.name}` : '');

    await wait(1900);
    if (g !== st.gen) return;
    st.busy = false;
    if (next) {
      scr.classList.remove('over');
      if (S.settings.autoAdvance) countdown(byId('tmPrompt'), `${next.name} starts in`, Math.min(5, S.settings.autoDelay), () => startPhase(st.phaseIdx + 1));
      else { byId('tmPrompt').innerHTML = `<span class="key">⌨</span> Press any key to start ${esc(next.name)}`; st.mode = 'phaseWait'; }
    } else {
      showDone();
    }
  }

  /* ---------------- flow: round done ---------------- */
  async function showDone() {
    const g = st.gen;
    st.busy = true; st.mode = 'doneAnim';
    const r = st.round;
    const w = waiting().length;
    byId('doneTitle').textContent = `Round ${r.num} complete!`;
    byId('doneTeam').innerHTML = teamChips();
    byId('doneInfo').textContent = w ? `${w} contester${w > 1 ? 's' : ''} still waiting` : 'Everyone has presented!';
    byId('donePrompt').textContent = '';
    replay('scrDone'); show('scrDone');
    Sound.fanfare();
    FX.confetti(3500);
    await wait(1500);
    if (g !== st.gen) return;
    byId('donePrompt').innerHTML = `<span class="key">⌨</span> ${w ? 'Press any key for the next round' : 'Press any key to finish'}`;
    st.mode = 'done';
    st.busy = false;
  }

  return { init, open, close };
})();
