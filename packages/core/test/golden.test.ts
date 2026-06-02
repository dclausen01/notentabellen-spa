import { describe, expect, it } from 'vitest';
import { berechneFach, type EingabeHalbjahr, type SchemaHalbjahr } from '../src/index.js';
import golden from './fixtures/excel_golden.json' assert { type: 'json' };

/**
 * Golden-Master-Verifikation (Spec Kap. 9): Der Rechenkern muss die in den
 * Original-Excel-Dateien gecachten Ergebnisse exakt reproduzieren.
 */

function wert(v: number | null): number | null {
  return v;
}

describe('Golden-Master LF2 1. Hj. (gewichtet 0.4/0.3/0.3)', () => {
  const schema: SchemaHalbjahr[] = [
    {
      halbjahr: 1,
      aktiv: true,
      halbjahrModus: 'komponenten_gewichtet',
      kumulationModus: 'fortlaufend_50_50',
      deaktivierbar: false,
      komponenten: [
        { schluessel: 'gesundheit', gewichtFix: 0.4 },
        { schluessel: 'erziehung', gewichtFix: 0.3 },
        { schluessel: 'entwicklung', gewichtFix: 0.3 },
      ],
    },
  ];

  for (const z of golden.lf2_1hj.zeilen) {
    it(`Zeile ${z.zeile} → ${z.erwartet_tendenz}`, () => {
      const eingaben: EingabeHalbjahr[] = [
        {
          halbjahr: 1,
          istNa: false,
          komponenten: {
            gesundheit: wert(z.gesundheit),
            erziehung: wert(z.erziehung),
            entwicklung: wert(z.entwicklung),
          },
        },
      ];
      const [r] = berechneFach({ schema, eingaben });
      expect(r.endpunkte).toBeCloseTo(z.erwartet_endpunkte, 6);
      expect(r.tendenz).toBe(z.erwartet_tendenz);
    });
  }
});

describe('Golden-Master LF3 1. Hj. (Päd. fix 0.4, Rest 0.6 gleichmäßig)', () => {
  const schema: SchemaHalbjahr[] = [
    {
      halbjahr: 1,
      aktiv: true,
      halbjahrModus: 'komponenten_gewichtet',
      kumulationModus: 'fortlaufend_50_50',
      deaktivierbar: false,
      komponenten: [
        { schluessel: 'paedagogik', gewichtFix: 0.4 },
        { schluessel: 'kunst', restAnteil: true },
        { schluessel: 'spiel', restAnteil: true },
        { schluessel: 'musik', restAnteil: true },
      ],
    },
  ];

  for (const z of golden.lf3_1hj.zeilen) {
    it(`Zeile ${z.zeile} → ${z.erwartet_tendenz}`, () => {
      const eingaben: EingabeHalbjahr[] = [
        {
          halbjahr: 1,
          istNa: false,
          komponenten: {
            paedagogik: wert(z.paedagogik),
            kunst: wert(z.kunst),
            spiel: wert(z.spiel),
            musik: wert(z.musik),
          },
        },
      ];
      const [r] = berechneFach({ schema, eingaben });
      expect(r.endpunkte).toBeCloseTo(z.erwartet_endpunkte, 6);
      expect(r.tendenz).toBe(z.erwartet_tendenz);
    });
  }
});
