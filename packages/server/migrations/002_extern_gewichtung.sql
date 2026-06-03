-- M7-Korrektur: Praxis-Endnote PiA (4. Hj.) = 0,7·Praxis(4.) + 0,3·Blockpraxis(3.).
-- Die Verrechnung bezieht einen Wert aus einem ANDEREN Fach ein. Dafür speichern
-- wir am Bewertungsschema optional die Gewichte und die externe Quelle
-- (Fach + Halbjahr). Genutzt wird weiterhin kumulation_modus='gewichtet_vorgaenger'
-- (im "externen Modus", erkennbar an gesetzten Gewichten).

ALTER TABLE bewertungsschema ADD COLUMN gewicht_aktuell REAL;   -- z. B. 0.7
ALTER TABLE bewertungsschema ADD COLUMN gewicht_extern  REAL;   -- z. B. 0.3
ALTER TABLE bewertungsschema ADD COLUMN extern_fach     TEXT;   -- Quellfach-Schlüssel, z. B. 'BLOCKPRAXIS'
ALTER TABLE bewertungsschema ADD COLUMN extern_halbjahr INTEGER; -- Quell-Halbjahr, z. B. 3
