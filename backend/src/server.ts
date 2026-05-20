import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { ADMIN_EMAIL, ADMIN_PASSWORD, db, initDatabase } from "./db";

initDatabase();

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

const SLOT_MINUTES = 30;
const OPENING_HOUR = 8;
const CLOSING_HOUR = 23;

type ReservationStatus = "pending" | "validated" | "completed" | "cancelled";

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
  user_id: number | null;
  user_username?: string | null;
  resource_id: number;
  client_name: string;
  client_phone: string;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  validated_by: string | null;
  validated_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  resource_name?: string;
  resource_type?: string;
  resource_price_per_hour?: number;
};

type SummaryRow = {
  status: ReservationStatus;
  start_time: string;
  end_time: string;
  price_per_hour: number;
};

type UserRole = "admin" | "user";

type UserRow = {
  id: number;
  email: string;
  username: string;
  password: string;
  created_at: string;
};

type AuthenticatedUser = {
  id: number;
  email: string;
  username: string;
  role: UserRole;
};

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data trebuie sa fie YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Data este invalida.");

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ora trebuie sa fie in format HH:mm");

const durationMinutesSchema = z
  .number()
  .int()
  .min(SLOT_MINUTES, `Durata minima este ${SLOT_MINUTES} minute.`)
  .max((CLOSING_HOUR - OPENING_HOUR) * 60, "Durata este prea mare.")
  .refine(
    (value) => value % SLOT_MINUTES === 0,
    `Durata trebuie sa fie multiplu de ${SLOT_MINUTES} minute.`,
  );

const createReservationSchema = z
  .object({
    locationId: z.number().int().positive(),
    resourceId: z.number().int().positive(),
    clientName: z.string().trim().min(3, "Numele clientului este prea scurt.").max(80),
    clientPhone: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s]{6,20}$/, "Numarul de telefon este invalid."),
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "Intervalul este invalid. Ora de start trebuie sa fie inainte de ora finala.",
    path: ["endTime"],
  })
  .refine(
    (data) => isHalfHourAligned(data.startTime) && isHalfHourAligned(data.endTime),
    `Orele trebuie aliniate la intervale de ${SLOT_MINUTES} minute.`,
  )
  .refine(
    (data) => isWithinBusinessHours(data.startTime, data.endTime),
    `Programul locatiei este ${OPENING_HOUR.toString().padStart(2, "0")}:00-${CLOSING_HOUR
      .toString()
      .padStart(2, "0")}:00.`,
  )
  .refine((data) => toMinutes(data.endTime) - toMinutes(data.startTime) >= SLOT_MINUTES, {
    message: `Durata minima este ${SLOT_MINUTES} minute.`,
    path: ["endTime"],
  });

const validateReservationSchema = z.object({
  employeeName: z
    .string()
    .trim()
    .min(3, "Numele angajatului este obligatoriu.")
    .max(80, "Numele angajatului este prea lung."),
});

const completeReservationSchema = validateReservationSchema;

const cancelReservationSchema = z.object({
  employeeName: z
    .string()
    .trim()
    .min(3, "Numele angajatului este obligatoriu.")
    .max(80, "Numele angajatului este prea lung."),
  reason: z
    .string()
    .trim()
    .min(3, "Motivul anularii este obligatoriu.")
    .max(180, "Motivul anularii este prea lung."),
});

const reservationListQuerySchema = z.object({
  locationId: z.coerce.number().int().positive(),
  date: dateSchema,
  status: z.enum(["all", "pending", "validated", "completed", "cancelled"]).default("all"),
  search: z.string().trim().max(100).optional(),
});

const availabilityQuerySchema = z.object({
  date: dateSchema,
  durationMinutes: z.coerce
    .number()
    .int()
    .optional()
    .default(60)
    .pipe(durationMinutesSchema),
});

