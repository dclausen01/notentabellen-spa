import jwt from '@fastify/jwt';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Authenticator } from '../auth/authenticator.js';
import {
  hatLehrauftrag,
  istKlassenleitung,
  klasseVonSchueler,
  lehrkraftVonLoginSub,
  sichtbareKlassenIds,
  type Identitaet,
} from '../auth/zugriff.js';
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
import { faecherFuerKlasse } from '../services/faecher.js';

export interface AppOptions {
  db: DB;
  authenticator: Authenticator;
  jwtSecret: string;
}

interface TokenPayload {
  sub: string;
  lehrkraftId: number;
  rolle: Identitaet['rolle'];
  name: string;
}

function zahl(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const OEFFENTLICH = new Set(['/health', '/api/auth/login']);

export function baueApp({ db, authenticator, jwtSecret }: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: jwtSecret });

  // Authentifizierung: alle Routen außer den öffentlichen erfordern ein gültiges Token.
  app.addHook('onRequest', async (req, reply) => {
    if (OEFFENTLICH.has(req.routeOptions.url ?? req.url)) return;
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ fehler: 'Nicht authentifiziert' });
    }
  });

  const ident = (req: FastifyRequest): Identitaet => {
    const p = req.user as TokenPayload;
    return { lehrkraftId: p.lehrkraftId, rolle: p.rolle, name: p.name };
  };
  const istAdmin = (req: FastifyRequest) => (req.user as TokenPayload).rolle === 'admin';
  const darfKlasseSehen = (req: FastifyRequest, klasseId: number): boolean => {
    const ids = sichtbareKlassenIds(db, ident(req));
    return ids === 'alle' || ids.includes(klasseId);
  };
  const verboten = (reply: FastifyReply) => reply.code(403).send({ fehler: 'Kein Zugriff' });

  app.get('/health', async () => ({ status: 'ok' }));

  // --- Login ---
  app.post('/api/auth/login', async (req, reply) => {
    const b = req.body as Partial<{ benutzername: string; passwort: string }>;
    if (!b.benutzername || !b.passwort) {
      return reply.code(400).send({ fehler: 'benutzername und passwort erforderlich' });
    }
    const auth = await authenticator.authenticate(b.benutzername, b.passwort);
    if (!auth) return reply.code(401).send({ fehler: 'Anmeldung fehlgeschlagen' });

    const lk = lehrkraftVonLoginSub(db, auth.loginSub);
    if (!lk) {
      return reply
        .code(403)
        .send({ fehler: 'Kein Benutzerkonto in der Notenverwaltung hinterlegt' });
    }
    const token = await reply.jwtSign(
      { sub: auth.loginSub, lehrkraftId: lk.lehrkraftId, rolle: lk.rolle, name: lk.name } satisfies TokenPayload,
      { expiresIn: '12h' },
    );
    return { token, rolle: lk.rolle, name: lk.name };
  });

  app.get('/api/me', async (req) => ident(req));

  // --- Stammdaten (nach Sichtbarkeit gefiltert) ---
  app.get('/api/klassen', async (req) => {
    const ids = sichtbareKlassenIds(db, ident(req));
    const alle = listeKlassen(db);
    return ids === 'alle' ? alle : alle.filter((k) => ids.includes(k.id));
  });

  app.get('/api/klassen/:id/schueler', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    if (!darfKlasseSehen(req, id)) return verboten(reply);
    return listeSchueler(db, id);
  });

  // Rollenabhängige Fächerauswahl einer Klasse (für die Eingabemaske im Frontend).
  app.get('/api/klassen/:id/faecher', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    if (!darfKlasseSehen(req, id)) return verboten(reply);
    const me = ident(req);
    return faecherFuerKlasse(db, id, me, istKlassenleitung(db, me.lehrkraftId, id));
  });

  // --- Eingabemaske: Fachlehrkraft mit Auftrag, Klassenleitung der Klasse, Admin ---
  app.get('/api/eingabe', async (req, reply) => {
    const q = req.query as { klasseId?: string; fach?: string; halbjahr?: string };
    const klasseId = zahl(q.klasseId);
    const halbjahr = zahl(q.halbjahr);
    if (klasseId === undefined || halbjahr === undefined || !q.fach) {
      return reply.code(400).send({ fehler: 'klasseId, fach und halbjahr erforderlich' });
    }
    const id = ident(req);
    const erlaubt =
      id.rolle === 'admin' ||
      istKlassenleitung(db, id.lehrkraftId, klasseId) ||
      hatLehrauftrag(db, id.lehrkraftId, q.fach, klasseId, halbjahr);
    if (!erlaubt) return verboten(reply);
    try {
      return baueEingabemaske(db, klasseId, q.fach, halbjahr);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  // --- Noten speichern (nur mit passendem Lehrauftrag bzw. Admin) ---
  app.put('/api/noten/komponente', async (req, reply) => {
    const b = req.body as Partial<{
      schuelerId: number;
      komponenteId: number;
      halbjahr: number;
      wert: number | null;
      istNa: boolean;
    }>;
    if (b.schuelerId === undefined || b.komponenteId === undefined || b.halbjahr === undefined) {
      return reply.code(400).send({ fehler: 'schuelerId, komponenteId, halbjahr erforderlich' });
    }
    if (!b.istNa && b.wert != null && (b.wert < 0 || b.wert > 15)) {
      return reply.code(400).send({ fehler: 'Wert muss zwischen 0 und 15 liegen' });
    }
    const klasseId = klasseVonSchueler(db, b.schuelerId);
    const fachSchluessel = (
      db
        .prepare(
          `SELECT f.schluessel FROM komponente k
             JOIN bewertungsschema bs ON bs.id = k.schema_id
             JOIN fach f ON f.id = bs.fach_id WHERE k.id = ?`,
        )
        .get(b.komponenteId) as { schluessel: string } | undefined
    )?.schluessel;
    if (klasseId === undefined || !fachSchluessel) {
      return reply.code(404).send({ fehler: 'Schüler oder Komponente nicht gefunden' });
    }
    const id = ident(req);
    if (id.rolle !== 'admin' && !hatLehrauftrag(db, id.lehrkraftId, fachSchluessel, klasseId, b.halbjahr)) {
      return verboten(reply);
    }
    speichereKomponentennote(db, {
      schuelerId: b.schuelerId,
      komponenteId: b.komponenteId,
      halbjahr: b.halbjahr,
      wert: b.wert ?? null,
      istNa: b.istNa ?? false,
      geaendertVon: id.lehrkraftId,
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
    const klasseId = klasseVonSchueler(db, b.schuelerId);
    if (klasseId === undefined) {
      return reply.code(404).send({ fehler: 'Schüler nicht gefunden' });
    }
    const id = ident(req);
    if (id.rolle !== 'admin' && !hatLehrauftrag(db, id.lehrkraftId, b.fach, klasseId, b.halbjahr)) {
      return verboten(reply);
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
      geaendertVon: id.lehrkraftId,
    });
    return reply.code(204).send();
  });

  // --- Berechnung & Zeugnis (Klassenleitung der Klasse oder Admin) ---
  app.get('/api/schueler/:id/fach/:fach', async (req, reply) => {
    const p = req.params as { id: string; fach: string };
    const sId = zahl(p.id);
    if (sId === undefined) return reply.code(400).send({ fehler: 'Ungültige Schüler-ID' });
    const klasseId = klasseVonSchueler(db, sId);
    if (klasseId === undefined) return reply.code(404).send({ fehler: 'Schüler nicht gefunden' });
    const id = ident(req);
    const erlaubt =
      id.rolle === 'admin' ||
      istKlassenleitung(db, id.lehrkraftId, klasseId) ||
      db
        .prepare(
          `SELECT 1 FROM lehrauftrag la JOIN fach f ON f.id = la.fach_id
            WHERE la.lehrkraft_id = ? AND f.schluessel = ? AND la.klasse_id = ?`,
        )
        .get(id.lehrkraftId, p.fach, klasseId) !== undefined;
    if (!erlaubt) return verboten(reply);
    try {
      return berechneFachFuerSchueler(db, sId, p.fach);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  app.post('/api/klassen/:id/berechnung', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    const me = ident(req);
    if (me.rolle !== 'admin' && !istKlassenleitung(db, me.lehrkraftId, id)) return verboten(reply);
    try {
      return { gespeicherteErgebnisse: berechneKlasse(db, id) };
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
    const me = ident(req);
    if (me.rolle !== 'admin' && !istKlassenleitung(db, me.lehrkraftId, klasseId)) return verboten(reply);
    try {
      return zeugnisFuerKlasse(db, klasseId, halbjahr);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  return app;
}
