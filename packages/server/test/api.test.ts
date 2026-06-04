import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { baueApp } from '../src/api/app.js';
import { FakeAuthenticator } from '../src/auth/authenticator.js';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/seed/seed.js';
import { speichereImportierteEndnote } from '../src/db/noten.js';
import { fachId } from '../src/db/lade-eingaben.js';
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
    // 4. Hj. = Abschlusszeugnis: alle Fächer mit Endnote-Positionen (Praxis 2.+4. Hj.).
    const hj4 = await f(4);
    expect(hj4).toContain('PRAXIS:2');
    expect(hj4).toContain('PRAXIS:4');
    expect(hj4).toContain('BLOCKPRAXIS:3');
    expect(hj4).toContain('WPK:2');
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

describe('Prüfungsnoten (4. Hj.)', () => {
  it('Englisch-FHR: Endnote = 0,6·Vornote + 0,4·Prüfung; ohne Prüfung nur Vornote', async () => {
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: schueler, fach: 'ENGLISCH', halbjahr: 4, wert: 10, istNa: false,
    });
    const ohne = (await json('GET', `/api/schueler/${schueler}/fach/ENGLISCH`, adminToken)).body;
    expect(ohne.find((e: any) => e.halbjahr === 4).endpunkte).toBe(10);

    const r = await json('PUT', '/api/noten/pruefung', adminToken, {
      schuelerId: schueler, fach: 'ENGLISCH', halbjahr: 4, wert: 5, istNa: false,
    });
    expect(r.status).toBe(204);
    const mit = (await json('GET', `/api/schueler/${schueler}/fach/ENGLISCH`, adminToken)).body;
    expect(mit.find((e: any) => e.halbjahr === 4).endpunkte).toBeCloseTo(8, 6);
  });

  it('LF2-Prüfung wird gespeichert/angezeigt, ändert aber die LF2-Endnote nicht', async () => {
    await json('PUT', '/api/noten/komponente', adminToken, {
      schuelerId: schueler,
      komponenteId: lf2KompId('gesundheit', 4, piaKlasse),
      halbjahr: 4, wert: 12, istNa: false,
    });
    const vorher = (await json('GET', `/api/schueler/${schueler}/fach/LF2`, adminToken)).body
      .find((e: any) => e.halbjahr === 4).endpunkte;
    await json('PUT', '/api/noten/pruefung', adminToken, {
      schuelerId: schueler, fach: 'LF2', halbjahr: 4, wert: 3, istNa: false,
    });
    const nachher = (await json('GET', `/api/schueler/${schueler}/fach/LF2`, adminToken)).body
      .find((e: any) => e.halbjahr === 4).endpunkte;
    expect(nachher).toBe(vorher);

    // Prüfungsblock im Abschlusszeugnis
    const z = (await json('GET', `/api/zeugnis?klasseId=${piaKlasse}&halbjahr=4`, adminToken)).body[0];
    const labels = z.pruefungen.map((p: any) => p.label);
    expect(labels).toContain('Lernfeld 2 (Prüfung)');
    expect(labels).toContain('Englisch-FHR');
    const lf2Pr = z.pruefungen.find((p: any) => p.label === 'Lernfeld 2 (Prüfung)');
    expect(lf2Pr.endpunkte).toBe(3);
  });

  it('Prüfung ist nur erlaubt, wo das Schema sie vorsieht (z. B. nicht WiPo)', async () => {
    const r = await json('PUT', '/api/noten/pruefung', adminToken, {
      schuelerId: schueler, fach: 'WIPO', halbjahr: 4, wert: 5, istNa: false,
    });
    expect(r.status).toBe(400);
  });

  // Maske im 4. Hj. trägt die Prüfungsspalte
  it('Eingabemaske LF3 4. Hj. signalisiert eine Prüfungsspalte', async () => {
    const m = (await json('GET', `/api/eingabe?klasseId=${piaKlasse}&fach=LF3&halbjahr=4`, adminToken)).body;
    expect(m.pruefung).toBe(true);
  });
});

