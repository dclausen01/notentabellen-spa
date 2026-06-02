import type {
  Eingabemaske,
  ErgebnisHalbjahr,
  FachOption,
  Identitaet,
  Klasse,
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

  schuelerFach: (schuelerId: number, fach: string) =>
    apiFetch<ErgebnisHalbjahr[]>(`/api/schueler/${schuelerId}/fach/${encodeURIComponent(fach)}`),

  zeugnis: (klasseId: number, halbjahr: number) =>
    apiFetch<ZeugnisZeile[]>(`/api/zeugnis?klasseId=${klasseId}&halbjahr=${halbjahr}`),

  berechneKlasse: (klasseId: number) =>
    apiFetch<{ gespeicherteErgebnisse: number }>(`/api/klassen/${klasseId}/berechnung`, {
      method: 'POST',
    }),
};
