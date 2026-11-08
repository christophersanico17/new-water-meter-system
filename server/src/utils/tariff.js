// The water tariff, fixed as the barangay requires: ₱20 per cubic meter with a
// ₱200 minimum bill. This is the one place these values are defined. Bills are
// calculated here (routes/data.js), and the app reads the same values from
// GET /api/tariff.
// Units: the readings column "cm3" stores cubic meters (m³).

const RATE_PER_CM3 = 20; // ₱ per cubic meter
const MIN_BILL = 200; // ₱ minimum for any billed period

// Bills are whole pesos: the amount is rounded up to the next peso.
function computeBillAmount(consumptionCm3) {
  return Math.ceil(Math.max(consumptionCm3 * RATE_PER_CM3, MIN_BILL));
}

module.exports = { RATE_PER_CM3, MIN_BILL, computeBillAmount };
