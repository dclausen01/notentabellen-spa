-- Abschlusszeugnis (4. Hj.) + Prüfungsnoten.
-- Prüfungsnoten werden separat erfasst (eigene Tabelle) und je nach Fach nur
-- angezeigt (LF2/LF3/Deutsch) oder in die Endnote verrechnet (Englisch/Mathe
-- FHR, über die vorhandenen Gewichte gewicht_aktuell/gewicht_extern).

CREATE TABLE pruefungsnote (
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

-- 1 = in diesem (Fach,Bildungsgang,Halbjahr) wird eine Prüfungsnote erfasst.
ALTER TABLE bewertungsschema ADD COLUMN pruefung INTEGER DEFAULT 0;
-- 1 = Prüfung fließt in die Endnote ein (über gewicht_aktuell/gewicht_extern).
ALTER TABLE bewertungsschema ADD COLUMN pruefung_verrechnen INTEGER DEFAULT 0;
-- 1 = diese (Fach,Halbjahr)-Position erscheint im Abschlusszeugnis (4. Hj.).
ALTER TABLE bewertungsschema ADD COLUMN abschluss_zeigen INTEGER DEFAULT 0;
