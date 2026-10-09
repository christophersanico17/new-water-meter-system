// Sends confirmation-code emails through Brevo's web API (BREVO_API_KEY in the
// environment; BREVO_SENDER_EMAIL must be a sender verified in Brevo).
//
// Brevo is used over HTTPS rather than SMTP, because some hosts (Railway
// included) block outbound SMTP connections.
//
// When BREVO_API_KEY isn't set (e.g. local development), codes are printed to
// the server console instead, so the flows still work. A code is never sent
// back in an API response.

const DEFAULT_SENDER = "watersystem.csu@gmail.com";

function isMailConfigured() {
  return Boolean(process.env.BREVO_API_KEY);
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
// Throws if Brevo is configured but sending fails.
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

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: "Barangay Kinamlutan Water System",
        email: process.env.BREVO_SENDER_EMAIL || DEFAULT_SENDER,
      },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // Never include the key; Brevo's message is enough to diagnose a bad sender or key.
    throw new Error(`Brevo returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return "email";
}

module.exports = { sendCode, maskEmail, isMailConfigured };
