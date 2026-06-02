import { LdapAuthenticator, ldapConfigAusEnv } from '../auth/ldap.js';
import { ladeEnvDatei } from '../env.js';

/**
 * Diagnose-CLI: testet den LDAP-Login direkt (ohne Webserver/Passenger) und
 * gibt den vollständigen Fehler aus. Liest dieselbe Konfiguration wie der
 * Server (Umgebungsvariablen bzw. packages/server/.env).
 *
 * Aufruf: `npm run ldap-test -- <benutzername> <passwort>`
 *   bzw.   `node dist/cli/ldap-test.js <benutzername> <passwort>`
 */
ladeEnvDatei();

const benutzer = process.argv[2];
const passwort = process.argv[3];
if (!benutzer || !passwort) {
  console.error('Aufruf: npm run ldap-test -- <benutzername> <passwort>');
  process.exit(2);
}

async function main(benutzer: string, passwort: string): Promise<void> {
  const cfg = ldapConfigAusEnv();
  console.log('LDAP-Konfiguration:');
  console.log('  URL        :', cfg.url);
  console.log('  bindDn     :', cfg.bindDn);
  console.log('  baseDn     :', cfg.baseDn);
  console.log('  userFilter :', cfg.userFilter.replace('{{username}}', benutzer));
  console.log('  loginAttr  :', cfg.loginAttr);
  console.log(
    '  TLS        :',
    cfg.tlsOptions
      ? `rejectUnauthorized=${cfg.tlsOptions.rejectUnauthorized ?? true}, CA=${cfg.tlsOptions.ca ? 'gesetzt' : 'keine'}`
      : 'Standard (Prüfung an, System-CAs)',
  );
  console.log();

  const auth = new LdapAuthenticator(cfg);
  try {
    const erg = await auth.authenticate(benutzer, passwort);
    if (erg) {
      console.log('✅ Anmeldung erfolgreich:', erg);
      console.log(
        `\nHinweis: In der Notenverwaltung muss eine Lehrkraft mit login_sub = "${erg.loginSub}" angelegt sein.`,
      );
    } else {
      console.log(
        '⚠️  Anmeldung abgelehnt: Benutzer nicht gefunden, mehrdeutig oder Passwort falsch (kein technischer Fehler).',
      );
    }
  } catch (e) {
    console.error('❌ Technischer Fehler beim LDAP-Zugriff:');
    const err = e as { code?: string; message?: string };
    if (err.code) console.error('  code   :', err.code);
    if (err.message) console.error('  message:', err.message);
    console.error(e);
  }
}

await main(benutzer, passwort);
