/**
 * Self-hosted render fonts: fetch, verify integrity, and lay out the six pinned faces.
 *
 *   node scripts/fetch-render-fonts.mjs
 *
 * This is a maintainer tool, run by hand when a font set is added or rotated. It is not part of
 * `npm install`, `npm run build`, or any gate, so nothing it downloads ever executes: the packages
 * are unpacked into an OS temp directory, only font bytes and licence text leave it, and no package
 * code is read, imported, or run. The product then serves those bytes from its own origin and the
 * guest page contacts no third party for typography.
 *
 * What it writes, all under `public/fonts/`:
 *   files/<face>.woff2        the faces this app renders with — woff2 only, `normal` only
 *   licences/<family>.txt     the licence that came inside each package, byte for byte
 *   fonts.css                 `@font-face` rules copied from the packages' own CSS
 *   font-manifest.json        provenance: package, version, registry integrity, per-file digests
 *
 * Why woff2 and not TTF: Chromium embeds whatever face it actually rendered, including the subsets
 * it downloaded, so a scalable source file is not needed on the PDF path. Why normal and not italic:
 * the stylesheet this app used to request from the Google Fonts CDN named `wght@400;500;600;700` and
 * no italic axis, so italic text (`<em>` in host-facing copy) has always been a synthesised oblique.
 * Shipping normal-only faces therefore preserves measured behaviour rather than trimming it.
 *
 * Determinism: faces are ordered by file name and families by the order in FAMILIES below, so the
 * same pinned versions produce byte-identical output. `check-render-assets.mjs` re-verifies the
 * committed tree against the manifest on every gate run.
 *
 * Requires network access to a registry and a `tar` binary that reads gzip. Both are host tools;
 * neither is a dependency of the product.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// import.meta.url is a file: URL when run by node, but a jsdom-based test runner rewrites it to an
// http URL; fall back to the working directory, which is the package root for npm scripts.
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

/** Pinned exactly. A rotation changes this line and nothing else. */
export const FONT_SOURCE_VERSION = "5.3.0";

/**
 * The families this app's own typography names, and the `@fontsource` package each one comes from.
 * `cssFamily` must match the package's own `font-family` declaration; the checker compares it against
 * the font menu in `src/pages/EditProject.tsx` and the stacks in `src/index.css`, so an entry here
 * that stops matching either of them is a finding rather than a silent fallback.
 */
export const FAMILIES = [
  { package: "@fontsource/dm-sans", slug: "dm-sans", cssFamily: "DM Sans" },
  { package: "@fontsource/playfair-display", slug: "playfair-display", cssFamily: "Playfair Display" },
  { package: "@fontsource/noto-sans-tamil", slug: "noto-sans-tamil", cssFamily: "Noto Sans Tamil" },
  { package: "@fontsource/noto-sans-telugu", slug: "noto-sans-telugu", cssFamily: "Noto Sans Telugu" },
  { package: "@fontsource/noto-sans-kannada", slug: "noto-sans-kannada", cssFamily: "Noto Sans Kannada" },
  { package: "@fontsource/noto-sans-malayalam", slug: "noto-sans-malayalam", cssFamily: "Noto Sans Malayalam" },
];

/** The weights the design tokens and Tailwind's `font-medium`/`font-semibold` reach for. */
export const WEIGHTS = [400, 500, 600, 700];

export const FONTS_DIR = "public/fonts";
export const CSS_PATH = "public/fonts/fonts.css";
export const MANIFEST_PATH = "public/fonts/font-manifest.json";
export const LICENCE_DIR = "public/fonts/licences";
export const FACE_DIR = "public/fonts/files";

const registryBase = () => (process.env.VIVAAH_FONT_REGISTRY ?? "https://registry.npmjs.org/").replace(/\/+$/, "");
const spec = (slug) => `@fontsource/${slug}`;
/** The registry's own path form for a scoped package. */
const encodedSpec = (slug) => spec(slug).replace("/", "%2f");

