import type {
  AdminFach,
  AuftraegeAntwort,
  Bildungsgang,
  Eingabemaske,
  ErgebnisHalbjahr,
  FachOption,
  Identitaet,
  Klasse,
  KomponenteKonfig,
  Lehrkraft,
  ImportBericht,
  NotenImportBericht,
  QuerwechslerBericht,
  QuerwechslerEndnote,
  Rolle,
  Schueler,
  SchemaUebersichtZeile,
  WechselBericht,
  WpkKurs,
  ZeugnisZeile,
} from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let aktuellesToken: string | null = null;
let beiAuthFehler: (() => void) | null = null;

export function setToken(token: string | null): void {
  aktuellesToken = token;
}
export function setAuthFehlerHandler(fn: () => void): void {
  beiAuthFehler = fn;
}

async function apiFetch<T>(pfad: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (aktuellesToken) headers.set('authorization', `Bearer ${aktuellesToken}`);
  if (init.body) headers.set('content-type', 'application/json');

  const res = await fetch(pfad, { ...init, headers });
  if (!res.ok) {
    let nachricht = `Fehler ${res.status}`;
    try {
      const body = await res.json();
      if (body?.fehler) nachricht = body.fehler;
    } catch {
      /* kein JSON */
    }
    // Nur eine abgelaufene Session (401 mit zuvor vorhandenem Token) führt zum
    // automatischen Logout — eine fehlgeschlagene Anmeldung nicht.
    if (res.status === 401 && aktuellesToken) beiAuthFehler?.();
    throw new ApiError(res.status, nachricht);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Lädt eine Datei (mit Auth-Header) und gibt Blob + Dateiname zurück. */
async function apiDownload(pfad: string): Promise<{ blob: Blob; dateiname: string }> {
  const headers = new Headers();
  if (aktuellesToken) headers.set('authorization', `Bearer ${aktuellesToken}`);
  const res = await fetch(pfad, { headers });
  if (!res.ok) {
    let nachricht = `Fehler ${res.status}`;
    try {
      const body = await res.json();
      if (body?.fehler) nachricht = body.fehler;
    } catch {
      /* kein JSON */
    }
    if (res.status === 401 && aktuellesToken) beiAuthFehler?.();
    throw new ApiError(res.status, nachricht);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const treffer = cd.match(/filename="?([^"]+)"?/);
  return { blob: await res.blob(), dateiname: treffer?.[1] ?? 'download' };
}

export interface LoginAntwort {
  token: string;
  rolle: Identitaet['rolle'];
  name: string;
}

export const api = {
  login: (benutzername: string, passwort: string) =>
    apiFetch<LoginAntwort>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ benutzername, passwort }),
    }),

  me: () => apiFetch<Identitaet>('/api/me'),

  klassen: () => apiFetch<Klasse[]>('/api/klassen'),

  faecher: (klasseId: number) =>
    apiFetch<FachOption[]>(`/api/klassen/${klasseId}/faecher`),

  eingabe: (klasseId: number, fach: string, halbjahr: number) =>
    apiFetch<Eingabemaske>(
      `/api/eingabe?klasseId=${klasseId}&fach=${encodeURIComponent(fach)}&halbjahr=${halbjahr}`,
    ),

  speichereKomponente: (body: {
    schuelerId: number;
    komponenteId: number;
    halbjahr: number;
    wert: number | null;
    istNa: boolean;
  }) => apiFetch<void>('/api/noten/komponente', { method: 'PUT', body: JSON.stringify(body) }),

  speichereDirekt: (body: {
    schuelerId: number;
    fach: string;
    halbjahr: number;
    wert: number | null;
    istNa: boolean;
  }) => apiFetch<void>('/api/noten/direkt', { method: 'PUT', body: JSON.stringify(body) }),

  speicherePruefung: (body: {
    schuelerId: number;
    fach: string;
    halbjahr: number;
    wert: number | null;
    istNa: boolean;
  }) => apiFetch<void>('/api/noten/pruefung', { method: 'PUT', body: JSON.stringify(body) }),

  speichereWpkKurs: (body: { schuelerId: number; halbjahr: number; wpkKursId: number | null }) =>
    apiFetch<void>('/api/noten/wpk-kurs', { method: 'PUT', body: JSON.stringify(body) }),

  schuelerFach: (schuelerId: number, fach: string) =>
    apiFetch<ErgebnisHalbjahr[]>(`/api/schueler/${schuelerId}/fach/${encodeURIComponent(fach)}`),

  zeugnis: (klasseId: number, halbjahr: number) =>
    apiFetch<ZeugnisZeile[]>(`/api/zeugnis?klasseId=${klasseId}&halbjahr=${halbjahr}`),

  berechneKlasse: (klasseId: number) =>
    apiFetch<{ gespeicherteErgebnisse: number }>(`/api/klassen/${klasseId}/berechnung`, {
      method: 'POST',
    }),

  schueler: (klasseId: number) => apiFetch<Schueler[]>(`/api/klassen/${klasseId}/schueler`),

  zeugnisExport: (klasseId: number, halbjahr: number) =>
    apiDownload(`/api/zeugnis/export?klasseId=${klasseId}&halbjahr=${halbjahr}`),

  notenbekanntgabe: (klasseId: number) =>
    apiDownload(`/api/zeugnis/notenbekanntgabe?klasseId=${klasseId}`),

  klassenKomponenten: (klasseId: number, fach: string) =>
    apiFetch<KomponenteKonfig[]>(
      `/api/klassen/${klasseId}/komponenten?fach=${encodeURIComponent(fach)}`,
    ),

  setzeKomponenteAktiv: (klasseId: number, komponenteId: number, aktiv: boolean) =>
    apiFetch<void>(`/api/klassen/${klasseId}/komponenten`, {
      method: 'PUT',
      body: JSON.stringify({ komponenteId, aktiv }),
    }),
};

