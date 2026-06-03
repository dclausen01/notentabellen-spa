import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { baueApp } from '../src/api/app.js';
import { FakeAuthenticator } from '../src/auth/authenticator.js';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/seed/seed.js';
import {
  erstelleKlasse,
  erstelleLehrkraft,
  erstelleSchueler,
} from '../src/db/stammdaten.js';
import golden from '../../core/test/fixtures/excel_golden.json' assert { type: 'json' };

let db: DB;
let app: FastifyInstance;
let piaKlasse: number;
let regKlasse: number;
let schueler: number;
let adminToken: string;

const auth = new FakeAuthenticator({
  admin: { passwort: 'geheim', name: 'Admin' },
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
  piaKlasse = erstelleKlasse(db, 'SPA PiA 1', '2025/26', 'SPA_PIA');
  regKlasse = erstelleKlasse(db, 'SPA A', '2025/26', 'SPA_REGULAR');
  schueler = erstelleSchueler(db, 'Mustermann', 'Max', piaKlasse);
  erstelleLehrkraft(db, 'Admin', 'admin', 'admin');
  app = baueApp({ db, authenticator: auth, jwtSecret: 'test-secret' });
  await app.ready();
  adminToken = await login('admin', 'geheim');
});

describe('Login & Sichtbarkeit', () => {
  it('Admin sieht alle Klassen', async () => {
    const k = await json('GET', '/api/klassen', adminToken);
    expect(k.status).toBe(200);
    expect(k.body).toHaveLength(2);
  });

  it('ohne Token: 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/klassen' });
    expect(res.statusCode).toBe(401);
  });

  it('falsches Passwort: 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { benutzername: 'admin', passwort: 'falsch' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Eingabemaske', () => {
  it('liefert LF2-Komponentenspalten', async () => {
    const m = await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF2&halbjahr=1`, adminToken);
    expect(m.status).toBe(200);
    expect(m.body.modus).toBe('komponenten_gewichtet');
    expect(m.body.komponenten.map((k: any) => k.schluessel)).toEqual([
      'gesundheit',
      'erziehung',
      'entwicklung',
    ]);
  });
});

describe('Noteneingabe → Berechnung → Zeugnis (End-to-End)', () => {
  it('speichert LF2-Noten und berechnet die Excel-Sollwerte', async () => {
    const maske = (await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF2&halbjahr=1`, adminToken)).body;
    const idVon = (sl: string) => maske.komponenten.find((k: any) => k.schluessel === sl).id;
    const z = golden.lf2_1hj.zeilen[0]!;
    for (const [sl, wert] of [
      ['gesundheit', z.gesundheit],
      ['erziehung', z.erziehung],
      ['entwicklung', z.entwicklung],
    ] as const) {
      const r = await json('PUT', '/api/noten/komponente', adminToken, {
        schuelerId: schueler,
        komponenteId: idVon(sl),
        halbjahr: 1,
        wert,
        istNa: false,
      });
      expect(r.status).toBe(204);
    }
    const fach = (await json('GET', `/api/schueler/${schueler}/fach/LF2`, adminToken)).body;
    const hj1 = fach.find((e: any) => e.halbjahr === 1);
    expect(hj1.endpunkte).toBeCloseTo(z.erwartet_endpunkte, 6);
    expect(hj1.tendenz).toBe(z.erwartet_tendenz);

    const zeugnis = (await json('GET', `/api/zeugnis?klasseId=${piaKlasse}&halbjahr=1`, adminToken)).body;
    const lf2 = zeugnis[0].faecher.find((f: any) => f.fach === 'LF2');
    expect(lf2.tendenz).toBe(z.erwartet_tendenz);
  });

  it('validiert Wertebereich 0–15', async () => {
    const r = await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'LF1', halbjahr: 1, wert: 99, istNa: false,
    });
    expect(r.status).toBe(400);
  });

  it('LF4-Direktnote mit n/a wird im PiA-Schema fortgeschrieben', async () => {
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'LF4', halbjahr: 1, wert: 10, istNa: false,
    });
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'LF4', halbjahr: 2, wert: null, istNa: true,
    });
    const fach = (await json('GET', `/api/schueler/${schueler}/fach/LF4`, adminToken)).body;
    expect(fach.find((e: any) => e.halbjahr === 2).endpunkte).toBe(10);
  });

  it('schreibt den Akteur ins Audit-Log', async () => {
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'DEUTSCH', halbjahr: 1, wert: 11, istNa: false,
    });
    const row = db
      .prepare("SELECT akteur_id FROM audit_log WHERE aktion = 'fachnote_direkt_set' ORDER BY id DESC LIMIT 1")
      .get() as { akteur_id: number };
    expect(row.akteur_id).toBeTypeOf('number');
  });
});

