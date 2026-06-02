import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { AuthProvider } from '../auth.js';

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginPage', () => {
  it('zeigt die Anmeldefelder', () => {
    renderApp();
    expect(screen.getByLabelText('Benutzername')).toBeInTheDocument();
    expect(screen.getByLabelText('Passwort')).toBeInTheDocument();
  });

  it('zeigt eine Fehlermeldung bei abgelehnter Anmeldung', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ fehler: 'Anmeldung fehlgeschlagen' }), { status: 401 }),
    );
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Benutzername'), 'lehrer');
    await user.type(screen.getByLabelText('Passwort'), 'falsch');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Anmeldung fehlgeschlagen'),
    );
  });

  it('meldet erfolgreich an und zeigt die Noteneingabe', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/auth/login')) {
        return new Response(JSON.stringify({ token: 'tok', rolle: 'admin', name: 'Admin' }), { status: 200 });
      }
      if (url.includes('/api/klassen')) return new Response('[]', { status: 200 });
      return new Response('[]', { status: 200 });
    });
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Benutzername'), 'admin');
    await user.type(screen.getByLabelText('Passwort'), 'geheim');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Noteneingabe' })).toBeInTheDocument(),
    );
  });
});
