// Sends confirmation-code emails through the system Gmail account
// (GMAIL_USER / GMAIL_APP_PASSWORD in server/.env — see .env.example).
//
// When those aren't set (e.g. local development), codes are printed to the
// server console instead, so the flows still work for whoever runs the
// server. A code is never sent back in an API response.
const nodemailer = require("nodemailer");

let transporter = null;

function isMailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

// "christopher@gmail.com" -> "ch*********@gmail.com", so a screen can say
// where the code went without revealing the whole address.
function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!domain) return "your email";
  const shown = name.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(1, name.length - shown.length))}@${domain}`;
}

// Delivers `code` to `to`. Returns "email" or "console" (how it went out).
// Throws if Gmail is configured but sending fails.
async function sendCode({ to, subject, intro, code, minutes }) {
  if (!isMailConfigured()) {
    console.log(`\n  [email not configured] ${subject} for ${to}: ${code} (valid ${minutes} min)\n`);
    return "console";
  }
  const text = [
    intro,
    "",
    `Your code is: ${code}`,
    "",
    `It expires in ${minutes} minutes. If you didn't ask for this, you can ignore this email.`,
    "",
    "— Barangay Kinamlutan Water System",
  ].join("\n");
  await module.exports.transport().sendMail({
    from: `"Barangay Kinamlutan Water System" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
  });
  return "email";
}

// `transport` is exported as a function (not called directly above) so tests
// can swap in a fake one.
module.exports = { sendCode, maskEmail, isMailConfigured, transport: getTransport };
