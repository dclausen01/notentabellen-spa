import type { DB } from './connection.js';

export interface KomponentennoteInput {
  schuelerId: number;
  komponenteId: number;
  halbjahr: number;
  wert: number | null;
  istNa: boolean;
  geaendertVon?: number | null;
}

export interface DirektnoteInput {
  schuelerId: number;
  fachId: number;
  halbjahr: number;
  wert: number | null;
  istNa: boolean;
  geaendertVon?: number | null;
}

function audit(
  db: DB,
  akteur: number | null | undefined,
  aktion: string,
  entitaet: string,
  entitaetId: number,
  neu: unknown,
): void {
  db.prepare(
    `INSERT INTO audit_log (akteur_id, aktion, entitaet, entitaet_id, neu, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(akteur ?? null, aktion, entitaet, entitaetId, JSON.stringify(neu), new Date().toISOString());
}

/** Speichert/aktualisiert eine Komponentennote (Upsert) und protokolliert die Änderung. */
export function speichereKomponentennote(db: DB, n: KomponentennoteInput): void {
  const ts = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO komponentennote
       (schueler_id, komponente_id, halbjahr, wert, ist_na, geaendert_von, geaendert_am)
     VALUES (@schuelerId, @komponenteId, @halbjahr, @wert, @istNa, @geaendertVon, @ts)
     ON CONFLICT(schueler_id, komponente_id, halbjahr) DO UPDATE SET
       wert = excluded.wert, ist_na = excluded.ist_na,
       geaendert_von = excluded.geaendert_von, geaendert_am = excluded.geaendert_am`,
  );
  const tx = db.transaction(() => {
    stmt.run({
      schuelerId: n.schuelerId,
      komponenteId: n.komponenteId,
      halbjahr: n.halbjahr,
      wert: n.istNa ? null : n.wert,
      istNa: n.istNa ? 1 : 0,
      geaendertVon: n.geaendertVon ?? null,
      ts,
    });
    audit(db, n.geaendertVon, 'komponentennote_set', 'komponentennote', n.komponenteId, n);
  });
  tx();
}

/** Speichert/aktualisiert eine direkte Fachnote (Upsert) und protokolliert die Änderung. */
export function speichereDirektnote(db: DB, n: DirektnoteInput): void {
  const ts = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO fachnote_direkt
       (schueler_id, fach_id, halbjahr, wert, ist_na, geaendert_von, geaendert_am)
     VALUES (@schuelerId, @fachId, @halbjahr, @wert, @istNa, @geaendertVon, @ts)
     ON CONFLICT(schueler_id, fach_id, halbjahr) DO UPDATE SET
       wert = excluded.wert, ist_na = excluded.ist_na,
       geaendert_von = excluded.geaendert_von, geaendert_am = excluded.geaendert_am`,
  );
  const tx = db.transaction(() => {
    stmt.run({
      schuelerId: n.schuelerId,
      fachId: n.fachId,
      halbjahr: n.halbjahr,
      wert: n.istNa ? null : n.wert,
      istNa: n.istNa ? 1 : 0,
      geaendertVon: n.geaendertVon ?? null,
      ts,
    });
    audit(db, n.geaendertVon, 'fachnote_direkt_set', 'fachnote_direkt', n.fachId, n);
  });
  tx();
}