const credentialsSchema = z.object({
  email: z.string().trim().email("Email invalid.").max(160, "Email-ul este prea lung."),
  password: z.string().min(1, "Parola este obligatorie.").max(120, "Parola este prea lunga."),
});

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username-ul trebuie sa aiba minim 3 caractere.")
    .max(30, "Username-ul este prea lung.")
    .regex(/^[a-zA-Z0-9._-]+$/, "Username-ul poate contine doar litere, cifre, punct, underscore sau minus."),
  email: z.string().trim().email("Email invalid.").max(160, "Email-ul este prea lung."),
  password: z
    .string()
    .min(4, "Parola trebuie sa aiba cel putin 4 caractere.")
    .max(120, "Parola este prea lunga."),
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  }),
);
app.use(express.json());

app.post("/api/auth/register", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const input = parsed.data;
  const username = input.username.trim().toLowerCase();

  const existingUser = db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(input.email) as
    | { id: number }
    | undefined;
  const existingUsername = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username) as
    | { id: number }
    | undefined;

  if (existingUser) {
    res.status(409).json({ message: "Exista deja un cont cu acest email." });
    return;
  }
  if (existingUsername) {
    res.status(409).json({ message: "Exista deja un cont cu acest username." });
    return;
  }

  const insertResult = db
    .prepare("INSERT INTO users (email, username, password) VALUES (?, ?, ?)")
    .run(input.email, username, input.password);

  const user = db
    .prepare("SELECT id, email, username, password, created_at FROM users WHERE id = ?")
    .get(Number(insertResult.lastInsertRowid)) as UserRow;

  res.status(201).json({
    message: "Contul a fost creat.",
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: resolveRole(user.email, user.password),
    },
  });
});

app.post("/api/auth/login", (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const user = findUserByCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    res.status(401).json({ message: "Email sau parola invalida." });
    return;
  }

  res.json({
    message: "Autentificare reusita.",
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: resolveRole(user.email, user.password),
    },
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    res.status(401).json({ message: "Autentificare necesara." });
    return;
  }

  res.json({ user: authUser });
});

