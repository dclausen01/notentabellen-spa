import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Lädt die `.env`-Datei des Server-Pakets in `process.env`, falls vorhanden.
 * Im lokalen Betrieb liegen die Werte in `packages/server/.env`; in Produktion
 * (z. B. Plesk/Passenger) können die Variablen auch direkt aus der Umgebung
 * kommen — dann fehlt die Datei einfach und es werden ausschließlich die
 * Prozess-Variablen genutzt. (tsx/node laden `.env` nicht von selbst.)
 *
 * Reihenfolge: zuerst `.env` im aktuellen Arbeitsverzeichnis, dann die
 * `.env` im Paketstamm (relativ zu diesem Modul — unabhängig vom Aufrufer).
 */
export function ladeEnvDatei(): void {
  if (typeof process.loadEnvFile !== 'function') return;
  const kandidaten = ['.env', fileURLToPath(new URL('../.env', import.meta.url))];
  for (const pfad of kandidaten) {
    if (existsSync(pfad)) {
      process.loadEnvFile(pfad);
      return;
    }
  }
}
