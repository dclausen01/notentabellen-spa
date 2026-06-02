import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Rechenkern im Test direkt aus dem Quellcode auflösen (kein vorheriger Build nötig).
export default defineConfig({
  resolve: {
    alias: {
      '@notentabellen/core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
});
