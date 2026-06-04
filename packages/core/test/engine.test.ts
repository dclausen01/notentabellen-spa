import { describe, expect, it } from 'vitest';
import {
  berechneFach,
  berechneZwischennote,
  kaufmaennischRunden,
  type EingabeHalbjahr,
  type SchemaHalbjahr,
} from '../src/index.js';

const direkt = (
  halbjahr: 1 | 2 | 3 | 4,
  kumulationModus: SchemaHalbjahr['kumulationModus'],
  extra: Partial<SchemaHalbjahr> = {},
): SchemaHalbjahr => ({
  halbjahr,
  aktiv: true,
  halbjahrModus: 'direkt',
  kumulationModus,
  deaktivierbar: false,
  komponenten: [],
  ...extra,
});

describe('Kumulation fortlaufend 50/50 (Spec 5.4, durchgerechnetes LF2-Beispiel)', () => {
  it('5,80 / 9,00 / 11,00 / 12,00 → Endpunkte 5,80 / 7,40 / 9,20 / 10,60', () => {
    const schema: SchemaHalbjahr[] = [1, 2, 3, 4].map((h) =>
      direkt(h as 1 | 2 | 3 | 4, 'fortlaufend_50_50'),
    );
    const zw = [5.8, 9.0, 11.0, 12.0];
    const eingaben: EingabeHalbjahr[] = zw.map((v, i) => ({
      halbjahr: (i + 1) as 1 | 2 | 3 | 4,
      istNa: false,
      direktwert: v,
    }));
    const r = berechneFach({ schema, eingaben });
    expect(r.map((x) => x.endpunkte)).toEqual([5.8, 7.4, 9.2, 10.6]);
    expect(r.map((x) => x.tendenz)).toEqual(['4+', '3-', '3+', '2']);
  });
});

describe('LF3-Restverteilung 60 % / (Anzahl aktiver Rest-Komponenten)', () => {
  const komponenten = [
    { schluessel: 'paed', gewichtFix: 0.4 },
    { schluessel: 'kunst', restAnteil: true },
    { schluessel: 'spiel', restAnteil: true },
    { schluessel: 'musik', restAnteil: true },
  ];
  const schema: SchemaHalbjahr = {
    halbjahr: 1,
    aktiv: true,
    halbjahrModus: 'komponenten_gewichtet',
    kumulationModus: 'keine',
    deaktivierbar: false,
    komponenten,
  };

  it('3 aktive Rest-Komponenten → je 0,2 (Excel-Fall)', () => {
    // 0.4*7 + 0.2*(8+4+9) = 2.8 + 4.2 = 7.0
    const zw = berechneZwischennote(schema, {
      halbjahr: 1,
      istNa: false,
      komponenten: { paed: 7, kunst: 8, spiel: 4, musik: 9 },
    });
    expect(zw).toBeCloseTo(7.0, 10);
  });

  it('eine Rest-Komponente n/a → Restbudget 0,6 auf 2 → je 0,3', () => {
    // 0.4*10 + 0.3*(10+10) = 4 + 6 = 10
    const zw = berechneZwischennote(schema, {
      halbjahr: 1,
      istNa: false,
      komponenten: { paed: 10, kunst: 10, spiel: 10, musik: null },
    });
    expect(zw).toBeCloseTo(10.0, 10);
  });

  it('feste Komponente (Päd.) selbst n/a → Restbudget = 1,0 auf 3 → je 1/3', () => {
    // (10+10+10)/3 = 10
    const zw = berechneZwischennote(schema, {
      halbjahr: 1,
      istNa: false,
      komponenten: { paed: null, kunst: 10, spiel: 10, musik: 10 },
    });
    expect(zw).toBeCloseTo(10.0, 10);
  });

  it('zwei feste Komponenten (Päd. 0,2 + Bericht 0,2), Bericht n/a → Rest 0,8 auf 4', () => {
    const s2: SchemaHalbjahr = {
      halbjahr: 2,
      aktiv: true,
      halbjahrModus: 'komponenten_gewichtet',
      kumulationModus: 'keine',
      deaktivierbar: false,
      komponenten: [
        { schluessel: 'paed', gewichtFix: 0.2 },
        { schluessel: 'bericht', gewichtFix: 0.2 },
        { schluessel: 'bewegung', restAnteil: true },
        { schluessel: 'spiel', restAnteil: true },
        { schluessel: 'kunst', restAnteil: true },
        { schluessel: 'musik', restAnteil: true },
      ],
    };
    // 0.2*10 + Rest 0.8/4=0.2 auf 4 Komp. à 10 = 2 + 8 = 10
    const zw = berechneZwischennote(s2, {
      halbjahr: 2,
      istNa: false,
      komponenten: { paed: 10, bericht: null, bewegung: 10, spiel: 10, kunst: 10, musik: 10 },
    });
    expect(zw).toBeCloseTo(10.0, 10);
  });
});

