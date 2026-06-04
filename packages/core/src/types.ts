/**
 * Typen des Rechenkerns. Bewusst framework-unabhängig: keine DB-, keine
 * HTTP-Abhängigkeiten. Spiegelt das Konfigurationsmodell der Spezifikation
 * (Kap. 4.1 / 5) wider.
 */

export type Halbjahr = 1 | 2 | 3 | 4;

/** Wie die Halbjahres-Zwischennote gebildet wird. */
export type HalbjahrModus = 'komponenten_gewichtet' | 'direkt';

/** Wie über die Halbjahre fortgeschrieben wird (Spec-Tabelle 4.1). */
export type KumulationModus =
  | 'fortlaufend_50_50' // End(Hj≥2) = 0,5·End(Hj−1) + 0,5·Zw(Hj) — LF1–LF4
  | 'keine' // End(Hj) = Zw(Hj) — Deutsch, Englisch, WiPo, Religion, Mathematik, Praxis(regulär)
  | 'gewichtet_vorgaenger' // End = 0,3·Zw(Vor-Hj) + 0,7·Zw(akt. Hj) — Praxis-Endnote PiA 4. Hj.
  | 'mittelwert_halbjahre'; // End = Ø ausgewählter Halbjahre — WPK = Ø(1.+2. Hj.)

/**
 * Eine Bewertungskomponente. Entweder festes Gewicht (`gewichtFix`) ODER
 * Teilnahme am gleichmäßig verteilten Restbudget (`restAnteil`).
 */
export interface KomponenteDef {
  schluessel: string;
  /** Festes Gewicht, z. B. 0.4. Wenn gesetzt, nimmt die Komponente nicht am Restbudget teil. */
  gewichtFix?: number;
  /** true = Komponente erhält einen gleichmäßigen Anteil am Restbudget (1 − Σ feste Gewichte). */
  restAnteil?: boolean;
}

/** Bewertungsschema für ein Fach in genau einem Halbjahr. */
export interface SchemaHalbjahr {
  halbjahr: Halbjahr;
  /** Ist das Fach in diesem Halbjahr überhaupt belegt? (z. B. Praxis regulär nur 2.+3. Hj.) */
  aktiv: boolean;
  halbjahrModus: HalbjahrModus;
  kumulationModus: KumulationModus;
  /** Kann das Halbjahr per n/a abgeschaltet werden (LF4)? Dann wird der Vorwert fortgeschrieben. */
  deaktivierbar: boolean;
  /** Komponenten bei `komponenten_gewichtet`. Bei `direkt` leer (Wert via `direktwert`). */
  komponenten: KomponenteDef[];
  /** Nur für `mittelwert_halbjahre`: welche Halbjahre gemittelt werden. */
  mittelwertHalbjahre?: Halbjahr[];
  /**
   * Nur für `gewichtet_vorgaenger` im EXTERNEN Modus (Praxis PiA 4. Hj.):
   * Gewicht des aktuellen Halbjahres bzw. des externen Bezugswertes
   * (z. B. 0.7 / 0.3). Sind sie gesetzt, kombiniert der Kern die aktuelle
   * Zwischennote mit `EingabeHalbjahr.externerWert` statt mit dem
   * Vorgänger-Halbjahr desselben Fachs.
   */
  gewichtAktuell?: number;
  gewichtExtern?: number;
}

/** Ein Notenwert: Punkte 0–15 oder `null` für „nicht belegt" (n/a). */
export type Wert = number | null;

/** Eingaben für ein Fach in einem Halbjahr. */
export interface EingabeHalbjahr {
  halbjahr: Halbjahr;
  /** Ganzes Halbjahr auf n/a gesetzt (nur sinnvoll bei `deaktivierbar`). */
  istNa: boolean;
  /** Komponentenwerte (Schlüssel → Wert) bei `komponenten_gewichtet`. */
  komponenten?: Record<string, Wert>;
  /** Direktwert bei `direkt`. */
  direktwert?: Wert;
  /**
   * Externer Bezugswert für `gewichtet_vorgaenger` im externen Modus — z. B. die
   * Blockpraxis-Note (3. Hj.), die zu 30 % in die Praxis-Endnote (4. Hj.) der
   * PiA einfließt. Wird vom Service aus einem anderen Fach befüllt.
   */
  externerWert?: Wert;
  /**
   * Übernommene (historische) Endnote dieses Halbjahres. Ist sie gesetzt, gilt
   * sie als maßgebliche Endnote — keine Berechnung aus Komponenten/Direktwert —
   * und dient zugleich als Vorgängerwert für die Kumulation der Folgehalbjahre.
   * Wird für den Import bereits berechneter Noten (z. B. Altjahrgänge ohne
   * Teilnoten) genutzt.
   */
  importierteEndnote?: Wert;
}

/** Berechnetes Ergebnis für ein Fach in einem Halbjahr. */
export interface ErgebnisHalbjahr {
  halbjahr: Halbjahr;
  aktiv: boolean;
  /** Gewichtete/direkte Halbjahresnote (ungerundet) oder null. */
  zwischennote: number | null;
  /** Kumulierter, ungerundeter Endwert — Basis für die Fortschreibung. */
  endpunkte: number | null;
  /** Aus `endpunkte` abgeleitete Schulnote (gerundet) oder null. */
  tendenz: string | null;
}

/** Punkte (0–15) → Notentext. */
export type Notenskala = ReadonlyMap<number, string>;

/** Eingabe für die Fachberechnung über alle Halbjahre. */
export interface FachBerechnungInput {
  schema: SchemaHalbjahr[];
  eingaben: EingabeHalbjahr[];
  notenskala?: Notenskala;
}
