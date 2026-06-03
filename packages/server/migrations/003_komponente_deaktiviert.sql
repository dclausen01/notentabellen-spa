-- N4: Pro Klasse können einzelne (Rest-)Komponenten eines LF deaktiviert
-- werden — je Halbjahr, da jede Komponente an genau ein (Fach,Bildungsgang,
-- Halbjahr)-Schema gebunden ist. Vorhandensein einer Zeile = deaktiviert;
-- fehlt sie, ist die Komponente aktiv (Default). Die Berechnung verteilt das
-- Restbudget automatisch auf die verbleibenden aktiven Rest-Komponenten.

CREATE TABLE komponente_deaktiviert (
  klasse_id     INTEGER NOT NULL REFERENCES klasse(id),
  komponente_id INTEGER NOT NULL REFERENCES komponente(id),
  PRIMARY KEY (klasse_id, komponente_id)
);
