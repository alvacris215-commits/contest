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
  entry: 'all',        // 'all' | 'top': only the best scorers of earlier stages take part
  qualMethod: 'avg',   // 'avg' | 'sum' of the counted stages' scores
  qualTies: true,      // people tied at the cut-off also go through
  groups: false,       // draw random groups at the start of the stage
  groupBy: 'size',     // 'size': groups of groupN people · 'count': groupN groups
};
const STAGE_NUMS = { qualTop: 6, groupN: 3 };

function normalizeStage(s = {}) {
  const o = { id: String(s.id || uid()) };
  for (const k of Object.keys(STAGE_DEFAULTS)) {
    const v = s[k] !== undefined && s[k] !== null ? s[k] : STAGE_DEFAULTS[k];
    o[k] = typeof STAGE_DEFAULTS[k] === 'boolean' ? !!v : String(v);
  }
  for (const [k, d] of Object.entries(STAGE_NUMS)) {
    const n = parseInt(s[k], 10);
    o[k] = n > 0 ? Math.min(n, 999) : d;
  }
  if (!['all', 'top'].includes(o.entry)) o.entry = 'all';
  if (!['avg', 'sum'].includes(o.qualMethod)) o.qualMethod = 'avg';
  if (!['size', 'count'].includes(o.groupBy)) o.groupBy = 'size';
  o.qualFrom = Array.isArray(s.qualFrom) ? s.qualFrom.map(String) : [];
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

/* ---------------- who takes part: qualification ---------------- */
/** The earlier stages a stage's qualification counts (all earlier stages when none are ticked). */
function qualStages(stage) {
  const earlier = S.event.stages.slice(0, Math.max(0, stageIndex(stage.id)));
  const picked = earlier.filter(s => stage.qualFrom.includes(s.id));
  return picked.length ? picked : earlier;
}

/** Everyone with scores, ranked by the stage's rule. A counted stage without a score counts as 0. */
function qualification(stage) {
  if (!stage || stage.entry !== 'top') return null;
  const from = qualStages(stage);
  const list = S.contesters.map(c => {
    const rec = personRecord(c.id);
    const parts = from.map(s => { const r = rec.stages.find(x => x.id === s.id); return r ? r.avg : null; });
    const got = parts.filter(v => v != null);
    if (!got.length) return null;
    const total = got.reduce((a, b) => a + b, 0);
    return { c, parts, value: stage.qualMethod === 'sum' ? total : total / from.length };
  }).filter(Boolean).sort((a, b) => b.value - a.value || a.c.num - b.c.num);
  list.forEach((x, i) => { x.rank = i > 0 && Math.abs(x.value - list[i - 1].value) < 1e-9 ? list[i - 1].rank : i + 1; });
  list.forEach((x, i) => { x.in = stage.qualTies ? x.rank <= stage.qualTop : i < stage.qualTop; });
  const ins = list.filter(x => x.in);
  return { from, list, ins, cutoff: ins.length ? ins[ins.length - 1].value : null };
}

/** Who takes part in a stage: everyone, or only its qualifiers. */
function stageEntrants(stage) {
  const q = qualification(stage);
  if (!q) return S.contesters;
  const ids = new Set(q.ins.map(x => x.c.id));
  return S.contesters.filter(c => ids.has(c.id));
}

/** "Average of Stage 1 + Stage 2" */
function qualRuleText(stage) {
  const from = qualStages(stage);
  return `${stage.qualMethod === 'sum' ? 'Total' : 'Average'} of ${from.map(s => s.name).join(' + ') || 'earlier stages'}`;
}

/* ---------------- random groups ---------------- */
const groupName = i => `Group ${i < 26 ? String.fromCharCode(65 + i) : i + 1}`;
const saveGroups = () => DB.set('groups', S.groups);

/** How many people go in each group: sizes differ by one at most. */
function groupSizes(stage, n) {
  if (n <= 0) return [];
  const count = Math.max(1, Math.min(n, stage.groupBy === 'count' ? stage.groupN : Math.round(n / stage.groupN) || 1));
  return Array.from({ length: count }, (_, i) => Math.floor(n / count) + (i < n % count ? 1 : 0));
}

/** The drawn groups of a stage (as contesters), or null when none were drawn for its current entrants. */
function stageGroups(stage) {
  const ids = S.groups[stage.id];
  if (!stage.groups || !Array.isArray(ids) || !ids.length) return null;
  const groups = ids.map(g => g.map(id => S.contesters.find(c => c.id === id)).filter(Boolean));
  const drawn = new Set(groups.flat().map(c => c.id)), ent = stageEntrants(stage);
  if (drawn.size !== ent.length || ent.some(c => !drawn.has(c.id))) return null;
  return groups;
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
      ContestersUI.render();
    };

    $$('[data-ev]').forEach(el => {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        S.event[el.dataset.ev] = el.type === 'checkbox' ? el.checked : el.value;
        this.changed();
      });
    });

    const list = byId('sList');
    const onField = e => {
      const card = e.target.closest('[data-sid]');
      if (!card) return;
      const s = S.event.stages.find(x => x.id === card.dataset.sid);
      if (e.target.dataset.qf && e.type === 'change') {   // a stage ticked for the qualification
        const id = e.target.dataset.qf;
        s.qualFrom = e.target.checked ? [...new Set([...s.qualFrom, id])] : s.qualFrom.filter(x => x !== id);
        card.querySelector('.s-entry').innerHTML = this.entryHTML(s);
        return this.changed();
      }
      const f = e.target.dataset.f;
      if (!f) return;
      if (f in STAGE_NUMS) {
        const n = parseInt(e.target.value, 10);
        if (!(n > 0)) return;
        s[f] = Math.min(n, 999);
      } else s[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (['entry', 'qualMethod', 'qualTies', 'qualTop', 'groups', 'groupBy', 'groupN'].includes(f) && (e.type === 'change' || f in STAGE_NUMS)) {
        const box = card.querySelector('.s-entry');
        if (e.type === 'change' && !(f in STAGE_NUMS)) box.innerHTML = this.entryHTML(s);
        else card.querySelector('.s-entry-live').innerHTML = this.entryLiveHTML(s);
      }
      if (f === 'formatId') card.querySelector('.s-facts').innerHTML = this.factsHTML(s);
      if (f === 'name' || f === 'icon') card.querySelector('.s-head-name').textContent = `${s.icon} ${s.name}`;
      this.changed();
    };
    list.addEventListener('input', onField);
    list.addEventListener('change', onField);
    list.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const card = b.closest('[data-sid]');
      const st = S.event.stages, i = st.findIndex(x => x.id === card.dataset.sid);
      const act = b.dataset.act;
      if (act === 'clearGroups') {
        if (!confirm(`Clear the groups of ${st[i].name}? They are drawn again when the stage starts.`)) return;
        delete S.groups[st[i].id];
        await saveGroups();
        card.querySelector('.s-entry-live').innerHTML = this.entryLiveHTML(st[i]);
        return;
      }
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

  /** "Who takes part" and "Random groups" for one stage. */
  entryHTML(s) {
    const i = stageIndex(s.id), earlier = S.event.stages.slice(0, i);
    const top = s.entry === 'top';
    const opt = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    return `
      <div class="s-entry-grid">
        <label>Who takes part<select data-f="entry">
          ${opt('all', s.entry, 'Everyone')}
          ${opt('top', s.entry, 'Top scorers only')}
        </select></label>
        ${top ? `
          <label>How many go through<input type="number" min="1" max="999" data-f="qualTop" value="${s.qualTop}"></label>
          <label>Ranked by<select data-f="qualMethod">
            ${opt('avg', s.qualMethod, 'Average of the stage scores')}
            ${opt('sum', s.qualMethod, 'Total of the stage scores')}
          </select></label>
          <div class="s-qf">
            <span class="muted small">Stages that count${earlier.length ? ' (none ticked: all earlier stages)' : ''}</span>
            ${earlier.length ? earlier.map((x, k) => `<label class="check"><input type="checkbox" data-qf="${x.id}" ${s.qualFrom.includes(x.id) ? 'checked' : ''}> ${k + 1}. ${esc(x.icon)} ${esc(x.name)}</label>`).join('')
              : '<span class="badge chg">This is the first stage, so there are no earlier scores. Move it after the stages that count.</span>'}
          </div>
          <label class="check s-grp"><input type="checkbox" data-f="qualTies" ${s.qualTies ? 'checked' : ''}> Everyone tied at the cut-off also goes through</label>` : ''}
        <label class="check s-grp"><input type="checkbox" data-f="groups" ${s.groups ? 'checked' : ''}> Draw random groups at the start of this stage</label>
        ${s.groups ? `
          <label>Groups<select data-f="groupBy">
            ${opt('size', s.groupBy, 'Groups of … people')}
            ${opt('count', s.groupBy, 'This many groups')}
          </select></label>
          <label>${s.groupBy === 'count' ? 'Number of groups' : 'People per group'}<input type="number" min="1" max="999" data-f="groupN" value="${s.groupN}"></label>` : ''}
      </div>
      <div class="s-entry-live">${this.entryLiveHTML(s)}</div>`;
  },

  /** Who qualifies right now, and the groups. */
  entryLiveHTML(s) {
    const out = [];
    const q = qualification(s);
    if (q) {
      const dec = v => v.toFixed(2);
      out.push(q.list.length
        ? `<div class="s-q"><b>${q.ins.length} qualified now</b> <span class="muted">· ${esc(qualRuleText(s))} · cut-off ${dec(q.cutoff ?? 0)}</span>
            <div class="s-q-list">${q.list.map(x => `<span class="${x.in ? 'in' : ''}">${x.rank}. #${x.c.num} ${esc(x.c.name)} <b>${dec(x.value)}</b></span>`).join('')}</div></div>`
        : `<div class="s-q muted">Nobody qualifies yet: there are no scores from ${esc(qualStages(s).map(x => x.name).join(', ') || 'earlier stages')}.</div>`);
    }
    if (s.groups) {
      const n = stageEntrants(s).length, sizes = groupSizes(s, n);
      const groups = stageGroups(s);
      out.push(`<div class="s-g"><b>${n} ${n === 1 ? 'person' : 'people'} → ${sizes.length} group${sizes.length === 1 ? '' : 's'}</b> <span class="muted">(${sizes.join(', ')})</span>
        ${groups ? `<div class="s-g-list">${groups.map((g, k) => `<span><b>${groupName(k)}:</b> ${g.map(c => esc(c.name)).join(', ')}</span>`).join('')}</div>
          <button class="btn btn-sm" data-act="clearGroups">↺ Clear the groups</button>`
          : '<span class="muted small"> · drawn on the audience screen when the stage starts</span>'}</div>`);
    }
    return out.join('');
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
          <div class="s-wide s-entry">${this.entryHTML(s)}</div>
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
