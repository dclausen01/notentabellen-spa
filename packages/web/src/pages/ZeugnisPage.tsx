import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import type { Klasse, ZeugnisZeile } from '../types.js';

const HALBJAHRE = [1, 2, 3, 4];

export function ZeugnisPage() {
  const [klassen, setKlassen] = useState<Klasse[]>([]);
  const [klasseId, setKlasseId] = useState<number | null>(null);
  const [halbjahr, setHalbjahr] = useState(1);
  const [zeilen, setZeilen] = useState<ZeugnisZeile[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => {
    api.klassen().then(setKlassen).catch((e) => setFehler(e.message));
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

  const faecher = zeilen[0]?.faecher.map((f) => f.fach) ?? [];

  return (
    <div className="page">
      <h2>Zeugnisansicht</h2>
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
      </div>

      {fehler && <p className="fehler" role="alert">{fehler}</p>}
      {meldung && <p className="erfolg">{meldung}</p>}

      {zeilen.length > 0 && (
        <div className="tabelle-scroll">
          <table className="tabelle zeugnis">
            <thead>
              <tr>
                <th>Name, Vorname</th>
                {faecher.map((f) => <th key={f}>{f}</th>)}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
