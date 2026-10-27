// Season settings. Override with environment variables when deploying.
const SEASON_START = process.env.SEASON_START || '2026-11-02'; // Monday of week 1 (YYYY-MM-DD)
// Games before that first Monday (the season tips off on a Sunday) are folded into week 1.
const OPENING_DAY = process.env.OPENING_DAY || '2026-11-01';
const SEASON_WEEKS = Number(process.env.SEASON_WEEKS || 23);   // through the national championship
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 10);

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

// Each week runs Monday through Sunday (calendar dates, US time).
function weekRange(week) {
  const start = new Date(parseDate(SEASON_START).getTime() + (week - 1) * 7 * DAY_MS);
  const days = [];
  if (week === 1) {
    for (let d = parseDate(OPENING_DAY); d < start; d = new Date(d.getTime() + DAY_MS)) days.push(fmt(d));
  }
  for (let i = 0; i < 7; i++) days.push(fmt(new Date(start.getTime() + i * DAY_MS)));
  return { week, start: days[0], end: days[days.length - 1], days };
}

// Week number for "today" in US Eastern time, clamped to the season.
function currentWeek(now = new Date()) {
  const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  const diff = Math.floor((parseDate(eastern) - parseDate(SEASON_START)) / DAY_MS);
  const week = Math.floor(diff / 7) + 1;
  return Math.min(Math.max(week, 1), SEASON_WEEKS);
}

function allWeeks() {
  return Array.from({ length: SEASON_WEEKS }, (_, i) => weekRange(i + 1));
}

module.exports = { SEASON_START, SEASON_WEEKS, SYNC_INTERVAL_MINUTES, weekRange, currentWeek, allWeeks };
