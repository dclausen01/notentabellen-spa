import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { baueApp } from '../src/api/app.js';
import { FakeAuthenticator } from '../src/auth/authenticator.js';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/seed/seed.js';
import {
  erstelleKlasse,
  erstelleLehrauftrag,
  erstelleLehrkraft,
  erstelleSchueler,
  setzeKlassenleitung,
} from '../src/db/stammdaten.js';

let db: DB;
let app: FastifyInstance;
let klasse: number;
let schueler: number;

const auth = new FakeAuthenticator({
  fachlk: { passwort: 'pw', name: 'Fach LK' },
  kl: { passwort: 'pw', name: 'Klassenleitung' },
  fremd: { passwort: 'pw', name: 'Nicht provisioniert' },
});

async function login(benutzername: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { benutzername, passwort: 'pw' },
  });
  return JSON.parse(res.body).token;
}
function req(method: string, url: string, token: string, body?: unknown) {
  return app.inject({
    method: method as 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(body ? { payload: body } : {}),
  });
}

let fachLkId: number;

beforeEach(async () => {
  db = openDb(':memory:');
  migrate(db);
  seed(db);
  klasse = erstelleKlasse(db, 'SPA PiA 1', '2025/26', 'SPA_PIA');
  schueler = erstelleSchueler(db, 'Mustermann', 'Max', klasse);

  fachLkId = erstelleLehrkraft(db, 'Fach LK', 'fachlk', 'fach');
  erstelleLehrauftrag(db, fachLkId, 'LF1', klasse, 1); // nur LF1, 1. Hj.

  const klId = erstelleLehrkraft(db, 'Klassenleitung', 'kl', 'klassenleitung');
  setzeKlassenleitung(db, klId, klasse);
  // 'fremd' existiert im AD (Fake), aber NICHT in der lehrkraft-Tabelle.

  app = baueApp({ db, authenticator: auth, jwtSecret: 'test-secret' });
  await app.ready();
});

