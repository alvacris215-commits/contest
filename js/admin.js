'use strict';

/** Settings for this computer's stage. Everything about how a round works lives in the format (format.js). */
const DEFAULT_SETTINGS = {
  sound: true,
  revealDelay: 1000,
  autoFullscreen: true,
};

/** In-memory state (mirrored to IndexedDB). */
const S = { contesters: [], tickets: [], settings: { ...DEFAULT_SETTINGS }, format: null, templates: [], history: [], event: null, activeStage: '' };

/** Contesters who have not presented yet in the active stage. */
const waiting = () => S.contesters.filter(c => !isDone(c));
const saveEvent = () => DB.set('event', S.event);
const saveActiveStage = () => DB.set('activeStage', S.activeStage);
const saveSettings = () => DB.set('settings', S.settings);
const saveFormat = () => DB.set('format', S.format);
const saveTemplates = () => DB.set('templates', S.templates);
const pickSettings = (o = {}) => Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k => [k, o[k] ?? DEFAULT_SETTINGS[k]]));
const sortAll = () => {
  S.contesters.sort((a, b) => a.num - b.num);
  S.tickets.sort((a, b) => a.num - b.num);
};

/** Shared renderer for tickets — used in the dashboard preview and on stage. */
function ticketHTML(t) {
  const hasImg = t.type !== 'text' && !!t.image;
  const hasText = t.type !== 'image' && !!(t.text && t.text.trim());
  const cls = ['tc', 'tc-' + (t.size || 'l'), hasImg ? 'has-img' : '', hasText ? 'has-text' : '', (!hasImg && !hasText) ? 'empty' : ''].join(' ');
  return `<div class="${cls}" style="--tc-bg:${esc(t.bg || '#140f33')};--tc-fg:${esc(t.fg || '#ffffff')};--tc-align:${esc(t.align || 'center')}">
    ${t.title ? `<div class="tc-title">${esc(t.title)}</div>` : ''}
    ${hasImg ? `<div class="tc-img"><img src="${esc(t.image)}" alt=""></div>` : ''}
    ${hasText ? `<div class="tc-text">${esc(t.text)}</div>` : ''}
    ${(!hasImg && !hasText && !t.title) ? `<div class="tc-text tc-placeholder">Ticket #${esc(t.num ?? '')}</div>` : ''}
  </div>`;
}

/* ============================ Contesters ============================ */
const ContestersUI = {
  editing: null,
  photo: '',

  init() {
    const drop = byId('cPhotoDrop'), input = byId('cPhoto');
    drop.onclick = () => input.click();
    input.onchange = () => { if (input.files[0]) this.setPhoto(input.files[0]); input.value = ''; };
    dropZone(drop, files => this.setPhoto(files[0]));
    byId('cSave').onclick = () => this.save();
    byId('cCancel').onclick = () => this.resetForm();
    byId('cRemovePhoto').onclick = () => { this.photo = ''; this.showPhoto(); };
    byId('cName').onkeydown = e => { if (e.key === 'Enter') this.save(); };
    byId('cNum').onkeydown = e => { if (e.key === 'Enter') this.save(); };
    byId('cBulkBtn').onclick = () => byId('cBulk').click();
    byId('cBulk').onchange = async e => { await this.bulk([...e.target.files]); e.target.value = ''; };
    byId('cSearch').oninput = () => this.render();
    byId('cResetPool').onclick = async () => {
      if (!confirm(`Mark every contester as "waiting" in ${curStage().name}, so they can be drawn again?`)) return;
      S.contesters.forEach(c => setDone(c, false));
      await DB.putMany('contesters', S.contesters);
      this.render(); Admin.header();
      toast('Everyone is waiting again');
    };
    byId('cStage').onchange = async e => {
      S.activeStage = e.target.value;
      await saveActiveStage();
      this.render(); Admin.header();
      TicketsUI.renderStageOptions();
    };
    this.renderStageSelect();
    byId('cGrid').onclick = e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      this[b.dataset.act](id);
    };
    this.resetForm();
    this.render();
  },

  nextNum() { return S.contesters.reduce((m, c) => Math.max(m, c.num), 0) + 1; },

  async setPhoto(file) {
    if (!file.type.startsWith('image/')) return toast('Please choose an image file', 'error');
    try {
      this.photo = await fileToDataURL(file, 720, 0.88);
      this.showPhoto();
    } catch (e) { toast(e.message, 'error'); }
  },

  showPhoto() {
    byId('cPhotoPreview').src = this.photo || '';
    byId('cPhotoDrop').classList.toggle('has', !!this.photo);
  },

  resetForm() {
    this.editing = null;
    this.photo = '';
    this.showPhoto();
    byId('cNum').value = this.nextNum();
    byId('cName').value = '';
    byId('cFormTitle').textContent = 'Register a contester';
    byId('cSave').textContent = 'Add contester';
    byId('cCancel').hidden = true;
  },

  async save() {
    const num = parseInt(byId('cNum').value, 10);
    const name = byId('cName').value.trim();
    if (!name) { byId('cName').focus(); return toast('Please enter a name', 'error'); }
    if (!(num > 0)) return toast('The ID must be a positive number', 'error');
    if (S.contesters.some(c => c.num === num && c.id !== this.editing)) return toast(`ID ${num} is already taken`, 'error');

    let c;
    if (this.editing) c = S.contesters.find(x => x.id === this.editing);
    else { c = { id: uid(), done: {}, created: Date.now() }; S.contesters.push(c); }
    Object.assign(c, { num, name, photo: this.photo || '' });
    try { await DB.put('contesters', c); }
    catch (e) { return toast('Could not save: ' + e.message, 'error'); }
    toast(this.editing ? 'Contester updated' : `${name} registered as #${num}`);
    sortAll();
    this.resetForm();
    this.render(); Admin.header();
    byId('cName').focus();
  },

  edit(id) {
    const c = S.contesters.find(x => x.id === id);
    if (!c) return;
    this.editing = id;
    this.photo = c.photo || '';
    this.showPhoto();
    byId('cNum').value = c.num;
    byId('cName').value = c.name;
    byId('cFormTitle').textContent = `Edit contester #${c.num}`;
    byId('cSave').textContent = 'Save changes';
    byId('cCancel').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    byId('cName').focus();
  },

  async toggle(id) {
    const c = S.contesters.find(x => x.id === id);
    setDone(c, !isDone(c));
    await DB.put('contesters', c);
    this.render(); Admin.header();
  },

  async del(id) {
    const c = S.contesters.find(x => x.id === id);
    if (!confirm(`Delete contester #${c.num} ${c.name}?`)) return;
    await DB.del('contesters', id);
    S.contesters = S.contesters.filter(x => x.id !== id);
    if (this.editing === id) this.resetForm();
    this.render(); Admin.header();
  },

  view(id) {
    const c = S.contesters.find(x => x.id === id);
    Viewer.open(`<div class="viewer-person"><img src="${esc(avatarFor(c))}" alt=""><h2>#${c.num} · ${esc(c.name)}</h2></div>`);
  },

  async bulk(files) {
    if (!files.length) return;
    let n = this.nextNum(), added = 0;
    for (const f of files) {
      try {
        const c = { id: uid(), num: n++, name: nameFromFile(f) || `Contester ${n - 1}`, photo: await fileToDataURL(f, 720, 0.88), done: {}, created: Date.now() };
        await DB.put('contesters', c);
        S.contesters.push(c);
        added++;
      } catch (e) { console.error(e); }
    }
    sortAll();
    this.resetForm();
    this.render(); Admin.header();
    toast(`Added ${added} contester${added === 1 ? '' : 's'}. Click ✎ to fix any names.`);
  },

  renderStageSelect() {
    byId('cStage').innerHTML = S.event.stages.map((s, i) =>
      `<option value="${s.id}"${s.id === curStage().id ? ' selected' : ''}>${i + 1}. ${esc(s.name)}</option>`).join('');
  },

  render() {
    const q = byId('cSearch').value.trim().toLowerCase();
    const list = S.contesters.filter(c => !q || c.name.toLowerCase().includes(q) || String(c.num).includes(q));
    const w = waiting().length;
    byId('cCount').textContent = `(${S.contesters.length} total · ${w} waiting)`;
    const grid = byId('cGrid');
    if (!S.contesters.length) {
      grid.innerHTML = '<div class="empty-state">No contesters yet. Register the first one above.</div>';
      return;
    }
    grid.innerHTML = list.map(c => `
      <div class="card c-card ${isDone(c) ? 'is-done' : ''}" data-id="${c.id}">
        <div class="c-photo" data-act="view"><img src="${esc(avatarFor(c))}" alt="" loading="lazy"></div>
        <div class="c-body">
          <div class="c-num">#${c.num}</div>
          <div class="c-name" title="${esc(c.name)}">${esc(c.name)}</div>
          <span class="badge ${isDone(c) ? 'done' : 'wait'}">${isDone(c) ? '✓ Presented' : '● Waiting'}</span>
        </div>
        <div class="card-actions">
          <button data-act="edit" title="Edit">✎</button>
          <button data-act="toggle" title="${isDone(c) ? 'Mark as waiting' : 'Mark as presented'}">${isDone(c) ? '↺' : '✓'}</button>
          <button data-act="del" title="Delete" class="del">🗑</button>
        </div>
      </div>`).join('') || '<div class="empty-state">No match.</div>';
  },
};

