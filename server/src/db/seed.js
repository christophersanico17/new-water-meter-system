const bcrypt = require("bcryptjs");
const { db } = require("./database");

// Seeds only the admin account. Households, bills, readings and alerts are
// never seeded: they come from the office (adding households) and the hardware
// (readings), so the system never shows records that were not actually entered.
// Safe to run more than once: it does nothing if the admin account exists.
function seed() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM admin_accounts").get();
  if (existing.n > 0) {
    console.log("Admin account already exists — skipping seed.");
    return;
  }

  db.prepare(
    "INSERT INTO admin_accounts (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)"
  ).run("admin@barangay.local", bcrypt.hashSync("admin12345", 10), "Water", "Officer");

  console.log("Seeded the admin account. Change its password after first sign-in.");
  console.log("Admin login: admin@barangay.local / admin12345");
}

seed();
