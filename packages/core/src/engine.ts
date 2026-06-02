import type {
  EingabeHalbjahr,
  ErgebnisHalbjahr,
  FachBerechnungInput,
  Halbjahr,
  Notenskala,
  SchemaHalbjahr,
} from './types.js';
import { STANDARD_NOTENSKALA, tendenzAusEndpunkten } from './notenskala.js';

const HALBJAHRE: readonly Halbjahr[] = [1, 2, 3, 4];

/**
 * Zwischennote eines Halbjahres (Spec 5.1).
 *
 * - `direkt`: der eingetragene Punktwert.
 * - `komponenten_gewichtet`: Σ(Gewicht_i · Punkte_i) über die belegten
 *   (nicht-n/a-) Komponenten. Feste Gewichte werden direkt übernommen; das
 *   Restbudget (1 − Σ feste Gewichte aktiver Komponenten) wird gleichmäßig auf
 *   die aktiven Restanteil-Komponenten verteilt.
 *
 * Gibt `null` zurück, wenn keine belegte Komponente / kein Wert vorliegt.
 */
export function berechneZwischennote(
  schema: SchemaHalbjahr,
  eingabe: EingabeHalbjahr | undefined,
): number | null {
  if (!schema.aktiv) return null;
  if (eingabe?.istNa) return null;

  if (schema.halbjahrModus === 'direkt') {
    const wert = eingabe?.direktwert;
    return wert === null || wert === undefined ? null : wert;
  }

  // komponenten_gewichtet
  const werte = eingabe?.komponenten ?? {};
  const aktive = schema.komponenten.filter((k) => {
    const w = werte[k.schluessel];
    return w !== null && w !== undefined;
  });
  if (aktive.length === 0) return null;

  const festeSumme = aktive.reduce((s, k) => s + (k.gewichtFix ?? 0), 0);
  const restKomponenten = aktive.filter((k) => k.restAnteil);
  const restBudget = Math.max(0, 1 - festeSumme);
  const restGewicht =
    restKomponenten.length > 0 ? restBudget / restKomponenten.length : 0;

  let summe = 0;
  for (const k of aktive) {
    const gewicht = k.gewichtFix ?? (k.restAnteil ? restGewicht : 0);
    summe += gewicht * (werte[k.schluessel] as number);
  }
  return summe;
}

function schemaFuer(
  schema: SchemaHalbjahr[],
  hj: Halbjahr,
): SchemaHalbjahr | undefined {
  return schema.find((s) => s.halbjahr === hj);
}

/**
 * Berechnet ein Fach über alle Halbjahre (Spec 5.2 / 5.3).
 *
 * Es wird durchgängig mit ungerundeten Endpunkten kumuliert; gerundet wird
 * ausschließlich für die Tendenznote. Inaktive Halbjahre liefern kein Ergebnis.
 */
export function berechneFach(input: FachBerechnungInput): ErgebnisHalbjahr[] {
  const skala: Notenskala = input.notenskala ?? STANDARD_NOTENSKALA;
  const eingabeFuer = (hj: Halbjahr) =>
    input.eingaben.find((e) => e.halbjahr === hj);

  // 1. Pass: Zwischennoten je Halbjahr.
  const zwischen = new Map<Halbjahr, number | null>();
  for (const hj of HALBJAHRE) {
    const s = schemaFuer(input.schema, hj);
    zwischen.set(hj, s ? berechneZwischennote(s, eingabeFuer(hj)) : null);
  }

  // 2. Pass: Kumulation → Endpunkte.
  const ergebnisse: ErgebnisHalbjahr[] = [];
  let vorigeEndpunkte: number | null = null; // letzte aktive Endpunkte (für 50/50, n/a-Carry)

  for (const hj of HALBJAHRE) {
    const s = schemaFuer(input.schema, hj);
    if (!s || !s.aktiv) continue;

    const eingabe = eingabeFuer(hj);
    const zw = zwischen.get(hj) ?? null;
    let endpunkte: number | null;
    let zwischennoteAusgabe: number | null = zw;

    switch (s.kumulationModus) {
      case 'keine':
        endpunkte = zw;
        break;

      case 'fortlaufend_50_50':
        if (s.deaktivierbar && eingabe?.istNa) {
          // Halbjahr abgeschaltet: Vorwert unverändert fortschreiben.
          endpunkte = vorigeEndpunkte;
          zwischennoteAusgabe = null;
        } else if (vorigeEndpunkte === null || zw === null) {
          endpunkte = zw;
        } else {
          endpunkte = 0.5 * vorigeEndpunkte + 0.5 * zw;
        }
        break;

      case 'gewichtet_vorgaenger': {
        // 0,3·Zwischennote(Vor-Hj) + 0,7·Zwischennote(akt. Hj). Praxis-Endnote PiA.
        const vorHj = letztesAktivesVorHalbjahr(input.schema, hj);
        const vorZw = vorHj !== null ? (zwischen.get(vorHj) ?? null) : null;
        endpunkte =
          vorZw === null || zw === null ? zw : 0.3 * vorZw + 0.7 * zw;
        break;
      }

      case 'mittelwert_halbjahre': {
        const hjs = s.mittelwertHalbjahre ?? [];
        const werte = hjs
          .map((h) => zwischen.get(h) ?? null)
          .filter((v): v is number => v !== null);
        endpunkte =
          werte.length > 0
            ? werte.reduce((a, b) => a + b, 0) / werte.length
            : null;
        break;
      }
    }

    if (endpunkte !== null) vorigeEndpunkte = endpunkte;

    ergebnisse.push({
      halbjahr: hj,
      aktiv: true,
      zwischennote: zwischennoteAusgabe,
      endpunkte,
      tendenz: tendenzAusEndpunkten(endpunkte, skala),
    });
  }

  return ergebnisse;
}

function letztesAktivesVorHalbjahr(
  schema: SchemaHalbjahr[],
  hj: Halbjahr,
): Halbjahr | null {
  for (let h = (hj - 1) as number; h >= 1; h--) {
    const s = schemaFuer(schema, h as Halbjahr);
    if (s?.aktiv) return h as Halbjahr;
  }
  return null;
}
