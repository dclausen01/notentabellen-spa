/**
 * Ermittelt das aktuell laufende Halbjahr (1–4) einer SPA-Klasse anhand des
 * Startjahres im Klassennamen und des aktuellen Datums.
 *
 * Annahmen (mit der Schule abgestimmt):
 * - Der Klassenname enthält das Startjahr (zweistellig, z. B. „SPA24a" → 2024,
 *   oder vierstellig „SPA2024"). Programmstart ist im August dieses Jahres.
 * - Ein Schuljahr läuft August–Juli. Das Winter-Halbjahr umfasst Aug–Jan,
 *   das Sommer-Halbjahr Feb–Jul (Halbjahreswechsel Januar bzw. Juni/Juli).
 *
 * Liegt das Ergebnis außerhalb 1–4 (Klasse noch nicht gestartet oder schon
 * fertig) oder lässt sich kein Startjahr lesen, wird `null` zurückgegeben.
 */
export function aktuellesHalbjahr(klassenname: string, jetzt: Date = new Date()): number | null {
  const startJahr = startJahrAusName(klassenname);
  if (startJahr == null) return null;

  const jahr = jetzt.getFullYear();
  const monat = jetzt.getMonth() + 1; // 1–12

  // Schuljahr S: Aug S .. Jul S+1. Winter-Hj (Aug–Jan) = Index 0, Sommer (Feb–Jul) = 1.
  let schuljahr: number;
  let teil: 0 | 1;
  if (monat >= 8) {
    schuljahr = jahr;
    teil = 0;
  } else if (monat === 1) {
    schuljahr = jahr - 1;
    teil = 0;
  } else {
    schuljahr = jahr - 1;
    teil = 1;
  }

  const hj = (schuljahr - startJahr) * 2 + teil + 1;
  return hj >= 1 && hj <= 4 ? hj : null;
}

/** Liest das Startjahr aus dem Klassennamen (vierstellig bevorzugt, sonst 20XX). */
export function startJahrAusName(name: string): number | null {
  const vier = name.match(/(20\d{2})/);
  if (vier) return Number(vier[1]);
  const zwei = name.match(/(\d{2})/);
  if (zwei) return 2000 + Number(zwei[1]);
  return null;
}
