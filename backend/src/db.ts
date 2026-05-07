import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dataDir = path.resolve(__dirname, "..", "data");
const dbPath = path.resolve(dataDir, "reservari.sqlite");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      address TEXT NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      price_per_hour REAL NOT NULL,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'completed', 'cancelled')),
      validated_by TEXT,
      validated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_resources_location ON resources(location_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_resource ON reservations(resource_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_interval ON reservations(start_time, end_time);
  `);

  const companyCount = db.prepare("SELECT COUNT(*) AS total FROM companies").get() as {
    total: number;
  };
  if (companyCount.total === 0) {
    seedDatabase();
  }
}

function seedDatabase(): void {
  const insertCompany = db.prepare("INSERT INTO companies (name) VALUES (?)");
  const insertLocation = db.prepare(
    "INSERT INTO locations (company_id, name, city, address) VALUES (?, ?, ?, ?)",
  );
  const insertResource = db.prepare(
    "INSERT INTO resources (location_id, name, type, price_per_hour) VALUES (?, ?, ?, ?)",
  );

  const seedTx = db.transaction(() => {
    const sportmaxId = Number(insertCompany.run("SportMax Arena").lastInsertRowid);
    const activezoneId = Number(insertCompany.run("ActiveZone").lastInsertRowid);

    const sportmaxCentral = Number(
      insertLocation.run(sportmaxId, "SportMax Central", "Bucuresti", "Bd. Unirii 42")
        .lastInsertRowid,
    );
    const sportmaxNorth = Number(
      insertLocation.run(sportmaxId, "SportMax Nord", "Bucuresti", "Str. Pajurei 17")
        .lastInsertRowid,
    );
    const activezoneCluj = Number(
      insertLocation.run(activezoneId, "ActiveZone Cluj", "Cluj-Napoca", "Calea Turzii 155")
        .lastInsertRowid,
    );

    insertResource.run(sportmaxCentral, "Teren fotbal 1", "teren", 240);
    insertResource.run(sportmaxCentral, "Teren tenis 2", "teren", 180);
    insertResource.run(sportmaxCentral, "Masa biliard 3", "biliard", 90);
    insertResource.run(sportmaxNorth, "Pista bowling 1", "bowling", 120);
    insertResource.run(sportmaxNorth, "Pista bowling 2", "bowling", 120);
    insertResource.run(activezoneCluj, "Kart #01", "karting", 150);
    insertResource.run(activezoneCluj, "Kart #02", "karting", 150);
    insertResource.run(activezoneCluj, "Masa biliard 1", "biliard", 80);
  });

  seedTx();
}
