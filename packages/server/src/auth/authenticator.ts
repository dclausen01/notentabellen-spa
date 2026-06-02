/**
 * Abstraktion der Authentifizierung, damit die App ohne echten LDAP-Server
 * testbar bleibt. Die echte Implementierung (LDAP-Bind gegen das AD) liegt in
 * `ldap.ts`; Tests nutzen einen Fake.
 */
export interface AuthErgebnis {
  /** Stabile, eindeutige Kennung aus dem Verzeichnis (z. B. sAMAccountName). */
  loginSub: string;
  /** Anzeigename, falls vom Verzeichnis geliefert. */
  name?: string;
}

export interface Authenticator {
  /** Prüft Anmeldedaten. Gibt bei Erfolg die Kennung zurück, sonst `null`. */
  authenticate(benutzername: string, passwort: string): Promise<AuthErgebnis | null>;
}

/** Einfacher In-Memory-Authenticator für Tests und lokale Entwicklung. */
export class FakeAuthenticator implements Authenticator {
  constructor(
    private readonly nutzer: Record<string, { passwort: string; name?: string }>,
  ) {}

  async authenticate(benutzername: string, passwort: string): Promise<AuthErgebnis | null> {
    const eintrag = this.nutzer[benutzername];
    if (!eintrag || eintrag.passwort !== passwort) return null;
    return eintrag.name !== undefined
      ? { loginSub: benutzername, name: eintrag.name }
      : { loginSub: benutzername };
  }
}
