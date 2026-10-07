// Uses an in-memory DB so this never touches the real water_system.db file.
process.env.DB_PATH = ":memory:";

const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../src/db/database");
const { settleCarriedBalances, unsettleCarriedBalances } = require("../src/utils/billing");

function addHousehold(id) {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, 1, ?)").run(id, `Test ${id}`, `M-${id}`);
}

function addBill(householdId, period, amount, prevBalance, status = "Unpaid") {
  return db
    .prepare(
      `INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, prev_balance, total_due, payment_status)
       VALUES (?, ?, 0, 0, ?, ?, ?, ?)`
    )
    .run(householdId, period, amount, prevBalance, amount + prevBalance, status).lastInsertRowid;
}

function markPaid(id) {
  db.prepare("UPDATE bills SET payment_status = 'Paid', payment_method = 'Offline', payment_date = '2026-10-07 08:00:00' WHERE id = ?").run(id);
  settleCarriedBalances(id);
}

const bill = (id) => db.prepare("SELECT * FROM bills WHERE id = ?").get(id);

test("paying a bill also settles the older unpaid bills carried into it", () => {
  addHousehold("HH-B1");
  const apr = addBill("HH-B1", "Apr 2026", 200, 0);
  const may = addBill("HH-B1", "May 2026", 200, 200); // carries April
  const oct = addBill("HH-B1", "Oct 2026", 200, 400); // carries May (which carries April)

  markPaid(oct);

  for (const id of [apr, may]) {
    assert.equal(bill(id).payment_status, "Paid");
    assert.equal(bill(id).payment_method, "Carried");
    assert.equal(bill(id).payment_date, "2026-10-07 08:00:00");
  }
});

test("paying an older bill after it was carried removes it from the newer bill", () => {
  addHousehold("HH-B2");
  const may = addBill("HH-B2", "May 2026", 200, 0, "GCash Pending");
  const oct = addBill("HH-B2", "Oct 2026", 200, 200); // carried the pending May bill

  markPaid(may); // the pending GCash payment is confirmed afterwards

  assert.equal(bill(oct).prev_balance, 0);
  assert.equal(bill(oct).total_due, 200);
});

test("marking a bill unpaid again reverses the settlement", () => {
  addHousehold("HH-B3");
  const may = addBill("HH-B3", "May 2026", 200, 0);
  const oct = addBill("HH-B3", "Oct 2026", 200, 200);
  markPaid(oct);

  db.prepare("UPDATE bills SET payment_status = 'Unpaid', payment_method = NULL, payment_ref = NULL, payment_date = NULL WHERE id = ?").run(oct);
  unsettleCarriedBalances(oct);

  assert.equal(bill(may).payment_status, "Unpaid");
  assert.equal(bill(may).payment_method, null);
  assert.equal(bill(oct).total_due, 400);
});

test("a bill with no carried balance leaves other bills untouched", () => {
  addHousehold("HH-B4");
  const may = addBill("HH-B4", "May 2026", 200, 0);
  const oct = addBill("HH-B4", "Oct 2026", 200, 0); // May was not carried

  markPaid(oct);

  assert.equal(bill(may).payment_status, "Unpaid");
});
