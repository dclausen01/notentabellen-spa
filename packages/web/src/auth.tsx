import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setAuthFehlerHandler, setToken } from './api.js';
import type { Identitaet } from './types.js';

interface AuthState {
  token: string | null;
  ident: Identitaet | null;
  anmelden: (benutzername: string, passwort: string) => Promise<void>;
  abmelden: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const SPEICHER = 'notenverwaltung.auth';

interface Persistiert {
  token: string;
  ident: Identitaet;
}

function laden(): Persistiert | null {
  try {
    const roh = localStorage.getItem(SPEICHER);
    return roh ? (JSON.parse(roh) as Persistiert) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [ident, setIdent] = useState<Identitaet | null>(null);

  useEffect(() => {
    const p = laden();
    if (p) {
      setTokenState(p.token);
      setIdent(p.ident);
      setToken(p.token);
    }
    setAuthFehlerHandler(() => {
      setTokenState(null);
      setIdent(null);
      setToken(null);
      localStorage.removeItem(SPEICHER);
    });
  }, []);

  const wert = useMemo<AuthState>(
    () => ({
      token,
      ident,
      async anmelden(benutzername, passwort) {
        const antwort = await api.login(benutzername, passwort);
        const neueIdent: Identitaet = {
          lehrkraftId: 0,
          rolle: antwort.rolle,
          name: antwort.name,
        };
        setToken(antwort.token);
        setTokenState(antwort.token);
        setIdent(neueIdent);
        localStorage.setItem(
          SPEICHER,
          JSON.stringify({ token: antwort.token, ident: neueIdent }),
        );
      },
      abmelden() {
        setToken(null);
        setTokenState(null);
        setIdent(null);
        localStorage.removeItem(SPEICHER);
      },
    }),
    [token, ident],
  );

  return <AuthContext.Provider value={wert}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth außerhalb des AuthProvider');
  return ctx;
}
