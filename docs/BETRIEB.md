# Betrieb, Deployment & Backup

Praxisleitfaden für den Betrieb der Notenverwaltung auf einem Plesk-Server
(Phusion Passenger) mit automatischem Git-Deployment. Fasst die in der
Inbetriebnahme gesammelten Erkenntnisse zusammen.

---

## 1. Voraussetzungen

- **Node.js 20** (LTS). Nicht 21 — `better-sqlite3` v12 unterstützt nur
  20/22/24/26. Node 20 wird sowohl für die Plesk-Node.js-App als auch für die
  Deployment-Befehle benötigt.
- Plesk mit Node.js-Extension (Passenger) und Git-Integration.
- Der Server muss den AD/LDAP-Host erreichen dürfen (Firewallfreigabe der
  Server-IP).

## 2. Plesk-Node.js-App

| Einstellung | Wert |
| --- | --- |
| Node.js-Version | **20.x** |
| Anwendungsstamm | Repo-Wurzel (z. B. `…/noten-spa.bbz-rd-eck.com`) |
| Anwendungsstartdatei | `packages/server/dist/server.js` |
| Anwendungsmodus | `production` |

### Deployment-Befehle (Git → „Zusätzliche Bereitstellungsaktionen")

```bash
export PATH=/opt/plesk/node/20/bin:$PATH && npm ci --include=dev && npm run build
```

- `export PATH=…` ist entscheidend: Ohne ihn laufen Kindprozesse (z. B.
  `better-sqlite3`-Buildskripte) über das System-Node (oft v12) und scheitern.
- `--include=dev` erzwingt die Build-Werkzeuge (vite/tsc), die im
  `production`-Modus sonst weggelassen würden.
- `npm run build` erzeugt `packages/server/dist` **und** `packages/web/dist`
  (das Frontend wird vom Server mitausgeliefert — alles auf einem Port).

Nach erfolgreichem Deploy in Plesk **„App neu starten"**.

## 3. Konfiguration (Umgebungsvariablen)

Im Produktivbetrieb über **Plesk → Node.js → „Benutzerdefinierte
Umgebungsvariablen"** (nicht als `.env` im Git-Verzeichnis). Lokal: `.env` aus
`packages/server/.env.example` ableiten.

| Variable | Bedeutung |
| --- | --- |
| `JWT_SECRET` | langer Zufallswert (`openssl rand -hex 32`); signiert die Sessions |
| `DB_PFAD` | **absoluter** Pfad zur SQLite-Datei (s. u.) |
| `PORT` | bei Passenger weglassen (Passenger setzt den Port selbst); bei PM2/systemd setzen |
| `LDAP_URL` | z. B. `ldaps://ldap.bbz-rd-eck.de:636` |
| `LDAP_BASE_DN` | z. B. `DC=SNRD,DC=local` |
| `LDAP_BIND_USER_TEMPLATE` | **Direkt-Bind** (empfohlen): `SNRD\{{username}}` oder `{{username}}@snrd.local` |
| `LDAP_BIND_DN` / `LDAP_BIND_PW` | nur Service-Account-Modus (entfällt bei Direkt-Bind) |
| `LDAP_USER_FILTER` | Default `(sAMAccountName={{username}})` |
| `LDAP_LOGIN_ATTR` / `LDAP_NAME_ATTR` | Default `sAMAccountName` / `displayName` |
| `LDAP_TLS_CA_PFAD` | PEM der internen CA (empfohlen bei LDAPS) |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | `false` schaltet die Zertifikatsprüfung ab (nur Notlösung) |

### Datenbank-Pfad

`DB_PFAD` auf einen **absoluten Pfad außerhalb des Git-Verzeichnisses** legen,
z. B. `…/noten-spa.bbz-rd-eck.com/notentabellen-data/notentabellen.sqlite`.
Das Verzeichnis wird beim Start automatisch angelegt; es muss für den
App-Benutzer schreibbar sein. SQLite läuft im WAL-Modus und erzeugt zusätzlich
`…-wal` und `…-shm`.

## 4. Authentifizierung (LDAP/AD)

