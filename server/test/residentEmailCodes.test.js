// Uses an in-memory DB so this never touches the real water_system.db file.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../src/db/database");
const mailer = require("../src/utils/mailer");

// Capture codes instead of emailing them.
const sent = [];
mailer.sendCode = async (message) => {
  sent.push(message);
  return "email";
};
const lastCodeTo = (to) => [...sent].reverse().find((m) => m.to === to)?.code;

const app = express();
app.use(express.json());
app.use("/resident", require("../src/routes/residentAuth"));

let server;
test.before(() => { server = app.listen(0); });
test.after(() => new Promise((resolve) => server.close(resolve)));

async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function addHousehold(id, email) {
  db.prepare("INSERT INTO households (id, name, standpost, meter, email) VALUES (?, ?, 1, ?, ?)").run(id, `Test ${id}`, `M-${id}`, email);
}

const signup = (householdId, code) => post("/resident/login", {
  householdId,
  password: "Str0ng!pass",
  confirmPassword: "Str0ng!pass",
  firstName: "Juan",
  lastName: "Cruz",
  code,
});

test("first-time setup needs the code emailed to the address on file", async () => {
  addHousehold("HH-E1", "owner@example.test");

  const withoutCode = await signup("HH-E1", undefined);
  assert.equal(withoutCode.success, false);

  const request = await post("/resident/setup/request-code", { householdId: "HH-E1" });
  assert.equal(request.success, true);
  assert.equal(request.code, undefined); // never returned to the caller
  assert.match(request.sentTo, /^ow\*+@example\.test$/);

  const wrong = await signup("HH-E1", "000000");
  assert.equal(wrong.success, false);

  const ok = await signup("HH-E1", lastCodeTo("owner@example.test"));
  assert.equal(ok.success, true);
});

test("a household with no email on file can't request a setup code", async () => {
  addHousehold("HH-E2", null);
  const result = await post("/resident/setup/request-code", { householdId: "HH-E2" });
  assert.equal(result.success, false);
  assert.equal(sent.some((m) => m.code && m.to == null), false);
});

test("an already set-up household can't request a setup code", async () => {
  addHousehold("HH-E3", "e3@example.test");
  db.prepare("INSERT INTO resident_accounts (household_id, password_hash) VALUES ('HH-E3', 'x')").run();
  const result = await post("/resident/setup/request-code", { householdId: "HH-E3" });
  assert.equal(result.success, false);
});

test("a code is burned after 5 wrong guesses", async () => {
  addHousehold("HH-E4", "e4@example.test");
  await post("/resident/setup/request-code", { householdId: "HH-E4" });
  const code = lastCodeTo("e4@example.test");
  for (let i = 0; i < 5; i++) await signup("HH-E4", code === "111111" ? "222222" : "111111");

  const result = await signup("HH-E4", code);
  assert.equal(result.success, false);
});

test("forgot password emails a code that resets the password", async () => {
  addHousehold("HH-E5", "e5@example.test");
  db.prepare("INSERT INTO resident_accounts (household_id, password_hash) VALUES ('HH-E5', ?)").run(bcrypt.hashSync("Old!pass1", 4));

  const request = await post("/resident/forgot-password", { householdId: "HH-E5" });
  assert.equal(request.method, "email");

  const reset = await post("/resident/reset-password", {
    householdId: "HH-E5",
    code: lastCodeTo("e5@example.test"),
    newPassword: "N3w!password",
  });
  assert.equal(reset.success, true);

  const login = await post("/resident/login", { householdId: "HH-E5", password: "N3w!password" });
  assert.equal(login.success, true);
});

test("forgot password without an email on file goes to the office instead", async () => {
  addHousehold("HH-E6", null);
  const request = await post("/resident/forgot-password", { householdId: "HH-E6" });
  assert.equal(request.method, "office");
  const pending = db.prepare("SELECT COUNT(*) AS n FROM password_reset_requests WHERE household_id = 'HH-E6'").get().n;
  assert.equal(pending, 1);
});
