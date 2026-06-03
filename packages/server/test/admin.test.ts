import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { baueApp } from '../src/api/app.js';
import { FakeAuthenticator } from '../src/auth/authenticator.js';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/seed/seed.js';
import { erstelleKlasse, erstelleLehrkraft, erstelleSchueler } from '../src/db/stammdaten.js';
import { upsertLehrkraft } from '../src/db/admin.js';

let db: DB;
let app: FastifyInstance;
let adminToken: string;
let fachToken: string;

const auth = new FakeAuthenticator({
  admin: { passwort: 'geheim', name: 'Admin' },
  lehrer: { passwort: 'geheim', name: 'Lehrer' },
  neu: { passwort: 'pw', name: 'Neu Aus AD' },
});

async function login(benutzername: string, passwort: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { benutzername, passwort },
  });
  return JSON.parse(res.body).token;
}

async function json(method: string, url: string, token: string, body?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(body ? { payload: body } : {}),
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body || '{}') : null };
}

beforeEach(async () => {
  db = openDb(':memory:');
  migrate(db);
  seed(db);
  erstelleLehrkraft(db, 'Admin', 'admin', 'admin');
  erstelleLehrkraft(db, 'Lehrer', 'lehrer', 'fach');
  app = baueApp({ db, authenticator: auth, jwtSecret: 'test-secret' });
  await app.ready();
  adminToken = await login('admin', 'geheim');
  fachToken = await login('lehrer', 'geheim');
});

