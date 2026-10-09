// Recently deleted households. Deleting a household moves its record and every
// row recorded for it into the deleted_households table as a snapshot, so the
// live tables stay exactly as they were. Snapshots are erased for good after
// TRASH_DAYS, and can be restored until then.
const { db } = require("../db/database");

const TRASH_DAYS = 30;

// Every table that holds rows for a household (see foreign keys in database.js).
const RELATED_TABLES = [
  "resident_accounts",
  "bills",
  "readings",
  "alerts",
  "leak_reports",
  "password_reset_requests",
];

function insertRow(table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
    ...cols.map((c) => row[c])
  );
}

// Moves a household to the trash. Returns the household's name, or null if
// there is no such household.
function moveToTrash(householdId, deletedBy) {
  const household = db.prepare("SELECT * FROM households WHERE id = ?").get(householdId);
  if (!household) return null;

  const snapshot = { household, tables: {} };
  for (const table of RELATED_TABLES) {
    snapshot.tables[table] = db.prepare(`SELECT * FROM ${table} WHERE household_id = ?`).all(householdId);
  }

  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO deleted_households (household_id, name, deleted_at, deleted_by, snapshot)
       VALUES (?, ?, datetime('now'), ?, ?)`
    ).run(householdId, household.name, deletedBy || null, JSON.stringify(snapshot));
    // Cascades to the related tables via the foreign keys.
    db.prepare("DELETE FROM households WHERE id = ?").run(householdId);
  })();
  return household.name;
}

// Puts a trashed household back. Returns { ok: true }, or { error } if it is
// not in the trash or its records clash with something already present.
function restoreFromTrash(householdId) {
  const entry = db.prepare("SELECT snapshot FROM deleted_households WHERE household_id = ?").get(householdId);
  if (!entry) return { error: "This household is not in Recently deleted." };
  if (db.prepare("SELECT 1 FROM households WHERE id = ?").get(householdId)) {
    return { error: "A household with this control number already exists." };
  }

  const snapshot = JSON.parse(entry.snapshot);
  try {
    db.transaction(() => {
      insertRow("households", snapshot.household);
      for (const table of RELATED_TABLES) {
        for (const row of snapshot.tables[table] || []) insertRow(table, row);
      }
      db.prepare("DELETE FROM deleted_households WHERE household_id = ?").run(householdId);
    })();
  } catch (err) {
    return { error: "Some records can't be restored because their IDs are now in use." };
  }
  return { ok: true };
}

// Erases trash entries older than TRASH_DAYS. Returns how many were erased.
function purgeExpired() {
  return db
    .prepare(`DELETE FROM deleted_households WHERE deleted_at < datetime('now', ?)`)
    .run(`-${TRASH_DAYS} days`).changes;
}

module.exports = { moveToTrash, restoreFromTrash, purgeExpired, TRASH_DAYS };