describe('Noten-Import (historisch, CSV)', () => {
  const csv = (zeilen: string[]) =>
    'nachname;vorname;klasse;fach;halbjahr;typ;wert\n' + zeilen.join('\n') + '\n';

  it('Probelauf (commit=false) schreibt nichts, meldet aber die geplanten Zeilen', async () => {
    erstelleSchueler(db, 'Probe', 'Pia', regKlasse);
    const body = {
      commit: false,
      csv: csv([
        'Probe;Pia;SPA A;LF2;1;endnote;7,4',
        'Probe;Pia;SPA A;DEUTSCH;1;direkt;9',
      ]),
    };
    const r = await json('POST', '/api/admin/import/noten', adminToken, body);
    expect(r.body.geplant).toBe(2);
    expect(r.body.fehler).toBe(0);
    expect(r.body.geschrieben).toBe(false);
    // Nichts geschrieben:
    const sid = (db.prepare("SELECT id FROM schueler WHERE name='Probe'").get() as { id: number }).id;
    const erg = (await json('GET', `/api/schueler/${sid}/fach/LF2`, adminToken)).body;
    expect(erg.find((e: any) => e.halbjahr === 1).endpunkte).toBeNull();
  });

  it('Übernahme (commit=true) schreibt Endnote, Direkt- und Prüfungsnote', async () => {
    erstelleSchueler(db, 'Probe', 'Pia', regKlasse);
    const r = await json('POST', '/api/admin/import/noten', adminToken, {
      commit: true,
      csv: csv([
        'Probe;Pia;SPA A;LF2;1;endnote;7,4',
        'Probe;Pia;SPA A;DEUTSCH;1;direkt;9',
        'Probe;Pia;SPA A;LF2;4;pruefung;12',
      ]),
    });
    expect(r.body.geschrieben).toBe(true);
    expect(r.body.geplant).toBe(3);
    const sid = (db.prepare("SELECT id FROM schueler WHERE name='Probe'").get() as { id: number }).id;
    const lf2 = (await json('GET', `/api/schueler/${sid}/fach/LF2`, adminToken)).body;
    expect(lf2.find((e: any) => e.halbjahr === 1).endpunkte).toBe(7.4);
    const deu = (await json('GET', `/api/schueler/${sid}/fach/DEUTSCH`, adminToken)).body;
    expect(deu.find((e: any) => e.halbjahr === 1).endpunkte).toBe(9);
  });

  it('WPK: Kurs-Titel-Import legt Kurs an und weist die Zeugnisnote als Komma-Note aus', async () => {
    erstelleSchueler(db, 'Wahl', 'Wim', regKlasse);
    const r = await json('POST', '/api/admin/import/noten', adminToken, {
      commit: true,
      csv: csv([
        'Wahl;Wim;SPA A;WPK;1;direkt;11',
        'Wahl;Wim;SPA A;WPK;2;direkt;11',
        'Wahl;Wim;SPA A;WPK;1;wpk_kurs;Tierpädagogik',
        'Wahl;Wim;SPA A;WPK;2;wpk_kurs;U3-Kurs',
      ]),
    });
    expect(r.body.geschrieben).toBe(true);
    expect(r.body.proTyp.wpk_kurs).toBe(2);
    // Kurs angelegt + zugeordnet
    const kurse = (await json('GET', '/api/admin/wpk-kurse', adminToken)).body;
    expect(kurse.map((k: any) => k.name)).toContain('Tierpädagogik');
    // Zeugnis (2. Hj.): WPK-Ø 11 Punkte → Note 2 → „2,0"
    const z = (await json('GET', `/api/zeugnis?klasseId=${regKlasse}&halbjahr=2`, adminToken)).body
      .find((zz: any) => zz.name === 'Wahl');
    const wpk = z.faecher.find((f: any) => f.fach === 'WPK');
    expect(wpk.tendenz).toBe('2,0');
  });

  it('Abschlusszeugnis zieht die letzte Note „hochgezogen" ins 4. Hj. (z. B. WiPo aus dem 2. Hj.)', async () => {
    const sid = erstelleSchueler(db, 'Hoch', 'Heidi', regKlasse);
    // WiPo nur im 2. Hj. benotet (kumulation 'keine' → im 4. Hj. sonst leer).
    await json('PUT', '/api/noten/direkt', adminToken, {
      schuelerId: sid, fach: 'WIPO', halbjahr: 2, wert: 10, istNa: false,
    });
    const z = (await json('GET', `/api/zeugnis?klasseId=${regKlasse}&halbjahr=4`, adminToken)).body
      .find((zz: any) => zz.name === 'Hoch');
    const wipo = z.faecher.find((f: any) => f.fach === 'WIPO:4');
    expect(wipo.endpunkte).toBe(10);
    expect(wipo.tendenz).toBe('2-');
  });

  it('meldet Fehler: unbekannte Klasse/Schüler, Direktnote auf komponentenbasiertem Fach', async () => {
    erstelleSchueler(db, 'Probe', 'Pia', regKlasse);
    const r = await json('POST', '/api/admin/import/noten', adminToken, {
      commit: true,
      csv: csv([
        'Niemand;Nina;SPA A;LF1;1;direkt;9', // Schüler fehlt
        'Probe;Pia;LF2;LF2;1;direkt;9', // Klasse "LF2" gibt es nicht
        'Probe;Pia;SPA A;LF2;1;direkt;9', // LF2 ist komponentenbasiert -> direkt verboten
      ]),
    });
    expect(r.body.fehler).toBe(3);
    expect(r.body.geplant).toBe(0);
    expect(r.body.schuelerFehlend).toContain('Niemand, Nina (SPA A)');
  });
});

