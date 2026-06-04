import type { DB } from '../db/connection.js';
import { parseCsv } from './csv.js';
import {
  speichereDirektnote,
  speicherePruefungsnote,
  speichereImportierteEndnote,
} from '../db/noten.js';

export type NotenTyp = 'endnote' | 'direkt' | 'pruefung';

export interface NotenImportZeile {
  zeile: number;
  ok: boolean;
  schueler: string;
  fach: string;
  halbjahr: number | null;
  typ: string;
  wert: number | null;
  /** Bisher gespeicherter Wert (zur Kontrolle in der Vorschau). */
  bisher: number | null;
  grund?: string;
}

export interface NotenImportBericht {
  /** Gültige, schreibbare Zeilen. */
  geplant: number;
  fehler: number;
  proTyp: Record<NotenTyp, number>;
  /** Nicht zuordenbare Schüler:innen (eindeutige Namen). */
  schuelerFehlend: string[];
  /** true, wenn tatsächlich geschrieben wurde. */
  geschrieben: boolean;
  zeilen: NotenImportZeile[];
}

/** Liest einen Wert aus mehreren möglichen Spaltennamen. */
function feld(row: Record<string, string>, ...namen: string[]): string {
  for (const n of namen) {
    const v = row[n];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function zahl(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Importiert bereits berechnete Noten aus einem normalisierten CSV.
 * Spalten: nachname, vorname, klasse, fach, halbjahr, typ, wert.
 *   typ = 'endnote'  → übernommene Endnote (importierte_endnote, Override)
 *       = 'direkt'   → Direktnote (fachnote_direkt)
 *       = 'pruefung' → Prüfungsnote (pruefungsnote)
 *
 * `commit=false` (Default) macht einen Probelauf ohne Schreibzugriff und liefert
 * die geplanten Änderungen; `commit=true` schreibt in einer Transaktion.
 */
export function importiereNoten(
  db: DB,
  csv: string,
  opts: { akteurId?: number | null; commit?: boolean } = {},
): NotenImportBericht {
  const rows = parseCsv(csv);
  const zeilen: NotenImportZeile[] = [];
  const fehlend = new Set<string>();
  const proTyp: Record<NotenTyp, number> = { endnote: 0, direkt: 0, pruefung: 0 };

  const klasseStmt = db.prepare('SELECT id, bildungsgang_id FROM klasse WHERE bezeichnung = ?');
  const schuelerStmt = db.prepare(
    `SELECT id FROM schueler WHERE klasse_id = ? AND aktiv = 1
       AND lower(trim(name)) = lower(trim(?)) AND lower(trim(vorname)) = lower(trim(?))`,
  );
  const fachStmt = db.prepare('SELECT id FROM fach WHERE schluessel = ?');
  const schemaStmt = db.prepare(
    `SELECT halbjahr_modus, pruefung FROM bewertungsschema
      WHERE fach_id = ? AND halbjahr = ? AND bildungsgang_id = ?`,
  );
  const direktVorhanden = db.prepare(
    'SELECT wert FROM fachnote_direkt WHERE schueler_id = ? AND fach_id = ? AND halbjahr = ?',
  );
  const pruefVorhanden = db.prepare(
    'SELECT wert FROM pruefungsnote WHERE schueler_id = ? AND fach_id = ? AND halbjahr = ?',
  );
  const endnoteVorhanden = db.prepare(
    'SELECT wert FROM importierte_endnote WHERE schueler_id = ? AND fach_id = ? AND halbjahr = ?',
  );

  const schreibAktionen: Array<() => void> = [];

  rows.forEach((row, idx) => {
    const zeileNr = idx + 2;
    const nachname = feld(row, 'nachname', 'name');
    const vorname = feld(row, 'vorname');
    const klasse = feld(row, 'klasse');
    const fach = feld(row, 'fach').toUpperCase();
    const halbjahrStr = feld(row, 'halbjahr', 'hj');
    const typ = feld(row, 'typ').toLowerCase() as NotenTyp;
    const wertStr = feld(row, 'wert', 'note');

    const fail = (grund: string, halbjahr: number | null = null, wert: number | null = null) =>
      zeilen.push({ zeile: zeileNr, ok: false, schueler: `${nachname}, ${vorname}`, fach, halbjahr, typ, wert, bisher: null, grund });

    if (!nachname || !vorname || !klasse || !fach || !halbjahrStr || !typ || !wertStr) {
      return fail('Pflichtfeld fehlt (nachname, vorname, klasse, fach, halbjahr, typ, wert)');
    }
    if (typ !== 'endnote' && typ !== 'direkt' && typ !== 'pruefung') {
      return fail(`Unbekannter Typ "${typ}" (erlaubt: endnote, direkt, pruefung)`);
    }
    const halbjahr = Number(halbjahrStr);
    if (![1, 2, 3, 4].includes(halbjahr)) return fail('Halbjahr muss 1–4 sein');
    const wert = zahl(wertStr);
    if (wert === null || wert < 0 || wert > 15) return fail('Wert muss eine Zahl 0–15 sein', halbjahr);

    const k = klasseStmt.get(klasse) as { id: number; bildungsgang_id: number } | undefined;
    if (!k) return fail(`Klasse "${klasse}" nicht gefunden`, halbjahr, wert);
    const s = schuelerStmt.get(k.id, nachname, vorname) as { id: number } | undefined;
    if (!s) {
      fehlend.add(`${nachname}, ${vorname} (${klasse})`);
      return fail('Schüler:in in dieser Klasse nicht gefunden', halbjahr, wert);
    }
    const f = fachStmt.get(fach) as { id: number } | undefined;
    if (!f) return fail(`Fach "${fach}" unbekannt`, halbjahr, wert);
    const schema = schemaStmt.get(f.id, halbjahr, k.bildungsgang_id) as
      | { halbjahr_modus: string; pruefung: number }
      | undefined;
    if (!schema) return fail(`Fach ${fach} hat im ${halbjahr}. Hj. kein Schema für diesen Bildungsgang`, halbjahr, wert);

    // Typ-spezifische Validierung + Zielbestimmung
    let bisher: number | null = null;
    if (typ === 'direkt') {
      if (schema.halbjahr_modus !== 'direkt') {
        return fail(`Fach ${fach} ist im ${halbjahr}. Hj. komponentenbasiert — Direktnote nicht möglich (nutze typ=endnote)`, halbjahr, wert);
      }
      bisher = (direktVorhanden.get(s.id, f.id, halbjahr) as { wert: number } | undefined)?.wert ?? null;
      schreibAktionen.push(() =>
        speichereDirektnote(db, { schuelerId: s.id, fachId: f.id, halbjahr, wert, istNa: false, geaendertVon: opts.akteurId ?? null }),
      );
    } else if (typ === 'pruefung') {
      if (schema.pruefung !== 1) return fail(`Fach ${fach} hat im ${halbjahr}. Hj. keine Prüfung`, halbjahr, wert);
      bisher = (pruefVorhanden.get(s.id, f.id, halbjahr) as { wert: number } | undefined)?.wert ?? null;
      schreibAktionen.push(() =>
        speicherePruefungsnote(db, { schuelerId: s.id, fachId: f.id, halbjahr, wert, istNa: false, geaendertVon: opts.akteurId ?? null }),
      );
    } else {
      // endnote (Override)
      bisher = (endnoteVorhanden.get(s.id, f.id, halbjahr) as { wert: number } | undefined)?.wert ?? null;
      schreibAktionen.push(() =>
        speichereImportierteEndnote(db, { schuelerId: s.id, fachId: f.id, halbjahr, wert, geaendertVon: opts.akteurId ?? null }),
      );
    }

    proTyp[typ]++;
    zeilen.push({ zeile: zeileNr, ok: true, schueler: `${nachname}, ${vorname}`, fach, halbjahr, typ, wert, bisher });
  });

  const geplant = zeilen.filter((z) => z.ok).length;
  let geschrieben = false;
  if (opts.commit && geplant > 0) {
    db.transaction(() => {
      for (const a of schreibAktionen) a();
    })();
    geschrieben = true;
  }

  return {
    geplant,
    fehler: zeilen.length - geplant,
    proTyp,
    schuelerFehlend: [...fehlend].sort(),
    geschrieben,
    zeilen,
  };
}
