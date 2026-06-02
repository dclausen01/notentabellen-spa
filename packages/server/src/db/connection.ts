import Database from 'better-sqlite3';

export type DB = Database.Database;

/**
 * Öffnet eine SQLite-Datenbank mit sinnvollen Defaults:
 * - Fremdschlüssel-Prüfung an (in SQLite per Default aus!)
 * - WAL-Modus für robustes, gleichzeitiges Lesen/Schreiben.
 *
 * `:memory:` für Tests.
 */
export function openDb(pfad: string): DB {
  const db = new Database(pfad);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
