/**
 * Bundle-boundary checker: reads the built chunks and proves which pages can download the QR encoder.
 *
 *   node scripts/check-bundle-boundary.mjs              human-readable report, exit 1 on findings
 *   node scripts/check-bundle-boundary.mjs --json       machine-readable report
 *
 * This is the authoritative form of the §9.4 promise, and the form `check-product-contract.mjs:475`
 * already names but does not run: "reachable only from `dist/render.*` and never from the guest
 * bundle" is a statement about the bytes a browser fetches, so it has to be measured on those bytes.
 * The source-side rule in that file proves nobody wrote an import; this file proves what the bundler
 * did with it — whether a shared chunk was hoisted into the eager shell, whether Vite's preload list
 * for a route quietly names the encoder, whether a tree-shake moved a marker into a guest chunk.
 *
 * Four surfaces, named rather than discovered, because a rename must fail loudly instead of making a
 * rule vacuously true:
 *
 *   * the eager app shell — what `index.html` fetches before any route resolves, shared by a guest
 *     who opens a link and a host who signs in;
 *   * the guest doors — `PublicInvitation` and `GuestDoor`: the route chunk, the preload list that
 *     arrives with it, everything it statically imports, and anything its own code lazily imports
 *     while it is open. Not the other routes — this is a single-page app whose router holds one lazy
 *     edge per page, and following those would report the editor as part of a guest's invitation
 *     because a guest could in principle navigate there. That is a fact about the router, not about
 *     what a guest downloads, and the sweep measures the second thing;
 *   * the host editor — `EditProject` as it opens, preload list included, which must still be
 *     encoder-free, because the plate is drawn only when the host presses for one;
 *   * the render harness — `render.html`, the one document that is *required* to carry the encoder,
 *     which is why a missing encoder there is a finding rather than a clean row.
 *
 * The fingerprints are string literals, chosen for what they can prove:
 *
 *   * `ENCODER_LIB_MARKERS` are identifiers from inside `qrcode/lib/core` that no file in `src/`
 *     writes, so a chunk carrying one physically contains the symbol-encoding library. `src/render/qrPlate.ts:36`
 *     is the only import of that package, so the library must sit in exactly one chunk.
 *   * `PLATE_MARKERS` are this product's own refusal and geometry vocabulary — the door names in
 *     `src/render/qrTarget.ts`, the size refusal in `src/render/qrPlate.ts`, the attribute
 *     `src/render/QrCanvas.tsx` stamps. They catch the weaker regression the library marker cannot:
 *     a guest chunk that ends up carrying the plate *vocabulary* has been linked to the render path
 *     even if a tree-shake left the library out of it.
 *
 * Both sets are checked for liveness before anything is reported clean. A fingerprint that matches no
 * chunk at all would make every surface look encoder-free, so that state is a finding: the sweep has
 * gone stale and has to be re-derived against whatever the build produces now.
 *
 * Deterministic: reads `dist/`, no network, no inference, no skipping — a missing bundle is a finding
 * that says to run the build, not a pass.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function resolveRepoRoot() {
  try {
    return fileURLToPath(new URL("../", import.meta.url));
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = resolveRepoRoot();
const posix = (p) => p.split(sep).join("/");
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

/** Literal identifiers that exist only inside the QR library `src/render/qrPlate.ts` imports. */
export const ENCODER_LIB_MARKERS = ["maskPattern", "Alphanumeric", "getEncodedBits"];

/** Literal vocabulary this product writes for plate geometry and door refusals. */
export const PLATE_MARKERS = ["data-qr-module-scale", "target-private-door", "plate-too-dense"];

/** The two guest doors, by chunk basename prefix — the pages a guest's phone may load. */
export const GUEST_ROUTE_PREFIXES = ["PublicInvitation", "GuestDoor"];

/** The host's editor route and the lazy plate affordance behind its press. */
export const HOST_ROUTE_PREFIX = "EditProject";
export const AFFORDANCE_PREFIX = "ShareQrPlate";

const ASSET_DIR = "assets";
const DOCUMENTS = ["index.html", "render.html"];

const nameOf = (file) => posix(file).split("/").pop();

/**
 * A read surface over a built bundle, so the rules run against `dist/` or against a fixture map.
 * Paths are bundle-root-relative (`assets/render-abc.js`, `index.html`).
 */
