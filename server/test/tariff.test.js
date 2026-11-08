// Uses an in-memory DB so this never touches the real water_system.db file.
process.env.DB_PATH = ":memory:";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TARIFF_DEFAULTS, getTariff, updateTariff, computeBillAmount } = require("../src/utils/tariff");

test("starts at the default rate and minimum", () => {
  assert.deepEqual(getTariff(), TARIFF_DEFAULTS);
  assert.equal(computeBillAmount(12), 12 * TARIFF_DEFAULTS.ratePerCm3);
});

test("never bills less than the minimum", () => {
  assert.equal(computeBillAmount(0), TARIFF_DEFAULTS.minBill);
  assert.equal(computeBillAmount(3), TARIFF_DEFAULTS.minBill);
});

test("rounds up to the next whole peso", () => {
  assert.equal(computeBillAmount(10.01), Math.ceil(10.01 * TARIFF_DEFAULTS.ratePerCm3));
});

test("a saved change applies to later bills", () => {
  updateTariff({ ratePerCm3: 25, minBill: 300 });
  assert.equal(getTariff().ratePerCm3, 25);
  assert.equal(computeBillAmount(12), 300);
  assert.equal(computeBillAmount(20), 500);
});

test("rejects invalid values and changes nothing", () => {
  updateTariff({ ratePerCm3: 30, minBill: 200 });
  assert.throws(() => updateTariff({ ratePerCm3: 0 }), /Rate per m³/);
  assert.throws(() => updateTariff({ ratePerCm3: 5000 }), /Rate per m³/);
  assert.throws(() => updateTariff({ ratePerCm3: "abc" }), /Rate per m³/);
  assert.throws(() => updateTariff({ minBill: -1 }), /Minimum bill/);
  assert.equal(getTariff().ratePerCm3, 30);
  assert.equal(getTariff().minBill, 200);
});
