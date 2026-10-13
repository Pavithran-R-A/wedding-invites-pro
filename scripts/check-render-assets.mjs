/**
 * Render-asset checker: proves the self-hosted font set is the pinned font set, and that the app
 * asks for typography from its own origin only.
 *
 *   node scripts/check-render-assets.mjs              human-readable report, exit 1 on findings
 *   node scripts/check-render-assets.mjs --json       machine-readable report
 *
 * Why this exists separately from `check-product-contract.mjs`: that one pattern-matches text. The
 * rules here need digests, a second file format, and cross-file agreement between three sources
 * (the stylesheet, the manifest, and the places the app names families), which is a different shape
 * of check from a regex sweep.
 *
 * The failure each rule prevents is specific:
 *   - a font byte changed after review, by hand or by a rotation that forgot the manifest;
 *   - a face or a stray `.woff`/`.ttf` committed under `public/fonts/files/` that no rule loads —
 *     bytes the app ships and nobody accounted for;
 *   - `fonts.css` and the manifest disagreeing, so the provenance record describes a different
 *     font set from the one the browser loads;
 *   - the editor's font menu or the token stacks naming a family no shipped face covers, which
 *     renders as a silent fallback on a guest's phone and looks like a typography bug, not a build bug;
 *   - a request leaving the origin for a font, which is the exposure Stage 9 closed.
 *
 * Deterministic: reads the tree, no network, no inference.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CSS_PATH,
  FACE_DIR,
  FAMILIES,
  FONT_SOURCE_VERSION,
  LICENCE_DIR,
  MANIFEST_PATH,
  WEIGHTS,
  parseFontFaceCss,
} from "./fetch-render-fonts.mjs";

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

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const OFL_MARKER = "SIL Open Font License, Version 1.1";

/** Hosts the app must not ask for typography from, whatever the reason given for asking. */
const FONT_CDN_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

/** Product-facing text surfaces the CDN needle sweep reads. `scripts/` is excluded: it holds this file.
 *
 *  Stage 9 adds `render.html`: the render harness is a second browser-loaded document, it links the
 *  same self-hosted stylesheet, and a CDN `<link>` restored there would put a third-party font
 *  request into every exported artefact while the guest page stayed clean. */
const NEEDLE_ROOTS = ["index.html", "render.html", "src"];
const NEEDLE_EXTENSIONS = new Set([".html", ".css", ".ts", ".tsx", ".js", ".jsx", ".json", ".txt", ".md"]);

/**
 * The read surface the audit needs, so the rules can be run against a repository tree or against
 * an in-memory one. Flat directories are listed with `files`; anything walked recursively
 * (`NEEDLE_ROOTS`) goes through `entries`, which reports directories as well as files.
 */
export function fsView(repoRoot) {
  const at = (rel) => join(repoRoot, rel);
  const isDirectory = (rel) => existsSync(at(rel)) && statSync(at(rel)).isDirectory();
  return {
    exists: (rel) => existsSync(at(rel)),
    read: (rel) => readFileSync(at(rel), "utf8"),
    bytes: (rel) => readFileSync(at(rel)),
    files: (rel) => (isDirectory(rel)
      ? readdirSync(at(rel)).filter((name) => statSync(join(at(rel), name)).isFile()).map((name) => `${posix(rel)}/${name}`)
      : []),
    entries: (rel) => (isDirectory(rel)
      ? readdirSync(at(rel), { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() }))
      : []),
  };
}

const familyFromManifest = (manifest) => manifest.families.map((f) => f.cssFamily);

function quotedNames(value) {
  return [...value.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/** CSS generic and system keywords: entries a stack falls back to, not families a face can be shipped for. */
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "emoji", "math", "symbols", "latex", "-apple-system", "BlinkMacSystemFont",
]);

