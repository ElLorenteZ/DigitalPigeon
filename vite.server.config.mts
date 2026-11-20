import { defineConfig } from 'vite';

// The local server (src/server/main.ts) as one ES module for Node. Dependencies stay external and load from
// node_modules. The `.mjs` name makes Node read it as ESM without `"type": "module"` in package.json.
// https://vitejs.dev/config
export default defineConfig({
  build: {
    ssr: 'src/server/main.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'main.mjs' } },
  },
});
