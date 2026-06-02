# Notentabellen SPA

Web-Anwendung zur Notenverwaltung der SPA-Bildungsgänge (Sozialpädagogische
Assistenz), als Ablösung der heutigen, dateiübergreifend verknüpften
Excel-Online-Lösung.

Ziel ist eine bewusst kleine, on-premise betriebene Web-App mit
geführter Eingabemaske, zentraler, deterministischer und getesteter
Notenberechnung, rollenbasiertem Zugriff und Zeugnisexport.

Fachliche & technische Grundlage: siehe
[`docs/Spezifikation.md`](docs/Spezifikation.md) (überführt aus der
Spezifikation v0.2) und den **Umsetzungsplan**
[`docs/UMSETZUNGSPLAN.md`](docs/UMSETZUNGSPLAN.md).

## Technologie

- **Sprache:** TypeScript (durchgängig)
- **Backend:** Node.js + Fastify
- **Datenbank:** SQLite (eine Datei, einfach zu sichern)
- **Frontend:** React
- **Auth:** Nextcloud/LDAP-SSO
- **Tests:** Vitest, inkl. Golden-Master-Verifikation gegen die Excel-Sollwerte

## Projektstruktur (geplant)

```
packages/
  core/     # Framework-unabhängiger Rechenkern + Tests (Meilenstein 1)
  server/   # Fastify-API, SQLite, Auth, Audit-Log
  web/      # React-Frontend (Eingabemasken, Zeugnisansicht, Admin)
data/        # Seed-Konfiguration (Fächer, Komponenten, Notenskala, WPK-Kurse)
docs/        # Spezifikation, Umsetzungsplan, Entscheidungen
```

## Lokal starten

```bash
npm install
npm run build

# Backend: DB anlegen + API starten (LDAP/JWT-Env nötig, siehe packages/server/.env.example)
cp packages/server/.env.example packages/server/.env   # Werte ausfüllen
npm run db:init --workspace @notentabellen/server
npm run dev --workspace @notentabellen/server           # API auf :3000

# Frontend (Dev-Server mit Proxy auf :3000)
npm run dev --workspace @notentabellen/web              # UI auf :5173
```

Tests/Checks über alle Pakete: `npm test`, `npm run typecheck`, `npm run build`.

## Status

In Aufbau. Fertig: M0–M5 (Rechenkern, DB/Seed, API, LDAP-Auth, Frontend).
Aktueller Stand und nächste Schritte: siehe Umsetzungsplan, „Meilensteinplan".
