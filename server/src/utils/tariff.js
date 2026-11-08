// The water tariff: the rate per cubic meter and the minimum bill.
// Stored in app_settings so a water officer can change it from the admin
// Settings page. Bills read the current values when they are generated, so a
// change applies to bills generated after it is saved; bills already issued
// keep their amounts.
// Units: the readings column "cm3" stores cubic meters (m³).

const { db } = require("../db/database");

const TARIFF_DEFAULTS = { ratePerCm3: 20, minBill: 200 }; // ₱20 per m³, ₱200 minimum
const SETTINGS_KEY = "tariff";
const MAX_RATE = 1000; // guards against a typo such as an extra zero
const MAX_MIN_BILL = 10000;

const getStmt = db.prepare("SELECT value FROM app_settings WHERE key = ?");
const upsertStmt = db.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
);

function getTariff() {
  const row = getStmt.get(SETTINGS_KEY);
  if (!row) return { ...TARIFF_DEFAULTS };
  try {
    return { ...TARIFF_DEFAULTS, ...JSON.parse(row.value) };
  } catch {
    // Corrupt stored value: fall back to the defaults rather than failing every bill.
    return { ...TARIFF_DEFAULTS };
  }
}

// Applies whichever of ratePerCm3 / minBill are present. Both are checked
// before anything is written, so a bad request changes nothing.
function updateTariff(partial) {
  const next = { ...getTariff() };
  if (partial.ratePerCm3 !== undefined) {
    const v = Number(partial.ratePerCm3);
    if (!Number.isFinite(v) || v <= 0 || v > MAX_RATE) {
      throw new Error(`Rate per m³ must be a number above 0 and up to ${MAX_RATE}.`);
    }
    next.ratePerCm3 = v;
  }
  if (partial.minBill !== undefined) {
    const v = Number(partial.minBill);
    if (!Number.isFinite(v) || v < 0 || v > MAX_MIN_BILL) {
      throw new Error(`Minimum bill must be between 0 and ${MAX_MIN_BILL}.`);
    }
    next.minBill = v;
  }
  upsertStmt.run(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// Bills are whole pesos: the amount is rounded up to the next peso.
function computeBillAmount(consumptionCm3) {
  const { ratePerCm3, minBill } = getTariff();
  return Math.ceil(Math.max(consumptionCm3 * ratePerCm3, minBill));
}

module.exports = { TARIFF_DEFAULTS, getTariff, updateTariff, computeBillAmount };
