import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dataDir = path.resolve(__dirname, "..", "data");
const dbPath = path.resolve(dataDir, "reservari.sqlite");
export const ADMIN_EMAIL = "admin@gmail.com";
export const ADMIN_PASSWORD = "admin";

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
      user_id INTEGER,
      resource_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'completed', 'cancelled')),
      validated_by TEXT,
      validated_at TEXT,
      completed_by TEXT,
      completed_at TEXT,
      cancelled_by TEXT,
      cancelled_at TEXT,
      cancellation_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_resources_location ON resources(location_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_resource ON reservations(resource_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_interval ON reservations(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
  `);

  ensureReservationColumns();
  ensureUserColumns();
  ensureDefaultUsers();

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

function ensureReservationColumns(): void {
  const requiredColumns = [
    { name: "user_id", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
    { name: "completed_by", definition: "TEXT" },
    { name: "completed_at", definition: "TEXT" },
    { name: "cancelled_by", definition: "TEXT" },
    { name: "cancelled_at", definition: "TEXT" },
    { name: "cancellation_reason", definition: "TEXT" },
  ];

  for (const column of requiredColumns) {
    if (!tableHasColumn("reservations", column.name)) {
      db.exec(`ALTER TABLE reservations ADD COLUMN ${column.name} ${column.definition}`);
    }
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id)");
}

function ensureUserColumns(): void {
  if (!tableHasColumn("users", "username")) {
    db.exec("ALTER TABLE users ADD COLUMN username TEXT");
  }

  const users = db.prepare("SELECT id, email, username FROM users ORDER BY id").all() as Array<{
    id: number;
    email: string;
    username: string | null;
  }>;

  const usernameTakenStmt = db.prepare(
    "SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1",
  );
  const updateUsernameStmt = db.prepare("UPDATE users SET username = ? WHERE id = ?");

  for (const user of users) {
    const currentUsername = (user.username ?? "").trim();
    const baseUsername = normalizeUsername(
      currentUsername || defaultUsernameFromEmail(user.email, user.id),
      user.id,
    );

    let candidate = baseUsername;
    let suffix = 2;
    while (usernameTakenStmt.get(candidate, user.id)) {
      candidate = `${baseUsername}_${suffix}`;
      suffix += 1;
    }

    if (currentUsername !== candidate) {
      updateUsernameStmt.run(candidate, user.id);
    }
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username))");
}

function ensureDefaultUsers(): void {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(ADMIN_EMAIL) as
    | { id: number }
    | undefined;

  if (!existingAdmin) {
    db.prepare("INSERT INTO users (email, username, password) VALUES (?, ?, ?)").run(
      ADMIN_EMAIL,
      "admin",
      ADMIN_PASSWORD,
    );
    return;
  }

  db.prepare("UPDATE users SET password = ?, username = ? WHERE id = ?").run(
    ADMIN_PASSWORD,
    "admin",
    existingAdmin.id,
  );
}

function tableHasColumn(tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function defaultUsernameFromEmail(email: string, userId: number): string {
  const localPart = email.split("@")[0] ?? "";
  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 24);

  if (normalized.length >= 3) {
    return normalized;
  }

  return `user${userId}`;
}

function normalizeUsername(rawUsername: string, userId: number): string {
  const normalized = rawUsername
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 24);

  if (normalized.length >= 3) {
    return normalized;
  }

  return `user${userId}`;
}
