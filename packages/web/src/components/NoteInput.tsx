import { useEffect, useState } from 'react';
import type { MaskeWert } from '../types.js';

interface Props {
  wert: MaskeWert;
  /** Erlaubt das Setzen auf „nicht belegt" (n/a). */
  naErlaubt: boolean;
  onSpeichern: (neu: MaskeWert) => void;
  /** Spalten-/Zeilenindex für die spaltenweise Tab-/Enter-Navigation. */
  navCol?: number;
  navRow?: number;
}

/**
 * Sammelt alle Noteneingaben der Tabelle und sortiert sie spaltenweise
 * (erst Spalte, dann Zeile) — so springt Tab/Enter in derselben Spalte nach
 * unten und erst am Spaltenende in die nächste Spalte.
 */
function navInputs(von: HTMLInputElement): HTMLInputElement[] {
  const tabelle = von.closest('table');
  if (!tabelle) return [von];
  const inputs = Array.from(
    tabelle.querySelectorAll<HTMLInputElement>('input[data-nav-col]'),
  );
  inputs.sort((a, b) => {
    const ca = Number(a.dataset['navCol']);
    const cb = Number(b.dataset['navCol']);
    return ca !== cb ? ca - cb : Number(a.dataset['navRow']) - Number(b.dataset['navRow']);
  });
  return inputs;
}

/**
 * Eingabezelle für eine Note (0–15) mit optionalem n/a-Schalter. Speichert beim
 * Verlassen des Feldes bzw. beim Umschalten von n/a (debouncefrei, da Speichern
 * an `onBlur` hängt).
 */
export function NoteInput({ wert, naErlaubt, onSpeichern, navCol, navRow }: Props) {
  const [text, setText] = useState(wert.wert?.toString() ?? '');
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    setText(wert.wert?.toString() ?? '');
  }, [wert.wert, wert.istNa]);

  function uebernehmen() {
    if (text.trim() === '') {
      onSpeichern({ wert: null, istNa: false });
      setFehler(false);
      return;
    }
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 15) {
      setFehler(true);
      return;
    }
    setFehler(false);
    onSpeichern({ wert: n, istNa: false });
  }

  if (wert.istNa) {
    return (
      <div className="note-input na">
        <span className="na-label">n/a</span>
        <button type="button" className="link-button" onClick={() => onSpeichern({ wert: null, istNa: false })}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className={`note-input${fehler ? ' invalid' : ''}`}>
      <input
        inputMode="numeric"
        value={text}
        placeholder="–"
        aria-label="Punkte 0 bis 15"
        {...(navCol !== undefined ? { 'data-nav-col': navCol, 'data-nav-row': navRow } : {})}
        onChange={(e) => setText(e.target.value)}
        onBlur={uebernehmen}
        onKeyDown={(e) => {
          if (navCol === undefined) {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            return;
          }
          // Spaltenweise Navigation: Enter/Tab → nächste Zeile derselben Spalte,
          // am Spaltenende in die nächste Spalte (Shift = rückwärts).
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const inputs = navInputs(e.currentTarget);
            const i = inputs.indexOf(e.currentTarget);
            const ziel = e.shiftKey ? inputs[i - 1] : inputs[i + 1];
            if (ziel) {
              ziel.focus();
              ziel.select();
            } else {
              e.currentTarget.blur();
            }
          }
        }}
      />
      {naErlaubt && (
        <button
          type="button"
          className="link-button na-toggle"
          title="Als nicht belegt markieren"
          onClick={() => onSpeichern({ wert: null, istNa: true })}
        >
          n/a
        </button>
      )}
    </div>
  );
}
