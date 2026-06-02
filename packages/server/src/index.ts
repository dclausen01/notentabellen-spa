export { openDb, type DB } from './db/connection.js';
export { migrate } from './db/migrate.js';
export { ladeSchema } from './db/lade-schema.js';
export { ladeEingaben, bildungsgangVonSchueler, fachId } from './db/lade-eingaben.js';
export { speichereKomponentennote, speichereDirektnote } from './db/noten.js';
export {
  erstelleKlasse,
  erstelleSchueler,
  erstelleLehrkraft,
  erstelleLehrauftrag,
  setzeKlassenleitung,
  listeKlassen,
  listeSchueler,
  type Rolle,
} from './db/stammdaten.js';
export { type Authenticator, type AuthErgebnis, FakeAuthenticator } from './auth/authenticator.js';
export { LdapAuthenticator, ldapConfigAusEnv, type LdapConfig } from './auth/ldap.js';
export { seed } from './seed/seed.js';
export { baueKonfiguration } from './seed/konfiguration.js';
export {
  berechneFachFuerSchueler,
  speichereErgebnisse,
  berechneKlasse,
  zeugnisFuerKlasse,
  faecherFuerBildungsgang,
} from './services/berechnung.js';
export { baueEingabemaske } from './services/eingabemaske.js';
export { baueApp, type AppOptions } from './api/app.js';
export type {
  Konfiguration,
  SchemaCfg,
  KomponenteCfg,
  FachCfg,
  BildungsgangSchluessel,
} from './seed/konfiguration.js';
