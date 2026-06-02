import Fastify, { type FastifyInstance } from 'fastify';
import type { DB } from '../db/connection.js';
import { fachId } from '../db/lade-eingaben.js';
import { speichereDirektnote, speichereKomponentennote } from '../db/noten.js';
import { listeKlassen, listeSchueler } from '../db/stammdaten.js';
import {
  berechneFachFuerSchueler,
  berechneKlasse,
  zeugnisFuerKlasse,
} from '../services/berechnung.js';
import { baueEingabemaske } from '../services/eingabemaske.js';

function zahl(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Baut die Fastify-App über einer gegebenen DB-Verbindung. Auth folgt in M4;
 * bis dahin sind die Routen offen (nur lokal/getestet einsetzen).
 */
export function baueApp(db: DB): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  // --- Stammdaten ---
  app.get('/api/klassen', async () => listeKlassen(db));

  app.get('/api/klassen/:id/schueler', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    return listeSchueler(db, id);
  });

  // --- Eingabemaske ---
  app.get('/api/eingabe', async (req, reply) => {
    const q = req.query as { klasseId?: string; fach?: string; halbjahr?: string };
    const klasseId = zahl(q.klasseId);
    const halbjahr = zahl(q.halbjahr);
    if (klasseId === undefined || halbjahr === undefined || !q.fach) {
      return reply.code(400).send({ fehler: 'klasseId, fach und halbjahr erforderlich' });
    }
    try {
      return baueEingabemaske(db, klasseId, q.fach, halbjahr);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  // --- Noten speichern ---
  app.put('/api/noten/komponente', async (req, reply) => {
    const b = req.body as Partial<{
      schuelerId: number;
      komponenteId: number;
      halbjahr: number;
      wert: number | null;
      istNa: boolean;
    }>;
    if (
      b.schuelerId === undefined ||
      b.komponenteId === undefined ||
      b.halbjahr === undefined
    ) {
      return reply.code(400).send({ fehler: 'schuelerId, komponenteId, halbjahr erforderlich' });
    }
    if (!b.istNa && b.wert != null && (b.wert < 0 || b.wert > 15)) {
      return reply.code(400).send({ fehler: 'Wert muss zwischen 0 und 15 liegen' });
    }
    speichereKomponentennote(db, {
      schuelerId: b.schuelerId,
      komponenteId: b.komponenteId,
      halbjahr: b.halbjahr,
      wert: b.wert ?? null,
      istNa: b.istNa ?? false,
    });
    return reply.code(204).send();
  });

  app.put('/api/noten/direkt', async (req, reply) => {
    const b = req.body as Partial<{
      schuelerId: number;
      fach: string;
      halbjahr: number;
      wert: number | null;
      istNa: boolean;
    }>;
    if (b.schuelerId === undefined || !b.fach || b.halbjahr === undefined) {
      return reply.code(400).send({ fehler: 'schuelerId, fach, halbjahr erforderlich' });
    }
    if (!b.istNa && b.wert != null && (b.wert < 0 || b.wert > 15)) {
      return reply.code(400).send({ fehler: 'Wert muss zwischen 0 und 15 liegen' });
    }
    let fId: number;
    try {
      fId = fachId(db, b.fach);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
    speichereDirektnote(db, {
      schuelerId: b.schuelerId,
      fachId: fId,
      halbjahr: b.halbjahr,
      wert: b.wert ?? null,
      istNa: b.istNa ?? false,
    });
    return reply.code(204).send();
  });

  // --- Berechnung & Zeugnis ---
  app.get('/api/schueler/:id/fach/:fach', async (req, reply) => {
    const p = req.params as { id: string; fach: string };
    const id = zahl(p.id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Schüler-ID' });
    try {
      return berechneFachFuerSchueler(db, id, p.fach);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  app.post('/api/klassen/:id/berechnung', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    try {
      const anzahl = berechneKlasse(db, id);
      return { gespeicherteErgebnisse: anzahl };
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  app.get('/api/zeugnis', async (req, reply) => {
    const q = req.query as { klasseId?: string; halbjahr?: string };
    const klasseId = zahl(q.klasseId);
    const halbjahr = zahl(q.halbjahr);
    if (klasseId === undefined || halbjahr === undefined) {
      return reply.code(400).send({ fehler: 'klasseId und halbjahr erforderlich' });
    }
    try {
      return zeugnisFuerKlasse(db, klasseId, halbjahr);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  return app;
}
