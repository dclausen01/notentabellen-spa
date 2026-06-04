import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
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
import {
  komponentenKonfig,
  istRestKomponente,
  setzeKomponenteAktiv,
} from '../db/komponenten.js';
import {
  speichereDirektnote,
  speichereKomponentennote,
  speicherePruefungsnote,
} from '../db/noten.js';
import {
  erstelleKlasse,
  erstelleLehrauftrag,
  erstelleLehrkraft,
  erstelleSchueler,
  listeKlassen,
  listeSchueler,
  setzeKlassenleitung,
  type Rolle,
} from '../db/stammdaten.js';
import {
  aktiveHalbjahreFuerFachKlasse,
  aktualisiereLehrkraftName,
  aktualisiereSchueler,
  deaktiviereSchueler,
  loescheKlasse,
  loescheSchuelerHart,
  entferneKlassenleitung,
  entferneLehrauftrag,
  erstelleWpkKurs,
  klassenleitungenVonLehrkraft,
  lehrauftraegeVonLehrkraft,
  listeBildungsgaenge,
  listeFaecher,
  listeLehrkraefte,
  listeWpkKurse,
  schemaUebersicht,
  setzeLehrkraftRolle,
  setzeWpkKursAktiv,
  speichereWpkKurs,
} from '../db/admin.js';
import {
  berechneFachFuerSchueler,
  berechneKlasse,
  vorwerteFuer,
  zeugnisFuerKlasse,
} from '../services/berechnung.js';
import { baueEingabemaske } from '../services/eingabemaske.js';
import { faecherFuerKlasse } from '../services/faecher.js';
import { exportDateiname, zeugnisAlsXlsx } from '../services/export.js';
import { importiereLehrkraefte, importiereSchueler } from '../services/import.js';
import { importiereNoten } from '../services/import-noten.js';

