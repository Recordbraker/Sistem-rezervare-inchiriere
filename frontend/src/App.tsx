import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

type ReservationStatus = "pending" | "validated" | "completed" | "cancelled";

type Reservation = {
  id: number;
  resourceId: number;
  clientName: string;
  clientPhone: string;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  validatedBy: string | null;
  validatedAt: string | null;
  createdAt: string;
  resourceName?: string;
};

type ResourceCalendar = {
  id: number;
  name: string;
  type: string;
  pricePerHour: number;
  reservations: Reservation[];
};

type CalendarResponse = {
  location: {
    id: number;
    name: string;
    city: string;
    address: string;
    companyName: string;
  };
  date: string;
  resources: ResourceCalendar[];
};

type Location = {
  id: number;
  name: string;
  city: string;
  address: string;
};

type Company = {
  id: number;
  name: string;
  locations: Location[];
};

function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(getTodayDate());

  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [pendingReservations, setPendingReservations] = useState<Reservation[]>([]);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [resourceId, setResourceId] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [employeeName, setEmployeeName] = useState("");

  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const availableLocations = selectedCompany?.locations ?? [];

  useEffect(() => {
    void loadCompanies();
  }, []);

  useEffect(() => {
    if (availableLocations.length === 0) {
      setSelectedLocationId(null);
      return;
    }

    const exists = availableLocations.some((location) => location.id === selectedLocationId);
    if (!exists) {
      setSelectedLocationId(availableLocations[0].id);
    }
  }, [availableLocations, selectedLocationId]);

  useEffect(() => {
    if (!selectedLocationId) {
      return;
    }

    void loadCalendarAndPending(selectedLocationId, selectedDate);
  }, [selectedLocationId, selectedDate]);

  useEffect(() => {
    if (calendar?.resources.length) {
      const exists = calendar.resources.some((resource) => resource.id === resourceId);
      if (!exists) {
        setResourceId(calendar.resources[0].id);
      }
    } else {
      setResourceId(null);
    }
  }, [calendar, resourceId]);

  async function loadCompanies(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<{ companies: Company[] }>(`${API_BASE}/companies`);
      setCompanies(response.companies);
      if (response.companies.length > 0) {
        setSelectedCompanyId(response.companies[0].id);
      }
    } catch (loadError) {
      setError(getMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function loadCalendarAndPending(locationId: number, date: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [calendarResponse, pendingResponse] = await Promise.all([
        fetchJson<CalendarResponse>(`${API_BASE}/locations/${locationId}/calendar?date=${date}`),
        fetchJson<{ reservations: Reservation[] }>(
          `${API_BASE}/reservations/pending?locationId=${locationId}&date=${date}`,
        ),
      ]);

      setCalendar(calendarResponse);
      setPendingReservations(pendingResponse.reservations);
    } catch (loadError) {
      setError(getMessage(loadError));
      setCalendar(null);
      setPendingReservations([]);
    } finally {
      setLoading(false);
    }
  }

  async function onCreateReservation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedLocationId || !resourceId) {
      setError("Alege o locatie si o resursa inainte de creare.");
      return;
    }

    setLoading(true);
    setError(null);
    setAlert(null);

    try {
      const response = await fetchJson<{ message: string }>(`${API_BASE}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: selectedLocationId,
          resourceId,
          clientName,
          clientPhone,
          date: selectedDate,
          startTime,
          endTime,
        }),
      });

      setAlert(response.message);
      await loadCalendarAndPending(selectedLocationId, selectedDate);
      setClientName("");
      setClientPhone("");
    } catch (createError) {
      setError(getMessage(createError));
    } finally {
      setLoading(false);
    }
  }

  async function onValidateReservation(reservationId: number): Promise<void> {
    if (!selectedLocationId) {
      return;
    }

    setLoading(true);
    setError(null);
    setAlert(null);

    try {
      const response = await fetchJson<{ message: string }>(
        `${API_BASE}/reservations/${reservationId}/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeName,
          }),
        },
      );
      setAlert(response.message);
      await loadCalendarAndPending(selectedLocationId, selectedDate);
    } catch (validateError) {
      setError(getMessage(validateError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="tag">Platforma sportiva multi-companie</p>
        <h1>Sistem rezervare si inchiriere</h1>
        <p className="subtitle">
          Rezervari rapide pentru terenuri, biliard, bowling sau karting, plus validare inchirieri
          direct din locatie.
        </p>
      </section>

      <section className="panel filters">
        <label>
          Companie
          <select
            value={selectedCompanyId ?? ""}
            onChange={(event) => setSelectedCompanyId(Number(event.target.value))}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Locatie
          <select
            value={selectedLocationId ?? ""}
            onChange={(event) => setSelectedLocationId(Number(event.target.value))}
          >
            {availableLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} - {location.city}
              </option>
            ))}
          </select>
        </label>

        <label>
          Data
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>
      </section>

      {alert && <p className="message success">{alert}</p>}
      {error && <p className="message error">{error}</p>}
      {loading && <p className="message info">Se actualizeaza datele...</p>}

      <section className="panel">
        <h2>Calendarul locatiei</h2>
        {calendar?.location ? (
          <>
            <p className="location-meta">
              <strong>{calendar.location.name}</strong> - {calendar.location.city},{" "}
              {calendar.location.address} ({calendar.location.companyName})
            </p>
            <div className="calendar-grid">
              {calendar.resources.map((resource) => (
                <article className="resource-card" key={resource.id}>
                  <header>
                    <h3>{resource.name}</h3>
                    <span>{resource.type}</span>
                  </header>
                  <p className="price">{resource.pricePerHour} RON / ora</p>
                  <ul>
                    {resource.reservations.length === 0 ? (
                      <li className="empty">Fara rezervari</li>
                    ) : (
                      resource.reservations.map((reservation) => (
                        <li key={reservation.id}>
                          <div>
                            <strong>
                              {formatHour(reservation.startTime)} - {formatHour(reservation.endTime)}
                            </strong>
                            <p>{reservation.clientName}</p>
                          </div>
                          <span className={`status ${reservation.status}`}>
                            {translateStatus(reservation.status)}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p>Selecteaza o locatie pentru a vedea calendarul.</p>
        )}
      </section>

      <section className="panel two-col">
        <form className="reservation-form" onSubmit={(event) => void onCreateReservation(event)}>
          <h2>Creare rezervare noua</h2>

          <label>
            Resursa
            <select
              value={resourceId ?? ""}
              onChange={(event) => setResourceId(Number(event.target.value))}
            >
              {(calendar?.resources ?? []).map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name} ({resource.type})
                </option>
              ))}
            </select>
          </label>

          <div className="row">
            <label>
              Ora start
              <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </label>
            <label>
              Ora final
              <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </label>
          </div>

          <label>
            Nume client
            <input
              type="text"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder="Ex: Popescu Andrei"
              required
            />
          </label>

          <label>
            Telefon client
            <input
              type="text"
              value={clientPhone}
              onChange={(event) => setClientPhone(event.target.value)}
              placeholder="Ex: 07xx xxx xxx"
              required
            />
          </label>

          <button type="submit" disabled={loading}>
            Creeaza rezervare
          </button>
        </form>

        <div className="pending-list">
          <h2>Validare inchirieri</h2>
          <label>
            Angajat validare
            <input
              type="text"
              value={employeeName}
              onChange={(event) => setEmployeeName(event.target.value)}
              placeholder="Ex: Operator receptie"
            />
          </label>

          <ul>
            {pendingReservations.length === 0 ? (
              <li className="empty">Nu exista inchirieri pending pentru data selectata.</li>
            ) : (
              pendingReservations.map((reservation) => (
                <li key={reservation.id}>
                  <div>
                    <strong>{reservation.resourceName ?? `Resursa #${reservation.resourceId}`}</strong>
                    <p>
                      {formatHour(reservation.startTime)} - {formatHour(reservation.endTime)} |{" "}
                      {reservation.clientName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onValidateReservation(reservation.id)}
                    disabled={loading || employeeName.trim().length < 3}
                  >
                    Valideaza
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHour(dateTime: string): string {
  return dateTime.slice(11, 16);
}

function translateStatus(status: ReservationStatus): string {
  switch (status) {
    case "pending":
      return "in asteptare";
    case "validated":
      return "validata";
    case "completed":
      return "finalizata";
    case "cancelled":
      return "anulata";
  }
}

function getMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "A aparut o eroare necunoscuta.";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "Cererea a esuat.");
  }
  return payload as T;
}

export default App;
