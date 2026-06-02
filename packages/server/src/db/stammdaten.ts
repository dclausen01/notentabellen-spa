import type { DB } from './connection.js';

export interface Klasse {
  id: number;
  bezeichnung: string;
  schuljahr: string;
  bildungsgang_id: number;
  bildungsgang: string;
}

export interface Schueler {
  id: number;
  name: string;
  vorname: string;
  klasse_id: number;
  aktiv: number;
}

export function bildungsgangId(db: DB, schluessel: string): number {
  const row = db.prepare('SELECT id FROM bildungsgang WHERE schluessel = ?').get(schluessel) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`Bildungsgang ${schluessel} unbekannt`);
  return row.id;
}

export function erstelleKlasse(
  db: DB,
  bezeichnung: string,
  schuljahr: string,
  bildungsgangSchluessel: string,
): number {
  const info = db
    .prepare(
      'INSERT INTO klasse (bezeichnung, schuljahr, bildungsgang_id) VALUES (?, ?, ?)',
    )
    .run(bezeichnung, schuljahr, bildungsgangId(db, bildungsgangSchluessel));
  return Number(info.lastInsertRowid);
}

export function erstelleSchueler(
  db: DB,
  name: string,
  vorname: string,
  klasseId: number,
): number {
  const info = db
    .prepare('INSERT INTO schueler (name, vorname, klasse_id) VALUES (?, ?, ?)')
    .run(name, vorname, klasseId);
  return Number(info.lastInsertRowid);
}

export function listeKlassen(db: DB): Klasse[] {
  return db
    .prepare(
      `SELECT k.*, bg.schluessel AS bildungsgang
         FROM klasse k JOIN bildungsgang bg ON bg.id = k.bildungsgang_id
        ORDER BY k.schuljahr DESC, k.bezeichnung`,
    )
    .all() as Klasse[];
}

export function listeSchueler(db: DB, klasseId: number): Schueler[] {
  return db
    .prepare('SELECT * FROM schueler WHERE klasse_id = ? AND aktiv = 1 ORDER BY name, vorname')
    .all(klasseId) as Schueler[];
}