describe('Admin-Zugriffsschutz', () => {
  it('Fachlehrkraft erhält 403 auf Admin-Routen', async () => {
    const r = await json('GET', '/api/admin/lehrkraefte', fachToken);
    expect(r.status).toBe(403);
  });

  it('ohne Token: 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/lehrkraefte' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Stammdaten anlegen', () => {
  it('legt Klasse und Schüler:in an', async () => {
    const k = await json('POST', '/api/admin/klassen', adminToken, {
      bezeichnung: 'SPA PiA 1',
      schuljahr: '2025/26',
      bildungsgang: 'SPA_PIA',
    });
    expect(k.status).toBe(201);
    const klasseId = k.body.id;

    const s = await json('POST', `/api/admin/klassen/${klasseId}/schueler`, adminToken, {
      name: 'Mustermann',
      vorname: 'Max',
    });
    expect(s.status).toBe(201);

    const liste = await json('GET', `/api/klassen/${klasseId}/schueler`, adminToken);
    expect(liste.body.map((x: any) => x.name)).toContain('Mustermann');
  });

  it('doppelte Klasse → 400 mit verständlicher Meldung', async () => {
    const payload = { bezeichnung: 'SPA A', schuljahr: '2025/26', bildungsgang: 'SPA_REGULAR' };
    await json('POST', '/api/admin/klassen', adminToken, payload);
    const zweite = await json('POST', '/api/admin/klassen', adminToken, payload);
    expect(zweite.status).toBe(400);
    expect(zweite.body.fehler).toMatch(/existiert bereits/);
  });

  it('deaktiviert eine Schüler:in (verschwindet aus der aktiven Liste)', async () => {
    const klasseId = erstelleKlasse(db, 'SPA B', '2025/26', 'SPA_REGULAR');
    const s = await json('POST', `/api/admin/klassen/${klasseId}/schueler`, adminToken, {
      name: 'Weg',
      vorname: 'Da',
    });
    await json('DELETE', `/api/admin/schueler/${s.body.id}`, adminToken);
    const liste = await json('GET', `/api/klassen/${klasseId}/schueler`, adminToken);
    expect(liste.body).toHaveLength(0);
  });
});

describe('Lehrkraft-Provisionierung & Zugriff', () => {
  it('legt eine Lehrkraft an, die sich anschließend anmelden kann', async () => {
    const auth2 = new FakeAuthenticator({ neu: { passwort: 'pw', name: 'Neu' } });
    const app2 = baueApp({ db, authenticator: auth2, jwtSecret: 'test-secret' });
    await app2.ready();

    const r = await json('POST', '/api/admin/lehrkraefte', adminToken, {
      name: 'Neue Lehrkraft',
      loginSub: 'neu',
      rolle: 'fach',
    });
    expect(r.status).toBe(201);

    const res = await app2.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { benutzername: 'neu', passwort: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).rolle).toBe('fach');
  });

  it('doppelte Login-Kennung → 400', async () => {
    const r = await json('POST', '/api/admin/lehrkraefte', adminToken, {
      name: 'Kopie',
      loginSub: 'admin',
      rolle: 'fach',
    });
    expect(r.status).toBe(400);
    expect(r.body.fehler).toMatch(/bereits vergeben/);
  });

  it('ungültige Rolle → 400', async () => {
    const r = await json('POST', '/api/admin/lehrkraefte', adminToken, {
      name: 'X',
      loginSub: 'x',
      rolle: 'chef',
    });
    expect(r.status).toBe(400);
  });

  it('Name ist optional und wird beim Login aus dem AD übernommen', async () => {
    const r = await json('POST', '/api/admin/lehrkraefte', adminToken, {
      loginSub: 'neu',
      rolle: 'fach',
    });
    expect(r.status).toBe(201);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { benutzername: 'neu', passwort: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('Neu Aus AD');

    const row = db.prepare("SELECT name FROM lehrkraft WHERE login_sub = 'neu'").get() as {
      name: string;
    };
    expect(row.name).toBe('Neu Aus AD');
  });

  it('ändert die Rolle einer Lehrkraft (Fach <-> Klassenleitung)', async () => {
    const lk = await json('GET', '/api/admin/lehrkraefte', adminToken);
    const id = lk.body.find((l: any) => l.login_sub === 'lehrer').id;
    const r = await json('PUT', `/api/admin/lehrkraefte/${id}/rolle`, adminToken, {
      rolle: 'klassenleitung',
    });
    expect(r.status).toBe(204);
    const lk2 = await json('GET', '/api/admin/lehrkraefte', adminToken);
    expect(lk2.body.find((l: any) => l.id === id).rolle).toBe('klassenleitung');
  });
});

describe('Lehraufträge & Klassenleitung', () => {
  let lehrkraftId: number;
  let klasseId: number;

  beforeEach(async () => {
    klasseId = erstelleKlasse(db, 'SPA PiA 1', '2025/26', 'SPA_PIA');
    const lk = await json('GET', '/api/admin/lehrkraefte', adminToken);
    lehrkraftId = lk.body.find((l: any) => l.login_sub === 'lehrer').id;
  });

  it('weist Lehrauftrag zu und entfernt ihn wieder', async () => {
    const r = await json('POST', '/api/admin/lehrauftraege', adminToken, {
      lehrkraftId,
      fach: 'LF2',
      klasseId,
      halbjahr: 1,
    });
    expect(r.status).toBe(201);

    const a = await json('GET', `/api/admin/lehrkraefte/${lehrkraftId}/auftraege`, adminToken);
    expect(a.body.lehrauftraege).toHaveLength(1);
    expect(a.body.lehrauftraege[0].fach).toBe('LF2');

    // Fachlehrkraft sieht die Klasse jetzt
    const sicht = await json('GET', '/api/klassen', fachToken);
    expect(sicht.body.map((k: any) => k.id)).toContain(klasseId);

    await json('DELETE', `/api/admin/lehrauftraege/${a.body.lehrauftraege[0].id}`, adminToken);
    const a2 = await json('GET', `/api/admin/lehrkraefte/${lehrkraftId}/auftraege`, adminToken);
    expect(a2.body.lehrauftraege).toHaveLength(0);
  });

  it('ohne Halbjahr-Angabe wird der Auftrag für alle aktiven Halbjahre angelegt', async () => {
    const r = await json('POST', '/api/admin/lehrauftraege', adminToken, {
      lehrkraftId,
      fach: 'LF1',
      klasseId,
    });
    expect(r.status).toBe(201);
    const a = await json('GET', `/api/admin/lehrkraefte/${lehrkraftId}/auftraege`, adminToken);
    const lf1 = a.body.lehrauftraege.filter((x: any) => x.fach === 'LF1').map((x: any) => x.halbjahr);
    expect(lf1.sort()).toEqual([1, 2, 3, 4]);
  });

  it('unbekanntes Fach → 400', async () => {
    const r = await json('POST', '/api/admin/lehrauftraege', adminToken, {
      lehrkraftId,
      fach: 'GIBTESNICHT',
      klasseId,
      halbjahr: 1,
    });
    expect(r.status).toBe(400);
  });

  it('setzt und entfernt Klassenleitung', async () => {
    const r = await json('POST', '/api/admin/klassenleitung', adminToken, { lehrkraftId, klasseId });
    expect(r.status).toBe(201);
    let a = await json('GET', `/api/admin/lehrkraefte/${lehrkraftId}/auftraege`, adminToken);
    expect(a.body.klassenleitungen).toHaveLength(1);

    await json('DELETE', `/api/admin/klassenleitung?lehrkraftId=${lehrkraftId}&klasseId=${klasseId}`, adminToken);
    a = await json('GET', `/api/admin/lehrkraefte/${lehrkraftId}/auftraege`, adminToken);
    expect(a.body.klassenleitungen).toHaveLength(0);
  });
});

describe('upsertLehrkraft (seed-admin)', () => {
  it('legt einen Admin an und ist beim zweiten Aufruf idempotent (Update)', () => {
    const a = upsertLehrkraft(db, 'ClauD', 'Clausen, Dennis', 'admin');
    expect(a.rolle).toBe('admin');
    expect(a.login_sub).toBe('ClauD');

    // Zweiter Aufruf mit gleichem login_sub aktualisiert Name/Rolle, legt nicht doppelt an.
    const b = upsertLehrkraft(db, 'ClauD', 'Clausen, D.', 'klassenleitung');
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('Clausen, D.');
    expect(b.rolle).toBe('klassenleitung');

    const anzahl = (
      db.prepare("SELECT COUNT(*) AS n FROM lehrkraft WHERE login_sub = 'ClauD'").get() as { n: number }
    ).n;
    expect(anzahl).toBe(1);
  });
});

describe('Zeugnis-Export (XLSX)', () => {
  it('liefert eine XLSX-Datei mit passendem Dateinamen', async () => {
    const klasseId = erstelleKlasse(db, 'SPA PiA 1', '2025/26', 'SPA_PIA');
    const sId = erstelleSchueler(db, 'Mustermann', 'Max', klasseId);
    // eine Direktnote, damit Inhalt vorhanden ist
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: sId, fach: 'LF1', halbjahr: 1, wert: 12, istNa: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/zeugnis/export?klasseId=${klasseId}&halbjahr=1`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    // XLSX ist eine ZIP-Datei → beginnt mit "PK"
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('verweigert Fachlehrkräften den Export (403)', async () => {
    const klasseId = erstelleKlasse(db, 'SPA B', '2025/26', 'SPA_REGULAR');
    const res = await app.inject({
      method: 'GET',
      url: `/api/zeugnis/export?klasseId=${klasseId}&halbjahr=2`,
      headers: { authorization: `Bearer ${fachToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Wahlpflichtkurse (WPK)', () => {
  it('seedet die Standardkurse und legt einen neuen an', async () => {
    const r0 = await json('GET', '/api/admin/wpk-kurse', adminToken);
    expect(r0.body.map((k: any) => k.name)).toEqual(
      expect.arrayContaining(['Krippe (U3)', 'Nahrungsmittelzubereitung']),
    );

    const neu = await json('POST', '/api/admin/wpk-kurse', adminToken, { name: 'Tierpädagogik' });
    expect(neu.status).toBe(201);
    const r1 = await json('GET', '/api/admin/wpk-kurse', adminToken);
    expect(r1.body.map((k: any) => k.name)).toContain('Tierpädagogik');
  });

  it('deaktiviert einen Kurs (verschwindet aus der Eingabe-Auswahl)', async () => {
    const liste = await json('GET', '/api/admin/wpk-kurse', adminToken);
    const k = liste.body.find((x: any) => x.name === 'Krippe (U3)');
    const r = await json('PUT', `/api/admin/wpk-kurse/${k.id}`, adminToken, { aktiv: false });
    expect(r.status).toBe(204);

    const klasseId = erstelleKlasse(db, 'SPA PiA 1', '2025/26', 'SPA_PIA');
    erstelleSchueler(db, 'A', 'B', klasseId);
    const maske = (await json('GET', `/api/eingabe?klasseId=${klasseId}&fach=WPK&halbjahr=1`, adminToken)).body;
    expect(maske.wpkKurse.map((x: any) => x.name)).not.toContain('Krippe (U3)');
  });

  it('speichert den belegten Kurs einer Schüler:in und liefert ihn in der Maske', async () => {
    const klasseId = erstelleKlasse(db, 'SPA PiA 2', '2025/26', 'SPA_PIA');
    const sId = erstelleSchueler(db, 'Muster', 'Maxi', klasseId);
    const kurs = (await json('GET', '/api/admin/wpk-kurse', adminToken)).body.find(
      (x: any) => x.name === 'Nahrungsmittelzubereitung',
    );

    const put = await json('PUT', '/api/noten/wpk-kurs', adminToken, {
      schuelerId: sId, halbjahr: 1, wpkKursId: kurs.id,
    });
    expect(put.status).toBe(204);

    const maske = (await json('GET', `/api/eingabe?klasseId=${klasseId}&fach=WPK&halbjahr=1`, adminToken)).body;
    const zeile = maske.zeilen.find((z: any) => z.schuelerId === sId);
    expect(zeile.wpkKursId).toBe(kurs.id);

    // Entfernen (null) löscht die Zuordnung
    await json('PUT', '/api/noten/wpk-kurs', adminToken, { schuelerId: sId, halbjahr: 1, wpkKursId: null });
    const maske2 = (await json('GET', `/api/eingabe?klasseId=${klasseId}&fach=WPK&halbjahr=1`, adminToken)).body;
    expect(maske2.zeilen.find((z: any) => z.schuelerId === sId).wpkKursId).toBeNull();
  });
});

describe('Bewertungsschema-Übersicht', () => {
  it('liefert LF2 mit Komponenten und Gewichten', async () => {
    const r = await json('GET', '/api/admin/schemata?bildungsgang=SPA_PIA', adminToken);
    expect(r.status).toBe(200);
    const lf2 = r.body.find((s: any) => s.fach === 'LF2' && s.halbjahr === 1);
    expect(lf2.komponenten.map((k: any) => k.schluessel)).toEqual([
      'gesundheit',
      'erziehung',
      'entwicklung',
    ]);
    expect(lf2.komponenten[0].gewichtFix).toBeCloseTo(0.4);
  });
});
