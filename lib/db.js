const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pickem.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash  TEXT NOT NULL,
    salt       TEXT NOT NULL,
    is_admin   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,          -- ESPN team id
    name       TEXT NOT NULL,             -- e.g. "Notre Dame Fighting Irish"
    short_name TEXT NOT NULL,             -- e.g. "Notre Dame"
    abbrev     TEXT,
    logo       TEXT,
    color      TEXT
  );

  CREATE TABLE IF NOT EXISTS games (
    id           TEXT PRIMARY KEY,        -- ESPN event id
    week         INTEGER NOT NULL,
    start_time   TEXT NOT NULL,           -- ISO 8601 UTC
    home_team_id TEXT NOT NULL REFERENCES teams(id),
    away_team_id TEXT NOT NULL REFERENCES teams(id),
    home_rank    INTEGER,
    away_rank    INTEGER,
    home_record  TEXT,
    away_record  TEXT,
    home_score   INTEGER,
    away_score   INTEGER,
    status       TEXT NOT NULL DEFAULT 'pre',  -- pre | in | post | canceled
    status_detail TEXT,
    winner_team_id TEXT REFERENCES teams(id),
    neutral_site INTEGER NOT NULL DEFAULT 0,
    venue        TEXT,
    manual_override INTEGER NOT NULL DEFAULT 0, -- admin set the result; sync won't overwrite it
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS games_week ON games(week, start_time);

  CREATE TABLE IF NOT EXISTS picks (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id    TEXT NOT NULL REFERENCES teams(id),
    picked_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game_id)
  );
  CREATE INDEX IF NOT EXISTS picks_game ON picks(game_id);
`);

// Columns added after the first release.
const gameCols = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
if (!gameCols.includes('time_tbd')) db.exec('ALTER TABLE games ADD COLUMN time_tbd INTEGER NOT NULL DEFAULT 0');

module.exports = db;
