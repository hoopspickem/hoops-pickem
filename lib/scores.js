// Saved weekly totals, so the leaderboard never has to re-add every pick on a page load.
// A week's totals are rebuilt whenever its results may have changed (each sync, admin edits).
const db = require('./db');

const clearWeek = db.prepare('DELETE FROM user_week_scores WHERE week = ?');
const fillWeek = db.prepare(`
  INSERT INTO user_week_scores (user_id, week, points, graded)
  SELECT p.user_id, g.week, SUM(p.team_id = g.winner_team_id), COUNT(*)
  FROM games g JOIN picks p ON p.game_id = g.id
  WHERE g.week = ? AND g.winner_team_id IS NOT NULL
  GROUP BY p.user_id
`);

let version = 0; // bumps whenever standings may have changed

function recomputeWeek(week) {
  db.exec('BEGIN');
  try {
    clearWeek.run(week);
    fillWeek.run(week);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  version++;
}

// Only needed the first time this version runs against an existing database.
function backfillIfEmpty() {
  if (db.prepare('SELECT 1 FROM user_week_scores LIMIT 1').get()) return;
  for (const { week } of db.prepare('SELECT DISTINCT week FROM games WHERE winner_team_id IS NOT NULL').all()) {
    recomputeWeek(week);
  }
}

const bump = () => { version++; };
const currentVersion = () => version;

module.exports = { recomputeWeek, backfillIfEmpty, bump, currentVersion };
