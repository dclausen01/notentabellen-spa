import { baueApp } from './api/app.js';
import { LdapAuthenticator, ldapConfigAusEnv } from './auth/ldap.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seed } from './seed/seed.js';

/** Server-Einstieg: DB öffnen, migrieren, seeden und HTTP-API mit LDAP-Auth starten. */
const pfad = process.env['DB_PFAD'] ?? 'notentabellen.sqlite';
const port = Number(process.env['PORT'] ?? 3000);

const jwtSecret = process.env['JWT_SECRET'];
if (!jwtSecret) {
  console.error('JWT_SECRET fehlt (Umgebungsvariable). Server startet nicht.');
  process.exit(1);
}

const db = openDb(pfad);
migrate(db);
seed(db);

const authenticator = new LdapAuthenticator(ldapConfigAusEnv());
const app = baueApp({ db, authenticator, jwtSecret });

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`API läuft auf ${addr} (DB: ${pfad})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
