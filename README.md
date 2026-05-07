# Sistem rezervare si inchiriere

Aplicatie full-stack pentru rezervari sportive multi-companie, cu:
- companii si locatii multiple
- resurse diferite (terenuri, biliard, bowling, karting)
- calendar de rezervari pe locatie si data
- creare rezervare pentru clienti
- validare inchiriere pentru angajatii locatiei

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
- `GET /api/reservations/pending?locationId=1&date=YYYY-MM-DD`
- `POST /api/reservations`
- `POST /api/reservations/:reservationId/validate`

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
