// Keeps carried-over balances consistent between bills.
//
// When bills are generated, the amount still owed on an older bill is carried
// into the next bill as prev_balance (routes/data.js POST /bills/generate). So:
//   - paying the newer bill also pays every older bill carried into it, and
//   - any payment on an older bill (full or partial) must reduce what the newer
//     bill charges for it, or the resident pays twice.
// Every payment path calls settleCarriedBalances (full payment) or
// applyPartialPayment (partial payment). mark-unpaid calls
// unsettleCarriedBalances to undo them.
const { db } = require("../db/database");

const CARRIED_REF_PREFIX = "CARRIED:";

const getBill = db.prepare("SELECT * FROM bills WHERE id = ?");
const getPrevBill = db.prepare("SELECT * FROM bills WHERE household_id = ? AND id < ? ORDER BY id DESC LIMIT 1");
const getNextBill = db.prepare("SELECT * FROM bills WHERE household_id = ? AND id > ? ORDER BY id LIMIT 1");
const setPrevBalance = db.prepare("UPDATE bills SET prev_balance = ?, total_due = ? WHERE id = ?");

function round2(n) {
  return +n.toFixed(2);
}

// What is still owed on a bill. A Paid bill owes nothing.
function outstandingOf(bill) {
  if (bill.payment_status === "Paid") return 0;
  return Math.max(0, round2(bill.total_due - (bill.amount_paid || 0)));
}

// Takes `amount` out of the balance carried into the next unpaid bill.
function reduceCarriedInto(billId, amount) {
  const bill = getBill.get(billId);
  if (!bill) return;
  const next = getNextBill.get(bill.household_id, bill.id);
  if (!next || next.payment_status !== "Unpaid" || next.prev_balance <= 0) return;
  const prevBalance = Math.max(0, round2(next.prev_balance - amount));
  setPrevBalance.run(prevBalance, round2(next.amount + prevBalance), next.id);
}

// Call right after a partial payment of `paidNow` was recorded on bill `billId`.
function applyPartialPayment(billId, paidNow) {
  reduceCarriedInto(billId, paidNow);
}

// Call right after bill `billId` was set to Paid. `paidNow` is what this
// payment settled (defaults to the whole bill).
function settleCarriedBalances(billId, paidNow) {
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

  // 2. Take what was just paid out of the balance carried into the next bill.
  reduceCarriedInto(bill.id, paidNow ?? bill.total_due);
}

// Call right after bill `billId` was set back to Unpaid — reverses the above.
// `paidBack` is the total that had been paid on this bill (defaults to the bill total).
function unsettleCarriedBalances(billId, paidBack) {
  const bill = getBill.get(billId);
  if (!bill) return;

  db.prepare(
    `UPDATE bills SET payment_status = 'Unpaid', payment_method = NULL, payment_ref = NULL, payment_date = NULL
     WHERE payment_ref = ?`
  ).run(`${CARRIED_REF_PREFIX}${bill.id}`);

  const next = getNextBill.get(bill.household_id, bill.id);
  if (next && next.payment_status === "Unpaid") {
    const prevBalance = round2(next.prev_balance + (paidBack ?? bill.total_due));
    setPrevBalance.run(prevBalance, round2(next.amount + prevBalance), next.id);
  }
}

module.exports = {
  settleCarriedBalances,
  unsettleCarriedBalances,
  applyPartialPayment,
  outstandingOf,
  CARRIED_REF_PREFIX,
};
