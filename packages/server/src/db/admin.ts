import type { DB } from './connection.js';
import type { Rolle } from './stammdaten.js';

export interface Bildungsgang {
  id: number;
  schluessel: string;
  bezeichnung: string;
}

export interface Fach {
  id: number;
  schluessel: string;
  name: string;
  typ: 'LF' | 'FACH';
}

export interface Lehrkraft {
  id: number;
  name: string;
  login_sub: string;
  rolle: Rolle;
}

export interface LehrauftragZeile {
  id: number;
  fach: string;
  fachName: string;
  klasseId: number;
  klasse: string;
  halbjahr: number;
}

export interface KlassenleitungZeile {
  klasseId: number;
  klasse: string;
}

export function listeBildungsgaenge(db: DB): Bildungsgang[] {
  return db.prepare('SELECT id, schluessel, bezeichnung FROM bildungsgang ORDER BY schluessel').all() as Bildungsgang[];
}

export function listeFaecher(db: DB): Fach[] {
  return db.prepare('SELECT id, schluessel, name, typ FROM fach ORDER BY id').all() as Fach[];
}

export function listeLehrkraefte(db: DB): Lehrkraft[] {
  return db
    .prepare('SELECT id, name, login_sub, rolle FROM lehrkraft ORDER BY name')
    .all() as Lehrkraft[];
}

export function lehrauftraegeVonLehrkraft(db: DB, lehrkraftId: number): LehrauftragZeile[] {
  return db
    .prepare(
      `SELECT la.id, f.schluessel AS fach, f.name AS fachName,
              la.klasse_id AS klasseId, k.bezeichnung AS klasse, la.halbjahr
         FROM lehrauftrag la
         JOIN fach f ON f.id = la.fach_id
         JOIN klasse k ON k.id = la.klasse_id
        WHERE la.lehrkraft_id = ?
        ORDER BY k.bezeichnung, f.id, la.halbjahr`,
    )
    .all(lehrkraftId) as LehrauftragZeile[];
}

export function klassenleitungenVonLehrkraft(db: DB, lehrkraftId: number): KlassenleitungZeile[] {
  return db
    .prepare(
      `SELECT kl.klasse_id AS klasseId, k.bezeichnung AS klasse
         FROM klassenleitung kl
         JOIN klasse k ON k.id = kl.klasse_id
        WHERE kl.lehrkraft_id = ?
        ORDER BY k.bezeichnung`,
    )
    .all(lehrkraftId) as KlassenleitungZeile[];
}

/**
 * Legt eine Lehrkraft an oder aktualisiert sie (Upsert auf login_sub).
 * Wird u. a. vom seed-admin-CLI genutzt, um den ersten Admin ohne SQL
 * anzulegen. Gibt die gespeicherte Zeile zurück.
 */
export function upsertLehrkraft(
  db: DB,
  login: string,
  name: string,
  rolle: Rolle,
): Lehrkraft {
  db.prepare(
    `INSERT INTO lehrkraft (name, login_sub, rolle) VALUES (@name, @login, @rolle)
     ON CONFLICT(login_sub) DO UPDATE SET name = excluded.name, rolle = excluded.rolle`,
  ).run({ name, login, rolle });
  return db
    .prepare('SELECT id, name, login_sub, rolle FROM lehrkraft WHERE login_sub = ?')
    .get(login) as Lehrkraft;
}

/** Aktualisiert den Anzeigenamen einer Lehrkraft (z. B. aus dem AD beim Login). */
export function aktualisiereLehrkraftName(db: DB, id: number, name: string): void {
  db.prepare('UPDATE lehrkraft SET name = ? WHERE id = ?').run(name, id);
}

/** Ändert die Rolle einer Lehrkraft. */
export function setzeLehrkraftRolle(db: DB, id: number, rolle: Rolle): void {
  db.prepare('UPDATE lehrkraft SET rolle = ? WHERE id = ?').run(rolle, id);
}

/**
 * Halbjahre, in denen ein Fach für den Bildungsgang der Klasse aktiv ist —
 * Grundlage für die Voreinstellung „Lehrauftrag für alle Halbjahre".
 */
