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

test("a Google-linked household can't have a password created by someone else", async (t) => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES ('HH-G1', 'Google user', 1, 'M-G1')").run();
  db.prepare("INSERT INTO resident_accounts (household_id, google_sub, google_email) VALUES ('HH-G1', 'sub-1', 'g@example.test')").run();
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await post(server, "/resident/login", {
    householdId: "HH-G1",
    password: "Attack3r!pass",
    confirmPassword: "Attack3r!pass",
    firstName: "Mal",
    lastName: "Lory",
  });

  assert.equal(result.success, false);
  const account = db.prepare("SELECT password_hash FROM resident_accounts WHERE household_id = 'HH-G1'").get();
  assert.equal(account.password_hash, null);
});

test("a deleted admin account's token stops working immediately", () => {
  db.prepare("INSERT INTO admin_accounts (email, password_hash, role) VALUES (?, ?, 'collector')").run("gone@example.test", "x");
  const token = signToken({ role: "admin", email: "gone@example.test", staffRole: "officer" });

  // The role comes from the database, not the (stale) token.
  assert.equal(verifyToken(token).staffRole, "collector");

  db.prepare("DELETE FROM admin_accounts WHERE email = ?").run("gone@example.test");
  assert.equal(verifyToken(token), null);
});
