// Keeps carried-over balances consistent between bills.
//
// When bills are generated, an unpaid latest bill's total_due is carried into
// the new bill as prev_balance (routes/data.js POST /bills/generate). So:
//   - paying the newer bill also pays every older bill carried into it, and
//   - paying an older bill after it was carried means the newer bill must
//     stop charging for it, or the resident pays twice.
// Every code path that sets a bill to Paid calls settleCarriedBalances, and
// mark-unpaid calls unsettleCarriedBalances to undo it.
const { db } = require("../db/database");

const CARRIED_REF_PREFIX = "CARRIED:";

const getBill = db.prepare("SELECT * FROM bills WHERE id = ?");
const getPrevBill = db.prepare("SELECT * FROM bills WHERE household_id = ? AND id < ? ORDER BY id DESC LIMIT 1");
const getNextBill = db.prepare("SELECT * FROM bills WHERE household_id = ? AND id > ? ORDER BY id LIMIT 1");
const setPrevBalance = db.prepare("UPDATE bills SET prev_balance = ?, total_due = ? WHERE id = ?");

function round2(n) {
  return +n.toFixed(2);
}

// Call right after bill `billId` was set to Paid.
function settleCarriedBalances(billId) {
  const bill = getBill.get(billId);
  if (!bill || bill.payment_status !== "Paid") return;

  // 1. Older unpaid bills whose balance this bill carried are paid with it.
  let current = bill;
  while (current.prev_balance > 0) {
    const prev = getPrevBill.get(current.household_id, current.id);
    if (!prev || prev.payment_status === "Paid") break;
    db.prepare(
      `UPDATE bills SET payment_status = 'Paid', payment_method = 'Carried', payment_ref = ?, payment_date = ?
       WHERE id = ?`
    ).run(`${CARRIED_REF_PREFIX}${bill.id}`, bill.payment_date, prev.id);
    current = prev;
  }

  // 2. If this bill had already been carried into a newer unpaid bill, take
  // it back out of that bill's balance.
  const next = getNextBill.get(bill.household_id, bill.id);
  if (next && next.payment_status === "Unpaid" && next.prev_balance > 0) {
    const prevBalance = Math.max(0, round2(next.prev_balance - bill.total_due));
    setPrevBalance.run(prevBalance, round2(next.amount + prevBalance), next.id);
  }
}

// Call right after bill `billId` was set back to Unpaid — reverses the above.
function unsettleCarriedBalances(billId) {
  const bill = getBill.get(billId);
  if (!bill) return;

  db.prepare(
    `UPDATE bills SET payment_status = 'Unpaid', payment_method = NULL, payment_ref = NULL, payment_date = NULL
     WHERE payment_ref = ?`
  ).run(`${CARRIED_REF_PREFIX}${bill.id}`);

  const next = getNextBill.get(bill.household_id, bill.id);
  if (next && next.payment_status === "Unpaid") {
    const prevBalance = round2(next.prev_balance + bill.total_due);
    setPrevBalance.run(prevBalance, round2(next.amount + prevBalance), next.id);
  }
}

module.exports = { settleCarriedBalances, unsettleCarriedBalances, CARRIED_REF_PREFIX };