export function aktiveHalbjahreFuerFachKlasse(
  db: DB,
  fachSchluessel: string,
  klasseId: number,
): number[] {
  return (
    db
      .prepare(
        `SELECT bs.halbjahr FROM bewertungsschema bs
           JOIN fach f ON f.id = bs.fach_id
          WHERE f.schluessel = ?
            AND bs.aktiv = 1
            AND bs.bildungsgang_id = (SELECT bildungsgang_id FROM klasse WHERE id = ?)
          ORDER BY bs.halbjahr`,
      )
      .all(fachSchluessel, klasseId) as { halbjahr: number }[]
  ).map((r) => r.halbjahr);
}

export function entferneLehrauftrag(db: DB, id: number): void {
  db.prepare('DELETE FROM lehrauftrag WHERE id = ?').run(id);
}

export function entferneKlassenleitung(db: DB, lehrkraftId: number, klasseId: number): void {
  db.prepare('DELETE FROM klassenleitung WHERE lehrkraft_id = ? AND klasse_id = ?').run(
    lehrkraftId,
    klasseId,
  );
}

export function deaktiviereSchueler(db: DB, id: number): void {
  db.prepare('UPDATE schueler SET aktiv = 0 WHERE id = ?').run(id);
}

/**
 * Löscht eine Klasse endgültig samt allem, was an ihr hängt: Schüler:innen mit
 * ihren Noten/Ergebnissen, Lehraufträge, Klassenleitung und
 * Komponenten-Deaktivierungen. In einer Transaktion (keine verwaisten
 * Fremdschlüssel).
 */
