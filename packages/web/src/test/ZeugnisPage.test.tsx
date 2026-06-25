import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { AuthProvider } from '../auth.js';

const KLASSE = {
  id: 1,
  bezeichnung: 'SPA PiA 1',
  schuljahr: '2025/26',
  bildungsgang: 'SPA_PIA',
  darfNotenbekanntgabe: false,
};

const ZEUGNIS = [
  {
    schuelerId: 1,
    name: 'Mustermann',
    vorname: 'Max',
    faecher: [{ fach: 'LF1', label: 'Lernfeld 1', endpunkte: 10, tendenz: '2-' }],
  },
];

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/auth/login')) {
      return new Response(
        JSON.stringify({ token: 'tok', rolle: 'klassenleitung', name: 'KL' }),
        { status: 200 },
      );
    }
    if (url.includes('/api/klassen') && !url.includes('/api/klassen/')) {
      return new Response(JSON.stringify([KLASSE]), { status: 200 });
    }
    if (url.includes('/api/zeugnis')) {
      return new Response(JSON.stringify(ZEUGNIS), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  });
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ZeugnisPage – PDF / Drucken', () => {
  it('zeigt den Druck-Knopf bei gewählter Klasse und ruft window.print auf', async () => {
    mockApi();
    const print = vi.fn();
    vi.stubGlobal('print', print);

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

    const link = await screen.findByRole('link', { name: 'Notenübersicht' });
    await user.click(link);

    // Klasse wählen → Zeugnisdaten werden geladen, Druck-Knopf erscheint.
    await user.selectOptions(await screen.findByLabelText('Klasse'), '1');

    const druckKnopf = await screen.findByRole('button', { name: 'PDF / Drucken' });
    await user.click(druckKnopf);
    await waitFor(() => expect(print).toHaveBeenCalled());
  });
});
