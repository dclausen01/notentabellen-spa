import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.js';
import { LoginPage } from './pages/LoginPage.js';
import { EingabePage } from './pages/EingabePage.js';
import { ZeugnisPage } from './pages/ZeugnisPage.js';

function NavBar() {
  const { ident, abmelden } = useAuth();
  if (!ident) return null;
  const darfZeugnis = ident.rolle !== 'fach';
  return (
    <header className="navbar">
      <div className="navbar-brand">Notenverwaltung SPA</div>
      <nav className="navbar-links">
        <NavLink to="/eingabe">Noteneingabe</NavLink>
        {darfZeugnis && <NavLink to="/zeugnis">Zeugnis</NavLink>}
      </nav>
      <div className="navbar-user">
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

function rolleLabel(r: string): string {
  return r === 'admin' ? 'Administration' : r === 'klassenleitung' ? 'Klassenleitung' : 'Fachlehrkraft';
}

export function App() {
  const { token } = useAuth();

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
          <Route path="*" element={<Navigate to="/eingabe" replace />} />
        </Routes>
      </main>
    </>
  );
}