export function loescheKlasse(db: DB, klasseId: number): void {
  const schuelerFilter = 'schueler_id IN (SELECT id FROM schueler WHERE klasse_id = ?)';
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM komponentennote WHERE ${schuelerFilter}`).run(klasseId);
    db.prepare(`DELETE FROM fachnote_direkt WHERE ${schuelerFilter}`).run(klasseId);
    db.prepare(`DELETE FROM wpk_eingabe WHERE ${schuelerFilter}`).run(klasseId);
    db.prepare(`DELETE FROM ergebnis WHERE ${schuelerFilter}`).run(klasseId);
    db.prepare('DELETE FROM schueler WHERE klasse_id = ?').run(klasseId);
    db.prepare('DELETE FROM lehrauftrag WHERE klasse_id = ?').run(klasseId);
    db.prepare('DELETE FROM klassenleitung WHERE klasse_id = ?').run(klasseId);
    db.prepare('DELETE FROM komponente_deaktiviert WHERE klasse_id = ?').run(klasseId);
    db.prepare('DELETE FROM klasse WHERE id = ?').run(klasseId);
  });
  tx();
}

export function aktualisiereSchueler(db: DB, id: number, name: string, vorname: string): void {
  db.prepare('UPDATE schueler SET name = ?, vorname = ? WHERE id = ?').run(name, vorname, id);
}

/**
 * Löscht eine Schüler:in endgültig inklusive aller erfassten Noten/Ergebnisse
 * (Komponenten- und Direktnoten, WPK-Eingaben, berechnete Ergebnisse). In einer
 * Transaktion, damit keine verwaisten Fremdschlüssel zurückbleiben.
 */
export function loescheSchuelerHart(db: DB, id: number): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM komponentennote WHERE schueler_id = ?').run(id);
    db.prepare('DELETE FROM fachnote_direkt WHERE schueler_id = ?').run(id);
    db.prepare('DELETE FROM wpk_eingabe WHERE schueler_id = ?').run(id);
    db.prepare('DELETE FROM ergebnis WHERE schueler_id = ?').run(id);
    db.prepare('DELETE FROM schueler WHERE id = ?').run(id);
  });
  tx();
}

export interface WpkKurs {
  id: number;
  name: string;
  aktiv: number;
}

export function listeWpkKurse(db: DB, nurAktive = false): WpkKurs[] {
  const sql = nurAktive
    ? 'SELECT id, name, aktiv FROM wpk_kurs WHERE aktiv = 1 ORDER BY name'
    : 'SELECT id, name, aktiv FROM wpk_kurs ORDER BY name';
  return db.prepare(sql).all() as WpkKurs[];
}

export function erstelleWpkKurs(db: DB, name: string): number {
  const info = db.prepare('INSERT INTO wpk_kurs (name) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

export function setzeWpkKursAktiv(db: DB, id: number, aktiv: boolean): void {
  db.prepare('UPDATE wpk_kurs SET aktiv = ? WHERE id = ?').run(aktiv ? 1 : 0, id);
}

/**
 * Setzt (oder entfernt) den belegten WPK-Kurs einer Schüler:in für ein
 * Halbjahr. `wpkKursId = null` löscht die Zuordnung. Die WPK-*Note* selbst wird
 * weiterhin als Direktnote (fachnote_direkt) erfasst — hier geht es nur um den
 * belegten Kurs.
 */
export function speichereWpkKurs(
  db: DB,
  schuelerId: number,
  halbjahr: number,
  wpkKursId: number | null,
): void {
  if (wpkKursId === null) {
    db.prepare('DELETE FROM wpk_eingabe WHERE schueler_id = ? AND halbjahr = ?').run(
      schuelerId,
      halbjahr,
    );
    return;
  }
  db.prepare(
    `INSERT INTO wpk_eingabe (schueler_id, halbjahr, wpk_kurs_id) VALUES (?, ?, ?)
     ON CONFLICT(schueler_id, halbjahr) DO UPDATE SET wpk_kurs_id = excluded.wpk_kurs_id`,
  ).run(schuelerId, halbjahr, wpkKursId);
}

export interface SchemaUebersichtKomponente {
  schluessel: string;
  name: string;
  gewichtFix: number | null;
  restAnteil: boolean;
}

export interface SchemaUebersichtZeile {
  fach: string;
  fachName: string;
  halbjahr: number;
  halbjahrModus: string;
  kumulationModus: string;
  deaktivierbar: boolean;
  aktiv: boolean;
  komponenten: SchemaUebersichtKomponente[];
}

/**
 * Schreibgeschützte Übersicht aller Bewertungsschemata eines Bildungsgangs
 * (Fach × Halbjahr mit Modi, Aktiv-Status, Gewichten). Dient der Kontrolle der
 * Konfiguration durch die Administration; die Gewichte sind golden-master-
 * verifiziert und werden bewusst nicht über die UI editiert.
 */
export function schemaUebersicht(db: DB, bildungsgangSchluessel: string): SchemaUebersichtZeile[] {
  const schemata = db
    .prepare(
      `SELECT bs.id, f.schluessel AS fach, f.name AS fachName, bs.halbjahr,
              bs.halbjahr_modus AS halbjahrModus, bs.kumulation_modus AS kumulationModus,
              bs.deaktivierbar, bs.aktiv
         FROM bewertungsschema bs
         JOIN fach f ON f.id = bs.fach_id
         JOIN bildungsgang bg ON bg.id = bs.bildungsgang_id
        WHERE bg.schluessel = ?
        ORDER BY f.id, bs.halbjahr`,
    )
    .all(bildungsgangSchluessel) as Array<{
    id: number;
    fach: string;
    fachName: string;
    halbjahr: number;
    halbjahrModus: string;
    kumulationModus: string;
    deaktivierbar: number;
    aktiv: number;
  }>;

  const kompStmt = db.prepare(
    'SELECT schluessel, name, gewicht_fix AS gewichtFix, rest_anteil AS restAnteil FROM komponente WHERE schema_id = ? ORDER BY sortierung',
  );

  return schemata.map((s) => ({
    fach: s.fach,
    fachName: s.fachName,
    halbjahr: s.halbjahr,
    halbjahrModus: s.halbjahrModus,
    kumulationModus: s.kumulationModus,
    deaktivierbar: s.deaktivierbar === 1,
    aktiv: s.aktiv === 1,
    komponenten: (kompStmt.all(s.id) as Array<{
      schluessel: string;
      name: string;
      gewichtFix: number | null;
      restAnteil: number;
    }>).map((k) => ({
      schluessel: k.schluessel,
      name: k.name,
      gewichtFix: k.gewichtFix,
      restAnteil: k.restAnteil === 1,
    })),
  }));
}
