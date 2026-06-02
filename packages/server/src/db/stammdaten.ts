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

export type Rolle = 'fach' | 'klassenleitung' | 'admin';

export function erstelleLehrkraft(
  db: DB,
  name: string,
  loginSub: string,
  rolle: Rolle,
): number {
  const info = db
    .prepare('INSERT INTO lehrkraft (name, login_sub, rolle) VALUES (?, ?, ?)')
    .run(name, loginSub, rolle);
  return Number(info.lastInsertRowid);
}

export function erstelleLehrauftrag(
  db: DB,
  lehrkraftId: number,
  fachSchluessel: string,
  klasseId: number,
  halbjahr: number,
): void {
  const fid = (
    db.prepare('SELECT id FROM fach WHERE schluessel = ?').get(fachSchluessel) as
      | { id: number }
      | undefined
  )?.id;
  if (fid === undefined) throw new Error(`Fach ${fachSchluessel} unbekannt`);
  db.prepare(
    `INSERT INTO lehrauftrag (lehrkraft_id, fach_id, klasse_id, halbjahr) VALUES (?, ?, ?, ?)
     ON CONFLICT(lehrkraft_id, fach_id, klasse_id, halbjahr) DO NOTHING`,
  ).run(lehrkraftId, fid, klasseId, halbjahr);
}

export function setzeKlassenleitung(db: DB, lehrkraftId: number, klasseId: number): void {
  db.prepare(
    `INSERT INTO klassenleitung (lehrkraft_id, klasse_id) VALUES (?, ?)
     ON CONFLICT(lehrkraft_id, klasse_id) DO NOTHING`,
  ).run(lehrkraftId, klasseId);
}
