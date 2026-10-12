// Sends confirmation codes through Brevo's HTTPS API (SMTP is blocked on Railway).
// Without BREVO_API_KEY (local development) the code is printed to the console instead.
// Codes are never returned in an API response.

const DEFAULT_SENDER = "christophersanico17@gmail.com";
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

function isMailConfigured() {
  return Boolean(process.env.BREVO_API_KEY);
}

// "christopher@gmail.com" -> "ch*********@gmail.com"
function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!domain) return "your email";
  const shown = name.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(1, name.length - shown.length))}@${domain}`;
}

// Returns "email" when sent through Brevo, "console" when printed locally.
// Throws if Brevo is configured and the request fails.
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

  const res = await fetch(BREVO_URL, {
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
    // Brevo's message helps diagnose a bad sender or key. The API key is never included.
    throw new Error(`Brevo returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return "email";
}

module.exports = { sendCode, maskEmail };