export function diskBundle(root = join(REPO_ROOT, "dist")) {
  const at = (rel) => join(root, rel);
  const isDirectory = (rel) => existsSync(at(rel)) && statSync(at(rel)).isDirectory();
  return {
    exists: (rel) => existsSync(at(rel)),
    read: (rel) => readFileSync(at(rel), "utf8"),
    files: (dir) => (isDirectory(dir)
      ? readdirSync(at(dir)).filter((name) => !name.startsWith(".")).map((name) => `${posix(dir)}/${name}`)
      : []),
  };
}

/** The same surface over an in-memory object, for the fixture battery. */
export function memoryBundle(entries) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [posix(k), v]));
  return {
    exists: (rel) => map.has(posix(rel)),
    read: (rel) => {
      const value = map.get(posix(rel));
      if (value === undefined) throw new Error(`no fixture entry for ${rel}`);
      return value;
    },
    files: (dir) => [...map.keys()].filter((k) => k.startsWith(`${posix(dir)}/`)),
  };
}

/** The documents a browser opens name their eager files in a `src` or `href` attribute. */
export function eagerAssetsOf(html) {
  const out = new Set();
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const ref = /[\s"'](?:src|href)="[^"]*\/assets\/([^"]+\.js)"/.exec(tag[0]);
    if (ref !== null) out.add(`${ASSET_DIR}/${ref[1]}`);
  }
  return [...out];
}

/**
 * One chunk's outgoing edges, read from the shapes the bundler actually emits.
 *
 * The classification is by *positive* syntax rather than by elimination of a guessed static form,
 * because an optional group in an earlier version of this reader matched every chunk reference as
 * static and made a lazy affordance look eager. A dynamic import is `import("./x.js")`; a static one
 * is any other `"./x.js"` reference in the same file. Vite's preload lists use a third form —
 * `"assets/x.js"` inside the `m.f` array — so it cannot be mistaken for either.
 *
 * Each shape is its own literal, and a preload list is read from the window right after the import it
 * belongs to, rather than from one pattern that carries both. That split is also what a V8 quirk
 * forces: a literal whose optional group nests `(` inside `\(` is rejected as written below, while the
 * same text compiles through `new RegExp`, so a single combined pattern would make this file fail to
 * parse for a reason that has nothing to do with bundles.
 */
const DEPENDENCY_LIST = /m\.f=\[([^\]]*)\]/;
const QUOTED_NAME = /"([^"]+)"/g;
const DYNAMIC_IMPORT = /import\(\s*"\.\/([A-Za-z0-9._-]+\.js)"/g;
const PRELOAD_TAIL = /^\s*\),\s*__vite__mapDeps\(\[([\d,\s]*)\]/;
const ANY_REFERENCE = /"\.\/([A-Za-z0-9._-]+\.js)"/g;

export function edgesOf(chunkSource) {
  const assetList = DEPENDENCY_LIST.exec(chunkSource);
  const deps = assetList === null ? [] : [...assetList[1].matchAll(QUOTED_NAME)].map((m) => m[1]);

  // Bundle-relative paths, because that is how the graph is keyed and how the documents name their
  // files. A bare `qrTarget-abc.js` from inside a chunk would otherwise never match a node.
  const dynamic = new Map();
  for (const m of chunkSource.matchAll(DYNAMIC_IMPORT)) {
    const tail = chunkSource.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const paired = PRELOAD_TAIL.exec(tail);
    const indices = paired === null ? []
      : paired[1].split(",").map((s) => Number(s.trim())).filter(Number.isInteger);
    const target = `${ASSET_DIR}/${m[1]}`;
    const previous = dynamic.get(target) ?? [];
    dynamic.set(target, [...previous, ...indices.map((i) => deps[i]).filter(Boolean)]);
  }

  const referenced = new Set();
  for (const m of chunkSource.matchAll(ANY_REFERENCE)) referenced.add(`${ASSET_DIR}/${m[1]}`);
  const statics = [...referenced].filter((name) => !dynamic.has(name));

  return { statics, dynamic };
}

/**
 * Everything a document can fetch from a set of starting files.
 *
 * `followDynamic` widens the walk to the dynamic imports and their preload lists. `stopAt` names the
 * chunks a dynamic edge may not cross into, which is what makes a per-page measurement possible: an
 * SPA's router holds one lazy edge per route, and following those from any page would report every
 * route in the app as reachable from a guest's invitation — a true fact about the router and a false
 * one about what the guest downloads. Interaction *inside* a page (a component imported on a press)
 * is still followed, because that fetch really does happen on that page.
 *
 * The returned parent map lets a finding name the edge that brought the encoder in, which is the part
 * a reader acts on.
 */
export function walk(bundle, graph, roots, { followDynamic, stopAt = new Set() }) {
  const starting = new Set(roots);
  const parent = new Map(roots.map((r) => [r, null]));
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift();
    const edges = graph.get(file);
    if (edges === undefined) continue;
    const visit = (target, via) => {
      if (!graph.has(target) || parent.has(target)) return;
      parent.set(target, `${file} ${via} ${target}`);
      queue.push(target);
    };
    for (const s of edges.statics) visit(s, "statically imports");
    if (!followDynamic) continue;
    for (const [target, preloads] of edges.dynamic) {
      if (stopAt.has(target) && !starting.has(target)) continue;
      visit(target, "dynamically imports");
      for (const preload of preloads) visit(preload, "preloads for that import");
    }
  }
  return { reached: [...parent.keys()], parent };
}

