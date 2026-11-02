import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Packaged builds load the renderer from file://, so the CSP must be a <meta> tag.
// It is added only to production builds: the dev server's React refresh preamble
// is an inline script that a strict script-src would block.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

const cspOnBuild = (): Plugin => ({
  name: 'digital-pigeon-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
});

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), cspOnBuild()],
});