app.post("/api/auth/logout", authMiddleware, (_req, res) => {
  res.json({
    message: "Logout efectuat. Sterge credentialele salvate pe client.",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    slotMinutes: SLOT_MINUTES,
    businessHours: {
      start: `${OPENING_HOUR.toString().padStart(2, "0")}:00`,
      end: `${CLOSING_HOUR.toString().padStart(2, "0")}:00`,
    },
  });
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
  const { dayStart, nextDayStart } = getDayBounds(date);
  const requestUser = getOptionalAuthenticatedUser(req);
  const restrictToUserId = requestUser?.role === "user" ? requestUser.id : null;

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

  const reservationRows = (
    restrictToUserId
      ? db
          .prepare(
            `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
                    r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
                    r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at
             FROM reservations r
             JOIN resources resource ON resource.id = r.resource_id
             LEFT JOIN users owner ON owner.id = r.user_id
             WHERE resource.location_id = ?
               AND r.start_time >= ?
               AND r.start_time < ?
               AND r.status NOT IN ('completed', 'cancelled')
               AND r.user_id = ?
             ORDER BY r.start_time`,
          )
          .all(locationId, dayStart, nextDayStart, restrictToUserId)
      : db
          .prepare(
            `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
                    r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
                    r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at
             FROM reservations r
             JOIN resources resource ON resource.id = r.resource_id
             LEFT JOIN users owner ON owner.id = r.user_id
             WHERE resource.location_id = ?
               AND r.start_time >= ?
               AND r.start_time < ?
               AND r.status NOT IN ('completed', 'cancelled')
             ORDER BY r.start_time`,
          )
          .all(locationId, dayStart, nextDayStart)
  ) as ReservationRow[];

  const resourcesWithReservations = resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    type: resource.type,
    pricePerHour: resource.price_per_hour,
    reservations: reservationRows
      .filter((reservation) => reservation.resource_id === resource.id)
      .map((reservation) => toApiReservation({ ...reservation, resource_price_per_hour: resource.price_per_hour })),
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

app.get("/api/locations/:locationId/summary", (req, res) => {
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
  const { dayStart, nextDayStart } = getDayBounds(date);
  const requestUser = getOptionalAuthenticatedUser(req);
  const restrictToUserId = requestUser?.role === "user" ? requestUser.id : null;

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

  const resourceCount = (
    db
      .prepare("SELECT COUNT(*) AS total FROM resources WHERE location_id = ?")
      .get(locationId) as { total: number }
  ).total;

  const rows = (
    restrictToUserId
      ? db
          .prepare(
            `SELECT r.status, r.start_time, r.end_time, resource.price_per_hour
             FROM reservations r
             JOIN resources resource ON resource.id = r.resource_id
             WHERE resource.location_id = ?
               AND r.start_time >= ?
               AND r.start_time < ?
               AND r.user_id = ?`,
          )
          .all(locationId, dayStart, nextDayStart, restrictToUserId)
      : db
          .prepare(
            `SELECT r.status, r.start_time, r.end_time, resource.price_per_hour
             FROM reservations r
             JOIN resources resource ON resource.id = r.resource_id
             WHERE resource.location_id = ?
               AND r.start_time >= ?
               AND r.start_time < ?`,
          )
          .all(locationId, dayStart, nextDayStart)
  ) as SummaryRow[];

  const statusCounts: Record<ReservationStatus, number> = {
    pending: 0,
    validated: 0,
    completed: 0,
    cancelled: 0,
  };

  let bookedMinutes = 0;
  let totalRevenue = 0;
  let confirmedRevenue = 0;
  let pendingRevenue = 0;

  for (const row of rows) {
    statusCounts[row.status] += 1;
    const durationMinutes = diffMinutes(row.start_time, row.end_time);
    const slotRevenue = roundMoney((durationMinutes / 60) * row.price_per_hour);

    if (row.status !== "cancelled") {
      bookedMinutes += durationMinutes;
      totalRevenue += slotRevenue;
      if (row.status === "pending") {
        pendingRevenue += slotRevenue;
      } else {
        confirmedRevenue += slotRevenue;
      }
    }
  }

  const capacityMinutes = resourceCount * (CLOSING_HOUR - OPENING_HOUR) * 60;
  const utilizationPercent =
    capacityMinutes === 0 ? 0 : roundMoney((bookedMinutes / capacityMinutes) * 100);

  res.json({
    location: {
      id: location.id,
      name: location.name,
      city: location.city,
      address: location.address,
      companyName: location.company_name,
    },
    date,
    resourceCount,
    reservations: {
      total: rows.length,
      byStatus: statusCounts,
    },
    utilizationPercent,
    revenue: {
      totalPotential: roundMoney(totalRevenue),
      confirmed: roundMoney(confirmedRevenue),
      pending: roundMoney(pendingRevenue),
    },
    businessHours: {
      start: `${OPENING_HOUR.toString().padStart(2, "0")}:00`,
      end: `${CLOSING_HOUR.toString().padStart(2, "0")}:00`,
    },
  });
});

app.get("/api/resources/:resourceId/availability", (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    res.status(400).json({ message: "resourceId invalid." });
    return;
  }

  const parsed = availabilityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const { date, durationMinutes } = parsed.data;
  const { dayStart, nextDayStart } = getDayBounds(date);

  const resource = db
    .prepare("SELECT id, location_id, name, type, price_per_hour FROM resources WHERE id = ?")
    .get(resourceId) as ResourceRow | undefined;

  if (!resource) {
    res.status(404).json({ message: "Resursa nu exista." });
    return;
  }

  const intervals = db
    .prepare(
      `SELECT start_time, end_time
       FROM reservations
       WHERE resource_id = ?
         AND start_time >= ?
         AND start_time < ?
         AND status NOT IN ('completed', 'cancelled')
       ORDER BY start_time`,
    )
    .all(resourceId, dayStart, nextDayStart) as Array<{ start_time: string; end_time: string }>;

  const freeSlots: Array<{ startTime: string; endTime: string }> = [];
  for (
    let cursorMinutes = OPENING_HOUR * 60;
    cursorMinutes + durationMinutes <= CLOSING_HOUR * 60;
    cursorMinutes += SLOT_MINUTES
  ) {
    const startTime = `${date}T${minutesToTime(cursorMinutes)}`;
    const endTime = `${date}T${minutesToTime(cursorMinutes + durationMinutes)}`;

    const hasOverlap = intervals.some(
      (interval) => !(interval.end_time <= startTime || interval.start_time >= endTime),
    );

    if (!hasOverlap) {
      freeSlots.push({ startTime, endTime });
    }
  }

  res.json({
    resource: {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      pricePerHour: resource.price_per_hour,
      locationId: resource.location_id,
    },
    date,
    durationMinutes,
    freeSlots,
    totalSlots: Math.floor(((CLOSING_HOUR - OPENING_HOUR) * 60 - durationMinutes) / SLOT_MINUTES) + 1,
    availableSlots: freeSlots.length,
  });
});

app.get("/api/reservations", authMiddleware, (req, res) => {
  const parsed = reservationListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    res.status(401).json({ message: "Autentificare necesara." });
    return;
  }

  const { locationId, date, status, search } = parsed.data;
  const ownerUserId = authUser.role === "admin" ? undefined : authUser.id;
  console.log(`DEBUG endpoint: authUser.role=${authUser.role}, authUser.id=${authUser.id}, ownerUserId=${ownerUserId}, status=${status}`);
  const rows = getReservationsForDay(locationId, date, status === "all" ? undefined : status, ownerUserId, authUser.role);

  const searchTerm = search?.trim().toLowerCase();
  const reservations = rows
    .filter((row) => {
      if (!searchTerm) {
        return true;
      }
      const haystack = [row.client_name, row.client_phone, row.resource_name ?? "", row.resource_type ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchTerm);
    })
    .map(toApiReservation);

  res.json({ reservations });
});

