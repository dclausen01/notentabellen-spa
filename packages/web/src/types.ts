export type Rolle = 'fach' | 'klassenleitung' | 'admin';

export interface Identitaet {
  lehrkraftId: number;
  rolle: Rolle;
  name: string;
}

export interface Klasse {
  id: number;
  bezeichnung: string;
  schuljahr: string;
  bildungsgang: string;
}

export interface FachOption {
  schluessel: string;
  name: string;
  typ: 'LF' | 'FACH';
  halbjahre: number[];
}

export interface MaskeKomponente {
  id: number;
  schluessel: string;
  name: string;
}

export interface MaskeWert {
  wert: number | null;
  istNa: boolean;
}

export interface MaskeZeile {
  schuelerId: number;
  name: string;
  vorname: string;
  komponenten: Record<string, MaskeWert>;
  direkt: MaskeWert | null;
  wpkKursId?: number | null;
}

export interface WpkKursOption {
  id: number;
  name: string;
}

export interface VorwertZeile {
  schuelerId: number;
  endpunkte: number | null;
  tendenz: string | null;
}
export interface VorwertInfo {
  label: string | null;
  werte: VorwertZeile[];
}

export interface Eingabemaske {
  klasseId: number;
  fach: string;
  halbjahr: number;
  modus: 'komponenten_gewichtet' | 'direkt';
  aktiv: boolean;
  deaktivierbar: boolean;
  komponenten: MaskeKomponente[];
  zeilen: MaskeZeile[];
  wpkKurse?: WpkKursOption[];
  /** Zur Orientierung: Wert aus Vorhalbjahr/Quelle, der in die Endnote einfließt. */
  vorwerte?: VorwertInfo;
}

export interface ErgebnisHalbjahr {
  halbjahr: number;
  aktiv: boolean;
  zwischennote: number | null;
  endpunkte: number | null;
  tendenz: string | null;
}

export interface ZeugnisZelle {
  fach: string;
  endpunkte: number | null;
  tendenz: string | null;
}

export interface ZeugnisZeile {
  schuelerId: number;
  name: string;
  vorname: string;
  faecher: ZeugnisZelle[];
}

// --- Administration ---

export interface Bildungsgang {
  id: number;
  schluessel: string;
  bezeichnung: string;
}

export interface AdminFach {
  id: number;
  schluessel: string;
  name: string;
  typ: 'LF' | 'FACH';
}

export interface Lehrkraft {
  id: number;
  name: string;
  login_sub: string;
  rolle: Rolle;
}

export interface Schueler {
  id: number;
  name: string;
  vorname: string;
  klasse_id: number;
  aktiv: number;
}

export interface LehrauftragZeile {
  id: number;
  fach: string;
  fachName: string;
  klasseId: number;
  klasse: string;
  halbjahr: number;
}

export interface KlassenleitungZeile {
  klasseId: number;
  klasse: string;
}

export interface AuftraegeAntwort {
  lehrauftraege: LehrauftragZeile[];
  klassenleitungen: KlassenleitungZeile[];
}

export interface SchemaUebersichtKomponente {
  schluessel: string;
  name: string;
  gewichtFix: number | null;
  restAnteil: boolean;
}

export interface WpkKurs {
  id: number;
  name: string;
  aktiv: number;
}

export interface ImportBericht {
  angelegt: number;
  uebersprungen: number;
  fehler: { zeile: number; grund: string }[];
}

export interface SchemaUebersichtZeile {
  fach: string;
  fachName: string;
  halbjahr: number;
  halbjahrModus: string;
  kumulationModus: string;
  deaktivierbar: boolean;
  aktiv: boolean;
  komponenten: SchemaUebersichtKomponente[];
}
