import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
//
// `base` must match the GitHub Pages subpath. For a project site the app is
// served from https://<user>.github.io/<repo>/, so assets need that prefix in
// production. In dev we keep '/'. Override via the BASE_PATH env var if needed.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
});
