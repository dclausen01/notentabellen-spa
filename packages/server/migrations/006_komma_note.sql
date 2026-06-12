-- Anzeige als ganze Komma-Note (z. B. „3,0") statt mit Tendenz (3+/3/3-).
-- Bisher im Code an 'WPK' gekoppelt; jetzt als Konfiguration am Schema.
ALTER TABLE bewertungsschema ADD COLUMN komma_note INTEGER DEFAULT 0;
