import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { baueApp } from '../src/api/app.js';
import { FakeAuthenticator } from '../src/auth/authenticator.js';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/seed/seed.js';
import { erstelleKlasse, erstelleLehrkraft } from '../src/db/stammdaten.js';

let db: DB;
let app: FastifyInstance;
let adminToken: string;
let fachToken: string;

const auth = new FakeAuthenticator({
  admin: { passwort: 'geheim', name: 'Admin' },
  lehrer: { passwort: 'geheim', name: 'Lehrer' },
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
