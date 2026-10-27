# Hoops Pick'em 🏀

A weekly pick'em site for every NCAA Division I men's basketball game. Players click a team's
logo to pick the winner of each game (for example, Notre Dame vs. Villanova in week 1). When a game
goes final, everyone who picked the winner gets 1 point.

## Features
- **Every D1 game, every week.** The schedule, team logos, rankings, records and final scores come
  from ESPN's public scoreboard feed (`groups=50` = Division I). The server re-syncs every 10 minutes.
- **Logo-based picking.** Click a logo to pick, click it again to clear, or click the other team to switch.
- **Picks lock at tip-off.** After a game starts, picks can't change, and the split of everyone's picks is shown.
- **Automatic scoring.** 1 point per correct pick. Canceled or postponed games don't count.
- **Leaderboard** for the season and for each week (record and win %).
- **Filters:** team search, Top 25 only, and games you still need to pick.
- **Admin tools** (the first account created becomes the admin): sync a week on demand, or set or
  override a game's winner if the feed is wrong.
- Accounts with hashed passwords (scrypt) and HTTP-only session cookies. Works on phones, with dark mode.

## Run it
Requires Node.js 22.5 or newer (it uses the built-in `node:sqlite`, so there are no native dependencies).

```bash
npm install
npm start                # http://localhost:3000
```

Optional: `npm run seed-demo` loads a sample week with finished, live and upcoming games, plus three
demo players (password `password`). Use it to try the site before the season starts.

`npm run sync -- 1 2 3` pulls specific weeks from ESPN manually.

## Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `SEASON_START` | `2026-11-02` | Monday of week 1 (weeks run Monday–Sunday) |
| `SEASON_WEEKS` | `23` | Number of weeks (through the Final Four) |
| `SYNC_INTERVAL_MINUTES` | `10` | How often to pull scores |
| `DB_PATH` | `data/pickem.db` | SQLite file location |
| `NODE_ENV` | — | Set to `production` behind HTTPS to mark cookies `Secure` |
| `DISABLE_AUTO_SYNC` | — | Set to turn off background syncing |

## Deploy
The app needs a host that keeps its SQLite file between restarts. Ready-made configs are included:

**Render (easiest):** push this folder to a GitHub repo. In Render, go to **New → Blueprint** and pick
the repo. `render.yaml` sets up a Docker web service on the Starter plan (about $7/month) with a 1 GB
disk at `/data`. Render's free plan works for a quick look, but it erases the database whenever the
instance sleeps, so picks disappear.

**Fly.io:** `fly launch --copy-config --no-deploy`, then `fly volumes create data --size 1`, then `fly deploy`.

**Anything else:** build the `Dockerfile` and mount a volume at `/data`.

After the first deploy, sign up right away. The first account becomes the admin. Optionally run
`npm run seed-demo` on the server (Render Shell / `fly ssh console`) to load sample games for testing.

## Project layout
```
server.js          Express API: auth, games, picks, leaderboard, admin, background sync
lib/config.js      Season and week calendar
lib/db.js          SQLite schema
lib/espn.js        ESPN scoreboard import (teams, logos, games, results)
public/            Front end (vanilla HTML/CSS/JS, no build step)
scripts/           sync and demo-seed CLIs
```

ESPN's scoreboard API is unofficial and undocumented. If it changes or goes down, admins can still
set results by hand from the Picks page.
