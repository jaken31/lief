#!/usr/bin/env node
/**
 * Lief extension build.
 *
 * Three separate passes, because they have incompatible output formats:
 *
 *   pages       React + Tailwind, ESM with code splitting   → dist/pages/**
 *   content     IIFE, single self-contained file            → dist/content/index.js
 *   background  ESM single file (manifest sets type:module) → dist/background/index.js
 *
 * A content script CANNOT be an ES module, which is why it cannot share a pass
 * with the pages. This is the reason @crxjs/vite-plugin exists; we do it by hand
 * instead, per TRD §11's escape hatch.
 *
 * Passes are independent and isolated. A missing source file is skipped with a
 * warning; a pass that throws is reported and the rest still run. One track's
 * half-finished work must never stop another track from loading dist/ into Chrome.
 * The build still exits non-zero, so `npm run verify` stays honest.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { build } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const EXTENSION = resolve(ROOT, 'extension');
const DIST = resolve(ROOT, 'dist');

const rel = (p) => relative(ROOT, p);
const log = (msg) => console.log(`[lief:build] ${msg}`);
const skip = (msg) => console.warn(`[lief:build] skip · ${msg}`);
const warn = (msg) => console.warn(`[lief:build] WARN · ${msg}`);

const failures = [];

/** Runs one pass in isolation so its failure cannot cascade into the others. */
async function pass(label, fn) {
  try {
    await fn();
  } catch (cause) {
    failures.push(label);
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[lief:build] FAIL · ${label}`);
    console.error(message.split('\n').slice(0, 20).join('\n'));
  }
}

async function buildPages() {
  // Mirrors the filter in vite.config.ts; that copy exists for `vite dev`.
  const entries = ['review', 'course']
    .map((name) => resolve(EXTENSION, 'pages', name, 'index.html'))
    .filter((entry) => existsSync(entry));

  if (entries.length === 0) {
    skip('pages · no extension/pages/*/index.html yet (Tracks C & D)');
    return;
  }
  await build({ configFile: resolve(ROOT, 'vite.config.ts'), mode: 'production' });
  log(`pages · ${entries.map(rel).join(', ')}`);
}

/** Bundles one entry to a single self-contained file. */
async function buildScript({ label, entry, format, outFile, owner }) {
  if (!existsSync(entry)) {
    skip(`${label} · ${rel(entry)} does not exist yet (${owner})`);
    return;
  }
  await build({
    configFile: false,
    root: EXTENSION,
    mode: 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: DIST,
      emptyOutDir: false,
      sourcemap: true,
      target: 'chrome120',
      // Readable on purpose: debugging a content script live on stage beats saving 3 KB.
      minify: false,
      lib: { entry, formats: [format], name: 'Lief', fileName: () => outFile },
    },
  });
  log(`${label} · dist/${outFile}`);
}

/**
 * extension/manifest.json is Track A's file. Until it lands we fall back to a
 * content-script-only dev manifest so Track B can be verified via Load Unpacked.
 * The real manifest always wins once it exists.
 */
async function copyManifest() {
  const real = resolve(EXTENSION, 'manifest.json');
  const fallback = resolve(ROOT, 'dev', 'manifest.dev.json');

  if (existsSync(real)) {
    await copyFile(real, resolve(DIST, 'manifest.json'));
    log('manifest · extension/manifest.json');
    return;
  }
  if (existsSync(fallback)) {
    await copyFile(fallback, resolve(DIST, 'manifest.json'));
    warn('manifest · using dev/manifest.dev.json — Track A has not landed extension/manifest.json. No service worker in this build.');
    return;
  }
  warn('manifest · none found. dist/ will not load in Chrome.');
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await pass('pages', buildPages);
  await pass('content', () =>
    buildScript({
      label: 'content',
      entry: resolve(EXTENSION, 'content/index.ts'),
      format: 'iife',
      outFile: 'content/index.js',
      owner: 'Track B',
    }),
  );
  await pass('background', () =>
    buildScript({
      label: 'background',
      entry: resolve(EXTENSION, 'background/index.ts'),
      format: 'es',
      outFile: 'background/index.js',
      owner: 'Track A',
    }),
  );
  await pass('manifest', copyManifest);

  if (failures.length > 0) {
    console.error(
      `[lief:build] done WITH FAILURES · ${failures.join(', ')} — dist/ holds the passes that succeeded`,
    );
    process.exitCode = 1;
    return;
  }

  log('done → dist/');
}

await main();