// --------------------------------------------------------------------------- upstream CSS reader

/**
 * Read `@font-face` blocks out of a weight stylesheet.
 *
 * Deliberately strict: the input is a machine-generated file with a fixed shape, so anything that
 * does not fit that shape means the upstream package changed its format — and a reader that guessed
 * would ship a font set nobody reviewed. Declaration order is preserved because the generated CSS
 * must be the upstream CSS with one source removed and nothing else altered.
 *
 * Two comment forms are accepted, and each has one job: a `/* name *\/` line directly above a block
 * labels it (that label is the upstream file's own identity and goes into the manifest), and a
 * comment spanning several lines is the generated header, read and discarded. Anything else between
 * blocks is a refusal.
 */
export function parseFontFaceCss(css, source) {
  const lines = css.split("\n");
  const blocks = [];
  let current = null;
  let pendingLabel = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "") continue;
    if (line.startsWith("/*")) {
      if (current !== null) throw new Error(`${source}: comment inside a @font-face block`);
      if (pendingLabel !== null) throw new Error(`${source}: a second comment before a block`);
      if (!line.endsWith("*/")) {
        let closed = false;
        while (index + 1 < lines.length) {
          index += 1;
          if (lines[index].includes("*/")) {
            closed = true;
            break;
          }
        }
        if (!closed) throw new Error(`${source}: unterminated comment`);
        continue;
      }
      // A one-line comment must be the whole line. `/* dm-sans */ .x { color: red } */` ends in `*/`
      // and would otherwise be read as a label with a selector buried in it, and the label is what the
      // manifest records as the face's upstream identity.
      const label = line.slice(2, -2);
      if (label.includes("*/") || label.includes("/*")) {
        throw new Error(`${source}: text around a one-line comment: ${line}`);
      }
      pendingLabel = label.trim();
      continue;
    }
    if (line === "@font-face {") {
      if (current !== null) throw new Error(`${source}: nested @font-face block`);
      current = { label: pendingLabel, props: [] };
      pendingLabel = null;
      continue;
    }
    if (line === "}") {
      if (current === null) throw new Error(`${source}: } outside a @font-face block`);
      blocks.push(current);
      current = null;
      continue;
    }
    if (current === null) throw new Error(`${source}: text outside a @font-face block: ${line}`);
    const declaration = /^([a-z-]+):(.+);$/.exec(line);
    if (!declaration) throw new Error(`${source}: not a declaration: ${line}`);
    current.props.push({ name: declaration[1].toLowerCase(), value: declaration[2].trim() });
  }
  if (current !== null) throw new Error(`${source}: unterminated @font-face block`);
  if (pendingLabel !== null) throw new Error(`${source}: trailing comment names no block`);
  return blocks;
}

const WOFF2_ALT = /^url\((.+)\) format\('woff2'\)$/;
const WOFF_ALT = /^url\(([^)]+)\) format\('woff'\)$/;
/** Exactly the upstream form: a path from the stylesheet's own directory into `files/`. A whitelist
 *  rather than a blacklist because the ways a `src` can reach off this origin are more numerous than
 *  any list of them — `data:` inlining, a scheme, an absolute path, a Windows path, an escape. */
const LOCAL_FACE_URL = /^\.\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.woff2$/;

/**
 * Reduce a `src` value to its woff2 source alone.
 *
 * Refusals, in order: a form that is not exactly `url(…) format('woff2'|'woff')` (an unexpected
 * format must be reviewed, not dropped), anything other than exactly one woff2 (two would make the
 * choice a guess), and a URL the local-face whitelist rejects. That last one is the point of this
 * tool: the shipped stylesheet must name no host and carry no inlined bytes.
 */
