import type { Halbjahr, HalbjahrModus, KumulationModus } from '@notentabellen/core';

/**
 * Fachliche Konfiguration als Daten (Spec-Leitprinzip „Konfiguration statt
 * Code"). Hier wird die gesamte Bewertungsstruktur der SPA-Bildungsgänge
 * deklariert; der Seed schreibt sie in die DB, der Rechenkern liest sie von
 * dort. Unterschiede SPA regulär ↔ PiA stecken ausschließlich in diesen Daten.
 */

export interface KomponenteCfg {
  schluessel: string;
  name: string;
  gewichtFix?: number;
  restAnteil?: boolean;
}

export interface SchemaCfg {
  fach: string;
  bildungsgang: BildungsgangSchluessel;
  halbjahr: Halbjahr;
  halbjahrModus: HalbjahrModus;
  kumulationModus: KumulationModus;
  deaktivierbar: boolean;
  aktiv: boolean;
  mittelwertHalbjahre?: Halbjahr[];
  komponenten: KomponenteCfg[];
  /** Externe Verrechnung (Praxis PiA 4. Hj.): Gewichte + Quellfach/-Halbjahr. */
  gewichtAktuell?: number;
  gewichtExtern?: number;
  externFach?: string;
  externHalbjahr?: Halbjahr;
  /** Im 4. Hj. wird eine Prüfungsnote erfasst (Eingabespalte + Anzeige). */
  pruefung?: boolean;
  /** Prüfung fließt in die Endnote ein (Englisch/Mathe FHR, über die Gewichte). */
  pruefungVerrechnen?: boolean;
  /** Diese (Fach,Halbjahr)-Position erscheint im Abschlusszeugnis (4. Hj.). */
  abschlussZeigen?: boolean;
}

export type BildungsgangSchluessel = 'SPA_REGULAR' | 'SPA_PIA';

export interface FachCfg {
  schluessel: string;
  name: string;
  typ: 'LF' | 'FACH';
}

export interface Konfiguration {
  bildungsgaenge: { schluessel: BildungsgangSchluessel; bezeichnung: string }[];
  notenskala: { punkte: number; notentext: string }[];
  wpkKurse: string[];
  faecher: FachCfg[];
  schemata: SchemaCfg[];
}

const ALLE_HJ: Halbjahr[] = [1, 2, 3, 4];
const BEIDE: BildungsgangSchluessel[] = ['SPA_REGULAR', 'SPA_PIA'];

// --- LF3-Komponenten je Halbjahr (Spec 6.2) ---
const lf3Komponenten = (hj: Halbjahr): KomponenteCfg[] => {
  const rest = (sl: string, name: string): KomponenteCfg => ({
    schluessel: sl,
    name,
    restAnteil: true,
  });
  switch (hj) {
    case 1:
      return [
        { schluessel: 'paedagogik', name: 'Pädagogik', gewichtFix: 0.4 },
        rest('kunst', 'Kunst'),
        rest('spiel', 'Spiel'),
        rest('musik', 'Musik'),
      ];
    case 2:
    case 3:
      return [
        { schluessel: 'paedagogik', name: 'Pädagogik', gewichtFix: 0.2 },
        { schluessel: 'bericht', name: 'Bericht', gewichtFix: 0.2 },
        rest('bewegung', 'Bewegung'),
        rest('spiel', 'Spiel'),
        rest('kunst', 'Kunst'),
        rest('musik', 'Musik'),
      ];
    case 4:
      return [
        { schluessel: 'paedagogik', name: 'Pädagogik', gewichtFix: 0.4 },
        rest('kunst', 'Kunst'),
        rest('spiel', 'Spiel'),
        rest('musik', 'Musik'),
        rest('bewegung', 'Bewegung'),
      ];
  }
};

const LF2_KOMPONENTEN: KomponenteCfg[] = [
  { schluessel: 'gesundheit', name: 'Gesundheit', gewichtFix: 0.4 },
  { schluessel: 'erziehung', name: 'Erziehung', gewichtFix: 0.3 },
  { schluessel: 'entwicklung', name: 'Entwicklung', gewichtFix: 0.3 },
];

