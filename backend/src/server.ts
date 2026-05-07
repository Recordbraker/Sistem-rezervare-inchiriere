import cors from "cors";
import express from "express";
import { z } from "zod";

import { db, initDatabase } from "./db";

initDatabase();

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  }),
);
app.use(express.json());

type CompanyRow = { id: number; name: string };
type LocationRow = {
  id: number;
  company_id: number;
  name: string;
  city: string;
  address: string;
};
type ResourceRow = {
  id: number;
  location_id: number;
  name: string;
  type: string;
  price_per_hour: number;
};
type ReservationRow = {
  id: number;
  resource_id: number;
  client_name: string;
  client_phone: string;
  start_time: string;
  end_time: string;
  status: "pending" | "validated" | "completed" | "cancelled";
  validated_by: string | null;
  validated_at: string | null;
  created_at: string;
  resource_name?: string;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data trebuie sa fie YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Data este invalida.");

const createReservationSchema = z
  .object({
    locationId: z.number().int().positive(),
    resourceId: z.number().int().positive(),
    clientName: z.string().trim().min(3, "Numele clientului este prea scurt."),
    clientPhone: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s]{6,20}$/, "Numarul de telefon este invalid."),
    date: dateSchema,
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Ora start trebuie sa fie HH:mm"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Ora final trebuie sa fie HH:mm"),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "Intervalul este invalid. Ora de start trebuie sa fie inainte de ora finala.",
    path: ["endTime"],
  });

const validateReservationSchema = z.object({
  employeeName: z.string().trim().min(3, "Numele angajatului este obligatoriu."),
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/companies", (_req, res) => {
  const companies = db.prepare("SELECT id, name FROM companies ORDER BY name").all() as CompanyRow[];
  const locations = db
    .prepare("SELECT id, company_id, name, city, address FROM locations ORDER BY name")
    .all() as LocationRow[];

  const result = companies.map((company) => ({
    id: company.id,
    name: company.name,
    locations: locations
      .filter((location) => location.company_id === company.id)
      .map((location) => ({
        id: location.id,
        name: location.name,
        city: location.city,
        address: location.address,
      })),
  }));

  res.json({ companies: result });
});

app.get("/api/locations/:locationId/calendar", (req, res) => {
  const locationId = Number(req.params.locationId);
  const dateParse = dateSchema.safeParse(req.query.date);

  if (!Number.isInteger(locationId) || locationId <= 0) {
    res.status(400).json({ message: "locationId invalid." });
    return;
  }
  if (!dateParse.success) {
    res.status(400).json({ message: dateParse.error.issues[0]?.message ?? "Data invalida." });
    return;
  }

  const date = dateParse.data;
  const nextDate = addOneDay(date);
  const dayStart = `${date}T00:00`;
  const nextDayStart = `${nextDate}T00:00`;

  const location = db
    .prepare(
      `SELECT l.id, l.name, l.city, l.address, c.name AS company_name
       FROM locations l
       JOIN companies c ON c.id = l.company_id
       WHERE l.id = ?`,
    )
    .get(locationId) as
    | {
        id: number;
        name: string;
        city: string;
        address: string;
        company_name: string;
      }
    | undefined;

  if (!location) {
    res.status(404).json({ message: "Locatia nu a fost gasita." });
    return;
  }

  const resources = db
    .prepare(
      "SELECT id, location_id, name, type, price_per_hour FROM resources WHERE location_id = ? ORDER BY name",
    )
    .all(locationId) as ResourceRow[];

  const reservationRows = db
    .prepare(
      `SELECT r.id, r.resource_id, r.client_name, r.client_phone, r.start_time, r.end_time, r.status,
              r.validated_by, r.validated_at, r.created_at
       FROM reservations r
       JOIN resources resource ON resource.id = r.resource_id
       WHERE resource.location_id = ?
         AND r.start_time >= ?
         AND r.start_time < ?
         AND r.status != 'cancelled'
       ORDER BY r.start_time`,
    )
    .all(locationId, dayStart, nextDayStart) as ReservationRow[];

  const resourcesWithReservations = resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    type: resource.type,
    pricePerHour: resource.price_per_hour,
    reservations: reservationRows
      .filter((reservation) => reservation.resource_id === resource.id)
      .map(toApiReservation),
  }));

  res.json({
    location: {
      id: location.id,
      name: location.name,
      city: location.city,
      address: location.address,
      companyName: location.company_name,
    },
    date,
    resources: resourcesWithReservations,
  });
});

