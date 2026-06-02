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

Konfiguration anlegen (Werte ausfüllen, `.env` ist gitignored):

```bash
npm install
cp packages/server/.env.example packages/server/.env   # JWT_SECRET, LDAP_* etc.
```

### Variante A: Ein Server (empfohlen, auch fürs Deployment)

Das gebaute Frontend wird vom Backend mitausgeliefert — alles läuft auf **einem
Port (:3000)**, ohne Dev-Proxy. Die App ist im Browser direkt unter
`http://localhost:3000` erreichbar.

```bash
npm run build                                   # u. a. packages/web/dist
npm run dev --workspace @notentabellen/server   # App + API auf :3000
# oder produktiv: npm run start --workspace @notentabellen/server
```

> Hinweis: Liegt `packages/web/dist` nicht vor (kein `npm run build`), liefert
> der Server nur die API aus — die Startmeldung weist darauf hin.

### Variante B: Zwei Dev-Server (Hot-Reload fürs Frontend)

```bash
npm run dev --workspace @notentabellen/server   # API auf :3000
npm run dev --workspace @notentabellen/web      # UI auf :5173 (Proxy → :3000)
```

Hier ist die App unter `http://localhost:5173` erreichbar; `/api`-Aufrufe
werden per Vite-Proxy an `:3000` weitergeleitet.

Tests/Checks über alle Pakete: `npm test`, `npm run typecheck`, `npm run build`.

## Status

In Aufbau. Fertig: M0–M6 (Rechenkern, DB/Seed, API, LDAP-Auth, Frontend,
Admin-UI). Aktueller Stand und nächste Schritte: siehe Umsetzungsplan,
„Meilensteinplan".
