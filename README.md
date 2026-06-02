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

Der Port ist über `PORT` in der `.env` frei wählbar (Default **4000**). Die
folgenden Beispiele nutzen den Default.

### Variante A: Ein Server (empfohlen, auch fürs Deployment)

Das gebaute Frontend wird vom Backend mitausgeliefert — alles läuft auf **einem
Port (:4000)**, ohne Dev-Proxy. Die App ist im Browser direkt unter
`http://localhost:4000` erreichbar.

```bash
npm run build                                   # u. a. packages/web/dist
npm run dev --workspace @notentabellen/server   # App + API auf :4000
# oder produktiv: npm run start --workspace @notentabellen/server
```

> Hinweis: Liegt `packages/web/dist` nicht vor (kein `npm run build`), liefert
> der Server nur die API aus — die Startmeldung weist darauf hin.

### Variante B: Zwei Dev-Server (Hot-Reload fürs Frontend)

```bash
npm run dev --workspace @notentabellen/server   # API auf :4000
npm run dev --workspace @notentabellen/web      # UI auf :5173 (Proxy → :4000)
```

Hier ist die App unter `http://localhost:5173` erreichbar; `/api`-Aufrufe
werden per Vite-Proxy an `:4000` weitergeleitet. Bei abweichendem `PORT` den
Proxy mit `API_PORT=<port> npm run dev --workspace @notentabellen/web` starten.

### Ersten Admin anlegen & LDAP testen

Da Rollen aus der DB kommen, braucht es für den allerersten Login ein
Admin-Konto (danach alles über die Admin-UI). Login-Kennung = der `loginSub`,
den `ldap-test` ausgibt (AD-`sAMAccountName`):

```bash
# LDAP-Anmeldung prüfen (gibt loginSub + Name aus)
npm run ldap-test --workspace @notentabellen/server -- <ad-benutzer> <passwort>

# ersten Admin anlegen (idempotent; --db nur nötig, wenn DB_PFAD nicht gesetzt)
npm run seed-admin --workspace @notentabellen/server -- \
  --login <loginSub> --name "<Anzeigename>"
```

Tests/Checks über alle Pakete: `npm test`, `npm run typecheck`, `npm run build`.

## Status

In Aufbau. Fertig: M0–M6 (Rechenkern, DB/Seed, API, LDAP-Auth, Frontend,
Admin-UI). Aktueller Stand und nächste Schritte: siehe Umsetzungsplan,
„Meilensteinplan".