app.get("/api/reservations/pending", (req, res) => {
  const locationId = Number(req.query.locationId);
  const dateParse = dateSchema.safeParse(req.query.date);

  if (!Number.isInteger(locationId) || locationId <= 0) {
    res.status(400).json({ message: "locationId invalid." });
    return;
  }
  if (!dateParse.success) {
    res.status(400).json({ message: dateParse.error.issues[0]?.message ?? "Data invalida." });
    return;
  }

  const date = dateParse.data;
  const nextDate = addOneDay(date);
  const dayStart = `${date}T00:00`;
  const nextDayStart = `${nextDate}T00:00`;

  const rows = db
    .prepare(
      `SELECT r.id, r.resource_id, r.client_name, r.client_phone, r.start_time, r.end_time, r.status,
              r.validated_by, r.validated_at, r.created_at, resource.name AS resource_name
       FROM reservations r
       JOIN resources resource ON resource.id = r.resource_id
       WHERE resource.location_id = ?
         AND r.start_time >= ?
         AND r.start_time < ?
         AND r.status = 'pending'
       ORDER BY r.start_time`,
    )
    .all(locationId, dayStart, nextDayStart) as ReservationRow[];

  res.json({
    reservations: rows.map((row) => ({
      ...toApiReservation(row),
      resourceName: row.resource_name,
    })),
  });
});

app.post("/api/reservations", (req, res) => {
  const parsed = createReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const input = parsed.data;
  const startDateTime = `${input.date}T${input.startTime}`;
  const endDateTime = `${input.date}T${input.endTime}`;

  const resource = db
    .prepare(
      "SELECT id, location_id, name, type, price_per_hour FROM resources WHERE id = ? AND location_id = ?",
    )
    .get(input.resourceId, input.locationId) as ResourceRow | undefined;

  if (!resource) {
    res.status(404).json({ message: "Resursa selectata nu apartine locatiei." });
    return;
  }

  const overlap = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM reservations
       WHERE resource_id = ?
         AND status != 'cancelled'
         AND NOT (end_time <= ? OR start_time >= ?)`,
    )
    .get(input.resourceId, startDateTime, endDateTime) as { total: number };

  if (overlap.total > 0) {
    res.status(409).json({ message: "Intervalul este deja rezervat pentru resursa selectata." });
    return;
  }

  const insertResult = db
    .prepare(
      `INSERT INTO reservations (
          resource_id, client_name, client_phone, start_time, end_time, status
       ) VALUES (?, ?, ?, ?, ?, 'pending')`,
    )
    .run(
      input.resourceId,
      input.clientName,
      input.clientPhone,
      startDateTime,
      endDateTime,
    );

  const reservation = db
    .prepare(
      `SELECT id, resource_id, client_name, client_phone, start_time, end_time, status,
              validated_by, validated_at, created_at
       FROM reservations
       WHERE id = ?`,
    )
    .get(Number(insertResult.lastInsertRowid)) as ReservationRow;

  res.status(201).json({
    message: "Rezervarea a fost creata cu succes.",
    reservation: toApiReservation(reservation),
  });
});

app.post("/api/reservations/:reservationId/validate", (req, res) => {
  const reservationId = Number(req.params.reservationId);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    res.status(400).json({ message: "reservationId invalid." });
    return;
  }

  const parsed = validateReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const updated = db
    .prepare(
      `UPDATE reservations
       SET status = 'validated', validated_by = ?, validated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
    )
    .run(parsed.data.employeeName, reservationId);

  if (updated.changes === 0) {
    const exists = db.prepare("SELECT id FROM reservations WHERE id = ?").get(reservationId) as
      | { id: number }
      | undefined;
    if (!exists) {
      res.status(404).json({ message: "Rezervarea nu exista." });
      return;
    }
    res.status(409).json({ message: "Rezervarea nu mai este in starea pending." });
    return;
  }

  const reservation = db
    .prepare(
      `SELECT id, resource_id, client_name, client_phone, start_time, end_time, status,
              validated_by, validated_at, created_at
       FROM reservations
       WHERE id = ?`,
    )
    .get(reservationId) as ReservationRow;

  res.json({
    message: "Inchirierea a fost validata.",
    reservation: toApiReservation(reservation),
  });
});

app.use((_req, res) => {
  res.status(404).json({ message: "Ruta nu exista." });
});

app.listen(PORT, () => {
  console.log(`API pornit pe http://localhost:${PORT}`);
});

function addOneDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return nextDate.toISOString().slice(0, 10);
}

function toApiReservation(row: ReservationRow) {
  return {
    id: row.id,
    resourceId: row.resource_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    createdAt: row.created_at,
  };
}