/* ============================ Tickets ============================ */
const TicketsUI = {
  editing: null,
  image: '',

  init() {
    const drop = byId('tImageDrop'), input = byId('tImage');
    drop.onclick = () => input.click();
    input.onchange = () => { if (input.files[0]) this.setImage(input.files[0]); input.value = ''; };
    dropZone(drop, files => this.setImage(files[0]));
    byId('tRemoveImg').onclick = () => { this.image = ''; this.showImage(); };
    byId('tSave').onclick = () => this.save();
    byId('tCancel').onclick = () => this.resetForm();
    ['tNum', 'tTitle', 'tType', 'tText', 'tSize', 'tAlign', 'tFg', 'tBg'].forEach(id => {
      byId(id).addEventListener('input', () => { this.updateFields(); this.preview(); });
    });
    byId('tBulkBtn').onclick = () => byId('tBulk').click();
    byId('tBulk').onchange = async e => { await this.bulk([...e.target.files]); e.target.value = ''; };
    byId('tResetUsed').onclick = async () => {
      const st = curStage();
      if (!confirm(`Mark every ticket as unused in ${st.name}?`)) return;
      S.tickets.forEach(t => setUsed(t, false, st.id));
      await DB.putMany('tickets', S.tickets);
      this.render(); Admin.header();
      toast(`All tickets are back in the deck for ${st.name}`);
    };
    byId('tStageSel').onchange = async e => {
      S.activeStage = e.target.value;
      await saveActiveStage();
      ContestersUI.renderStageSelect(); ContestersUI.render();
      this.render(); Admin.header();
    };
    byId('tCheckAll').onclick = async () => {
      const st = curStage();
      S.tickets.forEach(t => { if (!inStage(t, st.id)) t.stages = [...(t.stages || []), st.id]; });
      await DB.putMany('tickets', S.tickets);
      this.render(); Admin.header();
      toast(`All ${S.tickets.length} tickets are ticked for ${st.name}`);
    };
    byId('tUncheckAll').onclick = async () => {
      const st = curStage();
      if (!confirm(`Untick every ticket for ${st.name}? The stage will then have no tickets to draw.`)) return;
      S.tickets.forEach(t => { t.stages = (t.stages || []).filter(id => id !== st.id); });
      await DB.putMany('tickets', S.tickets);
      this.render(); Admin.header();
    };
    byId('tGrid').onclick = e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      this[b.dataset.act](b.closest('[data-id]').dataset.id, b);
    };
    this.formStages = S.event.stages.map(s => s.id);
    this.renderStageOptions();
    this.resetForm();
    this.render();
  },

  nextNum() { return S.tickets.reduce((m, t) => Math.max(m, t.num), 0) + 1; },

  async setImage(file) {
    if (!file.type.startsWith('image/')) return toast('Please choose an image file', 'error');
    try {
      this.image = await fileToDataURL(file, 2000, 0.9);
      if (byId('tType').value === 'text') byId('tType').value = 'image';
      this.showImage();
    } catch (e) { toast(e.message, 'error'); }
  },

  showImage() {
    byId('tImagePreview').src = this.image || '';
    byId('tImageDrop').classList.toggle('has', !!this.image);
    this.updateFields();
    this.preview();
  },

  form() {
    return {
      num: parseInt(byId('tNum').value, 10),
      title: byId('tTitle').value.trim(),
      type: byId('tType').value,
      text: byId('tText').value,
      size: byId('tSize').value,
      align: byId('tAlign').value,
      fg: byId('tFg').value,
      bg: byId('tBg').value,
      image: this.image,
      stages: this.checkedStages(),
    };
  },

  updateFields() {
    const type = byId('tType').value;
    $$('.t-image-field').forEach(el => { el.hidden = type === 'text'; });
    $$('.t-text-field').forEach(el => { el.hidden = type === 'image'; });
  },

  preview() { byId('tPreview').innerHTML = ticketHTML(this.form()); },

  resetForm() {
    this.editing = null;
    this.image = '';
    byId('tNum').value = this.nextNum();
    byId('tTitle').value = '';
    byId('tText').value = '';
    byId('tType').value = 'image';
    byId('tSize').value = 'l';
    byId('tAlign').value = 'center';
    byId('tFg').value = '#ffffff';
    byId('tBg').value = '#140f33';
    byId('tFormTitle').textContent = 'Create a ticket (problem)';
    byId('tSave').textContent = 'Add ticket';
    byId('tCancel').hidden = true;
    this.showImage();
  },

  async save() {
    const f = this.form();
    if (!(f.num > 0)) return toast('Ticket number must be positive', 'error');
    if (S.tickets.some(t => t.num === f.num && t.id !== this.editing)) return toast(`Ticket #${f.num} already exists`, 'error');
    if (f.type !== 'text' && !f.image && f.type === 'image') return toast('Please add an image, or change the type to text', 'error');
    if (f.type === 'text' && !f.text.trim()) return toast('Please write the ticket text', 'error');
    if (f.type === 'both' && !f.image && !f.text.trim()) return toast('Please add an image or text', 'error');
    if (!f.stages.length) toast('This ticket is not ticked for any stage, so it will never be drawn', 'error');

    let t;
    if (this.editing) t = S.tickets.find(x => x.id === this.editing);
    else { t = { id: uid(), usedIn: {}, created: Date.now() }; S.tickets.push(t); }
    Object.assign(t, f);
    try { await DB.put('tickets', t); }
    catch (e) { return toast('Could not save: ' + e.message, 'error'); }
    toast(this.editing ? 'Ticket updated' : `Ticket #${f.num} added`);
    sortAll();
    this.resetForm();
    this.render(); Admin.header();
  },

  edit(id) {
    const t = S.tickets.find(x => x.id === id);
    this.editing = id;
    this.image = t.image || '';
    byId('tNum').value = t.num;
    byId('tTitle').value = t.title || '';
    byId('tType').value = t.type || 'image';
    byId('tText').value = t.text || '';
    byId('tSize').value = t.size || 'l';
    byId('tAlign').value = t.align || 'center';
    byId('tFg').value = t.fg || '#ffffff';
    byId('tBg').value = t.bg || '#140f33';
    this.formStages = (t.stages || []).slice();
    this.renderStageOptions(false);
    byId('tFormTitle').textContent = `Edit ticket #${t.num}`;
    byId('tSave').textContent = 'Save changes';
    byId('tCancel').hidden = false;
    this.showImage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async toggle(id) {
    const t = S.tickets.find(x => x.id === id);
    setUsed(t, !isUsed(t));
    await DB.put('tickets', t);
    this.render(); Admin.header();
  },

  /** Tick or untick one ticket for one stage (the numbered buttons on each card). */
  async stage(id, btn) {
    const t = S.tickets.find(x => x.id === id), sid = btn.dataset.sid;
    t.stages = inStage(t, sid) ? t.stages.filter(x => x !== sid) : [...(t.stages || []), sid];
    await DB.put('tickets', t);
    this.render(); Admin.header();
  },

  async del(id) {
    const t = S.tickets.find(x => x.id === id);
    if (!confirm(`Delete ticket #${t.num}?`)) return;
    await DB.del('tickets', id);
    S.tickets = S.tickets.filter(x => x.id !== id);
    if (this.editing === id) this.resetForm();
    this.render(); Admin.header();
  },

  view(id) {
    const t = S.tickets.find(x => x.id === id);
    Viewer.open(`<div class="viewer-ticket">${ticketHTML(t)}</div>`);
  },

  async bulk(files) {
    if (!files.length) return;
    let n = this.nextNum(), added = 0;
    for (const f of files) {
      try {
        const t = {
          id: uid(), num: n++, title: '', type: 'image', text: '', size: 'l', align: 'center',
          fg: '#ffffff', bg: '#140f33', image: await fileToDataURL(f, 2000, 0.9), usedIn: {}, created: Date.now(), stages: this.checkedStages(),
        };
        await DB.put('tickets', t);
        S.tickets.push(t);
        added++;
      } catch (e) { console.error(e); }
    }
    sortAll();
    this.resetForm();
    this.render(); Admin.header();
    toast(`Added ${added} ticket${added === 1 ? '' : 's'}`);
  },

  checkedStages() { return $$('#tStages input:checked').map(x => x.value); },

  /** Stage tick boxes in the form and the stage picker above the list (both follow the structure). */
  renderStageOptions(readForm = true) {
    if (readForm && byId('tStages').children.length) this.formStages = this.checkedStages();
    byId('tStages').innerHTML = S.event.stages.map((s, i) => `
      <label class="check"><input type="checkbox" value="${s.id}" ${this.formStages.includes(s.id) ? 'checked' : ''}> ${i + 1}. ${esc(s.icon)} ${esc(s.name)}</label>`).join('');
    byId('tStageSel').innerHTML = S.event.stages.map((s, i) =>
      `<option value="${s.id}"${s.id === curStage().id ? ' selected' : ''}>${i + 1}. ${esc(s.name)}</option>`).join('');
    this.render();
  },

  render() {
    const st = curStage(), deck = stageDeck(st), unused = deck.filter(t => !isUsed(t)).length;
    byId('tCount').textContent = `(${S.tickets.length} total · ${deck.length} in ${st.name} · ${unused} unused there)`;
    const grid = byId('tGrid');
    if (!S.tickets.length) {
      grid.innerHTML = '<div class="empty-state">No tickets yet. Create the first problem above.</div>';
      return;
    }
    const stages = S.event.stages;
    grid.innerHTML = S.tickets.map(t => {
      const here = inStage(t, st.id), used = here && isUsed(t);
      return `
      <div class="card t-card ${used ? 'is-done' : ''} ${here ? '' : 'not-here'}" data-id="${t.id}">
        <div class="t-thumb" data-act="view">${ticketHTML(t)}</div>
        <div class="t-meta">
          <b>#${t.num}</b>
          <span class="t-label">${esc(t.title || (t.type === 'text' ? (t.text || '').slice(0, 40) : 'Image'))}</span>
          ${here ? `<span class="badge ${used ? 'done' : 'wait'}">${used ? 'Used' : 'In deck'}</span>` : '<span class="badge done">Not in this stage</span>'}
        </div>
        <div class="t-stagepills" title="Click a number to tick or untick this ticket for that stage">
          <span class="muted small">Stages</span>
          ${stages.map((s, i) => {
            const on = inStage(t, s.id);
            return `<button data-act="stage" data-sid="${s.id}" class="sp ${on ? 'on' : ''} ${s.id === st.id ? 'cur' : ''}" title="${on ? 'Untick' : 'Tick'} for stage ${i + 1}: ${esc(s.name)}">${on ? '✓' : ''}${i + 1}</button>`;
          }).join('')}
        </div>
        <div class="card-actions">
          <button data-act="edit" title="Edit">✎</button>
          ${here ? `<button data-act="toggle" title="${used ? 'Put back in deck' : 'Mark as used'} in ${esc(st.name)}">${used ? '↺' : '✓'}</button>` : ''}
          <button data-act="del" title="Delete" class="del">🗑</button>
        </div>
      </div>`;
    }).join('');
  },
};

