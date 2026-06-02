import { baueApp } from './api/app.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seed } from './seed/seed.js';

/** Server-Einstieg: DB öffnen, migrieren, seeden und HTTP-API starten. */
const pfad = process.env['DB_PFAD'] ?? 'notentabellen.sqlite';
const port = Number(process.env['PORT'] ?? 3000);

const db = openDb(pfad);
migrate(db);
seed(db);

const app = baueApp(db);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`API läuft auf ${addr} (DB: ${pfad})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
