import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { AuthProvider } from '../auth.js';

// Klassenname ohne Jahreszahl → aktuellesHalbjahr() liefert null, die Maske
// startet deterministisch im 1. Halbjahr.
const KLASSE = {
  id: 1,
  bezeichnung: 'Testklasse',
  schuljahr: '2025/26',
  bildungsgang: 'SPA_PIA',
  darfNotenbekanntgabe: true,
};

const FACH = { schluessel: 'LF1', name: 'Lernfeld 1', typ: 'LF', halbjahre: [1, 2] };

function maske(halbjahr: number, wert: number | null, darfBearbeiten = true) {
  return {
    klasseId: 1,
    fach: 'LF1',
    halbjahr,
    modus: 'direkt',
    aktiv: true,
    deaktivierbar: false,
    komponenten: [],
    darfBearbeiten,
    zeilen: [
      {
        schuelerId: 1,
        name: 'Mustermann',
        vorname: 'Max',
        komponenten: {},
        direkt: { wert, istNa: false },
      },
    ],
  };
}

/**
 * `hj1`/`hj2` = gespeicherter Wert im jeweiligen Halbjahr.
 * `speichernScheitert` simuliert ein abgelehntes Speichern (403 ohne Lehrauftrag).
 */
function mockApi(
  hj1: number | null,
  hj2: number | null,
  { darfBearbeiten = true, speichernScheitert = false } = {},
) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith('/api/auth/login')) {
      return ok({ token: 'tok', rolle: 'klassenleitung', name: 'KL' });
    }
    if (url.includes('/api/noten/')) {
      return speichernScheitert
        ? new Response(JSON.stringify({ fehler: 'Kein Zugriff' }), { status: 403 })
        : new Response(null, { status: 204 });
    }
    if (url.includes('/faecher')) return ok([FACH]);
    if (url.includes('/komponenten')) return ok([]);
    if (url.includes('/api/eingabe')) {
      const hj = url.includes('halbjahr=2') ? 2 : 1;
      return ok(maske(hj, hj === 1 ? hj1 : hj2, darfBearbeiten));
    }
    if (url.includes('/api/schueler/')) return ok([]);
    if (url.includes('/api/klassen')) return ok([KLASSE]);
    void init;
    return ok([]);
  });
}

async function oeffneMaske() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  await user.type(screen.getByLabelText('Benutzername'), 'kl');
  await user.type(screen.getByLabelText('Passwort'), 'geheim');
  await user.click(screen.getByRole('button', { name: 'Anmelden' }));

  await user.selectOptions(await screen.findByLabelText('Klasse'), '1');
  await user.selectOptions(await screen.findByLabelText('Fach'), 'LF1');
  return user;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('EingabePage – Noten wandern nicht zwischen Halbjahren', () => {
  it('zeigt beim Halbjahr-Wechsel den Wert des gewählten Halbjahres (leer bleibt leer)', async () => {
    // 1. Hj. = 10, 2. Hj. = ohne Note. Vor dem Fix behielt NoteInput seinen
    // lokalen Text, wenn sich der Prop-Wert nicht änderte — die 10 blieb stehen.
    mockApi(10, null);
    const user = await oeffneMaske();

    const feld = await screen.findByLabelText('Punkte 0 bis 15');
    await waitFor(() => expect(feld).toHaveValue('10'));

    await user.selectOptions(screen.getByLabelText('Halbjahr'), '2');

    await waitFor(() => {
      expect(screen.getByLabelText('Punkte 0 bis 15')).toHaveValue('');
    });
  });

  it('verwirft die Eingabe sichtbar, wenn das Speichern abgelehnt wird', async () => {
    // Der reale Fall aus dem Praxistest: 403 beim Speichern. Vorher blieb die
    // Zahl im Feld stehen (sah gespeichert aus) und tauchte beim Halbjahr-
    // Wechsel erneut auf, weil sich der Prop-Wert (null → null) nie änderte.
    mockApi(null, null, { speichernScheitert: true });
    const user = await oeffneMaske();

    const feld = await screen.findByLabelText('Punkte 0 bis 15');
    await user.type(feld, '12');
    await user.tab(); // Blur → Speichern → 403

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Kein Zugriff'));
    expect(screen.getByLabelText('Punkte 0 bis 15')).toHaveValue('');
  });

  it('sperrt die Felder ohne Schreibrecht', async () => {
    mockApi(10, null, { darfBearbeiten: false });
    await oeffneMaske();

    await waitFor(() => expect(screen.getByLabelText('Punkte 0 bis 15')).toBeDisabled());
    expect(screen.getByText(/Nur lesend/)).toBeInTheDocument();
  });
});
