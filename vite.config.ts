import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { modelEditorServer, srcTagBabel } from './dev/modelEditorPlugin';

// https://vite.dev/config/
//
// `base` must match the GitHub Pages subpath. For a project site the app is
// served from https://<user>.github.io/<repo>/, so assets need that prefix in
// production. In dev we keep '/'. Override via the BASE_PATH env var if needed.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig(({ command }) => ({
  base,
  plugins: [
    // Dev only: tag model elements with their source location and serve the
    // model editor's read/write endpoints (see dev/modelEditorPlugin.ts).
    react(command === 'serve' ? { babel: { plugins: [srcTagBabel] } } : {}),
    modelEditorServer(),
  ],
}));
