/**
 * Minimaler, robuster CSV-Parser für Importe. Erkennt das Trennzeichen
 * automatisch (Komma oder Semikolon — deutsches Excel nutzt `;`), entfernt ein
 * BOM, unterstützt in Anführungszeichen stehende Felder (inkl. ""-Escaping und
 * eingebetteter Trennzeichen/Zeilenumbrüche) und überspringt Leerzeilen.
 *
 * Rückgabe: je Datenzeile ein Objekt {spaltennameKleingeschrieben: wert}.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const ohneBom = text.replace(/^﻿/, '');
  const umbruch = ohneBom.search(/\r?\n/);
  const ersteZeile = umbruch >= 0 ? ohneBom.slice(0, umbruch) : ohneBom;
  const delimiter =
    ersteZeile.split(';').length > ersteZeile.split(',').length ? ';' : ',';

  const records = parseRecords(ohneBom, delimiter);
  if (records.length === 0) return [];

  const header = records[0]!.map((h) => h.trim().toLowerCase());
  return records
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = (r[i] ?? '').trim();
      });
      return obj;
    });
}

function parseRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let feld = '';
  let zeile: string[] = [];
  let imQuote = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (imQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          feld += '"';
          i++;
        } else {
          imQuote = false;
        }
      } else {
        feld += c;
      }
    } else if (c === '"') {
      imQuote = true;
    } else if (c === delimiter) {
      zeile.push(feld);
      feld = '';
    } else if (c === '\n') {
      zeile.push(feld);
      rows.push(zeile);
      zeile = [];
      feld = '';
    } else if (c !== '\r') {
      feld += c;
    }
  }
  if (feld !== '' || zeile.length > 0) {
    zeile.push(feld);
    rows.push(zeile);
  }
  return rows;
}
