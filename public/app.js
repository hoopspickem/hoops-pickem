const state = {
  me: null,          // { id, username, isAdmin }
  weeks: [],
  currentWeek: 1,
  week: null,        // week being viewed
  games: [],
  filters: { q: '', ranked: false, unpicked: false },
  boardWeek: null,   // null = season
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

// ---------- utilities ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const fmtDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
// Calendar day a game belongs to. A game with no announced time is stored at midnight Eastern,
// which would otherwise land on the previous evening for anyone west of the East Coast.
const localDate = (iso) => new Intl.DateTimeFormat('en-CA').format(new Date(iso));
const gameDay = (g) => (g.timeTbd ? g.easternDate : localDate(g.startTime));
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtRange = (w) => {
  const o = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${new Date(w.start).toLocaleDateString(undefined, o)} – ${new Date(w.end).toLocaleDateString(undefined, o)}`;
};

// Swap a broken logo image for a colored circle with the team abbreviation.
window.logoFallback = (img) => {
  const div = document.createElement('div');
  div.className = 'logo-fallback';
  div.style.background = img.dataset.color || '#495057';
  div.textContent = img.dataset.abbrev || '?';
  img.replaceWith(div);
};

// ---------- account ----------

function renderAccount() {
  const el = $('#account');
  if (state.me) {
    el.innerHTML = `<span>Hi, <b>${esc(state.me.username)}</b>${state.me.isAdmin ? ' · admin' : ''}</span>
      <button class="btn ghost" id="logout">Log out</button>`;
    $('#logout').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      state.me = null;
      renderAccount();
      route();
    };
  } else {
    el.innerHTML = `<button class="btn ghost" id="login-btn">Log in</button>
      <button class="btn primary" id="signup-btn">Sign up</button>`;
    $('#login-btn').onclick = () => openAuth('login');
    $('#signup-btn').onclick = () => openAuth('register');
  }
}

let authMode = 'login';
function openAuth(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  $('#auth-title').textContent = isLogin ? 'Log in' : 'Create your account';
  $('#auth-submit').textContent = isLogin ? 'Log in' : 'Sign up';
  $('#auth-form').password.autocomplete = isLogin ? 'current-password' : 'new-password';
  $('#auth-switch').innerHTML = isLogin
    ? `New here? <button type="button" class="linkish" data-mode="register">Create an account</button>`
    : `Already playing? <button type="button" class="linkish" data-mode="login">Log in</button>`;
  $('#auth-switch button').onclick = (e) => openAuth(e.target.dataset.mode);
  $('#auth-error').hidden = true;
  const dlg = $('#auth-dialog');
  if (!dlg.open) dlg.showModal();
  $('#auth-form').username.focus();
}

$('#auth-cancel').onclick = () => $('#auth-dialog').close();
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api(authMode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST', body: { username: f.username.value, password: f.password.value },
    });
    f.reset();
    $('#auth-dialog').close();
    await loadMe();
    toast(authMode === 'login' ? 'Welcome back!' : 'Account created — start picking!');
    route();
  } catch (err) {
    $('#auth-error').textContent = err.message;
    $('#auth-error').hidden = false;
  }
});

async function loadMe() {
  const data = await api('/api/me');
  state.me = data.user;
  state.weeks = data.weeks;
  state.currentWeek = data.currentWeek;
  if (state.week == null) state.week = data.currentWeek;
  renderAccount();
}

// ---------- picks view ----------

async function showPicks() {
  view.innerHTML = '<p class="muted">Loading games…</p>';
  const data = await api(`/api/games?week=${state.week}`);
  state.games = data.games;
  renderPicks();
}

function teamButton(game, side) {
  const t = game[side];
  const picked = game.myPick === t.id;
  const final = game.status === 'post' && game.winner;
  const cls = ['team'];
  if (picked) cls.push('picked');
  if (final && picked) cls.push(game.winner === t.id ? 'correct' : 'wrong');
  if (final && game.winner !== t.id) cls.push('lost');

  let badge = '';
  if (picked) badge = final ? (game.winner === t.id ? '+1' : '✗') : 'Your pick';

  const showScore = game.status === 'in' || game.status === 'post';
  return `
    <button class="${cls.join(' ')}" data-game="${esc(game.id)}" data-team="${esc(t.id)}"
            ${game.locked ? 'disabled' : ''} aria-pressed="${picked}"
            aria-label="Pick ${esc(t.name)}">
      ${badge ? `<span class="badge">${badge}</span>` : ''}
      <img class="logo" src="${esc(t.logo)}" alt="" loading="lazy"
           data-abbrev="${esc(t.abbrev || t.short.slice(0, 4))}" data-color="${esc(t.color || '')}"
           onerror="logoFallback(this)">
      <span class="name">${t.rank ? `<span class="rank">#${t.rank}</span>` : ''}${esc(t.short)}</span>
      <span class="meta">${esc(t.record || '')}</span>
      ${showScore ? `<span class="score">${t.score ?? '–'}</span>` : ''}
      ${side === 'home' && !game.neutral ? '<span class="home-tag">Home</span>' : ''}
    </button>`;
}

function gameCard(game) {
  let status;
  if (game.status === 'in') status = `<span class="status-live">${esc(game.statusDetail || 'Live')}</span>`;
  else if (game.status === 'post') status = `<b>${esc(game.statusDetail || 'Final')}</b>`;
  else if (game.status === 'canceled') status = `<b>${esc(game.statusDetail || 'Canceled')}</b>`;
  else status = `${game.timeTbd ? 'Time TBD' : fmtTime(game.startTime)}${game.locked ? ' · 🔒' : ''}`;

  let crowd = '';
  const total = (game.away.picks || 0) + (game.home.picks || 0);
  if (game.locked && total > 0) {
    const pa = Math.round((game.away.picks / total) * 100);
    crowd = `
      <div class="crowd" title="How everyone picked">
        <i style="width:${pa}%;background:${esc(game.away.color || '#868e96')}"></i>
        <i style="width:${100 - pa}%;background:${esc(game.home.color || '#adb5bd')}"></i>
      </div>
      <div class="crowd-label"><span>${pa}% picked ${esc(game.away.short)}</span><span>${100 - pa}%</span></div>`;
  }

  let admin = '';
  if (state.me?.isAdmin && game.locked) {
    admin = `<div class="admin-row">Admin · set winner:
      <button class="btn" data-admin-win="${esc(game.away.id)}" data-game="${esc(game.id)}">${esc(game.away.abbrev || game.away.short)}</button>
      <button class="btn" data-admin-win="${esc(game.home.id)}" data-game="${esc(game.id)}">${esc(game.home.abbrev || game.home.short)}</button>
      <button class="btn" data-admin-win="" data-game="${esc(game.id)}">Use feed</button></div>`;
  }

  return `
    <article class="game">
      <div class="game-head"><span>${status}</span><span>${esc(game.neutral ? (game.venue || 'Neutral site') : '')}</span></div>
      <div class="matchup">
        ${teamButton(game, 'away')}
        <span class="vs">${game.neutral ? 'VS' : '@'}</span>
        ${teamButton(game, 'home')}
      </div>
      ${crowd}${admin}
    </article>`;
}

function filteredGames() {
  const q = state.filters.q.trim().toLowerCase();
  return state.games.filter((g) => {
    if (state.filters.ranked && !g.home.rank && !g.away.rank) return false;
    if (state.filters.unpicked && (g.myPick || g.locked)) return false;
    if (q && ![g.home.name, g.away.name, g.home.abbrev, g.away.abbrev].some((s) => (s || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderPicks() {
  const w = state.weeks.find((x) => x.week === state.week);
  const games = state.games;
  const picked = games.filter((g) => g.myPick).length;
  const open = games.filter((g) => !g.locked);
  const openUnpicked = open.filter((g) => !g.myPick).length;
  const graded = games.filter((g) => g.myPick && g.status === 'post' && g.winner);
  const points = graded.filter((g) => g.myPick === g.winner).length;

  const weekOptions = state.weeks.map((x) =>
    `<option value="${x.week}" ${x.week === state.week ? 'selected' : ''}>Week ${x.week} · ${fmtRange(x)}${x.week === state.currentWeek ? ' (this week)' : ''}</option>`).join('');

  view.innerHTML = `
    <div class="weekbar">
      <h1>Week ${state.week}</h1>
      <button class="btn icon-btn" id="prev-week" ${state.week <= 1 ? 'disabled' : ''} aria-label="Previous week">‹</button>
      <select id="week-select" aria-label="Choose week">${weekOptions}</select>
      <button class="btn icon-btn" id="next-week" ${state.week >= state.weeks.length ? 'disabled' : ''} aria-label="Next week">›</button>
    </div>

    ${!state.me ? `<div class="banner"><span>Sign up to make your picks. One point for every winner you call correctly.</span>
      <button class="btn primary" id="banner-signup">Sign up free</button></div>` : ''}

    <div class="summary">
      <div class="stat"><b>${games.length}</b><span>Games ${w ? fmtRange(w) : ''}</span></div>
      <div class="stat"><b>${picked}/${games.length}</b><span>Your picks</span>
        <div class="progress"><i style="width:${games.length ? (picked / games.length) * 100 : 0}%"></i></div></div>
      <div class="stat"><b>${points}</b><span>Points this week (${graded.length} graded)</span></div>
      <div class="stat"><b>${openUnpicked}</b><span>Open games still to pick</span></div>
    </div>

    <div class="filters">
      <input type="search" id="search" placeholder="Search teams…" value="${esc(state.filters.q)}">
      <label class="chip"><input type="checkbox" id="f-ranked" ${state.filters.ranked ? 'checked' : ''}> Top 25 only</label>
      ${state.me ? `<label class="chip"><input type="checkbox" id="f-unpicked" ${state.filters.unpicked ? 'checked' : ''}> Still need a pick</label>` : ''}
      ${state.me?.isAdmin ? `<button class="btn" id="sync-btn">↻ Sync week from ESPN</button>` : ''}
    </div>

    <div id="game-list"></div>`;

  renderGameList();

  $('#prev-week').onclick = () => goWeek(state.week - 1);
  $('#next-week').onclick = () => goWeek(state.week + 1);
  $('#week-select').onchange = (e) => goWeek(Number(e.target.value));
  $('#search').oninput = (e) => { state.filters.q = e.target.value; renderGameList(); };
  $('#f-ranked').onchange = (e) => { state.filters.ranked = e.target.checked; renderGameList(); };
  if ($('#f-unpicked')) $('#f-unpicked').onchange = (e) => { state.filters.unpicked = e.target.checked; renderGameList(); };
  if ($('#banner-signup')) $('#banner-signup').onclick = () => openAuth('register');
  if ($('#sync-btn')) $('#sync-btn').onclick = syncWeek;
}

function renderGameList() {
  const list = $('#game-list');
  const games = filteredGames();
  if (!state.games.length) {
    list.innerHTML = `<div class="empty"><h3>No games loaded for this week yet</h3>
      <p>The schedule syncs automatically from ESPN as the week approaches.${state.me?.isAdmin ? ' You can also press “Sync week from ESPN” above.' : ''}</p></div>`;
    return;
  }
  if (!games.length) {
    list.innerHTML = `<div class="empty">No games match your filters.</div>`;
    return;
  }
  const byDay = new Map();
  for (const g of games) {
    const day = gameDay(g);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  }
  list.innerHTML = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ymd, day]) => `
    <h2 class="day-heading">${fmtDay(ymd)} · ${day.length} game${day.length === 1 ? '' : 's'}</h2>
    <div class="games">${day.map(gameCard).join('')}</div>`).join('');
}

function goWeek(w) {
  state.week = w;
  location.hash = `#/picks/${w}`;
}

async function syncWeek() {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    const r = await api('/api/admin/sync', { method: 'POST', body: { week: state.week } });
    toast(`Synced ${r.count} games for week ${r.week}`);
    await showPicks();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = '↻ Sync week from ESPN';
  }
}