/**
 * The family names a CSS font stack asks for, quoted or not.
 *
 * Reading only the quoted form would let `font-family: Inter, sans-serif` out of the check, and the
 * unquoted spelling is legal CSS for a single-token name — so it is the case this rule exists to
 * catch, not one it can ignore. Names are matched case-insensitively against the generic keywords
 * only; the shipped-family comparison below keeps its exact spelling, because that is what the
 * `@font-face` rules declare and what the browser matches.
 */
function fontStackNames(value) {
  return value.split(",").map((part) => {
    const token = part.trim();
    const quoted = /^"([^"]*)"$|^'([^']*)'$/.exec(token);
    return (quoted === null ? token : quoted[1]).trim();
  }).filter((name) => name !== "" && !GENERIC_FAMILIES.has(name.toLowerCase()));
}

/** Walk a product-facing root; a root may be a single file or a directory. */
function collectNeedleFiles(view, rel) {
  if (!view.exists(rel)) return [];
  const isScannable = (name) => [...NEEDLE_EXTENSIONS].some((ext) => name.endsWith(ext));
  const out = [];
  const walk = (dir) => {
    for (const entry of view.entries(dir)) {
      if (entry.dir) walk(`${posix(dir)}/${entry.name}`);
      else if (isScannable(entry.name)) out.push(`${posix(dir)}/${entry.name}`);
    }
  };
  const rootEntries = view.entries(rel);
  // `entries()` of a file path returns nothing on a real filesystem, so a file root is handled first.
  if (rootEntries.length === 0 && isScannable(rel.split("/").pop())) return [rel];
  walk(rel);
  return out;
}

/**
 * Is this path part of the declared test surface rather than something a browser can load?
 *
 * Two forms, and both are read from `vitest.config.ts` rather than invented here: a file whose name
 * matches the `include` glob (at any depth under `src/`, a name ending `.test.ts`, `.test.tsx`,
 * `.spec.ts` or `.spec.tsx`) and a file under `src/test/`, the directory the vitest `setupFiles`
 * lives in and which no product module imports. The first cannot be bundled because no entry names
 * it; the second cannot be bundled because the only things that import it are the first kind.
 *
 * Deliberately narrower than "has `test` in the path": a `.test.js` under `src/` is *not* matched by
 * the include glob, so treating it as test-only would give a CDN reference a way to ship while
 * looking audited. A name the test runner does not run is a name this rule still reads as product.
 */
function isTestOnlyPath(rel) {
  const name = rel.split("/").pop();
  return rel.startsWith("src/test/") || /^[^/]+\.(test|spec)\.(ts|tsx)$/.test(name);
}

/**
 * Every occurrence of a needle, as `path:line`.
 *
 * A scan of `scripts/` is deliberately absent: this file and the fetcher name the CDN hosts in prose
 * about what they remove, and a rule that fires on its own documentation gets turned off rather
 * than read. `check-product-contract.mjs` excludes `scripts/` for the same reason.
 */
export function findNeedles(view, needles) {
  const hits = [];
  for (const rel of NEEDLE_ROOTS.flatMap((root) => collectNeedleFiles(view, root))) {
    view.read(rel).split("\n").forEach((line, index) => {
      for (const needle of needles) {
        if (line.includes(needle)) hits.push({ path: rel, line: index + 1, needle });
      }
    });
  }
  return hits;
}

/**
 * Audit a font set against the tree a view exposes.
 *
 * Returns `{ findings, measures }`; findings are `{ rule, path, message }`. Nothing here throws for
 * a bad tree — a missing manifest is a finding, because the gate must report every problem it can
 * see in one run rather than stopping at the first.
 */