/**
 * The files a lazy edge brings down with its target, each paired with the chunk that holds the edge.
 *
 * Vite's emitted list begins with the imported chunk itself — measured on this repo's build, where
 * `index-*.js` opens `assets/Index-Dz4LMel9.js` with a list whose first entry is that same file. The
 * list is reported verbatim rather than as "extras", because a route chunk that carries the library
 * inline is exactly the case the preload rule exists to catch.
 */
export function preloadEdges(graph, entries) {
  const wanted = new Set(entries);
  const found = [];
  for (const [loader, edge] of graph) {
    for (const [target, deps] of edge.dynamic) {
      if (!wanted.has(target)) continue;
      for (const dep of deps) {
        if (dep.endsWith(".js")) found.push({ loader, file: dep });
      }
    }
  }
  return found;
}

/** The files an edge that opens `entries` brings down with it, from the route table's preload list. */
export function preloadsFor(graph, entries) {
  return [...new Set(preloadEdges(graph, entries).map((e) => e.file))];
}

const chunkNamed = (files, prefix) => files.filter((f) => nameOf(f).startsWith(prefix));

/** Every edge the reader found, so a parse that quietly returns nothing cannot be read as a clean bundle. */
const edgeCount = (graph) => [...graph].reduce((n, [, edges]) => n + edges.statics.length + edges.dynamic.size, 0);

/**
 * @param bundle a `diskBundle`/`memoryBundle` read surface rooted at a built bundle.
 */
