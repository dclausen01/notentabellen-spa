import ExcelJS from 'exceljs';
import type { DB } from '../db/connection.js';
import { listeFaecher } from '../db/admin.js';
import { zeugnisFuerKlasse } from './berechnung.js';

interface KlasseInfo {
  bezeichnung: string;
  schuljahr: string;
}

function klasseInfo(db: DB, klasseId: number): KlasseInfo {
  const row = db
    .prepare('SELECT bezeichnung, schuljahr FROM klasse WHERE id = ?')
    .get(klasseId) as KlasseInfo | undefined;
  if (!row) throw new Error(`Klasse ${klasseId} nicht gefunden`);
  return row;
}

/** Dateiname-tauglicher Slug aus der Klassenbezeichnung. */
export function exportDateiname(db: DB, klasseId: number, halbjahr: number): string {
  const { bezeichnung, schuljahr } = klasseInfo(db, klasseId);
  const slug = `${bezeichnung}_${schuljahr}`.replace(/[^\w.-]+/g, '_');
  return `Zeugnis_${slug}_${halbjahr}Hj.xlsx`;
}

/**
 * Erzeugt das Zeugnis einer Klasse für ein Halbjahr als XLSX-Datei:
 * Blatt „Tendenznoten" (offizielle Note je Fach) und Blatt „Endpunkte"
 * (ungerundete kumulierte Punkte zur Nachvollziehbarkeit). Spalten sind die in
 * diesem Halbjahr aktiven Fächer, Zeilen die Schüler:innen.
 */
export async function zeugnisAlsXlsx(
  db: DB,
  klasseId: number,
  halbjahr: number,
): Promise<Buffer> {
  const info = klasseInfo(db, klasseId);
  const zeilen = zeugnisFuerKlasse(db, klasseId, halbjahr);
  const fachNamen = new Map(listeFaecher(db).map((f) => [f.schluessel, f.name]));

  // Einheitliche Spaltenliste: erst Fächer, dann (im Abschlusszeugnis) der
  // hervorgehobene Prüfungsblock.
  type Spalte = { key: string; label: string; pruefung: boolean };
  const fachSpalten: Spalte[] = (zeilen[0]?.faecher ?? []).map((f) => ({
    key: f.fach,
    label: f.label ?? fachNamen.get(f.fach) ?? f.fach,
    pruefung: false,
  }));
  const pruefSpalten: Spalte[] = (zeilen[0]?.pruefungen ?? []).map((p) => ({
    key: p.fach,
    label: p.label ?? p.fach,
    pruefung: true,
  }));
  const spalten = [...fachSpalten, ...pruefSpalten];
  const zelleVon = (z: (typeof zeilen)[number], sp: Spalte) =>
    (sp.pruefung ? z.pruefungen : z.faecher)?.find((c) => c.fach === sp.key);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Notenverwaltung SPA';
  wb.created = new Date();

  const titel = `Zeugnis – ${info.bezeichnung} (${info.schuljahr}) – ${halbjahr}. Halbjahr`;
  const pruefFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFEDD5' },
  };

  const baueBlatt = (
    name: string,
    wert: (sp: Spalte, zeile: (typeof zeilen)[number]) => string | number | null,
  ): void => {
    const ws = wb.addWorksheet(name);
    const spaltenZahl = 2 + spalten.length;

    ws.mergeCells(1, 1, 1, Math.max(1, spaltenZahl));
    const titelZelle = ws.getCell(1, 1);
    titelZelle.value = titel;
    titelZelle.font = { bold: true, size: 13 };

    const kopf = ['Name', 'Vorname', ...spalten.map((s) => s.label)];
    const kopfRow = ws.getRow(3);
    kopfRow.values = kopf;
    kopfRow.font = { bold: true };
    kopfRow.alignment = { horizontal: 'center' };
    kopfRow.getCell(1).alignment = { horizontal: 'left' };
    kopfRow.getCell(2).alignment = { horizontal: 'left' };
    spalten.forEach((s, i) => {
      if (s.pruefung) kopfRow.getCell(3 + i).fill = pruefFill;
    });

    for (const z of zeilen) {
      const row = ws.addRow([
        z.name,
        z.vorname,
        ...spalten.map((s) => (zelleVon(z, s) ? wert(s, z) : null)),
      ]);
      row.alignment = { horizontal: 'center' };
      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(2).alignment = { horizontal: 'left' };
      spalten.forEach((s, i) => {
        if (s.pruefung) row.getCell(3 + i).fill = pruefFill;
      });
    }

    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 16;
    for (let i = 0; i < spalten.length; i++) ws.getColumn(3 + i).width = 14;
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
  };

  baueBlatt('Tendenznoten', (sp, z) => zelleVon(z, sp)?.tendenz ?? '–');
  baueBlatt('Endpunkte', (sp, z) => {
    const zelle = zelleVon(z, sp);
    return zelle?.endpunkte != null ? Number(zelle.endpunkte.toFixed(2)) : null;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
