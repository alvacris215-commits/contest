'use strict';

const DEFAULT_SETTINGS = {
  title: 'Image Description Contest',
  subtitle: '',
  sound: true,
  uniqueTickets: true,
  autoAdvance: true,
  autoDelay: 5,
  revealDelay: 1000,
  warnAt: 30,
  dangerAt: 10,
  beepLast: 5,
  autoFullscreen: true,
};
const DEFAULT_PHASES = [
  { id: 'p1', name: 'Preparing', sec: 60, color: '#38bdf8' },
  { id: 'p2', name: 'Presenting', sec: 120, color: '#f5c451' },
];

/** In-memory state (mirrored to IndexedDB). */
const S = { contesters: [], tickets: [], settings: { ...DEFAULT_SETTINGS }, phases: [], history: [] };

const waiting = () => S.contesters.filter(c => c.status !== 'done');
const saveSettings = () => DB.set('settings', S.settings);
const savePhases = () => DB.set('phases', S.phases);
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
      if (!confirm('Mark every contester as "waiting" so they can be drawn again?')) return;
      S.contesters.forEach(c => { c.status = 'waiting'; });
      await DB.putMany('contesters', S.contesters);
      this.render(); Admin.header();
      toast('Everyone is waiting again');
    };
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
    else { c = { id: uid(), status: 'waiting', created: Date.now() }; S.contesters.push(c); }
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
    c.status = c.status === 'done' ? 'waiting' : 'done';
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
        const c = { id: uid(), num: n++, name: nameFromFile(f) || `Contester ${n - 1}`, photo: await fileToDataURL(f, 720, 0.88), status: 'waiting', created: Date.now() };
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
      <div class="card c-card ${c.status === 'done' ? 'is-done' : ''}" data-id="${c.id}">
        <div class="c-photo" data-act="view"><img src="${esc(avatarFor(c))}" alt="" loading="lazy"></div>
        <div class="c-body">
          <div class="c-num">#${c.num}</div>
          <div class="c-name" title="${esc(c.name)}">${esc(c.name)}</div>
          <span class="badge ${c.status === 'done' ? 'done' : 'wait'}">${c.status === 'done' ? '✓ Presented' : '● Waiting'}</span>
        </div>
        <div class="card-actions">
          <button data-act="edit" title="Edit">✎</button>
          <button data-act="toggle" title="${c.status === 'done' ? 'Mark as waiting' : 'Mark as presented'}">${c.status === 'done' ? '↺' : '✓'}</button>
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
      if (!confirm('Mark every ticket as unused?')) return;
      S.tickets.forEach(t => { t.used = false; });
      await DB.putMany('tickets', S.tickets);
      this.render(); Admin.header();
      toast('All tickets are back in the deck');
    };
    byId('tGrid').onclick = e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      this[b.dataset.act](b.closest('[data-id]').dataset.id);
    };
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

    let t;
    if (this.editing) t = S.tickets.find(x => x.id === this.editing);
    else { t = { id: uid(), used: false, created: Date.now() }; S.tickets.push(t); }
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
    byId('tFormTitle').textContent = `Edit ticket #${t.num}`;
    byId('tSave').textContent = 'Save changes';
    byId('tCancel').hidden = false;
    this.showImage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async toggle(id) {
    const t = S.tickets.find(x => x.id === id);
    t.used = !t.used;
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
          fg: '#ffffff', bg: '#140f33', image: await fileToDataURL(f, 2000, 0.9), used: false, created: Date.now(),
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

  render() {
    const unused = S.tickets.filter(t => !t.used).length;
    byId('tCount').textContent = `(${S.tickets.length} total · ${unused} unused)`;
    const grid = byId('tGrid');
    if (!S.tickets.length) {
      grid.innerHTML = '<div class="empty-state">No tickets yet. Create the first problem above.</div>';
      return;
    }
    grid.innerHTML = S.tickets.map(t => `
      <div class="card t-card ${t.used ? 'is-done' : ''}" data-id="${t.id}">
        <div class="t-thumb" data-act="view">${ticketHTML(t)}</div>
        <div class="t-meta">
          <b>#${t.num}</b>
          <span class="t-label">${esc(t.title || (t.type === 'text' ? (t.text || '').slice(0, 40) : 'Image'))}</span>
          <span class="badge ${t.used ? 'done' : 'wait'}">${t.used ? 'Used' : 'In deck'}</span>
        </div>
        <div class="card-actions">
          <button data-act="edit" title="Edit">✎</button>
          <button data-act="toggle" title="${t.used ? 'Put back in deck' : 'Mark as used'}">${t.used ? '↺' : '✓'}</button>
          <button data-act="del" title="Delete" class="del">🗑</button>
        </div>
      </div>`).join('');
  },
};

