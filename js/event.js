'use strict';

/* =====================================================================
   Contest structure: the whole event, made of stages.
   Each stage is explained during the opening, and can run a format (draws + timers).
   ===================================================================== */

const EVENT_DEFAULTS = {
  title: "2026 Year's 2nd English Contest",
  subtitle: '',
  structureTitle: 'Contest structure',
  detailSlides: true,
  closingTitle: "Let's begin!",
  endTitle: 'Thank you!',
  notes: '',
  judges: ['Judge 1', 'Judge 2', 'Judge 3'],
  stages: [],
};

const STAGE_DEFAULTS = {
  name: 'New stage',
  icon: '⭐',
  tagline: '',
  description: '',
  points: '',
  notes: '',
  image: '',
  formatId: '',
  showFacts: true,
};

function normalizeStage(s = {}) {
  const o = { id: String(s.id || uid()) };
  for (const k of Object.keys(STAGE_DEFAULTS)) {
    const v = s[k] !== undefined && s[k] !== null ? s[k] : STAGE_DEFAULTS[k];
    o[k] = typeof STAGE_DEFAULTS[k] === 'boolean' ? !!v : String(v);
  }
  return o;
}

function normalizeEvent(e = {}) {
  const o = {};
  for (const k of Object.keys(EVENT_DEFAULTS)) o[k] = e[k] !== undefined && e[k] !== null ? e[k] : structuredClone(EVENT_DEFAULTS[k]);
  for (const k of ['title', 'subtitle', 'structureTitle', 'closingTitle', 'endTitle', 'notes']) o[k] = String(o[k]);
  o.detailSlides = !!o.detailSlides;
  o.judges = (Array.isArray(o.judges) ? o.judges : []).map(j => String(j ?? ''));
  o.stages = (Array.isArray(o.stages) ? o.stages : []).map(normalizeStage);
  if (!o.stages.length) o.stages = [normalizeStage({ name: 'Stage 1' })];
  return o;
}

/** First run: build the structure from the format that was in use before stages existed. */
function migrateEvent() {
  const f = S.format;
  const { src, changed } = formatState();
  const title = f.title && !BUILTIN_TEMPLATES.some(t => t.format.title === f.title) && f.title !== 'Contest' ? f.title : EVENT_DEFAULTS.title;
  return normalizeEvent({
    title, subtitle: f.subtitle,
    stages: [{
      name: 'Image Description', icon: '🖼️',
      tagline: 'Describe a picture together, in pairs',
      description: 'Contesters are drawn at random and paired up. Each pair draws a ticket with a picture, prepares together, then presents their description to the judges.',
      points: 'A random draw picks each contester and their partner\nEach pair draws one picture ticket\nPreparing time, then presenting time',
      formatId: src && !changed ? src.id : 'current',
    }],
  });
}

const curStage = () => S.event.stages.find(s => s.id === S.activeStage) || S.event.stages[0];
const stageIndex = id => S.event.stages.findIndex(s => s.id === id);

/** The format a stage runs, or null for an explanation-only stage. */
function stageFormat(stage) {
  if (!stage || !stage.formatId) return null;
  if (stage.formatId === 'current') return normalizeFormat(S.format);
  const t = findTemplate(stage.formatId);
  return t ? normalizeFormat(t.format) : null;
}
function stageFormatName(stage) {
  if (!stage.formatId) return 'Explanation only';
  if (stage.formatId === 'current') return `Current format: ${S.format.name}`;
  const t = findTemplate(stage.formatId);
  return t ? t.format.name : 'Missing template';
}

/** Short facts for a stage ("2 people · 1 ticket · Preparing 1:00 › Presenting 2:00"). */
function stageFacts(stage) {
  const f = stageFormat(stage);
  if (!f) return [];
  const out = [`👥 ${f.teamSize === 1 ? 'Solo' : `${f.teamSize} people together`}`];
  if (f.ticketCount) out.push(`🎟 ${f.ticketCount} ${f.ticketLabel.toLowerCase()}${f.ticketCount > 1 ? 's' : ''}`);
  f.phases.forEach(p => out.push(`⏱ ${p.name} ${fmtDur(p.sec)}`));
  return out;
}

/** Is a ticket ticked for a stage? */
const inStage = (t, stageId) => (t.stages || []).includes(stageId);
/** Tickets a stage can draw: the ones ticked for it. */
const stageDeck = stage => (stage ? S.tickets.filter(t => inStage(t, stage.id)) : []);
/** Per-stage "used" marks on tickets, like contesters' "presented" marks. */
const isUsed = (t, stageId = S.activeStage) => !!(t.usedIn && t.usedIn[stageId]);
function setUsed(t, v, stageId = S.activeStage) {
  t.usedIn = { ...(t.usedIn || {}) };
  if (v) t.usedIn[stageId] = true; else delete t.usedIn[stageId];
}

