/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Backend-Port für den Dev-Proxy. Muss zum PORT des Servers passen (Default 4000);
// bei abweichendem PORT hier per API_PORT (oder PORT) setzen.
const apiPort = process.env['API_PORT'] ?? process.env['PORT'] ?? '4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Im Dev-Modus API-Aufrufe an den Fastify-Server weiterleiten.
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
