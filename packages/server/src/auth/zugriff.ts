import type { DB } from '../db/connection.js';
import type { Rolle } from '../db/stammdaten.js';

export interface Identitaet {
  lehrkraftId: number;
  rolle: Rolle;
  name: string;
}

/** Findet die Lehrkraft zur SSO-Kennung (loginSub). Undefined = nicht provisioniert. */
export function lehrkraftVonLoginSub(db: DB, loginSub: string): Identitaet | undefined {
  const row = db
    .prepare('SELECT id, name, rolle FROM lehrkraft WHERE login_sub = ?')
    .get(loginSub) as { id: number; name: string; rolle: Rolle } | undefined;
  return row ? { lehrkraftId: row.id, rolle: row.rolle, name: row.name } : undefined;
}

/** Hat die Lehrkraft einen Lehrauftrag für (Fach × Klasse × Halbjahr)? */
export function hatLehrauftrag(
  db: DB,
  lehrkraftId: number,
  fachSchluessel: string,
  klasseId: number,
  halbjahr: number,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM lehrauftrag la
         JOIN fach f ON f.id = la.fach_id
        WHERE la.lehrkraft_id = ? AND f.schluessel = ? AND la.klasse_id = ? AND la.halbjahr = ?`,
    )
    .get(lehrkraftId, fachSchluessel, klasseId, halbjahr);
  return row !== undefined;
}

/** Ist die Lehrkraft Klassenleitung der Klasse? */
export function istKlassenleitung(db: DB, lehrkraftId: number, klasseId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM klassenleitung WHERE lehrkraft_id = ? AND klasse_id = ?')
    .get(lehrkraftId, klasseId);
  return row !== undefined;
}

/**
 * Klassen-IDs, die eine Identität sehen darf:
 * - admin: alle
 * - klassenleitung: eigene Klassen + Klassen mit Lehrauftrag
 * - fach: Klassen mit Lehrauftrag
 */
export function sichtbareKlassenIds(db: DB, id: Identitaet): number[] | 'alle' {
  if (id.rolle === 'admin') return 'alle';
  const rows = db
    .prepare(
      `SELECT klasse_id FROM lehrauftrag WHERE lehrkraft_id = @id
       UNION
       SELECT klasse_id FROM klassenleitung WHERE lehrkraft_id = @id`,
    )
    .all({ id: id.lehrkraftId }) as { klasse_id: number }[];
  return rows.map((r) => r.klasse_id);
}

/** Schüler-ID → Klassen-ID (für Berechtigungsprüfungen auf Schülerebene). */
export function klasseVonSchueler(db: DB, schuelerId: number): number | undefined {
  const row = db.prepare('SELECT klasse_id FROM schueler WHERE id = ?').get(schuelerId) as
    | { klasse_id: number }
    | undefined;
  return row?.klasse_id;
}
