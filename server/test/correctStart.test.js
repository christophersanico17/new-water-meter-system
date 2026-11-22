process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { db } = require("../src/db/database");
const { signToken } = require("../src/utils/auth");
const dataRoutes = require("../src/routes/data");

const app = express();
app.use(express.json());
app.use(dataRoutes);

test("correcting the starting reading recalculates the latest unpaid bill", async (t) => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)")
    .run("HH-CS-1", "Correct Start", 3, "M-CS-1");
  db.prepare("INSERT INTO admin_accounts (email, password_hash, role) VALUES (?, ?, ?)")
    .run("officer-cs@test.local", "x", "officer");
  const billId = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due)
     VALUES ('HH-CS-1', 'Oct 2026', 0, 24, 480, 0, 480)`
  ).run().lastInsertRowid;
  db.prepare("INSERT INTO readings (household_id, cm3, flow_rate, flow_type, source, recorded_at) VALUES ('HH-CS-1', 337.39, 0, 'Normal', 'device', '2026-10-31 10:00:00')").run();
  // A November reading must not become the October bill's reading.
  db.prepare("INSERT INTO readings (household_id, cm3, flow_rate, flow_type, source, recorded_at) VALUES ('HH-CS-1', 340.5, 0, 'Normal', 'device', '2026-11-20 10:00:00')").run();

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const token = signToken({ role: "admin", email: "officer-cs@test.local" });
  const post = (body) =>
    fetch(`http://127.0.0.1:${port}/bills/${billId}/correct-start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const tooHigh = await post({ prevCm3: 400 });
  assert.equal(tooHigh.status, 400);

  const ok = await post({ prevCm3: 321 });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.consumption, 16.39);
  assert.equal(body.amount, 328);

  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  assert.equal(bill.prev_cm3, 321);
  assert.equal(bill.curr_cm3, 337.39);
  assert.equal(bill.total_due, 328);
});

test("resetting to a meter reading above the bill's reading leaves the closed bill alone", async (t) => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)")
    .run("HH-RS-1", "Reset Above Bill", 3, "M-RS-1");
  const billId = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due)
     VALUES ('HH-RS-1', 'Oct 2026', 343.39, 356.6, 265, 448, 713)`
  ).run().lastInsertRowid;
  db.prepare("INSERT INTO readings (household_id, cm3, flow_rate, flow_type, source) VALUES ('HH-RS-1', 358.87, 0, 'Normal', 'device')").run();

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const token = signToken({ role: "admin", email: "officer-cs@test.local" });
  const reset = (cm3) =>
    fetch(`http://127.0.0.1:${port}/readings/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ householdId: "HH-RS-1", cm3 }),
    });

  const res = await reset(358.71);
  assert.equal(res.status, 200);
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  assert.equal(bill.curr_cm3, 356.6);
  assert.equal(bill.amount, 265);
  assert.equal(bill.total_due, 713);
  const latest = db.prepare("SELECT cm3 FROM readings WHERE household_id = 'HH-RS-1' ORDER BY id DESC LIMIT 1").get();
  assert.equal(latest.cm3, 358.71);

  // Below the bill's own reading, the bill is corrected down.
  const lower = await reset(350);
  assert.equal(lower.status, 200);
  const rebilled = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  assert.equal(rebilled.curr_cm3, 350);
  assert.equal(rebilled.amount, 200);
});

test("a manual reading after the bill's month leaves the closed bill alone", async (t) => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)")
    .run("HH-MR-1", "Manual Reading", 3, "M-MR-1");
  const billId = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due)
     VALUES ('HH-MR-1', 'Oct 2026', 343.39, 356.6, 265, 448, 713)`
  ).run().lastInsertRowid;
  db.prepare("INSERT INTO readings (household_id, cm3, flow_rate, flow_type, source) VALUES ('HH-MR-1', 358.715, 0, 'Normal', 'manual')").run();

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const token = signToken({ role: "admin", email: "officer-cs@test.local", staffRole: "officer" });
  const res = await fetch(`http://127.0.0.1:${port}/readings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ householdId: "HH-MR-1", cm3: 358.8, flowRate: 0 }),
  });
  assert.equal(res.status, 200);
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  assert.equal(bill.curr_cm3, 356.6);
  assert.equal(bill.amount, 265);
  assert.equal(bill.total_due, 713);
});

test("a bill whose month is still running follows a new manual reading", async (t) => {
  // The current month in Philippine time, e.g. "Nov 2026".
  const ph = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const period = `${months.at(ph.getUTCMonth())} ${ph.getUTCFullYear()}`;

  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)")
    .run("HH-OP-1", "Open Period", 3, "M-OP-1");
  const billId = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due)
     VALUES ('HH-OP-1', ?, 343.39, 356.6, 265, 448, 713)`
  ).run(period).lastInsertRowid;
  db.prepare("INSERT INTO readings (household_id, cm3, flow_rate, flow_type, source) VALUES ('HH-OP-1', 356.6, 0, 'Normal', 'device')").run();

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const token = signToken({ role: "admin", email: "officer-cs@test.local", staffRole: "officer" });
  const res = await fetch(`http://127.0.0.1:${port}/readings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ householdId: "HH-OP-1", cm3: 358.715, flowRate: 0 }),
  });
  assert.equal(res.status, 200);
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  assert.equal(bill.curr_cm3, 358.715);
  assert.equal(bill.amount, 307);
  assert.equal(bill.total_due, 755);
});
