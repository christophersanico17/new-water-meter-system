// One-time 6-digit codes for resident email confirmation (first-time
// account setup and forgot-password). Only a hash is stored; a code expires
// after CODE_TTL_MINUTES and is burned after MAX_ATTEMPTS wrong guesses, so
// it can't be brute-forced.
const crypto = require("crypto");
const { db } = require("../db/database");

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code).trim()).digest("hex");
}

// Issues a fresh code for (purpose, subject), replacing any earlier one.
function issueCode(purpose, subject) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString();
  db.prepare("DELETE FROM verification_codes WHERE purpose = ? AND subject = ?").run(purpose, subject);
  db.prepare(
    "INSERT INTO verification_codes (purpose, subject, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0)"
  ).run(purpose, subject, hashCode(code), expiresAt);
  return code;
}

// Returns null if `code` is valid (and consumes it), otherwise a message
// saying why not.
function checkCode(purpose, subject, code) {
  const row = db
    .prepare("SELECT * FROM verification_codes WHERE purpose = ? AND subject = ?")
    .get(purpose, subject);
  if (!row) return "No code was requested, or it was already used. Request a new code.";
  if (new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    db.prepare("DELETE FROM verification_codes WHERE id = ?").run(row.id);
    return "This code has expired. Request a new code.";
  }
  if (!code || hashCode(code) !== row.code_hash) {
    db.prepare("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    return "Incorrect code.";
  }
  db.prepare("DELETE FROM verification_codes WHERE id = ?").run(row.id);
  return null;
}

module.exports = { issueCode, checkCode, CODE_TTL_MINUTES, MAX_ATTEMPTS };