export function auditBundle(bundle) {
  const findings = [];
  const measures = [];
  const add = (rule, path, message) => findings.push({ rule, path, message });

  for (const doc of DOCUMENTS) {
    if (!bundle.exists(doc)) {
      add("bundle-incomplete", doc, "is not in the bundle; this build did not produce the documents §9.4 measures");
    }
  }
  const assetFiles = bundle.files(ASSET_DIR).filter((f) => f.endsWith(".js"));
  if (assetFiles.length === 0) {
    add("bundle-not-built", ASSET_DIR,
      "has no chunks. Run `npm run build` first — this sweep reads the bytes a browser downloads, "
      + "and it will not report a boundary it could not measure");
    return { findings, measures, status: "failed" };
  }

  const sources = new Map(assetFiles.map((f) => [f, bundle.read(f)]));
  const graph = new Map([...sources].map(([f, text]) => [f, edgesOf(text)]));
  const carries = (file, markers) => markers.some((m) => (sources.get(file) ?? "").includes(m));

  const encoderChunks = assetFiles.filter((f) => carries(f, ENCODER_LIB_MARKERS));
  const plateChunks = assetFiles.filter((f) => carries(f, PLATE_MARKERS));
  const qrChunks = [...new Set([...encoderChunks, ...plateChunks])];

  // Reader liveness, before any surface is called clean: a bundle whose edges this file cannot read
  // would make every closure below a single file, and a single-file closure never contains anything.
  const importEdges = edgeCount(graph);
  if (importEdges === 0) {
    add("reader-stale", `${ASSET_DIR}/`,
      "exposes no import edge this file recognises across " + String(assetFiles.length)
      + " chunk(s); the bundler's reference syntax changed, so a clean row below would be this reader "
      + "going blind rather than the boundary holding");
  }

  // Liveness before verdicts: a fingerprint that matches nothing would leave every surface looking
  // clean, so the sweep reports its own staleness instead of the bundle's innocence.
  if (encoderChunks.length === 0) {
    add("fingerprint-stale", `${ASSET_DIR}/`,
      `no chunk carries the library literals ${ENCODER_LIB_MARKERS.join(", ")}; the encoder moved, `
      + "changed name or was replaced, so this sweep can no longer prove §9.4 and must be re-derived");
  }
  if (plateChunks.length === 0) {
    add("fingerprint-stale", `${ASSET_DIR}/`,
      `no chunk carries the plate vocabulary ${PLATE_MARKERS.join(", ")}; the render path was renamed `
      + "or removed, so a clean guest result below would be an artefact of this file, not of the build");
  }
  if (encoderChunks.length > 1) {
    add("encoder-duplicated", encoderChunks.join(", "),
      `the QR library appears in ${encoderChunks.length} chunks; one dependency must be one chunk, or `
      + "two bundles can carry two copies of a geometry the product claims is single-sourced");
  }

  const reachOfQr = (label, rule, reached, parent, startedVia = new Map(), skip = new Set()) => {
    const unexpected = reached.filter((f) => qrChunks.includes(f) && !skip.has(f));
    const witness = unexpected.length === 0 ? ""
      : ` (reached by ${unexpected
        .map((f) => parent.get(f) ?? startedVia.get(f) ?? `${nameOf(f)} is one of the starting files`)
        .join("; ")})`;
    if (unexpected.length > 0) {
      add(rule, unexpected.join(", "),
        `is reachable from ${label}${witness}; §9.4 confines the encoder to the render entry and to the `
        + "host's own press");
    }
    return new Set(unexpected);
  };

  // 1. the eager shell — fetched before any route resolves, so a guest who opens a link downloads it
  const shell = bundle.exists("index.html") ? eagerAssetsOf(bundle.read("index.html")) : [];
  const shellWalk = walk(bundle, graph, shell, { followDynamic: false });
  reachOfQr("the eager shell of `index.html`", "encoder-in-eager-shell", shellWalk.reached, shellWalk.parent);

  // The route table: every chunk some page of this single-page app can lazy-open. A guest who opens an
  // invitation link does not cross into another page's entry, so these are the boundaries a per-page
  // walk stops at — and why the guest rule below cannot simply follow every dynamic edge it finds.
  const routeTable = new Set(shellWalk.reached.flatMap((file) => {
    const edge = graph.get(file);
    return edge === undefined ? [] : [...edge.dynamic.keys()];
  }));
  const loadersOf = (entries) => [...graph].flatMap(([file, edge]) =>
    entries.filter((entry) => edge.dynamic.has(entry)).map(() => file));

  // 2. each guest door: what it downloads as it opens, and what its own code can fetch while open
  for (const prefix of GUEST_ROUTE_PREFIXES) {
    const routes = chunkNamed(assetFiles, prefix);
    if (routes.length === 0) {
      add("surface-missing", `${ASSET_DIR}/${prefix}*.js`,
        "has no chunk. A guest door stopped being its own chunk, so this sweep can no longer say what a "
        + "guest downloads and has to be re-read against the new shape");
      continue;
    }
    const guestEdges = preloadEdges(graph, routes);
    const guestPreloads = [...new Set(guestEdges.map((e) => e.file))];
    const guestRoots = [...new Set([...routes, ...guestPreloads])];
    const guestVia = new Map(guestEdges.map((e) => [e.file, `${nameOf(e.loader)} preloads it with the route`]));
    const onLoad = walk(bundle, graph, guestRoots, { followDynamic: false });
    const reported = reachOfQr(`the guest door "${prefix}" as it opens`, "encoder-reachable-from-guest-route",
      onLoad.reached, onLoad.parent, guestVia);
    // The second walk covers what the page's own code can fetch. Anything already reported above is
    // skipped, so one arrival in the route's preload list is one finding, not two identical ones.
    const triggered = walk(bundle, graph, guestRoots, { followDynamic: true, stopAt: routeTable });
    reachOfQr(`anything the guest door "${prefix}" fetches while it is open`, "encoder-reachable-from-guest-route",
      triggered.reached, triggered.parent, guestVia, reported);
    measures.push(`${prefix}: ${onLoad.reached.length} chunk(s) on opening, ${triggered.reached.length} `
      + `counting what its own code lazily imports (${guestPreloads.length} file(s) in the route's preload list)`);
  }

  // 3. the host editor — the page opens encoder-free; only the plate affordance may bring it in
  const hostRoutes = chunkNamed(assetFiles, HOST_ROUTE_PREFIX);
  if (hostRoutes.length === 0) {
    add("surface-missing", `${ASSET_DIR}/${HOST_ROUTE_PREFIX}*.js`,
      "has no chunk, so the boundary between a host's press and a guest's page is no longer measurable here");
  } else {
    // A preload list naming the encoder here would fetch it while the host signs in, before any plate
    // was asked for — which is the half of §9.4 the source-side rule cannot see.
    const hostEdges = preloadEdges(graph, hostRoutes);
    const hostPreloads = [...new Set(hostEdges.map((e) => e.file))];
    const hostRoots = [...new Set([...hostRoutes, ...hostPreloads])];
    const hostVia = new Map(hostEdges.map((e) => [e.file, `${nameOf(e.loader)} preloads it with the route`]));
    const hostOnLoad = walk(bundle, graph, hostRoots, { followDynamic: false });
    reachOfQr("the host editor as it opens", "encoder-preloaded-with-host-route",
      hostOnLoad.reached, hostOnLoad.parent, hostVia);
    measures.push(`host route: loaded by ${loadersOf(hostRoutes).map(nameOf).join(", ") || "(nothing)"}; `
      + `${hostPreloads.length} file(s) in its preload list, `
      + `${hostOnLoad.reached.filter((f) => qrChunks.includes(f)).length} plate or encoder chunk(s) on opening`);
  }

  const affordance = chunkNamed(assetFiles, AFFORDANCE_PREFIX);
  if (affordance.length === 0) {
    add("surface-missing", `${ASSET_DIR}/${AFFORDANCE_PREFIX}*.js`,
      "has no chunk; the host's scanned plate stopped being a lazy affordance, which is what keeps §9.4's "
      + "host-side exemption honest");
  } else if (affordance.some((f) => shellWalk.reached.includes(f))) {
    add("qr-affordance-eager", affordance.join(", "),
      "sits in the eager shell, so a plate the host never asked for is downloaded by every visitor");
  } else {
    // The other half of the host promise: the plate must be reachable *somehow*, or the clean rows
    // above mean the affordance was cut out of the app rather than kept behind a press.
    const appWide = walk(bundle, graph, shell, { followDynamic: true });
    const missing = affordance.filter((f) => !appWide.reached.includes(f));
    if (missing.length > 0) {
      add("qr-affordance-unreachable", missing.join(", "),
        "cannot be loaded from `index.html` at all, so the publication panel's plate has no bytes to draw "
        + "from and the guest-clean result above would be a removed feature, not a confined one");
    }
    measures.push(`plate affordance: ${affordance.map(nameOf).join(", ")} reached only through `
      + `${appWide.parent.get(affordance[0]) ?? "(no edge)"}`);
  }

  // 4. the render harness — the positive half: this document is where the encoder belongs
  const renderAssets = bundle.exists("render.html") ? eagerAssetsOf(bundle.read("render.html")) : [];
  const renderWalk = walk(bundle, graph, renderAssets, { followDynamic: true });
  if (!renderWalk.reached.some((f) => encoderChunks.includes(f))) {
    add("render-entry-lost-encoder", "render.html",
      `cannot reach an encoder chunk (${encoderChunks.map(nameOf).join(", ") || "none found"}); a harness `
      + "that cannot draw a plate cannot serve §9.3, and this sweep's clean guest rows would then be vacuous");
  }

  measures.push(`${assetFiles.length} chunk(s) in ${ASSET_DIR}/, ${importEdges} import edge(s) read`
    + `, ${Math.round(assetFiles.reduce((n, f) => n + sources.get(f).length, 0) / 1024)} KiB of chunk bytes`);
  measures.push(`encoder chunk(s): ${encoderChunks.map(nameOf).join(", ") || "(none)"}`
    + `; plate-vocabulary chunk(s): ${plateChunks.map(nameOf).join(", ") || "(none)"}`);
  measures.push(`index.html eager: ${shell.map(nameOf).join(", ") || "(no document)"}`);
  measures.push(`render.html eager: ${renderAssets.map(nameOf).join(", ") || "(no document)"}`);

  return { findings, measures, status: findings.length === 0 ? "clean" : "failed" };
}

export function scan(root) {
  return auditBundle(diskBundle(root));
}

function formatReport({ findings, measures }) {
  if (findings.length === 0) {
    return `Bundle boundary OK — ${measures.join("; ")}.`;
  }
  const header = `Bundle boundary FAILED — ${findings.length} finding(s):`;
  const body = findings.map((f) => `  [${f.rule}] ${f.path}: ${f.message}`);
  return [header, ...body, ...measures.map((m) => `  measured: ${m}`)].join("\n");
}

if (isMain) {
  const report = scan();
  console.log(process.argv.slice(2).includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(report.findings.length === 0 ? 0 : 1);
}
