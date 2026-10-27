// Usage: npm run sync -- [week ...]   (defaults to the current week)
const { syncWeek } = require('../lib/espn');
const { currentWeek } = require('../lib/config');

(async () => {
  const weeks = process.argv.slice(2).map(Number).filter(Boolean);
  for (const w of weeks.length ? weeks : [currentWeek()]) {
    const n = await syncWeek(w);
    console.log(`week ${w}: ${n} games synced`);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
