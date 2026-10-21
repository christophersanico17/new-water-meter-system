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
  db.prepare("INSERT INTO readings (household_id, cm3, flow_rate, flow_type, source) VALUES ('HH-CS-1', 337.39, 0, 'Normal', 'device')").run();

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
  assert.equal(body.amount, 327.8);

  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  assert.equal(bill.prev_cm3, 321);
  assert.equal(bill.curr_cm3, 337.39);
  assert.equal(bill.total_due, 327.8);
});