export interface AppOptions {
  db: DB;
  authenticator: Authenticator;
  jwtSecret: string;
  /** Verzeichnis mit dem gebauten Frontend (packages/web/dist). Optional. */
  webRoot?: string;
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

// Öffentliche API-Routen (ohne Token erreichbar). Statische Dateien und das
// SPA-Frontend (alles außerhalb von /api/) sind generell öffentlich.
const OEFFENTLICH = new Set(['/api/auth/login']);

export function baueApp({ db, authenticator, jwtSecret, webRoot }: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: jwtSecret });

  // Gebautes Frontend mitausliefern, falls vorhanden — dann läuft alles auf
  // einem Port ohne Dev-Proxy. wildcard:false lässt unbekannte Pfade in den
  // NotFound-Handler laufen (SPA-Fallback auf index.html).
  if (webRoot) {
    app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      if (req.method !== 'GET' || url.startsWith('/api/')) {
        return reply.code(404).send({ fehler: 'Nicht gefunden' });
      }
      return reply.sendFile('index.html');
    });
  }

  // Authentifizierung: nur /api/-Routen (außer den öffentlichen) erfordern ein
  // gültiges Token. /health und statische Assets bleiben offen.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions.url ?? req.url;
    if (!url.startsWith('/api/') || OEFFENTLICH.has(url)) return;
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

  const ROLLEN: Rolle[] = ['fach', 'klassenleitung', 'admin'];

  app.get('/health', async () => ({ status: 'ok' }));

  // --- Login ---
  app.post('/api/auth/login', async (req, reply) => {
    const b = req.body as Partial<{ benutzername: string; passwort: string }>;
    if (!b.benutzername || !b.passwort) {
      return reply.code(400).send({ fehler: 'benutzername und passwort erforderlich' });
    }
    let auth;
    try {
      auth = await authenticator.authenticate(b.benutzername, b.passwort);
    } catch (e) {
      // Technische Fehler (z. B. LDAP/TLS nicht erreichbar) serverseitig
      // protokollieren, dem Client aber nur eine generische Meldung geben.
      console.error('Authentifizierung fehlgeschlagen (technischer Fehler):', e);
      return reply.code(500).send({ fehler: 'Anmeldedienst nicht erreichbar' });
    }
    if (!auth) return reply.code(401).send({ fehler: 'Anmeldung fehlgeschlagen' });

    const lk = lehrkraftVonLoginSub(db, auth.loginSub);
    if (!lk) {
      return reply
        .code(403)
        .send({ fehler: 'Kein Benutzerkonto in der Notenverwaltung hinterlegt' });
    }
    // Anzeigename aus dem AD übernehmen/aktualisieren — der Admin muss ihn nicht
    // selbst pflegen.
    let anzeigeName = lk.name;
    if (auth.name && auth.name !== lk.name) {
      aktualisiereLehrkraftName(db, lk.lehrkraftId, auth.name);
      anzeigeName = auth.name;
    }
    const token = await reply.jwtSign(
      { sub: auth.loginSub, lehrkraftId: lk.lehrkraftId, rolle: lk.rolle, name: anzeigeName } satisfies TokenPayload,
      { expiresIn: '12h' },
    );
    return { token, rolle: lk.rolle, name: anzeigeName };
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

  // --- LF-(Rest-)Komponenten je Klasse aktivieren/deaktivieren (KL der Klasse oder Admin) ---
  app.get('/api/klassen/:id/komponenten', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    const fach = (req.query as { fach?: string }).fach ?? 'LF3';
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    const me = ident(req);
    const darf = me.rolle === 'admin' || istKlassenleitung(db, me.lehrkraftId, id);
    if (!darf) return verboten(reply);
    return komponentenKonfig(db, id, fach);
  });

  app.put('/api/klassen/:id/komponenten', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    const me = ident(req);
    const darf = me.rolle === 'admin' || istKlassenleitung(db, me.lehrkraftId, id);
    if (!darf) return verboten(reply);
    const b = req.body as Partial<{ komponenteId: number; aktiv: boolean }>;
    if (b.komponenteId === undefined || typeof b.aktiv !== 'boolean') {
      return reply.code(400).send({ fehler: 'komponenteId und aktiv erforderlich' });
    }
    if (!istRestKomponente(db, b.komponenteId)) {
      return reply.code(400).send({ fehler: 'Nur Rest-Komponenten sind schaltbar' });
    }
    setzeKomponenteAktiv(db, id, b.komponenteId, b.aktiv);
    return reply.code(204).send();
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
      const maske = baueEingabemaske(db, klasseId, q.fach, halbjahr);
      const vorwerte = vorwerteFuer(db, klasseId, q.fach, halbjahr);
      return { ...maske, ...(vorwerte.label ? { vorwerte } : {}) };
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

  // Prüfungsnote (4. Hj.) speichern — nur wo das Schema eine Prüfung vorsieht.
  app.put('/api/noten/pruefung', async (req, reply) => {
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
    if (klasseId === undefined) return reply.code(404).send({ fehler: 'Schüler nicht gefunden' });
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
    // Nur erlaubt, wo das Schema eine Prüfung vorsieht.
    const erlaubt = db
      .prepare(
        `SELECT 1 FROM bewertungsschema
          WHERE fach_id = ? AND halbjahr = ? AND pruefung = 1
            AND bildungsgang_id = (SELECT bildungsgang_id FROM klasse WHERE id = ?)`,
      )
      .get(fId, b.halbjahr, klasseId);
    if (!erlaubt) {
      return reply.code(400).send({ fehler: 'Für dieses Fach/Halbjahr ist keine Prüfung vorgesehen' });
    }
    speicherePruefungsnote(db, {
      schuelerId: b.schuelerId,
      fachId: fId,
      halbjahr: b.halbjahr,
      wert: b.wert ?? null,
      istNa: b.istNa ?? false,
      geaendertVon: id.lehrkraftId,
    });
    return reply.code(204).send();
  });

  // WPK: belegten Kurs einer Schüler:in für ein Halbjahr setzen/entfernen.
  app.put('/api/noten/wpk-kurs', async (req, reply) => {
    const b = req.body as Partial<{
      schuelerId: number;
      halbjahr: number;
      wpkKursId: number | null;
    }>;
    if (b.schuelerId === undefined || b.halbjahr === undefined) {
      return reply.code(400).send({ fehler: 'schuelerId und halbjahr erforderlich' });
    }
    const klasseId = klasseVonSchueler(db, b.schuelerId);
    if (klasseId === undefined) return reply.code(404).send({ fehler: 'Schüler nicht gefunden' });
    const id = ident(req);
    if (id.rolle !== 'admin' && !hatLehrauftrag(db, id.lehrkraftId, 'WPK', klasseId, b.halbjahr)) {
      return verboten(reply);
    }
    speichereWpkKurs(db, b.schuelerId, b.halbjahr, b.wpkKursId ?? null);
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

  // Zeugnis-Export als XLSX (Klassenleitung der Klasse oder Admin).
  app.get('/api/zeugnis/export', async (req, reply) => {
    const q = req.query as { klasseId?: string; halbjahr?: string };
    const klasseId = zahl(q.klasseId);
    const halbjahr = zahl(q.halbjahr);
    if (klasseId === undefined || halbjahr === undefined) {
      return reply.code(400).send({ fehler: 'klasseId und halbjahr erforderlich' });
    }
    const me = ident(req);
    if (me.rolle !== 'admin' && !istKlassenleitung(db, me.lehrkraftId, klasseId)) return verboten(reply);
    try {
      const datei = exportDateiname(db, klasseId, halbjahr);
      const buf = await zeugnisAlsXlsx(db, klasseId, halbjahr);
      reply.header(
        'content-type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      reply.header('content-disposition', `attachment; filename="${datei}"`);
      return reply.send(buf);
    } catch (e) {
      return reply.code(404).send({ fehler: (e as Error).message });
    }
  });

  // ===================================================================
  // Administration (nur Rolle 'admin'). Pflege der Stammdaten und der
  // Login-/Zugriffsprovisionierung ohne direkten SQL-Zugriff.
  // ===================================================================

  // Gemeinsamer Admin-Schutz für alle /api/admin/*-Routen.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions.url ?? req.url;
    if (url.startsWith('/api/admin/') && !istAdmin(req)) return verboten(reply);
  });

  app.get('/api/admin/bildungsgaenge', async () => listeBildungsgaenge(db));
  app.get('/api/admin/faecher', async () => listeFaecher(db));

  // --- Klassen & Schüler:innen ---
  app.post('/api/admin/klassen', async (req, reply) => {
    const b = req.body as Partial<{ bezeichnung: string; schuljahr: string; bildungsgang: string }>;
    if (!b.bezeichnung || !b.schuljahr || !b.bildungsgang) {
      return reply.code(400).send({ fehler: 'bezeichnung, schuljahr und bildungsgang erforderlich' });
    }
    try {
      const id = erstelleKlasse(db, b.bezeichnung, b.schuljahr, b.bildungsgang);
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ fehler: konfliktText(e, 'Klasse existiert bereits') });
    }
  });

  app.delete('/api/admin/klassen/:id', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    loescheKlasse(db, id);
    return reply.code(204).send();
  });

  app.post('/api/admin/klassen/:id/schueler', async (req, reply) => {
    const klasseId = zahl((req.params as { id: string }).id);
    if (klasseId === undefined) return reply.code(400).send({ fehler: 'Ungültige Klassen-ID' });
    const b = req.body as Partial<{ name: string; vorname: string }>;
    if (!b.name || !b.vorname) {
      return reply.code(400).send({ fehler: 'name und vorname erforderlich' });
    }
    try {
      const id = erstelleSchueler(db, b.name, b.vorname, klasseId);
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ fehler: konfliktText(e, 'Schüler:in konnte nicht angelegt werden') });
    }
  });

  app.put('/api/admin/schueler/:id', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Schüler-ID' });
    const b = req.body as Partial<{ name: string; vorname: string }>;
    if (!b.name || !b.vorname) {
      return reply.code(400).send({ fehler: 'name und vorname erforderlich' });
    }
    aktualisiereSchueler(db, id, b.name.trim(), b.vorname.trim());
    return reply.code(204).send();
  });

  // ?hart=1 löscht endgültig (inkl. Noten), sonst nur deaktivieren.
  app.delete('/api/admin/schueler/:id', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Schüler-ID' });
    if ((req.query as { hart?: string }).hart === '1') loescheSchuelerHart(db, id);
    else deaktiviereSchueler(db, id);
    return reply.code(204).send();
  });

  // --- Lehrkräfte (Login-Provisionierung) ---
  app.get('/api/admin/lehrkraefte', async () => listeLehrkraefte(db));

  app.post('/api/admin/lehrkraefte', async (req, reply) => {
    const b = req.body as Partial<{ name: string; loginSub: string; rolle: Rolle }>;
    // Der Name ist optional — er wird beim ersten Login automatisch aus dem AD
    // übernommen. Pflicht sind nur Login-Kennung und Rolle.
    if (!b.loginSub || !b.rolle) {
      return reply.code(400).send({ fehler: 'loginSub und rolle erforderlich' });
    }
    if (!ROLLEN.includes(b.rolle)) {
      return reply.code(400).send({ fehler: 'Ungültige Rolle' });
    }
    try {
      const id = erstelleLehrkraft(db, (b.name ?? '').trim(), b.loginSub, b.rolle);
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ fehler: konfliktText(e, 'Login-Kennung bereits vergeben') });
    }
  });

  // Rolle einer Lehrkraft ändern (z. B. Fachlehrkraft <-> Klassenleitung).
  app.put('/api/admin/lehrkraefte/:id/rolle', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Lehrkraft-ID' });
    const b = req.body as Partial<{ rolle: Rolle }>;
    if (!b.rolle || !ROLLEN.includes(b.rolle)) {
      return reply.code(400).send({ fehler: 'Ungültige Rolle' });
    }
    setzeLehrkraftRolle(db, id, b.rolle);
    return reply.code(204).send();
  });

  app.get('/api/admin/lehrkraefte/:id/auftraege', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Lehrkraft-ID' });
    return {
      lehrauftraege: lehrauftraegeVonLehrkraft(db, id),
      klassenleitungen: klassenleitungenVonLehrkraft(db, id),
    };
  });

  // --- Lehraufträge ---
  // Ohne `halbjahr` wird der Auftrag standardmäßig für ALLE Halbjahre angelegt,
  // in denen das Fach im Bildungsgang der Klasse aktiv ist. Mit `halbjahr` nur
  // für dieses eine.
  app.post('/api/admin/lehrauftraege', async (req, reply) => {
    const b = req.body as Partial<{
      lehrkraftId: number;
      fach: string;
      klasseId: number;
      halbjahr: number;
    }>;
    if (b.lehrkraftId === undefined || !b.fach || b.klasseId === undefined) {
      return reply.code(400).send({ fehler: 'lehrkraftId, fach und klasseId erforderlich' });
    }
    if (b.halbjahr !== undefined && (b.halbjahr < 1 || b.halbjahr > 4)) {
      return reply.code(400).send({ fehler: 'halbjahr muss zwischen 1 und 4 liegen' });
    }
    const halbjahre =
      b.halbjahr !== undefined
        ? [b.halbjahr]
        : aktiveHalbjahreFuerFachKlasse(db, b.fach, b.klasseId);
    if (halbjahre.length === 0) {
      return reply
        .code(400)
        .send({ fehler: 'Fach ist für diese Klasse in keinem Halbjahr aktiv' });
    }
    try {
      for (const hj of halbjahre) erstelleLehrauftrag(db, b.lehrkraftId, b.fach, b.klasseId, hj);
      return reply.code(201).send({ ok: true, halbjahre });
    } catch (e) {
      return reply.code(400).send({ fehler: (e as Error).message });
    }
  });

  app.delete('/api/admin/lehrauftraege/:id', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Auftrags-ID' });
    entferneLehrauftrag(db, id);
    return reply.code(204).send();
  });

  // --- Klassenleitung ---
  app.post('/api/admin/klassenleitung', async (req, reply) => {
    const b = req.body as Partial<{ lehrkraftId: number; klasseId: number }>;
    if (b.lehrkraftId === undefined || b.klasseId === undefined) {
      return reply.code(400).send({ fehler: 'lehrkraftId und klasseId erforderlich' });
    }
    setzeKlassenleitung(db, b.lehrkraftId, b.klasseId);
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/admin/klassenleitung', async (req, reply) => {
    const q = req.query as { lehrkraftId?: string; klasseId?: string };
    const lehrkraftId = zahl(q.lehrkraftId);
    const klasseId = zahl(q.klasseId);
    if (lehrkraftId === undefined || klasseId === undefined) {
      return reply.code(400).send({ fehler: 'lehrkraftId und klasseId erforderlich' });
    }
    entferneKlassenleitung(db, lehrkraftId, klasseId);
    return reply.code(204).send();
  });

  // --- CSV-Import (Stammdaten) ---
  app.post('/api/admin/import/schueler', async (req, reply) => {
    const b = req.body as Partial<{ csv: string }>;
    if (!b.csv || !b.csv.trim()) return reply.code(400).send({ fehler: 'csv erforderlich' });
    return importiereSchueler(db, b.csv);
  });

  app.post('/api/admin/import/lehrkraefte', async (req, reply) => {
    const b = req.body as Partial<{ csv: string }>;
    if (!b.csv || !b.csv.trim()) return reply.code(400).send({ fehler: 'csv erforderlich' });
    return importiereLehrkraefte(db, b.csv);
  });

  // Noten-Import (historisch): Probelauf (commit=false) oder Übernahme (commit=true).
  app.post('/api/admin/import/noten', async (req, reply) => {
    const b = req.body as Partial<{ csv: string; commit: boolean }>;
    if (!b.csv || !b.csv.trim()) return reply.code(400).send({ fehler: 'csv erforderlich' });
    const id = ident(req);
    return importiereNoten(db, b.csv, { akteurId: id.lehrkraftId, commit: b.commit === true });
  });

  // --- Wahlpflichtkurse (WPK) verwalten ---
  app.get('/api/admin/wpk-kurse', async () => listeWpkKurse(db));

  app.post('/api/admin/wpk-kurse', async (req, reply) => {
    const b = req.body as Partial<{ name: string }>;
    if (!b.name || !b.name.trim()) {
      return reply.code(400).send({ fehler: 'name erforderlich' });
    }
    try {
      const id = erstelleWpkKurs(db, b.name.trim());
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ fehler: konfliktText(e, 'Kurs existiert bereits') });
    }
  });

  app.put('/api/admin/wpk-kurse/:id', async (req, reply) => {
    const id = zahl((req.params as { id: string }).id);
    if (id === undefined) return reply.code(400).send({ fehler: 'Ungültige Kurs-ID' });
    const b = req.body as Partial<{ aktiv: boolean }>;
    if (typeof b.aktiv !== 'boolean') {
      return reply.code(400).send({ fehler: 'aktiv (true/false) erforderlich' });
    }
    setzeWpkKursAktiv(db, id, b.aktiv);
    return reply.code(204).send();
  });

  // --- Bewertungsschemata (schreibgeschützte Übersicht) ---
  app.get('/api/admin/schemata', async (req, reply) => {
    const q = req.query as { bildungsgang?: string };
    if (!q.bildungsgang) return reply.code(400).send({ fehler: 'bildungsgang erforderlich' });
    return schemaUebersicht(db, q.bildungsgang);
  });

  return app;
}

/** Bei UNIQUE-Verstößen eine verständliche Meldung, sonst die Originalmeldung. */
function konfliktText(e: unknown, beiKonflikt: string): string {
  const msg = (e as Error).message ?? '';
  return msg.includes('UNIQUE') ? beiKonflikt : msg;
}
