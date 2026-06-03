import type { DB } from './connection.js';

/**
 * Pro Klasse deaktivierbare LF-(Rest-)Komponenten. Eine Zeile in
 * `komponente_deaktiviert` bedeutet „deaktiviert"; fehlt sie, ist die
 * Komponente für die Klasse aktiv. Da jede Komponente an ein
 * (Fach,Bildungsgang,Halbjahr)-Schema gebunden ist, wirkt das je Halbjahr.
 */

export interface KomponenteKonfig {
  halbjahr: number;
  komponenteId: number;
  schluessel: string;
  name: string;
  aktiv: boolean;
}

/**
 * Deaktivierte Komponenten einer Klasse als Menge `"<halbjahr>:<schluessel>"`
 * für ein Fach — Grundlage zum Herausfiltern in Berechnung und Eingabemaske.
 */
export function deaktivierteKomponenten(
  db: DB,
  klasseId: number,
  fachSchluessel: string,
): Set<string> {
  const rows = db
    .prepare(
      `SELECT bs.halbjahr AS halbjahr, k.schluessel AS schluessel
         FROM komponente_deaktiviert kd
         JOIN komponente k ON k.id = kd.komponente_id
         JOIN bewertungsschema bs ON bs.id = k.schema_id
         JOIN fach f ON f.id = bs.fach_id
        WHERE kd.klasse_id = ? AND f.schluessel = ?`,
    )
    .all(klasseId, fachSchluessel) as { halbjahr: number; schluessel: string }[];
  return new Set(rows.map((r) => `${r.halbjahr}:${r.schluessel}`));
}

/**
 * Schaltbare (Rest-)Komponenten eines Fachs für eine Klasse je Halbjahr mit
 * Aktiv-Status. Nur Komponenten mit `rest_anteil = 1` sind schaltbar
 * (Pädagogik/Bericht mit festem Gewicht bleiben fix).
 */
export function komponentenKonfig(
  db: DB,
  klasseId: number,
  fachSchluessel: string,
): KomponenteKonfig[] {
  const rows = db
    .prepare(
      `SELECT bs.halbjahr AS halbjahr, k.id AS komponenteId, k.schluessel AS schluessel,
              k.name AS name,
              CASE WHEN kd.komponente_id IS NULL THEN 1 ELSE 0 END AS aktiv
         FROM komponente k
         JOIN bewertungsschema bs ON bs.id = k.schema_id
         JOIN fach f ON f.id = bs.fach_id
         LEFT JOIN komponente_deaktiviert kd
           ON kd.komponente_id = k.id AND kd.klasse_id = @klasseId
        WHERE f.schluessel = @fach AND k.rest_anteil = 1 AND bs.aktiv = 1
          AND bs.bildungsgang_id = (SELECT bildungsgang_id FROM klasse WHERE id = @klasseId)
        ORDER BY bs.halbjahr, k.sortierung`,
    )
    .all({ klasseId, fach: fachSchluessel }) as Array<{
    halbjahr: number;
    komponenteId: number;
    schluessel: string;
    name: string;
    aktiv: number;
  }>;
  return rows.map((r) => ({
    halbjahr: r.halbjahr,
    komponenteId: r.komponenteId,
    schluessel: r.schluessel,
    name: r.name,
    aktiv: r.aktiv === 1,
  }));
}

/** Ist eine Komponente eine schaltbare Rest-Komponente? */
export function istRestKomponente(db: DB, komponenteId: number): boolean {
  const r = db
    .prepare('SELECT rest_anteil FROM komponente WHERE id = ?')
    .get(komponenteId) as { rest_anteil: number } | undefined;
  return r?.rest_anteil === 1;
}

export function setzeKomponenteAktiv(
  db: DB,
  klasseId: number,
  komponenteId: number,
  aktiv: boolean,
): void {
  if (aktiv) {
    db.prepare('DELETE FROM komponente_deaktiviert WHERE klasse_id = ? AND komponente_id = ?').run(
      klasseId,
      komponenteId,
    );
  } else {
    db.prepare(
      `INSERT INTO komponente_deaktiviert (klasse_id, komponente_id) VALUES (?, ?)
       ON CONFLICT(klasse_id, komponente_id) DO NOTHING`,
    ).run(klasseId, komponenteId);
  }
}
