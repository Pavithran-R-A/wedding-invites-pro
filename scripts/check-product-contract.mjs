#!/usr/bin/env node
/**
 * Product contract checker.
 *
 * Scans ACTIVE product surfaces for retired branding, resurrected commerce copy and
 * fabricated social proof, and fails loudly so a rename slip or a re-introduced false claim
 * cannot merge quietly.
 *
 *   node scripts/check-product-contract.mjs              human-readable report, exit 1 on findings
 *   node scripts/check-product-contract.mjs --json       machine-readable report
 *   node scripts/check-product-contract.mjs --self-test  verify the rules themselves, no repo scan
 *
 * Design notes:
 *   - Historical evidence is sacred. `docs/audits/**` legitimately records strings this script
 *     forbids, so it is excluded. That exclusion list is the whole safety model — keep it short.
 *   - `scripts/**` is excluded because rule definitions and fixtures necessarily contain the exact
 *     strings they detect.
 *   - Deterministic: same tree in, same report out. No network, no inference.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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

/** Directories never walked at all. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".worktrees"]);

/**
 * Path prefixes (POSIX, relative to repo root) excluded from scanning. Only exclude a path when
 * its text is deliberately historical evidence or self-referential.
 */
const EXCLUDED_PREFIXES = ["docs/audits/", "scripts/"];

/** Local untracked config that may hold real values. */
const EXCLUDED_FILES = new Set([".env", ".env.local"]);

/** Extensions whose content is product-facing text or code. */
const SCANNED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".html", ".css", ".json", ".md", ".yml", ".yaml", ".txt",
]);

/** Detection rules. `id` is stable and referenced by reports and tests. */
export const RULES = [
  {
    id: "retired-brand-name",
    pattern: /YourInvite/gi,
    message: "retired product name 'YourInvite'; the active brand is VivaahVarnam",
    fix: "import PRODUCT from src/config/product.ts instead of hardcoding a name",
  },
  {
    id: "retired-brand-phrase",
    pattern: /Wedding Invites Pro/gi,
    message: "retired scaffold name 'Wedding Invites Pro' in an active surface",
    fix: "describe the product as VivaahVarnam, or move historical text under docs/audits/",
  },
  {
    id: "retired-domain",
    pattern: /yourinvite\.in/gi,
    message: "reference to a domain that was never registered or cleared",
    fix: "remove it — see docs/product/brand-clearance.md (brand NOT cleared, no domain claims)",
  },
  {
    id: "retired-per-guest-pricing",
    pattern: /PRICE_PER_GUEST/gi,
    message: "per-guest pricing reintroduced; charging a host per invited guest is excluded",
    fix: "see docs/product/commercial-model.md — per-guest sharing fees are rejected",
  },
  {
    id: "retired-payment-cta",
    pattern: /pay\s*(?:&|and)\s*create\s+project/gi,
    message: "retired checkout call-to-action reintroduced; this build takes no payment",
    fix: "the create action is 'Create Invitation Draft' — never imply a charge",
  },
  {
    id: "retired-payment-confirmation",
    pattern: /payment\s+successful/gi,
    message: "retired fake payment-success copy reintroduced",
    fix: "there is no payment flow to confirm; do not simulate one",
  },
  {
    id: "retired-price-point-copy",
    pattern: /₹\s*199\b/g,
    message: "retired marketing price point reintroduced in an active surface",
    fix: "target figures belong only in docs/product/commercial-model.md, marked TARGET",
  },
  {
    id: "fabricated-social-proof",
    pattern: /trusted\s+by\s+[\d,]{2,}/gi,
    message: "fabricated customer-count social proof",
    fix: "show only verifiable signals — see docs/audits/stage-0-truth-security.md",
  },
  {
    id: "fabricated-testimonials",
    pattern: /real\s+stories\s+from\s+couples/gi,
    message: "invented testimonial section reintroduced",
    fix: "there are no real couples and no real quotes; remove the section",
  },
];

/** Guards against a rule being written so broadly that honest planning text fails. */
export const MUST_NOT_MATCH = ["Razorpay", "payment", "entitlement"];

export function isScannedPath(relativePath) {
  const p = posix(relativePath);
  if (EXCLUDED_FILES.has(p)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix))) return false;
  const segments = p.split("/");
  if (segments.some((segment) => SKIP_DIRS.has(segment))) return false;
  const base = segments[segments.length - 1];
  if (base.startsWith(".env")) return false;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return SCANNED_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

/** One violation per rule match in `text`, with 1-based line and column numbers. */
export function scanContent(relativePath, text) {
  const violations = [];
  text.split(/\r?\n/).forEach((line, index) => {
    RULES.forEach((rule) => {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      re.lastIndex = 0;
      let match = re.exec(line);
      while (match !== null) {
        violations.push({
          rule: rule.id,
          path: posix(relativePath),
          line: index + 1,
          column: match.index + 1,
          matched: match[0],
          message: rule.message,
          fix: rule.fix,
        });
        if (match[0].length === 0) re.lastIndex += 1;
        match = re.exec(line);
      }
    });
  });
  return violations;
}

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    if (statSync(absolute).isDirectory()) walk(absolute, acc);
    else if (isScannedPath(posix(relative(REPO_ROOT, absolute)))) acc.push(absolute);
  }
  return acc;
}

