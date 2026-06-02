import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { seed } from '../seed/seed.js';

/**
 * CLI: Datenbank anlegen/migrieren und Konfiguration einspielen.
 * Aufruf: `npm run db:init -- [pfad]` (Default: ./notentabellen.sqlite).
 */
const pfad = process.argv[2] ?? 'notentabellen.sqlite';
const db = openDb(pfad);
const neu = migrate(db);
seed(db);
const schemaCount = (
  db.prepare('SELECT COUNT(*) AS n FROM bewertungsschema').get() as { n: number }
).n;
db.close();

console.log(`DB '${pfad}' bereit.`);
console.log(`  Migrationen neu angewandt: ${neu.length ? neu.join(', ') : '(keine)'}`);
console.log(`  Bewertungsschemata: ${schemaCount}`);
