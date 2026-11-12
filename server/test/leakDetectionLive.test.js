// Checks the live Leak Detected rule against readings spaced the way the real
// device sends them (every 5 s). The pure streak function is covered in
// flowDetection.test.js; this covers the database look-back in
// routes/devices.js, which once fetched only the last 60 readings — 5 minutes
// at 5 s — so a 15-minute leak could never be detected.
// Uses an in-memory DB so this never touches the real water_system.db file.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../src/db/database");
const devices = require("../src/routes/devices");
const alerts = require("../src/utils/alerts");
const { getAlertSettings } = require("../src/utils/settings");

const REPORT_SECONDS = 5;

function sqlTimeSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function insertHousehold(id) {
  db.prepare(`INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, 1, ?)`).run(id, `Test ${id}`, `M-${id}`);
}

// One device reading every 5 s for the last `minutes`, all at `lpm`.
function insertSteadyFlow(id, minutes, lpm) {
  const insert = db.prepare(
    `INSERT INTO readings (household_id, cm3, flow_rate, source, recorded_at) VALUES (?, 0, ?, 'device', ?)`
  );
  for (let s = minutes * 60; s >= 0; s -= REPORT_SECONDS) insert.run(id, lpm, sqlTimeSecondsAgo(s));
}

test("Leak Detected fires for 16 minutes of steady 2.5 L/min flow reported every 5 s", () => {
  const settings = getAlertSettings();
  insertHousehold("HH-LEAK-1");
  insertSteadyFlow("HH-LEAK-1", 16, 2.5); // 193 readings — far more than 60

  devices.checkRealTimeFlow("HH-LEAK-1", 2.5, settings, settings.highFlowLpm);

  assert.ok(alerts.hasUnresolvedAlertOfType("HH-LEAK-1", "Leak Detected"));
});

test("Leak Detected does not fire for only 10 minutes of the same flow", () => {
  const settings = getAlertSettings();
  insertHousehold("HH-LEAK-2");
  insertSteadyFlow("HH-LEAK-2", 10, 2.5);

  devices.checkRealTimeFlow("HH-LEAK-2", 2.5, settings, settings.highFlowLpm);

  assert.ok(!alerts.hasUnresolvedAlertOfType("HH-LEAK-2", "Leak Detected"));
});
