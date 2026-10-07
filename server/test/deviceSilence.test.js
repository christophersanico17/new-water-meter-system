// Uses an in-memory DB so this never touches the real water_system.db file.
// JWT_SECRET is only needed because routes/devices.js requires utils/auth,
// which throws at load time if it's unset — the value itself is unused here.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../src/db/database");
const devices = require("../src/routes/devices");
const alerts = require("../src/utils/alerts");
const { updateAlertSettings } = require("../src/utils/settings");

function sqlTime(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60000).toISOString().slice(0, 19).replace("T", " ");
}

function insertProvisionedHousehold(id, minutesSinceLastSeen) {
  db.prepare(
    `INSERT INTO households (id, name, standpost, meter, device_key, device_last_seen) VALUES (?, ?, 1, ?, ?, ?)`
  ).run(id, `Test household ${id}`, `M-${id}`, `dev_test_${id}`, sqlTime(minutesSinceLastSeen));
}

test("checkDeviceSilence raises No Sensor Data for a household past the configured threshold", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-1", 45); // silent for 45 min, threshold is 30

  devices.checkDeviceSilence();

  assert.ok(alerts.hasUnresolvedAlertOfType("HH-SIL-1", "No Sensor Data"));
});

test("checkDeviceSilence leaves a household alone while still within the threshold", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-2", 5); // only silent for 5 min

  devices.checkDeviceSilence();

  assert.ok(!alerts.hasUnresolvedAlertOfType("HH-SIL-2", "No Sensor Data"));
});

test("checkDeviceSilence does not raise a second alert while one is already open", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-3", 45);

  devices.checkDeviceSilence();
  devices.checkDeviceSilence(); // simulate a second sweep a few minutes later

  const count = db
    .prepare("SELECT COUNT(*) AS n FROM alerts WHERE household_id = ? AND type = 'No Sensor Data'")
    .get("HH-SIL-3").n;
  assert.equal(count, 1);
});

test("a fresh reading auto-resolves an open No Sensor Data alert for that household", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-4", 45);
  devices.checkDeviceSilence();
  assert.ok(alerts.hasUnresolvedAlertOfType("HH-SIL-4", "No Sensor Data"));

  alerts.autoResolve("HH-SIL-4", "No Sensor Data"); // what the readings handler calls on every ingest

  assert.ok(!alerts.hasUnresolvedAlertOfType("HH-SIL-4", "No Sensor Data"));
});

test("a sensor that drops out again soon after recovering reopens its alert instead of adding a new one", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30, alertThrottleMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-5", 45);
  devices.checkDeviceSilence();
  alerts.autoResolve("HH-SIL-5", "No Sensor Data"); // device came back briefly...

  devices.checkDeviceSilence(); // ...then went silent again

  const rows = db
    .prepare("SELECT status FROM alerts WHERE household_id = ? AND type = 'No Sensor Data'")
    .all("HH-SIL-5");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Unresolved");
});

test("a dropout long after the last alert was resolved raises a new alert", () => {
  updateAlertSettings({ deviceSilenceMinutes: 30, alertThrottleMinutes: 30 });
  insertProvisionedHousehold("HH-SIL-6", 45);
  devices.checkDeviceSilence();
  alerts.autoResolve("HH-SIL-6", "No Sensor Data");
  db.prepare("UPDATE alerts SET resolved_at = ? WHERE household_id = ?").run(sqlTime(120), "HH-SIL-6");

  devices.checkDeviceSilence();

  const count = db
    .prepare("SELECT COUNT(*) AS n FROM alerts WHERE household_id = ? AND type = 'No Sensor Data'")
    .get("HH-SIL-6").n;
  assert.equal(count, 2);
});
