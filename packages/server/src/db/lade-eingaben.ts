import type { EingabeHalbjahr, Halbjahr, SchemaHalbjahr } from '@notentabellen/core';
import type { DB } from './connection.js';

/** Bildungsgang-Schlüssel der Klasse eines Schülers. */
export function bildungsgangVonSchueler(db: DB, schuelerId: number): string {
  const row = db
    .prepare(
      `SELECT bg.schluessel FROM schueler s
         JOIN klasse k ON k.id = s.klasse_id
         JOIN bildungsgang bg ON bg.id = k.bildungsgang_id
        WHERE s.id = ?`,
    )
    .get(schuelerId) as { schluessel: string } | undefined;
  if (!row) throw new Error(`Schüler ${schuelerId} nicht gefunden`);
  return row.schluessel;
}

export function fachId(db: DB, fachSchluessel: string): number {
  const row = db
    .prepare('SELECT id FROM fach WHERE schluessel = ?')
    .get(fachSchluessel) as { id: number } | undefined;
  if (!row) throw new Error(`Fach ${fachSchluessel} unbekannt`);
  return row.id;
}

interface KompNoteRow {
  schluessel: string;
  wert: number | null;
  ist_na: number;
}
interface DirektNoteRow {
  wert: number | null;
  ist_na: number;
}

/**
 * Lädt die Eingaben eines Schülers für ein Fach über alle Halbjahre und
 * überführt sie in die Eingabestruktur des Rechenkerns. Nutzt das übergebene
 * Schema (aus `ladeSchema`), um pro Halbjahr den richtigen Eingabetyp
 * (gewichtete Komponenten vs. Direktwert) zu wählen.
 */
export function ladeEingaben(
  db: DB,
  schuelerId: number,
  fId: number,
  schema: SchemaHalbjahr[],
): EingabeHalbjahr[] {
  const kompStmt = db.prepare(
    `SELECT k.schluessel, kn.wert, kn.ist_na
       FROM komponente k
       JOIN bewertungsschema bs ON bs.id = k.schema_id
       LEFT JOIN komponentennote kn
         ON kn.komponente_id = k.id AND kn.schueler_id = @schuelerId AND kn.halbjahr = @halbjahr
      WHERE bs.fach_id = @fachId AND bs.halbjahr = @halbjahr
        AND bs.bildungsgang_id = (SELECT k2.bildungsgang_id FROM schueler s
                                    JOIN klasse k2 ON k2.id = s.klasse_id WHERE s.id = @schuelerId)`,
  );
  const direktStmt = db.prepare(
    `SELECT wert, ist_na FROM fachnote_direkt
      WHERE schueler_id = @schuelerId AND fach_id = @fachId AND halbjahr = @halbjahr`,
  );

  const eingaben: EingabeHalbjahr[] = [];
  for (const s of schema) {
    if (!s.aktiv) continue;
    const hj = s.halbjahr as Halbjahr;

    if (s.halbjahrModus === 'komponenten_gewichtet') {
      const rows = kompStmt.all({ schuelerId, fachId: fId, halbjahr: hj }) as KompNoteRow[];
      const komponenten: Record<string, number | null> = {};
      for (const r of rows) {
        komponenten[r.schluessel] = r.ist_na ? null : r.wert;
      }
      eingaben.push({ halbjahr: hj, istNa: false, komponenten });
    } else {
      const row = direktStmt.get({ schuelerId, fachId: fId, halbjahr: hj }) as
        | DirektNoteRow
        | undefined;
      eingaben.push({
        halbjahr: hj,
        istNa: row?.ist_na === 1,
        direktwert: row && !row.ist_na ? row.wert : null,
      });
    }
  }
  return eingaben;
}
