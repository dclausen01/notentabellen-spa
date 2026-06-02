import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './connection.js';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

/**
 * Wendet alle noch nicht eingespielten `.sql`-Migrationen in alphabetischer
 * Reihenfolge an. Jede Migration läuft in einer Transaktion; bereits
 * angewandte Versionen werden in `schema_migrations` festgehalten.
 */
export function migrate(db: DB, verzeichnis: string = migrationsDir): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );

  const angewandt = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: string }).version),
  );

  const dateien = readdirSync(verzeichnis)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const neu: string[] = [];
  const markieren = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const datei of dateien) {
    if (angewandt.has(datei)) continue;
    const sql = readFileSync(join(verzeichnis, datei), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      markieren.run(datei, new Date().toISOString());
    });
    tx();
    neu.push(datei);
  }
  return neu;
}
