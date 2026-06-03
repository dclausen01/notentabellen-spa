# Umsetzungsplan — Notentabellen SPA

Stand: 2. Juni 2026 · Grundlage: [`Spezifikation.md`](Spezifikation.md) (v0.2)
und Analyse der drei Excel-Dateien (LF2-, LF3-Berechnung, Liste Zeugnis).

Dieser Plan ist die verbindliche Arbeitsgrundlage. Er übersetzt die
Spezifikation in ein konkretes Datenmodell, einen präzise definierten
Rechenkern, eine Architektur und einen Meilensteinplan. Zwischenstände werden
direkt nach `main` gepusht.

---

## 0. Getroffene Entscheidungen

| Thema | Entscheidung |
| --- | --- |
| Architektur | Eigene kleine Web-App, on-premise (Spec „Richtung B") |
| Sprache | TypeScript durchgängig (Backend + Frontend + Rechenkern) |
| Backend | Node.js + **Fastify** |
| Datenbank | **SQLite** (eine Datei, einfaches verschlüsseltes Backup) |
| Frontend | **React** (Vite) |
| Auth | **Nextcloud/LDAP-SSO** (OpenID Connect bzw. LDAP-Bind) |
| Tests | **Vitest**; Golden-Master-Verifikation gegen Excel-Sollwerte |
| Reihenfolge | **Rechenkern + Tests zuerst**, dann Persistenz/API, dann UI |
| Repo-Workflow | Commits direkt nach `main` |

---

## 1. Leitprinzipien

1. **Konfiguration statt Code.** Fächer, Komponenten, Gewichte, Modi,
   Notenskala und die Bildungsgang-Varianten sind **Daten** in der DB, keine
   if-Zweige im Code. Neue Lernfelder/geänderte Gewichte sind ein
   Konfigurations-, kein Programmiervorgang.
2. **Ein Rechenkern, deterministisch und rein.** Die gesamte Notenbildung
   liegt in `packages/core` als seiteneffektfreie Funktionen
   (Eingabe → Ergebnis). Keine DB-, keine HTTP-Abhängigkeit. Dadurch voll
   unit-testbar.
3. **Adressierung über Fach-IDs, nie über Spaltenpositionen.** Beseitigt die
   Excel-Fehlerquelle „verschobene Spalten".
4. **Ungerundet rechnen, nur am Ende runden.** `endpunkte` (ungerundet) ist
   die kumulierte Wahrheit; Tendenznote ist eine reine Anzeigeableitung.
5. **n/a ist ein eigener Zustand**, kein 0-Wert. Wird vor der
   Gewichtsverteilung herausgerechnet.

---

## 2. Datenmodell (SQLite-Schema)

Konkretisierung der Entitäten aus Spec Kap. 4. Tabellen (vereinfachte DDL,
Migrationsdetails in `packages/server/migrations`):

### 2.1 Stammdaten & Zugriff

```
bildungsgang        (id, schluessel, bezeichnung)          -- 'SPA_REGULAR' | 'SPA_PIA'
klasse              (id, bezeichnung, schuljahr, bildungsgang_id)
schueler            (id, name, vorname, klasse_id, aktiv)
lehrkraft           (id, name, login_sub, rolle)           -- rolle: 'fach' | 'klassenleitung' | 'admin'
lehrauftrag         (id, lehrkraft_id, fach_id, klasse_id, halbjahr)
klassenleitung      (id, lehrkraft_id, klasse_id)          -- KL liest alle Fächer der Klasse
```

### 2.2 Konfiguration der Bewertung

```
fach                (id, schluessel, name, typ)            -- typ: 'LF' | 'FACH'
fach_variante       (id, fach_id, bildungsgang_id, aktiv)  -- welcher Bildungsgang nutzt welches Fach
bewertungsschema    (id, fach_id, bildungsgang_id, halbjahr,
                     halbjahr_modus,                       -- 'komponenten_gewichtet' | 'direkt'
                     kumulation_modus,                     -- s. 3.2
                     deaktivierbar,                        -- bool (LF4-n/a-Schalter)
                     aktiv)                                -- ob Fach in diesem Hj. überhaupt belegt
komponente          (id, schema_id, schluessel, name,
                     gewicht_fix,                          -- z.B. 0.40 | NULL
                     rest_anteil)                          -- bool: nimmt am 60%-Restbudget teil
notenskala          (punkte INTEGER PK 0..15, notentext)   -- 15->'1+', ... 0->'6'
wpk_kurs            (id, name, aktiv)                       -- Tierpädagogik, OGS, ...
```

### 2.3 Eingaben & Ergebnisse

```
komponentennote     (id, schueler_id, komponente_id, halbjahr,
                     wert,                                 -- 0..15 oder NULL
                     ist_na,                               -- bool: "nicht belegt"
                     geaendert_von, geaendert_am)
fachnote_direkt     (id, schueler_id, fach_id, halbjahr,
                     wert, ist_na, geaendert_von, geaendert_am)  -- direkte Eingaben (LF1, LF4, Praxis, Fächer)
wpk_eingabe         (id, schueler_id, halbjahr, wpk_kurs_id, wert)
ergebnis            (id, schueler_id, fach_id, halbjahr,
                     zwischennote, endpunkte, tendenznote, berechnet_am)  -- abgeleitet, cache
audit_log           (id, akteur_id, aktion, entitaet, entitaet_id, alt, neu, ts)
```

> **Hinweis Komponenten vs. direkte Fächer:** Gewichtete Fächer (LF2, LF3)
> haben Komponenten und nutzen `komponentennote`. Direkte Fächer (LF1, LF4,
> Praxis, Deutsch …) haben genau eine „Komponente" bzw. nutzen
> `fachnote_direkt`. Implementierungsseitig lässt sich auch ein einheitlicher
> Weg wählen (jedes Fach hat ≥1 Komponente; „direkt" = eine Komponente mit
> Gewicht 1,0). **Designentscheidung in M1 final festziehen** — der Rechenkern
> arbeitet ohnehin nur auf einer abstrakten Komponentenliste.

---

## 3. Rechenkern (`packages/core`)

Der Kern ist eine reine Funktion. Vereinfachte Signatur:

```ts
berechneFach(input: {
  schema: SchemaProHalbjahr[];          // je Halbjahr: modus, kumulation, komponenten
  eingaben: EingabeProHalbjahr[];        // je Halbjahr: komponentenwerte | direktwert | n/a
  notenskala: Notenskala;
}): ErgebnisProHalbjahr[];               // je Halbjahr: zwischennote, endpunkte, tendenznote
```

### 3.1 Zwischennote pro Halbjahr

- **`halbjahr_modus = direkt`:** Zwischennote = der eingetragene Punktwert.
- **`halbjahr_modus = komponenten_gewichtet`:**
  1. Aktive Komponenten bestimmen (n/a ausgeschlossen).
  2. Feste Gewichte (`gewicht_fix`) übernehmen.
  3. Restbudget = `1 − Σ feste Gewichte aktiver Komponenten` (z. B. 0,60)
     gleichmäßig auf die aktiven `rest_anteil`-Komponenten verteilen.
  4. `Zwischennote = Σ (Gewicht_i · Punkte_i)` über aktive Komponenten.

  > Entspricht der Excel-Formel
  > `60%/(4 − Anzahl n/a)` für die LF3-Restverteilung. Wird eine feste
  > Komponente (Päd./Bericht) selbst n/a, fällt ihr Gewicht weg und das
  > Restbudget wächst entsprechend (**Sonderfall in Tests abdecken**, s. 8).

### 3.2 Endnote (kumulativ) — `kumulation_modus`

| Modus | Regel |
| --- | --- |
| `fortlaufend_50_50` | `End(1)=Zw(1)`; `End(Hj≥2)=0,5·End(Hj−1)+0,5·Zw(Hj)`. LF1–LF4. |
| `keine` | `End(Hj)=Zw(Hj)` (Deutsch, Englisch, WiPo, Religion, Mathematik). |
| `gewichtet_vorgaenger` | **Externer Modus** (Praxis PiA 4. Hj.): `End=0,7·Zw(Praxis 4.)+0,3·Wert(Blockpraxis 3.)` — Verrechnung über ein anderes Fach (Quelle + Gewichte als Konfiguration am Schema). |
| `mittelwert_halbjahre` | `End=Ø(ausgewählte Hj.)` (WPK = Ø 1.+2. Hj.). |

**Deaktivierbar (`flag: deaktivierbar`, LF4):** Ist ein Halbjahr auf n/a
gesetzt, wird `End(Hj)=End(Hj−1)` unverändert fortgeschrieben (kein neuer
Zwischenwert fließt ein). Bestätigt durch Zeugnis-Formel
`IF(... ="n/a", H_vorher, 0,5·G + 0,5·H_vorher)`.

### 3.3 Tendenznote

`Tendenznote(Hj) = notenskala[ round(endpunkte(Hj)) ]`, kaufmännisch gerundet
(round-half-up). Bei „keine Note" → `-`.

### 3.4 In den Excel-Dateien gefundene Abweichungen (zur Bestätigung)

Beim Auslesen der Originaldateien sind zwei Punkte aufgefallen, die das neue,
zentrale Modell **automatisch korrigiert** — bitte fachlich bestätigen (s.
Abschnitt 11):

1. **LF3, 3. Hj., Tendenznote** rundet im Excel die **Zwischennote** (`H3`)
   statt der **Endnote** (`J3`): `VLOOKUP(ROUND(H3,0)…)`. In den übrigen
   Halbjahren wird korrekt die Endnote gerundet. Das neue System rundet
   konsistent die Endnote — Ergebnis kann daher in Einzelfällen vom alten
   3.-Hj.-Wert abweichen.
2. **„Zeugnis rundet" bei LF2/LF3 vs. ungerundete Kumulation bei LF1/LF4.**
   Das neue Modell kumuliert für **alle** Lernfelder ungerundet und rundet nur
   die angezeigte Tendenz-/Zeugnisnote (Spec Kap. 6.1). Auch hier sind
   minimale Abweichungen zu Altwerten möglich — gewollt und korrekter.

---

## 4. Differenzierung SPA regulär vs. SPA PiA

Pro Schuljahr: **1 Klasse SPA PiA** und **2 reguläre Klassen**. Die Unterschiede
werden **rein über Konfiguration** abgebildet (Bildungsgang-abhängige
`bewertungsschema`-/`fach_variante`-Zeilen), **nicht** im Code.

| Merkmal | SPA PiA | SPA regulär |
| --- | --- | --- |
| LF4 | durchgängig **oder** je Hj. per n/a abschaltbar (`deaktivierbar=true`) | **immer durchgängig** unterrichtet (`deaktivierbar=false`, in allen 4 Hj. aktiv) |
| Blockpraktikum | ja — „Blockpraxis" im 3. Hj. als eigene Eingabe | **kein** Blockpraktikum (keine Blockpraxis-Komponente) |
| Praxisnoten | **nur 2. und 4. Hj.**; 2. Hj. eigenständig, 4. Hj. = 0,7·Praxis(4.) + 0,3·Blockpraxis(3.). Blockpraxis (3. Hj.) ist eigene Zeugnisnote *und* Quelle der Verrechnung | **nur 2. und 3. Hj.**; beide Noten bleiben **separat** (keine Verrechnung) und werden beide im Abschlusszeugnis ausgewiesen |

**Konsequenz für das Schema:** Ein `bewertungsschema` ist immer an
`(fach, bildungsgang, halbjahr)` gebunden. So kann „Praxis" für PiA nur im
2. + 4. Hj. aktiv sein, für regulär nur im 2. + 3. Hj. — ohne Code-Verzweigung.
Im 1. Hj. gibt es in **keinem** Bildungsgang eine Praxisnote.

**Praxis PiA (geklärt):** Praxisnoten nur im 2. und 4. Hj. Das 2. Hj. ist
eigenständig (`keine`). Das 4. Hj. wird **einmalig** verrechnet:
`0,7·Praxis(4.) + 0,3·Blockpraxis(3.)` (`gewichtet_vorgaenger` im externen
Modus; Quelle = Fach `BLOCKPRAXIS`, Hj. 3, als Schema-Konfiguration). Die
Blockpraxisnote (3. Hj.) wird **zusätzlich** als eigene Zeugnisnote ausgewiesen.

**Praxis regulär (geklärt):** Die beiden Praxisnoten (2. + 3. Hj.) werden
**nicht** kumuliert oder verrechnet. Jede ist eine eigenständige Direktnote
(`kumulation_modus = keine`) und wird im Abschlusszeugnis separat ausgewiesen.
Kein Blockpraktikum in regulär.

---

## 5. Architektur & Repo-Struktur

Monorepo (npm/pnpm-Workspaces):

```
packages/
  core/          # Rechenkern: reine TS-Funktionen + Vitest-Tests
    src/
    test/        # Golden-Master gegen Excel-Sollwerte
  server/        # Fastify-API
    src/
      routes/
      auth/      # OIDC/LDAP gegen Nextcloud
      db/        # SQLite-Zugriff, Migrationen, Seed
    migrations/
  web/           # React (Vite): Eingabemasken, Zeugnisansicht, Admin
    src/
data/            # Seed-Konfiguration als JSON (Fächer, Komponenten,
                 # Schemata je Bildungsgang, Notenskala, WPK-Kurse)
docs/            # Spezifikation, Umsetzungsplan, Entscheidungen (ADRs)
```

**Datenfluss:** UI → API (Fastify, Auth-geprüft, Lehrauftrag-Filter) → DB
(Eingaben) → Rechenkern (`core`) → `ergebnis`-Cache → Zeugnisansicht/Export.

---

## 6. API-Design (Auszug)

Alle Endpunkte hinter SSO; Autorisierung serverseitig über Rolle + Lehrauftrag.

```
POST  /auth/login            (OIDC-Callback Nextcloud)
GET   /me                    (Rolle, Lehraufträge)

GET   /klassen               (gefiltert nach Rolle)
GET   /klassen/:id/schueler

# Eingabe (Fachlehrkraft, nur mit passendem Lehrauftrag)
GET   /eingabe?klasse=&fach=&halbjahr=     -> Maske + Bestandsnoten
PUT   /noten                                -> Komponenten-/Direktnote speichern (auditiert)

# Berechnung & Zeugnis (Klassenleitung/Admin)
GET   /zeugnis?klasse=&halbjahr=            -> berechnete Zeugnisansicht
POST  /export/zeugnis                       -> PDF/XLSX-Export

# Administration
CRUD  /admin/faecher /admin/schemata /admin/komponenten
CRUD  /admin/lehrauftraege /admin/klassen /admin/schueler
GET   /admin/notenskala /admin/wpk-kurse
```

---

## 7. Frontend (`packages/web`)

- **Eingabemaske (Fachlehrkraft):** Klasse × Fach × Halbjahr; Tabelle
  Schüler:innen × Komponenten; n/a-Schalter; Live-Vorschau der Zwischennote.
- **Zeugnisansicht (Klassenleitung):** Matrix aller Fächer pro Halbjahr mit
  Endpunkten + Tendenznote; Export.
- **Admin:** Pflege von Fächern, Schemata, Gewichten, Lehraufträgen,
  Klassen/Schüler:innen, WPK-Kursen, Notenskala.
- Geführt, validiert (0–15, ganzzahlig), ohne Formelwissen.

---

## 8. Tests & Verifikation

- **Golden-Master:** Aus den drei Excel-Dateien werden Eingaben + erwartete
  Endpunkte/Tendenznoten als Fixtures extrahiert; der Rechenkern muss sie
  exakt reproduzieren (Spec Kap. 9). Skript `data/extract-fixtures.ts`.
- **Gezielte Unit-Tests** für Kanten:
  - LF3-Restverteilung mit 0/1/2 n/a-Komponenten.
  - feste Komponente (Päd./Bericht) selbst n/a.
  - LF4-Fortschreibung über n/a-Halbjahre.
  - Praxis-Endnote 0,3/0,7; WPK-Mittelwert.
  - Rundung an Grenzwerten (x,5).
- **Bewusste Abweichungs-Tests:** Die in 3.4 genannten Excel-Eigenheiten als
  dokumentierte „Soll weicht ab"-Fälle (nach fachlicher Bestätigung).
- CI: Lint + Typecheck + Vitest bei jedem Push.

---

## 9. Migration aus den Excel-Dateien

1. Parser (`openpyxl`-Äquivalent in TS bzw. einmaliges Python-Skript) liest
   Stammdaten (Namen), Komponentennoten und Direktnoten je Halbjahr.
2. Mapping Spalten → Fach/Komponente über die in den Dateien gefundenen
   Header (nicht Position).
3. Import in SQLite; anschließend Rechenkern laufen lassen und Ergebnisse
   gegen die Excel-Endwerte gegenprüfen (= zugleich Golden-Master).
4. Reihenfolge der Migration nach Klärung der Bestandsdaten-Frage (Abschnitt 11).

---

## 10. Datenschutz & Betrieb

- On-premise; SQLite-Datei auf landeseigenem Server.
- TLS-Terminierung (Reverse Proxy); HTTP→HTTPS-Zwang.
- Verschlüsseltes, regelmäßiges DB-Backup (Snapshot der SQLite-Datei).
- `audit_log` für jede Notenänderung (wer/wann/alt→neu).
- Rollenbasierter Zugriff (Need-to-know) konsequent serverseitig erzwungen.
- Lösch-/Aufbewahrungsfristen mit Schulleitung/Datenschutz abstimmen.

---

## 11. Offene Punkte (Entscheidung erbeten)

1. ~~**Praxis-Zeugnisnote SPA regulär** (nur 2. + 3. Hj.)~~ — **geklärt:** beide
   Noten bleiben separat, keine Verrechnung, beide im Abschlusszeugnis (s. §4).
2. **Rundung an Grenzwerten:** kaufmännisch (x,5 → auf) bestätigen; Sonderfälle
   „nicht erteilt"/„befreit" als eigener n/a-Subtyp?
3. **LF3-3.-Hj.-Rundung & ungerundete Kumulation** (3.4): Korrektur akzeptiert?
4. **SSO-Details:** Nextcloud als OIDC-Provider verfügbar? Alternativ
   LDAP-Bind? Welche Claims liefern Rolle/Name?
5. ~~**Bestandsdaten-Migration:** Sollen reale Altdaten übernommen werden oder
   startet das System mit dem laufenden Schuljahr neu?~~ — **geklärt:**
   **Neustart** ohne Import; Stamm- und Notendaten werden frisch über die
   Admin-UI/Eingabemaske gepflegt. Ein Migrationsskript entfällt.
6. **Weitere Bildungsgänge/Klassen** mit abweichenden Fächern/Gewichten künftig
   zu erwarten? (Beeinflusst Generalisierungsgrad der Admin-UI.)

---

## 12. Meilensteinplan

| M | Inhalt | Ergebnis / „done" |
| --- | --- | --- |
| **M0** ✅ | Repo-Setup: Monorepo, TS, Lint, Vitest, CI | grünes CI, leere Pakete bauen |
| **M1** ✅ | **Rechenkern** + Golden-Master + Unit-Tests | alle Excel-Sollwerte reproduziert |
| **M2** ✅ | SQLite-Schema, Migrationen, Seed (Bildungsgänge, Fächer, Schemata, Notenskala, WPK) | DB initialisierbar; Seed deckt PiA + regulär ab |
| **M3** ✅ | Fastify-API: Eingabe + Berechnung + Zeugnisansicht (ohne Auth) | lokal nutzbar, API-Tests grün |
| **M4** ✅ | Auth (LDAP/AD-Bind) + JWT + Rollen + Lehrauftrag-Filter + Audit-Akteur | Zugriff erzwungen, auditiert |
| **M5** ✅ | React-Frontend: Login + Eingabemaske + Zeugnisansicht | End-to-end klickbar |
| **M6** ✅ | Admin-UI (Stammdaten, Lehrkräfte/Lehraufträge/Klassenleitung, Schema-Übersicht) | Konfiguration ohne SQL pflegbar |
| **M7** 🟡 | Export (XLSX ✅, PDF optional/offen), Betriebs-/Backup-Doku ✅, Migration ⊘ entfällt | übergabefähig |

**Stand M7:** Zeugnis-Export als **XLSX** (Blätter „Tendenznoten" + „Endpunkte")
ist umgesetzt (Button in der Zeugnisansicht; nur Klassenleitung/Admin).
Betriebs-/Deployment-/Backup-Dokumentation liegt in
[`BETRIEB.md`](BETRIEB.md). Diagnose-/Bootstrap-CLIs `ldap-test` und
`seed-admin` sind vorhanden. **Migration entfällt** (Entscheidung: Neustart,
s. §11.5). **Offen/optional:** PDF-Export — wird auf Wunsch ergänzt.

**Admin-UI (M6):** Administrationsbereich im Frontend (nur Rolle `admin`),
serverseitig über `/api/admin/*` (eigener Admin-Hook) abgesichert. Funktionen:
Klassen + Schüler:innen anlegen/deaktivieren, Lehrkräfte anlegen
(Login-Provisionierung — damit Anmeldungen ohne SQL möglich sind), Lehraufträge
(Fach × Klasse × Halbjahr) und Klassenleitung zuweisen/entfernen. Die
Bewertungsschemata werden als **schreibgeschützte Übersicht** angezeigt: Die
Gewichte sind golden-master-verifiziert und werden bewusst nicht über die UI
editiert, um die Rechenkonsistenz nicht zu gefährden (Änderungen erfolgen über
Seed/Migration).

**Auth-Hinweis (M4):** Authentifizierung per direktem LDAP-Bind gegen das AD
(Service-Account-Suche → Re-Bind mit Benutzer-DN). Rollen kommen aus der DB
(`lehrkraft.rolle`), nicht aus AD-Gruppen. Session als JWT (12 h). Sämtliche
LDAP-Parameter und `JWT_SECRET` ausschließlich über Umgebungsvariablen
(`.env.example` als Vorlage; `.env` ist gitignored). Die Auth ist über eine
`Authenticator`-Abstraktion gekapselt, daher offline testbar.
