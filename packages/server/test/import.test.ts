import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/seed/seed.js';
import { erstelleKlasse } from '../src/db/stammdaten.js';
import { parseCsv } from '../src/services/csv.js';
import { importiereLehrkraefte, importiereSchueler } from '../src/services/import.js';

describe('parseCsv', () => {
  it('erkennt Semikolon (deutsches Excel) und mappt Header', () => {
    const r = parseCsv('Vorname;Nachname;Klasse\nMax;Mustermann;SPA24a');
    expect(r).toEqual([{ vorname: 'Max', nachname: 'Mustermann', klasse: 'SPA24a' }]);
  });
  it('unterstützt Komma, BOM, Anführungszeichen und Leerzeilen', () => {
    const r = parseCsv('﻿vorname,nachname,klasse\n"Anna","Be,rg",SPA24a\n\n');
    expect(r).toEqual([{ vorname: 'Anna', nachname: 'Be,rg', klasse: 'SPA24a' }]);
  });
});

let db: DB;
let klasseId: number;
beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  seed(db);
  klasseId = erstelleKlasse(db, 'SPA24a', '2024/25', 'SPA_PIA');
});

describe('importiereSchueler', () => {
  it('legt Schüler:innen an, überspringt Duplikate, meldet unbekannte Klassen', () => {
    const csv = 'vorname;nachname;klasse\nMax;Mustermann;SPA24a\nLea;Beispiel;GIBTSNICHT';
    const b1 = importiereSchueler(db, csv);
    expect(b1.angelegt).toBe(1);
    expect(b1.fehler).toHaveLength(1);
    expect(b1.fehler[0]!.grund).toMatch(/GIBTSNICHT/);

    // zweiter Lauf: Max ist Duplikat → übersprungen
    const b2 = importiereSchueler(db, 'vorname;nachname;klasse\nMax;Mustermann;SPA24a');
    expect(b2.angelegt).toBe(0);
    expect(b2.uebersprungen).toBe(1);

    const anzahl = (
      db.prepare('SELECT COUNT(*) AS n FROM schueler WHERE klasse_id = ?').get(klasseId) as {
        n: number;
      }
    ).n;
    expect(anzahl).toBe(1);
  });
});

describe('importiereLehrkraefte', () => {
  it('legt Lehrkräfte an; mit Klasse → Klassenleitung, ohne → Fachlehrkraft', () => {
    const csv =
      'vorname;nachname;benutzername;klasse\n' +
      'Dennis;Clausen;ClauD;SPA24a\n' +
      'Eva;Muster;MustE;';
    const b = importiereLehrkraefte(db, csv);
    expect(b.angelegt).toBe(2);

    const lk = db
      .prepare('SELECT name, login_sub, rolle FROM lehrkraft WHERE login_sub = ?')
      .get('ClauD') as { name: string; login_sub: string; rolle: string };
    expect(lk.rolle).toBe('klassenleitung');
    expect(lk.name).toBe('Clausen, Dennis');

    const eva = db.prepare('SELECT rolle FROM lehrkraft WHERE login_sub = ?').get('MustE') as {
      rolle: string;
    };
    expect(eva.rolle).toBe('fach');

    // Klassenleitung gesetzt?
    const kl = db
      .prepare(
        `SELECT 1 FROM klassenleitung kl JOIN lehrkraft l ON l.id = kl.lehrkraft_id
          WHERE l.login_sub = 'ClauD' AND kl.klasse_id = ?`,
      )
      .get(klasseId);
    expect(kl).toBeDefined();
  });

  it('erneuter Import dupliziert nicht (Upsert über Login-Kennung)', () => {
    const csv = 'vorname;nachname;benutzername\nDennis;Clausen;ClauD';
    importiereLehrkraefte(db, csv);
    importiereLehrkraefte(db, csv);
    const n = (
      db.prepare("SELECT COUNT(*) AS n FROM lehrkraft WHERE login_sub = 'ClauD'").get() as {
        n: number;
      }
    ).n;
    expect(n).toBe(1);
  });
});
