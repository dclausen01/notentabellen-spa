import type { DB } from '../db/connection.js';
import { erstelleSchueler, setzeKlassenleitung, type Rolle } from '../db/stammdaten.js';
import { upsertLehrkraft } from '../db/admin.js';
import { parseCsv, feld } from './csv.js';

export interface ImportBericht {
  angelegt: number;
  uebersprungen: number;
  fehler: { zeile: number; grund: string }[];
}

function leererBericht(): ImportBericht {
  return { angelegt: 0, uebersprungen: 0, fehler: [] };
}

/**
 * Importiert Schüler:innen aus CSV. Spalten: vorname, nachname, klasse.
 * Bereits vorhandene (gleicher Name/Vorname in derselben Klasse) werden
 * übersprungen.
 */
export function importiereSchueler(db: DB, csv: string): ImportBericht {
  const bericht = leererBericht();
  const rows = parseCsv(csv);

  const klasseStmt = db.prepare('SELECT id FROM klasse WHERE bezeichnung = ?');
  const vorhandenStmt = db.prepare(
    'SELECT 1 FROM schueler WHERE name = ? AND vorname = ? AND klasse_id = ? AND aktiv = 1',
  );

  rows.forEach((row, idx) => {
    const zeile = idx + 2; // +1 Header, +1 für 1-basierte Zählung
    const vorname = feld(row, 'vorname');
    const nachname = feld(row, 'nachname', 'name');
    const klasse = feld(row, 'klasse');
    if (!vorname || !nachname || !klasse) {
      bericht.fehler.push({ zeile, grund: 'vorname, nachname und klasse erforderlich' });
      return;
    }
    const k = klasseStmt.get(klasse) as { id: number } | undefined;
    if (!k) {
      bericht.fehler.push({ zeile, grund: `Klasse "${klasse}" nicht gefunden` });
      return;
    }
    if (vorhandenStmt.get(nachname, vorname, k.id)) {
      bericht.uebersprungen++;
      return;
    }
    try {
      erstelleSchueler(db, nachname, vorname, k.id);
      bericht.angelegt++;
    } catch (e) {
      bericht.fehler.push({ zeile, grund: (e as Error).message });
    }
  });
  return bericht;
}

/**
 * Importiert Lehrkräfte aus CSV. Spalten: vorname, nachname, benutzername,
 * klasse (optional). Ist eine Klasse angegeben, wird die Lehrkraft als
 * Klassenleitung dieser Klasse gesetzt (Rolle 'klassenleitung'), sonst 'fach'.
 * Upsert über die Login-Kennung — erneuter Import aktualisiert, dupliziert nicht.
 */
export function importiereLehrkraefte(db: DB, csv: string): ImportBericht {
  const bericht = leererBericht();
  const rows = parseCsv(csv);
  const klasseStmt = db.prepare('SELECT id FROM klasse WHERE bezeichnung = ?');

  rows.forEach((row, idx) => {
    const zeile = idx + 2;
    const vorname = feld(row, 'vorname');
    const nachname = feld(row, 'nachname', 'name');
    const benutzer = feld(row, 'benutzername', 'benutzer', 'login', 'loginsub');
    const klasse = feld(row, 'klasse');
    if (!nachname || !benutzer) {
      bericht.fehler.push({ zeile, grund: 'nachname und benutzername erforderlich' });
      return;
    }
    let klasseId: number | undefined;
    if (klasse) {
      const k = klasseStmt.get(klasse) as { id: number } | undefined;
      if (!k) {
        bericht.fehler.push({ zeile, grund: `Klasse "${klasse}" nicht gefunden` });
        return;
      }
      klasseId = k.id;
    }
    const rolle: Rolle = klasseId !== undefined ? 'klassenleitung' : 'fach';
    const name = vorname ? `${nachname}, ${vorname}` : nachname;
    try {
      const lk = upsertLehrkraft(db, benutzer, name, rolle);
      if (klasseId !== undefined) setzeKlassenleitung(db, lk.id, klasseId);
      bericht.angelegt++;
    } catch (e) {
      bericht.fehler.push({ zeile, grund: (e as Error).message });
    }
  });
  return bericht;
}