export function scanRepository() {
  const files = walk(REPO_ROOT, []).sort();
  const violations = files.flatMap((absolute) =>
    scanContent(relative(REPO_ROOT, absolute), readFileSync(absolute, "utf8")),
  );
  return { scannedFileCount: files.length, violations };
}

/** Runnable without a test runner so the checker can verify itself in any environment. */
export function selfTest() {
  const failures = [];

  const fixtures = {
    "retired-brand-name": `const app = "YourInvite";`,
    "retired-brand-phrase": `# Wedding invites pro`,
    "retired-domain": `<span>yourinvite.in</span>`,
    "retired-per-guest-pricing": `const PRICE_PER_GUEST = 5;`,
    "retired-payment-cta": `<Button>Pay & Create Project</Button>`,
    "retired-payment-confirmation": `toast('Payment successful')`,
    "retired-price-point-copy": `hero.startingAt ₹199 · No hidden fees`,
    "fabricated-social-proof": `Trusted by 1,200 couples`,
    "fabricated-testimonials": `Real stories from couples`,
  };
  for (const [ruleId, text] of Object.entries(fixtures)) {
    if (!scanContent("src/fixture.tsx", text).some((v) => v.rule === ruleId)) {
      failures.push(`rule ${ruleId} did not fire on its fixture`);
    }
  }

  const benign = [
    `-- A future Razorpay-class provider would be confirmed server-side (ADR 0005).`,
    `paid_status is pinned to 'unpaid' by the INSERT policy.`,
    `Trusted by practice rather than by customer counts, which we do not have.`,
    `<Button>Create Invitation Draft</Button>`,
    `Publishing, sharing, RSVP and payment are not available yet.`,
  ].join("\n");
  const benignHits = scanContent("docs/architecture/example.md", benign);
  if (benignHits.length > 0) {
    failures.push(
      `honest planning text produced ${benignHits.length} violation(s): ${[...new Set(benignHits.map((v) => v.rule))].join(", ")}`,
    );
  }

  for (const phrase of MUST_NOT_MATCH) {
    if (RULES.some((rule) => new RegExp(rule.pattern.source, "i").test(phrase))) {
      failures.push(`${JSON.stringify(phrase)} must never match a rule`);
    }
  }

  const scopeExpectations = {
    "src/pages/Index.tsx": true,
    "index.html": true,
    "package.json": true,
    "README.md": true,
    "docs/product/brand-clearance.md": true,
    "docs/audits/stage-0-truth-security.md": false,
    "scripts/check-product-contract.mjs": false,
    "node_modules/vite/index.js": false,
    "dist/assets/index.js": false,
    ".env": false,
    ".env.example": false,
    "config.yml.bak": false,
    "supabase/migrations/0001.sql": false,
  };
  for (const [path, expected] of Object.entries(scopeExpectations)) {
    if (isScannedPath(path) !== expected) failures.push(`scope decision wrong for ${path}`);
  }

  const twoMatchesOnOneLine = scanContent("src/x.ts", `YourInvite and YourInvite`);
  if (twoMatchesOnOneLine.length !== 2) {
    failures.push(`expected 2 violations on one line, got ${twoMatchesOnOneLine.length}`);
  }
  const secondLineColumn = scanContent("src/x.ts", `ok\nx YourInvite`);
  if (secondLineColumn[0]?.line !== 2 || secondLineColumn[0]?.column !== 3) {
    failures.push("line/column reporting is incorrect");
  }

  return failures;
}

function formatReport(scannedFileCount, violations) {
  if (violations.length === 0) {
    return `Product contract OK — ${scannedFileCount} active file(s) scanned, 0 violation(s).`;
  }
  const header = `Product contract FAILED — ${scannedFileCount} file(s) scanned, ${violations.length} violation(s):`;
  const body = violations.map(
    (v) => `  ${v.path}:${v.line}:${v.column}: [${v.rule}] ${v.message}\n      found "${v.matched}" — ${v.fix}`,
  );
  return [header, ...body].join("\n");
}

const args = process.argv.slice(2);

if (isMain) {
  if (args.includes("--self-test")) {
    const failures = selfTest();
    if (failures.length === 0) {
      console.log(`Product contract self-test OK — ${RULES.length} rule(s) verified.`);
      process.exit(0);
    }
    console.error("Product contract self-test FAILED:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  const { scannedFileCount, violations } = scanRepository();
  console.log(args.includes("--json") ? JSON.stringify({ scannedFileCount, violations }, null, 2) : formatReport(scannedFileCount, violations));
  process.exit(violations.length === 0 ? 0 : 1);
}