function lernfeldSchemata(): SchemaCfg[] {
  const out: SchemaCfg[] = [];
  for (const bg of BEIDE) {
    for (const hj of ALLE_HJ) {
      const istVierte = hj === 4;
      // LF1: direkter Punktwert, 50/50-Kumulation
      out.push({
        fach: 'LF1',
        bildungsgang: bg,
        halbjahr: hj,
        halbjahrModus: 'direkt',
        kumulationModus: 'fortlaufend_50_50',
        deaktivierbar: false,
        aktiv: true,
        komponenten: [],
        ...(istVierte ? { abschlussZeigen: true } : {}),
      });
      // LF2: gewichtet, 50/50. Prüfung im 4. Hj. (eigenständig).
      out.push({
        fach: 'LF2',
        bildungsgang: bg,
        halbjahr: hj,
        halbjahrModus: 'komponenten_gewichtet',
        kumulationModus: 'fortlaufend_50_50',
        deaktivierbar: false,
        aktiv: true,
        komponenten: LF2_KOMPONENTEN,
        ...(istVierte ? { abschlussZeigen: true, pruefung: true } : {}),
      });
      // LF3: gewichtet mit wechselnden Komponenten, 50/50. Prüfung im 4. Hj.
      out.push({
        fach: 'LF3',
        bildungsgang: bg,
        halbjahr: hj,
        halbjahrModus: 'komponenten_gewichtet',
        kumulationModus: 'fortlaufend_50_50',
        deaktivierbar: false,
        aktiv: true,
        komponenten: lf3Komponenten(hj),
        ...(istVierte ? { abschlussZeigen: true, pruefung: true } : {}),
      });
      // LF4: direkt, 50/50. PiA per Hj abschaltbar, regulär durchgängig.
      out.push({
        fach: 'LF4',
        bildungsgang: bg,
        halbjahr: hj,
        halbjahrModus: 'direkt',
        kumulationModus: 'fortlaufend_50_50',
        deaktivierbar: bg === 'SPA_PIA',
        aktiv: true,
        komponenten: [],
        ...(istVierte ? { abschlussZeigen: true } : {}),
      });
    }
  }
  return out;
}

function allgemeineFaecherSchemata(): SchemaCfg[] {
  const faecher = ['DEUTSCH', 'ENGLISCH', 'WIPO', 'RELIGION', 'MATHEMATIK'];
  // Fächer mit (verrechneter) FHR-Prüfung im 4. Hj.: Abschluss = 3/5·Vornote + 2/5·Prüfung.
  const fhrFach = (f: string) => f === 'ENGLISCH' || f === 'MATHEMATIK';
  const out: SchemaCfg[] = [];
  for (const bg of BEIDE) {
    for (const fach of faecher) {
      for (const hj of ALLE_HJ) {
        const istVierte = hj === 4;
        const fhr = istVierte && fhrFach(fach);
        out.push({
          fach,
          bildungsgang: bg,
          halbjahr: hj,
          halbjahrModus: 'direkt',
          // Englisch/Mathe 4. Hj.: Prüfung fließt zu 2/5 ein (externer Modus).
          kumulationModus: fhr ? 'gewichtet_vorgaenger' : 'keine',
          deaktivierbar: false,
          aktiv: true,
          komponenten: [],
          ...(istVierte ? { abschlussZeigen: true } : {}),
          // Prüfung erfassen: Deutsch (eigenständig) sowie Englisch/Mathe (verrechnet).
          ...(istVierte && (fach === 'DEUTSCH' || fhr) ? { pruefung: true } : {}),
          ...(fhr
            ? { pruefungVerrechnen: true, gewichtAktuell: 0.6, gewichtExtern: 0.4 }
            : {}),
        });
      }
    }
  }
  return out;
}