describe('Provisionierung', () => {
  it('AD-Nutzer ohne lehrkraft-Konto erhält 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { benutzername: 'fremd', passwort: 'pw' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Fachlehrkraft: nur eigenes Fach/Klasse/Halbjahr', () => {
  it('darf LF1 im 1. Hj. speichern', async () => {
    const token = await login('fachlk');
    const res = await req('PUT', '/api/noten/direkt', token, {
      schuelerId: schueler, fach: 'LF1', halbjahr: 1, wert: 10, istNa: false,
    });
    expect(res.statusCode).toBe(204);
  });

  it('darf LF1 im 2. Hj. NICHT speichern (kein Auftrag)', async () => {
    const token = await login('fachlk');
    const res = await req('PUT', '/api/noten/direkt', token, {
      schuelerId: schueler, fach: 'LF1', halbjahr: 2, wert: 10, istNa: false,
    });
    expect(res.statusCode).toBe(403);
  });

  it('darf ein fremdes Fach (LF2) NICHT speichern', async () => {
    const token = await login('fachlk');
    const maske = JSON.parse(
      (await req('GET', `/api/eingabe?klasseId=${klasse}&fach=LF1&halbjahr=1`, token)).body,
    );
    // Eingabemaske für LF2 ist bereits gesperrt:
    const res = await req('GET', `/api/eingabe?klasseId=${klasse}&fach=LF2&halbjahr=1`, token);
    expect(res.statusCode).toBe(403);
    expect(maske.fach).toBe('LF1');
  });

  it('darf die Zeugnisansicht NICHT abrufen', async () => {
    const token = await login('fachlk');
    const res = await req('GET', `/api/zeugnis?klasseId=${klasse}&halbjahr=1`, token);
    expect(res.statusCode).toBe(403);
  });

  it('sieht nur Klassen mit Lehrauftrag', async () => {
    const token = await login('fachlk');
    const k = JSON.parse((await req('GET', '/api/klassen', token)).body);
    expect(k).toHaveLength(1);
    expect(k[0].id).toBe(klasse);
  });

  it('Fächerauswahl der Klasse zeigt nur LF1 im 1. Hj.', async () => {
    const token = await login('fachlk');
    const f = JSON.parse((await req('GET', `/api/klassen/${klasse}/faecher`, token)).body);
    expect(f).toHaveLength(1);
    expect(f[0].schluessel).toBe('LF1');
    expect(f[0].halbjahre).toEqual([1]);
  });
});

describe('Klassenleitung: liest alle Fächer + Zeugnis der eigenen Klasse', () => {
  it('darf die Zeugnisansicht abrufen', async () => {
    const token = await login('kl');
    const res = await req('GET', `/api/zeugnis?klasseId=${klasse}&halbjahr=1`, token);
    expect(res.statusCode).toBe(200);
  });

  it('darf die Klasse neu berechnen', async () => {
    const token = await login('kl');
    const res = await req('POST', `/api/klassen/${klasse}/berechnung`, token);
    expect(res.statusCode).toBe(200);
  });
});

// Regressionstest zur Rückmeldung aus dem Praxistest: die Klassenleitung konnte
// die Eingabemaske für alle Fächer öffnen, aber nichts speichern (403) — die
// Eingaben verpufften still (LF3 „rechnet nicht", WPK „nicht anklickbar").
describe('Klassenleitung darf in der eigenen Klasse auch speichern', () => {
  it('speichert eine Direktnote ohne eigenen Lehrauftrag', async () => {
    const token = await login('kl');
    const res = await req('PUT', '/api/noten/direkt', token, {
      schuelerId: schueler, fach: 'LF1', halbjahr: 2, wert: 11, istNa: false,
    });
    expect(res.statusCode).toBe(204);
  });

  it('speichert eine Komponentennote (LF3)', async () => {
    const token = await login('kl');
    const komponenteId = (
      db
        .prepare(
          `SELECT k.id FROM komponente k
             JOIN bewertungsschema bs ON bs.id = k.schema_id
             JOIN fach f ON f.id = bs.fach_id
            WHERE f.schluessel = 'LF3' AND k.schluessel = 'paedagogik' AND bs.halbjahr = 1
              AND bs.bildungsgang_id = (SELECT bildungsgang_id FROM klasse WHERE id = ?)`,
        )
        .get(klasse) as { id: number }
    ).id;
    const res = await req('PUT', '/api/noten/komponente', token, {
      schuelerId: schueler, komponenteId, halbjahr: 1, wert: 12, istNa: false,
    });
    expect(res.statusCode).toBe(204);
  });

  it('setzt einen WPK-Kurs', async () => {
    const token = await login('kl');
    const kursId = (db.prepare('SELECT id FROM wpk_kurs LIMIT 1').get() as { id: number }).id;
    const res = await req('PUT', '/api/noten/wpk-kurs', token, {
      schuelerId: schueler, halbjahr: 1, wpkKursId: kursId,
    });
    expect(res.statusCode).toBe(204);
  });

  it('Eingabemaske meldet Schreibrecht (darfBearbeiten)', async () => {
    const kl = JSON.parse(
      (await req('GET', `/api/eingabe?klasseId=${klasse}&fach=LF3&halbjahr=1`, await login('kl'))).body,
    );
    expect(kl.darfBearbeiten).toBe(true);
    // Fachlehrkraft: nur im beauftragten Fach/Halbjahr.
    const lk = JSON.parse(
      (await req('GET', `/api/eingabe?klasseId=${klasse}&fach=LF1&halbjahr=1`, await login('fachlk'))).body,
    );
    expect(lk.darfBearbeiten).toBe(true);
  });
});

describe('Klassenwechsel & Querwechsler: nur Admin', () => {
  it('Fachlehrkraft darf nicht verschieben (403)', async () => {
    const token = await login('fachlk');
    const res = await req('PUT', `/api/admin/schueler/${schueler}/klasse`, token, { klasseId: klasse });
    expect(res.statusCode).toBe(403);
  });

  it('Klassenleitung darf keine Querwechsler:in aufnehmen (403)', async () => {
    const token = await login('kl');
    const res = await req('POST', '/api/admin/querwechsler', token, {
      name: 'Quer', vorname: 'Wexler', klasseId: klasse, endnoten: [],
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Notenbekanntgabe: nur Klassenleitung darf erstellen', () => {
  it('Fachlehrkraft (kein KL) → darfNotenbekanntgabe=false und 403 am Endpoint', async () => {
    const token = await login('fachlk');
    const klassen = JSON.parse((await req('GET', '/api/klassen', token)).body);
    expect(klassen.find((k: { id: number }) => k.id === klasse).darfNotenbekanntgabe).toBe(false);
    const res = await req('GET', `/api/zeugnis/notenbekanntgabe?klasseId=${klasse}`, token);
    expect(res.statusCode).toBe(403);
  });

  it('Klassenleitung → darfNotenbekanntgabe=true und erhält das Word-Dokument', async () => {
    const token = await login('kl');
    const klassen = JSON.parse((await req('GET', '/api/klassen', token)).body);
    expect(klassen.find((k: { id: number }) => k.id === klasse).darfNotenbekanntgabe).toBe(true);
    const res = await req('GET', `/api/zeugnis/notenbekanntgabe?klasseId=${klasse}`, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml');
  });
});
