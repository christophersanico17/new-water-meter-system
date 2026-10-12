process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../src/db/database");
const { settleCarriedBalances, applyPartialPayment, outstandingOf } = require("../src/utils/billing");

const row = (id) => db.prepare("SELECT * FROM bills WHERE id = ?").get(id);

test("a partial payment leaves the rest owed and carries it into the next bill", () => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)")
    .run("HH-PP-1", "Partial Test", 1, "M-PP-1");
  const oct = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due)
     VALUES ('HH-PP-1', 'Oct 2026', 0, 20, 400, 0, 400)`
  ).run().lastInsertRowid;
  const nov = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due)
     VALUES ('HH-PP-1', 'Nov 2026', 20, 30, 200, 400, 600)`
  ).run().lastInsertRowid;

  // Resident pays 300 of the 400 October bill.
  db.prepare("UPDATE bills SET amount_paid = 300 WHERE id = ?").run(oct);
  applyPartialPayment(oct, 300);

  assert.equal(outstandingOf(row(oct)), 100);
  assert.equal(row(oct).payment_status, "Unpaid");
  assert.equal(row(nov).prev_balance, 100);
  assert.equal(row(nov).total_due, 300);
});

test("paying the rest of a partly paid bill clears the carried balance", () => {
  const oct = db.prepare("SELECT id FROM bills WHERE household_id = 'HH-PP-1' AND period = 'Oct 2026'").get().id;
  const nov = db.prepare("SELECT id FROM bills WHERE household_id = 'HH-PP-1' AND period = 'Nov 2026'").get().id;

  // Resident pays the remaining 100.
  const owed = outstandingOf(row(oct));
  db.prepare("UPDATE bills SET payment_status = 'Paid', amount_paid = total_due WHERE id = ?").run(oct);
  settleCarriedBalances(oct, owed);

  assert.equal(outstandingOf(row(oct)), 0);
  assert.equal(row(nov).prev_balance, 0);
  assert.equal(row(nov).total_due, 200);
});

// ── Route checks: amounts the admin types in ─────────────────────────────
const express = require("express");
const dataRoutes = require("../src/routes/data");
const { signToken } = require("../src/utils/auth");

const app = express();
app.use(express.json());
app.use(dataRoutes);

test("the mark-paid route records a partial payment and rejects overpayment", async (t) => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)")
    .run("HH-RT-1", "Route Test", 2, "M-RT-1");
  db.prepare("INSERT INTO admin_accounts (email, password_hash, role) VALUES (?, ?, ?)")
    .run("officer@test.local", "x", "officer");
  const billId = db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due)
     VALUES ('HH-RT-1', 'Oct 2026', 0, 20, 400, 0, 400)`
  ).run().lastInsertRowid;

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const token = signToken({ role: "admin", email: "officer@test.local" });
  const post = (body) =>
    fetch(`http://127.0.0.1:${port}/bills/${billId}/mark-paid`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const over = await post({ method: "Offline", amount: 500 });
  assert.equal(over.status, 400);

  const partial = await post({ method: "Offline", amount: 300 });
  assert.equal(partial.status, 200);
  assert.equal(row(billId).payment_status, "Unpaid");
  assert.equal(row(billId).amount_paid, 300);
  assert.equal(outstandingOf(row(billId)), 100);

  const rest = await post({ method: "Offline", amount: 100 });
  assert.equal(rest.status, 200);
  assert.equal(row(billId).payment_status, "Paid");
  assert.equal(row(billId).amount_paid, 400);
});
