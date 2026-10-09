const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db/database");
const { signToken, authMiddleware } = require("../utils/auth");
const mailer = require("../utils/mailer");
const { issueCode, checkCode, CODE_TTL_MINUTES } = require("../utils/verificationCodes");

const NO_EMAIL_MESSAGE =
  "There's no email on file for this household, so we can't send you a code. Please visit or contact the barangay water office.";

// Emails a fresh `purpose` code to the household's email on file. Returns
// the JSON to send back.
async function sendHouseholdCode(household, purpose, subject, intro) {
  const code = issueCode(purpose, household.id);
  try {
    const delivery = await mailer.sendCode({ to: household.email, subject, intro, code, minutes: CODE_TTL_MINUTES });
    return { success: true, delivery, sentTo: mailer.maskEmail(household.email), expiresInMinutes: CODE_TTL_MINUTES };
  } catch (err) {
    console.error(`Email to ${household.id} failed:`, err.message);
    return { success: false, message: "We couldn't send the email right now. Please try again in a few minutes." };
  }
}

const router = express.Router();

function isStrongPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

// POST /api/resident/setup/request-code
// Body: { householdId }
// First step of creating a household's password: emails a code to the email
// the office has on file for that household. The code goes to the address on
// file, never one the person types in, so knowing a control number alone is
// no longer enough to claim a household.
router.post("/setup/request-code", async (req, res) => {
  const { householdId } = req.body || {};
  const household = householdId
    ? db.prepare("SELECT id, email FROM households WHERE id = ?").get(householdId)
    : null;
  if (!household) {
    return res.json({ success: false, message: "We couldn't find an account with that control number." });
  }
  const account = db.prepare("SELECT password_hash FROM resident_accounts WHERE household_id = ?").get(householdId);
  if (account && account.password_hash) {
    return res.json({ success: false, message: "This household is already set up. Sign in instead." });
  }
  if (!household.email) {
    return res.json({ success: false, message: NO_EMAIL_MESSAGE });
  }
  res.json(await sendHouseholdCode(
    household,
    "resident_setup",
    "Your water account setup code",
    `Someone is setting up the online account for household ${household.id}.`
  ));
});

// POST /api/resident/login
// Body: { householdId, password, confirmPassword, code? }
// `code` (from /setup/request-code) is required when creating a password.
// First login for a household (no password_hash set yet) creates the
// password; returning residents authenticate against the stored hash.
router.post("/login", (req, res) => {
  const { householdId, password, confirmPassword, email, firstName, lastName, code } = req.body || {};

  if (!householdId || !password) {
    return res.json({ success: false, message: "Control number and password are required." });
  }

  const household = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
  if (!household) {
    return res.json({ success: false, message: "We couldn't find an account with that control number." });
  }

  const account = db
    .prepare("SELECT * FROM resident_accounts WHERE household_id = ?")
    .get(householdId);
  const isNewPassword = !account || !account.password_hash;

  if (isNewPassword) {
    if (!isStrongPassword(password)) {
      return res.json({
        success: false,
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.",
      });
    }
    if (password !== confirmPassword) {
      return res.json({ success: false, message: "Passwords do not match." });
    }

    // Optional email + required first/last name captured at sign-up.
    const cleanEmail = typeof email === "string" ? email.trim() : "";
    const cleanFirstName = typeof firstName === "string" ? firstName.trim() : "";
    const cleanLastName = typeof lastName === "string" ? lastName.trim() : "";
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.json({ success: false, message: "Please enter a valid email address." });
    }
    if (!cleanFirstName || !cleanLastName) {
      return res.json({ success: false, message: "Please enter your first and last name." });
    }
    // Checked last, so a typo elsewhere in the form doesn't burn the code.
    const codeError = checkCode("resident_setup", householdId, code);
    if (codeError) {
      return res.json({ success: false, message: codeError });
    }

    const hash = bcrypt.hashSync(password, 10);
    if (account) {
      db.prepare(
        "UPDATE resident_accounts SET password_hash = ?, updated_at = datetime('now') WHERE household_id = ?"
      ).run(hash, householdId);
    } else {
      db.prepare(
        "INSERT INTO resident_accounts (household_id, password_hash) VALUES (?, ?)"
      ).run(householdId, hash);
    }
    db.prepare("UPDATE households SET name = ? WHERE id = ?").run(`${cleanFirstName} ${cleanLastName}`, householdId);
    if (cleanEmail) {
      db.prepare("UPDATE households SET email = ? WHERE id = ?").run(cleanEmail, householdId);
    }
  } else {
    const matches = bcrypt.compareSync(password, account.password_hash);
    if (!matches) {
      return res.json({ success: false, message: "Incorrect password." });
    }
  }

  const token = signToken({ role: "resident", householdId });
  return res.json({ success: true, token, householdId });
});

// POST /api/resident/forgot-password
// Body: { householdId }
// With an email on file: emails a reset code (used at /reset-password below).
// Without one: files a request that an admin sees on the household's record
// and resolves by setting (and confirming) a new password directly.
router.post("/forgot-password", async (req, res) => {
  const { householdId } = req.body || {};
  if (!householdId) {
    return res.json({ success: false, message: "Select your household / standpost first." });
  }

  const household = db.prepare("SELECT id, email FROM households WHERE id = ?").get(householdId);
  if (!household) {
    return res.json({ success: false, message: "Unknown household / standpost." });
  }

  if (household.email) {
    const result = await sendHouseholdCode(
      household,
      "resident_reset",
      "Your water account password reset code",
      `Someone asked to reset the password for household ${household.id}.`
    );
    return res.json({ ...result, method: "email" });
  }

  const existing = db
    .prepare("SELECT id FROM password_reset_requests WHERE household_id = ? AND status = 'Pending'")
    .get(householdId);
  if (!existing) {
    db.prepare("INSERT INTO password_reset_requests (household_id) VALUES (?)").run(householdId);
  }

  return res.json({
    success: true,
    method: "office",
    message: "Your request has been sent to the barangay water office. An admin will set your new password and let you know.",
  });
});

// POST /api/resident/reset-password
// Body: { householdId, code, newPassword }
// Completes an emailed forgot-password reset.
router.post("/reset-password", (req, res) => {
  const { householdId, code, newPassword } = req.body || {};
  if (!householdId || !code || !newPassword) {
    return res.json({ success: false, message: "Control number, code, and new password are required." });
  }
  if (!isStrongPassword(newPassword)) {
    return res.json({
      success: false,
      message: "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.",
    });
  }
  const codeError = checkCode("resident_reset", householdId, code);
  if (codeError) {
    return res.json({ success: false, message: codeError });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  const account = db.prepare("SELECT household_id FROM resident_accounts WHERE household_id = ?").get(householdId);
  if (account) {
    db.prepare("UPDATE resident_accounts SET password_hash = ?, updated_at = datetime('now') WHERE household_id = ?").run(hash, householdId);
  } else {
    db.prepare("INSERT INTO resident_accounts (household_id, password_hash) VALUES (?, ?)").run(householdId, hash);
  }
  db.prepare(
    "UPDATE password_reset_requests SET status = 'Resolved', resolved_at = datetime('now'), resolved_by = 'email code' WHERE household_id = ? AND status = 'Pending'"
  ).run(householdId);

  return res.json({ success: true });
});

module.exports = router;
