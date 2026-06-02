import { berechneFach, type ErgebnisHalbjahr } from '@notentabellen/core';
import type { DB } from '../db/connection.js';
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
  const schema = ladeSchema(db, fachSchluessel, bildungsgang);
  if (schema.length === 0) return [];
  const fId = fachId(db, fachSchluessel);
  const eingaben = ladeEingaben(db, schuelerId, fId, schema);
  return berechneFach({ schema, eingaben });
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
