import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { STANDARD_NOTENSKALA, tendenzAusEndpunkten, type ErgebnisHalbjahr } from '@notentabellen/core';
import type { DB } from '../db/connection.js';
import { berechneFachFuerSchueler } from './berechnung.js';

const VORLAGE = fileURLToPath(new URL('../../assets/notenbekanntgabe-vorlage.docx', import.meta.url));

// Ausbildungsnoten (Tendenz): Fach-Schlüssel → Serienbrief-Feldname.
const AUSBILDUNG: [string, string][] = [
  ['LF1', 'LF1'], ['LF2', 'LF2'], ['LF3', 'LF3'], ['LF4', 'LF4'],
  ['PRAXIS', 'Praxis'], ['DEUTSCH', 'Deutsch'], ['ENGLISCH', 'Englisch'],
  ['WIPO', 'WiPo'], ['RELIGION', 'Religion'], ['MATHEMATIK', 'Mathematik'],
];
// Englisch/Mathe: die Vornote (Unterrichtsleistung) ausweisen, nicht die
// FHR-verrechnete Endnote — die Prüfung steht separat als ESA2/MSA2.
const VORNOTE_AUS_ZWISCHEN = new Set(['ENGLISCH', 'MATHEMATIK']);
// Prüfungsnoten (Tendenz): Fach-Schlüssel → Serienbrief-Feldname.
const PRUEFUNGEN: [string, string][] = [
  ['LF2', '1SA2'], ['LF3', '2SA2'], ['DEUTSCH', '3SA2'], ['ENGLISCH', 'ESA2'], ['MATHEMATIK', 'MSA2'],
];

/** Tendenz des höchsten Halbjahres mit Wert (Vornote = Zwischennote bzw. Endpunkte). */
function vornoteTendenz(erg: ErgebnisHalbjahr[], ausZwischen: boolean): string {
  for (let hj = 4; hj >= 1; hj--) {
    const e = erg.find((x) => x.halbjahr === hj);
    const v = ausZwischen ? e?.zwischennote : e?.endpunkte;
    if (v != null) return tendenzAusEndpunkten(v, STANDARD_NOTENSKALA) ?? '';
  }
  return '';
}

/** Baut je Schüler:in die Serienbrief-Felder für das Notenbekanntgabeblatt (4. Hj.). */
export function notenbekanntgabeDaten(db: DB, klasseId: number): { felder: Record<string, string> }[] {
  const schueler = db
    .prepare('SELECT id, name, vorname FROM schueler WHERE klasse_id = ? AND aktiv = 1 ORDER BY name, vorname')
    .all(klasseId) as { id: number; name: string; vorname: string }[];
  const pruefStmt = db.prepare(
    `SELECT pn.wert, pn.ist_na AS istNa FROM pruefungsnote pn
       JOIN fach f ON f.id = pn.fach_id
      WHERE pn.schueler_id = ? AND f.schluessel = ? AND pn.halbjahr = 4`,
  );

  return schueler.map((s) => {
    const felder: Record<string, string> = { Name: s.name, Vorname: s.vorname };
    for (const [fach, feld] of AUSBILDUNG) {
      felder[feld] = vornoteTendenz(berechneFachFuerSchueler(db, s.id, fach), VORNOTE_AUS_ZWISCHEN.has(fach));
    }
    for (const [fach, feld] of PRUEFUNGEN) {
      const row = pruefStmt.get(s.id, fach) as { wert: number | null; istNa: number } | undefined;
      felder[feld] =
        row && !row.istNa && row.wert != null ? (tendenzAusEndpunkten(row.wert, STANDARD_NOTENSKALA) ?? '') : '';
    }
    return { felder };
  });
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Ersetzt die einfachen Word-Serienbrieffelder (`<w:fldSimple w:instr="MERGEFIELD X">`)
 * durch die Werte; die Run-Formatierung (z. B. fett bei Name) bleibt erhalten.
 */
function ersetzeFelder(xml: string, felder: Record<string, string>): string {
  return xml.replace(
    /<w:fldSimple\b[^>]*w:instr="\s*MERGEFIELD\s+([A-Za-z0-9]+)[^"]*"[^>]*>([\s\S]*?)<\/w:fldSimple>/g,
    (_m, name: string, inner: string) => {
      const wert = xmlEsc(felder[name] ?? '');
      // «X»-Text im inneren Run durch den Wert ersetzen, Run (mit rPr) behalten.
      return inner.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/, `$1${wert}$2`);
    },
  );
}

/**
 * Erzeugt das Notenbekanntgabe-Dokument (4. Hj.) als DOCX: das Original-Template
 * wird je Schüler:in einmal eingesetzt (eine Section pro Person, Seitenzählung je
 * Blatt neu bei 1), die Serienbrieffelder mit den Noten gefüllt.
 */
export async function notenbekanntgabeDocx(db: DB, klasseId: number): Promise<Buffer> {
  const records = notenbekanntgabeDaten(db, klasseId);
  const zip = await JSZip.loadAsync(readFileSync(VORLAGE));
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Vorlage ungültig (word/document.xml fehlt)');
  const docXml = await docFile.async('string');

  const bodyStart = docXml.indexOf('<w:body>') + '<w:body>'.length;
  const bodyEnd = docXml.lastIndexOf('</w:body>');
  const prefix = docXml.slice(0, bodyStart);
  const suffix = docXml.slice(bodyEnd);
  const body = docXml.slice(bodyStart, bodyEnd);

  // Letztes <w:sectPr> = Section-Eigenschaften; davor liegt der Inhalt eines Blattes.
  const sectStart = body.lastIndexOf('<w:sectPr');
  const recordInner = body.slice(0, sectStart);
  // Seitenzählung je Schüler:in neu bei 1 beginnen.
  const finalSect = body.slice(sectStart).replace(/(<w:pgMar\b[^>]*\/>)/, '$1<w:pgNumType w:start="1"/>');
  const sectBreak = `<w:p><w:pPr>${finalSect}</w:pPr></w:p>`;

  const merged =
    records
      .map((r, i) => {
        const inner = ersetzeFelder(recordInner, r.felder);
        return i < records.length - 1 ? inner + sectBreak : inner;
      })
      .join('') + finalSect;

  zip.file('word/document.xml', prefix + merged + suffix);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
