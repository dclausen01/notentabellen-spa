export { openDb, type DB } from './db/connection.js';
export { migrate } from './db/migrate.js';
export { ladeSchema } from './db/lade-schema.js';
export { ladeEingaben, bildungsgangVonSchueler, fachId } from './db/lade-eingaben.js';
export { speichereKomponentennote, speichereDirektnote } from './db/noten.js';
export {
  erstelleKlasse,
  erstelleSchueler,
  listeKlassen,
  listeSchueler,
} from './db/stammdaten.js';
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
export { baueApp } from './api/app.js';
export type {
  Konfiguration,
  SchemaCfg,
  KomponenteCfg,
  FachCfg,
  BildungsgangSchluessel,
} from './seed/konfiguration.js';
