// Uses an in-memory DB so this never touches the real water_system.db file.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { db } = require("../src/db/database");
const { signToken, verifyToken } = require("../src/utils/auth");

const app = express();
app.use(express.json());
app.use("/admin", require("../src/routes/adminAuth"));
app.use("/resident", require("../src/routes/residentAuth"));

async function post(server, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

test("admin forgot-password never returns the reset code to the caller", async (t) => {
  db.prepare("INSERT INTO admin_accounts (email, password_hash, role) VALUES (?, ?, 'officer')").run("reset@example.test", "x");
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const originalLog = console.log;
  console.log = () => {}; // the code is printed to the server console by design
  try {
    const result = await post(server, "/admin/forgot-password", { email: "reset@example.test" });
    assert.equal(result.success, true);
    assert.equal(result.resetCode, undefined);
  } finally {
    console.log = originalLog;
  }
});


test("a deleted admin account's token stops working immediately", () => {
  db.prepare("INSERT INTO admin_accounts (email, password_hash, role) VALUES (?, ?, 'collector')").run("gone@example.test", "x");
  const token = signToken({ role: "admin", email: "gone@example.test", staffRole: "officer" });

  // The role comes from the database, not the (stale) token.
  assert.equal(verifyToken(token).staffRole, "collector");

  db.prepare("DELETE FROM admin_accounts WHERE email = ?").run("gone@example.test");
  assert.equal(verifyToken(token), null);
});
