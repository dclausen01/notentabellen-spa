import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baueApp } from './api/app.js';
import { LdapAuthenticator, ldapConfigAusEnv } from './auth/ldap.js';
import { openDb } from './db/connection.js';
import { ladeEnvDatei } from './env.js';
import { migrate } from './db/migrate.js';
import { seed } from './seed/seed.js';

ladeEnvDatei();

/** Server-Einstieg: DB öffnen, migrieren, seeden und HTTP-API mit LDAP-Auth starten. */
const pfad = process.env['DB_PFAD'] ?? 'notentabellen.sqlite';
const port = Number(process.env['PORT'] ?? 4000);

/**
 * Startfehler laut machen: in stderr UND in eine Datei neben der DB schreiben.
 * Passenger verschluckt stdout/stderr je nach Konfiguration — die Datei ist
 * verlässlich auffindbar (gleiches, schreibbares Verzeichnis wie die DB).
 */
function startFehler(kontext: string, err: unknown): never {
  const text = `[${new Date().toISOString()}] ${kontext}\n${(err as Error)?.stack ?? String(err)}\n`;
  console.error(kontext, err);
  try {
    if (pfad !== ':memory:') writeFileSync(join(dirname(pfad), 'startup-error.log'), text);
  } catch {
    /* Datei-Logging ist best effort */
  }
  process.exit(1);
}

const jwtSecret = process.env['JWT_SECRET'];
if (!jwtSecret) {
  startFehler('JWT_SECRET fehlt (Umgebungsvariable). Server startet nicht.', new Error('JWT_SECRET fehlt'));
}

// Verzeichnis der SQLite-Datei sicherstellen — SQLite legt die Datei selbst an,
// aber nicht den Ordner darüber.
if (pfad !== ':memory:') {
  try {
    mkdirSync(dirname(pfad), { recursive: true });
  } catch (err) {
    startFehler(`Datenbankverzeichnis ${dirname(pfad)} konnte nicht angelegt werden`, err);
  }
}

let db;
try {
  db = openDb(pfad);
  migrate(db);
  seed(db);
} catch (err) {
  startFehler('Fehler bei Datenbank-Initialisierung (Migration/Seed)', err);
}

// Gebautes Frontend (packages/web/dist) mitausliefern, falls vorhanden.
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
const webVorhanden = existsSync(webRoot);

let app;
try {
  const authenticator = new LdapAuthenticator(ldapConfigAusEnv());
  app = baueApp({ db, authenticator, jwtSecret, ...(webVorhanden ? { webRoot } : {}) });
} catch (err) {
  startFehler('Fehler beim Aufbau der App (LDAP-Konfiguration?)', err);
}

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) =>
    console.log(
      `API läuft auf ${addr} (DB: ${pfad})` +
        (webVorhanden ? ` — Frontend wird mitausgeliefert, App im Browser unter ${addr}` : ' — Frontend nicht gebaut (npm run build)'),
    ),
  )
  .catch((err) => startFehler('Fehler beim Binden des Ports', err));