/* ============================ Timers ============================ */
const TimersUI = {
  init() {
    const list = byId('phaseList');
    const save = debounce(() => savePhases(), 250);
    list.addEventListener('input', e => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const p = S.phases[+row.dataset.i];
      const f = e.target.dataset.f;
      if (f === 'name') p.name = e.target.value || 'Phase';
      else if (f === 'color') { p.color = e.target.value; row.style.setProperty('--pc', p.color); }
      else if (f === 'min' || f === 's') {
        const m = Math.max(0, parseInt(row.querySelector('[data-f=min]').value, 10) || 0);
        const s = Math.max(0, parseInt(row.querySelector('[data-f=s]').value, 10) || 0);
        p.sec = Math.max(1, m * 60 + s);
      }
      save();
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const i = +b.closest('[data-i]').dataset.i;
      if (b.dataset.act === 'del') {
        if (S.phases.length === 1 && !confirm('Remove the last phase? Rounds will then have no timer.')) return;
        S.phases.splice(i, 1);
      } else if (b.dataset.act === 'up' && i > 0) {
        [S.phases[i - 1], S.phases[i]] = [S.phases[i], S.phases[i - 1]];
      } else if (b.dataset.act === 'down' && i < S.phases.length - 1) {
        [S.phases[i + 1], S.phases[i]] = [S.phases[i], S.phases[i + 1]];
      } else return;
      savePhases();
      this.render();
    });
    byId('phaseAdd').onclick = () => {
      const colors = ['#34d399', '#ec4899', '#a78bfa', '#f87171', '#38bdf8', '#f5c451'];
      S.phases.push({ id: uid(), name: 'New phase', sec: 60, color: colors[S.phases.length % colors.length] });
      savePhases();
      this.render();
      const inputs = $$('#phaseList [data-f=name]');
      inputs[inputs.length - 1].select();
    };
    this.render();
  },

  render() {
    byId('phaseList').innerHTML = S.phases.map((p, i) => `
      <div class="phase-row" data-i="${i}" style="--pc:${esc(p.color)}">
        <span class="ph-idx">${i + 1}</span>
        <input type="color" data-f="color" value="${esc(p.color)}" title="Colour">
        <input type="text" data-f="name" value="${esc(p.name)}" placeholder="Phase name">
        <div class="dur">
          <input type="number" data-f="min" min="0" value="${Math.floor(p.sec / 60)}"><span>min</span>
          <input type="number" data-f="s" min="0" max="59" value="${p.sec % 60}"><span>sec</span>
        </div>
        <div class="ph-actions">
          <button data-act="up" title="Move up">↑</button>
          <button data-act="down" title="Move down">↓</button>
          <button data-act="del" title="Remove" class="del">✕</button>
        </div>
      </div>`).join('') || '<div class="empty-state">No phases. Add one below.</div>';
  },
};