describe('Zeugnis respektiert Bildungsgang (reguläre Praxis nur 2.+3. Hj.)', () => {
  it('Praxis taucht im 1. Hj. einer regulären Klasse nicht auf', async () => {
    erstelleSchueler(db, 'Beispiel', 'Bea', regKlasse);
    const z1 = (await json('GET', `/api/zeugnis?klasseId=${regKlasse}&halbjahr=1`, adminToken)).body;
    expect(z1[0].faecher.map((f: any) => f.fach)).not.toContain('PRAXIS');
    const z2 = (await json('GET', `/api/zeugnis?klasseId=${regKlasse}&halbjahr=2`, adminToken)).body;
    expect(z2[0].faecher.map((f: any) => f.fach)).toContain('PRAXIS');
  });
});

describe('LF3-Komponenten pro Klasse deaktivieren (N4)', () => {
  it('deaktivierte Rest-Komponente verschwindet aus der Maske und wird neu gewichtet', async () => {
    // LF3, 1. Hj.: paedagogik(0.4 fix) + kunst/spiel/musik (Rest = 0.6/3 = 0.2 je)
    const konfig = await json('GET', `/api/klassen/${piaKlasse}/komponenten?fach=LF3`, adminToken);
    expect(konfig.status).toBe(200);
    const musik = konfig.body.find((k: any) => k.halbjahr === 1 && k.schluessel === 'musik');
    expect(musik.aktiv).toBe(true);

    // paedagogik=10, kunst=10, spiel=10, musik=4 → mit Musik:
    //   0.4*10 + 0.2*10 + 0.2*10 + 0.2*4 = 4 + 2 + 2 + 0.8 = 8.8
    const setze = async (sl: string, wert: number) => {
      const id = (await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF3&halbjahr=1`, adminToken)).body
        .komponenten.find((k: any) => k.schluessel === sl).id;
      await json('PUT', '/api/noten/komponente', adminToken, {
        schuelerId: schueler, komponenteId: id, halbjahr: 1, wert, istNa: false,
      });
    };
    await setze('paedagogik', 10);
    await setze('kunst', 10);
    await setze('spiel', 10);
    await setze('musik', 4);
    let lf3 = (await json('GET', `/api/schueler/${schueler}/fach/LF3`, adminToken)).body.find((e: any) => e.halbjahr === 1);
    expect(lf3.endpunkte).toBeCloseTo(8.8, 6);

    // Musik (1. Hj.) deaktivieren → Rest = 0.6/2 = 0.3 je (kunst, spiel):
    //   0.4*10 + 0.3*10 + 0.3*10 = 10
    const r = await json('PUT', `/api/klassen/${piaKlasse}/komponenten`, adminToken, {
      komponenteId: musik.komponenteId, aktiv: false,
    });
    expect(r.status).toBe(204);

    const maske = (await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF3&halbjahr=1`, adminToken)).body;
    expect(maske.komponenten.map((k: any) => k.schluessel)).not.toContain('musik');

    lf3 = (await json('GET', `/api/schueler/${schueler}/fach/LF3`, adminToken)).body.find((e: any) => e.halbjahr === 1);
    expect(lf3.endpunkte).toBeCloseTo(10, 6);
  });

  it('feste Komponente (Pädagogik) ist nicht schaltbar (400)', async () => {
    const maske = (await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF3&halbjahr=1`, adminToken)).body;
    const paed = maske.komponenten.find((k: any) => k.schluessel === 'paedagogik');
    const r = await json('PUT', `/api/klassen/${piaKlasse}/komponenten`, adminToken, {
      komponenteId: paed.id, aktiv: false,
    });
    expect(r.status).toBe(400);
  });
});

describe('Vorwert-Anzeige (#7): zu verrechnender Wert aus Vorhalbjahr/Quelle', () => {
  it('LF1 (50/50): 2. Hj. zeigt die Endnote des 1. Hj. als Vorwert', async () => {
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'LF1', halbjahr: 1, wert: 10, istNa: false,
    });
    const m = await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF1&halbjahr=2`, adminToken);
    expect(m.body.vorwerte.label).toMatch(/1\. Hj/);
    const z = m.body.vorwerte.werte.find((w: any) => w.schuelerId === schueler);
    expect(z.endpunkte).toBe(10);
  });

  it('1. Hj. hat keinen Vorwert (kein Vorhalbjahr)', async () => {
    const m = await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF1&halbjahr=1`, adminToken);
    expect(m.body.vorwerte).toBeUndefined();
  });

  it('Praxis PiA 4. Hj. zeigt Blockpraxis(3.) als Vorwert', async () => {
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'BLOCKPRAXIS', halbjahr: 3, wert: 9, istNa: false,
    });
    const m = await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=PRAXIS&halbjahr=4`, adminToken);
    expect(m.body.vorwerte.label).toMatch(/Blockpraxis/);
    const z = m.body.vorwerte.werte.find((w: any) => w.schuelerId === schueler);
    expect(z.endpunkte).toBe(9);
  });
});

