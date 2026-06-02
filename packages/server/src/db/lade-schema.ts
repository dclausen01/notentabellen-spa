import type { Halbjahr, SchemaHalbjahr } from '@notentabellen/core';
import type { DB } from './connection.js';

interface SchemaRow {
  id: number;
  halbjahr: number;
  halbjahr_modus: 'komponenten_gewichtet' | 'direkt';
  kumulation_modus: SchemaHalbjahr['kumulationModus'];
  deaktivierbar: number;
  aktiv: number;
  mittelwert_halbjahre: string | null;
}

interface KompRow {
  schluessel: string;
  gewicht_fix: number | null;
  rest_anteil: number;
}

/**
 * Lädt das Bewertungsschema eines Fachs für einen Bildungsgang aus der DB und
 * überführt es in die Eingabestruktur des Rechenkerns (`SchemaHalbjahr[]`).
 * Damit ist die Konfiguration in der DB die einzige Quelle der Rechenregeln.
 */
export function ladeSchema(
  db: DB,
  fachSchluessel: string,
  bildungsgangSchluessel: string,
): SchemaHalbjahr[] {
  const schemaRows = db
    .prepare(
      `SELECT bs.* FROM bewertungsschema bs
         JOIN fach f ON f.id = bs.fach_id
         JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
        WHERE f.schluessel = ? AND bg.schluessel = ?
        ORDER BY bs.halbjahr`,
    )
    .all(fachSchluessel, bildungsgangSchluessel) as SchemaRow[];

  const kompStmt = db.prepare(
    'SELECT schluessel, gewicht_fix, rest_anteil FROM komponente WHERE schema_id = ? ORDER BY sortierung',
  );

  return schemaRows.map((r): SchemaHalbjahr => {
    const komponenten = (kompStmt.all(r.id) as KompRow[]).map((k) => ({
      schluessel: k.schluessel,
      ...(k.gewicht_fix !== null ? { gewichtFix: k.gewicht_fix } : {}),
      ...(k.rest_anteil ? { restAnteil: true } : {}),
    }));
    return {
      halbjahr: r.halbjahr as Halbjahr,
      aktiv: r.aktiv === 1,
      halbjahrModus: r.halbjahr_modus,
      kumulationModus: r.kumulation_modus,
      deaktivierbar: r.deaktivierbar === 1,
      komponenten,
      ...(r.mittelwert_halbjahre
        ? {
            mittelwertHalbjahre: r.mittelwert_halbjahre
              .split(',')
              .map((s) => Number(s) as Halbjahr),
          }
        : {}),
    };
  });
}
