'use strict';

/* =====================================================================
   Contest format: what a round looks like (people, tickets, timers, texts).
   ===================================================================== */

const FORMAT_DEFAULTS = {
  name: 'My format',
  title: 'Contest',
  subtitle: '',
  roundLabel: 'Round {round}',
  doneTitle: 'Round {round} complete!',
  showSteps: true,
  teamSize: 2,
  slots: [],
  teamTitle: 'Meet the team',
  fillFromDone: true,
  ticketCount: 1,
  ticketLabel: 'Ticket',
  ticketTitle: 'Draw your ticket',
  ticketFlow: 'together',
  uniqueTickets: true,
  phases: [],
  autoAdvance: true,
  autoDelay: 5,
  warnAt: 30,
  dangerAt: 10,
  beepLast: 5,
};
const MAX_TEAM = 6, MAX_TICKETS = 10;

function defaultSlot(i) {
  if (i === 0) return { role: 'Contester', title: 'Who steps up next?' };
  if (i === 1) return { role: 'Partner', title: 'Choose a partner for {name}' };
  return { role: `Member ${i + 1}`, title: 'Who joins {team}?' };
}

const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-pairs', builtin: true,
    format: {
      name: 'Image description (pairs)', title: 'Image Description Contest',
      teamSize: 2,
      slots: [{ role: 'Contester', title: 'Who steps up next?' }, { role: 'Partner', title: 'Choose a partner for {name}' }],
      teamTitle: 'Meet the team',
      ticketCount: 1, ticketLabel: 'Ticket', ticketTitle: 'Draw your ticket',
      phases: [
        { id: 'p1', name: 'Preparing', sec: 60, color: '#38bdf8' },
        { id: 'p2', name: 'Presenting', sec: 120, color: '#f5c451' },
      ],
    },
  },
  {
    id: 'builtin-solo', builtin: true,
    format: {
      name: 'Solo speech', title: 'Speech Contest',
      teamSize: 1,
      slots: [{ role: 'Speaker', title: 'Who speaks next?' }],
      teamTitle: 'Our next speaker',
      ticketCount: 1, ticketLabel: 'Topic', ticketTitle: 'Draw your topic',
      phases: [
        { id: 'p1', name: 'Preparing', sec: 60, color: '#38bdf8' },
        { id: 'p2', name: 'Speaking', sec: 180, color: '#f5c451' },
      ],
    },
  },
  {
    id: 'builtin-trio', builtin: true,
    format: {
      name: 'Team of three', title: 'Team Challenge',
      teamSize: 3,
      slots: [
        { role: 'Captain', title: 'Who leads the next team?' },
        { role: 'Member', title: 'Who joins {name}?' },
        { role: 'Member', title: 'Who completes the team?' },
      ],
      teamTitle: 'The team is ready',
      ticketCount: 2, ticketLabel: 'Task', ticketTitle: 'Draw task {n} of {total}', ticketFlow: 'together',
      phases: [
        { id: 'p1', name: 'Planning', sec: 120, color: '#34d399' },
        { id: 'p2', name: 'Presenting', sec: 180, color: '#f5c451' },
        { id: 'p3', name: 'Questions', sec: 60, color: '#ec4899' },
      ],
    },
  },
  {
    id: 'builtin-quiz', builtin: true,
    format: {
      name: 'Quiz duel', title: 'Quiz Duel',
      teamSize: 2,
      slots: [{ role: 'Player 1', title: 'Who plays next?' }, { role: 'Player 2', title: 'Who challenges {name}?' }],
      teamTitle: 'Let the duel begin',
      ticketCount: 3, ticketLabel: 'Question', ticketTitle: 'Question {n} of {total}', ticketFlow: 'each',
      phases: [
        { id: 'p1', name: 'Thinking', sec: 20, color: '#38bdf8' },
        { id: 'p2', name: 'Answering', sec: 40, color: '#f5c451' },
      ],
      autoDelay: 3, warnAt: 10, dangerAt: 5, beepLast: 3,
    },
  },
];

const clampInt = (v, lo, hi, def) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : Math.min(hi, Math.max(lo, n));
};

