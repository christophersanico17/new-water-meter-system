const express = require("express");
const { authMiddleware } = require("../utils/auth");
const { recordAudit } = require("../utils/audit");
const { getAlertSettings, updateAlertSettings } = require("../utils/settings");
const { getTariff, updateTariff } = require("../utils/tariff");

const router = express.Router();

// GET /api/settings/alerts  (admin) — current leak/abnormal-usage detection
// thresholds, for the Settings page to display. Any admin staff role can
// view; only officers (see PUT below) can change them.
router.get("/settings/alerts", authMiddleware("admin"), (req, res) => {
  res.json(getAlertSettings());
});

// PUT /api/settings/alerts  (admin, officer only) — update one or more
// thresholds. Body may include any subset of the keys in
// utils/settings.js#ALERT_SETTINGS_DEFAULTS; omitted keys keep their current
// value. Takes effect immediately — the detectors read these fresh on every
// check, no restart required.
router.put("/settings/alerts", authMiddleware("admin", ["officer"]), (req, res) => {
  try {
    const next = updateAlertSettings(req.body || {});
    recordAudit(req, "settings.alerts_update", "alertThresholds", `Updated alert thresholds: ${JSON.stringify(next)}`);
    res.json({ success: true, settings: next });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/tariff  (public) — the water rate and minimum bill. Not secret: every
// bill shows them. The Settings page reads them from here.
router.get("/tariff", (req, res) => {
  const { ratePerCm3, minBill } = getTariff();
  res.json({ ratePerCm3, minBill });
});

// PUT /api/settings/tariff  (admin, officer only) — change the rate and/or the
// minimum bill. Body: { ratePerCm3?, minBill? }. Applies to bills generated from now on.
router.put("/settings/tariff", authMiddleware("admin", ["officer"]), (req, res) => {
  try {
    const next = updateTariff(req.body || {});
    recordAudit(
      req,
      "settings.tariff_update",
      "tariff",
      `Set water rate to ₱${next.ratePerCm3}/m³ and minimum bill to ₱${next.minBill}`
    );
    res.json({ success: true, tariff: { ratePerCm3: next.ratePerCm3, minBill: next.minBill } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
