// Pure arithmetic, no database needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { RATE_PER_CM3, MIN_BILL, computeBillAmount } = require("../src/utils/tariff");

test("the barangay rate is ₱20 per cubic meter with a ₱200 minimum", () => {
  assert.equal(RATE_PER_CM3, 20);
  assert.equal(MIN_BILL, 200);
});

test("bills at the per-cubic-meter rate above the minimum", () => {
  assert.equal(computeBillAmount(12), 240);
});

test("never bills less than the minimum", () => {
  assert.equal(computeBillAmount(0), 200);
  assert.equal(computeBillAmount(3), 200);
});

test("rounds up to the next whole peso", () => {
  assert.equal(computeBillAmount(10.01), 201);
});