/** Fill in defaults, fix types, and give every format the same key order (so formats can be compared). */
function normalizeFormat(f = {}) {
  const o = {};
  for (const k of Object.keys(FORMAT_DEFAULTS)) o[k] = f[k] !== undefined && f[k] !== null ? f[k] : structuredClone(FORMAT_DEFAULTS[k]);
  for (const k of ['name', 'title', 'subtitle', 'roundLabel', 'doneTitle', 'teamTitle', 'ticketLabel', 'ticketTitle']) o[k] = String(o[k]);
  for (const k of ['showSteps', 'fillFromDone', 'uniqueTickets', 'autoAdvance']) o[k] = !!o[k];
  o.teamSize = clampInt(o.teamSize, 1, MAX_TEAM, 2);
  o.ticketCount = clampInt(o.ticketCount, 0, MAX_TICKETS, 1);
  o.ticketFlow = o.ticketFlow === 'each' ? 'each' : 'together';
  o.autoDelay = clampInt(o.autoDelay, 1, 60, 5);
  o.warnAt = clampInt(o.warnAt, 0, 86400, 30);
  o.dangerAt = clampInt(o.dangerAt, 0, 86400, 10);
  o.beepLast = clampInt(o.beepLast, 0, 30, 5);
  const slots = Array.isArray(o.slots) ? o.slots : [];
  o.slots = Array.from({ length: o.teamSize }, (_, i) => {
    const s = slots[i] || {}, d = defaultSlot(i);
    return { role: typeof s.role === 'string' ? s.role : d.role, title: typeof s.title === 'string' ? s.title : d.title };
  });
  o.phases = (Array.isArray(o.phases) ? o.phases : []).map(p => ({
    id: String(p.id || uid()), name: String(p.name ?? 'Phase'), sec: clampInt(p.sec, 1, 86400, 60), color: String(p.color || '#f5c451'),
  }));
  o.templateId = f.templateId || null;
  return o;
}

/** Build a format from settings saved by the earlier version of the app. */
function migrateFormat(oldSettings = {}, oldPhases = null) {
  const f = { ...structuredClone(BUILTIN_TEMPLATES[0].format), templateId: BUILTIN_TEMPLATES[0].id };
  for (const k of ['title', 'subtitle', 'uniqueTickets', 'autoAdvance', 'autoDelay', 'warnAt', 'dangerAt', 'beepLast']) {
    if (oldSettings[k] !== undefined) f[k] = oldSettings[k];
  }
  if (Array.isArray(oldPhases)) f.phases = oldPhases;
  const n = normalizeFormat(f);
  if (!sameFormat(n, BUILTIN_TEMPLATES[0].format)) n.name = 'My format';
  return n;
}

function formatKey(f) {
  const n = normalizeFormat(f);
  delete n.templateId;
  return JSON.stringify(n);
}
const sameFormat = (a, b) => formatKey(a) === formatKey(b);

const allTemplates = () => [...BUILTIN_TEMPLATES, ...S.templates];
const findTemplate = id => allTemplates().find(t => t.id === id);

/** Does the current format differ from every saved/built-in template? */
function formatState() {
  const src = S.format.templateId ? findTemplate(S.format.templateId) : null;
  return { src, changed: !src || !sameFormat(S.format, src.format) };
}

/** Replace {round}, {name}, {last}, {team}, {n}, {total} in a text. */
function fill(text, ctx) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m));
}
const SAMPLE_CTX = { round: 1, name: 'Anna', last: 'Bob', team: 'Anna & Bob', n: 1, total: 2 };

