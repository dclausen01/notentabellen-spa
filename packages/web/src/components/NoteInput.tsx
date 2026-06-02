import { useEffect, useState } from 'react';
import type { MaskeWert } from '../types.js';

interface Props {
  wert: MaskeWert;
  /** Erlaubt das Setzen auf „nicht belegt" (n/a). */
  naErlaubt: boolean;
  onSpeichern: (neu: MaskeWert) => void;
}

/**
 * Eingabezelle für eine Note (0–15) mit optionalem n/a-Schalter. Speichert beim
 * Verlassen des Feldes bzw. beim Umschalten von n/a (debouncefrei, da Speichern
 * an `onBlur` hängt).
 */
export function NoteInput({ wert, naErlaubt, onSpeichern }: Props) {
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
        onChange={(e) => setText(e.target.value)}
        onBlur={uebernehmen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
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