- **Direkt-Bind** (empfohlen): Jede Lehrkraft meldet sich mit eigener
  AD-Kennung + Passwort an (`LDAP_BIND_USER_TEMPLATE`). Kein Service-Account
  nötig.
- **Service-Account-Modus**: `LDAP_BIND_DN`/`LDAP_BIND_PW` eines Lesekontos;
  die App sucht damit den Nutzer und bindet anschließend erneut mit dessen
  Passwort.
- **Rollen** kommen aus der DB (`lehrkraft.rolle`), nicht aus AD-Gruppen.

### Diagnose: `ldap-test`

```bash
npm run ldap-test --workspace @notentabellen/server -- <benutzer> <passwort>
```
Testet den LDAP-Login direkt (ohne Webserver) und gibt Konfiguration sowie den
vollständigen Fehler aus. Typische AD-Codes:
- `data 52e` → ungültige Anmeldedaten (Passwort/Bind-Konto falsch).
- TLS-Fehler (`SELF_SIGNED_CERT…`) → interne CA via `LDAP_TLS_CA_PFAD` hinterlegen.

## 5. Erster Admin-Zugang

Da Rollen aus der DB kommen, muss der erste Admin einmalig per CLI angelegt
werden (danach alles über die Admin-UI):

```bash
node packages/server/dist/cli/seed-admin.js \
  --login <loginSub> --name "<Anzeigename>" \
  --db <DB_PFAD>
```
`loginSub` = exakt der Wert, den `ldap-test` ausgibt (AD-`sAMAccountName`,
Groß-/Kleinschreibung beachten). Der Aufruf ist idempotent.

## 6. Backup & Wiederherstellung

Das gesamte System steckt in **einer SQLite-Datei** (`DB_PFAD`).

**Sichern** (konsistent trotz laufendem Betrieb, dank WAL):
```bash
sqlite3 /pfad/notentabellen.sqlite ".backup '/backup/notentabellen-$(date +%F).sqlite'"
```
Alternativ bei gestopptem Dienst einfach die drei Dateien
(`*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`) kopieren. Empfehlung: täglicher
Cron-Job + verschlüsselte Ablage; Aufbewahrung mit Datenschutz abstimmen.

**Wiederherstellen**: App stoppen, Backup-Datei nach `DB_PFAD` kopieren,
App starten. Migration/Seed laufen beim Start idempotent.

## 7. Update / Rollback

- **Update**: Push nach `main` → Plesk-Auto-Deploy (oder „Jetzt pull
  ausführen") → „App neu starten". DB-Migrationen laufen automatisch und
  idempotent beim Start.
- **Rollback**: in Plesk auf einen früheren Commit zurücksetzen und neu
  deployen. Achtung: DB-Migrationen sind nicht automatisch rückwärtskompatibel
  — vor riskanten Updates ein Backup ziehen (Abschnitt 6).

## 8. HTTPS

Plesk terminiert HTTPS (Let's Encrypt) und leitet per Reverse-Proxy an die
Node-App weiter. Für die Subdomain ein Zertifikat ausstellen und
HTTP→HTTPS-Weiterleitung aktivieren.

## 9. Fehlersuche (Kurzreferenz)

| Symptom | Ursache / Lösung |
| --- | --- |
| `ERR_MODULE_NOT_FOUND` nach Pull | `npm ci` lief nicht / Abhängigkeit neu → Deployment-Befehle prüfen |
| Build bricht mit `??`-SyntaxError / `target=12…` ab | falsches Node (v12) → `export PATH=/opt/plesk/node/20/bin` |
| Plesk-Default-Seite | Build/Start fehlgeschlagen oder Platzhalter-`index.html` im Docroot |
| Passenger „something went wrong" | App crasht beim Start → Log prüfen; häufig `DB_PFAD` (Verzeichnis/Rechte) |
| Login „Anmeldedienst nicht erreichbar" (500) | LDAP-Fehler → mit `ldap-test` diagnostizieren |
| Login „Kein Benutzerkonto hinterlegt" (403) | LDAP ok, aber keine `lehrkraft`-Zeile → `seed-admin` |
