export { openDb, type DB } from './db/connection.js';
export { migrate } from './db/migrate.js';
export { ladeSchema } from './db/lade-schema.js';
export { seed } from './seed/seed.js';
export { baueKonfiguration } from './seed/konfiguration.js';
export type {
  Konfiguration,
  SchemaCfg,
  KomponenteCfg,
  FachCfg,
  BildungsgangSchluessel,
} from './seed/konfiguration.js';