app.get("/api/reservations/pending", authMiddleware, requireAdminRole, (req, res) => {
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

  const rows = getReservationsForDay(locationId, dateParse.data, "pending");
  res.json({
    reservations: rows.map(toApiReservation),
  });
});

app.post("/api/reservations", authMiddleware, (req, res) => {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    res.status(401).json({ message: "Autentificare necesara." });
    return;
  }

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
         AND status NOT IN ('completed', 'cancelled')
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
          user_id, resource_id, client_name, client_phone, start_time, end_time, status
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(authUser.id, input.resourceId, input.clientName, input.clientPhone, startDateTime, endDateTime);

  const reservation = db
    .prepare(
      `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
              r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
              r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at,
              resource.name AS resource_name, resource.type AS resource_type,
              resource.price_per_hour AS resource_price_per_hour
       FROM reservations r
       JOIN resources resource ON resource.id = r.resource_id
       LEFT JOIN users owner ON owner.id = r.user_id
       WHERE r.id = ?`,
    )
    .get(Number(insertResult.lastInsertRowid)) as ReservationRow;

  res.status(201).json({
    message: "Rezervarea a fost creata cu succes.",
    reservation: toApiReservation(reservation),
  });
});

app.post("/api/reservations/:reservationId/validate", authMiddleware, requireAdminRole, (req, res) => {
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
       SET status = 'validated',
           validated_by = ?,
           validated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
    )
    .run(parsed.data.employeeName, reservationId);

  if (updated.changes === 0) {
    const existing = getReservationStatus(reservationId);
    if (!existing) {
      res.status(404).json({ message: "Rezervarea nu exista." });
      return;
    }
    res.status(409).json({ message: `Rezervarea este deja in starea ${existing.status}.` });
    return;
  }

  const reservation = getReservationWithResource(reservationId);
  res.json({
    message: "Inchirierea a fost validata.",
    reservation: toApiReservation(reservation),
  });
});

