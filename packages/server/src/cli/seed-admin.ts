import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { upsertLehrkraft } from '../db/admin.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import type { Rolle } from '../db/stammdaten.js';
import { ladeEnvDatei } from '../env.js';

/**
 * CLI: legt eine Lehrkraft (standardmäßig mit Rolle 'admin') an bzw.
 * aktualisiert sie. Löst das Henne-Ei-Problem beim ersten Zugang — danach
 * können alle weiteren Konten über die Admin-UI gepflegt werden.
 *
 * Aufruf:
 *   npm run seed-admin -- --login <loginSub> --name "<Anzeigename>" \
 *     [--rolle admin|klassenleitung|fach] [--db <pfad zur sqlite>]
 *
 * Der loginSub muss exakt dem entsprechen, was `ldap-test` als loginSub
 * ausgibt (AD-sAMAccountName, Groß/Klein beachten).
 */
ladeEnvDatei();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const login = arg('login');
const name = arg('name');
const rolle = (arg('rolle') ?? 'admin') as Rolle;
const dbPfad = arg('db') ?? process.env['DB_PFAD'] ?? 'notentabellen.sqlite';

const ROLLEN: Rolle[] = ['fach', 'klassenleitung', 'admin'];

if (!login || !name) {
  console.error(
    'Aufruf: npm run seed-admin -- --login <loginSub> --name "<Anzeigename>" [--rolle admin|klassenleitung|fach] [--db <pfad>]',
  );
  process.exit(2);
}
if (!ROLLEN.includes(rolle)) {
  console.error(`Ungültige Rolle "${rolle}" (erlaubt: ${ROLLEN.join(', ')}).`);
  process.exit(2);
}

if (dbPfad !== ':memory:') mkdirSync(dirname(dbPfad), { recursive: true });
const db = openDb(dbPfad);
migrate(db);
const lk = upsertLehrkraft(db, login, name, rolle);
db.close();

console.log('Lehrkraft gespeichert:', lk);
console.log(`\nAnmeldung jetzt mit der AD-Kennung "${login}" möglich (Rolle: ${rolle}).`);
