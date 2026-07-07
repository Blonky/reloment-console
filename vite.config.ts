import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // Served under /demo (reloment.com/demo and reloment-console.pages.dev/demo).
  // Vite prefixes every asset URL with this base so deep links resolve at any
  // route depth; the Router basename below keeps client navigation in sync.
  base: '/demo/',
  plugins: [react()],
});
