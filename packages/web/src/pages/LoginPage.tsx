import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api.js';
import { useAuth } from '../auth.js';

export function LoginPage() {
  const { anmelden } = useAuth();
  const navigate = useNavigate();
  const [benutzername, setBenutzername] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    setLaeuft(true);
    try {
      await anmelden(benutzername, passwort);
      navigate('/eingabe', { replace: true });
    } catch (err) {
      setFehler(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={absenden}>
        <h1>Notenverwaltung SPA</h1>
        <p className="muted">Bitte mit dem Schul-Account (AD) anmelden.</p>
        <label>
          Benutzername
          <input
            value={benutzername}
            onChange={(e) => setBenutzername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {fehler && <p className="fehler" role="alert">{fehler}</p>}
        <button type="submit" disabled={laeuft || !benutzername || !passwort}>
          {laeuft ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
