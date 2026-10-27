const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const db = require('./lib/db');
const { syncWeek } = require('./lib/espn');
const scores = require('./lib/scores');
const config = require('./lib/config');

const app = express();
app.use(express.json());
app.set('trust proxy', 1); // hosts like Render terminate HTTPS in front of the app
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const SESSION_DAYS = 30;

// ---------- auth helpers ----------

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  res.cookie('sid', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_DAYS * 864e5,
  });
}

app.use((req, _res, next) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    req.user = db.prepare(`
      SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
    req.sessionToken = token;
  }
  next();
});

const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please log in.' }));
const requireAdmin = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admins only.' }));

// ---------- auth routes ----------

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–24 letters, numbers, dots, dashes or underscores.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'That username is taken.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  // The first person to sign up becomes the league admin.
  const isAdmin = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n === 0 ? 1 : 0;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, pass_hash, salt, is_admin) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(password, salt), salt, isAdmin);
  scores.bump(); // new player appears on the leaderboard
  startSession(res, lastInsertRowid);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || '').trim());
  const password = String(req.body.password || '');
  if (!user || !crypto.timingSafeEqual(Buffer.from(hashPassword(password, user.salt), 'hex'), Buffer.from(user.pass_hash, 'hex'))) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  startSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({
    user: req.user ? { id: req.user.id, username: req.user.username, isAdmin: !!req.user.is_admin } : null,
    currentWeek: config.currentWeek(),
    weeks: config.allWeeks().map(({ week, start, end }) => ({ week, start, end })),
  });
});

// ---------- games & picks ----------

const gamesForWeek = db.prepare(`
  SELECT g.*,
         h.name AS home_name, h.short_name AS home_short, h.abbrev AS home_abbrev, h.logo AS home_logo, h.color AS home_color,
         a.name AS away_name, a.short_name AS away_short, a.abbrev AS away_abbrev, a.logo AS away_logo, a.color AS away_color,
         p.team_id AS my_pick
  FROM games g
  JOIN teams h ON h.id = g.home_team_id
  JOIN teams a ON a.id = g.away_team_id
  LEFT JOIN picks p ON p.game_id = g.id AND p.user_id = ?
  WHERE g.week = ?
  ORDER BY g.start_time, g.id
`);

// How everyone picked, per game. Only shown once a game locks, so the numbers are stable
// and can be counted once a minute per week instead of on every page load.
const pickCountsQuery = db.prepare(`
  SELECT p.game_id, p.team_id, COUNT(*) AS n
  FROM games g JOIN picks p ON p.game_id = g.id
  WHERE g.week = ?
  GROUP BY p.game_id, p.team_id
`);
const pickCountsCache = new Map(); // week -> { at, counts: Map("game|team" -> n) }
function pickCounts(week) {
  const hit = pickCountsCache.get(week);
  if (hit && Date.now() - hit.at < 60_000) return hit.counts;
  const counts = new Map(pickCountsQuery.all(week).map((r) => [`${r.game_id}|${r.team_id}`, r.n]));
  pickCountsCache.set(week, { at: Date.now(), counts });
  return counts;
}

const easternFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const easternDate = (iso) => easternFmt.format(new Date(iso)); // YYYY-MM-DD

function isLocked(game) {
  return game.status !== 'pre' || new Date(game.start_time) <= new Date();
}

app.get('/api/games', (req, res) => {
  const week = Number(req.query.week) || config.currentWeek();
  const rows = gamesForWeek.all(req.user ? req.user.id : 0, week);
  const counts = pickCounts(week);
  const games = rows.map((g) => {
    const locked = isLocked(g);
    const team = (side) => ({
      id: g[`${side}_team_id`], name: g[`${side}_name`], short: g[`${side}_short`], abbrev: g[`${side}_abbrev`],
      logo: g[`${side}_logo`], color: g[`${side}_color`], rank: g[`${side}_rank`], record: g[`${side}_record`],
      score: g[`${side}_score`],
      // Hide the crowd's picks until tip-off so nobody just copies the majority.
      picks: locked ? counts.get(`${g.id}|${g[`${side}_team_id`]}`) || 0 : null,
    });
    return {
      id: g.id, startTime: g.start_time, status: g.status, statusDetail: g.status_detail,
      neutral: !!g.neutral_site, venue: g.venue, winner: g.winner_team_id, locked,
      timeTbd: !!g.time_tbd, easternDate: easternDate(g.start_time),
      home: team('home'), away: team('away'), myPick: g.my_pick,
    };
  });
  res.json({ week: config.weekRange(week), games });
});

app.put('/api/picks/:gameId', requireUser, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  if (isLocked(game)) return res.status(409).json({ error: 'This game has already tipped off — picks are locked.' });
  const teamId = String(req.body.teamId || '');
  if (teamId !== game.home_team_id && teamId !== game.away_team_id) {
    return res.status(400).json({ error: 'Pick one of the two teams in this game.' });
  }
  db.prepare(`
    INSERT INTO picks (user_id, game_id, team_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, game_id) DO UPDATE SET team_id = excluded.team_id, picked_at = datetime('now')
  `).run(req.user.id, game.id, teamId);
  res.json({ ok: true });
});

app.delete('/api/picks/:gameId', requireUser, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  if (isLocked(game)) return res.status(409).json({ error: 'Picks are locked for this game.' });
  db.prepare('DELETE FROM picks WHERE user_id = ? AND game_id = ?').run(req.user.id, game.id);
  res.json({ ok: true });
});

// ---------- leaderboard ----------
// One point for every pick that matches the winner of a finished game.

const leaderboardQuery = db.prepare(`
  SELECT u.id, u.username, COALESCE(SUM(s.points), 0) AS points, COALESCE(SUM(s.graded), 0) AS graded
  FROM users u
  LEFT JOIN user_week_scores s ON s.user_id = u.id AND (? IS NULL OR s.week = ?)
  GROUP BY u.id
  ORDER BY points DESC, graded ASC, u.username COLLATE NOCASE
`);

// Standings only change when results come in or someone signs up, so each view is built
// once and reused until then (with a one-minute ceiling as a safety net).
const leaderboardCache = new Map(); // week|'season' -> { version, at, body }

app.get('/api/leaderboard', (req, res) => {
  const week = req.query.week ? Number(req.query.week) : null;
  const key = week ?? 'season';
  const hit = leaderboardCache.get(key);
  if (hit && hit.version === scores.currentVersion() && Date.now() - hit.at < 60_000) {
    return res.type('json').send(hit.body);
  }
  const rows = leaderboardQuery.all(week, week);

  let rank = 0;
  let last = null;
  rows.forEach((r, i) => {
    if (r.points !== last) { rank = i + 1; last = r.points; }
    r.rank = rank;
  });
  const body = JSON.stringify({ week, rows });
  leaderboardCache.set(key, { version: scores.currentVersion(), at: Date.now(), body });
  res.type('json').send(body);
});

// ---------- admin ----------

app.post('/api/admin/sync', requireAdmin, async (req, res) => {
  const week = Number(req.body.week) || config.currentWeek();
  try {
    const count = await syncWeek(week);
    res.json({ ok: true, week, count });
  } catch (err) {
    res.status(502).json({ error: `Sync failed: ${err.message}` });
  }
});

// Manually set (or clear) the winner if the feed is wrong or unavailable.
app.post('/api/admin/games/:gameId/result', requireAdmin, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  const winner = req.body.winner ? String(req.body.winner) : null;
  if (winner && winner !== game.home_team_id && winner !== game.away_team_id) {
    return res.status(400).json({ error: 'Winner must be one of the two teams.' });
  }
  if (winner) {
    db.prepare(`UPDATE games SET winner_team_id = ?, status = 'post', status_detail = 'Final (admin)', manual_override = 1 WHERE id = ?`)
      .run(winner, game.id);
  } else {
    db.prepare('UPDATE games SET manual_override = 0 WHERE id = ?').run(game.id); // hand control back to the feed
  }
  scores.recomputeWeek(game.week);
  res.json({ ok: true });
});

// ---------- background sync ----------

let syncing = false;
async function autoSync() {
  if (syncing || process.env.DISABLE_AUTO_SYNC) return;
  syncing = true;
  const week = config.currentWeek();
  try {
    // Refresh the current week and the next one so upcoming games are pickable early.
    const weeks = [week, week + 1].filter((w) => w <= config.SEASON_WEEKS);
    // Early in a week, late results from the prior Sunday may still be settling.
    if (week > 1 && new Date().getDay() <= 1) weeks.unshift(week - 1);
    for (const w of weeks) {
      const n = await syncWeek(w);
      console.log(`[sync] week ${w}: ${n} games`);
    }
  } catch (err) {
    console.warn(`[sync] ${err.message}`);
  } finally {
    syncing = false;
  }
}

db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
scores.backfillIfEmpty(); // fills in saved totals the first time this version starts

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Hoops Pick'em running at http://localhost:${PORT}`);
  autoSync();
  setInterval(autoSync, config.SYNC_INTERVAL_MINUTES * 60 * 1000);
});
