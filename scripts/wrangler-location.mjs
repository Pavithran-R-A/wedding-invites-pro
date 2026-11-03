// One answer to "where is wrangler, and is it real", shared by the two tools that drive it.
//
// Why it is not duplicated per tool. `scripts/host-response-contract.mjs` boots a Cloudflare runtime
// to measure this repository's own Worker, and `scripts/deploy-pages.mjs` is the tool that would put
// that Worker in front of a customer. Both need the same thing: an *entry script* to hand to `node`,
// found in a fixed order, with the source of the hit reported. Two copies would drift in the one
// place that matters — a resolution rule that quietly starts preferring a stale local copy over the
// operator's CLI, or the reverse, and then the tier and the deploy run different software while both
// say "wrangler".
//
// A real dependency, and an external one: Cloudflare's CLI is not vendored into this repository,
// because its only job here is to run the same runtime production runs, and an operator's machine is
// the place it belongs. The size of what that would mean is measured rather than remembered — the
// global install this repository uses is **173 MB**, of which the entry script every caller here
// resolves is **14,731,910 bytes (14.0 MiB)** — so "just add it to the project" is not a free
// suggestion. Nothing in here installs it either: an instrument that silently skipped a missing tool,
// or downloaded one, would be the worst kind of green.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/**
 * The wrangler entry script, or `null`.
 *
 * Order: an explicit `WRANGLER_BIN`, then this project's `node_modules` (the expected miss — wrangler
 * is not a dependency here), then any `node_modules/wrangler` sitting on `PATH`, which is where a
 * globally installed CLI actually lands. Each candidate carries the reason it was considered, because
 * a tool that reports "wrangler: <path>" without saying which rule found it cannot be debugged when
 * the path turns out to be somebody's other checkout.
 *
 * @param {string} importUrl The calling module's `import.meta.url`, used to resolve local packages.
 * @returns {{ from: string; path: string } | null}
 */
export function locateWrangler(importUrl) {
  const candidates = [];
  if (process.env.WRANGLER_BIN) {
    candidates.push({ from: 'WRANGLER_BIN', path: resolve(process.env.WRANGLER_BIN) });
  }
  try {
    const require = createRequire(importUrl);
    const pkg = require.resolve('wrangler/package.json');
    const dir = dirname(pkg);
    candidates.push({ from: 'local node_modules', path: join(dir, 'wrangler-dist', 'cli.js') });
    candidates.push({ from: 'local node_modules', path: join(dir, 'bin', 'wrangler.js') });
  } catch {
    // Not installed as a dependency of this project — the expected state.
  }
  for (const entry of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (entry === '') continue;
    const dir = join(entry, 'node_modules', 'wrangler');
    if (!existsSync(dir)) continue;
    for (const leaf of [join(dir, 'wrangler-dist', 'cli.js'), join(dir, 'bin', 'wrangler.js')]) {
      if (existsSync(leaf)) candidates.push({ from: `PATH entry ${entry}`, path: leaf });
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate.path)) return candidate;
  }
  return null;
}
