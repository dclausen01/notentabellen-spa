import {
  berechneFach,
  STANDARD_NOTENSKALA,
  tendenzAusEndpunkten,
  type EingabeHalbjahr,
  type ErgebnisHalbjahr,
} from '@notentabellen/core';
import type { DB } from '../db/connection.js';
import { deaktivierteKomponenten } from '../db/komponenten.js';
import { ladeSchema } from '../db/lade-schema.js';
import {
  bildungsgangVonSchueler,
  fachId,
  ladeEingaben,
} from '../db/lade-eingaben.js';

/**
 * Berechnet ein Fach für einen Schüler: lädt das passende Bildungsgang-Schema
 * und die Eingaben aus der DB und schickt sie durch den Rechenkern.
 */
export function berechneFachFuerSchueler(
  db: DB,
  schuelerId: number,
  fachSchluessel: string,
): ErgebnisHalbjahr[] {
  const bildungsgang = bildungsgangVonSchueler(db, schuelerId);
  let schema = ladeSchema(db, fachSchluessel, bildungsgang);
  if (schema.length === 0) return [];

  // Pro Klasse deaktivierte (Rest-)Komponenten herausfiltern — die Engine
  // verteilt das Restbudget dann auf die verbleibenden aktiven Komponenten.
  const klasseId = klasseVonSchuelerId(db, schuelerId);
  if (klasseId !== undefined) {
    const deaktiviert = deaktivierteKomponenten(db, klasseId, fachSchluessel);
    if (deaktiviert.size > 0) {
      schema = schema.map((s) => ({
        ...s,
        komponenten: s.komponenten.filter((k) => !deaktiviert.has(`${s.halbjahr}:${k.schluessel}`)),
      }));
    }
  }

  const fId = fachId(db, fachSchluessel);
  const eingaben = ladeEingaben(db, schuelerId, fId, schema);
  injiziereExterneWerte(db, schuelerId, fachSchluessel, bildungsgang, eingaben);
  injiziereImportierteEndnoten(db, schuelerId, fId, eingaben);
  return berechneFach({ schema, eingaben });
}

function klasseVonSchuelerId(db: DB, schuelerId: number): number | undefined {
  return (
    db.prepare('SELECT klasse_id FROM schueler WHERE id = ?').get(schuelerId) as
      | { klasse_id: number }
      | undefined
  )?.klasse_id;
}

/**
 * Befüllt `externerWert` der Eingaben, wenn ein Halbjahr seine Endnote aus
 * einem ANDEREN Fach mitbezieht (Praxis PiA 4. Hj. ← Blockpraxis 3. Hj.). Die
 * Quelle steht als Konfiguration am Bewertungsschema (extern_fach/-halbjahr).
 */
function injiziereExterneWerte(
  db: DB,
  schuelerId: number,
  fachSchluessel: string,
  bildungsgang: string,
  eingaben: EingabeHalbjahr[],
): void {
  const refs = db
    .prepare(
      `SELECT bs.halbjahr, bs.extern_fach AS externFach, bs.extern_halbjahr AS externHalbjahr
         FROM bewertungsschema bs
         JOIN fach f ON f.id = bs.fach_id
         JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
        WHERE f.schluessel = ? AND bg.schluessel = ?
          AND bs.aktiv = 1 AND bs.extern_fach IS NOT NULL`,
    )
    .all(fachSchluessel, bildungsgang) as Array<{
    halbjahr: number;
    externFach: string;
    externHalbjahr: number;
  }>;

  for (const ref of refs) {
    // Quellfach berechnen und dessen Endnote im Quell-Halbjahr übernehmen.
    const quelle = berechneFachFuerSchueler(db, schuelerId, ref.externFach);
    const wert = quelle.find((e) => e.halbjahr === ref.externHalbjahr)?.endpunkte ?? null;
    const eingabe = eingaben.find((e) => e.halbjahr === ref.halbjahr);
    if (eingabe) eingabe.externerWert = wert;
  }

  // Verrechnete Prüfungen (Englisch/Mathe FHR 4. Hj.): die Prüfungsnote des
  // Fachs/Halbjahres fließt als externer Wert ein (0,6·Vornote + 0,4·Prüfung).
  const pruefRefs = db
    .prepare(
      `SELECT bs.halbjahr FROM bewertungsschema bs
         JOIN fach f ON f.id = bs.fach_id
         JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
        WHERE f.schluessel = ? AND bg.schluessel = ?
          AND bs.aktiv = 1 AND bs.pruefung_verrechnen = 1`,
    )
    .all(fachSchluessel, bildungsgang) as Array<{ halbjahr: number }>;
  if (pruefRefs.length > 0) {
    const fId = fachId(db, fachSchluessel);
    for (const ref of pruefRefs) {
      const wert = ladePruefungsnote(db, schuelerId, fId, ref.halbjahr);
      const eingabe = eingaben.find((e) => e.halbjahr === ref.halbjahr);
      if (eingabe) eingabe.externerWert = wert;
    }
  }
}

