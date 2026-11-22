// A bill generated before its month ends keeps following the meter until the
// month is over; a bill for a month that has ended stays as it was.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../src/db/database");
const { isPeriodOpen, syncOpenBillToReading } = require("../src/utils/billing");

function currentPeriod() {
  const ph = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months.at(ph.getUTCMonth())} ${ph.getUTCFullYear()}`;
}

function addBill(id, period, status = "Unpaid") {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, 3, ?)").run(id, `Test ${id}`, `M-${id}`);
  return db.prepare(
    `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due, payment_status)
     VALUES (?, ?, 343.39, 356.6, 265, 448, 713, ?)`
  ).run(id, period, status).lastInsertRowid;
}

test("isPeriodOpen is true only before the month ends in Philippine time", () => {
  const nov30Late = Date.UTC(2026, 10, 30, 15, 59); // Nov 30, 11:59 PM PH
  const dec1Early = Date.UTC(2026, 10, 30, 16, 1); // Dec 1, 12:01 AM PH
  assert.equal(isPeriodOpen("Nov 2026", nov30Late), true);
  assert.equal(isPeriodOpen("Nov 2026", dec1Early), false);
});

test("an unpaid current-month bill follows a higher reading", () => {
  const billId = addBill("HH-SY-1", currentPeriod());
  const result = syncOpenBillToReading("HH-SY-1", 358.715);
  assert.deepEqual(result, { period: currentPeriod(), currCm3: 358.715, consumption: 15.325, amount: 307, totalDue: 755 });
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  assert.equal(bill.curr_cm3, 358.715);
  assert.equal(bill.total_due, 755);
});

test("a bill for a month that has ended, or one being paid, is left alone", () => {
  addBill("HH-SY-2", "Oct 2026");
  assert.equal(syncOpenBillToReading("HH-SY-2", 358.715), null);
  addBill("HH-SY-3", currentPeriod(), "GCash Pending");
  assert.equal(syncOpenBillToReading("HH-SY-3", 358.715), null);
  addBill("HH-SY-4", currentPeriod());
  assert.equal(syncOpenBillToReading("HH-SY-4", 356.6), null);
});