app.post("/api/reservations/:reservationId/complete", authMiddleware, requireAdminRole, (req, res) => {
  const reservationId = Number(req.params.reservationId);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    res.status(400).json({ message: "reservationId invalid." });
    return;
  }

  const parsed = completeReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const updated = db
    .prepare(
      `UPDATE reservations
       SET status = 'completed',
           completed_by = ?,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'validated'`,
    )
    .run(parsed.data.employeeName, reservationId);

  if (updated.changes === 0) {
    const existing = getReservationStatus(reservationId);
    if (!existing) {
      res.status(404).json({ message: "Rezervarea nu exista." });
      return;
    }
    if (existing.status === "pending") {
      res.status(409).json({ message: "Rezervarea trebuie validata inainte de finalizare." });
      return;
    }
    res.status(409).json({ message: `Rezervarea este deja in starea ${existing.status}.` });
    return;
  }

  const reservation = getReservationWithResource(reservationId);
  res.json({
    message: "Inchirierea a fost finalizata.",
    reservation: toApiReservation(reservation),
  });
});

app.post("/api/reservations/:reservationId/cancel", authMiddleware, requireAdminRole, (req, res) => {
  const reservationId = Number(req.params.reservationId);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    res.status(400).json({ message: "reservationId invalid." });
    return;
  }

  const parsed = cancelReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Date invalide." });
    return;
  }

  const updated = db
    .prepare(
      `UPDATE reservations
       SET status = 'cancelled',
           cancelled_by = ?,
           cancellation_reason = ?,
           cancelled_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending', 'validated')`,
    )
    .run(parsed.data.employeeName, parsed.data.reason, reservationId);

  if (updated.changes === 0) {
    const existing = getReservationStatus(reservationId);
    if (!existing) {
      res.status(404).json({ message: "Rezervarea nu exista." });
      return;
    }
    res.status(409).json({ message: `Rezervarea este deja in starea ${existing.status}.` });
    return;
  }

  const reservation = getReservationWithResource(reservationId);
  res.json({
    message: "Rezervarea a fost anulata.",
    reservation: toApiReservation(reservation),
  });
});

//app.use((_req, res) => {
  //res.status(404).json({ message: "Ruta nu exista." });
//});

app.listen(PORT, () => {
  console.log(`API pornit pe http://localhost:${PORT}`);
});

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const credentials = extractCredentialsFromRequest(req);
  if (!credentials) {
    res.status(401).json({
      message:
        "Autentificare necesara. Foloseste Authorization: Basic base64(email:parola) sau x-user-email/x-user-password.",
    });
    return;
  }

  const user = findUserByCredentials(credentials.email, credentials.password);
  if (!user) {
    res.status(401).json({ message: "Email sau parola invalida." });
    return;
  }

  const authReq = req as AuthenticatedRequest;
  authReq.authUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    role: resolveRole(user.email, user.password),
  };

  next();
}

function requireAdminRole(req: Request, res: Response, next: NextFunction): void {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    res.status(401).json({ message: "Autentificare necesara." });
    return;
  }

  if (authUser.role !== "admin") {
    res.status(403).json({ message: "Doar utilizatorul admin poate efectua aceasta actiune." });
    return;
  }

  next();
}

function getAuthenticatedUser(req: Request): AuthenticatedUser | null {
  const authUser = (req as AuthenticatedRequest).authUser;
  return authUser ?? null;
}

function findUserByCredentials(email: string, password: string): UserRow | null {
  const user = db
    .prepare(
      "SELECT id, email, username, password, created_at FROM users WHERE LOWER(email) = LOWER(?) AND password = ?",
    )
    .get(email, password) as UserRow | undefined;
  return user ?? null;
}

