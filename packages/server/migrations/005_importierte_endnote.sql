-- Übernommene (historische) Endnoten pro (Schüler, Fach, Halbjahr).
-- Wird genutzt, um bereits berechnete Noten aus Altjahrgängen zu importieren,
-- wenn keine Teilnoten vorliegen. Ist eine solche Endnote gesetzt, gilt sie als
-- maßgeblich (keine Neuberechnung) und dient als Basis für die Kumulation der
-- Folgehalbjahre.
CREATE TABLE importierte_endnote (
  id            INTEGER PRIMARY KEY,
  schueler_id   INTEGER NOT NULL REFERENCES schueler(id),
  fach_id       INTEGER NOT NULL REFERENCES fach(id),
  halbjahr      INTEGER NOT NULL CHECK (halbjahr BETWEEN 1 AND 4),
  wert          REAL NOT NULL CHECK (wert BETWEEN 0 AND 15),
  geaendert_von INTEGER REFERENCES lehrkraft(id),
  geaendert_am  TEXT,
  UNIQUE (schueler_id, fach_id, halbjahr)
);
