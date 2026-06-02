import { berechneFach, type EingabeHalbjahr } from '@notentabellen/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { ladeSchema } from '../src/db/lade-schema.js';
import { seed } from '../src/seed/seed.js';
import golden from '../../core/test/fixtures/excel_golden.json' assert { type: 'json' };

let db: DB;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  seed(db);
});

describe('Migration & Seed', () => {
  it('legt beide Bildungsgänge und alle Fächer an', () => {
    const bg = db.prepare('SELECT schluessel FROM bildungsgang ORDER BY schluessel').all();
    expect(bg.map((r: any) => r.schluessel)).toEqual(['SPA_PIA', 'SPA_REGULAR']);
    const faecher = db.prepare('SELECT COUNT(*) AS n FROM fach').get() as { n: number };
    expect(faecher.n).toBe(12);
  });

  it('ist idempotent (zweiter Seed-Lauf ändert die Anzahl nicht)', () => {
    const vorher = (db.prepare('SELECT COUNT(*) AS n FROM bewertungsschema').get() as { n: number }).n;
    seed(db);
    const nachher = (db.prepare('SELECT COUNT(*) AS n FROM bewertungsschema').get() as { n: number }).n;
    expect(nachher).toBe(vorher);
  });

  it('füllt die Notenskala mit 16 Einträgen', () => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM notenskala').get() as { n: number }).n;
    expect(n).toBe(16);
  });
});

describe('Bildungsgang-Differenzierung in der Konfiguration', () => {
  it('LF4 ist nur bei PiA abschaltbar', () => {
    const pia = ladeSchema(db, 'LF4', 'SPA_PIA');
    const reg = ladeSchema(db, 'LF4', 'SPA_REGULAR');
    expect(pia.every((s) => s.deaktivierbar)).toBe(true);
    expect(reg.every((s) => !s.deaktivierbar)).toBe(true);
  });

  it('Praxis regulär nur in 2. und 3. Hj. aktiv, ohne Verrechnung', () => {
    const reg = ladeSchema(db, 'PRAXIS', 'SPA_REGULAR');
    const aktive = reg.filter((s) => s.aktiv).map((s) => s.halbjahr);
    expect(aktive).toEqual([2, 3]);
    expect(reg.filter((s) => s.aktiv).every((s) => s.kumulationModus === 'keine')).toBe(true);
  });

  it('Praxis PiA: 4. Hj. nutzt gewichtet_vorgaenger, Blockpraxis nur PiA/3. Hj.', () => {
    const pia = ladeSchema(db, 'PRAXIS', 'SPA_PIA');
    expect(pia.find((s) => s.halbjahr === 4)!.kumulationModus).toBe('gewichtet_vorgaenger');
    const blockReg = ladeSchema(db, 'BLOCKPRAXIS', 'SPA_REGULAR');
    const blockPia = ladeSchema(db, 'BLOCKPRAXIS', 'SPA_PIA');
    expect(blockReg.length).toBe(0);
    expect(blockPia.filter((s) => s.aktiv).map((s) => s.halbjahr)).toEqual([3]);
  });
});

describe('DB-Konfiguration treibt den Rechenkern (Golden-Master über die DB)', () => {
  it('LF2 1. Hj. liefert mit DB-Schema die Excel-Sollwerte', () => {
    const schema = ladeSchema(db, 'LF2', 'SPA_PIA');
    for (const z of golden.lf2_1hj.zeilen) {
      const eingaben: EingabeHalbjahr[] = [
        {
          halbjahr: 1,
          istNa: false,
          komponenten: {
            gesundheit: z.gesundheit,
            erziehung: z.erziehung,
            entwicklung: z.entwicklung,
          },
        },
      ];
      const [r] = berechneFach({ schema, eingaben });
      expect(r!.endpunkte).toBeCloseTo(z.erwartet_endpunkte, 6);
      expect(r!.tendenz).toBe(z.erwartet_tendenz);
    }
  });

  it('LF3 1. Hj. liefert mit DB-Schema die Excel-Sollwerte', () => {
    const schema = ladeSchema(db, 'LF3', 'SPA_PIA');
    for (const z of golden.lf3_1hj.zeilen) {
      const eingaben: EingabeHalbjahr[] = [
        {
          halbjahr: 1,
          istNa: false,
          komponenten: {
            paedagogik: z.paedagogik,
            kunst: z.kunst,
            spiel: z.spiel,
            musik: z.musik,
          },
        },
      ];
      const [r] = berechneFach({ schema, eingaben });
      expect(r!.endpunkte).toBeCloseTo(z.erwartet_endpunkte, 6);
      expect(r!.tendenz).toBe(z.erwartet_tendenz);
    }
  });
});