function getOptionalAuthenticatedUser(req: Request): AuthenticatedUser | null {
  const credentials = extractCredentialsFromRequest(req);
  if (!credentials) {
    return null;
  }

  const user = findUserByCredentials(credentials.email, credentials.password);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: resolveRole(user.email, user.password),
  };
}

function resolveRole(email: string, password: string): UserRole {
  const normalizedEmail = email.trim().toLowerCase();
  const isAdmin = normalizedEmail === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD;
  return isAdmin ? "admin" : "user";
}

function extractCredentialsFromRequest(req: Request): { email: string; password: string } | null {
  const authorizationHeader = getHeaderValue(req.headers.authorization);
  if (authorizationHeader) {
    const basicCredentials = parseBasicAuthCredentials(authorizationHeader);
    if (basicCredentials) {
      return basicCredentials;
    }
  }

  const emailHeader = getHeaderValue(req.headers["x-user-email"]);
  const passwordHeader = getHeaderValue(req.headers["x-user-password"]);

  if (!emailHeader || !passwordHeader) {
    return null;
  }

  const email = emailHeader.trim();
  const password = passwordHeader;
  if (!email || !password) {
    return null;
  }

  return { email, password };
}

function getHeaderValue(headerValue: string | string[] | undefined): string | null {
  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  if (typeof headerValue === "string") {
    return headerValue;
  }

  return null;
}

function parseBasicAuthCredentials(authHeader: string): { email: string; password: string } | null {
  if (!authHeader.startsWith("Basic ")) {
    return null;
  }

  const encodedToken = authHeader.slice(6).trim();
  if (!encodedToken) {
    return null;
  }

  let decodedToken = "";
  try {
    decodedToken = Buffer.from(encodedToken, "base64").toString("utf8");
  } catch {
    return null;
  }

  const separatorIndex = decodedToken.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const email = decodedToken.slice(0, separatorIndex).trim();
  const password = decodedToken.slice(separatorIndex + 1);
  if (!email || !password) {
    return null;
  }

  return { email, password };
}

function getDayBounds(date: string): { dayStart: string; nextDayStart: string } {
  return {
    dayStart: `${date}T00:00`,
    nextDayStart: `${addOneDay(date)}T00:00`,
  };
}

function getReservationsForDay(
  locationId: number,
  date: string,
  status?: ReservationStatus,
  ownerUserId?: number,
  userRole?: UserRole,
): ReservationRow[] {
  const { dayStart, nextDayStart } = getDayBounds(date);
  
  // For regular users, exclude completed and cancelled reservations
  const excludeCompletedCancelled = userRole === "user";

  if (status && ownerUserId) {
    return db
      .prepare(
        `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
                r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
                r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at,
                resource.name AS resource_name, resource.type AS resource_type,
                resource.price_per_hour AS resource_price_per_hour
         FROM reservations r
         JOIN resources resource ON resource.id = r.resource_id
         LEFT JOIN users owner ON owner.id = r.user_id
         WHERE resource.location_id = ?
           AND r.start_time >= ?
           AND r.start_time < ?
           AND r.status = ?
           AND r.user_id = ?
         ORDER BY r.start_time`,
      )
      .all(locationId, dayStart, nextDayStart, status, ownerUserId) as ReservationRow[];
  }

  if (status && !ownerUserId) {
    // Admin filtering by specific status
    return db
      .prepare(
        `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
                r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
                r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at,
                resource.name AS resource_name, resource.type AS resource_type,
                resource.price_per_hour AS resource_price_per_hour
         FROM reservations r
         JOIN resources resource ON resource.id = r.resource_id
         LEFT JOIN users owner ON owner.id = r.user_id
         WHERE resource.location_id = ?
           AND r.start_time >= ?
           AND r.start_time < ?
           AND r.status = ?
         ORDER BY r.start_time`,
      )
      .all(locationId, dayStart, nextDayStart, status) as ReservationRow[];
  }

  if (ownerUserId) {
    // Regular user viewing own reservations - always exclude completed and cancelled
    const result = db
      .prepare(
        `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
                r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
                r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at,
                resource.name AS resource_name, resource.type AS resource_type,
                resource.price_per_hour AS resource_price_per_hour
         FROM reservations r
         JOIN resources resource ON resource.id = r.resource_id
         LEFT JOIN users owner ON owner.id = r.user_id
         WHERE resource.location_id = ?
           AND r.start_time >= ?
           AND r.start_time < ?
           AND r.user_id = ?
           AND r.status NOT IN ('completed', 'cancelled')
         ORDER BY r.start_time`,
      )
      .all(locationId, dayStart, nextDayStart, ownerUserId) as ReservationRow[];
    if (result.some(r => r.status === 'completed' || r.status === 'cancelled')) {
      throw new Error(`BUG: User ${ownerUserId} received completed/cancelled reservations: ${result.map(r => `${r.id}:${r.status}`).join(",")}`);
    }
    return result;
  }

  // Admin viewing all reservations
  return db
    .prepare(
      `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
              r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
              r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at,
              resource.name AS resource_name, resource.type AS resource_type,
              resource.price_per_hour AS resource_price_per_hour
       FROM reservations r
       JOIN resources resource ON resource.id = r.resource_id
       LEFT JOIN users owner ON owner.id = r.user_id
       WHERE resource.location_id = ?
         AND r.start_time >= ?
         AND r.start_time < ?
       ORDER BY r.start_time`,
    )
    .all(locationId, dayStart, nextDayStart) as ReservationRow[];
}

