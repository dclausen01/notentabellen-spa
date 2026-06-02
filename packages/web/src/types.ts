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
