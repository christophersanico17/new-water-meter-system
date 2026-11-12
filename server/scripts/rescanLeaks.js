// Re-checks stored device readings for leaks that live detection missed.
//
// Until the fix in routes/devices.js, the live Leak Detected check looked at
// only the last 60 readings (5 minutes at the device's 5-second interval), so
// a 15-minute leak could never be flagged. This runs the same rule
// (utils/flowDetection.js findLeakEpisodes) over the readings already stored
// for a time range and raises a Leak Detected alert for each episode found.
//
// The alerts are honest about where they came from: the alert's flow label
// carries the real time of the leak, its threshold label says it was found by
// a rescan, it is created at the time of the rescan (not back-dated), and the
// rescan is written to the audit log.
//
// Usage (dry run by default; times are Philippine time, UTC+8):
//   node scripts/rescanLeaks.js --household HH-003 --from "2026-11-12 10:00" --to "2026-11-12 13:00"
//   node scripts/rescanLeaks.js ... --apply
const { db } = require("../src/db/database");
const alerts = require("../src/utils/alerts");
const { recordAudit } = require("../src/utils/audit");
const { getAlertSettings } = require("../src/utils/settings");
const { findLeakEpisodes } = require("../src/utils/flowDetection");

const PHT_OFFSET_MS = 8 * 3600 * 1000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

// "2026-11-12 10:00" (PHT) -> "2026-11-12 02:00:00" (UTC, SQLite format)
function phtToSql(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(text || "").trim());
  if (!m) throw new Error(`Expected "YYYY-MM-DD HH:MM" (Philippine time), got "${text}"`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - PHT_OFFSET_MS;
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function phtClock(ms) {
  const d = new Date(ms + PHT_OFFSET_MS);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

function phtDate(ms) {
  const d = new Date(ms + PHT_OFFSET_MS);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function main() {
  const householdId = arg("household");
  if (!householdId) throw new Error("--household is required");
  const fromSql = phtToSql(arg("from"));
  const toSql = phtToSql(arg("to"));
  const apply = process.argv.includes("--apply");
  const settings = getAlertSettings();

  const readings = db
    .prepare(
      `SELECT flow_rate, recorded_at FROM readings
       WHERE household_id = ? AND source = 'device' AND recorded_at >= ? AND recorded_at <= ?
       ORDER BY recorded_at ASC, id ASC`
    )
    .all(householdId, fromSql, toSql);

  const episodes = findLeakEpisodes(readings, settings);
  console.log(
    `${householdId}: ${readings.length} device readings from ${arg("from")} to ${arg("to")} PHT; ` +
      `rule = ${settings.leakFlowLpm} L/min sustained ${settings.leakSustainedMinutes}+ min ` +
      `(gap over ${settings.leakMaxGapMinutes} min breaks it); ${episodes.length} episode(s) found.`
  );

  const existsStmt = db.prepare(
    "SELECT id FROM alerts WHERE household_id = ? AND type = 'Leak Detected' AND flow_rate = ? LIMIT 1"
  );
  let created = 0;
  for (const e of episodes) {
    const flowLabel =
      `${e.avgLpm.toFixed(2)} L/min avg for ${Math.round(e.minutes)} min ` +
      `(${phtDate(e.startMs)}, ${phtClock(e.startMs)}–${phtClock(e.endMs)})`;
    const thresholdLabel =
      `${settings.leakFlowLpm} L/min sustained ${settings.leakSustainedMinutes}+ min (found by rescan)`;
    const line =
      `  flow began ${phtClock(e.startMs)}, rule met ${phtClock(e.detectMs)}, ended ${phtClock(e.endMs)}; ` +
      `${e.readings} readings, ${e.minLpm.toFixed(2)}–${e.maxLpm.toFixed(2)} L/min`;

    const existing = existsStmt.get(householdId, flowLabel);
    if (existing) {
      console.log(`${line}\n    already recorded as ${existing.id}, skipped`);
      continue;
    }
    if (!apply) {
      console.log(`${line}\n    would create: Leak Detected | ${flowLabel} | ${thresholdLabel}`);
      continue;
    }
    const alert = alerts.createAlert(householdId, "Leak Detected", flowLabel, thresholdLabel);
    recordAudit(
      { user: { name: "System (leak rescan)" } },
      "alert.leak_rescan",
      householdId,
      `Raised ${alert.id} from stored readings: ${flowLabel}`
    );
    created++;
    console.log(`${line}\n    created ${alert.id}`);
  }
  if (!apply) console.log("Dry run only. Re-run with --apply to create these alerts.");
  else console.log(`${created} alert(s) created.`);
}

main();