describe('Übernommene Endnote (Import historischer Noten)', () => {
  it('LF2-Override wird 1:1 angezeigt und seedet die Folge-Kumulation', async () => {
    const lf2 = fachId(db, 'LF2');
    // SPA24a-Werte (Abeler): Hj1-3 importiert.
    for (const [hj, wert] of [[1, 7.4], [2, 8.3], [3, 8.35]] as const) {
      speichereImportierteEndnote(db, { schuelerId: schueler, fachId: lf2, halbjahr: hj, wert });
    }
    const erg = (await json('GET', `/api/schueler/${schueler}/fach/LF2`, adminToken)).body;
    expect(erg.find((e: any) => e.halbjahr === 1).endpunkte).toBe(7.4);
    expect(erg.find((e: any) => e.halbjahr === 1).tendenz).toBe('3-');
    expect(erg.find((e: any) => e.halbjahr === 3).endpunkte).toBe(8.35);

    // Hj4 als echte Teilnoten (Gesundheit leer) → Kumulation 0,5·8,35 + 0,5·5,4.
    await json('PUT', '/api/noten/komponente', adminToken, {
      schuelerId: schueler, komponenteId: lf2KompId('erziehung', 4, piaKlasse), halbjahr: 4, wert: 9, istNa: false,
    });
    await json('PUT', '/api/noten/komponente', adminToken, {
      schuelerId: schueler, komponenteId: lf2KompId('entwicklung', 4, piaKlasse), halbjahr: 4, wert: 9, istNa: false,
    });
    const erg2 = (await json('GET', `/api/schueler/${schueler}/fach/LF2`, adminToken)).body;
    expect(erg2.find((e: any) => e.halbjahr === 4).endpunkte).toBeCloseTo(6.875, 6);
  });
});

function lf2KompId(schluessel: string, halbjahr: number, klasseId: number): number {
  return (
    db
      .prepare(
        `SELECT k.id FROM komponente k
           JOIN bewertungsschema bs ON bs.id = k.schema_id
           JOIN fach f ON f.id = bs.fach_id
          WHERE f.schluessel = 'LF2' AND k.schluessel = ? AND bs.halbjahr = ?
            AND bs.bildungsgang_id = (SELECT bildungsgang_id FROM klasse WHERE id = ?)`,
      )
      .get(schluessel, halbjahr, klasseId) as { id: number }
  ).id;
}