export const adminApi = {
  bildungsgaenge: () => apiFetch<Bildungsgang[]>('/api/admin/bildungsgaenge'),
  faecher: () => apiFetch<AdminFach[]>('/api/admin/faecher'),

  erstelleKlasse: (body: { bezeichnung: string; schuljahr: string; bildungsgang: string }) =>
    apiFetch<{ id: number }>('/api/admin/klassen', { method: 'POST', body: JSON.stringify(body) }),

  loescheKlasse: (id: number) =>
    apiFetch<void>(`/api/admin/klassen/${id}`, { method: 'DELETE' }),

  erstelleSchueler: (klasseId: number, body: { name: string; vorname: string }) =>
    apiFetch<{ id: number }>(`/api/admin/klassen/${klasseId}/schueler`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deaktiviereSchueler: (id: number) =>
    apiFetch<void>(`/api/admin/schueler/${id}`, { method: 'DELETE' }),

  aktualisiereSchueler: (id: number, body: { name: string; vorname: string }) =>
    apiFetch<void>(`/api/admin/schueler/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  loescheSchueler: (id: number) =>
    apiFetch<void>(`/api/admin/schueler/${id}?hart=1`, { method: 'DELETE' }),

  verschiebeSchueler: (id: number, klasseId: number) =>
    apiFetch<WechselBericht>(`/api/admin/schueler/${id}/klasse`, {
      method: 'PUT',
      body: JSON.stringify({ klasseId }),
    }),

  nimmQuerwechslerAuf: (body: {
    name: string;
    vorname: string;
    klasseId: number;
    endnoten: QuerwechslerEndnote[];
  }) =>
    apiFetch<QuerwechslerBericht>('/api/admin/querwechsler', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  lehrkraefte: () => apiFetch<Lehrkraft[]>('/api/admin/lehrkraefte'),

  erstelleLehrkraft: (body: { name?: string; loginSub: string; rolle: Rolle }) =>
    apiFetch<{ id: number }>('/api/admin/lehrkraefte', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  setzeRolle: (id: number, rolle: Rolle) =>
    apiFetch<void>(`/api/admin/lehrkraefte/${id}/rolle`, {
      method: 'PUT',
      body: JSON.stringify({ rolle }),
    }),

  auftraege: (lehrkraftId: number) =>
    apiFetch<AuftraegeAntwort>(`/api/admin/lehrkraefte/${lehrkraftId}/auftraege`),

  erstelleLehrauftrag: (body: {
    lehrkraftId: number;
    fach: string;
    klasseId: number;
    halbjahr?: number;
  }) => apiFetch<{ ok: true }>('/api/admin/lehrauftraege', { method: 'POST', body: JSON.stringify(body) }),

  entferneLehrauftrag: (id: number) =>
    apiFetch<void>(`/api/admin/lehrauftraege/${id}`, { method: 'DELETE' }),

  setzeKlassenleitung: (body: { lehrkraftId: number; klasseId: number }) =>
    apiFetch<{ ok: true }>('/api/admin/klassenleitung', { method: 'POST', body: JSON.stringify(body) }),

  entferneKlassenleitung: (lehrkraftId: number, klasseId: number) =>
    apiFetch<void>(`/api/admin/klassenleitung?lehrkraftId=${lehrkraftId}&klasseId=${klasseId}`, {
      method: 'DELETE',
    }),

  schemata: (bildungsgang: string) =>
    apiFetch<SchemaUebersichtZeile[]>(
      `/api/admin/schemata?bildungsgang=${encodeURIComponent(bildungsgang)}`,
    ),

  importSchueler: (csv: string) =>
    apiFetch<ImportBericht>('/api/admin/import/schueler', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),

  importLehrkraefte: (csv: string) =>
    apiFetch<ImportBericht>('/api/admin/import/lehrkraefte', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),

  importNoten: (csv: string, commit: boolean) =>
    apiFetch<NotenImportBericht>('/api/admin/import/noten', {
      method: 'POST',
      body: JSON.stringify({ csv, commit }),
    }),

  wpkKurse: () => apiFetch<WpkKurs[]>('/api/admin/wpk-kurse'),

  erstelleWpkKurs: (name: string) =>
    apiFetch<{ id: number }>('/api/admin/wpk-kurse', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  setzeWpkKursAktiv: (id: number, aktiv: boolean) =>
    apiFetch<void>(`/api/admin/wpk-kurse/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ aktiv }),
    }),
};