/* ============================ Results ============================ */
/** History entries from older versions stored a/b/ticket instead of team/tickets. */
const histTeam = h => h.team || [h.a, h.b].filter(Boolean);
const histTickets = h => h.tickets || (h.ticket ? [h.ticket] : []);

const ResultsUI = {
  init() {
    byId('hClear').onclick = async () => {
      if (!confirm('Clear the round history? Contester and ticket statuses stay unchanged.')) return;
      S.history = [];
      await DB.set('history', S.history);
      this.render();
      Admin.header();
    };
    byId('hExport').onclick = () => {
      const people = Math.max(1, ...S.history.map(h => histTeam(h).length));
      const judges = Math.max(0, ...S.history.flatMap(h => histTeam(h).map(c => (c.scores || []).length)));
      const tks = Math.max(1, ...S.history.map(h => histTickets(h).length));
      const head = ['Round', 'Stage', 'Format'];
      for (let i = 1; i <= people; i++) {
        head.push(`Person ${i} ID`, `Person ${i}`);
        for (let j = 1; j <= judges; j++) head.push(`Person ${i} judge ${j}`);
        if (judges) head.push(`Person ${i} average`);
      }
      for (let i = 1; i <= tks; i++) head.push(`Ticket ${i}`, `Ticket ${i} title`);
      head.push('Time');
      const rows = [head];
      S.history.forEach(h => {
        const r = [h.round, h.stage || '', h.format || ''];
        const team = histTeam(h), tickets = histTickets(h);
        for (let i = 0; i < people; i++) {
          r.push(team[i]?.num ?? '', team[i]?.name ?? '');
          for (let j = 0; j < judges; j++) r.push(team[i]?.scores?.[j] ?? '');
          if (judges) r.push(team[i]?.avg != null ? +team[i].avg.toFixed(3) : '');
        }
        for (let i = 0; i < tks; i++) r.push(tickets[i]?.num ?? '', tickets[i]?.title ?? '');
        r.push(new Date(h.at).toLocaleString());
        rows.push(r);
      });
      const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      download(`contest-rounds-${today()}.csv`, '\ufeff' + csv, 'text/csv');
    };
    this.render();
  },
  render() {
    byId('hCount').textContent = `(${S.history.length})`;
    byId('hBody').innerHTML = S.history.slice().reverse().map(h => {
      const team = histTeam(h).map(c => `<span class="who">#${c.num} ${esc(c.name)}${c.avg != null
        ? ` <b class="score" title="${esc((c.scores || []).join(' · '))}">${c.avg.toFixed(2)}</b>` : ''}</span>`).join('');
      const tickets = histTickets(h).map(t => `<span class="who">#${t.num}${t.title ? ' ' + esc(t.title) : ''}</span>`).join('');
      return `<tr>
        <td><b>${h.round}</b></td>
        <td>${team || '<span class="muted">—</span>'}</td>
        <td>${tickets || '<span class="muted">—</span>'}</td>
        <td class="muted">${esc(h.stage || h.format || '')}</td>
        <td class="muted">${new Date(h.at).toLocaleString()}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted center">No rounds yet</td></tr>';
    this.renderRanking();
  },

  /** Each stage's people sorted by their average score. */
  renderRanking() {
    const stages = new Map();
    S.history.forEach(h => { if (!stages.has(h.stageId || '')) stages.set(h.stageId || '', h.stage || 'Scores'); });
    const medal = r => ['🥇', '🥈', '🥉'][r - 1] || `${r}.`;
    byId('hRank').innerHTML = [...stages].map(([id, name]) => {
      const list = stageRanking(id);
      if (!list.length) return '';
      return `<div class="panel rank-panel">
        <h2>🏅 Ranking · ${esc(name)}</h2>
        <ol class="rank">${list.map(p => `<li><span class="rk">${medal(p.rank)}</span><span class="rn">#${p.num} ${esc(p.name)}</span><b>${p.avg.toFixed(2)}</b></li>`).join('')}</ol>
      </div>`;
    }).join('');
  },
};

/* ============================ Settings ============================ */
const SettingsUI = {
  init() {
    $$('[data-setting]').forEach(el => {
      const k = el.dataset.setting;
      const handler = () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') { v = parseFloat(el.value); if (isNaN(v)) return; }
        else v = el.value;
        S.settings[k] = v;
        saveSettings();
        if (k === 'sound') Sound.setEnabled(v);
      };
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', debounce(handler, el.type === 'checkbox' ? 0 : 300));
    });
    this.load();

    byId('bExport').onclick = () => {
      const data = {
        app: 'contest-manager', version: 2, exported: new Date().toISOString(),
        contesters: S.contesters, tickets: S.tickets, settings: S.settings,
        format: S.format, templates: S.templates, history: S.history,
        event: S.event, activeStage: S.activeStage,
      };
      download(`contest-backup-${today()}.json`, JSON.stringify(data), 'application/json');
    };
    byId('bImportBtn').onclick = () => byId('bImport').click();
    byId('bImport').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!Array.isArray(data.contesters) || !Array.isArray(data.tickets)) throw new Error('This is not a contest backup file');
        if (!confirm(`Import ${data.contesters.length} contesters and ${data.tickets.length} tickets?\nThis REPLACES all current data.`)) return;
        await DB.clear('contesters'); await DB.clear('tickets');
        await DB.putMany('contesters', data.contesters);
        await DB.putMany('tickets', data.tickets);
        await Promise.all([
          DB.set('settings', data.settings || {}),
          data.format ? DB.set('format', data.format) : DB.set('format', migrateFormat(data.settings || {}, data.phases)),
          DB.set('templates', Array.isArray(data.templates) ? data.templates : []),
          DB.set('history', Array.isArray(data.history) ? data.history : []),
          DB.set('event', data.event || null),
          DB.set('activeStage', data.activeStage || ''),
        ]);
        await Admin.loadData();
        this.load(); FormatUI.load(); StructureUI.load(); Admin.refreshAll();
        ContestersUI.resetForm(); TicketsUI.resetForm();
        toast('Backup imported');
      } catch (err) { toast('Import failed: ' + err.message, 'error'); }
    };
    byId('bResetAll').onclick = async () => {
      if (!confirm('Start a new session?\n• all contesters → waiting, in every stage\n• all tickets → unused\n• round history cleared\n\nContesters, tickets, the structure and settings are kept.')) return;
      await Admin.resetStatuses({ allStages: true, clearHistory: true });
      toast('New session ready');
    };
    byId('bErase').onclick = async () => {
      if (!confirm('Erase ALL contesters, tickets, the structure, formats, templates, settings and history? This cannot be undone.')) return;
      if (!confirm('Are you really sure? Consider exporting a backup first.')) return;
      await Promise.all(['contesters', 'tickets', 'kv'].map(s => DB.clear(s)));
      location.reload();
    };
    this.storageInfo();
  },

  load() {
    $$('[data-setting]').forEach(el => {
      const v = S.settings[el.dataset.setting];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    });
  },

  async storageInfo() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      byId('storageInfo').textContent = `Storage used: ${(usage / 1048576).toFixed(1)} MB of ${(quota / 1073741824).toFixed(1)} GB available${persisted ? ' · protected from automatic cleanup' : ''}.`;
    } catch (e) { /* ignore */ }
  },
};

/* ============================ Viewer ============================ */
const Viewer = {
  open(html) {
    byId('viewerBox').innerHTML = html;
    byId('viewer').hidden = false;
  },
  close() { byId('viewer').hidden = true; byId('viewerBox').innerHTML = ''; },
};

/* ============================ App ============================ */
const Admin = {
  async boot() {
    try {
      await DB.open();
    } catch (e) {
      document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:sans-serif">Storage is not available in this browser (${esc(e.message)}). Please open this file in Google Chrome or Microsoft Edge.</div>`;
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    await this.loadData();

    this.bindTabs();
    ContestersUI.init();
    TicketsUI.init();
    StructureUI.init();
    FormatUI.init();
    ResultsUI.init();
    SettingsUI.init();
    LaunchDialog.init();
    Console.init();
    Contest.init();
    this.header();
    if (ROLE === 'audience') return Audience.boot();

    byId('btnStart').onclick = () => LaunchDialog.open();
    document.addEventListener('click', e => { const b = e.target.closest('[data-goto-tab]'); if (b) this.tab(b.dataset.gotoTab); });
    byId('topStats').onclick = e => { const b = e.target.closest('[data-goto]'); if (b) this.tab(b.dataset.goto); };
    byId('viewer').onclick = () => Viewer.close();
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !byId('viewer').hidden) Viewer.close(); });
  },

  /** Read everything from storage (both windows call this). */
  async loadData() {
    S.contesters = await DB.all('contesters');
    S.tickets = await DB.all('tickets');
    const settings = (await DB.get('settings')) || {};
    S.settings = pickSettings(settings);
    const format = await DB.get('format');
    S.format = format ? normalizeFormat(format) : migrateFormat(settings, await DB.get('phases'));
    S.templates = ((await DB.get('templates')) || []).filter(t => t && t.id && t.format);
    S.history = (await DB.get('history')) || [];
    if (!format) await saveFormat();
    const event = await DB.get('event');
    S.event = event ? normalizeEvent(event) : migrateEvent();
    if (!event) await saveEvent();
    S.activeStage = (await DB.get('activeStage')) || '';
    if (!S.event.stages.some(s => s.id === S.activeStage)) S.activeStage = S.event.stages[0].id;
    // tickets from before per-stage ticks: "all stages" → every stage ticked; "used" → used in the active stage
    const allStages = S.event.stages.map(s => s.id);
    const oldTickets = S.tickets.filter(t => !Array.isArray(t.stages) || !t.usedIn);
    oldTickets.forEach(t => {
      if (!Array.isArray(t.stages)) t.stages = t.stageId ? [t.stageId] : allStages.slice();
      if (!t.usedIn) t.usedIn = t.used ? { [S.activeStage]: true } : {};
      delete t.stageId; delete t.used;
    });
    if (oldTickets.length) await DB.putMany('tickets', oldTickets);
    // contesters from before stages existed: "presented" counts for the first stage
    const old = S.contesters.filter(c => !c.done);
    old.forEach(c => { c.done = c.status === 'done' ? { [S.event.stages[0].id]: true } : {}; delete c.status; });
    if (old.length) await DB.putMany('contesters', old);
    sortAll();
    Sound.setEnabled(S.settings.sound);
  },

  /** Re-read what the contest changes while it runs (statuses, tickets, history). */
  async reloadRuntime() {
    S.contesters = await DB.all('contesters');
    S.tickets = await DB.all('tickets');
    S.history = (await DB.get('history')) || [];
    S.activeStage = (await DB.get('activeStage')) || S.activeStage;
    ContestersUI.renderStageSelect();
    this.refreshAll();
  },

  tab(name) { this.goTab(name); window.scrollTo({ top: 0 }); },

  bindTabs() {
    const go = this.goTab = name => {
      $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
      $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
      try { localStorage.setItem('cm-tab', name); } catch (e) { /* ignore */ }
      if (name === 'settings') SettingsUI.storageInfo();
    };
    $$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
    let last = null;
    try { last = localStorage.getItem('cm-tab'); } catch (e) { /* ignore */ }
    if (last && byId('tab-' + last)) go(last);
  },

  header() {
    const e = S.event;
    if (ROLE === 'audience') return;
    byId('brandTitle').textContent = e.title || 'Contest Manager';
    byId('brandSub').textContent = e.subtitle || 'Contest manager';
    document.title = (e.title || 'Contest') + ' · Contest Manager';
    const w = waiting().length, deck = stageDeck(curStage()), unused = deck.filter(t => !isUsed(t)).length;
    byId('topStats').innerHTML = `
      <button class="stat stat-fmt" data-goto="structure" title="Change the contest structure">🗂 <b>${e.stages.length}</b> stage${e.stages.length === 1 ? '' : 's'}</button>
      <span class="stat"><b>${S.contesters.length}</b> contesters</span>
      <span class="stat"><b>${w}</b> waiting in ${esc(curStage().name)}</span>
      <span class="stat"><b>${deck.length}</b> tickets in this stage (${unused} unused)</span>
      <span class="stat"><b>${S.history.length}</b> rounds</span>`;
  },

  refreshAll() {
    sortAll();
    ContestersUI.render();
    TicketsUI.render();
    ResultsUI.render();
    this.header();
  },

  /** Everyone waiting in the active stage (or every stage), all tickets unused, optionally clear history. */
  async resetStatuses({ allStages = false, clearHistory = false } = {}) {
    S.contesters.forEach(c => { if (allStages) c.done = {}; else setDone(c, false); });
    const deck = allStages ? S.tickets : stageDeck(curStage());
    deck.forEach(t => { if (allStages) t.usedIn = {}; else setUsed(t, false); });
    await DB.putMany('contesters', S.contesters);
    await DB.putMany('tickets', S.tickets);
    if (clearHistory) { S.history = []; await DB.set('history', S.history); }
    this.refreshAll();
  },
};

Admin.boot();
