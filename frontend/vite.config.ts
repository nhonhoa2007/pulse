import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
