import type { DB } from '../db/connection.js';
import { fachId } from '../db/lade-eingaben.js';
import { speichereImportierteEndnote } from '../db/noten.js';
import { erstelleSchueler } from '../db/stammdaten.js';
import { berechneFachFuerSchueler, faecherFuerBildungsgang } from './berechnung.js';

interface KlasseInfo {
  id: number;
  bezeichnung: string;
  bildungsgang: string;
}

export interface EingefroreneNote {
  fach: string;
  fachName: string;
  halbjahr: number;
  wert: number;
}

export interface WechselBericht {
  schuelerId: number;
  altKlasse: string;
  altBildungsgang: string;
  neuKlasse: string;
  neuBildungsgang: string;
  /** true, wenn sich der Bildungsgang geändert hat (dann werden Noten eingefroren). */
  bildungsgangGewechselt: boolean;
  /** Als übernommene Endnote eingefrorene (Fach × Halbjahr)-Noten. */
  eingefroren: EingefroreneNote[];
  /** Noten, die im neuen Bildungsgang kein aktives Halbjahr haben (manuell prüfen). */
  nichtUebernommen: EingefroreneNote[];
}

function klasseInfo(db: DB, klasseId: number): KlasseInfo | undefined {
  return db
    .prepare(
      `SELECT k.id, k.bezeichnung, bg.schluessel AS bildungsgang
         FROM klasse k JOIN bildungsgang bg ON bg.id = k.bildungsgang_id
        WHERE k.id = ?`,
    )
    .get(klasseId) as KlasseInfo | undefined;
}

function fachName(db: DB, schluessel: string): string {
  return (
    (db.prepare('SELECT name FROM fach WHERE schluessel = ?').get(schluessel) as
      | { name: string }
      | undefined)?.name ?? schluessel
  );
}

/** Halbjahre, in denen ein Fach im Bildungsgang aktiv ist (sortiert). */
function aktiveHalbjahre(db: DB, bildungsgang: string, fachSchluessel: string): number[] {
  return (
    db
      .prepare(
        `SELECT bs.halbjahr FROM bewertungsschema bs
           JOIN fach f ON f.id = bs.fach_id
           JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
          WHERE bg.schluessel = ? AND f.schluessel = ? AND bs.aktiv = 1
          ORDER BY bs.halbjahr`,
      )
      .all(bildungsgang, fachSchluessel) as { halbjahr: number }[]
  ).map((r) => r.halbjahr);
}