export function woff2Source(srcValue, source) {
  const alternatives = srcValue.split(/\s*,\s*(?=url\()/).map((s) => s.trim()).filter(Boolean);
  const unknown = alternatives.filter((a) => !WOFF2_ALT.test(a) && !WOFF_ALT.test(a));
  if (unknown.length > 0) {
    throw new Error(`${source}: src carries a form this tool will not silently drop: ${unknown.join(" | ")}`);
  }
  const woff2 = alternatives.filter((a) => WOFF2_ALT.test(a));
  if (woff2.length !== 1) {
    throw new Error(`${source}: expected exactly one woff2 source, found ${woff2.length}`);
  }
  const url = WOFF2_ALT.exec(woff2[0])[1];
  if (!LOCAL_FACE_URL.test(url) || url.split("/").includes("..")) {
    throw new Error(`${source}: refuses a font URL that is not a path to a file inside the fonts directory: ${url}`);
  }
  return { url, file: url.replace(/^\.\//, "") };
}

/** One upstream block, re-rendered with its woff fallback removed and everything else intact. */
export function renderFontFace(block, source) {
  const lines = [];
  if (block.label) lines.push(`/* ${block.label} */`);
  lines.push("@font-face {");
  for (const { name, value } of block.props) {
    if (name === "src") {
      lines.push(`  src: ${`url(${woff2Source(value, source).url}) format('woff2')`};`);
      continue;
    }
    lines.push(`  ${name}: ${value};`);
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * What a block commits to, read out of the block itself.
 *
 * `font-display: swap` is required rather than assumed: it is what the CDN stylesheet this tool
 * replaces asked for (`&display=swap`), and a face that silently became `block` would change when
 * text paints on a guest's phone. Same reasoning for normal style and for the URL shape.
 */
export function faceFields(block, source) {
  const get = (name) => block.props.find((p) => p.name === name)?.value;
  const family = get("font-family");
  const style = get("font-style");
  const weight = get("font-weight");
  const display = get("font-display");
  if (!family) throw new Error(`${source}: block declares no font-family`);
  if (style !== "normal") throw new Error(`${source}: refuses a non-normal style (${style})`);
  if (display !== "swap") throw new Error(`${source}: refuses font-display ${display ?? "(absent)"}, expected swap`);
  if (!/^\d+$/.test(weight ?? "")) throw new Error(`${source}: font-weight is not a number: ${weight}`);
  const { url, file } = woff2Source(get("src") ?? "", source);
  return {
    label: block.label ?? basename(file),
    url,
    file,
    fontFamily: family.replace(/^['"]|['"]$/g, ""),
    fontStyle: style,
    fontWeight: Number(weight),
    unicodeRange: get("unicode-range") ?? null,
  };
}

const CSS_HEADER = [
  "/* Generated by scripts/fetch-render-fonts.mjs from @fontsource packages at the versions recorded",
  " * in public/fonts/font-manifest.json. woff2 sources only, normal style only. Do not hand-edit:",
  " * scripts/check-render-assets.mjs compares this file against that manifest and reports any",
  " * drift, including a face declared here that the manifest does not carry. */",
];

/** Assemble the generated stylesheet from rendered blocks. */
export function renderFontsCss(blocks, sourceLabel = "fonts.css") {
  if (blocks.length === 0) throw new Error(`${sourceLabel}: no faces to write`);
  return `${CSS_HEADER.join("\n")}\n\n${blocks.map((b) => renderFontFace(b, sourceLabel)).join("\n\n")}\n`;
}

// --------------------------------------------------------------------------- fetching

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`registry metadata for ${url} — HTTP ${response.status}`);
  return response.json();
}

async function getBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`tarball download for ${url} — HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest("hex");
const base64Digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest("base64");

/**
 * Unpack a tarball into `target`.
 *
 * `--force-local` is not decoration: GNU tar reads a Windows drive letter followed by a colon as an
 * `rsh` remote and fails with "Cannot connect to C:". The archive is still named by handing tar a
 * working directory and a bare file name, because that same GNU tar treats a backslash in an
 * absolute path as an escape character and reports a directory that plainly exists as missing. An
 * absent `tar` is a refusal, not a fallback — the alternative is a hand-rolled archive reader whose
 * bugs would be invisible.
 */
function extractTarball(tgzPath, target) {
  const result = spawnSync("tar", ["--force-local", "-xzf", basename(tgzPath)], { cwd: target });
  if (result.error?.code === "ENOENT") {
    throw new Error("this tool needs a `tar` binary that reads gzip; install one or extract by hand");
  }
  if (result.status !== 0) {
    throw new Error(`tar failed on ${basename(tgzPath)} (exit ${result.status}): ${String(result.stderr).trim()}`);
  }
}

function readPackageFile(packageDir, ...parts) {
  const path = join(packageDir, ...parts);
  if (!existsSync(path)) {
    throw new Error(`expected ${posix(relative(REPO_ROOT, path))} inside the package and it is not there`);
  }
  return readFileSync(path);
}

async function buildFamily(family, workDir) {
  const registry = registryBase();
  const metadata = await getJson(`${registry}/${encodedSpec(family.slug)}/${FONT_SOURCE_VERSION}`);
  if (metadata.name !== spec(family.slug) || metadata.version !== FONT_SOURCE_VERSION) {
    throw new Error(`${spec(family.slug)}: the registry answered with ${metadata.name}@${metadata.version}`);
  }
  const tarballUrl = metadata.dist?.tarball;
  if (!tarballUrl) throw new Error(`${spec(family.slug)}: registry metadata carries no tarball URL`);
  const bytes = await getBytes(tarballUrl);
  const sha512 = `sha512-${base64Digest(bytes, "sha512")}`;
  if (metadata.dist.integrity && metadata.dist.integrity !== sha512) {
    throw new Error(`${spec(family.slug)}: the bytes downloaded are not the bytes the registry attests`);
  }
  const sha1 = digest(bytes, "sha1");
  if (metadata.dist.shasum && metadata.dist.shasum !== sha1) {
    throw new Error(`${spec(family.slug)}: the bytes downloaded are not the shasum the registry attests`);
  }

  const dir = join(workDir, family.slug);
  mkdirSync(dir, { recursive: true });
  const tgzPath = join(dir, `${family.slug}-${FONT_SOURCE_VERSION}.tgz`);
  writeFileSync(tgzPath, bytes);
  extractTarball(tgzPath, dir);
  const packageDir = join(dir, "package");

  const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (packageJson.name !== spec(family.slug) || packageJson.version !== FONT_SOURCE_VERSION) {
    throw new Error(`${spec(family.slug)}: the unpacked package.json disagrees (${packageJson.name}@${packageJson.version})`);
  }

  const licence = readPackageFile(packageDir, "LICENSE");
  if (!licence.toString("utf8").includes("SIL Open Font License")) {
    throw new Error(`${spec(family.slug)}: expected the SIL Open Font License inside the package and found something else`);
  }

  const faces = [];
  for (const weight of WEIGHTS) {
    const cssFile = join(packageDir, `${weight}.css`);
    if (!existsSync(cssFile)) {
      throw new Error(`${spec(family.slug)}: no ${weight}.css — weight ${weight} is not available upstream`);
    }
    const source = `${spec(family.slug)}@${FONT_SOURCE_VERSION}/${weight}.css`;
    for (const block of parseFontFaceCss(readFileSync(cssFile, "utf8"), source)) {
      const fields = faceFields(block, source);
      if (fields.fontFamily !== family.cssFamily) {
        throw new Error(`${source}: declares font-family '${fields.fontFamily}', this tool expected '${family.cssFamily}'`);
      }
      if (fields.fontWeight !== weight) {
        throw new Error(`${source}: declares weight ${fields.fontWeight} inside ${weight}.css`);
      }
      if (fields.file !== `files/${basename(fields.file)}`) {
        throw new Error(`${source}: src is not directly under the package's files/ directory: ${fields.url}`);
      }
      const faceBytes = readPackageFile(packageDir, "files", basename(fields.file));
      faces.push({
        ...fields,
        path: `${FACE_DIR}/${basename(fields.file)}`,
        bytes: faceBytes.length,
        sha256: digest(faceBytes, "sha256"),
        _block: block,
        _bytes: faceBytes,
      });
    }
  }
  faces.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    package: spec(family.slug),
    version: FONT_SOURCE_VERSION,
    cssFamily: family.cssFamily,
    license: packageJson.license ?? null,
    tarball: {
      url: tarballUrl,
      bytes: bytes.length,
      sha1,
      sha512,
      registryIntegrity: metadata.dist.integrity ?? null,
    },
    licence: {
      path: `${LICENCE_DIR}/${family.slug}.txt`,
      bytes: licence.length,
      sha256: digest(licence, "sha256"),
      _bytes: licence,
    },
    faces,
  };
}