function getReservationStatus(reservationId: number): { id: number; status: ReservationStatus } | null {
  const row = db.prepare("SELECT id, status FROM reservations WHERE id = ?").get(reservationId) as
    | { id: number; status: ReservationStatus }
    | undefined;
  return row ?? null;
}

function getReservationWithResource(reservationId: number): ReservationRow {
  return db
    .prepare(
      `SELECT r.id, r.user_id, owner.username AS user_username, r.resource_id, r.client_name, r.client_phone,
              r.start_time, r.end_time, r.status, r.validated_by, r.validated_at, r.completed_by, r.completed_at,
              r.cancelled_by, r.cancelled_at, r.cancellation_reason, r.created_at,
              resource.name AS resource_name, resource.type AS resource_type,
              resource.price_per_hour AS resource_price_per_hour
       FROM reservations r
       JOIN resources resource ON resource.id = r.resource_id
       LEFT JOIN users owner ON owner.id = r.user_id
       WHERE r.id = ?`,
    )
    .get(reservationId) as ReservationRow;
}

function addOneDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return nextDate.toISOString().slice(0, 10);
}

function toApiReservation(row: ReservationRow) {
  const durationMinutes = diffMinutes(row.start_time, row.end_time);
  const pricePerHour = row.resource_price_per_hour;
  const estimatedCost =
    typeof pricePerHour === "number" ? roundMoney((durationMinutes / 60) * pricePerHour) : null;

  return {
    id: row.id,
    userId: row.user_id,
    username: row.user_username ?? null,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    resourceType: row.resource_type,
    pricePerHour,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes,
    status: row.status,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    estimatedCost,
  };
}

function isHalfHourAligned(time: string): boolean {
  return toMinutes(time) % SLOT_MINUTES === 0;
}

function isWithinBusinessHours(startTime: string, endTime: string): boolean {
  const startMinutes = toMinutes(startTime);
  const endMinutes = toMinutes(endTime);
  return startMinutes >= OPENING_HOUR * 60 && endMinutes <= CLOSING_HOUR * 60;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function diffMinutes(startDateTime: string, endDateTime: string): number {
  const startMinutes = toMinutes(startDateTime.slice(11, 16));
  const endMinutes = toMinutes(endDateTime.slice(11, 16));
  return endMinutes - startMinutes;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