/** Hat das Fach im Bildungsgang mindestens ein komponentenbasiertes Halbjahr? */
function istKomponentenFach(db: DB, bildungsgang: string, fachSchluessel: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM bewertungsschema bs
           JOIN fach f ON f.id = bs.fach_id
           JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
          WHERE bg.schluessel = ? AND f.schluessel = ?
            AND bs.halbjahr_modus = 'komponenten_gewichtet'
          LIMIT 1`,
      )
      .get(bildungsgang, fachSchluessel) !== undefined
  );
}

/**
 * Fächer, deren berechnete Endnoten beim Bildungsgang-Wechsel nicht nativ
 * mitwandern und daher eingefroren werden müssen:
 * - komponentenbasierte Fächer (LF2/LF3): ihre Teilnoten hängen an
 *   bildungsgang-spezifischen Komponenten und gehen sonst verloren;
 * - Fächer mit unterschiedlichen aktiven Halbjahren (Praxis/Blockpraxis):
 *   die Struktur passt zwischen den Bildungsgängen nicht zusammen.
 * Direkte Fächer mit identischen aktiven Halbjahren (LF1, LF4, Deutsch …)
 * wandern über die fach_id-gebundenen Direktnoten automatisch mit.
 */
function einzufrierendeFaecher(db: DB, altBg: string, neuBg: string): string[] {
  return faecherFuerBildungsgang(db, altBg).filter((f) => {
    if (istKomponentenFach(db, altBg, f)) return true;
    const alt = aktiveHalbjahre(db, altBg, f).join(',');
    const neu = aktiveHalbjahre(db, neuBg, f).join(',');
    return alt !== neu;
  });
}

function schreibeAudit(
  db: DB,
  akteur: number | null | undefined,
  aktion: string,
  entitaetId: number,
  daten: unknown,
): void {
  db.prepare(
    `INSERT INTO audit_log (akteur_id, aktion, entitaet, entitaet_id, neu, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(akteur ?? null, aktion, 'schueler', entitaetId, JSON.stringify(daten), new Date().toISOString());
}

/**
 * Verschiebt eine Schüler:in in eine andere Klasse. Bei gleichem Bildungsgang
 * bleiben alle Noten gültig (nur die Klassenzuordnung ändert sich). Bei einem
 * Bildungsgang-Wechsel werden die nicht nativ übertragbaren Endnoten (LF2/LF3,
 * Praxis/Blockpraxis) als „übernommene Endnote" eingefroren, bevor die
 * Klassenzuordnung umgesetzt wird.
 */
export function verschiebeSchueler(
  db: DB,
  schuelerId: number,
  neueKlasseId: number,
  akteurId?: number | null,
): WechselBericht {
  const schueler = db
    .prepare('SELECT klasse_id FROM schueler WHERE id = ?')
    .get(schuelerId) as { klasse_id: number } | undefined;
  if (!schueler) throw new Error('Schüler:in nicht gefunden');
  if (schueler.klasse_id === neueKlasseId) throw new Error('Schüler:in ist bereits in dieser Klasse');

  const alt = klasseInfo(db, schueler.klasse_id);
  const neu = klasseInfo(db, neueKlasseId);
  if (!alt) throw new Error('Bisherige Klasse nicht gefunden');
  if (!neu) throw new Error('Zielklasse nicht gefunden');

  const bildungsgangGewechselt = alt.bildungsgang !== neu.bildungsgang;
  const eingefroren: EingefroreneNote[] = [];
  const nichtUebernommen: EingefroreneNote[] = [];

  // Vor dem Wechsel berechnen, solange `berechneFachFuerSchueler` noch das alte
  // Bildungsgang-Schema des Schülers nutzt.
  if (bildungsgangGewechselt) {
    for (const fach of einzufrierendeFaecher(db, alt.bildungsgang, neu.bildungsgang)) {
      const aktivNeu = new Set(aktiveHalbjahre(db, neu.bildungsgang, fach));
      const name = fachName(db, fach);
      for (const e of berechneFachFuerSchueler(db, schuelerId, fach)) {
        if (e.endpunkte === null || e.endpunkte === undefined) continue;
        const ziel = aktivNeu.has(e.halbjahr) ? eingefroren : nichtUebernommen;
        ziel.push({ fach, fachName: name, halbjahr: e.halbjahr, wert: e.endpunkte });
      }
    }
  }

  const tx = db.transaction(() => {
    if (bildungsgangGewechselt) {
      for (const n of eingefroren) {
        speichereImportierteEndnote(db, {
          schuelerId,
          fachId: fachId(db, n.fach),
          halbjahr: n.halbjahr,
          wert: n.wert,
          geaendertVon: akteurId ?? null,
        });
      }
    }
    db.prepare('UPDATE schueler SET klasse_id = ? WHERE id = ?').run(neueKlasseId, schuelerId);
    // Zwischengespeicherte Ergebnisse verwerfen — sie gehören zum alten Schema.
    db.prepare('DELETE FROM ergebnis WHERE schueler_id = ?').run(schuelerId);
    schreibeAudit(db, akteurId, 'schueler_klassenwechsel', schuelerId, {
      vonKlasse: alt.bezeichnung,
      vonBildungsgang: alt.bildungsgang,
      nachKlasse: neu.bezeichnung,
      nachBildungsgang: neu.bildungsgang,
      eingefroren: eingefroren.length,
      nichtUebernommen: nichtUebernommen.length,
    });
  });
  tx();

  return {
    schuelerId,
    altKlasse: alt.bezeichnung,
    altBildungsgang: alt.bildungsgang,
    neuKlasse: neu.bezeichnung,
    neuBildungsgang: neu.bildungsgang,
    bildungsgangGewechselt,
    eingefroren,
    nichtUebernommen,
  };
}

export interface QuerwechslerEndnote {
  fach: string;
  halbjahr: number;
  wert: number;
}

export interface QuerwechslerBericht {
  id: number;
  uebernommen: number;
}

/**
 * Nimmt eine Querwechsler:in (Wechsel von einer anderen Schule) geführt auf:
 * legt die Schüler:in an und schreibt die mitgebrachten Endnoten der vorherigen
 * Halbjahre als „übernommene Endnote" (Override), damit die Kumulation der
 * Folgehalbjahre darauf aufbaut.
 */
export function nimmQuerwechslerAuf(
  db: DB,
  eingabe: { name: string; vorname: string; klasseId: number; endnoten: QuerwechslerEndnote[] },
  akteurId?: number | null,
): QuerwechslerBericht {
  const name = eingabe.name.trim();
  const vorname = eingabe.vorname.trim();
  if (!name || !vorname) throw new Error('Name und Vorname erforderlich');
  const klasse = klasseInfo(db, eingabe.klasseId);
  if (!klasse) throw new Error('Zielklasse nicht gefunden');

  // Eingaben gegen das Schema des Zielbildungsgangs prüfen, bevor geschrieben wird.
  for (const n of eingabe.endnoten) {
    if (n.wert < 0 || n.wert > 15) {
      throw new Error(`Wert für ${n.fach} (${n.halbjahr}. Hj.) muss zwischen 0 und 15 liegen`);
    }
    if (!aktiveHalbjahre(db, klasse.bildungsgang, n.fach).includes(n.halbjahr)) {
      throw new Error(`${n.fach} ist im ${n.halbjahr}. Hj. dieses Bildungsgangs nicht aktiv`);
    }
  }

  let id = 0;
  const tx = db.transaction(() => {
    id = erstelleSchueler(db, name, vorname, eingabe.klasseId);
    for (const n of eingabe.endnoten) {
      speichereImportierteEndnote(db, {
        schuelerId: id,
        fachId: fachId(db, n.fach),
        halbjahr: n.halbjahr,
        wert: n.wert,
        geaendertVon: akteurId ?? null,
      });
    }
    schreibeAudit(db, akteurId, 'querwechsler_aufgenommen', id, {
      klasse: klasse.bezeichnung,
      bildungsgang: klasse.bildungsgang,
      endnoten: eingabe.endnoten.length,
    });
  });
  tx();

  return { id, uebernommen: eingabe.endnoten.length };
}
