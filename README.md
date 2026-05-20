# Sistem rezervare si inchiriere

Aplicatie full-stack pentru rezervari sportive multi-companie, cu dashboard de operare pentru clienti si personal locatie.

## Functionalitati

- companii si locatii multiple
- calendar pe resurse (terenuri, biliard, bowling, karting)
- creare rezervare cu validari pe intervale de 30 minute
- calcul sloturi disponibile pentru durata selectata
- validare, finalizare si anulare rezervari (cu motiv si angajat)
- sumar zilnic: numar rezervari, utilizare si venit estimat
- filtrare rezervari dupa status si cautare dupa client/telefon/resursa

## Stack tehnic

- **Backend:** Node.js, Express, SQLite (`better-sqlite3`)
- **Frontend:** React + Vite + TypeScript

## Structura proiect

```text
.
├── backend
│   ├── src
│   └── data (creata automat la prima rulare)
├── frontend
│   └── src
└── package.json (workspace root)
```

## Cerinte

- Node.js 20+
- npm 10+

## Instalare

Din radacina repository-ului:

```bash
npm install
```

## Configurare mediu

1. Backend:
```bash
cp backend/.env.example backend/.env
```
2. Frontend:
```bash
cp frontend/.env.example frontend/.env
```

Configurarea implicita functioneaza local:
- backend pe `http://localhost:4000`
- frontend pe `http://localhost:5173`

## Rulare in dezvoltare

Porneste backend + frontend simultan:

```bash
npm run dev
```

## Build productie

```bash
npm run build
```

## API disponibil

- `GET /api/health`
- `GET /api/companies`
- `GET /api/locations/:locationId/calendar?date=YYYY-MM-DD`
- `GET /api/locations/:locationId/summary?date=YYYY-MM-DD`
- `GET /api/resources/:resourceId/availability?date=YYYY-MM-DD&durationMinutes=60`
- `GET /api/reservations?locationId=1&date=YYYY-MM-DD&status=all`
- `GET /api/reservations/pending?locationId=1&date=YYYY-MM-DD`
- `POST /api/reservations`
- `POST /api/reservations/:reservationId/validate`
- `POST /api/reservations/:reservationId/complete`
- `POST /api/reservations/:reservationId/cancel`

## Exemplu payload creare rezervare

```json
{
  "locationId": 1,
  "resourceId": 2,
  "clientName": "Popescu Andrei",
  "clientPhone": "0722 123 123",
  "date": "2026-05-08",
  "startTime": "10:00",
  "endTime": "11:30"
}
```

## Exemplu payload anulare rezervare

```json
{
  "employeeName": "Operator receptie",
  "reason": "Clientul a anuntat ca nu mai poate ajunge"
}
```
