import type { Notenskala } from './types.js';

/**
 * Zentrale Notenskala (Spec Kap. 6.4): Punkte 0–15 → Schulnote.
 * Heute mehrfach redundant in den Excel-Dateien — künftig genau einmal hier.
 */
export const STANDARD_NOTENSKALA: Notenskala = new Map<number, string>([
  [15, '1+'],
  [14, '1'],
  [13, '1-'],
  [12, '2+'],
  [11, '2'],
  [10, '2-'],
  [9, '3+'],
  [8, '3'],
  [7, '3-'],
  [6, '4+'],
  [5, '4'],
  [4, '4-'],
  [3, '5+'],
  [2, '5'],
  [1, '5-'],
  [0, '6'],
]);

/** „Keine Note" / nicht belegt. */
export const KEINE_NOTE = '-';

/**
 * Kaufmännische Rundung (round half away from zero). Für die hier auftretenden
 * nicht-negativen Punktwerte (0–15) identisch zu Excels ROUND(x, 0).
 */
export function kaufmaennischRunden(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Endpunkte (ungerundet) → Tendenznote über die Notenskala. */
export function tendenzAusEndpunkten(
  endpunkte: number | null,
  skala: Notenskala,
): string | null {
  if (endpunkte === null) return null;
  const punkte = kaufmaennischRunden(endpunkte);
  return skala.get(punkte) ?? KEINE_NOTE;
}
