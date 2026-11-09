'use strict';

const SOUND_NAMES = ['tick', 'softTick', 'lock', 'whoosh', 'rise', 'magic', 'boom', 'chime', 'fanfare', 'start', 'beep', 'gong', 'drumroll', 'firework'];
const KEY_IGNORE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'F5', 'F11', 'F12', 'ContextMenu', 'NumLock', 'AltGraph', 'OS', 'Escape']);
const OPENING_MODES = ['standby', 'evTitle', 'structure', 'stageInfo', 'closing'];
const WINNER_MODES = ['wTitle', 'wTease', 'wRevealing', 'wShown', 'wFinale'];

/* ============================ Audience window ============================ */
const Audience = {
  boot() {
    document.body.classList.add('audience');
    document.title = `Audience screen · ${S.event.title}`;
    // Sound plays in the presenter window: the browser only allows audio in a window that has been clicked.
    SOUND_NAMES.forEach(n => { Sound[n] = (...args) => Link.send('sound', { name: n, args }); });

    Link.on(async m => {
      if (m.type === 'cmd') {
        if (m.reload) await Admin.loadData();
        Contest.command(m);
      } else if (m.type === 'hello') {
        Link.send('status', { status: Contest.status() });
      }
    });
    Contest.open({ remote: true, start: 'standby' });

    let last = '', lastAt = 0;
    setInterval(() => {
      const s = JSON.stringify(Contest.status());
      if (s !== last || Date.now() - lastAt > 1000) {
        last = s; lastAt = Date.now();
        Link.send('status', { status: JSON.parse(s) });
      }
    }, 200);
    Link.send('hello');

    const hint = byId('fsHint');
    const update = () => { hint.hidden = !!document.fullscreenElement; };
    document.addEventListener('fullscreenchange', update);
    update();
    hint.addEventListener('pointerdown', e => {
      e.stopPropagation();
      document.documentElement.requestFullscreen().catch(() => {});
    });
  },
};

/* ============================ Start dialog ============================ */
const LaunchDialog = {
  init() {
    byId('sdTwo').onclick = () => this.two();
    byId('sdOne').onclick = () => this.one();
    byId('sdCancel').onclick = () => this.close();
    byId('sdEdit').onclick = () => { this.close(); Admin.tab('structure'); };
    byId('startDlg').addEventListener('pointerdown', e => { if (e.target.id === 'startDlg') this.close(); });
    document.addEventListener('keydown', e => { if (!byId('startDlg').hidden && e.key === 'Escape') this.close(); });
  },

  open() {
    const e = S.event;
    byId('sdTitle').textContent = e.title || 'Contest';
    byId('sdStages').innerHTML = e.stages.map((s, i) => `
      <div class="sd-stage">
        <span class="sd-num">${i + 1}</span>
        <span class="sd-icon">${esc(s.icon)}</span>
        <div><b>${esc(s.name)}</b><div class="muted small">${esc(stageFormatName(s))}${stageFacts(s).length ? ' · ' + esc(stageFacts(s).slice(1).join(' · ')) : ''}</div></div>
      </div>`).join('');
    byId('sdFrom').innerHTML = `<option value="opening">the opening (title and structure)</option>`
      + e.stages.map((s, i) => `<option value="${i}">Stage ${i + 1}: ${esc(s.name)}</option>`).join('')
      + '<option value="winners">the winners ceremony</option>';
    const warns = [];
    const running = e.stages.filter(s => stageFormat(s));
    if (running.length && !S.contesters.length) warns.push('No contesters are registered yet. The opening works, but stages with draws need contesters.');
    e.stages.forEach((s, i) => {
      if (s.formatId && !stageFormat(s)) warns.push(`Stage ${i + 1} uses a template that no longer exists. Choose another in the Structure tab.`);
      const f = stageFormat(s);
      if (f && f.ticketCount > 0 && !stageDeck(s).length) warns.push(`Stage ${i + 1} draws tickets, but it has no tickets.`);
    });
    byId('sdWarn').innerHTML = warns.map(x => `<div class="warn">⚠ ${esc(x)}</div>`).join('');
    byId('startDlg').hidden = false;
    byId('sdTwo').focus();
  },

  close() { byId('startDlg').hidden = true; },

  two() {
    this.close();
    Console.open();
    Console.openAudience();
  },

  one() {
    const from = byId('sdFrom').value;
    this.close();
    Contest.open(from === 'opening' ? { start: 'opening' } : from === 'winners' ? { start: 'winners' } : { start: 'stage', stage: +from });
  },
};

