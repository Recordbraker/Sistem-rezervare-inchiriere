import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const AUTH_TOKEN_STORAGE_KEY = "rezervari.auth.token";
const AUTH_USER_STORAGE_KEY = "rezervari.auth.user";

type AppView = "register" | "login" | "dashboard";
type UserRole = "admin" | "user";

type AuthUser = {
  id: number;
  email: string;
  username: string;
  role: UserRole;
};

type ReservationStatus = "pending" | "validated" | "completed" | "cancelled";

type Reservation = {
  id: number;
  userId: number | null;
  username: string | null;
  resourceId: number;
  resourceName?: string;
  resourceType?: string;
  pricePerHour?: number;
  clientName: string;
  clientPhone: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: ReservationStatus;
  validatedBy: string | null;
  validatedAt: string | null;
  completedBy: string | null;
  completedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  estimatedCost: number | null;
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

type SummaryResponse = {
  date: string;
  resourceCount: number;
  reservations: {
    total: number;
    byStatus: Record<ReservationStatus, number>;
  };
  utilizationPercent: number;
  revenue: {
    totalPotential: number;
    confirmed: number;
    pending: number;
  };
  businessHours: {
    start: string;
    end: string;
  };
};

type AvailabilityResponse = {
  date: string;
  durationMinutes: number;
  freeSlots: Array<{ startTime: string; endTime: string }>;
  totalSlots: number;
  availableSlots: number;
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

type ReservationAction = "validate" | "complete" | "cancel";

const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180];

function App() {
  const [authToken, setAuthToken] = useState<string | null>(() => readStoredToken());
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => readStoredUser());
  const [checkingSession, setCheckingSession] = useState<boolean>(() => Boolean(readStoredToken()));
  const [currentView, setCurrentView] = useState<AppView>(() =>
    readStoredToken() ? "dashboard" : "register",
  );

  const [registerEmail, setRegisterEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authAlert, setAuthAlert] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(getTodayDate());

  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [resourceId, setResourceId] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("10:00");
  const [durationMinutes, setDurationMinutes] = useState(60);

  const [employeeName, setEmployeeName] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ReservationStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [submittingReservation, setSubmittingReservation] = useState(false);
  const [actingReservationId, setActingReservationId] = useState<number | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = Boolean(authToken && authUser);
  const isAdmin = authUser?.role === "admin";

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const availableLocations = selectedCompany?.locations ?? [];

  const selectedResource = useMemo(
    () => calendar?.resources.find((resource) => resource.id === resourceId) ?? null,
    [calendar, resourceId],
  );

  const computedEndTime = useMemo(
    () => addMinutesToTime(startTime, durationMinutes),
    [startTime, durationMinutes],
  );

  const estimatedCost = useMemo(() => {
    if (!selectedResource) {
      return null;
    }
    return roundMoney((durationMinutes / 60) * selectedResource.pricePerHour);
  }, [selectedResource, durationMinutes]);

  const filteredReservations = useMemo(() => {
    const lowerSearch = searchTerm.trim().toLowerCase();
    return reservations.filter((reservation) => {
      const statusMatches = statusFilter === "all" || reservation.status === statusFilter;
      if (!statusMatches) {
        return false;
      }

      if (!lowerSearch) {
        return true;
      }

      const haystack = [
        reservation.clientName,
        reservation.clientPhone,
        reservation.resourceName ?? "",
        reservation.resourceType ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(lowerSearch);
    });
  }, [reservations, searchTerm, statusFilter]);

  useEffect(() => {
    let ignore = false;

    if (!authToken) {
      setCheckingSession(false);
      setAuthUser(null);
      return;
    }

    setCheckingSession(true);
    void fetchJson<{ user: AuthUser }>(`${API_BASE}/auth/me`, undefined, authToken)
      .then((response) => {
        if (ignore) {
          return;
        }
        setAuthUser(response.user);
        writeStoredUser(response.user);
      })
      .catch((sessionError) => {
        if (ignore) {
          return;
        }
        clearStoredAuth();
        setAuthToken(null);
        setAuthUser(null);
        setCurrentView("login");
        setAuthError(getMessage(sessionError));
      })
      .finally(() => {
        if (!ignore) {
          setCheckingSession(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!isAuthenticated || currentView !== "dashboard") {
      return;
    }

    void loadCompanies();
  }, [currentView, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || currentView !== "dashboard") {
      setSelectedLocationId(null);
      return;
    }

    if (availableLocations.length === 0) {
      setSelectedLocationId(null);
      return;
    }

    const exists = availableLocations.some((location) => location.id === selectedLocationId);
    if (!exists) {
      setSelectedLocationId(availableLocations[0].id);
    }
  }, [availableLocations, currentView, isAuthenticated, selectedLocationId]);

  useEffect(() => {
    if (!isAuthenticated || currentView !== "dashboard") {
      return;
    }
    if (!selectedLocationId) {
      return;
    }

    void loadDashboard(selectedLocationId, selectedDate);
  }, [currentView, isAuthenticated, selectedDate, selectedLocationId]);

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

  useEffect(() => {
    if (!isAuthenticated || currentView !== "dashboard") {
      return;
    }
    if (!resourceId) {
      setAvailability(null);
      return;
    }

    void loadAvailability(resourceId, selectedDate, durationMinutes);
  }, [currentView, durationMinutes, isAuthenticated, resourceId, selectedDate]);

  async function onRegister(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthAlert(null);

    try {
      const response = await fetchJson<{ message: string }>(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: registerUsername,
          email: registerEmail,
          password: registerPassword,
        }),
      });

      setAuthAlert(response.message);
      setLoginEmail(registerEmail);
      setLoginPassword(registerPassword);
      setRegisterEmail("");
      setRegisterUsername("");
      setRegisterPassword("");
      setCurrentView("login");
    } catch (registerError) {
      setAuthError(getMessage(registerError));
    } finally {
      setAuthLoading(false);
    }
  }

  async function onLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthAlert(null);

    try {
      const response = await fetchJson<{ message: string; user: AuthUser }>(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });

      const token = buildBasicToken(loginEmail, loginPassword);
      writeStoredToken(token);
      writeStoredUser(response.user);

      setAuthToken(token);
      setAuthUser(response.user);
      setCurrentView("dashboard");
      setAuthAlert(response.message);
      setAlert(`Bun venit, ${response.user.username}.`);
      setAuthError(null);
    } catch (loginError) {
      setAuthError(getMessage(loginError));
    } finally {
      setAuthLoading(false);
    }
  }

  async function onLogout(): Promise<void> {
    const tokenSnapshot = authToken;

    try {
      if (tokenSnapshot) {
        await fetchJson<{ message: string }>(
          `${API_BASE}/auth/logout`,
          {
            method: "POST",
          },
          tokenSnapshot,
        );
      }
    } catch {
      // Chiar daca API-ul raspunde cu eroare, cleanup-ul local trebuie facut.
    }

    clearStoredAuth();
    setAuthToken(null);
    setAuthUser(null);
    setCurrentView("register");
    setCompanies([]);
    setCalendar(null);
    setSummary(null);
    setReservations([]);
    setAvailability(null);
    setSelectedCompanyId(null);
    setSelectedLocationId(null);
    setResourceId(null);

    setAlert(null);
    setError(null);
    setAuthError(null);
    setAuthAlert("Logout efectuat.");
  }

  function navigate(view: AppView): void {
    setCurrentView(view);
    setAuthError(null);
    setAuthAlert(null);
    setError(null);
    setAlert(null);
  }

  async function loadCompanies(): Promise<void> {
    setLoadingDashboard(true);
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
      setLoadingDashboard(false);
    }
  }

  async function loadDashboard(locationId: number, date: string): Promise<void> {
    if (!authToken) {
      setError("Autentificare necesara.");
      return;
    }

    setLoadingDashboard(true);
    setError(null);

    try {
      const reservationsPromise = fetchJson<{ reservations: Reservation[] }>(
        `${API_BASE}/reservations?locationId=${locationId}&date=${date}&status=all`,
        undefined,
        authToken,
      );

      const [calendarResponse, summaryResponse, reservationsResponse] = await Promise.all([
        fetchJson<CalendarResponse>(`${API_BASE}/locations/${locationId}/calendar?date=${date}`, undefined, authToken),
        fetchJson<SummaryResponse>(`${API_BASE}/locations/${locationId}/summary?date=${date}`, undefined, authToken),
        reservationsPromise,
      ]);

      setCalendar(calendarResponse);
      setSummary(summaryResponse);
      setReservations(reservationsResponse.reservations);
    } catch (loadError) {
      setError(getMessage(loadError));
      setCalendar(null);
      setSummary(null);
      setReservations([]);
    } finally {
      setLoadingDashboard(false);
    }
  }

  async function loadAvailability(
    selectedResourceId: number,
    date: string,
    selectedDuration: number,
  ): Promise<void> {
    setLoadingAvailability(true);
    try {
      const availabilityResponse = await fetchJson<AvailabilityResponse>(
        `${API_BASE}/resources/${selectedResourceId}/availability?date=${date}&durationMinutes=${selectedDuration}`,
      );
      setAvailability(availabilityResponse);
    } catch (availabilityError) {
      setAvailability(null);
      setError(getMessage(availabilityError));
    } finally {
      setLoadingAvailability(false);
    }
  }

  async function refreshDashboard(): Promise<void> {
    if (!selectedLocationId) {
      return;
    }

    await loadDashboard(selectedLocationId, selectedDate);
    if (resourceId) {
      await loadAvailability(resourceId, selectedDate, durationMinutes);
    }
  }

  async function onCreateReservation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!authToken) {
      setError("Autentificare necesara.");
      return;
    }

    if (!selectedLocationId || !resourceId) {
      setError("Alege o locatie si o resursa inainte de creare.");
      return;
    }

    if (!computedEndTime) {
      setError("Intervalul ales depaseste capatul zilei. Ajusteaza ora sau durata.");
      return;
    }

    setSubmittingReservation(true);
    setError(null);
    setAlert(null);

    try {
      const response = await fetchJson<{ message: string }>(
        `${API_BASE}/reservations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: selectedLocationId,
            resourceId,
            clientName,
            clientPhone,
            date: selectedDate,
            startTime,
            endTime: computedEndTime,
          }),
        },
        authToken,
      );

      setAlert(response.message);
      setClientName("");
      setClientPhone("");
      await refreshDashboard();
    } catch (createError) {
      setError(getMessage(createError));
    } finally {
      setSubmittingReservation(false);
    }
  }

  async function onReservationAction(
    reservationId: number,
    action: ReservationAction,
  ): Promise<void> {
    if (!authToken) {
      setError("Autentificare necesara.");
      return;
    }

    const employee = employeeName.trim();
    if (employee.length < 3) {
      setError("Completeaza numele angajatului (minim 3 caractere).");
      return;
    }

    const payload: Record<string, string> = { employeeName: employee };
    let endpoint: string;

    if (action === "cancel") {
      const reason = cancelReason.trim();
      if (reason.length < 3) {
        setError("Motivul anularii este obligatoriu (minim 3 caractere).");
        return;
      }

      endpoint = "cancel";
      payload.reason = reason;
    } else {
      endpoint = action === "validate" ? "validate" : "complete";
    }

    setActingReservationId(reservationId);
    setError(null);
    setAlert(null);

    try {
      const response = await fetchJson<{ message: string }>(
        `${API_BASE}/reservations/${reservationId}/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        authToken,
      );

      setAlert(response.message);
      if (action === "cancel") {
        setCancelReason("");
      }
      await refreshDashboard();
    } catch (actionError) {
      setError(getMessage(actionError));
    } finally {
      setActingReservationId(null);
    }
  }

  function moveDateBy(days: number): void {
    setSelectedDate((previous) => shiftDate(previous, days));
  }

  function renderAuthPage() {
    return (
      <section className="auth-card panel">
        <h1>{currentView === "register" ? "Creeaza cont" : "Autentificare"}</h1>
        <p className="subtitle auth-subtitle">
          {currentView === "register"
            ? "Completeaza email-ul si parola pentru a crea un cont nou."
            : "Introdu datele de acces pentru a intra in aplicatie."}
        </p>

        {authAlert && <p className="message success">{authAlert}</p>}
        {authError && <p className="message error">{authError}</p>}
        {checkingSession && <p className="message info">Se verifica sesiunea...</p>}

        {currentView === "register" ? (
          <form className="auth-form" onSubmit={(event) => void onRegister(event)}>
            <label>
              Username
              <input
                type="text"
                value={registerUsername}
                onChange={(event) => setRegisterUsername(event.target.value)}
                placeholder="ex: andrei.popescu"
                minLength={3}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                placeholder="nume@exemplu.ro"
                required
              />
            </label>
            <label>
              Parola
              <input
                type="password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                placeholder="minim 4 caractere"
                minLength={4}
                required
              />
            </label>
            <button type="submit" disabled={authLoading || checkingSession}>
              {authLoading ? "Se creeaza..." : "Register"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(event) => void onLogin(event)}>
            <label>
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="nume@exemplu.ro"
                required
              />
            </label>
            <label>
              Parola
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="parola contului"
                required
              />
            </label>
            <button type="submit" disabled={authLoading || checkingSession}>
              {authLoading ? "Se autentifica..." : "Login"}
            </button>
          </form>
        )}
      </section>
    );
  }

  function renderDashboard() {
    return (
      <>
        <section className="hero panel">
          <div>
            <p className="eyebrow">Gestionare rezervari sportive</p>
            <h1>Dashboard inchirieri</h1>
            <p className="subtitle">
              Calendar pe locatie, sloturi libere calculate automat si management complet pentru
              validare, finalizare sau anulare.
            </p>
            {authUser && (
              <p className="auth-badge">
                Utilizator: <strong>{authUser.username}</strong> ({authUser.role})
              </p>
            )}
          </div>

          <div className="hero-controls">
            <button type="button" onClick={() => moveDateBy(-1)}>
              Ziua anterioara
            </button>
            <button type="button" onClick={() => moveDateBy(1)}>
              Ziua urmatoare
            </button>
            <button type="button" onClick={() => void refreshDashboard()} disabled={loadingDashboard}>
              Reincarca date
            </button>
          </div>
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
        {loadingDashboard && <p className="message info">Se actualizeaza dashboard-ul...</p>}

        <section className="stats-grid">
          <article className="stat-card panel">
            <h3>Resurse active</h3>
            <p className="stat-value">{summary?.resourceCount ?? 0}</p>
            <small>
              Program {summary?.businessHours.start ?? "08:00"} - {summary?.businessHours.end ?? "23:00"}
            </small>
          </article>

          <article className="stat-card panel">
            <h3>Rezervari totale</h3>
            <p className="stat-value">{summary?.reservations.total ?? 0}</p>
            <small>
              pending {summary?.reservations.byStatus.pending ?? 0} | validate{" "}
              {summary?.reservations.byStatus.validated ?? 0}
            </small>
          </article>

          <article className="stat-card panel">
            <h3>Utilizare zi</h3>
            <p className="stat-value">{summary ? `${summary.utilizationPercent}%` : "0%"}</p>
            <small>capacitate folosita pe toate resursele</small>
          </article>

          <article className="stat-card panel">
            <h3>Venit potential</h3>
            <p className="stat-value">{formatCurrency(summary?.revenue.totalPotential ?? 0)}</p>
            <small>confirmat {formatCurrency(summary?.revenue.confirmed ?? 0)}</small>
          </article>
        </section>

        <section className="layout">
          <section className="panel">
            <h2>Calendar locatie</h2>
            {calendar?.location ? (
              <>
                <p className="location-meta">
                  <strong>{calendar.location.name}</strong> - {calendar.location.city}, {calendar.location.address} (
                  {" "}
                  {calendar.location.companyName})
                </p>
                <div className="calendar-grid">
                  {calendar.resources.map((resource) => (
                    <article className="resource-card" key={resource.id}>
                      <header>
                        <h3>{resource.name}</h3>
                        <span>{resource.type}</span>
                      </header>
                      <p className="price">{formatCurrency(resource.pricePerHour)} / ora</p>

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

          <section className="stack">
            <article className="panel">
              <h2>Sloturi disponibile</h2>
              {selectedResource ? (
                <>
                  <p className="location-meta">
                    {selectedResource.name} ({selectedResource.type}) pentru {durationMinutes} minute
                  </p>
                  {loadingAvailability ? (
                    <p>Se calculeaza sloturile...</p>
                  ) : availability && availability.freeSlots.length > 0 ? (
                    <>
                      <p className="slot-meta">
                        {availability.availableSlots} sloturi libere din {availability.totalSlots}
                      </p>
                      <div className="slot-list">
                        {availability.freeSlots.slice(0, 12).map((slot) => (
                          <button
                            key={`${slot.startTime}-${slot.endTime}`}
                            type="button"
                            className="slot-btn"
                            onClick={() => setStartTime(slot.startTime.slice(11, 16))}
                          >
                            {formatHour(slot.startTime)} - {formatHour(slot.endTime)}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p>Nu exista sloturi libere pentru durata selectata.</p>
                  )}
                </>
              ) : (
                <p>Alege o resursa pentru a calcula sloturile libere.</p>
              )}
            </article>

            <form className="panel reservation-form" onSubmit={(event) => void onCreateReservation(event)}>
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
                  <input
                    type="time"
                    step={1800}
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                  />
                </label>

                <label>
                  Durata
                  <select
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(Number(event.target.value))}
                  >
                    {DURATION_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="summary-line">
                <span>Ora finala: {computedEndTime ?? "--:--"}</span>
                <span>Cost estimat: {formatCurrency(estimatedCost ?? 0)}</span>
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

              <button type="submit" disabled={submittingReservation || loadingDashboard}>
                Creeaza rezervare
              </button>
            </form>
          </section>
        </section>

        {isAdmin ? (
          <section className="panel management">
            <h2>Toate Rezervările (admin)</h2>

            <div className="management-controls">
              <label>
                Status
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as "all" | ReservationStatus)
                  }
                >
                  <option value="all">Toate</option>
                  <option value="pending">Pending</option>
                  <option value="validated">Validate</option>
                  <option value="completed">Finalizate</option>
                  <option value="cancelled">Anulate</option>
                </select>
              </label>

              <label>
                Cautare
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="client, telefon, resursa"
                />
              </label>

              <label>
                Angajat
                <input
                  type="text"
                  value={employeeName}
                  onChange={(event) => setEmployeeName(event.target.value)}
                  placeholder="Ex: Operator receptie"
                />
              </label>

              <label>
                Motiv anulare
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Obligatoriu pentru anulare"
                />
              </label>
            </div>

            <ul className="reservation-list">
              {filteredReservations.length === 0 ? (
                <li className="empty">Nu exista rezervari pentru filtrele selectate.</li>
              ) : (
                filteredReservations.map((reservation) => (
                  <li key={reservation.id} className="reservation-item">
                    <div>
                      <strong>
                        {formatHour(reservation.startTime)} - {formatHour(reservation.endTime)} |{" "}
                        {reservation.resourceName ?? `Resursa #${reservation.resourceId}`}
                      </strong>
                      <p>
                        {reservation.clientName} - {reservation.clientPhone}
                      </p>
                      <p className="reservation-meta">
                        {reservation.durationMinutes} min | {formatCurrency(reservation.estimatedCost ?? 0)}
                        {reservation.status === "cancelled" && reservation.cancellationReason
                          ? ` | motiv: ${reservation.cancellationReason}`
                          : ""}
                        {reservation.status === "completed" && reservation.completedBy
                          ? ` | finalizata de: ${reservation.completedBy}`
                          : ""}
                      </p>
                    </div>

                    <div className="reservation-actions">
                      <span className={`status ${reservation.status}`}>
                        {translateStatus(reservation.status)}
                      </span>

                      {reservation.status === "pending" && (
                        <>
                          <button
                            type="button"
                            onClick={() => void onReservationAction(reservation.id, "validate")}
                            disabled={actingReservationId === reservation.id || loadingDashboard}
                          >
                            Valideaza
                          </button>
                          <button
                            type="button"
                            className="warning"
                            onClick={() => void onReservationAction(reservation.id, "cancel")}
                            disabled={actingReservationId === reservation.id || loadingDashboard}
                          >
                            Anuleaza
                          </button>
                        </>
                      )}

                      {reservation.status === "validated" && (
                        <>
                          <button
                            type="button"
                            onClick={() => void onReservationAction(reservation.id, "complete")}
                            disabled={actingReservationId === reservation.id || loadingDashboard}
                          >
                            Finalizeaza
                          </button>
                          <button
                            type="button"
                            className="warning"
                            onClick={() => void onReservationAction(reservation.id, "cancel")}
                            disabled={actingReservationId === reservation.id || loadingDashboard}
                          >
                            Anuleaza
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>
        ) : (
          <section className="panel user-note">
            <h2>Rezervările mele</h2>
            <p>
              Esti autentificat ca <strong>user</strong>. Aici sunt afisate doar rezervarile tale active.
            </p>

            <ul className="reservation-list">
              {reservations.length === 0 ? (
                <li className="empty">Nu ai rezervari pentru ziua selectata.</li>
              ) : (
                reservations.map((reservation) => (
                  <li key={reservation.id} className="reservation-item">
                    <div>
                      <strong>
                        {formatHour(reservation.startTime)} - {formatHour(reservation.endTime)} |{" "}
                        {reservation.resourceName ?? `Resursa #${reservation.resourceId}`}
                      </strong>
                      <p>
                        {reservation.clientName} - {reservation.clientPhone}
                      </p>
                      <p className="reservation-meta">
                        {reservation.durationMinutes} min | {formatCurrency(reservation.estimatedCost ?? 0)}
                        {reservation.status === "cancelled" && reservation.cancellationReason
                          ? ` | motiv: ${reservation.cancellationReason}`
                          : ""}
                      </p>
                    </div>
                    <div className="reservation-actions">
                      <span className={`status ${reservation.status}`}>
                        {translateStatus(reservation.status)}
                      </span>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <main className="page">
      <section className="top-nav panel">
        <div className="nav-left">
          <p className="eyebrow">Navigare</p>
          <h2>Autentificare si dashboard</h2>
        </div>
        <div className="nav-actions">
          <button type="button" className="ghost-btn" onClick={() => navigate("register")}>
            Register
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate("login")}>
            Login
          </button>
          <button type="button" className="ghost-btn warning" onClick={() => void onLogout()}>
            Logout
          </button>
        </div>
      </section>

      {currentView === "dashboard" ? (
        checkingSession ? (
          <p className="message info">Se verifica sesiunea...</p>
        ) : isAuthenticated ? (
          renderDashboard()
        ) : (
          <section className="auth-card panel">
            <p className="message error">Nu esti autentificat. Intra pe pagina de login.</p>
          </section>
        )
      ) : (
        renderAuthPage()
      )}
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

function shiftDate(date: string, offsetDays: number): string {
  const current = new Date(`${date}T00:00:00`);
  current.setDate(current.getDate() + offsetDays);
  const year = current.getFullYear();
  const month = `${current.getMonth() + 1}`.padStart(2, "0");
  const day = `${current.getDate()}`.padStart(2, "0");
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

function addMinutesToTime(time: string, minutesToAdd: number): string | null {
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const total = hours * 60 + minutes + minutesToAdd;
  if (total >= 24 * 60) {
    return null;
  }

  const finalHours = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const finalMinutes = (total % 60).toString().padStart(2, "0");
  return `${finalHours}:${finalMinutes}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    maximumFractionDigits: 2,
  }).format(value);
}

function getMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "A aparut o eroare necunoscuta.";
}

function readStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

function readStoredUser(): AuthUser | null {
  const rawValue = localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AuthUser>;
    if (
      typeof parsed.id === "number" &&
      typeof parsed.email === "string" &&
      typeof parsed.username === "string" &&
      (parsed.role === "admin" || parsed.role === "user")
    ) {
      return {
        id: parsed.id,
        email: parsed.email,
        username: parsed.username,
        role: parsed.role,
      };
    }
  } catch {
    // Ignoram parse errors si resetam stocarea.
  }

  return null;
}

function writeStoredToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

function writeStoredUser(user: AuthUser): void {
  localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
}

function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
}

function buildBasicToken(email: string, password: string): string {
  const credentials = `${email}:${password}`;
  const bytes = new TextEncoder().encode(credentials);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `Basic ${window.btoa(binary)}`;
}

async function fetchJson<T>(url: string, init?: RequestInit, authToken?: string | null): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (authToken) {
    headers.set("Authorization", authToken);
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { message?: string }) : {};

  if (!response.ok) {
    throw new Error(payload.message ?? "Cererea a esuat.");
  }

  return payload as T;
}

export default App;
