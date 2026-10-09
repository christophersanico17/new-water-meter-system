process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../src/db/database");
const { moveToTrash, restoreFromTrash, purgeExpired } = require("../src/utils/trash");

function seedHousehold(id) {
  db.prepare("INSERT INTO households (id, name, standpost, meter) VALUES (?, ?, ?, ?)").run(id, "Trash Test", 1, `M-${id}`);
  db.prepare("INSERT INTO bills (household_id, period, prev_cm3, curr_cm3, amount, total_due) VALUES (?, ?, 0, 10, 200, 200)").run(id, "Oct 2026");
}

test("a deleted household moves to Recently deleted and can be restored", () => {
  seedHousehold("HH-T1");
  assert.equal(moveToTrash("HH-T1", "officer@example.test"), "Trash Test");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM households WHERE id = 'HH-T1'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bills WHERE household_id = 'HH-T1'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM deleted_households WHERE household_id = 'HH-T1'").get().n, 1);

  assert.deepEqual(restoreFromTrash("HH-T1"), { ok: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM households WHERE id = 'HH-T1'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bills WHERE household_id = 'HH-T1'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM deleted_households WHERE household_id = 'HH-T1'").get().n, 0);
});

test("trash entries are erased for good after 30 days", () => {
  seedHousehold("HH-T2");
  moveToTrash("HH-T2", "officer@example.test");
  db.prepare("UPDATE deleted_households SET deleted_at = datetime('now', '-31 days') WHERE household_id = 'HH-T2'").run();
  assert.equal(purgeExpired(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM deleted_households WHERE household_id = 'HH-T2'").get().n, 0);
});

test("a recent trash entry is kept by the purge", () => {
  seedHousehold("HH-T3");
  moveToTrash("HH-T3", "officer@example.test");
  assert.equal(purgeExpired(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM deleted_households WHERE household_id = 'HH-T3'").get().n, 1);
});

test("restore refuses when the control number is already in use", () => {
  seedHousehold("HH-T4");
  moveToTrash("HH-T4", "officer@example.test");
  seedHousehold("HH-T4");
  assert.ok(restoreFromTrash("HH-T4").error);
});