/** The manifest as committed: provenance only — no scratch buffers, no generator runtime identity. */
export function buildManifest(families, css) {
  return {
    schema: 1,
    generatedBy: "scripts/fetch-render-fonts.mjs",
    note: "Self-hosted faces for the app and the Stage 9 render harness. Regenerate with that script; "
      + "verify with scripts/check-render-assets.mjs. Nothing at runtime contacts a font CDN.",
    registry: registryBase(),
    weights: WEIGHTS,
    css: { path: css.path, bytes: css.bytes, sha256: css.sha256 },
    families: families.map((family) => ({
      package: family.package,
      version: family.version,
      cssFamily: family.cssFamily,
      license: family.license,
      tarball: family.tarball,
      licence: family.licence,
      faces: family.faces.map(({ _block, _bytes, ...face }) => face),
    })),
  };
}

/**
 * Produce the whole font set in memory; write it only when `write` is true.
 *
 * The in-memory form is what the unit tests read, so a change to the layout can be reviewed by
 * running the test suite without touching the repository or reaching the network.
 */
export async function generate({ write = true } = {}) {
  const families = [];
  const workDir = mkdtempSync(join(tmpdir(), "vivaah-render-fonts-"));
  try {
    for (const family of FAMILIES) families.push(await buildFamily(family, workDir));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const blocks = families.flatMap((family) => family.faces.map((face) => face._block));
  const cssText = renderFontsCss(blocks);
  const manifest = buildManifest(families, {
    path: CSS_PATH,
    bytes: Buffer.byteLength(cssText),
    sha256: digest(Buffer.from(cssText), "sha256"),
  });

  if (write) {
    mkdirSync(join(REPO_ROOT, FACE_DIR), { recursive: true });
    mkdirSync(join(REPO_ROOT, LICENCE_DIR), { recursive: true });
    for (const family of families) {
      writeFileSync(join(REPO_ROOT, family.licence.path), family.licence._bytes);
      for (const face of family.faces) writeFileSync(join(REPO_ROOT, face.path), face._bytes);
    }
    writeFileSync(join(REPO_ROOT, CSS_PATH), cssText);
    writeFileSync(join(REPO_ROOT, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { manifest, cssText, families };
}

if (isMain) {
  const { manifest } = await generate();
  const faceCount = manifest.families.reduce((n, f) => n + f.faces.length, 0);
  const fontBytes = manifest.families.reduce((n, f) => n + f.faces.reduce((m, x) => m + x.bytes, 0), 0);
  console.log(`Fonts ready — ${manifest.families.length} famil${manifest.families.length === 1 ? "y" : "ies"}, `
    + `${faceCount} woff2 face(s), ${Math.round(fontBytes / 1024)} KiB of font bytes, `
    + `${Math.round(manifest.css.bytes / 1024)} KiB of stylesheet, served from this origin.`);
  for (const family of manifest.families) {
    console.log(`  ${family.package}@${family.version} — ${family.faces.length} face(s), ${family.license}`);
  }
  process.exit(0);
}