view.addEventListener('click', async (e) => {
  const adminBtn = e.target.closest('[data-admin-win]');
  if (adminBtn) {
    try {
      await api(`/api/admin/games/${encodeURIComponent(adminBtn.dataset.game)}/result`, {
        method: 'POST', body: { winner: adminBtn.dataset.adminWin || null },
      });
      toast('Result updated');
      await showPicks();
    } catch (err) { toast(err.message); }
    return;
  }

  const btn = e.target.closest('.team[data-team]');
  if (!btn || btn.disabled) return;
  if (!state.me) return openAuth('register');

  const game = state.games.find((g) => g.id === btn.dataset.game);
  const teamId = btn.dataset.team;
  const prev = game.myPick;
  const undo = prev === teamId; // clicking your current pick clears it
  game.myPick = undo ? null : teamId;
  renderGameList();
  try {
    if (undo) await api(`/api/picks/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
    else await api(`/api/picks/${encodeURIComponent(game.id)}`, { method: 'PUT', body: { teamId } });
    refreshSummary();
  } catch (err) {
    game.myPick = prev;
    renderGameList();
    toast(err.message);
  }
});

// Re-render the whole view (cheap) but keep the scroll position and search focus.
function refreshSummary() {
  const y = window.scrollY;
  const focused = document.activeElement?.id;
  renderPicks();
  window.scrollTo(0, y);
  if (focused === 'search') $('#search').focus();
}

// ---------- leaderboard ----------

async function showLeaderboard() {
  view.innerHTML = '<p class="muted">Loading standings…</p>';
  const q = state.boardWeek ? `?week=${state.boardWeek}` : '';
  const data = await api(`/api/leaderboard${q}`);
  const weekOptions = state.weeks.filter((w) => w.week <= state.currentWeek)
    .map((w) => `<option value="${w.week}" ${w.week === state.boardWeek ? 'selected' : ''}>Week ${w.week}</option>`).join('');

  view.innerHTML = `
    <div class="weekbar"><h1>Leaderboard</h1></div>
    <div class="filters">
      <div class="tabs">
        <button class="${!state.boardWeek ? 'active' : ''}" data-board="season">Season</button>
        <button class="${state.boardWeek ? 'active' : ''}" data-board="week">Weekly</button>
      </div>
      ${state.boardWeek ? `<select id="board-week" class="btn">${weekOptions}</select>` : ''}
    </div>
    ${data.rows.length ? `
    <table class="board">
      <thead><tr><th>#</th><th>Player</th><th class="num">Points</th><th class="num">Record</th><th class="num">Win %</th></tr></thead>
      <tbody>${data.rows.map((r) => `
        <tr class="${state.me && r.id === state.me.id ? 'me' : ''}">
          <td><span class="medal ${r.rank <= 3 && r.points > 0 ? `m${r.rank}` : ''}">${r.rank}</span></td>
          <td>${esc(r.username)}</td>
          <td class="num"><b>${r.points}</b></td>
          <td class="num">${r.points}-${r.graded - r.points}</td>
          <td class="num">${r.graded ? ((r.points / r.graded) * 100).toFixed(1) + '%' : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<div class="empty">No players yet. Be the first to sign up!</div>'}
    <p class="muted small">Points update automatically as games go final. Ties share a rank.</p>`;

  view.querySelectorAll('[data-board]').forEach((b) => {
    b.onclick = () => {
      state.boardWeek = b.dataset.board === 'week' ? state.currentWeek : null;
      showLeaderboard();
    };
  });
  if ($('#board-week')) $('#board-week').onchange = (e) => { state.boardWeek = Number(e.target.value); showLeaderboard(); };
}

// ---------- rules ----------

function showRules() {
  view.innerHTML = `
    <div class="weekbar"><h1>How it works</h1></div>
    <div class="prose">
      <h3>Make your picks</h3>
      <p>Every week (Monday–Sunday; week 1 also includes the Sunday opener) lists every NCAA Division I men's basketball game. Click a team's logo to pick them to win. Click again to clear the pick, or click the other team to switch.</p>
      <h3>Picks lock at tip-off</h3>
      <p>You can change a pick any time before that game starts. Once it tips off, the pick is locked — and you can see how everyone else picked.</p>
      <h3>Scoring</h3>
      <p>You earn <b>1 point</b> for every game where your pick wins. No points are taken away for wrong picks, so pick as many games as you can. Canceled or postponed games don't count.</p>
      <h3>Standings</h3>
      <p>The leaderboard shows the season total and each week's results. Results come in automatically from the official scoreboard a few minutes after each game ends.</p>
    </div>`;
}

// ---------- router ----------

async function route() {
  const [, page = 'picks', arg] = location.hash.split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
  try {
    if (page === 'leaderboard') await showLeaderboard();
    else if (page === 'rules') showRules();
    else {
      if (arg && Number(arg)) state.week = Number(arg);
      await showPicks();
    }
  } catch (err) {
    view.innerHTML = `<div class="empty">Something went wrong: ${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
loadMe().then(route);