function fmtDur(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? (s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`) : `${s} s`;
}

function timerTotal(f) {
  const once = f.phases.reduce((a, p) => a + p.sec, 0);
  return f.ticketFlow === 'each' && f.ticketCount > 1 ? once * f.ticketCount : once;
}

function formatSummaryText(f) {
  const people = f.teamSize === 1 ? '1 person' : `${f.teamSize} people`;
  const tickets = f.ticketCount === 0 ? 'no tickets' : `${f.ticketCount} × ${f.ticketLabel || 'ticket'}`;
  const timers = f.phases.length ? f.phases.map(p => `${p.name} ${fmtDur(p.sec)}`).join(' › ') : 'no timer';
  return { people, tickets, timers, each: f.ticketFlow === 'each' && f.ticketCount > 1 };
}

/** One round, drawn as a row of steps. */
function flowHTML(f) {
  const arrow = '<i class="fl-arrow">→</i>';
  const steps = f.slots.map((s, i) => `<span class="fl fl-draw">🎲 ${esc(s.role || `Person ${i + 1}`)}</span>`);
  steps.push(`<span class="fl fl-team">${f.teamSize > 1 ? '👥' : '⭐'} ${esc(fill(f.teamTitle, SAMPLE_CTX) || 'Team')}</span>`);
  const label = esc(f.ticketLabel || 'Ticket');
  const ph = f.phases.map(p => `<span class="fl fl-ph" style="--pc:${esc(p.color)}">⏱ ${esc(p.name)} <small>${fmtDur(p.sec)}</small></span>`);
  if (f.ticketCount === 0) steps.push(...ph);
  else if (f.ticketCount === 1 || f.ticketFlow === 'together') {
    steps.push(`<span class="fl fl-tk">🎟 ${label}${f.ticketCount > 1 ? ` ×${f.ticketCount}` : ''}</span>`, ...ph);
  } else {
    steps.push(`<span class="fl-group"><em>repeat ×${f.ticketCount}</em>${[`<span class="fl fl-tk">🎟 ${label}</span>`, ...ph].join(arrow)}</span>`);
  }
  steps.push(`<span class="fl fl-done">🏆 ${esc(fill(f.doneTitle, SAMPLE_CTX) || 'Done')}</span>`);
  return steps.join(arrow);
}

function factsHTML(f) {
  const total = timerTotal(f);
  return `<div class="facts">
    <div class="fact"><b>${f.teamSize}</b><span>${f.teamSize === 1 ? 'person presents' : 'people present together'}</span></div>
    <div class="fact"><b>${f.ticketCount}</b><span>${esc(f.ticketLabel || 'ticket')}${f.ticketCount === 1 ? '' : 's'} per round${f.ticketCount > 1 ? (f.ticketFlow === 'each' ? ', timers for each' : ', drawn together') : ''}</span></div>
    <div class="fact"><b>${total ? fmtTime(total * 1000) : '—'}</b><span>timer time per round</span></div>
  </div>`;
}

/* ============================ Format tab ============================ */
const FormatUI = {
  init() {
    const persist = debounce(() => saveFormat(), 250);
    this.changed = () => { persist(); this.renderFlow(); this.renderTemplates(); Admin.header(); };

    $$('[data-fmt]').forEach(el => {
      const k = el.dataset.fmt;
      const isNum = el.type === 'number';
      el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (isNum) { v = parseInt(el.value, 10); if (isNaN(v)) return; }
        else v = el.value;
        S.format[k] = v;
        if (isNum || k === 'teamSize') {
          S.format = normalizeFormat(S.format);
          if (k === 'teamSize') this.renderSlots();
        }
        this.changed();
      });
      if (isNum) el.addEventListener('blur', () => { el.value = S.format[k]; });
    });

    byId('fSlots').addEventListener('input', e => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      S.format.slots[+row.dataset.i][e.target.dataset.sf] = e.target.value;
      this.changed();
    });

    this.initPhases();

    byId('tplGrid').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      this[b.dataset.act](id);
    });
    byId('tplSaveNew').onclick = () => this.saveNew();
    byId('tplName').onkeydown = e => { if (e.key === 'Enter') this.saveNew(); };

    this.load();
  },

  /** Put the current format into every input. */
  load() {
    $$('[data-fmt]').forEach(el => {
      const v = S.format[el.dataset.fmt];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    });
    this.renderSlots();
    this.renderPhases();
    this.renderTemplates();
    this.renderFlow();
  },

  renderSlots() {
    byId('fSlots').innerHTML = S.format.slots.map((s, i) => `
      <div class="slot-row" data-i="${i}">
        <span class="ph-idx">${i + 1}</span>
        <label>Role<input type="text" data-sf="role" value="${esc(s.role)}" placeholder="e.g. Partner"></label>
        <label>Title while the numbers spin<input type="text" data-sf="title" value="${esc(s.title)}" placeholder="e.g. Choose a partner for {name}"></label>
      </div>`).join('');
  },

  renderFlow() {
    byId('fmtFlow').innerHTML = flowHTML(S.format);
    byId('fmtFacts').innerHTML = factsHTML(S.format);
  },

  /* ---------- timer phases ---------- */
  initPhases() {
    const list = byId('phaseList');
    list.addEventListener('input', e => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const p = S.format.phases[+row.dataset.i];
      const f = e.target.dataset.f;
      if (f === 'name') p.name = e.target.value || 'Phase';
      else if (f === 'color') { p.color = e.target.value; row.style.setProperty('--pc', p.color); }
      else if (f === 'min' || f === 's') {
        const m = Math.max(0, parseInt(row.querySelector('[data-f=min]').value, 10) || 0);
        const s = Math.max(0, parseInt(row.querySelector('[data-f=s]').value, 10) || 0);
        p.sec = Math.max(1, m * 60 + s);
      }
      this.changed();
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const ph = S.format.phases, i = +b.closest('[data-i]').dataset.i;
      if (b.dataset.act === 'del') {
        if (ph.length === 1 && !confirm('Remove the last phase? Rounds will then have no timer.')) return;
        ph.splice(i, 1);
      } else if (b.dataset.act === 'up' && i > 0) {
        [ph[i - 1], ph[i]] = [ph[i], ph[i - 1]];
      } else if (b.dataset.act === 'down' && i < ph.length - 1) {
        [ph[i + 1], ph[i]] = [ph[i], ph[i + 1]];
      } else return;
      this.renderPhases();
      this.changed();
    });
    byId('phaseAdd').onclick = () => {
      const colors = ['#34d399', '#ec4899', '#a78bfa', '#f87171', '#38bdf8', '#f5c451'];
      S.format.phases.push({ id: uid(), name: 'New phase', sec: 60, color: colors[S.format.phases.length % colors.length] });
      this.renderPhases();
      this.changed();
      const inputs = $$('#phaseList [data-f=name]');
      inputs[inputs.length - 1].select();
    };
  },

  renderPhases() {
    byId('phaseList').innerHTML = S.format.phases.map((p, i) => `
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

  /* ---------- templates ---------- */
  renderTemplates() {
    const { src, changed } = formatState();
    byId('fmtState').innerHTML = src
      ? `In use: <b>${esc(src.format.name)}</b>${changed ? ' <span class="badge chg">changed, not saved</span>' : ''}`
      : '<span class="badge chg">Your own format, not saved as a template</span>';
    byId('tplGrid').innerHTML = allTemplates().map(t => {
      const f = normalizeFormat(t.format), sum = formatSummaryText(f), active = src && src.id === t.id;
      return `<div class="tpl-card ${active ? 'active' : ''}" data-id="${t.id}">
        <div class="tpl-top">
          <b>${esc(f.name)}</b>
          ${t.builtin ? '<span class="badge bi">Built-in</span>' : '<span class="badge mine">Mine</span>'}
          ${active ? `<span class="badge on">In use${changed ? ' · changed' : ''}</span>` : ''}
        </div>
        <div class="tpl-sum">👥 ${esc(sum.people)} · 🎟 ${esc(sum.tickets)}${sum.each ? ' (timers for each)' : ''}<br>⏱ ${esc(sum.timers)}</div>
        <div class="btn-row">
          ${active && !changed ? '' : '<button class="btn btn-sm btn-primary" data-act="use">Use this format</button>'}
          ${!t.builtin && active && changed ? '<button class="btn btn-sm" data-act="update">💾 Save changes</button>' : ''}
          ${!t.builtin ? '<button class="btn btn-sm" data-act="del" title="Delete template">🗑</button>' : ''}
        </div>
      </div>`;
    }).join('');
    const input = byId('tplName');
    if (document.activeElement !== input) input.value = changed ? S.format.name : '';
  },

  use(id) {
    const t = findTemplate(id);
    if (!t) return;
    const { changed } = formatState();
    if (changed && !confirm(`Use "${t.format.name}"?\n\nThe current format has changes that are not saved as a template. They will be replaced.`)) return;
    this.apply(t);
    toast(`Now using "${t.format.name}"`);
  },

  apply(t) {
    S.format = normalizeFormat({ ...structuredClone(t.format), templateId: t.id });
    saveFormat();
    this.load();
    Admin.header();
  },

  async saveNew() {
    const name = byId('tplName').value.trim() || S.format.name.trim();
    if (!name) { byId('tplName').focus(); return toast('Give the template a name', 'error'); }
    const existing = S.templates.find(t => t.format.name.toLowerCase() === name.toLowerCase());
    if (existing && !confirm(`A template called "${existing.format.name}" already exists. Replace it?`)) return;
    S.format.name = name;
    const format = normalizeFormat(S.format);
    delete format.templateId;
    let t = existing;
    if (t) t.format = format;
    else { t = { id: uid(), format }; S.templates.push(t); }
    S.format.templateId = t.id;
    await Promise.all([saveTemplates(), saveFormat()]);
    byId('tplName').value = '';
    this.load();
    toast(`Template "${name}" saved`);
  },

  async update(id) {
    const t = S.templates.find(x => x.id === id);
    if (!t) return;
    const format = normalizeFormat(S.format);
    delete format.templateId;
    t.format = format;
    await saveTemplates();
    this.renderTemplates();
    toast(`Template "${format.name}" updated`);
  },

  async del(id) {
    const t = S.templates.find(x => x.id === id);
    if (!t || !confirm(`Delete the template "${t.format.name}"?\nThe current format is not changed.`)) return;
    S.templates = S.templates.filter(x => x.id !== id);
    if (S.format.templateId === id) { S.format.templateId = null; saveFormat(); }
    await saveTemplates();
    this.renderTemplates();
  },
};
