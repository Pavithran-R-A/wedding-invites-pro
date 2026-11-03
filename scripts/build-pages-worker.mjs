#!/usr/bin/env node
// VIVAAHVARNAM — build the edge Worker a real host runs in front of the static bundle.
//
// Why a separate bundler step rather than another Vite entry. `render.html` is a second *document*
// and belongs in Vite's graph, where it shares the app's hashed dependency chunks. `_worker.js` is
// neither a document nor a browser module: it runs on Cloudflare's Workers runtime, it must not
// carry React, and Pages reads it from the top level of the deployed directory as a self-contained
// ES module. A Vite entry would either pull the app's chunk graph into it or need a second
// `rollupOptions` shape argued about for years. esbuild is already in the tree as Vite's own
// dependency, so this adds no package to `package.json`.
//
// Why `dist/_worker.js` is generated and not tracked. The Worker imports
// `src/lib/ogShellDocument.ts`, `src/lib/ogMetadata.ts`, `src/lib/publicInvitation.ts` and
// `src/render/qrTarget.ts` directly — that sharing is the whole design — so a committed copy of the
// output would be a second source of truth that rots the first time one of those four changes. It is
// a build artefact, and `dist/` is already ignored.
//
// Unminified on purpose. The free-tier bundle limit is measured in megabytes and this file is
// measured in kilobytes; the value of readable bytes is that an operator can diff what the host will
// actually execute against what this repository says it executes.
//
// Usage: npm run build && node scripts/build-pages-worker.mjs
// Exit 1 means the Worker could not be built; a missing `dist/` is a usage error and exits 2.

import { build } from 'esbuild';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src', 'host', 'pages-worker.ts');
const OUT_DIR = resolve(process.env.PAGES_DIST_DIR ?? join(ROOT, 'dist'));
const OUTFILE = join(OUT_DIR, '_worker.js');

if (!existsSync(join(OUT_DIR, 'index.html'))) {
  console.error(`build-pages-worker: no dist/index.html in ${OUT_DIR} — run \`npm run build\` first`);
  process.exit(2);
}

try {
  await build({
    absWorkingDir: ROOT,
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'esm',
    // workerd supports `??`, optional chaining and top-level await; es2022 is the target Cloudflare
    // documents for ES modules and the lowest common denominator that keeps the output readable.
    target: 'es2022',
    platform: 'browser',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    // The Worker is a module graph of four product files and nothing else. Any package that resolves
    // to something outside `src/` would mean the sharing rule in the header has already broken.
    external: [],
  });
} catch (error) {
  console.error(`build-pages-worker: esbuild failed — ${error?.message ?? String(error)}`);
  process.exit(1);
}

const bytes = statSync(OUTFILE).size;
// The tripwire that makes the header's "must not carry React" a fact about the artefact rather than
// an intention about the source: esbuild writes `// node_modules/react/...` section banners into an
// unminified bundle, so a stray import anywhere in the four shared modules shows up here.
const carriesReact = readFileSync(OUTFILE, 'utf8').includes('node_modules/react');
if (carriesReact) {
  console.error('build-pages-worker: the bundle carries React, which the header forbids');
  process.exit(1);
}

// Pages' own routing hint. The three door prefixes and every extension-less path are the ones whose
// first bytes this repository decides; a fingerprinted chunk or a font is a byte-for-byte repeat of a
// file already in the bucket, and sending it through the Worker spends the account's daily request
// allowance on something that needs no decision. `include: ["/*"]` is the fallback shape, so the file
// only ever narrows what reaches the Worker rather than opening a route that was closed.
//
// What is not claimed: that advanced mode reads this file at all. Cloudflare documents
// `_worker.js` as taking "full control of all incoming HTTP requests" and `_routes.json` as the
// Functions routing control, and does not state on the pages it names which wins; if advanced mode
// ignores it, every request goes through the Worker — a billing nuance, not a correctness one,
// because the Worker returns the same asset bytes either way.
const ROUTES = {
  version: 1,
  include: ['/*'],
  exclude: ['/assets/*', '/fonts/*', '/favicon.ico', '/robots.txt'],
};
writeFileSync(join(OUT_DIR, '_routes.json'), `${JSON.stringify(ROUTES, null, 2)}\n`);

console.log(`build-pages-worker: wrote ${OUTFILE} (${bytes} bytes, react-free) and _routes.json`);