/* ============================ Results ============================ */
const ResultsUI = {
  init() {
    byId('hClear').onclick = async () => {
      if (!confirm('Clear the round history? Contester and ticket statuses stay unchanged.')) return;
      S.history = [];
      await DB.set('history', S.history);
      this.render();
    };
    byId('hExport').onclick = () => {
      const rows = [['Round', 'Contester ID', 'Contester', 'Partner ID', 'Partner', 'Ticket', 'Ticket title', 'Time']];
      S.history.forEach(h => rows.push([h.round, h.a?.num, h.a?.name, h.b?.num ?? '', h.b?.name ?? '', h.ticket?.num ?? '', h.ticket?.title ?? '', new Date(h.at).toLocaleString()]));
      const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      download(`contest-rounds-${today()}.csv`, '﻿' + csv, 'text/csv');
    };
    this.render();
  },
  render() {
    byId('hCount').textContent = `(${S.history.length})`;
    byId('hBody').innerHTML = S.history.slice().reverse().map(h => `
      <tr>
        <td><b>${h.round}</b></td>
        <td>#${h.a.num} ${esc(h.a.name)}</td>
        <td>${h.b ? `#${h.b.num} ${esc(h.b.name)}` : '<span class="muted">—</span>'}</td>
        <td>${h.ticket ? `#${h.ticket.num} ${esc(h.ticket.title)}` : '<span class="muted">—</span>'}</td>
        <td class="muted">${new Date(h.at).toLocaleString()}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted center">No rounds yet</td></tr>';
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
        if (k === 'title' || k === 'subtitle') Admin.header();
        if (k === 'sound') Sound.setEnabled(v);
        if (k === 'uniqueTickets') Admin.header();
      };
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', debounce(handler, el.type === 'checkbox' ? 0 : 300));
    });
    this.load();

    byId('bExport').onclick = () => {
      const data = {
        app: 'contest-manager', version: 1, exported: new Date().toISOString(),
        contesters: S.contesters, tickets: S.tickets, settings: S.settings, phases: S.phases, history: S.history,
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
        S.contesters = data.contesters; S.tickets = data.tickets;
        S.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        S.phases = Array.isArray(data.phases) ? data.phases : structuredClone(DEFAULT_PHASES);
        S.history = Array.isArray(data.history) ? data.history : [];
        await Promise.all([saveSettings(), savePhases(), DB.set('history', S.history)]);
        this.load(); TimersUI.render(); Admin.refreshAll();
        ContestersUI.resetForm(); TicketsUI.resetForm();
        toast('Backup imported');
      } catch (err) { toast('Import failed: ' + err.message, 'error'); }
    };
    byId('bResetAll').onclick = async () => {
      if (!confirm('Start a new session?\n• all contesters → waiting\n• all tickets → unused\n• round history cleared\n\nContesters, tickets and settings are kept.')) return;
      await Admin.resetStatuses(true);
      toast('New session ready');
    };
    byId('bErase').onclick = async () => {
      if (!confirm('Erase ALL contesters, tickets, settings and history? This cannot be undone.')) return;
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

    S.contesters = await DB.all('contesters');
    S.tickets = await DB.all('tickets');
    S.settings = { ...DEFAULT_SETTINGS, ...((await DB.get('settings')) || {}) };
    S.phases = (await DB.get('phases')) || structuredClone(DEFAULT_PHASES);
    S.history = (await DB.get('history')) || [];
    sortAll();
    Sound.setEnabled(S.settings.sound);

    this.bindTabs();
    ContestersUI.init();
    TicketsUI.init();
    TimersUI.init();
    ResultsUI.init();
    SettingsUI.init();
    Contest.init();
    this.header();

    byId('btnStart').onclick = () => Contest.open();
    byId('viewer').onclick = () => Viewer.close();
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !byId('viewer').hidden) Viewer.close(); });
  },

  bindTabs() {
    const go = name => {
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
    byId('brandTitle').textContent = S.settings.title || 'Contest Manager';
    byId('brandSub').textContent = S.settings.subtitle || 'Contest manager';
    document.title = (S.settings.title || 'Contest') + ' · Contest Manager';
    const w = waiting().length, unused = S.tickets.filter(t => !t.used).length;
    byId('topStats').innerHTML = `
      <span class="stat"><b>${S.contesters.length}</b> contesters</span>
      <span class="stat"><b>${w}</b> waiting</span>
      <span class="stat"><b>${S.tickets.length}</b> tickets${S.settings.uniqueTickets ? ` (${unused} unused)` : ''}</span>
      <span class="stat"><b>${S.history.length}</b> rounds</span>`;
    byId('btnStart').disabled = !S.contesters.length;
    byId('btnStart').title = S.contesters.length ? '' : 'Register contesters first';
  },

  refreshAll() {
    sortAll();
    ContestersUI.render();
    TicketsUI.render();
    ResultsUI.render();
    this.header();
  },

  /** Everyone waiting + all tickets unused (optionally clear history). */
  async resetStatuses(clearHistory = false) {
    S.contesters.forEach(c => { c.status = 'waiting'; });
    S.tickets.forEach(t => { t.used = false; });
    await DB.putMany('contesters', S.contesters);
    await DB.putMany('tickets', S.tickets);
    if (clearHistory) { S.history = []; await DB.set('history', S.history); }
    this.refreshAll();
  },
};

Admin.boot();
