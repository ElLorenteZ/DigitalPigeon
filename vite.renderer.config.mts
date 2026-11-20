import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI, served by the local server (src/server/). The CSP is sent by the server as a response header
// (src/server/http.ts, `CSP`), not as a <meta> tag (ADR 0002). The dev server runs without it, as before.
// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/ui', emptyOutDir: true },
});
