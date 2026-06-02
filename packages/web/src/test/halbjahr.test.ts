import { describe, expect, it } from 'vitest';
import { aktuellesHalbjahr, startJahrAusName } from '../lib/halbjahr.js';

const am = (jahr: number, monat: number) => new Date(jahr, monat - 1, 15);

describe('startJahrAusName', () => {
  it('liest zweistelliges Jahr', () => {
    expect(startJahrAusName('SPA24a')).toBe(2024);
    expect(startJahrAusName('SPA25b')).toBe(2025);
  });
  it('bevorzugt vierstelliges Jahr', () => {
    expect(startJahrAusName('SPA2024')).toBe(2024);
  });
  it('null ohne Jahr', () => {
    expect(startJahrAusName('SPA-PiA')).toBeNull();
  });
});

describe('aktuellesHalbjahr (SPA24a, Start 2024)', () => {
  const f = (j: number, m: number) => aktuellesHalbjahr('SPA24a', am(j, m));
  it('Referenzfall des Anwenders: Januar 2026 → 3. Hj', () => {
    expect(f(2026, 1)).toBe(3);
  });
  it('1. Halbjahr (Aug 2024 – Jan 2025)', () => {
    expect(f(2024, 9)).toBe(1);
    expect(f(2024, 12)).toBe(1);
    expect(f(2025, 1)).toBe(1);
  });
  it('2. Halbjahr (Feb – Jul 2025)', () => {
    expect(f(2025, 2)).toBe(2);
    expect(f(2025, 6)).toBe(2);
  });
  it('3. Halbjahr (Aug 2025 – Jan 2026)', () => {
    expect(f(2025, 9)).toBe(3);
    expect(f(2026, 1)).toBe(3);
  });
  it('4. Halbjahr (Feb – Jul 2026)', () => {
    expect(f(2026, 3)).toBe(4);
    expect(f(2026, 7)).toBe(4);
  });
  it('außerhalb der Laufzeit → null', () => {
    expect(f(2024, 6)).toBeNull(); // vor Start
    expect(f(2026, 9)).toBeNull(); // nach Ende
  });
});

describe('aktuellesHalbjahr (SPA25a, Start 2025)', () => {
  it('Januar 2026 → 1. Hj', () => {
    expect(aktuellesHalbjahr('SPA25a', am(2026, 1))).toBe(1);
  });
  it('März 2026 → 2. Hj', () => {
    expect(aktuellesHalbjahr('SPA25a', am(2026, 3))).toBe(2);
  });
});
