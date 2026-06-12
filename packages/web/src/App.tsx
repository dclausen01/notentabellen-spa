import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.js';
import { aktuellesTheme, setzeTheme, type Theme } from './theme.js';
import { LoginPage } from './pages/LoginPage.js';
import { EingabePage } from './pages/EingabePage.js';
import { ZeugnisPage } from './pages/ZeugnisPage.js';
import { AdminPage } from './pages/AdminPage.js';

function NavBar() {
  const { ident, abmelden } = useAuth();
  if (!ident) return null;
  const darfZeugnis = ident.rolle !== 'fach';
  const istAdmin = ident.rolle === 'admin';
  return (
    <header className="navbar">
      <div className="navbar-brand">Notenverwaltung SPA</div>
      <nav className="navbar-links">
        <NavLink to="/eingabe">Noteneingabe</NavLink>
        {darfZeugnis && <NavLink to="/zeugnis">Notenübersicht</NavLink>}
        {istAdmin && <NavLink to="/admin">Administration</NavLink>}
      </nav>
      <div className="navbar-user">
        <ThemeToggle />
        <span>
          {ident.name} · <em>{rolleLabel(ident.rolle)}</em>
        </span>
        <button type="button" onClick={abmelden} className="link-button">
          Abmelden
        </button>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(aktuellesTheme());
  const dunkel = theme === 'dark';
  function umschalten() {
    const neu: Theme = dunkel ? 'light' : 'dark';
    setzeTheme(neu);
    setTheme(neu);
  }
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={umschalten}
      title={dunkel ? 'Heller Modus' : 'Dunkler Modus'}
      aria-label={dunkel ? 'Heller Modus' : 'Dunkler Modus'}
    >
      {dunkel ? '☀️' : '🌙'}
    </button>
  );
}

function rolleLabel(r: string): string {
  return r === 'admin' ? 'Administration' : r === 'klassenleitung' ? 'Klassenleitung' : 'Fachlehrkraft';
}

export function App() {
  const { token, ident } = useAuth();

  if (!token) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <NavBar />
      <main className="content">
        <Routes>
          <Route path="/eingabe" element={<EingabePage />} />
          <Route path="/zeugnis" element={<ZeugnisPage />} />
          <Route
            path="/admin"
            element={ident?.rolle === 'admin' ? <AdminPage /> : <Navigate to="/eingabe" replace />}
          />
          <Route path="*" element={<Navigate to="/eingabe" replace />} />
        </Routes>
      </main>
    </>
  );
}
