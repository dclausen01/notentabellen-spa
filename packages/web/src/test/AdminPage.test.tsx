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

function mockApi(rolle: 'admin' | 'fach') {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/auth/login')) {
      return new Response(JSON.stringify({ token: 'tok', rolle, name: 'Test' }), { status: 200 });
    }
    if (url.includes('/api/admin/bildungsgaenge')) {
      return new Response(
        JSON.stringify([{ id: 1, schluessel: 'SPA_PIA', bezeichnung: 'SPA PiA' }]),
        { status: 200 },
      );
    }
    return new Response('[]', { status: 200 });
  });
}

async function anmelden(benutzer: string) {
  const user = userEvent.setup();
  renderApp();
  await user.type(screen.getByLabelText('Benutzername'), benutzer);
  await user.type(screen.getByLabelText('Passwort'), 'geheim');
  await user.click(screen.getByRole('button', { name: 'Anmelden' }));
  return user;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminPage', () => {
  it('zeigt Admins den Administrationsbereich mit den Tabs', async () => {
    mockApi('admin');
    const user = await anmelden('admin');
    const link = await screen.findByRole('link', { name: 'Administration' });
    await user.click(link);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Administration' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Lehrkräfte/ })).toBeInTheDocument();
  });

  it('blendet den Administrationslink für Fachlehrkräfte aus', async () => {
    mockApi('fach');
    await anmelden('lehrer');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Noteneingabe' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });
});
