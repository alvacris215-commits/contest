'use strict';

/* =====================================================================
   Winners ceremony: the awards (personal or group), who won them,
   and each winner's scores from the rounds.
   ===================================================================== */

const MEDALS = {
  gold: { icon: '🥇', label: 'Gold' },
  silver: { icon: '🥈', label: 'Silver' },
  bronze: { icon: '🥉', label: 'Bronze' },
  special: { icon: '🌟', label: 'Special award' },
};

const WINNERS_DEFAULTS = {
  title: 'The Winners',
  closing: 'Congratulations!',
  revealUp: true,
  showScores: true,
  awards: [],
};

function normalizeAward(a = {}) {
  return {
    id: String(a.id || uid()),
    title: String(a.title ?? '1st Place'),
    medal: MEDALS[a.medal] ? a.medal : 'gold',
    kind: a.kind === 'group' ? 'group' : 'person',
    team: String(a.team ?? ''),
    members: (Array.isArray(a.members) ? a.members : []).map(String),
    note: String(a.note ?? ''),
  };
}

function normalizeWinners(w) {
  w = w || {};
  return {
    title: String(w.title ?? WINNERS_DEFAULTS.title),
    closing: String(w.closing ?? WINNERS_DEFAULTS.closing),
    revealUp: w.revealUp !== undefined ? !!w.revealUp : WINNERS_DEFAULTS.revealUp,
    showScores: w.showScores !== undefined ? !!w.showScores : WINNERS_DEFAULTS.showScores,
    awards: (Array.isArray(w.awards) ? w.awards : []).map(normalizeAward),
  };
}

const saveWinners = () => DB.set('winners', S.winners);
const meanOf = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const fmtAvg = v => (v == null ? '–' : v.toFixed(2));

/** An award's winners that still exist (a contester may have been deleted). */
const awardPeople = a => a.members.map(id => S.contesters.find(c => c.id === id)).filter(Boolean).slice(0, a.kind === 'person' ? 1 : 12);
/** "Team Phoenix", or "Anna & Bob" when the group has no name. */
const awardName = a => {
  const ppl = awardPeople(a);
  return a.kind === 'group' ? (a.team.trim() || ppl.map(c => c.name).join(' & ')) : (ppl[0]?.name || '');
};

/** Awards that have a winner, in the order they are revealed. */
function winnersOrder() {
  const list = S.winners.awards.filter(a => awardPeople(a).length);
  return S.winners.revealUp ? list.slice().reverse() : list;
}

/** Every scored round of one person, grouped by stage (in contest order). overall = mean of the stage averages. */
function personRecord(id) {
  const stages = [];
  S.history.forEach(h => {
    const me = histTeam(h).find(c => c.id === id);
    if (!me || me.avg == null) return;
    const sid = h.stageId || '';
    let s = stages.find(x => x.id === sid);
    if (!s) {
      const ev = S.event.stages.find(x => x.id === sid);
      s = { id: sid, name: ev ? ev.name : (h.stage || 'Scores'), icon: ev ? ev.icon : '⭐', order: ev ? stageIndex(sid) : 999, rounds: [] };
      stages.push(s);
    }
    s.rounds.push({ round: h.round, scores: me.scores || [], avg: me.avg });
  });
  stages.forEach(s => { s.avg = meanOf(s.rounds.map(r => r.avg)); });
  stages.sort((a, b) => a.order - b.order);
  return { stages, overall: meanOf(stages.map(s => s.avg)) };
}

/** Everyone with scores, best overall first (ties share a place). */
function overallRanking() {
  const list = S.contesters.map(c => ({ c, rec: personRecord(c.id) })).filter(x => x.rec.overall != null)
    .sort((a, b) => b.rec.overall - a.rec.overall);
  list.forEach((x, i) => { x.rank = i > 0 && Math.abs(x.rec.overall - list[i - 1].rec.overall) < 1e-9 ? list[i - 1].rank : i + 1; });
  return list;
}