/**
 * Befüllt `importierteEndnote` der Eingaben aus der Tabelle `importierte_endnote`
 * (übernommene Altnoten). Wo gesetzt, überschreibt sie die Berechnung.
 */
function injiziereImportierteEndnoten(
  db: DB,
  schuelerId: number,
  fId: number,
  eingaben: EingabeHalbjahr[],
): void {
  const rows = db
    .prepare('SELECT halbjahr, wert FROM importierte_endnote WHERE schueler_id = ? AND fach_id = ?')
    .all(schuelerId, fId) as Array<{ halbjahr: number; wert: number }>;
  for (const r of rows) {
    const eingabe = eingaben.find((e) => e.halbjahr === r.halbjahr);
    if (eingabe) eingabe.importierteEndnote = r.wert;
  }
}

/** Liest die (effektive) Prüfungsnote in Punkten oder null (n/a / fehlt). */
function ladePruefungsnote(
  db: DB,
  schuelerId: number,
  fId: number,
  halbjahr: number,
): number | null {
  const row = db
    .prepare(
      'SELECT wert, ist_na FROM pruefungsnote WHERE schueler_id = ? AND fach_id = ? AND halbjahr = ?',
    )
    .get(schuelerId, fId, halbjahr) as { wert: number | null; ist_na: number } | undefined;
  return row && !row.ist_na ? row.wert : null;
}

/** Persistiert berechnete Ergebnisse eines Fachs (Upsert je Halbjahr). */
export function speichereErgebnisse(
  db: DB,
  schuelerId: number,
  fachSchluessel: string,
  ergebnisse: ErgebnisHalbjahr[],
): void {
  const fId = fachId(db, fachSchluessel);
  const stmt = db.prepare(
    `INSERT INTO ergebnis
       (schueler_id, fach_id, halbjahr, zwischennote, endpunkte, tendenz, berechnet_am)
     VALUES (@schuelerId, @fachId, @halbjahr, @zwischennote, @endpunkte, @tendenz, @ts)
     ON CONFLICT(schueler_id, fach_id, halbjahr) DO UPDATE SET
       zwischennote = excluded.zwischennote, endpunkte = excluded.endpunkte,
       tendenz = excluded.tendenz, berechnet_am = excluded.berechnet_am`,
  );
  const ts = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const e of ergebnisse) {
      stmt.run({
        schuelerId,
        fachId: fId,
        halbjahr: e.halbjahr,
        zwischennote: e.zwischennote,
        endpunkte: e.endpunkte,
        tendenz: e.tendenz,
        ts,
      });
    }
  });
  tx();
}