/** People of one stage sorted by their average score (ties share a place). */
function stageRanking(stageId) {
  const people = new Map();
  S.history.forEach(h => {
    if ((h.stageId || '') !== (stageId || '')) return;
    histTeam(h).forEach(c => {
      if (c.avg == null) return;
      const key = c.id || `#${c.num}`;
      const p = people.get(key) || { id: c.id, num: c.num, name: c.name, sum: 0, n: 0 };
      p.sum += c.avg; p.n++;
      people.set(key, p);
    });
  });
  const list = [...people.values()].map(p => ({ ...p, avg: p.sum / p.n })).sort((a, b) => b.avg - a.avg);
  list.forEach((p, i) => { p.rank = i > 0 && Math.abs(p.avg - list[i - 1].avg) < 1e-9 ? list[i - 1].rank : i + 1; });
  return list;
}

/** Per-stage "presented" marks. */
const isDone = (c, stageId = S.activeStage) => !!(c.done && c.done[stageId]);
function setDone(c, v, stageId = S.activeStage) {
  c.done = { ...(c.done || {}) };
  if (v) c.done[stageId] = true; else delete c.done[stageId];
}

/* ============================ Structure tab ============================ */
const StructureUI = {
  init() {
    const persist = debounce(() => saveEvent(), 300);
    this.changed = (full = false) => {
      persist();
      this.renderFlow();
      Admin.header();
      if (full) this.renderStages();
      TicketsUI.renderStageOptions();
      ContestersUI.renderStageSelect();
    };

    $$('[data-ev]').forEach(el => {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        S.event[el.dataset.ev] = el.type === 'checkbox' ? el.checked : el.value;
        this.changed();
      });
    });

    const list = byId('sList');
    const onField = e => {
      const f = e.target.dataset.f, card = e.target.closest('[data-sid]');
      if (!f || !card) return;
      const s = S.event.stages.find(x => x.id === card.dataset.sid);
      s[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (f === 'formatId') card.querySelector('.s-facts').innerHTML = this.factsHTML(s);
      if (f === 'name' || f === 'icon') card.querySelector('.s-head-name').textContent = `${s.icon} ${s.name}`;
      this.changed();
    };
    list.addEventListener('input', onField);
    list.addEventListener('change', onField);
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const card = b.closest('[data-sid]');
      const st = S.event.stages, i = st.findIndex(x => x.id === card.dataset.sid);
      const act = b.dataset.act;
      if (act === 'up' && i > 0) [st[i - 1], st[i]] = [st[i], st[i - 1]];
      else if (act === 'down' && i < st.length - 1) [st[i + 1], st[i]] = [st[i], st[i + 1]];
      else if (act === 'del') {
        if (st.length === 1) return toast('A contest needs at least one stage', 'error');
        if (!confirm(`Delete stage ${i + 1}: ${st[i].name}?`)) return;
        st.splice(i, 1);
      } else if (act === 'img') return card.querySelector('input[type=file]').click();
      else if (act === 'noimg') { st[i].image = ''; }
      else return;
      this.changed(true);
    });
    list.addEventListener('change', async e => {
      if (e.target.type !== 'file' || !e.target.files[0]) return;
      const card = e.target.closest('[data-sid]');
      const s = S.event.stages.find(x => x.id === card.dataset.sid);
      try { s.image = await fileToDataURL(e.target.files[0], 1400, 0.88); } catch (err) { return toast(err.message, 'error'); }
      e.target.value = '';
      this.changed(true);
    });
    const jl = byId('jList');
    jl.addEventListener('input', e => {
      const row = e.target.closest('[data-j]');
      if (!row) return;
      S.event.judges[+row.dataset.j] = e.target.value;
      this.changed();
    });
    jl.addEventListener('click', e => {
      const b = e.target.closest('[data-act=del]');
      if (!b) return;
      S.event.judges.splice(+b.closest('[data-j]').dataset.j, 1);
      this.renderJudges(); this.changed();
    });
    byId('jAdd').onclick = () => {
      S.event.judges.push(`Judge ${S.event.judges.length + 1}`);
      this.renderJudges(); this.changed();
      const inputs = $$('#jList input');
      inputs[inputs.length - 1].select();
    };
    byId('sAdd').onclick = () => {
      const n = S.event.stages.length + 1;
      S.event.stages.push(normalizeStage({ name: `Stage ${n}`, icon: ['🎤', '🧠', '✍️', '🏆', '💬', '🎯'][n % 6] }));
      this.changed(true);
      const names = $$('#sList [data-f=name]');
      names[names.length - 1].select();
    };
    this.load();
  },

  load() {
    $$('[data-ev]').forEach(el => {
      const v = S.event[el.dataset.ev];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
    this.renderStages();
    this.renderJudges();
    this.renderFlow();
  },

  renderJudges() {
    byId('jList').innerHTML = S.event.judges.map((j, i) => `
      <div class="judge-row" data-j="${i}">
        <span class="ph-idx">${i + 1}</span>
        <input type="text" value="${esc(j)}" placeholder="Judge name">
        <div class="ph-actions"><button data-act="del" class="del" title="Remove judge">✕</button></div>
      </div>`).join('') || '<div class="empty-state">No judges, so scoring is skipped. Add a judge to score contesters.</div>';
  },

  formatOptions(sel) {
    const opt = (v, label) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
    return opt('', 'Explanation only (no draws or timers)')
      + opt('current', `Current format from the Format tab: ${S.format.name}`)
      + `<optgroup label="Built-in templates">${BUILTIN_TEMPLATES.map(t => opt(t.id, t.format.name)).join('')}</optgroup>`
      + (S.templates.length ? `<optgroup label="My templates">${S.templates.map(t => opt(t.id, t.format.name)).join('')}</optgroup>` : '')
      + (sel && sel !== 'current' && !findTemplate(sel) ? opt(sel, 'Missing template') : '');
  },

  factsHTML(s) {
    const facts = stageFacts(s);
    const warn = s.formatId === 'current' ? '<span class="badge chg">Changes if you change the current format. Save it as a template to keep this stage fixed.</span>' : '';
    return (facts.length ? facts.map(f => `<span class="fl">${esc(f)}</span>`).join('') : '<span class="muted small">This stage is only explained. Nothing is drawn.</span>') + warn;
  },

  renderStages() {
    byId('sCount').textContent = `(${S.event.stages.length})`;
    byId('sList').innerHTML = S.event.stages.map((s, i) => `
      <div class="stage-card" data-sid="${s.id}">
        <div class="s-head">
          <span class="ph-idx">${i + 1}</span>
          <b class="s-head-name">${esc(s.icon)} ${esc(s.name)}</b>
          <div class="ph-actions">
            <button data-act="up" title="Move up">↑</button>
            <button data-act="down" title="Move down">↓</button>
            <button data-act="del" class="del" title="Delete stage">✕</button>
          </div>
        </div>
        <div class="s-grid">
          <label class="s-icon">Icon<input type="text" data-f="icon" value="${esc(s.icon)}" maxlength="4"></label>
          <label class="s-name">Stage name<input type="text" data-f="name" value="${esc(s.name)}"></label>
          <label class="s-tagl">Tagline (one short line)<input type="text" data-f="tagline" value="${esc(s.tagline)}" placeholder="e.g. Describe a picture together, in pairs"></label>
          <label class="s-wide">How this stage runs<select data-f="formatId">${this.formatOptions(s.formatId)}</select></label>
          <div class="s-wide s-facts">${this.factsHTML(s)}</div>
          <label class="s-half">Explanation shown to the audience<textarea data-f="description" rows="3" placeholder="What happens in this stage?">${esc(s.description)}</textarea></label>
          <label class="s-half">Key points, one per line<textarea data-f="points" rows="3" placeholder="Rules, scoring, time limits…">${esc(s.points)}</textarea></label>
          <label class="s-half">Presenter notes (only you see these)<textarea data-f="notes" rows="3" placeholder="What to say while this is on screen">${esc(s.notes)}</textarea></label>
          <div class="s-half s-img">
            <span class="muted small">Picture for the explanation slide (optional)</span>
            <div class="s-img-row">
              ${s.image ? `<img src="${esc(s.image)}" alt="">` : `<div class="s-img-empty">${esc(s.icon)}</div>`}
              <div class="btn-row">
                <button class="btn btn-sm" data-act="img">${s.image ? 'Change picture' : 'Add picture'}</button>
                ${s.image ? '<button class="btn btn-sm" data-act="noimg">Remove</button>' : ''}
              </div>
              <input type="file" accept="image/*" hidden>
            </div>
            <label class="check"><input type="checkbox" data-f="showFacts" ${s.showFacts ? 'checked' : ''}> Show people, tickets and times on the slide</label>
          </div>
        </div>
      </div>`).join('');
  },

  renderFlow() {
    const e = S.event;
    const items = [`<span class="fl fl-team">✦ ${esc(e.title || 'Title')}</span>`, `<span class="fl fl-draw">🗺 ${esc(e.structureTitle || 'Structure')} · ${e.stages.length} reveals</span>`];
    if (e.detailSlides) e.stages.forEach((s, i) => items.push(`<span class="fl">${esc(s.icon)} ${i + 1}. ${esc(s.name)}</span>`));
    items.push(`<span class="fl fl-done">🚀 ${esc(e.closingTitle || 'Begin')}</span>`);
    byId('sFlow').innerHTML = items.join('<i class="fl-arrow">→</i>');
  },
};
