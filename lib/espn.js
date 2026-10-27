// Pulls the Division I men's basketball schedule, logos and final scores from
// ESPN's public scoreboard feed. groups=50 is ESPN's "Division I" filter.
const db = require('./db');
const { weekRange } = require('./config');

const SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';

const upsertTeam = db.prepare(`
  INSERT INTO teams (id, name, short_name, abbrev, logo, color)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, short_name = excluded.short_name, abbrev = excluded.abbrev,
    logo = COALESCE(excluded.logo, teams.logo), color = COALESCE(excluded.color, teams.color)
`);

const upsertGame = db.prepare(`
  INSERT INTO games (id, week, start_time, home_team_id, away_team_id, home_rank, away_rank,
                     home_record, away_record, home_score, away_score, status, status_detail,
                     winner_team_id, neutral_site, venue)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    week = excluded.week, start_time = excluded.start_time,
    home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id,
    home_rank = excluded.home_rank, away_rank = excluded.away_rank,
    home_record = excluded.home_record, away_record = excluded.away_record,
    home_score = excluded.home_score, away_score = excluded.away_score,
    status = excluded.status, status_detail = excluded.status_detail,
    winner_team_id = excluded.winner_team_id, neutral_site = excluded.neutral_site,
    venue = excluded.venue, updated_at = datetime('now')
  WHERE games.manual_override = 0
`);

function teamLogo(team) {
  if (team.logo) return team.logo;
  if (team.logos && team.logos[0]) return team.logos[0].href;
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${team.id}.png`;
}

function mapStatus(type) {
  const name = type.name || '';
  if (/CANCELED|POSTPONED|FORFEIT|SUSPENDED/.test(name)) return 'canceled';
  if (type.completed || type.state === 'post') return 'post';
  if (type.state === 'in') return 'in';
  return 'pre';
}

function saveEvent(event, week) {
  const comp = event.competitions && event.competitions[0];
  if (!comp || !comp.competitors || comp.competitors.length !== 2) return false;
  const home = comp.competitors.find((c) => c.homeAway === 'home') || comp.competitors[0];
  const away = comp.competitors.find((c) => c.homeAway === 'away') || comp.competitors[1];

  for (const c of [home, away]) {
    const t = c.team;
    upsertTeam.run(
      String(t.id),
      t.displayName || t.name,
      t.shortDisplayName || t.location || t.displayName,
      t.abbreviation || null,
      teamLogo(t),
      t.color ? `#${t.color}` : null,
    );
  }

  const status = mapStatus(comp.status.type);
  let winner = null;
  if (status === 'post') {
    const w = comp.competitors.find((c) => c.winner);
    if (w) winner = String(w.team.id);
  }
  const rank = (c) => {
    const r = c.curatedRank && c.curatedRank.current;
    return r && r <= 25 ? r : null;
  };
  const record = (c) => (c.records && c.records[0] ? c.records[0].summary : null);
  const score = (c) => (status === 'pre' || c.score == null ? null : Number(c.score));

  upsertGame.run(
    String(event.id), week, new Date(event.date).toISOString(),
    String(home.team.id), String(away.team.id),
    rank(home), rank(away), record(home), record(away),
    score(home), score(away), status, comp.status.type.shortDetail || comp.status.type.detail || null,
    winner, comp.neutralSite ? 1 : 0, (comp.venue && comp.venue.fullName) || null,
  );
  return true;
}

async function fetchDay(ymd) {
  const url = `${SCOREBOARD}?dates=${ymd.replaceAll('-', '')}&groups=50&limit=500`;
  const res = await fetch(url, { headers: { 'User-Agent': 'hoops-pickem/1.0' } });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${ymd}`);
  const data = await res.json();
  return data.events || [];
}

async function syncWeek(week) {
  const { days } = weekRange(week);
  let count = 0;
  for (const day of days) {
    const events = await fetchDay(day);
    db.exec('BEGIN');
    try {
      for (const ev of events) if (saveEvent(ev, week)) count++;
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return count;
}

module.exports = { syncWeek };
