import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const ROOT = import.meta.dirname;
const EXTENSION = resolve(ROOT, 'extension');

/**
 * Pages build only. The service worker and content script are bundled separately
 * by scripts/build.mjs, because a content script cannot be an ES module.
 *
 * Entries are filtered by existence so the build keeps working while Tracks C and D
 * are still empty. Everyone can run `npm run build` from minute one.
 */
export const pageEntries = ['review', 'course']
  .map((name) => resolve(EXTENSION, 'pages', name, 'index.html'))
  .filter((entry) => existsSync(entry));

export default defineConfig({
  root: EXTENSION,
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(ROOT, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: { input: pageEntries },
  },
});
