import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';
import type { Klasse, ZeugnisZeile } from '../types.js';

const HALBJAHRE = [1, 2, 3, 4];

// A4 quer (297×210 mm) minus 10 mm Rand je Seite, in CSS-Pixeln (96 dpi).
const MM_ZU_PX = 96 / 25.4;
const A4_QUER_BREITE_PX = (297 - 20) * MM_ZU_PX;
const A4_QUER_HOEHE_PX = (210 - 20) * MM_ZU_PX;
const DRUCK_BASIS_PT = 10; // Basis-Schriftgröße des Druckbereichs
const DRUCK_MIN_PT = 6; // Untergrenze für Lesbarkeit

export function ZeugnisPage() {
  const [klassen, setKlassen] = useState<Klasse[]>([]);
  const [klasseId, setKlasseId] = useState<number | null>(null);
  const [halbjahr, setHalbjahr] = useState(1);
  const [zeilen, setZeilen] = useState<ZeugnisZeile[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const druckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.klassen().then(setKlassen).catch((e) => setFehler(e.message));
  }, []);

  // Vor dem Druck den Druckbereich so skalieren, dass er auf ein A4-Blatt (quer)
  // passt: Schriftgröße statt transform (kein Clipping, sauberer Umbruch).
  useEffect(() => {
    const bereich = druckRef.current;
    if (!bereich) return;
    const skalieren = () => {
      bereich.style.fontSize = `${DRUCK_BASIS_PT}pt`;
      const { scrollWidth, scrollHeight } = bereich;
      if (scrollWidth === 0 || scrollHeight === 0) return;
      const faktor = Math.min(
        1,
        A4_QUER_BREITE_PX / scrollWidth,
        A4_QUER_HOEHE_PX / scrollHeight,
      );
      const pt = Math.max(DRUCK_MIN_PT, DRUCK_BASIS_PT * faktor);
      bereich.style.fontSize = `${pt}pt`;
    };
    const zuruecksetzen = () => {
      bereich.style.fontSize = '';
    };
    window.addEventListener('beforeprint', skalieren);
    window.addEventListener('afterprint', zuruecksetzen);
    return () => {
      window.removeEventListener('beforeprint', skalieren);
      window.removeEventListener('afterprint', zuruecksetzen);
    };
  }, []);

  useEffect(() => {
    if (klasseId == null) {
      setZeilen([]);
      return;
    }
    setFehler(null);
    api
      .zeugnis(klasseId, halbjahr)
      .then(setZeilen)
      .catch((e) => {
        setZeilen([]);
        setFehler(e instanceof ApiError ? e.message : 'Fehler beim Laden');
      });
  }, [klasseId, halbjahr]);

  async function neuBerechnen() {
    if (klasseId == null) return;
    setMeldung(null);
    try {
      const r = await api.berechneKlasse(klasseId);
      setMeldung(`${r.gespeicherteErgebnisse} Ergebnisse aktualisiert.`);
      setZeilen(await api.zeugnis(klasseId, halbjahr));
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Berechnung fehlgeschlagen');
    }
  }

  async function herunterladen(laden: () => Promise<{ blob: Blob; dateiname: string }>) {
    setFehler(null);
    try {
      const { blob, dateiname } = await laden();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dateiname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Download fehlgeschlagen');
    }
  }

  const aktiveKlasse = klassen.find((k) => k.id === klasseId);
  const faecher = zeilen[0]?.faecher ?? [];
  const pruefungen = zeilen[0]?.pruefungen ?? [];

  const druckTitel = aktiveKlasse
    ? `Notenübersicht – ${aktiveKlasse.bezeichnung} (${aktiveKlasse.schuljahr}) – ${halbjahr}. Halbjahr`
    : '';

  return (
    <div className="page">
      <h2>Notenübersicht</h2>
      <div className="filterleiste">
        <label>
          Klasse
          <select
            value={klasseId ?? ''}
            onChange={(e) => setKlasseId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">– wählen –</option>
            {klassen.map((k) => (
              <option key={k.id} value={k.id}>
                {k.bezeichnung} ({k.schuljahr})
              </option>
            ))}
          </select>
        </label>
        <label>
          Halbjahr
          <select value={halbjahr} onChange={(e) => setHalbjahr(Number(e.target.value))}>
            {HALBJAHRE.map((h) => (
              <option key={h} value={h}>{h}. Halbjahr</option>
            ))}
          </select>
        </label>
        {klasseId != null && (
          <button type="button" className="secondary" onClick={() => void neuBerechnen()}>
            Neu berechnen
          </button>
        )}
        {klasseId != null && zeilen.length > 0 && (
          <button
            type="button"
            onClick={() => void herunterladen(() => api.zeugnisExport(klasseId, halbjahr))}
          >
            Als Excel exportieren
          </button>
        )}
        {klasseId != null && zeilen.length > 0 && (
          <button
            type="button"
            className="secondary"
            onClick={() => window.print()}
            title="Druckansicht – im Dialog „Als PDF speichern“ wählen (eine A4-Seite, quer)"
          >
            PDF / Drucken
          </button>
        )}
        {klasseId != null && zeilen.length > 0 && aktiveKlasse?.darfNotenbekanntgabe && (
          <button
            type="button"
            className="secondary"
            onClick={() => void herunterladen(() => api.notenbekanntgabe(klasseId))}
            title="Abschluss-Notenbekanntgabe (nur Klassenleitung)"
          >
            Notenbekanntgabe (Word)
          </button>
        )}
      </div>

      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      {meldung && <p className="erfolg">{meldung}</p>}

      {zeilen.length > 0 && (
        <div className="druck-bereich" ref={druckRef}>
          <div className="druck-kopf">
            <h1>{druckTitel}</h1>
          </div>
          <div className="tabelle-scroll">
          <table className="tabelle zeugnis">
            <thead>
              {pruefungen.length > 0 && (
                <tr>
                  <th aria-hidden />
                  <th aria-hidden colSpan={faecher.length} />
                  <th className="pruefung-spalte pruefung-gruppe" colSpan={pruefungen.length}>
                    Prüfungen
                  </th>
                </tr>
              )}
              <tr>
                <th>Name, Vorname</th>
                {faecher.map((f) => <th key={f.fach}>{f.label ?? f.fach}</th>)}
                {pruefungen.map((p, i) => (
                  <th
                    key={p.fach}
                    className={`pruefung-spalte${i === 0 ? ' pruefung-start' : ''}`}
                  >
                    {p.label ?? p.fach}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.schuelerId}>
                  <td className="name">{z.name}, {z.vorname}</td>
                  {z.faecher.map((f) => (
                    <td key={f.fach} title={f.endpunkte != null ? `${f.endpunkte.toFixed(2)} Punkte` : ''}>
                      {f.tendenz ?? '–'}
                    </td>
                  ))}
                  {(z.pruefungen ?? []).map((p, i) => (
                    <td
                      key={p.fach}
                      className={`pruefung-spalte${i === 0 ? ' pruefung-start' : ''}`}
                      title={p.endpunkte != null ? `${p.endpunkte.toFixed(2)} Punkte` : ''}
                    >
                      {p.tendenz ?? '–'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
