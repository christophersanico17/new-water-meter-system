const bcrypt = require("bcryptjs");
const { db } = require("./database");

// Only real setup data is seeded here: households, resident logins and the
// admin account. Bills, meter readings and alerts are NOT seeded. They come
// only from the hardware (readings) and from the app itself (bills, alerts),
// so the system never shows records that were not actually recorded.
const seedHouseholds = [
  { id: "HH-001", name: "Christopher Sanico", standpost: 25, meter: "158-SH-00013" },
  { id: "HH-002", name: "Maria Santos", standpost: 12, meter: "158-SH-00024" },
  { id: "HH-003", name: "Pedro Reyes", standpost: 7, meter: "158-SH-00031" },
  { id: "HH-004", name: "Luz Garcia", standpost: 18, meter: "158-SH-00008" },
  { id: "HH-005", name: "Jose Cruz", standpost: 33, meter: "158-SH-00019" },
  { id: "HH-006", name: "Ana Reyes", standpost: 4, meter: "158-SH-00042" },
  { id: "HH-007", name: "Carlos Bautista", standpost: 29, meter: "158-SH-00053" },
  { id: "HH-008", name: "Nena Flores", standpost: 11, meter: "158-SH-00063" },
];

function dateStamp(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function seed() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM households").get();
  if (existing.n > 0) {
    console.log("Database already seeded — skipping. (Delete water_system.db to reseed.)");
    return;
  }

  console.log("Seeding database...");

  const insertHousehold = db.prepare(`
    INSERT INTO households (id, name, standpost, meter, address, date_connected)
    VALUES (@id, @name, @standpost, @meter, @address, @date_connected)
  `);

  const insertAccount = db.prepare(`
    INSERT INTO resident_accounts (household_id, password_hash)
    VALUES (@household_id, @password_hash)
  `);

  const insertAdmin = db.prepare(`
    INSERT INTO admin_accounts (email, password_hash, first_name, last_name) VALUES (@email, @password_hash, @first_name, @last_name)
  `);

  const tx = db.transaction(() => {
    // Admin account: admin@barangay.local / admin12345
    insertAdmin.run({
      email: "admin@barangay.local",
      password_hash: bcrypt.hashSync("admin12345", 10),
      first_name: "Water",
      last_name: "Officer",
    });

    seedHouseholds.forEach((h) => {
      const purok = (h.standpost % 9) || 5;
      insertHousehold.run({
        id: h.id,
        name: h.name,
        standpost: h.standpost,
        meter: h.meter,
        address: `Purok ${purok} Kinamlutan, Butuan City`,
        date_connected: dateStamp(180),
      });

      // No password set yet — first login will create one (matches current frontend behavior)
      insertAccount.run({ household_id: h.id, password_hash: null });
    });
  });

  tx();
  console.log(`Seeded ${seedHouseholds.length} households and the admin account. No bills, readings or alerts.`);
  console.log("Admin login: admin@barangay.local / admin12345");
}

seed();
