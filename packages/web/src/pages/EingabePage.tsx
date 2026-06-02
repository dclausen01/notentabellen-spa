import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { NoteInput } from '../components/NoteInput.js';
import type {
  Eingabemaske,
  FachOption,
  Klasse,
  MaskeWert,
} from '../types.js';

export function EingabePage() {
  const [klassen, setKlassen] = useState<Klasse[]>([]);
  const [klasseId, setKlasseId] = useState<number | null>(null);
  const [faecher, setFaecher] = useState<FachOption[]>([]);
  const [fach, setFach] = useState<string | null>(null);
  const [halbjahr, setHalbjahr] = useState<number | null>(null);
  const [maske, setMaske] = useState<Eingabemaske | null>(null);
  const [vorschau, setVorschau] = useState<Record<number, string>>({});
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    api.klassen().then(setKlassen).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    if (klasseId == null) return;
    setFach(null);
    setHalbjahr(null);
    setMaske(null);
    api.faecher(klasseId).then(setFaecher).catch((e) => setFehler(e.message));
  }, [klasseId]);

  const aktuellesFach = faecher.find((f) => f.schluessel === fach);

  const ladeVorschau = useCallback(
    async (schuelerId: number, f: string, hj: number) => {
      try {
        const erg = await api.schuelerFach(schuelerId, f);
        const zelle = erg.find((e) => e.halbjahr === hj);
        setVorschau((v) => ({
          ...v,
          [schuelerId]: zelle?.tendenz ? `${zelle.tendenz} (${zelle.endpunkte?.toFixed(1)})` : '–',
        }));
      } catch {
        /* Vorschau ist optional */
      }
    },
    [],
  );

  const ladeMaske = useCallback(async () => {
    if (klasseId == null || !fach || halbjahr == null) return;
    setFehler(null);
    try {
      const m = await api.eingabe(klasseId, fach, halbjahr);
      setMaske(m);
      setVorschau({});
      for (const z of m.zeilen) void ladeVorschau(z.schuelerId, fach, halbjahr);
    } catch (e) {
      setMaske(null);
      setFehler(e instanceof ApiError ? e.message : 'Fehler beim Laden');
    }
  }, [klasseId, fach, halbjahr, ladeVorschau]);

  useEffect(() => {
    void ladeMaske();
  }, [ladeMaske]);

  async function speichereKomponente(schuelerId: number, komponenteId: number, neu: MaskeWert) {
    if (halbjahr == null) return;
    await api.speichereKomponente({ schuelerId, komponenteId, halbjahr, wert: neu.wert, istNa: neu.istNa });
    aktualisiereZelle(schuelerId, (z) => ({
      ...z,
      komponenten: { ...z.komponenten, ...komponentenUpdate(z.komponenten, komponenteId, neu, maske) },
    }));
    if (fach) void ladeVorschau(schuelerId, fach, halbjahr);
  }

  async function speichereDirekt(schuelerId: number, neu: MaskeWert) {
    if (!fach || halbjahr == null) return;
    await api.speichereDirekt({ schuelerId, fach, halbjahr, wert: neu.wert, istNa: neu.istNa });
    aktualisiereZelle(schuelerId, (z) => ({ ...z, direkt: neu }));
    void ladeVorschau(schuelerId, fach, halbjahr);
  }

  function aktualisiereZelle(schuelerId: number, fn: (z: Eingabemaske['zeilen'][number]) => Eingabemaske['zeilen'][number]) {
    setMaske((m) =>
      m ? { ...m, zeilen: m.zeilen.map((z) => (z.schuelerId === schuelerId ? fn(z) : z)) } : m,
    );
  }

  return (
    <div className="page">
      <h2>Noteneingabe</h2>
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
          Fach
          <select
            value={fach ?? ''}
            disabled={!klasseId}
            onChange={(e) => {
              const f = e.target.value || null;
              setFach(f);
              const opt = faecher.find((x) => x.schluessel === f);
              setHalbjahr(opt?.halbjahre[0] ?? null);
            }}
          >
            <option value="">– wählen –</option>
            {faecher.map((f) => (
              <option key={f.schluessel} value={f.schluessel}>
                {f.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Halbjahr
          <select
            value={halbjahr ?? ''}
            disabled={!aktuellesFach}
            onChange={(e) => setHalbjahr(e.target.value ? Number(e.target.value) : null)}
          >
            {aktuellesFach?.halbjahre.map((h) => (
              <option key={h} value={h}>
                {h}. Halbjahr
              </option>
            ))}
          </select>
        </label>
      </div>

      {fehler && <p className="fehler" role="alert">{fehler}</p>}

      {maske && (
        <table className="tabelle">
          <thead>
            <tr>
              <th>Name, Vorname</th>
              {maske.modus === 'komponenten_gewichtet'
                ? maske.komponenten.map((k) => <th key={k.id}>{k.name}</th>)
                : <th>Note</th>}
              <th className="vorschau-spalte">Endnote (Vorschau)</th>
            </tr>
          </thead>
          <tbody>
            {maske.zeilen.map((z) => (
              <tr key={z.schuelerId}>
                <td className="name">{z.name}, {z.vorname}</td>
                {maske.modus === 'komponenten_gewichtet' ? (
                  maske.komponenten.map((k) => (
                    <td key={k.id}>
                      <NoteInput
                        wert={z.komponenten[k.schluessel] ?? { wert: null, istNa: false }}
                        naErlaubt
                        onSpeichern={(neu) => void speichereKomponente(z.schuelerId, k.id, neu)}
                      />
                    </td>
                  ))
                ) : (
                  <td>
                    <NoteInput
                      wert={z.direkt ?? { wert: null, istNa: false }}
                      naErlaubt={maske.deaktivierbar}
                      onSpeichern={(neu) => void speichereDirekt(z.schuelerId, neu)}
                    />
                  </td>
                )}
                <td className="vorschau-spalte">{vorschau[z.schuelerId] ?? '…'}</td>
              </tr>
            ))}
            {maske.zeilen.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">Keine Schüler:innen in dieser Klasse.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function komponentenUpdate(
  vorhanden: Record<string, MaskeWert>,
  komponenteId: number,
  neu: MaskeWert,
  maske: Eingabemaske | null,
): Record<string, MaskeWert> {
  const schluessel = maske?.komponenten.find((k) => k.id === komponenteId)?.schluessel;
  return schluessel ? { ...vorhanden, [schluessel]: neu } : vorhanden;
}
