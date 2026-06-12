import type { DB } from '../db/connection.js';
import { parseCsv, feld, zahl } from './csv.js';
import {
  speichereDirektnote,
  speicherePruefungsnote,
  speichereImportierteEndnote,
} from '../db/noten.js';
import { erstelleWpkKurs, listeWpkKurse, speichereWpkKurs } from '../db/admin.js';

export type NotenTyp = 'endnote' | 'direkt' | 'pruefung' | 'wpk_kurs';

/** Eine abgelehnte Zeile (nur Fehler werden zurückgegeben — gültige Werte nur als Zähler). */
export interface NotenImportZeile {
  zeile: number;
  ok: boolean;
  schueler: string;
  fach: string;
  halbjahr: number | null;
  typ: string;
  wert: number | null;
  grund?: string;
}

export interface NotenImportBericht {
  /** Anzahl gültiger, schreibbarer Werte. */
  geplant: number;
  fehler: number;
  proTyp: Record<NotenTyp, number>;
  /** Nicht zuordenbare Schüler:innen (eindeutige Namen). */
  schuelerFehlend: string[];
  /** true, wenn tatsächlich geschrieben wurde. */
  geschrieben: boolean;
  zeilen: NotenImportZeile[];
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
  const proTyp: Record<NotenTyp, number> = { endnote: 0, direkt: 0, pruefung: 0, wpk_kurs: 0 };

  // WPK-Kurse (Name → id), case-insensitiv; fehlende werden beim Commit angelegt.
  const wpkKursMap = new Map<string, number>();
  for (const kurs of listeWpkKurse(db)) wpkKursMap.set(kurs.name.trim().toLowerCase(), kurs.id);

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
      zeilen.push({ zeile: zeileNr, ok: false, schueler: `${nachname}, ${vorname}`, fach, halbjahr, typ, wert, grund });

    if (!nachname || !vorname || !klasse || !fach || !halbjahrStr || !typ || !wertStr) {
      return fail('Pflichtfeld fehlt (nachname, vorname, klasse, fach, halbjahr, typ, wert)');
    }
    if (typ !== 'endnote' && typ !== 'direkt' && typ !== 'pruefung' && typ !== 'wpk_kurs') {
      return fail(`Unbekannter Typ "${typ}" (erlaubt: endnote, direkt, pruefung, wpk_kurs)`);
    }
    const halbjahr = Number(halbjahrStr);
    if (![1, 2, 3, 4].includes(halbjahr)) return fail('Halbjahr muss 1–4 sein');

    const k = klasseStmt.get(klasse) as { id: number; bildungsgang_id: number } | undefined;
    if (!k) return fail(`Klasse "${klasse}" nicht gefunden`, halbjahr);
    const s = schuelerStmt.get(k.id, nachname, vorname) as { id: number } | undefined;
    if (!s) {
      fehlend.add(`${nachname}, ${vorname} (${klasse})`);
      return fail('Schüler:in in dieser Klasse nicht gefunden', halbjahr);
    }

    // WPK-Kurs (Textwert): belegten Kurs zuordnen, fehlende Kurse beim Commit anlegen.
    if (typ === 'wpk_kurs') {
      const name = wertStr.trim();
      const key = name.toLowerCase();
      const sid = s.id;
      schreibAktionen.push(() => {
        let id = wpkKursMap.get(key);
        if (id === undefined) {
          id = erstelleWpkKurs(db, name);
          wpkKursMap.set(key, id);
        }
        speichereWpkKurs(db, sid, halbjahr, id);
      });
      proTyp.wpk_kurs++;
      return;
    }

    const wert = zahl(wertStr);
    if (wert === null || wert < 0 || wert > 15) return fail('Wert muss eine Zahl 0–15 sein', halbjahr);
    const f = fachStmt.get(fach) as { id: number } | undefined;
    if (!f) return fail(`Fach "${fach}" unbekannt`, halbjahr, wert);
    const schema = schemaStmt.get(f.id, halbjahr, k.bildungsgang_id) as
      | { halbjahr_modus: string; pruefung: number }
      | undefined;
    if (!schema) return fail(`Fach ${fach} hat im ${halbjahr}. Hj. kein Schema für diesen Bildungsgang`, halbjahr, wert);

    // Typ-spezifische Validierung + Zielbestimmung
    if (typ === 'direkt') {
      if (schema.halbjahr_modus !== 'direkt') {
        return fail(`Fach ${fach} ist im ${halbjahr}. Hj. komponentenbasiert — Direktnote nicht möglich (nutze typ=endnote)`, halbjahr, wert);
      }
      schreibAktionen.push(() =>
        speichereDirektnote(db, { schuelerId: s.id, fachId: f.id, halbjahr, wert, istNa: false, geaendertVon: opts.akteurId ?? null }),
      );
    } else if (typ === 'pruefung') {
      if (schema.pruefung !== 1) return fail(`Fach ${fach} hat im ${halbjahr}. Hj. keine Prüfung`, halbjahr, wert);
      schreibAktionen.push(() =>
        speicherePruefungsnote(db, { schuelerId: s.id, fachId: f.id, halbjahr, wert, istNa: false, geaendertVon: opts.akteurId ?? null }),
      );
    } else {
      // endnote (Override)
      schreibAktionen.push(() =>
        speichereImportierteEndnote(db, { schuelerId: s.id, fachId: f.id, halbjahr, wert, geaendertVon: opts.akteurId ?? null }),
      );
    }

    proTyp[typ]++;
  });

  // Nur Fehlerzeilen werden zurückgegeben; die Summe der proTyp-Zähler ist die
  // Zahl der gültigen (geplanten) Werte.
  const geplant = (Object.values(proTyp) as number[]).reduce((a, b) => a + b, 0);
  let geschrieben = false;
  if (opts.commit && geplant > 0) {
    db.transaction(() => {
      for (const a of schreibAktionen) a();
    })();
    geschrieben = true;
  }

  return {
    geplant,
    fehler: zeilen.length,
    proTyp,
    schuelerFehlend: [...fehlend].sort(),
    geschrieben,
    zeilen,
  };
}