describe('LF4: deaktivierbar, Fortschreibung über n/a-Halbjahre', () => {
  it('n/a-Halbjahre schreiben den Vorwert unverändert fort', () => {
    const schema: SchemaHalbjahr[] = [1, 2, 3, 4].map((h) =>
      direkt(h as 1 | 2 | 3 | 4, 'fortlaufend_50_50', { deaktivierbar: true }),
    );
    const eingaben: EingabeHalbjahr[] = [
      { halbjahr: 1, istNa: false, direktwert: 10 },
      { halbjahr: 2, istNa: true },
      { halbjahr: 3, istNa: false, direktwert: 14 },
      { halbjahr: 4, istNa: true },
    ];
    const r = berechneFach({ schema, eingaben });
    expect(r[0]!.endpunkte).toBe(10); // Start
    expect(r[1]!.endpunkte).toBe(10); // n/a → Vorwert
    expect(r[1]!.zwischennote).toBeNull();
    expect(r[2]!.endpunkte).toBe(12); // 0,5*10 + 0,5*14
    expect(r[3]!.endpunkte).toBe(12); // n/a → Vorwert
    expect(r[3]!.tendenz).toBe('2+'); // round(12) → 2+
  });
});

describe('Praxis-Endnote PiA (externer Modus): 0,7·Praxis(4.) + 0,3·Blockpraxis(3.)', () => {
  const praxis4 = direkt(4, 'gewichtet_vorgaenger', { gewichtAktuell: 0.7, gewichtExtern: 0.3 });

  it('verrechnet die aktuelle Praxisnote mit dem externen Blockpraxis-Wert', () => {
    const eingaben: EingabeHalbjahr[] = [
      // Praxis 4. Hj. = 15, Blockpraxis 3. Hj. (extern) = 10 → 0,7·15 + 0,3·10 = 13,5
      { halbjahr: 4, istNa: false, direktwert: 15, externerWert: 10 },
    ];
    const r = berechneFach({ schema: [praxis4], eingaben });
    const hj4 = r.find((x) => x.halbjahr === 4)!;
    expect(hj4.endpunkte).toBeCloseTo(13.5, 10);
    // Zwischennote bleibt die rohe Praxisnote (für die Orientierung)
    expect(hj4.zwischennote).toBe(15);
  });

  it('ohne externen Wert zählt nur die aktuelle Praxisnote (keine Herabskalierung)', () => {
    const r = berechneFach({
      schema: [praxis4],
      eingaben: [{ halbjahr: 4, istNa: false, direktwert: 12, externerWert: null }],
    });
    expect(r.find((x) => x.halbjahr === 4)!.endpunkte).toBe(12);
  });
});

describe('WPK (mittelwert_halbjahre = Ø 1. + 2. Hj.)', () => {
  it('Mittelwert der beiden Halbjahresnoten', () => {
    const schema: SchemaHalbjahr[] = [
      direkt(1, 'keine'),
      direkt(2, 'mittelwert_halbjahre', { mittelwertHalbjahre: [1, 2] }),
    ];
    const eingaben: EingabeHalbjahr[] = [
      { halbjahr: 1, istNa: false, direktwert: 9 },
      { halbjahr: 2, istNa: false, direktwert: 7 },
    ];
    const r = berechneFach({ schema, eingaben });
    const hj2 = r.find((x) => x.halbjahr === 2)!;
    expect(hj2.endpunkte).toBeCloseTo(8, 10); // (9+7)/2
    expect(hj2.tendenz).toBe('3'); // round(8) → 3
  });
});