describe('Praxis PiA: nur 2.+4. Hj., 4. Hj. = 0,7·Praxis(4.) + 0,3·Blockpraxis(3.)', () => {
  it('Praxis ist in PiA im 1. und 3. Hj. nicht aktiv, in 2. und 4. schon', async () => {
    const f = async (hj: number) =>
      (await json('GET', `/api/zeugnis?klasseId=${piaKlasse}&halbjahr=${hj}`, adminToken)).body[0]
        .faecher.map((x: any) => x.fach);
    expect(await f(1)).not.toContain('PRAXIS');
    expect(await f(2)).toContain('PRAXIS');
    expect(await f(3)).not.toContain('PRAXIS');
    expect(await f(3)).toContain('BLOCKPRAXIS'); // eigene Zeile im 3. Hj.
    expect(await f(4)).toContain('PRAXIS');
  });

  it('verrechnet Praxis(4.)=15 mit Blockpraxis(3.)=10 zu 13,5', async () => {
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'BLOCKPRAXIS', halbjahr: 3, wert: 10, istNa: false,
    });
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'PRAXIS', halbjahr: 4, wert: 15, istNa: false,
    });
    const praxis = (await json('GET', `/api/schueler/${schueler}/fach/PRAXIS`, adminToken)).body;
    const hj4 = praxis.find((e: any) => e.halbjahr === 4);
    expect(hj4.endpunkte).toBeCloseTo(13.5, 6);
    expect(hj4.zwischennote).toBe(15); // rohe Praxisnote bleibt sichtbar
  });

  it('Praxis(2.) bleibt eigenständig (keine Verrechnung)', async () => {
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'PRAXIS', halbjahr: 2, wert: 8, istNa: false,
    });
    const praxis = (await json('GET', `/api/schueler/${schueler}/fach/PRAXIS`, adminToken)).body;
    expect(praxis.find((e: any) => e.halbjahr === 2).endpunkte).toBe(8);
  });
});
