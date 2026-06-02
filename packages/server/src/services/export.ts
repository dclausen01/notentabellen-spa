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
  const faecher = zeilen[0]?.faecher.map((f) => f.fach) ?? [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Notenverwaltung SPA';
  wb.created = new Date();

  const titel = `Zeugnis – ${info.bezeichnung} (${info.schuljahr}) – ${halbjahr}. Halbjahr`;

  const baueBlatt = (
    name: string,
    wert: (fach: string, zeile: (typeof zeilen)[number]) => string | number | null,
  ): void => {
    const ws = wb.addWorksheet(name);
    const spaltenZahl = 2 + faecher.length;

    ws.mergeCells(1, 1, 1, Math.max(1, spaltenZahl));
    const titelZelle = ws.getCell(1, 1);
    titelZelle.value = titel;
    titelZelle.font = { bold: true, size: 13 };

    const kopf = ['Name', 'Vorname', ...faecher.map((f) => fachNamen.get(f) ?? f)];
    const kopfRow = ws.getRow(3);
    kopfRow.values = kopf;
    kopfRow.font = { bold: true };
    kopfRow.alignment = { horizontal: 'center' };
    kopfRow.getCell(1).alignment = { horizontal: 'left' };
    kopfRow.getCell(2).alignment = { horizontal: 'left' };

    for (const z of zeilen) {
      const row = ws.addRow([
        z.name,
        z.vorname,
        ...faecher.map((f) => {
          const zelle = z.faecher.find((c) => c.fach === f);
          return zelle ? wert(f, z) : null;
        }),
      ]);
      row.alignment = { horizontal: 'center' };
      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(2).alignment = { horizontal: 'left' };
    }

    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 16;
    for (let i = 0; i < faecher.length; i++) ws.getColumn(3 + i).width = 14;
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
  };

  baueBlatt('Tendenznoten', (fach, z) => {
    const zelle = z.faecher.find((c) => c.fach === fach);
    return zelle?.tendenz ?? '–';
  });
  baueBlatt('Endpunkte', (fach, z) => {
    const zelle = z.faecher.find((c) => c.fach === fach);
    return zelle?.endpunkte != null ? Number(zelle.endpunkte.toFixed(2)) : null;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