/** Alle Fächer, die für einen Bildungsgang konfiguriert (irgendwo aktiv) sind. */
export function faecherFuerBildungsgang(db: DB, bildungsgang: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT f.schluessel FROM fach f
           JOIN bewertungsschema bs ON bs.fach_id = f.id
           JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
          WHERE bg.schluessel = ? AND bs.aktiv = 1
          ORDER BY f.id`,
      )
      .all(bildungsgang) as { schluessel: string }[]
  ).map((r) => r.schluessel);
}

/** Berechnet alle Fächer einer ganzen Klasse neu und speichert die Ergebnisse. */
export function berechneKlasse(db: DB, klasseId: number): number {
  const schueler = db
    .prepare('SELECT id FROM schueler WHERE klasse_id = ? AND aktiv = 1')
    .all(klasseId) as { id: number }[];
  const bg = db
    .prepare(
      `SELECT bg.schluessel FROM klasse k JOIN bildungsgang bg ON bg.id = k.bildungsgang_id WHERE k.id = ?`,
    )
    .get(klasseId) as { schluessel: string } | undefined;
  if (!bg) throw new Error(`Klasse ${klasseId} nicht gefunden`);
  const faecher = faecherFuerBildungsgang(db, bg.schluessel);

  let count = 0;
  for (const s of schueler) {
    for (const fach of faecher) {
      const erg = berechneFachFuerSchueler(db, s.id, fach);
      speichereErgebnisse(db, s.id, fach, erg);
      count += erg.length;
    }
  }
  return count;
}

export interface ZeugnisZelle {
  /** Eindeutiger Spalten-Key, z. B. "LF1" oder "PRAXIS:2". */
  fach: string;
  /** Anzeige-Beschriftung (Default = Fachname). */
  label?: string;
  endpunkte: number | null;
  tendenz: string | null;
}
export interface ZeugnisZeile {
  schuelerId: number;
  name: string;
  vorname: string;
  faecher: ZeugnisZelle[];
  /** Nur im Abschlusszeugnis (4. Hj.): hervorgehobener Prüfungsblock. */
  pruefungen?: ZeugnisZelle[];
}

export interface VorwertZeile {
  schuelerId: number;
  endpunkte: number | null;
  tendenz: string | null;
}
export interface VorwertInfo {
  /** Kurzbeschreibung der Verrechnung, oder null wenn es keinen Vorwert gibt. */
  label: string | null;
  werte: VorwertZeile[];
}

/**
 * Ermittelt zur Orientierung den Wert, der aus einem anderen Halbjahr/Fach in
 * die Endnote des gewählten Halbjahres einfließt (für die ausgegraute Anzeige
 * in der Eingabemaske):
 * - `fortlaufend_50_50`: Endnote des vorherigen aktiven Halbjahres (50 %).
 * - `gewichtet_vorgaenger` (extern): Endnote des Quellfachs/-halbjahres (z. B.
 *   Blockpraxis 3. Hj., 30 %).
 * - `mittelwert_halbjahre`: das andere gemittelte Halbjahr.
 * - `keine`: kein Vorwert.
 */
export function vorwerteFuer(
  db: DB,
  klasseId: number,
  fachSchluessel: string,
  halbjahr: number,
): VorwertInfo {
  const leer: VorwertInfo = { label: null, werte: [] };
  const bg = db
    .prepare(
      `SELECT bg.schluessel FROM klasse k JOIN bildungsgang bg ON bg.id = k.bildungsgang_id WHERE k.id = ?`,
    )
    .get(klasseId) as { schluessel: string } | undefined;
  if (!bg) return leer;

  const schema = ladeSchema(db, fachSchluessel, bg.schluessel);
  const aktuell = schema.find((s) => s.halbjahr === halbjahr);
  if (!aktuell || !aktuell.aktiv) return leer;

  let label: string | null = null;
  let quellHalbjahr: number | null = null; // gleiches Fach
  let externFach: string | null = null; // anderes Fach
  let externHalbjahr: number | null = null;

  if (aktuell.kumulationModus === 'fortlaufend_50_50') {
    const vor = schema
      .filter((s) => s.aktiv && s.halbjahr < halbjahr)
      .map((s) => s.halbjahr)
      .sort((a, b) => b - a)[0];
    if (vor !== undefined) {
      quellHalbjahr = vor;
      label = `Endnote ${vor}. Hj. — fließt zu 50 % ein`;
    }
  } else if (aktuell.kumulationModus === 'mittelwert_halbjahre') {
    const andere = (aktuell.mittelwertHalbjahre ?? []).filter(
      (h) => h !== halbjahr && schema.find((s) => s.halbjahr === h)?.aktiv,
    );
    if (andere[0] !== undefined) {
      quellHalbjahr = andere[0];
      label = `${andere[0]}. Hj. — Mittelwert mit diesem Halbjahr`;
    }
  } else if (aktuell.kumulationModus === 'gewichtet_vorgaenger') {
    const ref = db
      .prepare(
        `SELECT bs.extern_fach AS f, bs.extern_halbjahr AS h, bs.gewicht_extern AS g
           FROM bewertungsschema bs JOIN fach fa ON fa.id = bs.fach_id
           JOIN bildungsgang b ON b.id = bs.bildungsgang_id
          WHERE fa.schluessel = ? AND b.schluessel = ? AND bs.halbjahr = ?`,
      )
      .get(fachSchluessel, bg.schluessel, halbjahr) as
      | { f: string | null; h: number | null; g: number | null }
      | undefined;
    if (ref?.f && ref.h) {
      externFach = ref.f;
      externHalbjahr = ref.h;
      const fname =
        (db.prepare('SELECT name FROM fach WHERE schluessel = ?').get(ref.f) as
          | { name: string }
          | undefined)?.name ?? ref.f;
      label = `${fname} ${ref.h}. Hj. — fließt zu ${Math.round((ref.g ?? 0.3) * 100)} % ein`;
    }
  }

  if (label === null) return leer;

  const schueler = db
    .prepare('SELECT id FROM schueler WHERE klasse_id = ? AND aktiv = 1 ORDER BY name, vorname')
    .all(klasseId) as { id: number }[];

  const werte: VorwertZeile[] = schueler.map((s) => {
    const fach = externFach ?? fachSchluessel;
    const hj = externFach ? externHalbjahr : quellHalbjahr;
    const erg = berechneFachFuerSchueler(db, s.id, fach);
    const zelle = erg.find((e) => e.halbjahr === hj);
    return { schuelerId: s.id, endpunkte: zelle?.endpunkte ?? null, tendenz: zelle?.tendenz ?? null };
  });
  return { label, werte };
}

/**
 * Zeugnisansicht einer Klasse für ein Halbjahr: je Schüler:in für jedes (in
 * diesem Halbjahr aktive) Fach die berechnete Endnote + Tendenz. Rechnet live
 * (keine Abhängigkeit von zuvor gespeicherten `ergebnis`-Zeilen).
 */
export function zeugnisFuerKlasse(
  db: DB,
  klasseId: number,
  halbjahr: number,
): ZeugnisZeile[] {
  const bg = db
    .prepare(
      `SELECT bg.schluessel FROM klasse k JOIN bildungsgang bg ON bg.id = k.bildungsgang_id WHERE k.id = ?`,
    )
    .get(klasseId) as { schluessel: string } | undefined;
  if (!bg) throw new Error(`Klasse ${klasseId} nicht gefunden`);

  const schueler = db
    .prepare('SELECT id, name, vorname FROM schueler WHERE klasse_id = ? AND aktiv = 1 ORDER BY name, vorname')
    .all(klasseId) as { id: number; name: string; vorname: string }[];

  // 4. Hj. = Abschlusszeugnis (alle Fächer mit Endnote + Prüfungsblock).
  if (halbjahr === 4) return abschlusszeugnis(db, bg.schluessel, schueler);

  const namen = fachNamen(db);
  const faecher = (
    db
      .prepare(
        `SELECT DISTINCT f.schluessel FROM fach f
           JOIN bewertungsschema bs ON bs.fach_id = f.id
           JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
          WHERE bg.schluessel = ? AND bs.halbjahr = ? AND bs.aktiv = 1
          ORDER BY f.id`,
      )
      .all(bg.schluessel, halbjahr) as { schluessel: string }[]
  ).map((r) => r.schluessel);

  return schueler.map((s) => ({
    schuelerId: s.id,
    name: s.name,
    vorname: s.vorname,
    faecher: faecher.map((fach): ZeugnisZelle => {
      const erg = berechneFachFuerSchueler(db, s.id, fach);
      const zelle = erg.find((e) => e.halbjahr === halbjahr);
      return {
        fach,
        label: namen.get(fach) ?? fach,
        endpunkte: zelle?.endpunkte ?? null,
        tendenz: zelle?.tendenz ?? null,
      };
    }),
  }));
}

function fachNamen(db: DB): Map<string, string> {
  return new Map(
    (db.prepare('SELECT schluessel, name FROM fach').all() as { schluessel: string; name: string }[]).map(
      (r) => [r.schluessel, r.name],
    ),
  );
}

/**
 * Abschlusszeugnis (4. Hj.): pro Fach die finale Endnote an der/den konfigurierten
 * Position(en) (`abschluss_zeigen`), inkl. früher abgeschlossener Fächer (WPK,
 * Praxis, Blockpraxis). Zusätzlich der Prüfungsblock (`pruefung`).
 */
function abschlusszeugnis(
  db: DB,
  bildungsgang: string,
  schueler: { id: number; name: string; vorname: string }[],
): ZeugnisZeile[] {
  const namen = fachNamen(db);

  const positionen = db
    .prepare(
      `SELECT f.schluessel AS fach, bs.halbjahr AS halbjahr
         FROM bewertungsschema bs JOIN fach f ON f.id = bs.fach_id
         JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
        WHERE bg.schluessel = ? AND bs.abschluss_zeigen = 1
        ORDER BY f.id, bs.halbjahr`,
    )
    .all(bildungsgang) as { fach: string; halbjahr: number }[];
  const anzahlProFach = new Map<string, number>();
  for (const p of positionen) anzahlProFach.set(p.fach, (anzahlProFach.get(p.fach) ?? 0) + 1);
  const posLabel = (p: { fach: string; halbjahr: number }) => {
    const name = namen.get(p.fach) ?? p.fach;
    return (anzahlProFach.get(p.fach) ?? 1) > 1 ? `${name} (${p.halbjahr}. Hj.)` : name;
  };

  const pruefPos = db
    .prepare(
      `SELECT f.schluessel AS fach, bs.halbjahr AS halbjahr
         FROM bewertungsschema bs JOIN fach f ON f.id = bs.fach_id
         JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
        WHERE bg.schluessel = ? AND bs.pruefung = 1
        ORDER BY f.id, bs.halbjahr`,
    )
    .all(bildungsgang) as { fach: string; halbjahr: number }[];
  const pruefLabel = (fach: string) =>
    fach === 'ENGLISCH' ? 'Englisch-FHR' : fach === 'MATHEMATIK' ? 'Mathe-FHR' : `${namen.get(fach) ?? fach} (Prüfung)`;

  return schueler.map((s) => {
    const cache = new Map<string, ErgebnisHalbjahr[]>();
    const erg = (fach: string) => {
      if (!cache.has(fach)) cache.set(fach, berechneFachFuerSchueler(db, s.id, fach));
      return cache.get(fach)!;
    };

    const faecher: ZeugnisZelle[] = positionen.map((p) => {
      const z = erg(p.fach).find((e) => e.halbjahr === p.halbjahr);
      return {
        fach: `${p.fach}:${p.halbjahr}`,
        label: posLabel(p),
        endpunkte: z?.endpunkte ?? null,
        tendenz: z?.tendenz ?? null,
      };
    });
    const pruefungen: ZeugnisZelle[] = pruefPos.map((p) => {
      const wert = ladePruefungsnote(db, s.id, fachId(db, p.fach), p.halbjahr);
      return {
        fach: `PRUEF:${p.fach}:${p.halbjahr}`,
        label: pruefLabel(p.fach),
        endpunkte: wert,
        tendenz: wert == null ? null : tendenzAusEndpunkten(wert, STANDARD_NOTENSKALA),
      };
    });
    return { schuelerId: s.id, name: s.name, vorname: s.vorname, faecher, pruefungen };
  });
}
