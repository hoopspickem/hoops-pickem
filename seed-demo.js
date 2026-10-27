// Loads a sample week (finished, live and upcoming games) plus a few demo players,
// so the site can be tried out before the season starts or without network access.
const crypto = require('node:crypto');
const db = require('../lib/db');
const { currentWeek } = require('../lib/config');

const week = currentWeek();
const logo = (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;

const teams = [
  ['87', 'Notre Dame Fighting Irish', 'Notre Dame', 'ND', '#0c2340'],
  ['222', 'Villanova Wildcats', 'Villanova', 'VILL', '#003366'],
  ['150', 'Duke Blue Devils', 'Duke', 'DUKE', '#00539b'],
  ['153', 'North Carolina Tar Heels', 'North Carolina', 'UNC', '#7bafd4'],
  ['96', 'Kentucky Wildcats', 'Kentucky', 'UK', '#0033a0'],
  ['2305', 'Kansas Jayhawks', 'Kansas', 'KU', '#0051ba'],
  ['2250', 'Gonzaga Bulldogs', 'Gonzaga', 'GONZ', '#002967'],
  ['41', 'UConn Huskies', 'UConn', 'CONN', '#000e2f'],
  ['2509', 'Purdue Boilermakers', 'Purdue', 'PUR', '#9d7a2b'],
  ['248', 'Houston Cougars', 'Houston', 'HOU', '#c8102e'],
  ['12', 'Arizona Wildcats', 'Arizona', 'ARIZ', '#cc0033'],
  ['127', 'Michigan State Spartans', 'Michigan State', 'MSU', '#18453b'],
];

const H = 3600e3;
const now = Date.now();
// [id, away, home, startOffsetHours, status, awayScore, homeScore, awayRank, homeRank]
const games = [
  ['demo1', '222', '87', -26, 'post', 71, 68, null, null],
  ['demo2', '153', '150', -24, 'post', 74, 82, 14, 4],
  ['demo3', '2305', '96', -1, 'in', 41, 38, 9, 21],
  ['demo4', '41', '2250', 3, 'pre', null, null, 2, 11],
  ['demo5', '248', '2509', 27, 'pre', null, null, 6, 3],
  ['demo6', '127', '12', 50, 'pre', null, null, 17, 8],
];

db.exec('BEGIN');
const t = db.prepare('INSERT OR REPLACE INTO teams (id, name, short_name, abbrev, logo, color) VALUES (?, ?, ?, ?, ?, ?)');
for (const [id, name, short, ab, color] of teams) t.run(id, name, short, ab, logo(id), color);

const g = db.prepare(`INSERT OR REPLACE INTO games (id, week, start_time, home_team_id, away_team_id, home_rank, away_rank,
  home_record, away_record, home_score, away_score, status, status_detail, winner_team_id, neutral_site, venue)
  VALUES (?, ?, ?, ?, ?, ?, ?, '0-0', '0-0', ?, ?, ?, ?, ?, 0, NULL)`);
for (const [id, away, home, off, status, as, hs, ar, hr] of games) {
  const winner = status === 'post' ? (hs > as ? home : away) : null;
  const detail = status === 'post' ? 'Final' : status === 'in' ? '2nd Half 12:31' : null;
  g.run(id, week, new Date(now + off * H).toISOString(), home, away, hr, ar, hs, as, status, detail, winner);
}

const players = { hoopsfan: ['222', '150', '2305'], bracketqueen: ['87', '150', '96'], madness22: ['222', '153', '2305'] };
const u = db.prepare('INSERT OR IGNORE INTO users (username, pass_hash, salt) VALUES (?, ?, ?)');
const p = db.prepare('INSERT OR REPLACE INTO picks (user_id, game_id, team_id) VALUES (?, ?, ?)');
for (const [name, picks] of Object.entries(players)) {
  const salt = crypto.randomBytes(16).toString('hex');
  u.run(name, crypto.scryptSync('password', salt, 64).toString('hex'), salt);
  const { id } = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  picks.forEach((team, i) => p.run(id, games[i][0], team));
}
db.exec('COMMIT');
console.log(`Demo data loaded into week ${week}. Demo players (password "password"): ${Object.keys(players).join(', ')}`);
