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
    pool: [], tpool: [], slot: 0, phaseIdx: -1, tm: null, raf: 0, cd: null, cdFn: null, menu: false, f: null,
    remote: false, stageIdx: -1, explainOnly: false, revealed: 0, info: -1,
    score: null, win: null,
  };
  const E = () => S.event;
  const stageNow = () => E().stages[st.stageIdx];
  const deck = () => stageDeck(stageNow());
  /** Tell the presenter window that saved data changed. */
  const saved = () => { if (st.remote) Link.send('saved'); };
  /** The format is copied when the contest opens, so it cannot change mid-contest. */
  const F = () => st.f;
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
    byId('ssGo').onclick = submitScoreEntry;
    byId('ssCancel').onclick = closeScoreEntry;
    byId('ssInputs').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const ins = $$('#ssInputs input'), k = ins.indexOf(e.target);
      if (k < ins.length - 1) ins[k + 1].focus(); else submitScoreEntry();
    });
    document.addEventListener('fullscreenchange', () => { if (!byId('stage').hidden && st.mode === 'intro') TitleFX.finish(); });
    $$('.tm-controls button').forEach(b => b.onclick = () => { b.blur(); if (st.mode === 'timer') timerKey(b.dataset.k); });
    byId('ringFg').style.strokeDasharray = CIRC;
  }

  /** opts.start: 'standby' | 'opening' | 'stage' (with opts.stage). opts.remote: driven from the presenter window. */
  function open(opts = {}) {
    st.remote = !!opts.remote;
    st.f = normalizeFormat({});
    st.stageIdx = -1;
    Sound.setEnabled(S.settings.sound);
    Sound.unlock();
    updateSoundBtn();
    byId('stage').hidden = false;
    byId('stage').classList.toggle('remote', st.remote);
    document.body.classList.add('staging');
    if (!st.remote && S.settings.autoFullscreen) enterFullscreen();
    FX.start();
    showUI();
    if (opts.start === 'standby') standby();
    else if (opts.start === 'stage') runStage(opts.stage || 0);
    else if (opts.start === 'winners') winners();
    else opening();
  }

  function close() {
    if (st.remote) { toggleMenu(false); standby(); return; }
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
    TitleFX.stop();
    byId('tmPaused').classList.remove('on');
  }

  /* ---------------- texts & step bar ---------------- */
  function ctx(extra = {}) {
    const r = st.round, team = r ? r.team : [];
    return {
      round: r ? r.num : S.history.length + 1,
      name: team[0]?.name || '', last: team[team.length - 1]?.name || '',
      team: team.map(c => c.name).join(' & '),
      n: r ? Math.min(r.tickets.length + 1, r.tcount || 1) : 1, total: r ? r.tcount : F().ticketCount,
      ...extra,
    };
  }
  const T = (text, extra) => fill(text, ctx(extra));
  const roleOf = i => (F().slots[i] && F().slots[i].role) || `Person ${i + 1}`;
  const tLabel = () => F().ticketLabel || 'Ticket';

  function buildSteps() {
    const f = F(), r = st.round, steps = [];
    f.slots.forEach((s, i) => steps.push({ key: 'p' + i, label: roleOf(i) }));
    if (r.tcount > 0) steps.push({ key: 't', label: tLabel() + (r.tcount > 1 ? (f.ticketFlow === 'each' ? ` 1/${r.tcount}` : ` ×${r.tcount}`) : '') });
    f.phases.forEach((p, i) => steps.push({ key: 'ph' + i, label: p.name, color: p.color }));
    if (scoringOn()) steps.push({ key: 'sc', label: 'Score' });
    byId('stageSteps').innerHTML = steps.map(s =>
      `<span data-k="${s.key}"${s.color ? ` style="--sc:${esc(s.color)}"` : ''}>${esc(s.label)}</span>`
    ).join('<i>›</i>');
    stepsOn(f.showSteps);
  }
  function stepsOn(on) { byId('stage').classList.toggle('has-steps', !!on && F().showSteps); }
  function setStep(key, label) {
    const els = $$('#stageSteps span');
    const idx = els.findIndex(e => e.dataset.k === key);
    els.forEach((e, i) => { e.className = idx < 0 ? 'past' : i < idx ? 'past' : i === idx ? 'cur' : ''; });
    if (label && els[idx]) els[idx].textContent = label;
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
  function chip(c, role = '') {
    return `<div class="chip"><img src="${esc(avatarFor(c))}" alt=""><span>${role ? `<small>${esc(role)}</small>` : ''}<b>#${c.num}</b> ${esc(c.name)}</span></div>`;
  }
  function teamChips() {
    return st.round.team.map(c => chip(c)).join('<div class="chip-amp">&amp;</div>');
  }
  function availableTickets() {
    const d = deck();
    const sid = stageNow()?.id;
    return F().uniqueTickets ? (d.filter(t => !isUsed(t, sid)).length || d.length) : d.length;
  }

  /* ---------------- input ---------------- */
  const IGNORE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'F5', 'F11', 'F12', 'ContextMenu', 'NumLock', 'AltGraph', 'OS']);

  function onKey(e) {
    if (byId('stage').hidden) return;
    if (!byId('stageScore').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeScoreEntry(); }
      return;
    }
    if (IGNORE.has(e.key) || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); toggleMenu(); return; }
    e.preventDefault();
    if (st.menu || e.repeat) return;
    action(e.key);
  }

  function onPointer(e) {
    if (e.button !== 0 || st.menu) return;
    if (e.target.closest('button, #stageToolbar, #stageMenu, .msg-actions, .tm-controls, #fsHint, #stageScore')) return;
    if (st.mode === 'timer') return;
    action('click');
  }

  function action(key) {
    if (st.busy) return;
    switch (st.mode) {
      case 'standby': return opening();
      case 'evTitle': return TitleFX.done() ? structure() : TitleFX.finish();
      case 'structure': return revealNext();
      case 'stageInfo': return st.info + 1 < E().stages.length ? stageInfo(st.info + 1) : closing();
      case 'closing': return runStage(0);
      case 'stageEnd': return runStage(st.stageIdx + 1);
      case 'intro':
        if (!TitleFX.done()) return TitleFX.finish();
        return st.explainOnly ? stageEnd() : newRound();
      case 'roll': return stopRoll();
      case 'revealed': return nextMember();
      case 'teamShown': return afterTeam();
      case 'ticketRoll': return stopTicket();
      case 'ticketNext': return startTicketRoll();
      case 'countdown': return st.cdFn && st.cdFn();
      case 'ticketShown': return startTimers();
      case 'timer': return timerKey(key);
      case 'phaseWait': return startPhase(st.phaseIdx + 1);
      case 'done': return newRound();
      case 'scoreWait': return st.remote ? null : openScoreEntry();
      case 'rankingShown': return stageEnd();
      case 'scoreShown': return st.score.idx + 1 < st.round.team.length ? scoreWait(st.score.idx + 1) : newRound();
      case 'wTitle': return TitleFX.done() ? winnerTease(0) : TitleFX.finish();
      case 'wTease': return winnerReveal();
      case 'wShown': return st.win.i + 1 < st.win.list.length ? winnerTease(st.win.i + 1) : winnersFinale();
      case 'wFinale': return celebrate();
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
      byId('mRedo').disabled = !(r && r.team.length);
      byId('mEnd').disabled = !(r && r.committed);
      showUI();
    }
  }

  /* ---------------- opening (explanation of the contest) ---------------- */
  function standby() {
    reset();
    stepsOn(false);
    st.stageIdx = -1;
    byId('sbTitle').textContent = E().title || 'Contest';
    byId('sbSub').textContent = E().subtitle || '';
    replay('scrStandby'); show('scrStandby');
    FX.warpTo(0.06);
    st.mode = 'standby';
  }

  /** The gold drawn title, used for the contest title and for each stage title. */
  function titleScreen({ kicker = '', title, sub = '', info = '', prompt, mode }) {
    reset();
    stepsOn(false);
    byId('introKicker').textContent = kicker;
    byId('introTitle').textContent = title;
    byId('introSub').textContent = sub;
    byId('introInfo').textContent = info;
    byId('introPrompt').textContent = prompt;
    const scr = byId('scrIntro');
    scr.classList.remove('lit');
    replay('scrIntro'); show('scrIntro');
    FX.warpTo(0.12);
    st.mode = mode;
    const g = st.gen;
    Sound.whoosh();
    setTimeout(() => { if (g === st.gen && !TitleFX.done()) Sound.magic(); }, 200);
    TitleFX.play(byId('introCanvas'), byId('introBox'), title, {
      onImpact(x, y) {
        if (g !== st.gen) return;
        scr.classList.add('lit');
        flash(0.7);
        Sound.boom(); Sound.chime();
        FX.shockwave(x, y);
        FX.shockwave(x, y, { dur: 1.4, color: '196,181,253', width: 3 });
        FX.burst(x, y, { count: 260, speed: [3, 18], life: [0.8, 2.2], gravity: 0.05 });
        FX.burst(x, y, { count: 80, shape: 'star', colors: FX.GOLD, speed: [1, 9], life: [1.2, 2.4], gravity: 0.015 });
        FX.confetti(2600);
      },
    });
  }

  function opening() {
    st.stageIdx = -1;
    const n = E().stages.length;
    titleScreen({
      title: E().title || 'Contest', sub: E().subtitle,
      info: `${n} stage${n === 1 ? '' : 's'}`,
      prompt: 'Click to see how the contest works', mode: 'evTitle',
    });
  }

  function stageCard(s, i) {
    const facts = s.showFacts ? stageFacts(s).slice(0, 2) : [];
    return `<div class="sc" data-i="${i}" style="--i:${i}">
      <div class="sc-in">
        <div class="sc-face sc-back"><span class="sc-q">?</span><small>Stage ${i + 1}</small></div>
        <div class="sc-face sc-front">
          <div class="sc-badge">Stage ${i + 1}</div>
          <div class="sc-icon">${s.image ? `<img src="${esc(s.image)}" alt="">` : esc(s.icon)}</div>
          <div class="sc-name">${esc(s.name)}</div>
          ${s.tagline ? `<div class="sc-tag">${esc(s.tagline)}</div>` : ''}
          ${facts.length ? `<div class="sc-facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;
  }

  function structure() {
    reset();
    stepsOn(false);
    st.stageIdx = -1;
    const stages = E().stages, n = stages.length;
    byId('stTitle').textContent = E().structureTitle || 'Contest structure';
    const grid = byId('stGrid');
    grid.className = `st-grid n${Math.min(n, 6)}`;
    grid.innerHTML = stages.map((s, i) => stageCard(s, i)).join('<div class="sc-arrow">➜</div>');
    fitCards();
    st.revealed = 0;
    byId('stPrompt').textContent = 'Click to reveal stage 1';
    replay('scrStructure'); show('scrStructure');
    FX.warpTo(0.2);
    Sound.whoosh();
    st.mode = 'structure';
  }

  /** Shrink a card's text step by step until everything fits inside it. */
  function fitCards() {
    $$('#stGrid .sc').forEach(card => {
      const front = card.querySelector('.sc-front');
      let fit = 1;
      card.style.setProperty('--fit', fit);
      while (front.scrollHeight > front.clientHeight + 1 && fit > 0.5) {
        fit = +(fit - 0.05).toFixed(2);
        card.style.setProperty('--fit', fit);
      }
    });
  }

  async function revealNext() {
    const stages = E().stages, n = stages.length;
    if (st.revealed >= n) return E().detailSlides ? stageInfo(0) : closing();
    const g = st.gen, i = st.revealed++;
    st.busy = true;
    const card = byId('stGrid').querySelector(`.sc[data-i="${i}"]`);
    const arrows = $$('#stGrid .sc-arrow');
    if (i > 0 && arrows[i - 1]) arrows[i - 1].classList.add('lit');
    card.classList.add('open');
    Sound.rise();
    await wait(450);
    if (g !== st.gen) return;
    const [x, y] = center(card);
    flash(0.25);
    Sound.chime();
    FX.shockwave(x, y, { max: card.offsetWidth * 1.4, dur: 0.8, width: 3 });
    FX.burst(x, y, { count: 120, speed: [2, 11], life: [0.6, 1.6], gravity: 0.04 });
    FX.burst(x, y, { count: 30, shape: 'star', colors: FX.GOLD, speed: [1, 6], gravity: 0.01 });
    FX.sparkle(card, 3500);
    await wait(500);
    if (g !== st.gen) return;
    byId('stPrompt').textContent = st.revealed < n ? `Click to reveal stage ${st.revealed + 1}` : 'Click to continue';
    st.busy = false;
  }

  function stageInfo(i) {
    reset();
    stepsOn(false);
    st.stageIdx = -1;
    const stages = E().stages, s = stages[i];
    if (!s) return closing();
    st.info = i;
    byId('siKicker').textContent = `Stage ${i + 1} of ${stages.length}`;
    byId('siVisual').innerHTML = s.image ? `<img src="${esc(s.image)}" alt="">` : `<span>${esc(s.icon)}</span>`;
    byId('siVisual').classList.toggle('has-img', !!s.image);
    byId('siNum').textContent = i + 1;
    byId('siName').innerHTML = words(s.name);
    byId('siTag').textContent = s.tagline;
    byId('siDesc').textContent = s.description;
    const pts = s.points.split('\n').map(x => x.trim()).filter(Boolean);
    byId('siPoints').innerHTML = pts.map((p, k) => `<li style="--k:${k}">${esc(p)}</li>`).join('');
    const facts = s.showFacts ? stageFacts(s) : [];
    byId('siFacts').innerHTML = facts.map((f, k) => `<span style="--k:${k + pts.length}">${esc(f)}</span>`).join('');
    byId('siPrompt').textContent = i + 1 < stages.length ? `Click for stage ${i + 2}` : 'Click to continue';
    replay('scrStageInfo'); show('scrStageInfo');
    FX.warpTo(0.1);
    st.mode = 'stageInfo';
    const g = st.gen;
    Sound.whoosh();
    setTimeout(() => {
      if (g !== st.gen) return;
      const [x, y] = center(byId('siVisual'));
      Sound.chime();
      FX.shockwave(x, y, { dur: 0.9, width: 3 });
      FX.burst(x, y, { count: 140, speed: [2, 12], gravity: 0.04 });
      FX.sparkle(byId('siVisual'), 6000);
    }, 650);
  }

  function closing() {
    reset();
    stepsOn(false);
    st.stageIdx = -1;
    const first = E().stages[0];
    byId('clTitle').textContent = E().closingTitle || "Let's begin!";
    byId('clSub').textContent = first ? `First up: Stage 1 · ${first.name}` : '';
    byId('clPrompt').textContent = first ? 'Click to start stage 1' : '';
    replay('scrClosing'); show('scrClosing');
    FX.warpTo(0.3);
    Sound.fanfare();
    FX.confetti(3000);
    st.mode = 'closing';
  }

  /* ---------------- stages ---------------- */
  async function runStage(i) {
    const s = E().stages[i];
    if (!s) return finalScreen();
    st.stageIdx = i;
    if (S.activeStage !== s.id) {
      S.activeStage = s.id;
      await saveActiveStage();
      saved();
    }
    const f = stageFormat(s);
    st.explainOnly = !f;
    st.f = f || normalizeFormat({});
    st.round = null;
    if (f && !S.contesters.length) {
      return message('No contesters yet', 'Register contesters in the dashboard before running this stage.', [{ label: '✕ Back to dashboard', fn: close }]);
    }
    intro();
  }

  function intro() {
    const s = stageNow(), f = F();
    let info = '';
    if (!st.explainOnly) {
      const w = waiting().length, t = availableTickets();
      const parts = [`${w} contester${w === 1 ? '' : 's'} waiting`];
      if (f.ticketCount > 0) parts.push(`${t} ${tLabel().toLowerCase()}${t === 1 ? '' : 's'} in the deck`);
      parts.push(f.teamSize === 1 ? 'one person per round' : `${f.teamSize} people per round`);
      info = parts.join(' · ');
    }
    titleScreen({
      kicker: `Stage ${st.stageIdx + 1}`, title: s.name, sub: s.tagline, info,
      prompt: st.explainOnly ? 'Press any key to continue' : 'Press any key to begin', mode: 'intro',
    });
  }

  /** A stage is over: everyone presented, or the presenter ended it. */
  function stageEnd() {
    reset();
    const i = st.stageIdx, s = E().stages[i], next = E().stages[i + 1];
    if (!s) return finalScreen();
    const again = { label: '↺ Run this stage again (everyone waiting)', fn: async () => { await Admin.resetStatuses(); saved(); runStage(i); } };
    if (!next) {
      return message(E().endTitle || 'Thank you!', `${s.name} complete. That was the last stage.`,
        [again, { label: '✕ Back to dashboard', fn: close }], 'final');
    }
    message(`${s.name} complete! 🎉`, `Next up: Stage ${i + 2} · ${next.name}`, [
      { label: `▶ Start stage ${i + 2}: ${next.name}`, fn: () => runStage(i + 1) },
      again,
      { label: '✕ Back to dashboard', fn: close },
    ], 'stageEnd');
    byId('msgPrompt').textContent = `Press any key to start stage ${i + 2}`;
  }

  function finalScreen() {
    reset();
    message(E().endTitle || 'Thank you!', E().title, [{ label: '✕ Back to dashboard', fn: close }], 'final');
  }

  function newRound() {
    reset();
    const pool = waiting();
    if (!pool.length) return rankingOrEnd();
    st.round = { num: S.history.length + 1, team: [], tickets: [], tcount: Math.min(F().ticketCount, deck().length), committed: false };
    buildSteps();
    startRoll(0, pool);
  }

  function message(title, text, actions, mode = 'message') {
    stepsOn(false);
    byId('msgTitle').textContent = title;
    byId('msgText').textContent = text;
    byId('msgPrompt').textContent = '';
    const box = byId('msgActions');
    box.innerHTML = '';
    (st.remote ? [] : actions).forEach(a => {
      const b = document.createElement('button');
      b.className = 'stage-btn';
      b.textContent = a.label;
      b.onclick = () => { b.blur(); a.fn(); };
      box.appendChild(b);
    });
    replay('scrMessage'); show('scrMessage');
    FX.confetti(2500); Sound.fanfare();
    st.mode = mode;
  }

  /* ---------------- flow: contester draw ---------------- */
  function startRoll(slot, pool, note = '') {
    st.pool = pool;
    st.slot = slot;
    const r = st.round;
    byId('rollLabel').textContent = T(F().roundLabel);
    byId('rollTitle').textContent = T(F().slots[slot].title);
    byId('rollNote').textContent = note;
    setStep('p' + slot);
    const left = byId('rollLeft'), right = byId('rollRight');
    if (r.team.length) {
      left.innerHTML = r.team.length === 1
        ? personCard(r.team[0], roleOf(0))
        : `<div class="side-team">${r.team.map((c, i) => chip(c, roleOf(i))).join('')}</div>`;
      right.innerHTML = mysteryCard(roleOf(slot));
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

    let hot = null;
    st.roller = new Roller(pool, c => {
      num.textContent = c.num;
      num.animate([{ transform: 'translateY(-16%) scale(1.07)', opacity: 0.45 }, { transform: 'none', opacity: 1 }], { duration: 110, easing: 'ease-out' });
      if (hot) hot.classList.remove('hot');
      hot = strip.querySelector(`[data-id="${c.id}"]`);
      if (hot) hot.classList.add('hot');
    });
    st.roller.start();
    st.mode = 'roll';
  }

  async function stopRoll() {
    const g = st.gen;
    const slot = st.slot, r = st.round;
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
    r.team.push(chosen);
    await reveal(chosen, roleOf(slot), g);
    if (g !== st.gen) return;

    const full = r.team.length >= F().teamSize;
    if (full && F().teamSize > 1) {
      await wait(2200);
      if (g !== st.gen) return;
      return showTeam();
    }
    const more = !full && memberPool().list.length > 0;
    byId('revealPrompt').innerHTML = `<span class="key">⌨</span> ${more ? `Press any key to draw: <b>${esc(roleOf(r.team.length))}</b>` : 'Press any key to continue'}`;
    st.mode = 'revealed';
    st.busy = false;
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

  /** Who can still join the current team. */
  function memberPool() {
    const ids = new Set(st.round.team.map(c => c.id));
    let list = waiting().filter(c => !ids.has(c.id)), fromDone = false;
    if (!list.length && F().fillFromDone) {
      list = S.contesters.filter(c => !ids.has(c.id));
      fromDone = list.length > 0;
    }
    return { list, fromDone };
  }

  function nextMember() {
    const r = st.round;
    if (r.team.length >= F().teamSize) return showTeam();
    const p = memberPool();
    if (!p.list.length) return showTeam();
    startRoll(r.team.length, p.list, p.fromDone ? 'Everyone else has already presented, so this person is drawn from earlier presenters' : '');
  }

  async function showTeam() {
    const g = st.gen;
    st.busy = true; st.mode = 'team';
    const { team } = st.round, n = team.length, f = F();
    byId('pairLabel').textContent = T(f.roundLabel);
    byId('pairTitle').textContent = T(f.teamTitle);
    byId('pairNote').textContent = n < f.teamSize ? `Only ${n} of ${f.teamSize} could be drawn: there are not enough contesters` : '';
    const side = i => (i * 2 + 1 < n ? 'pa' : i * 2 + 1 > n ? 'pb' : 'pm');
    const link = '<div class="pair-link"><div class="beam"></div><div class="amp">&amp;</div></div>';
    const row = byId('pairRow');
    row.className = `pair-row n${Math.min(n, 6)}`;
    row.innerHTML = team.map((c, i) => `<div class="pair-slot ${side(i)}">${personCard(c, n > 1 ? roleOf(i) : '')}</div>`).join(link);
    byId('scrPair').classList.toggle('solo', n === 1);
    byId('pairPrompt').textContent = '';
    setStep('p' + (n - 1));
    FX.stopEmitters();
    replay('scrPair'); show('scrPair');
    Sound.whoosh();

    await wait(820);
    if (g !== st.gen) return;
    const [cx, cy] = center(row);
    flash(0.55);
    Sound.boom(); Sound.fanfare();
    FX.shockwave(cx, cy);
    FX.burst(cx, cy, { count: 200, speed: [2, 14] });
    FX.burst(cx, cy, { count: 50, shape: 'star', colors: FX.GOLD, speed: [1, 7], gravity: 0.02 });
    FX.confetti(2600);
    $$('#scrPair .photo-frame').forEach(el => FX.sparkle(el, 6000));

    await wait(1300);
    if (g !== st.gen) return;
    const r = st.round;
    let next;
    if (r.tcount > 0) next = r.tcount > 1 ? `Press any key to draw ${esc(tLabel().toLowerCase())} 1 of ${r.tcount}` : `Press any key to draw your ${esc(tLabel().toLowerCase())}`;
    else next = f.phases.length ? 'Press any key to start the timer' : 'Press any key to finish the round';
    byId('pairPrompt').innerHTML = `<span class="key">⌨</span> ${next}`;
    st.mode = 'teamShown';
    st.busy = false;
  }

  async function afterTeam() {
    if (st.round.tcount > 0) return startTicketRoll();
    await commitRound();
    startTimers();
  }

  /* ---------------- flow: ticket draw ---------------- */
  function ticketPool() {
    const taken = new Set(st.round.tickets.map(t => t.id));
    const all = deck().filter(t => !taken.has(t.id));
    if (!F().uniqueTickets) return { list: all, reshuffle: false };
    const unused = all.filter(t => !isUsed(t, stageNow().id));
    return unused.length ? { list: unused, reshuffle: false } : { list: all, reshuffle: all.length > 0 };
  }

  const cardLabel = () => `<small style="--lw:${Math.max(4, tLabel().length)}">${esc(tLabel())}</small>`;

  async function startTicketRoll() {
    const r = st.round;
    const { list, reshuffle } = ticketPool();
    if (!list.length || r.tickets.length >= r.tcount) {
      await commitRound();
      return startTimers();
    }
    st.tpool = list;
    st.reshuffle = reshuffle;
    const k = r.tickets.length + 1;
    setStep('t', r.tcount > 1 ? `${tLabel()} ${F().ticketFlow === 'each' ? `${k}/${r.tcount}` : `×${r.tcount}`}` : null);
    byId('tkTeam').innerHTML = teamChips();
    byId('tkTitle').textContent = T(F().ticketTitle, { n: k });
    const label = tLabel().toLowerCase();
    byId('tkNote').textContent = (r.tcount > 1 && !F().ticketTitle.includes('{n}') ? `${tLabel()} ${k} of ${r.tcount} · ` : '') + (reshuffle
      ? `Every ${label} has been used, so the deck has been reshuffled`
      : `${list.length} ${label}${list.length > 1 ? 's' : ''} in the deck`);
    const grid = byId('tkGrid');
    grid.innerHTML = list.map((t, i) =>
      `<div class="tk" data-id="${t.id}" style="--d:${i}"><div class="tk-in"><span class="tk-star">✦</span><b>${t.num}</b>${cardLabel()}</div></div>`
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
    await commitRound();
    await addTicket(t, st.reshuffle);

    const r = card.getBoundingClientRect();
    byId('btNum').textContent = t.num;
    byId('btLabel').textContent = tLabel();
    byId('btLabel').style.setProperty('--lw', Math.max(4, tLabel().length));
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
    const f = F(), rd = st.round, first = f.phases[0];
    const more = rd.tickets.length < rd.tcount && ticketPool().list.length > 0;
    if (more && (f.ticketFlow === 'together' || !first)) {
      byId('btPrompt').innerHTML = `<span class="key">⌨</span> Press any key to draw ${esc(tLabel().toLowerCase())} ${rd.tickets.length + 1} of ${rd.tcount}`;
      st.mode = 'ticketNext';
    } else if (!first) {
      byId('btPrompt').innerHTML = '<span class="key">⌨</span> Press any key to finish the round';
      st.mode = 'ticketShown';
    } else if (f.autoAdvance) {
      countdown(byId('btPrompt'), `${first.name} starts in`, f.autoDelay, startTimers);
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
  /** Mark the team as presented and log the round. Tickets are added with addTicket(). */
  async function commitRound() {
    const r = st.round;
    if (!r || r.committed) return;
    const sid = stageNow()?.id;
    r.undo = { done: {}, sid, used: Object.fromEntries(S.tickets.map(x => [x.id, isUsed(x, sid)])) };
    r.team.forEach(c => { r.undo.done[c.id] = isDone(c); setDone(c, true); });
    const s = stageNow();
    const h = {
      id: uid(), round: r.num, at: Date.now(), format: F().name,
      stage: s ? s.name : '', stageId: s ? s.id : '',
      team: r.team.map(c => ({ id: c.id, num: c.num, name: c.name })), tickets: [],
    };
    S.history.push(h);
    r.hist = h;
    r.committed = true;
    try {
      await Promise.all([DB.putMany('contesters', r.team), DB.set('history', S.history)]);
    } catch (e) { console.error(e); }
    saved();
  }

  async function addTicket(t, reshuffle) {
    const r = st.round;
    r.tickets.push(t);
    let changed = [];
    if (F().uniqueTickets) {
      if (reshuffle) {
        const taken = new Set(r.tickets.map(x => x.id));
        changed = deck().filter(x => !taken.has(x.id));
        changed.forEach(x => setUsed(x, false, stageNow().id));
        changed.push(t);
      }
      setUsed(t, true, stageNow().id);
      if (!reshuffle) changed = [t];
    }
    r.hist.tickets.push({ num: t.num, title: t.title || '' });
    try {
      await Promise.all([DB.putMany('tickets', changed), DB.set('history', S.history)]);
    } catch (e) { console.error(e); }
    saved();
  }

  async function undoRound() {
    const r = st.round;
    if (!r || !r.committed) return;
    const changed = [], tch = [];
    for (const [id, was] of Object.entries(r.undo.done)) {
      const c = S.contesters.find(x => x.id === id);
      if (c) { setDone(c, was); changed.push(c); }
    }
    for (const t of S.tickets) {
      const u = r.undo.used[t.id];
      if (u !== undefined && isUsed(t, r.undo.sid) !== u) { setUsed(t, u, r.undo.sid); tch.push(t); }
    }
    S.history = S.history.filter(h => h.id !== r.hist.id);
    r.committed = false;
    await Promise.all([DB.putMany('contesters', changed), DB.putMany('tickets', tch), DB.set('history', S.history)]);
    saved();
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
  function moreTickets() {
    const r = st.round;
    return F().ticketFlow === 'each' && r.tickets.length < r.tcount && ticketPool().list.length > 0;
  }

  async function startTimers() {
    const r = st.round;
    if (!r.committed) await commitRound();
    clearInterval(st.cd); st.cd = null;
    const shown = F().ticketFlow === 'each' ? r.tickets.slice(-1) : r.tickets;
    const prob = byId('tmProblem');
    prob.classList.toggle('multi', shown.length > 1);
    if (shown.length > 1) {
      const n = shown.length, cols = n <= 2 ? 1 : n <= 6 ? 2 : 3;
      prob.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      prob.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, minmax(0, 1fr))`;
      prob.innerHTML = shown.map(t => `<div class="tm-tk">${ticketHTML(t)}</div>`).join('');
    } else {
      prob.style.gridTemplateColumns = prob.style.gridTemplateRows = '';
      prob.innerHTML = shown.length ? ticketHTML(shown[0]) : '';
    }
    prob.hidden = !shown.length;
    const words = parseWords(shown.flatMap(t => t.words || []).join('\n'));
    const wEl = byId('tmWords');
    wEl.hidden = !words.length;
    wEl.classList.toggle('many', words.length > 10);
    wEl.innerHTML = words.length ? `<div class="tm-words-label">✦ Adjectives ✦</div>${wordsHTML(words)}` : '';
    byId('scrTimer').classList.toggle('has-words', words.length > 0);
    byId('scrTimer').classList.toggle('no-problem', !shown.length);
    byId('tmTeam').innerHTML = teamChips();
    FX.stopEmitters();
    if (!F().phases.length) return moreTickets() ? startTicketRoll() : afterRound();
    show('scrTimer');
    startPhase(0);
  }

  function startPhase(i) {
    const p = F().phases[i];
    if (!p) return afterRound();
    st.phaseIdx = i;
    const total = Math.max(1, p.sec) * 1000;
    st.tm = { total, end: performance.now() + total, paused: false, remain: total, lastSec: null };
    const scr = byId('scrTimer');
    scr.style.setProperty('--pc', p.color || '#f5c451');
    scr.classList.remove('warn', 'danger', 'over');
    byId('tmPhase').textContent = p.name;
    setStep('ph' + i);
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
      const s = F(), scr = byId('scrTimer');
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
    const next = F().phases[st.phaseIdx + 1];
    const more = !next && moreTickets();
    const k = st.round.tickets.length + 1;
    banner(next ? 'Time!' : "Time's up!", next ? `Next: ${next.name}` : more ? `Next: ${tLabel()} ${k} of ${st.round.tcount}` : '');

    await wait(1900);
    if (g !== st.gen) return;
    st.busy = false;
    if (next) {
      scr.classList.remove('over');
      if (F().autoAdvance) countdown(byId('tmPrompt'), `${next.name} starts in`, Math.min(5, F().autoDelay), () => startPhase(st.phaseIdx + 1));
      else { byId('tmPrompt').innerHTML = `<span class="key">⌨</span> Press any key to start ${esc(next.name)}`; st.mode = 'phaseWait'; }
    } else if (more) {
      byId('tmPrompt').innerHTML = `<span class="key">⌨</span> Press any key to draw ${esc(tLabel().toLowerCase())} ${k} of ${st.round.tcount}`;
      st.mode = 'ticketNext';
    } else {
      afterRound();
    }
  }

  /* ---------------- flow: scoring ---------------- */
  const scoringOn = () => F().scoring && E().judges.length > 0;
  const fmtScore = v => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));

  /** After the timers: score each person, or show the round-done screen. */
  function afterRound() {
    return scoringOn() && st.round && st.round.team.length ? scoreWait(0) : showDone();
  }

  /** A person waits for the judges' scores (typed in the presenter console). */
  function scoreWait(i) {
    reset();
    const r = st.round, c = r.team[i], judges = E().judges;
    st.score = { idx: i, scores: null, avg: null };
    stepsOn(true);
    setStep('sc', r.team.length > 1 ? `Score ${i + 1}/${r.team.length}` : 'Score');
    byId('scLabel').textContent = `${T(F().roundLabel)} · Scores`;
    byId('scRole').textContent = r.team.length > 1 ? roleOf(i) : '';
    byId('scImg').src = avatarFor(c);
    byId('scNum').textContent = '#' + c.num;
    byId('scName').innerHTML = words(c.name);
    byId('scJudges').className = `sc-judges n${Math.min(judges.length, 6)}`;
    byId('scJudges').innerHTML = judges.map((j, k) => `
      <div class="jc" style="--k:${k}">
        <div class="jc-in">
          <div class="jc-face jc-back"><span>?</span></div>
          <div class="jc-face jc-front"><b data-v></b><small>/ ${fmtScore(F().scoreMax)}</small></div>
        </div>
        <div class="jc-name">${esc(j || `Judge ${k + 1}`)}</div>
      </div>`).join('');
    byId('scAvg').className = 'avg-box';
    byId('scAvgVal').textContent = '?';
    byId('scPrompt').textContent = st.remote ? 'Waiting for the judges…' : 'Press any key to enter the scores';
    replay('scrScore'); show('scrScore');
    FX.warpTo(0.05);
    Sound.whoosh();
    st.mode = 'scoreWait';
    const g = st.gen;
    setTimeout(() => { if (g === st.gen) FX.sparkle(byId('scPhoto'), 4000); }, 900);
  }

  /** Count a number up from 0, like a scoreboard. */
  function countUp(el, to, decimals, ms) {
    const t0 = performance.now();
    return new Promise(res => {
      const step = now => {
        const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        el.textContent = (to * e).toFixed(decimals);
        if (p < 1) requestAnimationFrame(step);
        else { el.textContent = to.toFixed(decimals); res(); }
      };
      requestAnimationFrame(step);
    });
  }

  async function saveScores(i, scores, avg) {
    const r = st.round;
    if (!r.hist) return;
    const entry = r.hist.team[i];
    if (entry) { entry.scores = scores; entry.avg = avg; }
    try { await DB.set('history', S.history); } catch (e) { console.error(e); }
    saved();
  }

  /** Reveal each judge's score, then (after the suspense delay) the average. */
  async function revealScores(raw) {
    if (st.mode !== 'scoreWait' || st.busy) return;
    const judges = E().judges;
    const scores = judges.map((_, k) => Math.max(0, Math.min(F().scoreMax, Number(raw[k]) || 0)));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const g = st.gen, i = st.score.idx;
    st.busy = true; st.mode = 'scoring';
    st.score.scores = scores;
    byId('scPrompt').textContent = '';
    await saveScores(i, scores, avg);

    const cards = $$('#scJudges .jc');
    for (let k = 0; k < cards.length; k++) {
      if (g !== st.gen) return;
      const card = cards[k], v = card.querySelector('[data-v]');
      v.textContent = '0';
      card.classList.add('open');
      Sound.lock();
      const dec = Number.isInteger(scores[k]) ? 0 : Math.min(2, String(scores[k]).split('.')[1].length);
      countUp(v, scores[k], dec, 700);
      await wait(380);
      if (g !== st.gen) return;
      const [x, y] = center(card);
      FX.burst(x, y, { count: 70, speed: [2, 9], life: [0.6, 1.4], gravity: 0.05 });
      FX.burst(x, y, { count: 16, shape: 'star', colors: FX.GOLD, speed: [1, 5], gravity: 0.02 });
      FX.shockwave(x, y, { max: card.offsetWidth * 1.3, dur: 0.6, width: 2 });
      await wait(k < cards.length - 1 ? 820 : 450);
    }
    if (g !== st.gen) return;

    // the average, straight away
    const box = byId('scAvg');
    box.classList.add('shown');
    st.score.avg = avg;
    flash(0.6);
    Sound.boom(); Sound.chime();
    const [x, y] = center(box);
    FX.shockwave(x, y);
    FX.shockwave(x, y, { dur: 1.4, color: '196,181,253', width: 3 });
    FX.burst(x, y, { count: 220, speed: [3, 16], life: [0.8, 2], gravity: 0.05 });
    FX.burst(x, y, { count: 60, shape: 'star', colors: FX.GOLD, speed: [1, 8], gravity: 0.015 });
    await countUp(byId('scAvgVal'), avg, F().avgDecimals, 1100);
    if (g !== st.gen) return;
    Sound.fanfare();
    FX.confetti(2600);
    FX.sparkle(box, 5000);
    await wait(1200);
    if (g !== st.gen) return;

    const r = st.round, next = r.team[i + 1];
    byId('scPrompt').innerHTML = `<span class="key">⌨</span> ${next
      ? `Press any key for ${esc(next.name)}'s score`
      : waiting().length ? 'Press any key to draw the next round' : 'Press any key to finish the stage'}`;
    st.mode = 'scoreShown';
    st.busy = false;
  }

  /* ---------------- ranking at the end of a stage ---------------- */
  function rankingOrEnd() {
    const s = stageNow();
    const list = s && scoringOn() ? stageRanking(s.id) : [];
    return list.length ? showRanking(list) : stageEnd();
  }

  async function showRanking(list) {
    reset();
    stepsOn(false);
    const s = stageNow(), g = st.gen;
    const medal = r => ['🥇', '🥈', '🥉'][r - 1] || '';
    const photo = p => avatarFor(S.contesters.find(c => c.id === p.id) || { name: p.name });
    const score = p => p.avg.toFixed(F().avgDecimals);
    byId('rkLabel').textContent = `Stage ${st.stageIdx + 1} · ${s.name}`;
    const top = list.slice(0, 3), rest = list.slice(3);
    byId('rkPodium').innerHTML = [1, 0, 2].filter(i => top[i]).map(i => {
      const p = top[i];
      return `<div class="pod pl${i + 1}" data-place="${i}">
        <div class="pod-medal">${medal(p.rank) || p.rank}</div>
        <div class="photo-frame"><img src="${esc(photo(p))}" alt=""></div>
        <div class="pod-name">#${p.num} ${esc(p.name)}</div>
        <div class="pod-score">${score(p)}</div>
        <div class="pod-block"><span>${p.rank}</span></div>
      </div>`;
    }).join('');
    const rr = byId('rkRest');
    const cols = rest.length <= 3 ? 1 : Math.min(5, Math.ceil(rest.length / 4));
    const rows = Math.ceil(rest.length / cols) || 1;
    rr.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    rr.style.width = `min(94vw, ${cols * 32}vw)`;
    rr.style.setProperty('--rh', `${Math.min(5, 22 / rows).toFixed(2)}vh`);
    rr.hidden = !rest.length;
    // fill column by column so the order reads downwards
    rr.style.gridAutoFlow = 'column';
    rr.style.gridTemplateRows = `repeat(${rows}, var(--rh))`;
    rr.innerHTML = rest.map(p => `
      <div class="rr"><b class="rr-rank">${p.rank}</b><img src="${esc(photo(p))}" alt=""><span class="rr-name">#${p.num} ${esc(p.name)}</span><b class="rr-score">${score(p)}</b></div>`).join('');
    byId('rkPrompt').textContent = '';
    replay('scrRanking'); show('scrRanking');
    FX.warpTo(0.15);
    Sound.whoosh();
    st.mode = 'ranking';
    st.busy = true;
    await wait(900);
    if (g !== st.gen) return;

    const rowsEl = $$('#rkRest .rr');
    for (let k = rowsEl.length - 1; k >= 0; k--) {
      rowsEl[k].classList.add('in');
      Sound.softTick();
      await wait(Math.max(60, Math.min(220, 2400 / rowsEl.length)));
      if (g !== st.gen) return;
    }
    if (rowsEl.length) await wait(700);

    for (const place of [2, 1, 0]) {
      const el = $(`#rkPodium [data-place="${place}"]`);
      if (!el) continue;
      if (g !== st.gen) return;
      el.classList.add('in');
      const [x, y] = center(el.querySelector('.photo-frame'));
      if (place === 0) {
        Sound.rise();
        await wait(500);
        if (g !== st.gen) return;
        flash(0.85);
        Sound.boom(); Sound.fanfare();
        FX.shockwave(x, y);
        FX.shockwave(x, y, { dur: 1.4, color: '196,181,253', width: 3 });
        FX.burst(x, y, { count: 260, speed: [3, 18], life: [0.8, 2.2], gravity: 0.05 });
        FX.burst(x, y, { count: 90, shape: 'star', colors: FX.GOLD, speed: [1, 9], life: [1.2, 2.4], gravity: 0.015 });
        FX.confetti(4500);
        FX.sparkle(el.querySelector('.photo-frame'), 9000);
        await wait(1600);
      } else {
        Sound.lock(); Sound.chime();
        FX.burst(x, y, { count: 120, speed: [2, 11], gravity: 0.05 });
        FX.shockwave(x, y, { dur: 0.8, width: 3 });
        await wait(1300);
      }
    }
    if (g !== st.gen) return;
    const next = E().stages[st.stageIdx + 1];
    byId('rkPrompt').innerHTML = `<span class="key">⌨</span> ${next ? `Press any key to continue` : 'Press any key to finish'}`;
    st.mode = 'rankingShown';
    st.busy = false;
  }

  /* one-screen mode: a small form on the stage itself */
  function openScoreEntry() {
    const judges = E().judges, max = F().scoreMax;
    byId('ssWho').textContent = `${st.round.team[st.score.idx].name}`;
    byId('ssInputs').innerHTML = judges.map((j, k) => `
      <label>${esc(j || `Judge ${k + 1}`)}<input type="number" min="0" max="${max}" step="any" data-j="${k}" placeholder="0 – ${fmtScore(max)}"></label>`).join('');
    byId('stageScore').hidden = false;
    showUI();
    const first = $('#ssInputs input');
    if (first) first.focus();
  }
  function closeScoreEntry() { byId('stageScore').hidden = true; }
  function submitScoreEntry() {
    const vals = $$('#ssInputs input').map(x => x.value.trim());
    const max = F().scoreMax;
    if (vals.some(v => v === '' || isNaN(+v) || +v < 0 || +v > max)) return toast(`Enter a score from 0 to ${fmtScore(max)} for every judge`, 'error');
    closeScoreEntry();
    revealScores(vals.map(Number));
  }

  /* ---------------- flow: round done ---------------- */
  async function showDone() {
    const g = st.gen;
    st.busy = true; st.mode = 'doneAnim';
    const r = st.round;
    const w = waiting().length;
    setStep('done');
    byId('doneTitle').textContent = T(F().doneTitle);
    byId('doneTeam').innerHTML = teamChips();
    const tk = r.tickets.length ? `${tLabel()} ${r.tickets.map(t => '#' + t.num).join(', ')} · ` : '';
    byId('doneInfo').textContent = tk + (w ? `${w} contester${w > 1 ? 's' : ''} still waiting` : 'Everyone has presented!');
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

  /* ---------------- winners ceremony ---------------- */
  const medalOf = a => MEDALS[a.medal] || MEDALS.gold;

  function winners() {
    st.stageIdx = -1;
    st.round = null;
    st.win = { list: winnersOrder(), i: -1 };
    const n = st.win.list.length;
    if (!n) {
      reset();
      return message('No winners yet', 'Choose the winners in the Winners tab of the dashboard.', [{ label: '✕ Back to dashboard', fn: close }], 'final');
    }
    titleScreen({
      kicker: E().title, title: S.winners.title || 'The Winners', info: `${n} award${n === 1 ? '' : 's'}`,
      prompt: 'Click to reveal the first award', mode: 'wTitle',
    });
  }

  /** Scores under a winner: one row per stage (a person) or per member (a group). */
  function winnerScoresHTML(a, ppl) {
    if (!S.winners.showScores) return '';
    const recs = ppl.map(c => ({ c, r: personRecord(c.id) }));
    if (!recs.some(x => x.r.overall != null)) return '';
    const num = v => `<b class="wn-v" data-to="${v == null ? '' : v}">${v == null ? '–' : '0.00'}</b>`;
    let rows, total, totalLabel;
    if (a.kind === 'person') {
      const r = recs[0].r;
      rows = r.stages.map(s => `
        <div class="wn-row">
          <span class="wn-l"><i>${esc(s.icon)}</i>${esc(s.name)}</span>
          <span class="wn-js">${s.rounds.map(rd => rd.scores.map(v => `<em>${esc(fmtScoreW(v))}</em>`).join('')).join('<i class="wn-sep"></i>')}</span>
          ${num(s.avg)}
        </div>`);
      total = r.overall; totalLabel = r.stages.length > 1 ? 'Overall average' : 'Average score';
    } else {
      rows = recs.map(({ c, r }) => `
        <div class="wn-row">
          <span class="wn-l"><img src="${esc(avatarFor(c))}" alt="">${esc(c.name)}</span>
          <span class="wn-js">${r.stages.map(s => `<em title="${esc(s.name)}">${esc(s.icon)} ${fmtAvg(s.avg)}</em>`).join('')}</span>
          ${num(r.overall)}
        </div>`);
      total = meanOf(recs.map(x => x.r.overall).filter(v => v != null)); totalLabel = 'Team average';
    }
    return `<div class="wn-sh">✦ Scores from the rounds ✦</div>
      <div class="wn-rows n${Math.min(rows.length, 6)}">${rows.map((h, k) => h.replace('class="wn-row"', `class="wn-row" style="--k:${k}"`)).join('')}</div>
      <div class="wn-total"><span>${totalLabel}</span>${num(total)}</div>`;
  }
  const fmtScoreW = v => (Number.isInteger(v) ? String(v) : String(+(+v).toFixed(2)));

  /** An award on screen with its winner hidden: the suspense before the reveal. */
  function winnerTease(i) {
    reset();
    stepsOn(false);
    const W = st.win, a = W.list[i];
    if (!a) return winnersFinale();
    W.i = i;
    const ppl = awardPeople(a), group = a.kind === 'group';
    const scr = byId('scrWinner');
    scr.dataset.medal = a.medal;
    scr.classList.remove('rolling', 'revealed', 'scored');
    byId('wnCount').textContent = `Award ${i + 1} of ${W.list.length}`;
    byId('wnMedal').textContent = medalOf(a).icon;
    byId('wnTitle').innerHTML = words(a.title || 'Award');
    const pp = byId('wnPeople');
    pp.className = `wn-people n${Math.min(ppl.length, 6)}${group ? ' group' : ''}`;
    pp.innerHTML = ppl.map((c, k) => `
      <div class="wn-p" style="--k:${k}">
        <div class="wn-flip">
          <div class="wn-face wn-back"><div class="photo-frame"><div class="q">?</div></div></div>
          <div class="wn-face wn-front"><div class="photo-frame"><img src="${esc(avatarFor(c))}" alt=""></div></div>
        </div>
        ${group ? `<div class="wn-pname">${esc(c.name)}</div>` : ''}
      </div>`).join('');
    byId('wnName').innerHTML = words(awardName(a));
    byId('wnName').classList.toggle('long', awardName(a).length > 22);
    byId('wnNote').textContent = a.note;
    const sc = winnerScoresHTML(a, ppl);
    byId('wnScores').innerHTML = sc;
    byId('wnBody').classList.toggle('has-scores', !!sc);
    byId('wnPrompt').textContent = 'Click to reveal the winner';
    replay('scrWinner'); show('scrWinner');
    FX.warpTo(0.2);
    Sound.whoosh();
    const g = st.gen;
    setTimeout(() => { if (g === st.gen) { Sound.magic(); FX.sparkle(byId('wnPeople'), 3000); } }, 500);
    st.mode = 'wTease';
  }

  /** Drumroll, particles rush in, flash: the winner appears, then their scores count up. */
  async function winnerReveal() {
    const g = st.gen, a = st.win.list[st.win.i];
    st.busy = true; st.mode = 'wRevealing';
    const scr = byId('scrWinner'), pp = byId('wnPeople');
    byId('wnPrompt').textContent = '';
    scr.classList.add('rolling');
    Sound.drumroll();
    let [x, y] = center(pp);
    FX.implode(x, y, { count: 260, time: 1.6 });
    FX.warpTo(1);
    await wait(1750);
    if (g !== st.gen) return;

    FX.warpTo(0.08);
    scr.classList.remove('rolling');
    scr.classList.add('revealed');
    flash(0.95, a.medal === 'silver' ? '#eef2ff' : '#fff7d6');
    Sound.boom(); Sound.fanfare(); Sound.chime();
    [x, y] = center(pp);
    FX.shockwave(x, y);
    FX.shockwave(x, y, { dur: 1.5, color: '196,181,253', width: 3 });
    FX.burst(x, y, { count: 320, speed: [3, 20], life: [0.8, 2.4], gravity: 0.05 });
    FX.burst(x, y, { count: 110, shape: 'star', colors: FX.GOLD, speed: [1, 10], life: [1.2, 2.6], gravity: 0.015 });
    FX.confetti(5500);
    $$('#wnPeople .photo-frame').forEach(el => FX.sparkle(el, 10000));
    fireworks(g, 7000);
    await wait(1800);
    if (g !== st.gen) return;

    const rows = $$('#wnScores .wn-row');
    if (rows.length || $('#wnScores .wn-total')) {
      scr.classList.add('scored');
      Sound.whoosh();
      await wait(500);
      for (const row of rows) {
        if (g !== st.gen) return;
        row.classList.add('in');
        Sound.lock();
        const v = row.querySelector('.wn-v');
        if (v.dataset.to !== '') countUp(v, +v.dataset.to, 2, 650);
        await wait(Math.max(260, Math.min(650, 2600 / rows.length)));
      }
      const tot = $('#wnScores .wn-total');
      if (tot && g === st.gen) {
        await wait(250);
        tot.classList.add('in');
        Sound.rise();
        const v = tot.querySelector('.wn-v');
        if (v.dataset.to !== '') await countUp(v, +v.dataset.to, 2, 1100);
        if (g !== st.gen) return;
        const [tx, ty] = center(tot);
        Sound.chime();
        FX.burst(tx, ty, { count: 120, speed: [2, 11], gravity: 0.04 });
        FX.burst(tx, ty, { count: 30, shape: 'star', colors: FX.GOLD, speed: [1, 6], gravity: 0.015 });
        FX.sparkle(tot, 5000);
      }
    }
    if (g !== st.gen) return;
    const last = st.win.i + 1 >= st.win.list.length;
    byId('wnPrompt').innerHTML = `<span class="key">⌨</span> ${last ? 'Click to see all the winners together' : 'Click for the next award'}`;
    st.mode = 'wShown';
    st.busy = false;
  }

  /** Bursts of colour across the top of the screen for a while. */
  function fireworks(g, ms) {
    const until = performance.now() + ms;
    const palettes = [FX.GOLD, FX.MAGIC, FX.CONF, ['#ffffff', '#c4b5fd', '#8b5cf6'], ['#fff7d6', '#38bdf8', '#ffffff']];
    const one = () => {
      if (g !== st.gen || performance.now() > until) return;
      const W = innerWidth, H = innerHeight;
      const x = W * (0.08 + Math.random() * 0.84), y = H * (0.08 + Math.random() * 0.4);
      const colors = palettes[Math.floor(Math.random() * palettes.length)];
      FX.burst(x, y, { count: 90 + Math.floor(Math.random() * 60), speed: [2, 9], life: [0.9, 1.9], gravity: 0.07, drag: 0.955, colors });
      FX.burst(x, y, { count: 14, shape: 'star', colors: FX.GOLD, speed: [0.5, 4], life: [1, 2], gravity: 0.02 });
      FX.shockwave(x, y, { max: 90 + Math.random() * 80, dur: 0.6, width: 2, color: '255,240,200' });
      Sound.firework();
      setTimeout(one, 380 + Math.random() * 620);
    };
    one();
  }

  /** Every winner together. */
  async function winnersFinale() {
    reset();
    stepsOn(false);
    const g = st.gen;
    const list = S.winners.revealUp ? st.win.list.slice().reverse() : st.win.list.slice();
    st.win.i = st.win.list.length;
    byId('wfLabel').textContent = E().title;
    byId('wfTitle').textContent = S.winners.closing || 'Congratulations!';
    const grid = byId('wfGrid'), n = list.length;
    const cols = n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : 5;
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    grid.style.setProperty('--rows', Math.ceil(n / cols));
    grid.className = `wf-grid c${cols}`;
    grid.innerHTML = list.map((a, k) => {
      const ppl = awardPeople(a), ov = meanOf(ppl.map(c => personRecord(c.id).overall).filter(v => v != null));
      return `<div class="wf-card" data-medal="${a.medal}" style="--k:${k}">
        <div class="wf-medal">${medalOf(a).icon}</div>
        <div class="wf-award">${esc(a.title)}</div>
        <div class="wf-photos n${Math.min(ppl.length, 6)}">${ppl.map(c => `<img src="${esc(avatarFor(c))}" alt="">`).join('')}</div>
        <div class="wf-name">${esc(awardName(a))}</div>
        ${a.kind === 'group' && a.team.trim() ? `<div class="wf-members">${ppl.map(c => esc(c.name)).join(' · ')}</div>` : ''}
        ${S.winners.showScores && ov != null ? `<div class="wf-score">${fmtAvg(ov)}</div>` : ''}
      </div>`;
    }).join('');
    byId('wfPrompt').textContent = '';
    replay('scrWinnersAll'); show('scrWinnersAll');
    FX.warpTo(0.15);
    st.mode = 'wFinale';
    st.busy = true;
    Sound.whoosh();
    const cards = $$('#wfGrid .wf-card');
    for (const c of cards) {
      await wait(Math.max(160, Math.min(420, 2400 / cards.length)));
      if (g !== st.gen) return;
      c.classList.add('in');
      Sound.lock();
      const [x, y] = center(c);
      FX.burst(x, y, { count: 60, speed: [2, 8], gravity: 0.05 });
    }
    await wait(500);
    if (g !== st.gen) return;
    flash(0.7);
    Sound.boom(); Sound.fanfare();
    FX.confetti(8000);
    fireworks(g, 14000);
    cards.forEach(c => FX.sparkle(c.querySelector('.wf-photos'), 8000));
    byId('wfPrompt').textContent = '';
    st.busy = false;
  }

  /** Click on the last screen: more fireworks. */
  function celebrate() {
    const x = innerWidth * (0.2 + Math.random() * 0.6), y = innerHeight * (0.2 + Math.random() * 0.3);
    flash(0.25);
    Sound.chime();
    FX.shockwave(x, y, { dur: 1, width: 3 });
    FX.burst(x, y, { count: 220, speed: [3, 15], life: [0.8, 2], gravity: 0.05, colors: FX.CONF });
    FX.confetti(2500);
    fireworks(st.gen, 5000);
  }

  /* ---------------- remote control (presenter window) ---------------- */
  function command(c) {
    if (st.menu) toggleMenu(false);
    switch (c.cmd) {
      case 'key': return action(c.key);
      case 'opening': return opening();
      case 'structure': return structure();
      case 'info': return stageInfo(c.i);
      case 'closing': return closing();
      case 'runStage': return runStage(c.i);
      case 'timer': if (st.mode === 'timer' && !st.busy) timerKey(c.k); return;
      case 'redo': return redoRound();
      case 'endRound': return endRoundNow();
      case 'endStage': return st.stageIdx < 0 ? null : st.mode === 'rankingShown' ? stageEnd() : rankingOrEnd();
      case 'standby': return standby();
      case 'winners': return winners();
      case 'winnerAt':
        st.stageIdx = -1; st.round = null;
        st.win = { list: winnersOrder(), i: -1 };
        if (!st.win.list.length) return winners();
        return c.i >= st.win.list.length ? winnersFinale() : winnerTease(c.i);
      case 'showScore': return revealScores(c.scores || []);
      case 'resetStage': {
        const s = E().stages[c.i];
        if (!s) return;
        S.contesters.forEach(x => setDone(x, false, s.id));
        return DB.putMany('contesters', S.contesters).then(saved);
      }
    }
  }

  function describe() {
    const m = st.mode, r = st.round, s = stageNow();
    const stage = s ? `Stage ${st.stageIdx + 1} · ` : '';
    const round = r ? `${stage}Round ${r.num} · ` : stage;
    switch (m) {
      case 'standby': return 'Waiting screen (before the opening)';
      case 'evTitle': return 'Opening · Contest title';
      case 'structure': return `Opening · Structure (${st.revealed} of ${E().stages.length} stages shown)`;
      case 'stageInfo': return `Opening · Stage ${st.info + 1}: ${E().stages[st.info]?.name || ''}`;
      case 'closing': return `Opening · ${E().closingTitle}`;
      case 'intro': return `${stage}Title: ${s ? s.name : ''}`;
      case 'roll': return `${round}Drawing: ${roleOf(st.slot)} (spinning)`;
      case 'stopping': return `${round}Stopping the draw…`;
      case 'revealed': return `${round}${r.team[r.team.length - 1]?.name || ''} revealed`;
      case 'team': case 'teamShown': return `${round}The team is on screen`;
      case 'ticketRoll': return `${round}Drawing ${tLabel().toLowerCase()} (spinning)`;
      case 'ticketNext': case 'ticketShown': return `${round}${tLabel()} on screen`;
      case 'countdown': return `${round}Countdown to the timer`;
      case 'timer': case 'phaseEnd': case 'phaseWait': return `${round}${F().phases[st.phaseIdx]?.name || 'Timer'}`;
      case 'doneAnim': case 'done': return `${round}Round complete`;
      case 'scoreWait': return `${round}Waiting for scores: ${r.team[st.score.idx]?.name || ''}`;
      case 'scoring': return `${round}Showing the scores of ${r.team[st.score.idx]?.name || ''}`;
      case 'scoreShown': return `${round}Score shown: ${r.team[st.score.idx]?.name || ''}`;
      case 'stageEnd': return `${stage}Stage complete`;
      case 'ranking': return `${stage}Showing the ranking…`;
      case 'rankingShown': return `${stage}Ranking on screen`;
      case 'final': return 'Final screen';
      case 'wTitle': return 'Winners · Title';
      case 'wTease': return `Winners · Award ${st.win.i + 1} of ${st.win.list.length}: ${st.win.list[st.win.i].title} (winner hidden)`;
      case 'wRevealing': return `Winners · Revealing ${st.win.list[st.win.i].title}…`;
      case 'wShown': { const a = st.win.list[st.win.i]; return `Winners · ${a.title}: ${awardName(a)}`; }
      case 'wFinale': return 'Winners · All the winners together';
      case 'message': return 'Message on screen';
      default: return m || '';
    }
  }

  function status() {
    const scr = $('#screens .scr.on');
    const pr = scr ? scr.querySelector('.prompt') : null;
    const r = st.round, tm = st.tm, p = st.f ? F().phases[st.phaseIdx] : null;
    return {
      mode: st.mode, busy: st.busy, label: describe(),
      prompt: pr ? pr.textContent.replace(/\s+/g, ' ').trim() : '',
      stageIdx: st.stageIdx, revealed: st.revealed, info: st.info,
      win: st.win && /^w[A-Z]/.test(st.mode || '') ? { i: st.win.i, n: st.win.list.length, ids: st.win.list.map(a => a.id) } : null,
      round: r ? { num: r.num, team: r.team.map(c => `#${c.num} ${c.name}`), tickets: r.tickets.map(t => `#${t.num}${t.title ? ' ' + t.title : ''}`), committed: r.committed } : null,
      timer: tm && p ? { name: p.name, color: p.color, remain: Math.max(0, Math.round(tm.paused ? tm.remain : tm.end - performance.now())), total: tm.total, paused: tm.paused } : null,
      fullscreen: !!document.fullscreenElement,
      score: ['scoreWait', 'scoring', 'scoreShown'].includes(st.mode) && r ? {
        idx: st.score.idx, total: r.team.length, id: r.team[st.score.idx].id,
        name: r.team[st.score.idx].name, num: r.team[st.score.idx].num, role: roleOf(st.score.idx),
        judges: E().judges, max: F().scoreMax, decimals: F().avgDecimals,
        scores: st.score.scores, avg: st.score.avg,
      } : null,
    };
  }

  return { init, open, close, command, status };
})();