/* ============================ Winners tab ============================ */
const WinnersUI = {
  init() {
    const persist = debounce(() => saveWinners(), 300);
    this.persist = persist;
    $$('[data-w]').forEach(el => {
      const k = el.dataset.w;
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        S.winners[k] = el.type === 'checkbox' ? el.checked : el.value;
        persist();
        this.renderSummary();
      });
    });
    byId('wAddPerson').onclick = () => this.add('person');
    byId('wAddGroup').onclick = () => this.add('group');
    byId('wSuggest').onclick = () => this.suggest();
    byId('wShow').onclick = () => this.show(false);
    byId('wShowHere').onclick = () => this.show(true);

    const list = byId('wList');
    list.addEventListener('input', e => {
      const f = e.target.dataset.f;
      if (!f || e.target.tagName === 'SELECT') return;
      const a = this.award(e.target);
      a[f] = e.target.value;
      persist();
      this.renderHead(a);
      this.renderSummary();
    });
    list.addEventListener('change', e => {
      const el = e.target, f = el.dataset.f, a = f && this.award(el);
      if (!a || el.tagName !== 'SELECT') return;
      if (f === 'member') a.members = el.value ? [el.value] : [];
      else if (f === 'addMember') { if (el.value && !a.members.includes(el.value)) a.members.push(el.value); }
      else if (f === 'fromRound') {
        const h = S.history.find(x => x.id === el.value);
        if (h) a.members = histTeam(h).map(c => c.id).filter(id => S.contesters.some(c => c.id === id));
      } else if (f === 'kind') {
        a.kind = el.value;
        if (a.kind === 'person') a.members = a.members.slice(0, 1);
      } else a[f] = el.value;
      persist();
      this.render();
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = this.award(b), arr = S.winners.awards, i = arr.indexOf(a);
      if (b.dataset.act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      else if (b.dataset.act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      else if (b.dataset.act === 'del') {
        if (!confirm(`Delete the award "${a.title}"?`)) return;
        arr.splice(i, 1);
      } else if (b.dataset.act === 'rm') a.members = a.members.filter(id => id !== b.dataset.cid);
      else return;
      persist();
      this.render();
    });
    this.load();
  },

  award(el) { return S.winners.awards.find(a => a.id === el.closest('[data-aid]').dataset.aid); },

  load() {
    $$('[data-w]').forEach(el => {
      const v = S.winners[el.dataset.w];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
    this.render();
  },

  add(kind) {
    const n = S.winners.awards.length;
    const medal = ['gold', 'silver', 'bronze'][n] || 'special';
    const title = kind === 'group'
      ? ['Best Team', 'Best Pair', 'Team Spirit Award'][S.winners.awards.filter(a => a.kind === 'group').length] || 'Group Award'
      : ['1st Place', '2nd Place', '3rd Place'][n] || 'Special Award';
    S.winners.awards.push(normalizeAward({ title, medal, kind }));
    this.persist();
    this.render();
    const cards = $$('#wList .award-card');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  /** 1st, 2nd and 3rd place from the overall scores. */
  suggest() {
    const top = overallRanking().slice(0, 3);
    if (!top.length) return toast('No scores yet. Scores appear here after the judges score the rounds.', 'error');
    if (S.winners.awards.length && !confirm(`Replace the ${S.winners.awards.length} award(s) in the list with the top ${top.length} from the overall scores?`)) return;
    S.winners.awards = top.map((x, i) => normalizeAward({
      title: ['1st Place', '2nd Place', '3rd Place'][x.rank - 1] || `${x.rank}th Place`,
      medal: ['gold', 'silver', 'bronze'][x.rank - 1] || 'special',
      kind: 'person', members: [x.c.id],
    }));
    this.persist();
    this.render();
    toast(`Added ${top.length} award${top.length === 1 ? '' : 's'} from the overall scores`);
  },

  async show(here) {
    const empty = S.winners.awards.filter(a => !awardPeople(a).length);
    if (!winnersOrder().length) return toast('Choose a winner for at least one award first', 'error');
    if (empty.length && !confirm(`${empty.length} award(s) have no winner yet and will be skipped:\n${empty.map(a => '• ' + a.title).join('\n')}\n\nShow the winners anyway?`)) return;
    await saveWinners();
    if (here) return Contest.open({ start: 'winners' });
    Console.open();
    if (Console.connected()) Console.cmd('winners', { reload: true });
    else { Console.pending = { cmd: 'winners', reload: true }; Console.openAudience(); }
  },

  /** Called after rounds change (scores); keeps the list as it is while someone types in it. */
  refresh() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('#tab-winners') && a.matches('input, textarea')) return this.renderRanking();
    this.render();
  },

  render() {
    const W = S.winners;
    byId('wCount').textContent = `(${W.awards.length})`;
    const ranked = overallRanking();
    const overall = new Map(ranked.map(x => [x.c.id, x.rec.overall]));
    const opt = (c, sel) => `<option value="${c.id}"${sel ? ' selected' : ''}>#${c.num} ${esc(c.name)}${overall.has(c.id) ? ` — ${fmtAvg(overall.get(c.id))}` : ''}</option>`;
    const teams = S.history.filter(h => histTeam(h).length > 1);
    byId('wList').innerHTML = W.awards.map((a, i) => {
      const ppl = awardPeople(a);
      const who = a.kind === 'person'
        ? `<label>Winner<select data-f="member"><option value="">Choose a contester…</option>${S.contesters.map(c => opt(c, a.members[0] === c.id)).join('')}</select></label>`
        : `<div class="a-members">
            <span class="muted small">Members</span>
            <div class="a-chips">${ppl.map(c => `<span class="a-mem"><img src="${esc(avatarFor(c))}" alt="">#${c.num} ${esc(c.name)}<button data-act="rm" data-cid="${c.id}" title="Remove">✕</button></span>`).join('') || '<span class="muted small">Nobody yet</span>'}</div>
            <div class="a-pick">
              <select data-f="addMember"><option value="">＋ Add a member…</option>${S.contesters.filter(c => !a.members.includes(c.id)).map(c => opt(c)).join('')}</select>
              ${teams.length ? `<select data-f="fromRound"><option value="">⇣ Use a team from a round…</option>${teams.map(h => `<option value="${h.id}">Round ${h.round}${h.stage ? ` · ${esc(h.stage)}` : ''}: ${histTeam(h).map(c => esc(c.name)).join(' & ')}</option>`).join('')}</select>` : ''}
            </div>
          </div>`;
      return `<div class="award-card" data-aid="${a.id}" data-medal="${a.medal}">
        <div class="s-head">
          <span class="ph-idx">${i + 1}</span>
          <b class="s-head-name"></b>
          <span class="badge ${a.kind === 'group' ? 'chg' : 'wait'}">${a.kind === 'group' ? '👥 Group' : '👤 Personal'}</span>
          <div class="ph-actions">
            <button data-act="up" title="Move up">↑</button>
            <button data-act="down" title="Move down">↓</button>
            <button data-act="del" class="del" title="Delete award">✕</button>
          </div>
        </div>
        <div class="a-grid">
          <label class="a-title">Award title<input type="text" data-f="title" value="${esc(a.title)}" placeholder="e.g. 1st Place"></label>
          <label>Medal<select data-f="medal">${Object.entries(MEDALS).map(([k, m]) => `<option value="${k}"${a.medal === k ? ' selected' : ''}>${m.icon} ${m.label}</option>`).join('')}</select></label>
          <label>Type<select data-f="kind"><option value="person"${a.kind === 'person' ? ' selected' : ''}>👤 Personal</option><option value="group"${a.kind === 'group' ? ' selected' : ''}>👥 Group</option></select></label>
          ${a.kind === 'group' ? `<label class="a-wide">Group name (optional)<input type="text" data-f="team" value="${esc(a.team)}" placeholder="e.g. Team Phoenix. Empty: the members' names"></label>` : ''}
          <div class="a-wide">${who}</div>
          <label class="a-wide">A line under the name (optional)<input type="text" data-f="note" value="${esc(a.note)}" placeholder="e.g. For the most vivid picture description"></label>
          <div class="a-wide a-scores">${this.scoresHTML(ppl)}</div>
        </div>
      </div>`;
    }).join('') || '<div class="empty-state">No awards yet. Add a personal or group award, or fill 1st–3rd place from the scores.</div>';
    W.awards.forEach(a => this.renderHead(a));
    this.renderSummary();
    this.renderRanking();
  },

  renderHead(a) {
    const el = $(`#wList [data-aid="${a.id}"] .s-head-name`);
    if (el) el.textContent = `${MEDALS[a.medal].icon} ${a.title || 'Award'}${awardPeople(a).length ? ` · ${awardName(a)}` : ''}`;
  },

  /** What the audience will see under the winner, as a small preview. */
  scoresHTML(ppl) {
    if (!ppl.length) return '';
    const rows = ppl.map(c => {
      const r = personRecord(c.id);
      return `<div class="a-sc"><b>#${c.num} ${esc(c.name)}</b> ${r.stages.map(s => `<span>${esc(s.icon)} ${esc(s.name)} <b>${fmtAvg(s.avg)}</b></span>`).join('') || '<span class="muted">no scores yet</span>'}${r.overall != null ? `<span class="a-ov">Overall <b>${fmtAvg(r.overall)}</b></span>` : ''}</div>`;
    }).join('');
    return `<span class="muted small">Scores shown on screen</span>${rows}`;
  },

  renderSummary() {
    const n = winnersOrder().length, total = S.winners.awards.length;
    byId('wSummary').textContent = total
      ? `${n} of ${total} award${total === 1 ? '' : 's'} ready${S.winners.revealUp && n > 1 ? ` · revealed from "${winnersOrder()[0].title}" up to "${winnersOrder()[n - 1].title}"` : ''}`
      : '';
  },

  /** Everyone's scores, to help choose the winners. */
  renderRanking() {
    const list = overallRanking();
    const stages = S.event.stages.filter(s => list.some(x => x.rec.stages.some(r => r.id === s.id)));
    byId('wRank').innerHTML = list.length ? `
      <table class="table">
        <thead><tr><th>#</th><th>Contester</th>${stages.map(s => `<th>${esc(s.icon)} ${esc(s.name)}</th>`).join('')}<th>Overall</th></tr></thead>
        <tbody>${list.map(x => `<tr>
          <td><b>${['🥇', '🥈', '🥉'][x.rank - 1] || x.rank}</b></td>
          <td>#${x.c.num} ${esc(x.c.name)}</td>
          ${stages.map(s => { const r = x.rec.stages.find(y => y.id === s.id); return `<td>${r ? fmtAvg(r.avg) : '<span class="muted">–</span>'}</td>`; }).join('')}
          <td><b class="score">${fmtAvg(x.rec.overall)}</b></td>
        </tr>`).join('')}</tbody>
      </table>` : '<p class="muted">No scores yet. They appear here after the judges score the rounds.</p>';
  },
};
