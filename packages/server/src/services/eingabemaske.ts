import type { DB } from '../db/connection.js';

export interface MaskeKomponente {
  id: number;
  schluessel: string;
  name: string;
}
export interface MaskeWert {
  wert: number | null;
  istNa: boolean;
}
export interface MaskeZeile {
  schuelerId: number;
  name: string;
  vorname: string;
  /** Bei gewichtetem Modus: je Komponentenschlüssel ein Wert. */
  komponenten: Record<string, MaskeWert>;
  /** Bei direktem Modus: der einzelne Wert. */
  direkt: MaskeWert | null;
  /** Nur bei WPK: belegter Kurs (id) oder null. */
  wpkKursId?: number | null;
  /** Nur wenn das Schema eine Prüfung vorsieht (4. Hj.): Prüfungsnote. */
  pruefung?: MaskeWert;
}
export interface WpkKursOption {
  id: number;
  name: string;
}
export interface Eingabemaske {
  klasseId: number;
  fach: string;
  halbjahr: number;
  modus: 'komponenten_gewichtet' | 'direkt';
  aktiv: boolean;
  deaktivierbar: boolean;
  komponenten: MaskeKomponente[];
  zeilen: MaskeZeile[];
  /** Nur bei WPK gesetzt: wählbare Kurse für die Kurs-Spalte. */
  wpkKurse?: WpkKursOption[];
  /** true, wenn in diesem Halbjahr eine Prüfungsnote erfasst wird (4. Hj.). */
  pruefung?: boolean;
}

/**
 * Baut die Eingabemaske für eine Klasse × Fach × Halbjahr: Spaltenkomponenten
 * (bei gewichteten Fächern) und je Schüler:in die aktuell gespeicherten Werte.
 */
export function baueEingabemaske(
  db: DB,
  klasseId: number,
  fachSchluessel: string,
  halbjahr: number,
): Eingabemaske {
  const schema = db
    .prepare(
      `SELECT bs.id, bs.halbjahr_modus, bs.aktiv, bs.deaktivierbar, bs.fach_id, bs.pruefung
         FROM bewertungsschema bs
         JOIN fach f ON f.id = bs.fach_id
        WHERE f.schluessel = ? AND bs.halbjahr = ?
          AND bs.bildungsgang_id = (SELECT bildungsgang_id FROM klasse WHERE id = ?)`,
    )
    .get(fachSchluessel, halbjahr, klasseId) as
    | {
        id: number;
        halbjahr_modus: 'komponenten_gewichtet' | 'direkt';
        aktiv: number;
        deaktivierbar: number;
        fach_id: number;
        pruefung: number;
      }
    | undefined;

  if (!schema) {
    throw new Error(
      `Kein Schema für Fach ${fachSchluessel}, Halbjahr ${halbjahr} in dieser Klasse`,
    );
  }

  // Pro Klasse deaktivierte Komponenten ausblenden (LF3-Rest-Komponenten).
  const komponenten = (
    db
      .prepare(
        `SELECT k.id, k.schluessel, k.name FROM komponente k
          WHERE k.schema_id = ?
            AND k.id NOT IN (SELECT komponente_id FROM komponente_deaktiviert WHERE klasse_id = ?)
          ORDER BY k.sortierung`,
      )
      .all(schema.id, klasseId)
  ) as MaskeKomponente[];

  const schueler = db
    .prepare(
      'SELECT id, name, vorname FROM schueler WHERE klasse_id = ? AND aktiv = 1 ORDER BY name, vorname',
    )
    .all(klasseId) as { id: number; name: string; vorname: string }[];

  const kompNoteStmt = db.prepare(
    'SELECT wert, ist_na FROM komponentennote WHERE schueler_id = ? AND komponente_id = ? AND halbjahr = ?',
  );
  const direktNoteStmt = db.prepare(
    'SELECT wert, ist_na FROM fachnote_direkt WHERE schueler_id = ? AND fach_id = ? AND halbjahr = ?',
  );

  // WPK: zusätzlich der belegte Kurs pro Schüler:in.
  const istWpk = fachSchluessel === 'WPK';
  const wpkKurse = istWpk
    ? (db
        .prepare('SELECT id, name FROM wpk_kurs WHERE aktiv = 1 ORDER BY name')
        .all() as { id: number; name: string }[])
    : [];
  const wpkKursStmt = db.prepare(
    'SELECT wpk_kurs_id FROM wpk_eingabe WHERE schueler_id = ? AND halbjahr = ?',
  );

  // Prüfungsnote (4. Hj. für LF2/LF3/Deutsch/Englisch/Mathe).
  const hatPruefung = schema.pruefung === 1;
  const pruefStmt = db.prepare(
    'SELECT wert, ist_na FROM pruefungsnote WHERE schueler_id = ? AND fach_id = ? AND halbjahr = ?',
  );

  const zeilen: MaskeZeile[] = schueler.map((s) => {
    const komponentenWerte: Record<string, MaskeWert> = {};
    let direkt: MaskeWert | null = null;

    if (schema.halbjahr_modus === 'komponenten_gewichtet') {
      for (const k of komponenten) {
        const row = kompNoteStmt.get(s.id, k.id, halbjahr) as
          | { wert: number | null; ist_na: number }
          | undefined;
        komponentenWerte[k.schluessel] = {
          wert: row?.ist_na ? null : (row?.wert ?? null),
          istNa: row?.ist_na === 1,
        };
      }
    } else {
      const row = direktNoteStmt.get(s.id, schema.fach_id, halbjahr) as
        | { wert: number | null; ist_na: number }
        | undefined;
      direkt = {
        wert: row?.ist_na ? null : (row?.wert ?? null),
        istNa: row?.ist_na === 1,
      };
    }

    const zeile: MaskeZeile = {
      schuelerId: s.id,
      name: s.name,
      vorname: s.vorname,
      komponenten: komponentenWerte,
      direkt,
    };
    if (istWpk) {
      const row = wpkKursStmt.get(s.id, halbjahr) as { wpk_kurs_id: number } | undefined;
      zeile.wpkKursId = row?.wpk_kurs_id ?? null;
    }
    if (hatPruefung) {
      const row = pruefStmt.get(s.id, schema.fach_id, halbjahr) as
        | { wert: number | null; ist_na: number }
        | undefined;
      zeile.pruefung = {
        wert: row?.ist_na ? null : (row?.wert ?? null),
        istNa: row?.ist_na === 1,
      };
    }
    return zeile;
  });

  return {
    klasseId,
    fach: fachSchluessel,
    halbjahr,
    modus: schema.halbjahr_modus,
    aktiv: schema.aktiv === 1,
    deaktivierbar: schema.deaktivierbar === 1,
    komponenten,
    zeilen,
    ...(istWpk ? { wpkKurse } : {}),
    ...(hatPruefung ? { pruefung: true } : {}),
  };
}
