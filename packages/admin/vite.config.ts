import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: '/admin/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/widget': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
