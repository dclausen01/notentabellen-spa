import { useEffect, useState } from 'react';
import { adminApi, api, ApiError } from '../api.js';
import type {
  AdminFach,
  AuftraegeAntwort,
  Bildungsgang,
  ImportBericht,
  Klasse,
  Lehrkraft,
  NotenImportBericht,
  Rolle,
  Schueler,
  SchemaUebersichtZeile,
  WpkKurs,
} from '../types.js';

type Bereich = 'stammdaten' | 'lehrkraefte' | 'wpk' | 'schemata';

function fehlerText(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Unerwarteter Fehler';
}

/** Wiederverwendbarer CSV-Import mit Ergebnisbericht. */
function CsvImport({
  titel,
  hinweis,
  importieren,
  onFertig,
}: {
  titel: string;
  hinweis: string;
  importieren: (csv: string) => Promise<ImportBericht>;
  onFertig: () => void;
}) {
  const [bericht, setBericht] = useState<ImportBericht | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  // WinSchool & Co. exportieren i. d. R. Windows-Codierung (ANSI) → Default.
  const [kodierung, setKodierung] = useState('windows-1252');

  async function datei(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // erneutes Wählen derselben Datei erlauben
    if (!f) return;
    setFehler(null);
    setBericht(null);
    setLaeuft(true);
    try {
      // Datei binär lesen und mit der gewählten Codierung dekodieren.
      const text = new TextDecoder(kodierung).decode(await f.arrayBuffer());
      setBericht(await importieren(text));
      onFertig();
    } catch (err) {
      setFehler(fehlerText(err));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="card span-2">
      <h3>{titel}</h3>
      <p className="muted hinweis">{hinweis}</p>
      <label className="filterleiste">
        Zeichencodierung
        <select value={kodierung} onChange={(e) => setKodierung(e.target.value)} disabled={laeuft}>
          <option value="windows-1252">Windows (ANSI / windows-1252)</option>
          <option value="utf-8">Unicode (UTF-8)</option>
        </select>
      </label>
      <input type="file" accept=".csv,text/csv" onChange={(e) => void datei(e)} disabled={laeuft} />
      {laeuft && <p className="muted">Importiere …</p>}
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      {bericht && (
        <div>
          <p className="erfolg">
            {bericht.angelegt} angelegt, {bericht.uebersprungen} übersprungen,{' '}
            {bericht.fehler.length} Fehler.
          </p>
          {bericht.fehler.length > 0 && (
            <ul className="chip-liste">
              {bericht.fehler.slice(0, 30).map((f, i) => (
                <li key={i} className="muted">
                  Zeile {f.zeile}: {f.grund}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Import bereits berechneter Noten aus Altjahrgängen. Zweistufig: erst Probelauf
 * (Vorschau ohne Schreibzugriff), dann bewusste Übernahme.
 * CSV-Spalten: nachname;vorname;klasse;fach;halbjahr;typ;wert
 *   typ = endnote (übernommene Endnote) | direkt | pruefung
 */
function NotenImport({ onFertig }: { onFertig: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [dateiname, setDateiname] = useState<string>('');
  const [bericht, setBericht] = useState<NotenImportBericht | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [kodierung, setKodierung] = useState('utf-8');

  async function datei(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFehler(null);
    setBericht(null);
    setLaeuft(true);
    try {
      const text = new TextDecoder(kodierung).decode(await f.arrayBuffer());
      setCsv(text);
      setDateiname(f.name);
      setBericht(await adminApi.importNoten(text, false)); // Probelauf
    } catch (err) {
      setFehler(fehlerText(err));
    } finally {
      setLaeuft(false);
    }
  }

  async function uebernehmen() {
    if (!csv) return;
    setFehler(null);
    setLaeuft(true);
    try {
      setBericht(await adminApi.importNoten(csv, true));
      onFertig();
    } catch (err) {
      setFehler(fehlerText(err));
    } finally {
      setLaeuft(false);
    }
  }

  const fehlerZeilen = bericht?.zeilen.filter((z) => !z.ok) ?? [];

  return (
    <section className="card span-2">
      <h3>Noten-Import (historisch)</h3>
      <p className="muted hinweis">
        Übernahme bereits berechneter Noten aus Altjahrgängen. CSV-Spalten:{' '}
        <code>nachname;vorname;klasse;fach;halbjahr;typ;wert</code> mit{' '}
        <code>typ</code> = <code>endnote</code> (übernommene Endnote),{' '}
        <code>direkt</code> oder <code>pruefung</code>. Zuerst läuft ein Probelauf —
        es wird erst nach „Übernehmen" geschrieben. Schüler:innen werden über
        Name + Klasse zugeordnet.
      </p>
      <label className="filterleiste">
        Zeichencodierung
        <select value={kodierung} onChange={(e) => setKodierung(e.target.value)} disabled={laeuft}>
          <option value="utf-8">Unicode (UTF-8)</option>
          <option value="windows-1252">Windows (ANSI / windows-1252)</option>
        </select>
      </label>
      <input type="file" accept=".csv,text/csv" onChange={(e) => void datei(e)} disabled={laeuft} />
      {laeuft && <p className="muted">Verarbeite …</p>}
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      {bericht && (
        <div>
          <p className={bericht.geschrieben ? 'erfolg' : 'muted'}>
            {bericht.geschrieben ? '✓ Übernommen: ' : 'Probelauf '}
            {dateiname && <em>({dateiname})</em>} — {bericht.geplant} Werte{' '}
            {bericht.geschrieben ? 'geschrieben' : 'geplant'} (Endnote{' '}
            {bericht.proTyp.endnote}, direkt {bericht.proTyp.direkt}, Prüfung{' '}
            {bericht.proTyp.pruefung}), {bericht.fehler} Fehler.
          </p>
          {bericht.schuelerFehlend.length > 0 && (
            <p className="fehler">
              Nicht zugeordnet ({bericht.schuelerFehlend.length}):{' '}
              {bericht.schuelerFehlend.slice(0, 12).join(' · ')}
              {bericht.schuelerFehlend.length > 12 ? ' …' : ''}
            </p>
          )}
          {fehlerZeilen.length > 0 && (
            <ul className="chip-liste">
              {fehlerZeilen.slice(0, 30).map((z, i) => (
                <li key={i} className="muted">
                  Zeile {z.zeile}: {z.schueler} · {z.fach} {z.halbjahr}. Hj. — {z.grund}
                </li>
              ))}
            </ul>
          )}
          {!bericht.geschrieben && bericht.geplant > 0 && (
            <button type="button" onClick={() => void uebernehmen()} disabled={laeuft}>
              {bericht.geplant} Werte übernehmen
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function AdminPage() {
  const [bereich, setBereich] = useState<Bereich>('stammdaten');
  return (
    <div className="page">
      <h2>Administration</h2>
      <div className="tabs">
        <button
          type="button"
          className={bereich === 'stammdaten' ? 'tab aktiv' : 'tab'}
          onClick={() => setBereich('stammdaten')}
        >
          Klassen &amp; Schüler:innen
        </button>
        <button
          type="button"
          className={bereich === 'lehrkraefte' ? 'tab aktiv' : 'tab'}
          onClick={() => setBereich('lehrkraefte')}
        >
          Lehrkräfte &amp; Zugriff
        </button>
        <button
          type="button"
          className={bereich === 'wpk' ? 'tab aktiv' : 'tab'}
          onClick={() => setBereich('wpk')}
        >
          Wahlpflichtkurse
        </button>
        <button
          type="button"
          className={bereich === 'schemata' ? 'tab aktiv' : 'tab'}
          onClick={() => setBereich('schemata')}
        >
          Bewertungsschemata
        </button>
      </div>

      {bereich === 'stammdaten' && <StammdatenBereich />}
      {bereich === 'lehrkraefte' && <LehrkraefteBereich />}
      {bereich === 'wpk' && <WpkBereich />}
      {bereich === 'schemata' && <SchemataBereich />}
    </div>
  );
}

// =====================================================================
// Klassen & Schüler:innen
// =====================================================================

function StammdatenBereich() {
  const [klassen, setKlassen] = useState<Klasse[]>([]);
  const [bildungsgaenge, setBildungsgaenge] = useState<Bildungsgang[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [aktiveKlasse, setAktiveKlasse] = useState<number | null>(null);

  // Formular „neue Klasse“
  const [bez, setBez] = useState('');
  const [schuljahr, setSchuljahr] = useState('');
  const [bg, setBg] = useState('');

  async function ladeKlassen() {
    setKlassen(await api.klassen());
  }

  useEffect(() => {
    adminApi.bildungsgaenge().then(setBildungsgaenge).catch((e) => setFehler(fehlerText(e)));
    ladeKlassen().catch((e) => setFehler(fehlerText(e)));
  }, []);

  async function neueKlasse(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    try {
      await adminApi.erstelleKlasse({ bezeichnung: bez, schuljahr, bildungsgang: bg });
      setBez('');
      setSchuljahr('');
      setBg('');
      await ladeKlassen();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  async function loescheKlasse(id: number) {
    if (
      !confirm(
        'Klasse ENDGÜLTIG löschen? Alle Schüler:innen, Noten, Lehraufträge und Einstellungen dieser Klasse gehen unwiderruflich verloren.',
      )
    )
      return;
    setFehler(null);
    try {
      await adminApi.loescheKlasse(id);
      if (aktiveKlasse === id) setAktiveKlasse(null);
      await ladeKlassen();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  return (
    <div className="admin-grid">
      <section className="card">
        <h3>Neue Klasse</h3>
        <form className="formular" onSubmit={neueKlasse}>
          <label>
            Bezeichnung
            <input value={bez} onChange={(e) => setBez(e.target.value)} placeholder="z. B. SPA PiA 1" required />
          </label>
          <label>
            Schuljahr
            <input value={schuljahr} onChange={(e) => setSchuljahr(e.target.value)} placeholder="2025/26" required />
          </label>
          <label>
            Bildungsgang
            <select value={bg} onChange={(e) => setBg(e.target.value)} required>
              <option value="">– wählen –</option>
              {bildungsgaenge.map((b) => (
                <option key={b.id} value={b.schluessel}>
                  {b.bezeichnung}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Klasse anlegen</button>
        </form>
        {fehler && <p className="fehler" role="alert">{fehler}</p>}
      </section>

      <section className="card">
        <h3>Klassen</h3>
        <div className="tabelle-scroll">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Bezeichnung</th>
              <th>Schuljahr</th>
              <th>Bildungsgang</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {klassen.map((k) => (
              <tr key={k.id}>
                <td className="name">{k.bezeichnung}</td>
                <td>{k.schuljahr}</td>
                <td>{k.bildungsgang}</td>
                <td className="aktionen">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setAktiveKlasse(aktiveKlasse === k.id ? null : k.id)}
                  >
                    {aktiveKlasse === k.id ? 'schließen' : 'verwalten'}
                  </button>
                  <button
                    type="button"
                    className="link-button gefahr"
                    onClick={() => void loescheKlasse(k.id)}
                  >
                    löschen
                  </button>
                </td>
              </tr>
            ))}
            {klassen.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">Noch keine Klassen angelegt.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      <CsvImport
        titel="Schüler:innen per CSV importieren"
        hinweis="Spalten: vorname, nachname, klasse (Trennzeichen , oder ;). Die Klasse muss bereits angelegt sein. Bereits vorhandene Schüler:innen werden übersprungen."
        importieren={adminApi.importSchueler}
        onFertig={() => void ladeKlassen()}
      />

      <NotenImport onFertig={() => void ladeKlassen()} />

      {aktiveKlasse != null && <SchuelerVerwaltung klasseId={aktiveKlasse} />}
    </div>
  );
}

function SchuelerVerwaltung({ klasseId }: { klasseId: number }) {
  const [schueler, setSchueler] = useState<Schueler[]>([]);
  const [name, setName] = useState('');
  const [vorname, setVorname] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [bearbeiteId, setBearbeiteId] = useState<number | null>(null);
  const [eName, setEName] = useState('');
  const [eVorname, setEVorname] = useState('');

  async function lade() {
    setSchueler(await api.schueler(klasseId));
  }

  useEffect(() => {
    lade().catch((e) => setFehler(fehlerText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klasseId]);

  async function hinzufuegen(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    try {
      await adminApi.erstelleSchueler(klasseId, { name, vorname });
      setName('');
      setVorname('');
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  function startBearbeiten(s: Schueler) {
    setBearbeiteId(s.id);
    setEName(s.name);
    setEVorname(s.vorname);
  }

  async function speichereBearbeitung(id: number) {
    setFehler(null);
    try {
      await adminApi.aktualisiereSchueler(id, { name: eName, vorname: eVorname });
      setBearbeiteId(null);
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  async function deaktivieren(id: number) {
    if (!confirm('Schüler:in deaktivieren? (bleibt mit Noten erhalten, nur ausgeblendet)')) return;
    await adminApi.deaktiviereSchueler(id);
    await lade();
  }

  async function loeschen(id: number) {
    if (!confirm('Schüler:in ENDGÜLTIG löschen? Alle erfassten Noten gehen verloren.')) return;
    await adminApi.loescheSchueler(id);
    await lade();
  }

  return (
    <section className="card span-2">
      <h3>Schüler:innen der Klasse</h3>
      <form className="formular zeile" onSubmit={hinzufuegen}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Vorname
          <input value={vorname} onChange={(e) => setVorname(e.target.value)} required />
        </label>
        <button type="submit">Hinzufügen</button>
      </form>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      <div className="tabelle-scroll">
      <table className="tabelle">
        <thead>
          <tr>
            <th>Name</th>
            <th>Vorname</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {schueler.map((s) => (
            <tr key={s.id}>
              {bearbeiteId === s.id ? (
                <>
                  <td><input value={eName} onChange={(e) => setEName(e.target.value)} /></td>
                  <td><input value={eVorname} onChange={(e) => setEVorname(e.target.value)} /></td>
                  <td>
                    <button type="button" className="link-button" onClick={() => void speichereBearbeitung(s.id)}>
                      speichern
                    </button>
                    <button type="button" className="link-button" onClick={() => setBearbeiteId(null)}>
                      abbrechen
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td className="name">{s.name}</td>
                  <td>{s.vorname}</td>
                  <td className="aktionen">
                    <button type="button" className="link-button" title="Bearbeiten" onClick={() => startBearbeiten(s)}>
                      ✎ bearbeiten
                    </button>
                    <button type="button" className="link-button" onClick={() => void deaktivieren(s.id)}>
                      deaktivieren
                    </button>
                    <button type="button" className="link-button gefahr" onClick={() => void loeschen(s.id)}>
                      löschen
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
          {schueler.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">Keine aktiven Schüler:innen.</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </section>
  );
}

// =====================================================================
// Lehrkräfte & Zugriff
// =====================================================================

const ROLLEN: { wert: Rolle; label: string }[] = [
  { wert: 'fach', label: 'Fachlehrkraft' },
  { wert: 'klassenleitung', label: 'Klassenleitung' },
  { wert: 'admin', label: 'Administration' },
];

function LehrkraefteBereich() {
  const [lehrkraefte, setLehrkraefte] = useState<Lehrkraft[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [aktiv, setAktiv] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [loginSub, setLoginSub] = useState('');
  const [rolle, setRolle] = useState<Rolle>('fach');

  async function lade() {
    setLehrkraefte(await adminApi.lehrkraefte());
  }

  useEffect(() => {
    lade().catch((e) => setFehler(fehlerText(e)));
  }, []);

  async function neu(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    try {
      await adminApi.erstelleLehrkraft({ name: name.trim() || undefined, loginSub, rolle });
      setName('');
      setLoginSub('');
      setRolle('fach');
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  async function rolleAendern(id: number, neueRolle: Rolle) {
    setFehler(null);
    try {
      await adminApi.setzeRolle(id, neueRolle);
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  return (
    <div className="admin-grid">
      <section className="card">
        <h3>Neue Lehrkraft</h3>
        <form className="formular" onSubmit={neu}>
          <label>
            Name (optional)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="wird beim ersten Login aus dem AD übernommen"
            />
          </label>
          <label>
            Login-Kennung (AD/sAMAccountName)
            <input value={loginSub} onChange={(e) => setLoginSub(e.target.value)} required />
          </label>
          <label>
            Rolle
            <select value={rolle} onChange={(e) => setRolle(e.target.value as Rolle)}>
              {ROLLEN.map((r) => (
                <option key={r.wert} value={r.wert}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Lehrkraft anlegen</button>
        </form>
        {fehler && <p className="fehler" role="alert">{fehler}</p>}
        <p className="muted hinweis">
          Die Login-Kennung muss exakt der AD-Anmeldung entsprechen, sonst schlägt die
          Anmeldung fehl. Rollen werden hier vergeben, nicht aus dem AD übernommen.
        </p>
      </section>

      <section className="card">
        <h3>Lehrkräfte</h3>
        <div className="tabelle-scroll">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Login</th>
              <th>Rolle</th>
              <th>Zugriff</th>
            </tr>
          </thead>
          <tbody>
            {lehrkraefte.map((l) => (
              <tr key={l.id}>
                <td className="name">
                  {l.name || <span className="muted">— (beim Login)</span>}
                </td>
                <td>{l.login_sub}</td>
                <td>
                  <select
                    value={l.rolle}
                    onChange={(e) => void rolleAendern(l.id, e.target.value as Rolle)}
                  >
                    {ROLLEN.map((r) => (
                      <option key={r.wert} value={r.wert}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setAktiv(aktiv === l.id ? null : l.id)}
                  >
                    {aktiv === l.id ? 'schließen' : 'verwalten'}
                  </button>
                </td>
              </tr>
            ))}
            {lehrkraefte.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">Noch keine Lehrkräfte angelegt.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      <CsvImport
        titel="Lehrkräfte per CSV importieren"
        hinweis="Spalten: vorname, nachname, benutzername, klasse (optional). Mit Klasse → Klassenleitung dieser Klasse, sonst Fachlehrkraft. benutzername = AD-Login (sAMAccountName). Erneuter Import aktualisiert bestehende Konten."
        importieren={adminApi.importLehrkraefte}
        onFertig={() => void lade()}
      />

      {aktiv != null && <ZugriffVerwaltung lehrkraftId={aktiv} />}
    </div>
  );
}

function ZugriffVerwaltung({ lehrkraftId }: { lehrkraftId: number }) {
  const [daten, setDaten] = useState<AuftraegeAntwort | null>(null);
  const [klassen, setKlassen] = useState<Klasse[]>([]);
  const [faecher, setFaecher] = useState<AdminFach[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  const [fach, setFach] = useState('');
  const [klasseId, setKlasseId] = useState('');
  const [klKlasse, setKlKlasse] = useState('');

  async function lade() {
    setDaten(await adminApi.auftraege(lehrkraftId));
  }

  useEffect(() => {
    lade().catch((e) => setFehler(fehlerText(e)));
    api.klassen().then(setKlassen).catch((e) => setFehler(fehlerText(e)));
    adminApi.faecher().then(setFaecher).catch((e) => setFehler(fehlerText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lehrkraftId]);

  async function auftragHinzufuegen(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    try {
      // Ohne Halbjahr-Angabe: Auftrag für alle Halbjahre, in denen das Fach
      // aktiv ist (einzelne lassen sich danach gezielt entfernen).
      await adminApi.erstelleLehrauftrag({ lehrkraftId, fach, klasseId: Number(klasseId) });
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  async function auftragEntfernen(id: number) {
    await adminApi.entferneLehrauftrag(id);
    await lade();
  }

  async function klSetzen(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    try {
      await adminApi.setzeKlassenleitung({ lehrkraftId, klasseId: Number(klKlasse) });
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  async function klEntfernen(kId: number) {
    await adminApi.entferneKlassenleitung(lehrkraftId, kId);
    await lade();
  }

  return (
    <section className="card span-2">
      <h3>Zugriff: Lehraufträge &amp; Klassenleitung</h3>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}

      <div className="admin-zwei">
        <div>
          <h4>Lehraufträge</h4>
          <form className="formular zeile" onSubmit={auftragHinzufuegen}>
            <label>
              Fach
              <select value={fach} onChange={(e) => setFach(e.target.value)} required>
                <option value="">– Fach –</option>
                {faecher.map((f) => (
                  <option key={f.id} value={f.schluessel}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Klasse
              <select value={klasseId} onChange={(e) => setKlasseId(e.target.value)} required>
                <option value="">– Klasse –</option>
                {klassen.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.bezeichnung}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">+ alle Halbjahre</button>
          </form>
          <p className="muted hinweis">
            Legt den Auftrag für alle Halbjahre an, in denen das Fach aktiv ist.
            Einzelne Halbjahre kannst du unten gezielt entfernen.
          </p>
          <ul className="chip-liste">
            {daten?.lehrauftraege.map((a) => (
              <li key={a.id}>
                <span>
                  {a.fachName} · {a.klasse} · {a.halbjahr}. Hj.
                </span>
                <button type="button" className="link-button" onClick={() => void auftragEntfernen(a.id)}>
                  ✕
                </button>
              </li>
            ))}
            {daten?.lehrauftraege.length === 0 && <li className="muted">keine Lehraufträge</li>}
          </ul>
        </div>

        <div>
          <h4>Klassenleitung</h4>
          <form className="formular zeile" onSubmit={klSetzen}>
            <label>
              Klasse
              <select value={klKlasse} onChange={(e) => setKlKlasse(e.target.value)} required>
                <option value="">– Klasse –</option>
                {klassen.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.bezeichnung}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">+</button>
          </form>
          <ul className="chip-liste">
            {daten?.klassenleitungen.map((k) => (
              <li key={k.klasseId}>
                <span>{k.klasse}</span>
                <button type="button" className="link-button" onClick={() => void klEntfernen(k.klasseId)}>
                  ✕
                </button>
              </li>
            ))}
            {daten?.klassenleitungen.length === 0 && <li className="muted">keine Klassenleitung</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// Wahlpflichtkurse (WPK)
// =====================================================================

function WpkBereich() {
  const [kurse, setKurse] = useState<WpkKurs[]>([]);
  const [name, setName] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);

  async function lade() {
    setKurse(await adminApi.wpkKurse());
  }

  useEffect(() => {
    lade().catch((e) => setFehler(fehlerText(e)));
  }, []);

  async function neu(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    try {
      await adminApi.erstelleWpkKurs(name.trim());
      setName('');
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  async function umschalten(id: number, aktiv: boolean) {
    setFehler(null);
    try {
      await adminApi.setzeWpkKursAktiv(id, aktiv);
      await lade();
    } catch (err) {
      setFehler(fehlerText(err));
    }
  }

  return (
    <div className="admin-grid">
      <section className="card">
        <h3>Neuer Wahlpflichtkurs</h3>
        <form className="formular" onSubmit={neu}>
          <label>
            Kursname
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button type="submit">Kurs anlegen</button>
        </form>
        {fehler && <p className="fehler" role="alert">{fehler}</p>}
        <p className="muted hinweis">
          Inaktive Kurse erscheinen nicht mehr in der Kursauswahl der Noteneingabe,
          bleiben aber für bestehende Zuordnungen erhalten.
        </p>
      </section>

      <section className="card">
        <h3>Kurse</h3>
        <div className="tabelle-scroll">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Kurs</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {kurse.map((k) => (
              <tr key={k.id}>
                <td className="name">{k.name}</td>
                <td>{k.aktiv ? 'aktiv' : 'inaktiv'}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void umschalten(k.id, k.aktiv !== 1)}
                  >
                    {k.aktiv ? 'deaktivieren' : 'aktivieren'}
                  </button>
                </td>
              </tr>
            ))}
            {kurse.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">Noch keine Kurse angelegt.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

// =====================================================================
// Bewertungsschemata (schreibgeschützt)
// =====================================================================

function SchemataBereich() {
  const [bildungsgaenge, setBildungsgaenge] = useState<Bildungsgang[]>([]);
  const [bg, setBg] = useState('');
  const [zeilen, setZeilen] = useState<SchemaUebersichtZeile[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .bildungsgaenge()
      .then((b) => {
        setBildungsgaenge(b);
        if (b[0]) setBg(b[0].schluessel);
      })
      .catch((e) => setFehler(fehlerText(e)));
  }, []);

  useEffect(() => {
    if (!bg) return;
    adminApi.schemata(bg).then(setZeilen).catch((e) => setFehler(fehlerText(e)));
  }, [bg]);

  return (
    <div>
      <div className="filterleiste">
        <label>
          Bildungsgang
          <select value={bg} onChange={(e) => setBg(e.target.value)}>
            {bildungsgaenge.map((b) => (
              <option key={b.id} value={b.schluessel}>
                {b.bezeichnung}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted hinweis">
        Übersicht der hinterlegten Rechenregeln. Die Gewichte sind gegen die
        Excel-Sollwerte verifiziert und daher hier nur lesbar.
      </p>
      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      <div className="tabelle-scroll">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Fach</th>
              <th>Hj.</th>
              <th>Modus</th>
              <th>Kumulation</th>
              <th>Aktiv</th>
              <th>Komponenten (Gewicht)</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={`${z.fach}-${z.halbjahr}`}>
                <td className="name">{z.fachName}</td>
                <td>{z.halbjahr}</td>
                <td>{z.halbjahrModus === 'direkt' ? 'direkt' : 'gewichtet'}</td>
                <td>{z.kumulationModus}</td>
                <td>{z.aktiv ? 'ja' : 'nein'}</td>
                <td className="name">{komponentenText(z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function komponentenText(z: SchemaUebersichtZeile): string {
  if (z.komponenten.length === 0) return '—';
  return z.komponenten
    .map((k) =>
      k.gewichtFix != null
        ? `${k.name} ${(k.gewichtFix * 100).toFixed(0)} %`
        : `${k.name} (Rest)`,
    )
    .join(', ');
}
