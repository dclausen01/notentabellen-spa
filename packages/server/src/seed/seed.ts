import type { DB } from '../db/connection.js';
import { baueKonfiguration, type Konfiguration } from './konfiguration.js';

/**
 * Schreibt die fachliche Konfiguration idempotent in die DB (per Upsert auf
 * den natürlichen Schlüsseln). Mehrfaches Ausführen ist gefahrlos und bringt
 * eine bestehende DB auf den aktuellen Stand der Konfiguration.
 */
export function seed(db: DB, konfig: Konfiguration = baueKonfiguration()): void {
  const tx = db.transaction(() => {
    // Bildungsgänge
    const bgUpsert = db.prepare(
      `INSERT INTO bildungsgang (schluessel, bezeichnung) VALUES (@schluessel, @bezeichnung)
       ON CONFLICT(schluessel) DO UPDATE SET bezeichnung = excluded.bezeichnung`,
    );
    for (const bg of konfig.bildungsgaenge) bgUpsert.run(bg);

    // Notenskala
    const nsUpsert = db.prepare(
      `INSERT INTO notenskala (punkte, notentext) VALUES (@punkte, @notentext)
       ON CONFLICT(punkte) DO UPDATE SET notentext = excluded.notentext`,
    );
    for (const n of konfig.notenskala) nsUpsert.run(n);

    // WPK-Kurse
    const wpkUpsert = db.prepare(
      `INSERT INTO wpk_kurs (name) VALUES (?) ON CONFLICT(name) DO NOTHING`,
    );
    for (const k of konfig.wpkKurse) wpkUpsert.run(k);

    // Fächer
    const fachUpsert = db.prepare(
      `INSERT INTO fach (schluessel, name, typ) VALUES (@schluessel, @name, @typ)
       ON CONFLICT(schluessel) DO UPDATE SET name = excluded.name, typ = excluded.typ`,
    );
    for (const f of konfig.faecher) fachUpsert.run(f);

    const fachId = (schluessel: string) =>
      (db.prepare('SELECT id FROM fach WHERE schluessel = ?').get(schluessel) as
        | { id: number }
        | undefined)?.id;
    const bgId = (schluessel: string) =>
      (db.prepare('SELECT id FROM bildungsgang WHERE schluessel = ?').get(schluessel) as
        | { id: number }
        | undefined)?.id;

    // Bewertungsschemata + Komponenten
    const schemaUpsert = db.prepare(
      `INSERT INTO bewertungsschema
         (fach_id, bildungsgang_id, halbjahr, halbjahr_modus, kumulation_modus,
          deaktivierbar, aktiv, mittelwert_halbjahre)
       VALUES (@fachId, @bgId, @halbjahr, @halbjahrModus, @kumulationModus,
               @deaktivierbar, @aktiv, @mittelwert)
       ON CONFLICT(fach_id, bildungsgang_id, halbjahr) DO UPDATE SET
         halbjahr_modus = excluded.halbjahr_modus,
         kumulation_modus = excluded.kumulation_modus,
         deaktivierbar = excluded.deaktivierbar,
         aktiv = excluded.aktiv,
         mittelwert_halbjahre = excluded.mittelwert_halbjahre`,
    );
    const schemaId = db.prepare(
      'SELECT id FROM bewertungsschema WHERE fach_id = ? AND bildungsgang_id = ? AND halbjahr = ?',
    );
    const kompDelete = db.prepare('DELETE FROM komponente WHERE schema_id = ?');
    const kompInsert = db.prepare(
      `INSERT INTO komponente (schema_id, schluessel, name, gewicht_fix, rest_anteil, sortierung)
       VALUES (@schemaId, @schluessel, @name, @gewichtFix, @restAnteil, @sortierung)`,
    );

    for (const s of konfig.schemata) {
      const fid = fachId(s.fach);
      const bid = bgId(s.bildungsgang);
      if (fid === undefined || bid === undefined) {
        throw new Error(`Unbekanntes Fach/Bildungsgang: ${s.fach}/${s.bildungsgang}`);
      }
      schemaUpsert.run({
        fachId: fid,
        bgId: bid,
        halbjahr: s.halbjahr,
        halbjahrModus: s.halbjahrModus,
        kumulationModus: s.kumulationModus,
        deaktivierbar: s.deaktivierbar ? 1 : 0,
        aktiv: s.aktiv ? 1 : 0,
        mittelwert: s.mittelwertHalbjahre ? s.mittelwertHalbjahre.join(',') : null,
      });
      const sid = (schemaId.get(fid, bid, s.halbjahr) as { id: number }).id;
      kompDelete.run(sid);
      s.komponenten.forEach((k, i) => {
        kompInsert.run({
          schemaId: sid,
          schluessel: k.schluessel,
          name: k.name,
          gewichtFix: k.gewichtFix ?? null,
          restAnteil: k.restAnteil ? 1 : 0,
          sortierung: i,
        });
      });
    }
  });
  tx();
}
