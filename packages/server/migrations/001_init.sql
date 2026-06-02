-- Initiales Schema (M2). Siehe docs/UMSETZUNGSPLAN.md Abschnitt 2.
-- SQLite; Fremdschlüssel werden in der Verbindung per PRAGMA aktiviert.

-- === Stammdaten & Zugriff ===

CREATE TABLE bildungsgang (
  id          INTEGER PRIMARY KEY,
  schluessel  TEXT NOT NULL UNIQUE,          -- 'SPA_REGULAR' | 'SPA_PIA'
  bezeichnung TEXT NOT NULL
);

CREATE TABLE klasse (
  id             INTEGER PRIMARY KEY,
  bezeichnung    TEXT NOT NULL,
  schuljahr      TEXT NOT NULL,
  bildungsgang_id INTEGER NOT NULL REFERENCES bildungsgang(id),
  UNIQUE (bezeichnung, schuljahr)
);

CREATE TABLE schueler (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  vorname   TEXT NOT NULL,
  klasse_id INTEGER NOT NULL REFERENCES klasse(id),
  aktiv     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE lehrkraft (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  login_sub TEXT NOT NULL UNIQUE,            -- stabile SSO-Kennung (sub-Claim / LDAP-DN)
  rolle     TEXT NOT NULL CHECK (rolle IN ('fach', 'klassenleitung', 'admin'))
);

-- === Konfiguration der Bewertung ===

CREATE TABLE fach (
  id         INTEGER PRIMARY KEY,
  schluessel TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  typ        TEXT NOT NULL CHECK (typ IN ('LF', 'FACH'))
);

CREATE TABLE bewertungsschema (
  id                  INTEGER PRIMARY KEY,
  fach_id             INTEGER NOT NULL REFERENCES fach(id),
  bildungsgang_id     INTEGER NOT NULL REFERENCES bildungsgang(id),
  halbjahr            INTEGER NOT NULL CHECK (halbjahr BETWEEN 1 AND 4),
  halbjahr_modus      TEXT NOT NULL CHECK (halbjahr_modus IN ('komponenten_gewichtet', 'direkt')),
  kumulation_modus    TEXT NOT NULL CHECK (kumulation_modus IN
                        ('fortlaufend_50_50', 'keine', 'gewichtet_vorgaenger', 'mittelwert_halbjahre')),
  deaktivierbar       INTEGER NOT NULL DEFAULT 0,
  aktiv               INTEGER NOT NULL DEFAULT 1,
  mittelwert_halbjahre TEXT,                 -- CSV der Halbjahre, nur bei 'mittelwert_halbjahre'
  UNIQUE (fach_id, bildungsgang_id, halbjahr)
);

CREATE TABLE komponente (
  id          INTEGER PRIMARY KEY,
  schema_id   INTEGER NOT NULL REFERENCES bewertungsschema(id) ON DELETE CASCADE,
  schluessel  TEXT NOT NULL,
  name        TEXT NOT NULL,
  gewicht_fix REAL,                          -- festes Gewicht ODER NULL
  rest_anteil INTEGER NOT NULL DEFAULT 0,    -- 1 = nimmt am Restbudget teil
  sortierung  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (schema_id, schluessel),
  CHECK (gewicht_fix IS NOT NULL OR rest_anteil = 1)
);

CREATE TABLE notenskala (
  punkte   INTEGER PRIMARY KEY CHECK (punkte BETWEEN 0 AND 15),
  notentext TEXT NOT NULL
);

CREATE TABLE wpk_kurs (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  aktiv INTEGER NOT NULL DEFAULT 1
);

-- === Zugriffssteuerung ===

CREATE TABLE lehrauftrag (
  id          INTEGER PRIMARY KEY,
  lehrkraft_id INTEGER NOT NULL REFERENCES lehrkraft(id),
  fach_id     INTEGER NOT NULL REFERENCES fach(id),
  klasse_id   INTEGER NOT NULL REFERENCES klasse(id),
  halbjahr    INTEGER NOT NULL CHECK (halbjahr BETWEEN 1 AND 4),
  UNIQUE (lehrkraft_id, fach_id, klasse_id, halbjahr)
);

CREATE TABLE klassenleitung (
  id          INTEGER PRIMARY KEY,
  lehrkraft_id INTEGER NOT NULL REFERENCES lehrkraft(id),
  klasse_id   INTEGER NOT NULL REFERENCES klasse(id),
  UNIQUE (lehrkraft_id, klasse_id)
);

-- === Eingaben & Ergebnisse (ab M3 genutzt) ===

CREATE TABLE komponentennote (
  id            INTEGER PRIMARY KEY,
  schueler_id   INTEGER NOT NULL REFERENCES schueler(id),
  komponente_id INTEGER NOT NULL REFERENCES komponente(id),
  halbjahr      INTEGER NOT NULL CHECK (halbjahr BETWEEN 1 AND 4),
  wert          REAL,                        -- 0..15 oder NULL bei n/a
  ist_na        INTEGER NOT NULL DEFAULT 0,
  geaendert_von INTEGER REFERENCES lehrkraft(id),
  geaendert_am  TEXT,
  UNIQUE (schueler_id, komponente_id, halbjahr),
  CHECK (wert IS NULL OR (wert BETWEEN 0 AND 15))
);

CREATE TABLE fachnote_direkt (
  id            INTEGER PRIMARY KEY,
  schueler_id   INTEGER NOT NULL REFERENCES schueler(id),
  fach_id       INTEGER NOT NULL REFERENCES fach(id),
  halbjahr      INTEGER NOT NULL CHECK (halbjahr BETWEEN 1 AND 4),
  wert          REAL,
  ist_na        INTEGER NOT NULL DEFAULT 0,
  geaendert_von INTEGER REFERENCES lehrkraft(id),
  geaendert_am  TEXT,
  UNIQUE (schueler_id, fach_id, halbjahr),
  CHECK (wert IS NULL OR (wert BETWEEN 0 AND 15))
);

CREATE TABLE wpk_eingabe (
  id          INTEGER PRIMARY KEY,
  schueler_id INTEGER NOT NULL REFERENCES schueler(id),
  halbjahr    INTEGER NOT NULL CHECK (halbjahr BETWEEN 1 AND 4),
  wpk_kurs_id INTEGER NOT NULL REFERENCES wpk_kurs(id),
  wert        REAL,
  UNIQUE (schueler_id, halbjahr),
  CHECK (wert IS NULL OR (wert BETWEEN 0 AND 15))
);

CREATE TABLE ergebnis (
  id           INTEGER PRIMARY KEY,
  schueler_id  INTEGER NOT NULL REFERENCES schueler(id),
  fach_id      INTEGER NOT NULL REFERENCES fach(id),
  halbjahr     INTEGER NOT NULL CHECK (halbjahr BETWEEN 1 AND 4),
  zwischennote REAL,
  endpunkte    REAL,
  tendenz      TEXT,
  berechnet_am TEXT,
  UNIQUE (schueler_id, fach_id, halbjahr)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  akteur_id   INTEGER REFERENCES lehrkraft(id),
  aktion      TEXT NOT NULL,
  entitaet    TEXT NOT NULL,
  entitaet_id INTEGER,
  alt         TEXT,
  neu         TEXT,
  ts          TEXT NOT NULL
);

CREATE INDEX idx_schema_fach_bg ON bewertungsschema (fach_id, bildungsgang_id);
CREATE INDEX idx_komponente_schema ON komponente (schema_id);
CREATE INDEX idx_kompnote_schueler ON komponentennote (schueler_id, halbjahr);
CREATE INDEX idx_direktnote_schueler ON fachnote_direkt (schueler_id, halbjahr);
