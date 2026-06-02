import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { baueApp } from '../src/api/app.js';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/seed/seed.js';
import { erstelleKlasse, erstelleSchueler } from '../src/db/stammdaten.js';
import golden from '../../core/test/fixtures/excel_golden.json' assert { type: 'json' };

let db: DB;
let app: FastifyInstance;
let piaKlasse: number;
let regKlasse: number;
let schueler: number;

beforeEach(async () => {
  db = openDb(':memory:');
  migrate(db);
  seed(db);
  piaKlasse = erstelleKlasse(db, 'SPA PiA 1', '2025/26', 'SPA_PIA');
  regKlasse = erstelleKlasse(db, 'SPA A', '2025/26', 'SPA_REGULAR');
  schueler = erstelleSchueler(db, 'Mustermann', 'Max', piaKlasse);
  app = baueApp(db);
  await app.ready();
});

async function json(method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    ...(body ? { payload: body } : {}),
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body || '{}') : null };
}

describe('Stammdaten-Routen', () => {
  it('listet Klassen und Schüler', async () => {
    const k = await json('GET', '/api/klassen');
    expect(k.status).toBe(200);
    expect(k.body).toHaveLength(2);
    const s = await json('GET', `/api/klassen/${piaKlasse}/schueler`);
    expect(s.body).toHaveLength(1);
    expect(s.body[0].name).toBe('Mustermann');
  });
});

describe('Eingabemaske', () => {
  it('liefert LF2-Komponentenspalten', async () => {
    const m = await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF2&halbjahr=1`);
    expect(m.status).toBe(200);
    expect(m.body.modus).toBe('komponenten_gewichtet');
    expect(m.body.komponenten.map((k: any) => k.schluessel)).toEqual([
      'gesundheit',
      'erziehung',
      'entwicklung',
    ]);
    expect(m.body.zeilen).toHaveLength(1);
  });
});

describe('Noteneingabe → Berechnung → Zeugnis (End-to-End)', () => {
  it('speichert LF2-Noten und berechnet die Excel-Sollwerte', async () => {
    // Komponenten-IDs aus der Maske holen.
    const maske = (await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF2&halbjahr=1`)).body;
    const idVon = (sl: string) =>
      maske.komponenten.find((k: any) => k.schluessel === sl).id;

    // Erste Golden-Zeile (7/5/5 → 5,80 → '4+').
    const z = golden.lf2_1hj.zeilen[0]!;
    for (const [sl, wert] of [
      ['gesundheit', z.gesundheit],
      ['erziehung', z.erziehung],
      ['entwicklung', z.entwicklung],
    ] as const) {
      const r = await json('PUT', '/api/noten/komponente', {
        schuelerId: schueler,
        komponenteId: idVon(sl),
        halbjahr: 1,
        wert,
        istNa: false,
      });
      expect(r.status).toBe(204);
    }

    const fach = (await json('GET', `/api/schueler/${schueler}/fach/LF2`)).body;
    const hj1 = fach.find((e: any) => e.halbjahr === 1);
    expect(hj1.endpunkte).toBeCloseTo(z.erwartet_endpunkte, 6);
    expect(hj1.tendenz).toBe(z.erwartet_tendenz);

    // Zeugnisansicht enthält LF2 mit der Tendenz.
    const zeugnis = (await json('GET', `/api/zeugnis?klasseId=${piaKlasse}&halbjahr=1`)).body;
    const lf2 = zeugnis[0].faecher.find((f: any) => f.fach === 'LF2');
    expect(lf2.tendenz).toBe(z.erwartet_tendenz);
  });

  it('validiert Wertebereich 0–15', async () => {
    const r = await json('PUT', '/api/noten/direkt', {
      schuelerId: schueler,
      fach: 'LF1',
      halbjahr: 1,
      wert: 99,
      istNa: false,
    });
    expect(r.status).toBe(400);
  });

  it('LF4-Direktnote mit n/a wird im PiA-Schema fortgeschrieben', async () => {
    await json('PUT', '/api/noten/direkt', {
      schuelerId: schueler, fach: 'LF4', halbjahr: 1, wert: 10, istNa: false,
    });
    await json('PUT', '/api/noten/direkt', {
      schuelerId: schueler, fach: 'LF4', halbjahr: 2, wert: null, istNa: true,
    });
    const fach = (await json('GET', `/api/schueler/${schueler}/fach/LF4`)).body;
    expect(fach.find((e: any) => e.halbjahr === 2).endpunkte).toBe(10);
  });

  it('berechnet eine ganze Klasse und speichert Ergebnisse', async () => {
    await json('PUT', '/api/noten/direkt', {
      schuelerId: schueler, fach: 'DEUTSCH', halbjahr: 1, wert: 11, istNa: false,
    });
    const r = await json('POST', `/api/klassen/${piaKlasse}/berechnung`);
    expect(r.status).toBe(200);
    expect(r.body.gespeicherteErgebnisse).toBeGreaterThan(0);
    const row = db
      .prepare(
        `SELECT tendenz FROM ergebnis e JOIN fach f ON f.id = e.fach_id
          WHERE e.schueler_id = ? AND f.schluessel = 'DEUTSCH' AND e.halbjahr = 1`,
      )
      .get(schueler) as { tendenz: string };
    expect(row.tendenz).toBe('2'); // 11 → '2'
  });
});

describe('Zeugnis respektiert Bildungsgang (reguläre Praxis nur 2.+3. Hj.)', () => {
  it('Praxis taucht im 1. Hj. einer regulären Klasse nicht auf', async () => {
    erstelleSchueler(db, 'Beispiel', 'Bea', regKlasse);
    const z1 = (await json('GET', `/api/zeugnis?klasseId=${regKlasse}&halbjahr=1`)).body;
    const faecher1: string[] = z1[0].faecher.map((f: any) => f.fach);
    expect(faecher1).not.toContain('PRAXIS');
    const z2 = (await json('GET', `/api/zeugnis?klasseId=${regKlasse}&halbjahr=2`)).body;
    const faecher2: string[] = z2[0].faecher.map((f: any) => f.fach);
    expect(faecher2).toContain('PRAXIS');
  });
});