/* ============================ Presenter console ============================ */
const Console = {
  status: null,
  pending: null,
  lastSeen: 0,
  cache: {},

  init() {
    Link.on(m => this.onMessage(m));
    byId('csOpen').onclick = () => this.openAudience();
    byId('csExit').onclick = () => this.close();
    byId('csSound').onclick = () => {
      S.settings.sound = !S.settings.sound;
      Sound.setEnabled(S.settings.sound);
      saveSettings();
      this.render();
    };
    byId('csNext').onclick = () => this.next();
    byId('csBody').addEventListener('click', e => {
      const b = e.target.closest('[data-cmd]');
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.cmd === 'runStage') return this.runStage(+d.i);
      if (d.cmd === 'resetStage') return this.resetStage();
      if (d.cmd === 'winners' || d.cmd === 'winnerAt') return this.cmd(d.cmd, { reload: true, ...(d.i !== undefined ? { i: +d.i } : {}) });
      this.cmd(d.cmd, d.i !== undefined ? { i: +d.i } : d.k !== undefined ? { k: d.k } : {});
    });
    const body = byId('csBody');
    body.addEventListener('input', e => { if (e.target.closest('#csScore')) this.updateAvg(); });
    body.addEventListener('click', e => { if (e.target.id === 'csScoreGo') this.sendScores(); });
    body.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.closest('#csScore input')) return;
      e.preventDefault();
      const ins = $$('#csScore input'), k = ins.indexOf(e.target);
      if (k < ins.length - 1) ins[k + 1].focus(); else this.sendScores();
    });
    document.addEventListener('keydown', e => this.onKey(e), true);
    setInterval(() => { if (this.isOpen()) this.render(); }, 1000);
  },

  isOpen() { return !byId('console').hidden; },

  open() {
    Sound.unlock();
    Sound.setEnabled(S.settings.sound);
    byId('console').hidden = false;
    document.body.classList.add('consoling');
    Link.send('hello');
    this.cache = {};
    this.render();
  },

  close() {
    byId('console').hidden = true;
    document.body.classList.remove('consoling');
    Admin.refreshAll();
  },

  connected() { return Date.now() - this.lastSeen < 3500; },

  async openAudience() {
    const p = Link.peer;
    if (p && this.connected()) { p.focus(); toast('The audience screen is already open'); return; }
    let feat = 'popup,width=1280,height=720,left=60,top=60';
    try {
      let state = 'prompt';
      try { state = (await navigator.permissions.query({ name: 'window-management' })).state; } catch (e) { /* older browser */ }
      if ('getScreenDetails' in window && state !== 'denied') {
        const sd = await Promise.race([window.getScreenDetails(), wait(8000).then(() => { throw new Error('timeout'); })]);
        const other = sd.screens.find(s => s !== sd.currentScreen && !s.isPrimary) || sd.screens.find(s => s !== sd.currentScreen);
        if (other) feat = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
      }
    } catch (e) { /* permission refused: open a normal window */ }
    const w = window.open('index.html#audience', 'contest-audience', feat);
    if (!w) return toast('The browser blocked the audience window. Click "Open audience screen" again, and allow pop-ups if asked.', 'error');
    Link.setPeer(w);
    toast('Move the audience window to the projector if needed, then click it once to go fullscreen.');
  },

  cmd(cmd, data = {}) {
    if (!this.connected()) return toast('The audience screen is not open. Click "Open audience screen".', 'error');
    Link.send('cmd', { cmd, ...data });
  },

  next() {
    const s = this.status;
    if (!s) return this.cmd('key', { key: 'click' });
    if (s.mode === 'standby') return this.cmd('opening', { reload: true });
    this.cmd('key', { key: 'click' });
  },

  runStage(i) {
    this.cmd('runStage', { i, reload: true });
  },

  resetStage() {
    const st = this.currentStage();
    if (!st) return;
    if (!confirm(`Mark everyone as waiting again for "${st.name}"?`)) return;
    this.cmd('resetStage', { i: stageIndex(st.id) });
  },

  currentStage() {
    const s = this.status;
    if (s && s.stageIdx >= 0) return S.event.stages[s.stageIdx];
    return curStage();
  },

  onKey(e) {
    if (!this.isOpen() || !byId('startDlg').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (KEY_IGNORE.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (this.status && this.status.mode === 'standby') return this.next();
    this.cmd('key', { key: e.key });
  },

  onMessage(m) {
    if (m.type === 'status') {
      this.status = m.status;
      this.lastSeen = Date.now();
      if (this.pending) { const p = this.pending; this.pending = null; Link.send('cmd', p); }
      if (this.isOpen()) this.render();
    } else if (m.type === 'sound') {
      const f = Sound[m.name];
      if (f) f.apply(Sound, m.args || []);
    } else if (m.type === 'saved') {
      Admin.reloadRuntime().then(() => {
        if (!this.isOpen()) return;
        this.cache = { scoreKey: this.cache.scoreKey };  // keep typed scores
        this.render();
      });
    } else if (m.type === 'hello') {
      this.lastSeen = Date.now();
    }
  },

  /** Score entry for the person on the audience screen. Rebuilt only when the person or step changes. */
  renderScore(s) {
    const sc = s && this.connected() ? s.score : null, box = byId('csScore');
    box.hidden = !sc;
    if (!sc) { this.cache.scoreKey = null; return; }
    const key = `${s.round ? s.round.num : 0}-${sc.idx}-${s.mode}`;
    if (this.cache.scoreKey === key) return;
    this.cache.scoreKey = key;
    const c = S.contesters.find(x => x.id === sc.id) || { name: sc.name, num: sc.num };
    const edit = s.mode === 'scoreWait';
    const val = k => (!edit && sc.scores ? sc.scores[k] : '');
    box.innerHTML = `
      <div class="cs-score-head">
        <img src="${esc(avatarFor(c))}" alt="">
        <div>
          <div class="muted small">${sc.total > 1 ? `${esc(sc.role)} · person ${sc.idx + 1} of ${sc.total}` : 'Scores'}</div>
          <b>#${sc.num} ${esc(sc.name)}</b>
        </div>
      </div>
      <div class="cs-score-inputs">${sc.judges.map((j, k) => `
        <label>${esc(j || `Judge ${k + 1}`)}
          <input type="number" min="0" max="${sc.max}" step="any" data-j="${k}" value="${val(k)}" placeholder="0 – ${sc.max}" ${edit ? '' : 'disabled'}>
        </label>`).join('')}
      </div>
      <div class="cs-score-foot">
        <span class="cs-avg" id="csAvg"></span>
        ${edit ? '<button class="btn btn-gold btn-lg" id="csScoreGo" disabled>✦ Show the score</button>'
               : `<span class="muted">${s.mode === 'scoring' ? 'Showing on the audience screen…' : 'Shown. Press Next to continue.'}</span>`}
      </div>`;
    this.updateAvg(sc);
    if (edit) { const first = $('#csScore input'); if (first) first.focus(); }
  },

  /** Check the typed scores and preview the average. */
  readScores() {
    const sc = this.status && this.status.score;
    if (!sc) return null;
    const vals = $$('#csScore input').map(x => x.value.trim());
    const ok = vals.length && vals.every(v => v !== '' && !isNaN(+v) && +v >= 0 && +v <= sc.max);
    return { sc, vals, ok };
  },

  updateAvg() {
    const r = this.readScores();
    if (!r) return;
    const { sc, vals, ok } = r;
    const go = byId('csScoreGo');
    if (go) go.disabled = !ok;
    const avg = ok ? vals.reduce((a, b) => a + +b, 0) / vals.length : null;
    byId('csAvg').innerHTML = ok
      ? `Average <b>${avg.toFixed(sc.decimals)}</b>`
      : `<span class="muted">Enter a score from 0 to ${sc.max} for every judge</span>`;
  },

  sendScores() {
    const r = this.readScores();
    if (!r || !r.ok || this.status.mode !== 'scoreWait') return;
    this.cmd('showScore', { scores: r.vals.map(Number) });
    const go = byId('csScoreGo');
    if (go) go.disabled = true;
  },

  /** Only touch the DOM when something changed, so buttons stay clickable. */
  set(id, html) {
    if (this.cache[id] === html) return;
    this.cache[id] = html;
    byId(id).innerHTML = html;
  },

  render() {
    const s = this.status, on = this.connected(), e = S.event;
    byId('csTitle').textContent = e.title || 'Contest';
    byId('csSound').textContent = S.settings.sound ? '🔊 Sound on' : '🔇 Sound off';
    this.set('csConn', on
      ? `<span class="dot ok"></span> Audience screen connected${s && !s.fullscreen ? ' <span class="badge chg">not fullscreen: click once on the audience screen</span>' : ''}`
      : '<span class="dot"></span> Audience screen is not open');
    byId('csOpen').textContent = on ? '🖥 Show audience window' : '🖥 Open audience screen';

    const mode = s ? s.mode : null;
    const opening = OPENING_MODES.includes(mode);
    const slide = (cmd, label, active, i) =>
      `<button class="cs-item ${active ? 'cur' : ''}" data-cmd="${cmd}"${i !== undefined ? ` data-i="${i}"` : ''} ${on ? '' : 'disabled'}>${label}</button>`;
    let slides = slide('opening', '✦ Contest title', mode === 'evTitle')
      + slide('structure', `🗺 ${esc(e.structureTitle || 'Structure')}${mode === 'structure' ? ` <small>${s.revealed}/${e.stages.length} shown</small>` : ''}`, mode === 'structure');
    if (e.detailSlides) e.stages.forEach((st, i) => { slides += slide('info', `${esc(st.icon)} ${i + 1}. ${esc(st.name)}`, mode === 'stageInfo' && s.info === i, i); });
    slides += slide('closing', `🚀 ${esc(e.closingTitle || 'Begin')}`, mode === 'closing');
    this.set('csSlides', slides);

    const win = s && s.win, inWin = WINNER_MODES.includes(mode);
    const order = winnersOrder();
    let wl = slide('winners', `👑 ${esc(S.winners.title || 'The Winners')}`, mode === 'wTitle');
    order.forEach((a, i) => {
      const cur = inWin && win && win.i === i && mode !== 'wFinale';
      wl += slide('winnerAt', `${MEDALS[a.medal].icon} ${esc(a.title)} <small>${esc(awardName(a))}${cur ? (mode === 'wTease' ? ' · hidden' : ' · shown') : ''}</small>`, cur, i);
    });
    if (order.length) wl += slide('winnerAt', '🎉 All the winners', mode === 'wFinale', order.length);
    else wl += '<div class="muted small">No winners yet. Add them in the Winners tab.</div>';
    this.set('csWinners', wl);

    this.set('csStages', e.stages.map((st, i) => {
      const done = S.contesters.filter(c => isDone(c, st.id)).length, f = stageFormat(st);
      const cur = s && !opening && s.stageIdx === i;
      return `<div class="cs-stage ${cur ? 'cur' : ''}">
        <div class="cs-stage-top"><span class="ph-idx">${i + 1}</span><b>${esc(st.icon)} ${esc(st.name)}</b></div>
        <div class="muted small">${esc(stageFormatName(st))}${f ? ` · ${done}/${S.contesters.length} presented` : ''}</div>
        <button class="btn btn-sm ${cur ? '' : 'btn-primary'}" data-cmd="runStage" data-i="${i}" ${on ? '' : 'disabled'}>${cur ? '↺ Restart stage title' : '▶ Start this stage'}</button>
      </div>`;
    }).join(''));

    byId('csNow').textContent = !on ? 'Nothing: the audience screen is not open' : s ? s.label : 'Connecting…';
    byId('csPrompt').textContent = on && s && s.prompt ? `On screen: “${s.prompt}”` : '';

    const busy = !s || s.busy || ['timer', 'message', 'final', 'stopping', 'scoreWait', 'scoring'].includes(mode);
    const nb = byId('csNext');
    nb.disabled = !on || busy;
    let nextLabel = 'Next';
    if (mode === 'standby') nextLabel = 'Start the opening';
    else if (mode === 'roll' || mode === 'ticketRoll') nextLabel = 'Stop the draw';
    else if (mode === 'timer') nextLabel = 'Timer running';
    else if (mode === 'scoreWait') nextLabel = 'Enter the scores above';
    else if (mode === 'scoring') nextLabel = 'Showing the scores…';
    else if (mode === 'wTease') nextLabel = '✦ Reveal the winner';
    else if (mode === 'wShown') nextLabel = win && win.i + 1 >= win.n ? 'Show all the winners' : 'Next award';
    else if (mode === 'wFinale' && !(s && s.busy)) nextLabel = '🎆 More fireworks';
    else if (s && s.busy) nextLabel = 'Animating…';
    nb.querySelector('b').textContent = nextLabel;

    const tm = s && s.timer;
    byId('csTimer').hidden = !tm;
    if (tm) {
      byId('csPhase').textContent = tm.name + (tm.paused ? ' · paused' : '');
      byId('csPhase').style.color = tm.color;
      byId('csTime').textContent = fmtTime(tm.remain);
      byId('csBar').style.width = `${Math.max(0, Math.min(100, (tm.remain / tm.total) * 100))}%`;
      byId('csBar').style.background = tm.color;
    }

    this.renderScore(s);

    const r = s && !opening ? s.round : null;
    this.set('csRound', r ? `<div><span class="muted">Round ${r.num}:</span> ${r.team.map(esc).join(' &amp; ') || '—'}</div>
      ${r.tickets.length ? `<div><span class="muted">Tickets:</span> ${r.tickets.map(esc).join(', ')}</div>` : ''}` : '');
    byId('csRedo').disabled = !on || !(r && r.team.length);
    byId('csEndRound').disabled = !on || !(r && r.committed);
    byId('csEndStage').disabled = !on || opening || !s || s.stageIdx < 0;

    let notes = e.notes, notesFor = 'the opening';
    if (mode === 'stageInfo' && e.stages[s.info]) { notes = e.stages[s.info].notes; notesFor = e.stages[s.info].name; }
    else if (s && !opening && e.stages[s.stageIdx]) { notes = e.stages[s.stageIdx].notes; notesFor = e.stages[s.stageIdx].name; }
    this.set('csNotes', `<div class="muted small">Notes for ${esc(notesFor)}</div>${notes ? `<div class="cs-notes-text">${esc(notes)}</div>` : '<div class="muted">No notes. Add them in the Structure tab.</div>'}`);

    const st = this.currentStage(), f = stageFormat(st);
    const done = S.contesters.filter(c => isDone(c, st.id)).length;
    this.set('csPeople', f
      ? `<div><b>${S.contesters.length - done}</b> waiting · <b>${done}</b> presented <span class="muted">in ${esc(st.name)}</span></div>
         <button class="btn btn-sm" data-cmd="resetStage" ${on ? '' : 'disabled'}>↺ Mark everyone as waiting</button>`
      : `<div class="muted">${esc(st.name)} has no draws.</div>`);
  },
};
