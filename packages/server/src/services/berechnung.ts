import { berechneFach, type EingabeHalbjahr, type ErgebnisHalbjahr } from '@notentabellen/core';
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
  fach: string;
  endpunkte: number | null;
  tendenz: string | null;
}
export interface ZeugnisZeile {
  schuelerId: number;
  name: string;
  vorname: string;
  faecher: ZeugnisZelle[];
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

  const schueler = db
    .prepare('SELECT id, name, vorname FROM schueler WHERE klasse_id = ? AND aktiv = 1 ORDER BY name, vorname')
    .all(klasseId) as { id: number; name: string; vorname: string }[];

  return schueler.map((s) => ({
    schuelerId: s.id,
    name: s.name,
    vorname: s.vorname,
    faecher: faecher.map((fach): ZeugnisZelle => {
      const erg = berechneFachFuerSchueler(db, s.id, fach);
      const zelle = erg.find((e) => e.halbjahr === halbjahr);
      return {
        fach,
        endpunkte: zelle?.endpunkte ?? null,
        tendenz: zelle?.tendenz ?? null,
      };
    }),
  }));
}
