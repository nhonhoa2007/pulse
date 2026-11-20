import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function versionServiceWorker() {
  return {
    name: 'pulse-version-service-worker',
    async closeBundle() {
      const distDir = resolve(process.cwd(), 'dist');
      const assetsDir = resolve(distDir, 'assets');
      const assetNames = await readdir(assetsDir);
      const buildId = createHash('sha256').update(assetNames.sort().join('|')).digest('hex').slice(0, 12);
      const serviceWorkerPath = resolve(distDir, 'sw.js');
      const source = await readFile(serviceWorkerPath, 'utf8');
      await writeFile(serviceWorkerPath, source.replace('__PULSE_BUILD_ID__', buildId), 'utf8');
    },
  };
}

export default defineConfig({
  plugins: [react(), versionServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/.well-known': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/actor': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/nodeinfo': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/inbox': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