function praxisSchemata(): SchemaCfg[] {
  const out: SchemaCfg[] = [];

  // PiA: Praxisnoten NUR im 2. und 4. Hj. Das 2. Hj. ist eigenständig; das
  // 4. Hj. wird einmalig verrechnet: 0,7·Praxis(4.) + 0,3·Blockpraxis(3.).
  for (const hj of ALLE_HJ) {
    const istVierte = hj === 4;
    out.push({
      fach: 'PRAXIS',
      bildungsgang: 'SPA_PIA',
      halbjahr: hj,
      halbjahrModus: 'direkt',
      kumulationModus: istVierte ? 'gewichtet_vorgaenger' : 'keine',
      deaktivierbar: false,
      aktiv: hj === 2 || hj === 4,
      komponenten: [],
      // Beide Praxisnoten (2. + 4. Hj.) im Abschlusszeugnis ausweisen.
      ...(hj === 2 || hj === 4 ? { abschlussZeigen: true } : {}),
      ...(istVierte
        ? {
            gewichtAktuell: 0.7,
            gewichtExtern: 0.3,
            externFach: 'BLOCKPRAXIS',
            externHalbjahr: 3 as Halbjahr,
          }
        : {}),
    });
  }
  // PiA: Blockpraxis nur im 3. Hj., eigenständige Note (eigene Zeugniszeile)
  // und Quelle für die 30%-Verrechnung der Praxis-Endnote im 4. Hj.
  out.push({
    fach: 'BLOCKPRAXIS',
    bildungsgang: 'SPA_PIA',
    halbjahr: 3,
    halbjahrModus: 'direkt',
    kumulationModus: 'keine',
    deaktivierbar: false,
    aktiv: true,
    abschlussZeigen: true,
    komponenten: [],
  });

  // Regulär: nur 2. und 3. Hj., zwei separate Noten ohne Verrechnung; kein
  // Blockpraktikum. Beide im Abschlusszeugnis ausweisen.
  for (const hj of ALLE_HJ) {
    out.push({
      fach: 'PRAXIS',
      bildungsgang: 'SPA_REGULAR',
      halbjahr: hj,
      halbjahrModus: 'direkt',
      kumulationModus: 'keine',
      deaktivierbar: false,
      aktiv: hj === 2 || hj === 3,
      komponenten: [],
      ...(hj === 2 || hj === 3 ? { abschlussZeigen: true } : {}),
    });
  }
  return out;
}

function wpkSchemata(): SchemaCfg[] {
  const out: SchemaCfg[] = [];
  for (const bg of BEIDE) {
    for (const hj of ALLE_HJ) {
      const aktiv = hj === 1 || hj === 2;
      out.push({
        fach: 'WPK',
        bildungsgang: bg,
        halbjahr: hj,
        halbjahrModus: 'direkt',
        // Zeugnisnote = Mittelwert 1.+2. Hj. (am 2. Hj. ausgewiesen).
        kumulationModus: hj === 2 ? 'mittelwert_halbjahre' : 'keine',
        deaktivierbar: false,
        aktiv,
        ...(hj === 2 ? { mittelwertHalbjahre: [1, 2] as Halbjahr[], abschlussZeigen: true } : {}),
        komponenten: [],
      });
    }
  }
  return out;
}

/** Baut die vollständige Konfiguration für beide Bildungsgänge. */
export function baueKonfiguration(): Konfiguration {
  return {
    bildungsgaenge: [
      { schluessel: 'SPA_REGULAR', bezeichnung: 'SPA (regulär)' },
      { schluessel: 'SPA_PIA', bezeichnung: 'SPA PiA' },
    ],
    notenskala: [
      [15, '1+'], [14, '1'], [13, '1-'], [12, '2+'], [11, '2'], [10, '2-'],
      [9, '3+'], [8, '3'], [7, '3-'], [6, '4+'], [5, '4'], [4, '4-'],
      [3, '5+'], [2, '5'], [1, '5-'], [0, '6'],
    ].map(([punkte, notentext]) => ({
      punkte: punkte as number,
      notentext: notentext as string,
    })),
    // Standard-Wahlpflichtkurse; weitere sind über die Admin-Konsole pflegbar.
    wpkKurse: ['Krippe (U3)', 'Nahrungsmittelzubereitung'],
    faecher: [
      { schluessel: 'LF1', name: 'Lernfeld 1', typ: 'LF' },
      { schluessel: 'LF2', name: 'Lernfeld 2', typ: 'LF' },
      { schluessel: 'LF3', name: 'Lernfeld 3', typ: 'LF' },
      { schluessel: 'LF4', name: 'Lernfeld 4', typ: 'LF' },
      { schluessel: 'PRAXIS', name: 'Praxis', typ: 'FACH' },
      { schluessel: 'BLOCKPRAXIS', name: 'Blockpraxis', typ: 'FACH' },
      { schluessel: 'DEUTSCH', name: 'Deutsch', typ: 'FACH' },
      { schluessel: 'ENGLISCH', name: 'Englisch', typ: 'FACH' },
      { schluessel: 'WIPO', name: 'WiPo', typ: 'FACH' },
      { schluessel: 'RELIGION', name: 'Religion', typ: 'FACH' },
      { schluessel: 'MATHEMATIK', name: 'Mathematik', typ: 'FACH' },
      { schluessel: 'WPK', name: 'Wahlpflichtkurs', typ: 'FACH' },
    ],
    schemata: [
      ...lernfeldSchemata(),
      ...allgemeineFaecherSchemata(),
      ...praxisSchemata(),
      ...wpkSchemata(),
    ],
  };
}