export function auditRenderAssets(view) {
  const findings = [];
  const measures = [];
  const add = (rule, path, message) => findings.push({ rule, path, message });

  if (!view.exists(MANIFEST_PATH)) {
    return { findings: [{ rule: "manifest-missing", path: MANIFEST_PATH, message: "no font manifest is committed; run node scripts/fetch-render-fonts.mjs" }], measures };
  }
  let manifest;
  try {
    manifest = JSON.parse(view.read(MANIFEST_PATH));
  } catch (error) {
    return { findings: [{ rule: "manifest-unparsable", path: MANIFEST_PATH, message: String(error.message ?? error) }], measures };
  }

  // ---- the manifest is the one this tool writes, for the versions this tool pins
  if (manifest.schema !== 1) add("manifest-schema", MANIFEST_PATH, `schema ${manifest.schema}, expected 1`);
  if (manifest.generatedBy !== "scripts/fetch-render-fonts.mjs") {
    add("manifest-author", MANIFEST_PATH, `generatedBy is ${JSON.stringify(manifest.generatedBy)}`);
  }
  const pinnedSlugs = FAMILIES.map((f) => f.slug);
  const manifestSlugs = manifest.families.map((f) => f.package.replace("@fontsource/", ""));
  for (const slug of pinnedSlugs) {
    if (!manifestSlugs.includes(slug)) add("family-missing", MANIFEST_PATH, `${slug} is pinned by the tool and absent from the manifest`);
  }
  for (const slug of manifestSlugs) {
    if (!pinnedSlugs.includes(slug)) add("family-unpinned", MANIFEST_PATH, `${slug} is in the manifest and not pinned by the tool`);
  }
  for (const family of manifest.families) {
    if (family.version !== FONT_SOURCE_VERSION) {
      add("family-version", MANIFEST_PATH, `${family.package} is recorded at ${family.version}, the tool pins ${FONT_SOURCE_VERSION}`);
    }
    if (family.license !== "OFL-1.1") {
      add("family-licence", MANIFEST_PATH, `${family.package} declares licence ${JSON.stringify(family.license)} — only OFL-1.1 is cleared for redistribution here`);
    }
  }

  // ---- every face the manifest lists exists, byte for byte
  const listedFaces = new Set();
  let faceBytes = 0;
  for (const family of manifest.families) {
    for (const face of family.faces) {
      listedFaces.add(face.path);
      if (!view.exists(face.path)) {
        add("face-missing", face.path, `${family.package} ${face.label} is declared and not committed`);
        continue;
      }
      const bytes = view.bytes(face.path);
      if (bytes.length !== face.bytes) {
        add("face-bytes", face.path, `is ${bytes.length} byte(s), manifest says ${face.bytes}`);
      }
      const actual = sha256(bytes);
      if (actual !== face.sha256) {
        add("face-digest", face.path, `sha256 ${actual} does not match the manifest's ${face.sha256}`);
      }
      faceBytes += bytes.length;
    }
  }
  for (const path of view.files(FACE_DIR)) {
    if (!listedFaces.has(path)) {
      add("face-orphan", path, "committed under the font directory and loaded by no rule — delete it or account for it in the manifest");
    }
    if (/\.woff$|\.ttf$|\.otf$|\.eot$/.test(path)) {
      add("face-unexpected-format", path, "a non-woff2 face is shipped; this font set is woff2-only by decision, so the format must be a mistake");
    }
  }

  // ---- faces cover every weight of every pinned family
  for (const family of manifest.families) {
    for (const weight of WEIGHTS) {
      const count = family.faces.filter((f) => f.fontWeight === weight).length;
      if (count === 0) add("weight-missing", MANIFEST_PATH, `${family.cssFamily} has no ${weight} face`);
    }
    if (family.faces.some((f) => !WEIGHTS.includes(f.fontWeight))) {
      add("weight-unpinned", MANIFEST_PATH, `${family.cssFamily} ships a face at a weight the app does not declare`);
    }
    if (family.faces.some((f) => f.fontStyle !== "normal")) {
      add("style-unpinned", MANIFEST_PATH, `${family.cssFamily} ships a non-normal style, which the CDN request this replaces never served`);
    }
  }

  // ---- licences
  for (const family of manifest.families) {
    const licence = family.licence;
    if (!view.exists(licence.path)) {
      add("licence-missing", licence.path, `${family.package}'s licence text is not committed`);
      continue;
    }
    const bytes = view.bytes(licence.path);
    if (bytes.length !== licence.bytes) add("licence-bytes", licence.path, `is ${bytes.length} byte(s), manifest says ${licence.bytes}`);
    if (sha256(bytes) !== licence.sha256) add("licence-digest", licence.path, "does not match the manifest's digest");
    if (!bytes.toString("utf8").includes(OFL_MARKER)) {
      add("licence-text", licence.path, `does not contain ${JSON.stringify(OFL_MARKER)}`);
    }
  }
  const licenceFiles = new Set(manifest.families.map((f) => f.licence.path));
  for (const path of view.files(LICENCE_DIR)) {
    if (!licenceFiles.has(path)) add("licence-orphan", path, "a licence for a family the manifest does not carry");
  }

  // ---- the stylesheet against the manifest
  if (!view.exists(CSS_PATH)) {
    add("css-missing", CSS_PATH, "no generated stylesheet is committed");
  } else {
    const cssBytes = view.bytes(CSS_PATH);
    if (manifest.css?.path !== CSS_PATH) add("css-path", MANIFEST_PATH, `manifest names ${JSON.stringify(manifest.css?.path)}`);
    if (manifest.css && sha256(cssBytes) !== manifest.css.sha256) {
      add("css-digest", CSS_PATH, `sha256 ${sha256(cssBytes)} does not match the manifest's ${manifest.css.sha256}`);
    }
    let blocks;
    try {
      blocks = parseFontFaceCss(cssBytes.toString("utf8"), CSS_PATH);
    } catch (error) {
      blocks = null;
      add("css-unparsable", CSS_PATH, String(error.message ?? error));
    }
    if (blocks) {
      const expected = manifest.families.flatMap((f) => f.faces);
      if (blocks.length !== expected.length) {
        add("css-count", CSS_PATH, `declares ${blocks.length} @font-face rule(s), the manifest carries ${expected.length} face(s)`);
      }
      const byFile = new Map(expected.map((f) => [f.file, f]));
      const loaded = new Set();
      for (const block of blocks) {
        const props = new Map(block.props.map((p) => [p.name, p.value]));
        const srcValue = props.get("src") ?? "";
        const urlMatch = /^url\((.+)\) format\('woff2'\)$/.exec(srcValue);
        if (!urlMatch) {
          add("css-src", CSS_PATH, `${block.label ?? "(unlabelled)"}: src is not exactly one woff2 url: ${srcValue}`);
          continue;
        }
        const file = urlMatch[1].replace(/^\.\//, "");
        const face = byFile.get(file);
        if (!face) {
          add("css-face-unknown", CSS_PATH, `${block.label ?? file}: loads ${file}, which the manifest does not carry`);
          continue;
        }
        loaded.add(file);
        const family = (props.get("font-family") ?? "").replace(/^['"]|['"]$/g, "");
        if (family !== face.fontFamily) add("css-family", CSS_PATH, `${file}: declares '${family}', manifest says '${face.fontFamily}'`);
        if ((props.get("font-weight") ?? "") !== String(face.fontWeight)) {
          add("css-weight", CSS_PATH, `${file}: declares ${props.get("font-weight")}, manifest says ${face.fontWeight}`);
        }
        if ((props.get("font-style") ?? "") !== face.fontStyle) add("css-style", CSS_PATH, `${file}: declares style ${props.get("font-style")}`);
        if ((props.get("unicode-range") ?? null) !== face.unicodeRange) {
          add("css-range", CSS_PATH, `${file}: unicode-range differs from the manifest's record`);
        }
        if ((props.get("font-display") ?? null) !== "swap") {
          add("css-display", CSS_PATH, `${file}: font-display is ${props.get("font-display")}, expected swap`);
        }
      }
      // Read both ways, or a face can be dropped from the stylesheet while its manifest entry and its
      // bytes stay behind — a guest page that silently lost a subset, and a provenance record that
      // still says the app ships it.
      for (const face of expected) {
        if (!loaded.has(face.file)) {
          add("css-face-absent", CSS_PATH, `${face.file} is carried by the manifest and loaded by no rule here`);
        }
      }
    }
  }

  // ---- the app's own typography must be covered by what ships
  const shipped = new Set(familyFromManifest(manifest));
  for (const [path, extract] of [
    ["src/pages/EditProject.tsx", (text) => {
      const block = /const FONT_FAMILIES = \[([\s\S]*?)\];/.exec(text);
      if (!block) return null;
      return quotedNames(block[1]);
    }],
    ["src/index.css", (text) => {
      const stacks = [...text.matchAll(/--font-(?:body|display):\s*([^;]+);/g)].map((m) => m[1]);
      if (stacks.length === 0) return null;
      return stacks.flatMap(fontStackNames);
    }],
  ]) {
    if (!view.exists(path)) {
      add("typography-source-missing", path, "the checker reads the font menu and the token stacks from here");
      continue;
    }
    const names = extract(view.read(path));
    if (names === null) {
      add("typography-source-unparsable", path, "the declaration this rule anchors on is no longer recognisable");
      continue;
    }
    for (const name of names) {
      if (!shipped.has(name)) {
        add("family-unshipped", path, `names '${name}', which no shipped face covers — it will fall back to a system font on a guest's device`);
      }
    }
    measures.push(`${path}: ${names.length} family name(s), all shipped`);
  }

  // ---- nothing in the product's own text asks a remote host for a font
  //
  // Two classes of hit, because the rule is about what a browser can be made to request. A test
  // file that names a CDN host inside a hostile-input fixture is describing the thing this gate
  // removes — the same reason `scripts/` is out of scope below — and it cannot reach a bundle,
  // because no entry imports it. Those hits are therefore measured and disclosed rather than
  // deleted from the scan: a future font request that *does* ship still fails the gate, and a
  // future test fixture that names the hosts stays visible in the report instead of vanishing.
  const hits = findNeedles(view, FONT_CDN_HOSTS);
  const productHits = hits.filter((hit) => !isTestOnlyPath(hit.path));
  const testHits = hits.filter((hit) => isTestOnlyPath(hit.path));
  for (const hit of productHits) {
    add("font-cdn-reference", hit.path, `line ${hit.line} still names ${hit.needle}; the guest page must load typography from this origin`);
  }
  measures.push(`${FONT_CDN_HOSTS.join(" and ")}: ${productHits.length} reference(s) in product-facing text`);
  measures.push(`${FONT_CDN_HOSTS.join(" and ")}: ${testHits.length} reference(s) in test fixtures only `
    + `(${[...new Set(testHits.map((hit) => hit.path))].join(", ") || "none"}) — never bundled`);

  measures.push(`${manifest.families.length} famil${manifest.families.length === 1 ? "y" : "ies"}, `
    + `${manifest.families.reduce((n, f) => n + f.faces.length, 0)} face(s), `
    + `${Math.round(faceBytes / 1024)} KiB of committed font bytes`);

  return { findings, measures };
}

export function scan(repoRoot = REPO_ROOT) {
  return auditRenderAssets(fsView(repoRoot));
}

function formatReport({ findings, measures }) {
  if (findings.length === 0) {
    return `Render assets OK — ${measures.join("; ")}.`;
  }
  const header = `Render assets FAILED — ${findings.length} finding(s):`;
  const body = findings.map((f) => `  [${f.rule}] ${f.path}: ${f.message}`);
  return [header, ...body, ...measures.map((m) => `  measured: ${m}`)].join("\n");
}

const args = process.argv.slice(2);

if (isMain) {
  const report = scan();
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(report.findings.length === 0 ? 0 : 1);
}