describe('Praxis regulär: zwei separate Noten, keine Verrechnung', () => {
  it('2. und 3. Hj. bleiben eigenständig (kumulation keine)', () => {
    const schema: SchemaHalbjahr[] = [
      { ...direkt(2, 'keine') },
      { ...direkt(3, 'keine') },
    ];
    const eingaben: EingabeHalbjahr[] = [
      { halbjahr: 2, istNa: false, direktwert: 11 },
      { halbjahr: 3, istNa: false, direktwert: 8 },
    ];
    const r = berechneFach({ schema, eingaben });
    expect(r.map((x) => x.endpunkte)).toEqual([11, 8]);
    expect(r.map((x) => x.tendenz)).toEqual(['2', '3']);
  });
});

describe('Inaktive Halbjahre liefern kein Ergebnis', () => {
  it('Praxis regulär ist im 1. und 4. Hj. nicht aktiv', () => {
    const schema: SchemaHalbjahr[] = [
      { ...direkt(1, 'keine'), aktiv: false },
      direkt(2, 'keine'),
      direkt(3, 'keine'),
      { ...direkt(4, 'keine'), aktiv: false },
    ];
    const eingaben: EingabeHalbjahr[] = [
      { halbjahr: 2, istNa: false, direktwert: 10 },
      { halbjahr: 3, istNa: false, direktwert: 12 },
    ];
    const r = berechneFach({ schema, eingaben });
    expect(r.map((x) => x.halbjahr)).toEqual([2, 3]);
  });
});

describe('Kaufmännische Rundung', () => {
  it('x,5 wird aufgerundet', () => {
    expect(kaufmaennischRunden(9.5)).toBe(10);
    expect(kaufmaennischRunden(5.5)).toBe(6);
    expect(kaufmaennischRunden(5.4)).toBe(5);
  });
});

describe('Übernommene Endnote (Import historischer Noten)', () => {
  it('überschreibt die Berechnung und liefert exakt den Importwert', () => {
    const schema: SchemaHalbjahr[] = [1, 2, 3, 4].map((h) =>
      direkt(h as 1 | 2 | 3 | 4, 'fortlaufend_50_50'),
    );
    // Direktwerte vorhanden, aber importierte Endnote hat Vorrang.
    const eingaben: EingabeHalbjahr[] = [1, 2, 3, 4].map((h) => ({
      halbjahr: h as 1 | 2 | 3 | 4,
      istNa: false,
      direktwert: 15,
      importierteEndnote: { 1: 7.4, 2: 8.3, 3: 8.35, 4: 6.875 }[h]!,
    }));
    const r = berechneFach({ schema, eingaben });
    expect(r.map((x) => x.endpunkte)).toEqual([7.4, 8.3, 8.35, 6.875]);
    expect(r.map((x) => x.tendenz)).toEqual(['3-', '3', '3', '3-']);
  });

  it('dient als Vorgängerwert für die 50/50-Kumulation des Folgehalbjahres', () => {
    const schema: SchemaHalbjahr[] = [1, 2, 3, 4].map((h) =>
      direkt(h as 1 | 2 | 3 | 4, 'fortlaufend_50_50'),
    );
    // Hj1-3 importiert (8,35 zuletzt), Hj4 als echte Halbjahresleistung 5,4.
    const eingaben: EingabeHalbjahr[] = [
      { halbjahr: 1, istNa: false, importierteEndnote: 7.4 },
      { halbjahr: 2, istNa: false, importierteEndnote: 8.3 },
      { halbjahr: 3, istNa: false, importierteEndnote: 8.35 },
      { halbjahr: 4, istNa: false, direktwert: 5.4 },
    ];
    const r = berechneFach({ schema, eingaben });
    // 0,5·8,35 + 0,5·5,4 = 6,875
    expect(r.find((x) => x.halbjahr === 4)!.endpunkte).toBeCloseTo(6.875, 9);
  });
});
