import type { DB } from '../db/connection.js';
import type { Identitaet } from '../auth/zugriff.js';

export interface FachOption {
  schluessel: string;
  name: string;
  typ: 'LF' | 'FACH';
  /** Halbjahre, in denen das Fach (für die Identität) bearbeitbar/sichtbar ist. */
  halbjahre: number[];
}

/**
 * Fächer einer Klasse mit ihren aktiven Halbjahren — rollenabhängig gefiltert:
 * - admin / Klassenleitung der Klasse: alle aktiven Fächer des Bildungsgangs
 * - Fachlehrkraft: nur Fächer/Halbjahre mit passendem Lehrauftrag
 *
 * Liefert eine UX-freundliche Auswahl, statt unerlaubte Optionen anzubieten.
 */
export function faecherFuerKlasse(
  db: DB,
  klasseId: number,
  ident: Identitaet,
  istKl: boolean,
): FachOption[] {
  const rows = db
    .prepare(
      `SELECT f.schluessel, f.name, f.typ, bs.halbjahr
         FROM bewertungsschema bs
         JOIN fach f ON f.id = bs.fach_id
        WHERE bs.aktiv = 1
          AND bs.bildungsgang_id = (SELECT bildungsgang_id FROM klasse WHERE id = ?)
        ORDER BY f.id, bs.halbjahr`,
    )
    .all(klasseId) as { schluessel: string; name: string; typ: 'LF' | 'FACH'; halbjahr: number }[];

  const vollzugriff = ident.rolle === 'admin' || istKl;

  // Bei Fachlehrkraft: erlaubte (Fach, Halbjahr)-Paare aus den Lehraufträgen.
  const erlaubt = new Set<string>();
  if (!vollzugriff) {
    const auftraege = db
      .prepare(
        `SELECT f.schluessel, la.halbjahr FROM lehrauftrag la
           JOIN fach f ON f.id = la.fach_id
          WHERE la.lehrkraft_id = ? AND la.klasse_id = ?`,
      )
      .all(ident.lehrkraftId, klasseId) as { schluessel: string; halbjahr: number }[];
    for (const a of auftraege) erlaubt.add(`${a.schluessel}:${a.halbjahr}`);
  }

  const map = new Map<string, FachOption>();
  for (const r of rows) {
    if (!vollzugriff && !erlaubt.has(`${r.schluessel}:${r.halbjahr}`)) continue;
    let opt = map.get(r.schluessel);
    if (!opt) {
      opt = { schluessel: r.schluessel, name: r.name, typ: r.typ, halbjahre: [] };
      map.set(r.schluessel, opt);
    }
    opt.halbjahre.push(r.halbjahr);
  }
  return [...map.values()];
}
