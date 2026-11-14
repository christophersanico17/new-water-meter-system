process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { db } = require("../src/db/database");
const { signToken } = require("../src/utils/auth");
const dataRoutes = require("../src/routes/data");

const app = express();
app.use(express.json());
app.use(dataRoutes);

function insertAlert(id, householdId, type) {
  db.prepare("INSERT INTO alerts (id, household_id, type, flow_rate, status) VALUES (?, ?, ?, '60 L/m', 'Unresolved')")
    .run(id, householdId, type);
}

test("resident answers Normal / Not Normal on their own alerts", async (t) => {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, 1, ?)").run("HH-FB-1", "Feedback A", "M-FB-1");
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, 1, ?)").run("HH-FB-2", "Feedback B", "M-FB-2");
  insertAlert("ALT-FB-1", "HH-FB-1", "High Flow");
  insertAlert("ALT-FB-2", "HH-FB-1", "Leak Detected");
  insertAlert("ALT-FB-3", "HH-FB-2", "Leak Detected");

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const token = signToken({ role: "resident", householdId: "HH-FB-1" });
  const answer = (id, feedback) =>
    fetch(`http://127.0.0.1:${port}/alerts/${id}/feedback`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });

  assert.equal((await answer("ALT-FB-1", "maybe")).status, 400);
  assert.equal((await answer("ALT-FB-3", "Normal")).status, 404);

  const normal = await answer("ALT-FB-1", "Normal");
  assert.equal(normal.status, 200);
  assert.deepEqual(
    db.prepare("SELECT status, resident_feedback FROM alerts WHERE id = 'ALT-FB-1'").get(),
    { status: "Resolved", resident_feedback: "Normal" }
  );
  assert.equal((await answer("ALT-FB-1", "Not Normal")).status, 409);

  const notNormal = await answer("ALT-FB-2", "Not Normal");
  assert.equal(notNormal.status, 200);
  assert.deepEqual(
    db.prepare("SELECT status, resident_feedback FROM alerts WHERE id = 'ALT-FB-2'").get(),
    { status: "Unresolved", resident_feedback: "Not Normal" }
  );
});
