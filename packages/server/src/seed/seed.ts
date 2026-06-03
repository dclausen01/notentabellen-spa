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
          deaktivierbar, aktiv, mittelwert_halbjahre,
          gewicht_aktuell, gewicht_extern, extern_fach, extern_halbjahr,
          pruefung, pruefung_verrechnen, abschluss_zeigen)
       VALUES (@fachId, @bgId, @halbjahr, @halbjahrModus, @kumulationModus,
               @deaktivierbar, @aktiv, @mittelwert,
               @gewichtAktuell, @gewichtExtern, @externFach, @externHalbjahr,
               @pruefung, @pruefungVerrechnen, @abschlussZeigen)
       ON CONFLICT(fach_id, bildungsgang_id, halbjahr) DO UPDATE SET
         halbjahr_modus = excluded.halbjahr_modus,
         kumulation_modus = excluded.kumulation_modus,
         deaktivierbar = excluded.deaktivierbar,
         aktiv = excluded.aktiv,
         mittelwert_halbjahre = excluded.mittelwert_halbjahre,
         gewicht_aktuell = excluded.gewicht_aktuell,
         gewicht_extern = excluded.gewicht_extern,
         extern_fach = excluded.extern_fach,
         extern_halbjahr = excluded.extern_halbjahr,
         pruefung = excluded.pruefung,
         pruefung_verrechnen = excluded.pruefung_verrechnen,
         abschluss_zeigen = excluded.abschluss_zeigen`,
    );
    const schemaId = db.prepare(
      'SELECT id FROM bewertungsschema WHERE fach_id = ? AND bildungsgang_id = ? AND halbjahr = ?',
    );
    // Komponenten per Upsert auf (schema_id, schluessel): bestehende Komponenten
    // (und damit referenzierende komponentennote-Zeilen) bleiben erhalten. Ein
    // Löschen+Neuanlegen würde am Fremdschlüssel scheitern, sobald Noten
    // existieren.
    const kompUpsert = db.prepare(
      `INSERT INTO komponente (schema_id, schluessel, name, gewicht_fix, rest_anteil, sortierung)
       VALUES (@schemaId, @schluessel, @name, @gewichtFix, @restAnteil, @sortierung)
       ON CONFLICT(schema_id, schluessel) DO UPDATE SET
         name = excluded.name, gewicht_fix = excluded.gewicht_fix,
         rest_anteil = excluded.rest_anteil, sortierung = excluded.sortierung`,
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
        gewichtAktuell: s.gewichtAktuell ?? null,
        gewichtExtern: s.gewichtExtern ?? null,
        externFach: s.externFach ?? null,
        externHalbjahr: s.externHalbjahr ?? null,
        pruefung: s.pruefung ? 1 : 0,
        pruefungVerrechnen: s.pruefungVerrechnen ? 1 : 0,
        abschlussZeigen: s.abschlussZeigen ? 1 : 0,
      });
      const sid = (schemaId.get(fid, bid, s.halbjahr) as { id: number }).id;
      s.komponenten.forEach((k, i) => {
        kompUpsert.run({
          schemaId: sid,
          schluessel: k.schluessel,
          name: k.name,
          gewichtFix: k.gewichtFix ?? null,
          restAnteil: k.restAnteil ? 1 : 0,
          sortierung: i,
        });
      });
      // Veraltete Komponenten (nicht mehr in der Konfiguration) entfernen — aber
      // nur, wenn keine Noten daran hängen (sonst Fremdschlüsselbruch / Datenverlust).
      const behalten = s.komponenten.map((k) => k.schluessel);
      const platzhalter = behalten.map(() => '?').join(',');
      db.prepare(
        `DELETE FROM komponente
          WHERE schema_id = ?
            ${behalten.length ? `AND schluessel NOT IN (${platzhalter})` : ''}
            AND id NOT IN (SELECT komponente_id FROM komponentennote)
            AND id NOT IN (SELECT komponente_id FROM komponente_deaktiviert)`,
      ).run(sid, ...behalten);
    }
  });
  tx();
}
