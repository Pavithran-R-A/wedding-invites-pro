/**
 * Product contract checker.
 *
 * Scans ACTIVE product surfaces for retired branding, resurrected commerce copy, fabricated social
 * proof, and copy that presents unverified backend-dependent flows as live capability. It fails
 * loudly so a rename slip or a re-introduced false claim cannot merge quietly.
 *
 *   node scripts/check-product-contract.mjs              human-readable report, exit 1 on findings
 *
 * Run with `node <path>` (see the npm scripts), which is why there is no `#!` line: the test
 * runner's module transform prepends code above the source, and a shebang that is no longer
 * line 1 is a syntax error at load time.
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
  {
    id: "unverified-capability-framing",
    pattern: /what\s+you\s+can\s+actually\s+do\s+on\s+this\s+site/gi,
    message: "lists capabilities as proven live behaviour on this site",
    fix: "label backend-dependent code as an implemented foundation — see docs/product/feature-readiness.md",
  },
  {
    id: "unverified-capability-list",
    pattern: /what\s+actually\s+works\s+in\s+this\s+build/gi,
    message: "claims a verified-working list for this build",
    fix: "split it into verified behaviour and implemented foundations — see README.md",
  },
  // Stage 2 archived the scaffold tables (`projects`, `templates`, `guests`, `orders`,
  // `payments`, `printers`) into the `legacy` schema. Nothing that runs in front of a
  // customer may treat them as the live domain again.
  {
    id: "legacy-table-in-client-code",
    pattern: /\.from\(\s*['"](?:projects|templates|guests|orders|payments|printers)['"]\s*\)/g,
    message: "queries an archived scaffold table as if it were the live schema",
    fix: "read the canonical domain through src/integrations/supabase/weddings.ts",
  },
  {
    id: "legacy-table-as-current-terminology",
    // `(^|[^A-Za-z0-9_])` stands in for a lookbehind: `design_templates table` must not
    // read as a retired name, and the transform this file is parsed with rejects lookbehind.
    pattern: /(?:^|[^A-Za-z0-9_])(?:projects|templates)\s+(?:table|tables|row|rows|schema)\b/gi,
    message: "names a retired scaffold table as current terminology in product code or copy",
    fix: "say wedding / design; keep scaffold names inside docs/audits/ and migration history",
    // Historical documents, ADRs and the Stage 2 blueprint describe the scaffold on
    // purpose — that record must survive. Only live code and the front-page copy speak
    // for what the product *is* today.
    scope: ["src/", "README.md"],
  },
  // Stage 3 put a public door in front of the canonical domain, which made three things
  // worth enforcing mechanically rather than by review. Each is a *shape* rule about
  // where a call may be written, so it cannot be satisfied by rewording prose, and each
  // exempts the one module and the test directories that have to write the shape to
  // qualify it.
  {
    id: "guest-door-called-with-arguments",
    // `api.resolve_public_invitation` is argument-free so the credential can only arrive
    // in a header. An argument list here means a query string on a GET, which is the one
    // thing this boundary exists to avoid: URLs outlive a wedding invitation.
    pattern: /\.rpc\(\s*['"]resolve_public_invitation['"]\s*,/g,
    message: "passes arguments to the guest resolver, which would put a credential in a URL",
    fix: "call `rpc('resolve_public_invitation')` with no arguments and send the credential in the x-invitation-token header",
    scope: ["src/"],
  },
  {
    id: "ad-hoc-supabase-client",
    // The guest page must hold no session and write nothing to storage; the signed-in app
    // must hold exactly one. A client constructed in a component is a third kind of
    // caller, and its auth/storage defaults are nobody's audited choice.
    pattern: /createClient\s*[(<]/g,
    message: "constructs a Supabase client outside the integration layer",
    fix: "read through src/integrations/supabase/ — publicInvitation.ts is the only anonymous client in the app",
    scope: ["src/"],
    exclude: ["src/integrations/supabase/", "src/test/"],
  },
  {
    id: "canonical-table-read-outside-the-adapter",
    pattern: /\.from\(\s*['"](?:weddings|wedding_people|venues|wedding_events|invitation_drafts|invitation_versions|publications|design_templates|tradition_packs|tradition_pack_releases)['"]\s*\)/g,
    message: "queries a canonical wedding table outside the adapter",
    fix: "add the read to src/integrations/supabase/ so its columns, errors and refusals stay in one place",
    scope: ["src/"],
    exclude: ["src/integrations/supabase/", "src/test/"],
  },
  {
    id: "service-role-key-in-browser-code",
    // `SERVICE_ROLE_KEY` is the key that bypasses row-level security. Its name in `src/`
    // means it is on its way into a bundle a guest can open.
    pattern: /SERVICE_ROLE_KEY/g,
    message: "names the service-role key inside browser code",
    fix: "no browser file may reference it; the local key exists only in .env.local for the test runners",
    scope: ["src/", "index.html"],
  },
  // ---------------------------------------------------------------------------
  // Stage 4 §24 and §25 — application code must not know any tradition.
  //
  // §24 asks for a search that fails the stage if the renderer or the picker grows a
  // branch on pack identity, religion, caste, community or a name. Putting it here,
  // rather than in a review habit, is what makes it a gate.
  //
  // Every rule below is a *shape*, never a noun, and none of them is scoped to `docs/`.
  // The reason is deliberate: the sentence "this renderer never compares a pack key to
  // anything" is governance documentation and has to stay writable, in the source tree
  // and in the product docs, while the expression `packKey === "x"` is a branch that
  // has no legitimate use in this build. A rule that fired on the sentence would be
  // deleted the first time it blocked a correct comment; a rule that fires on the
  // operator cannot be argued with.
  {
    id: "tradition-pack-identity-branch",
    // A pack's or release's identity compared to a literal, or switched on. Either form
    // moves a content decision out of the frozen definition and into code, which is what
    // makes the catalogue stop being extendable — a new release would need a new branch.
    pattern: /\b(?:packKey|pack_key|releaseNumber|release_number)\s*(?:===|!==|==|!=)\s*(?:["'`]\w|\d)|\bswitch\s*\(\s*(?:packKey|pack_key|releaseNumber|release_number)\s*\)/g,
    message: "branches on a tradition pack's identity in application code",
    fix: "the renderer switches only on the generic `section.kind`; anything specific to one pack belongs in that pack's definition (directive §24)",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
  {
    id: "tradition-selected-from-identity",
    // An identity or language column named on the same statement as the pack selection —
    // the shape a "suggest a pack from the couple's details" feature arrives in. Proximity
    // rather than data flow, because data flow is what the tests in
    // `src/test/traditionReleases.test.ts` prove absent column by column; this rule is the
    // tripwire that keeps someone from writing it back in.
    pattern: /\b(?:religion|caste|community|surname|gotra|family_name|mother_tongue|primary_language|additional_languages)\b[^\n]{0,60}\b(?:tradition_pack_release_id|traditionReleaseId|selectedReleaseId|releaseOptionId|packKey)\b|\b(?:tradition_pack_release_id|traditionReleaseId|selectedReleaseId|releaseOptionId|packKey)\b[^\n]{0,60}\b(?:religion|caste|community|surname|gotra|family_name|mother_tongue|primary_language|additional_languages)\b/gi,
    message: "connects an identity, name or language field to a tradition pack selection",
    fix: "a pack is chosen by the host and by nothing else; see docs/product/content-governance.md rule 3 (no inference) and §19 of the Stage 4 directive",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
  {
    id: "identity-tested-by-name-shape",
    // `surname === "Iyer"` is the obvious form; `surname.startsWith("Reddi")` is the same
    // decision wearing a call. Both guess a community from a name, which is the invention
    // class this stage exists to make unrepresentable.
    pattern: /\b(?:surname|gotra|family_name|given_name|caste|community|religion)\s*\.\s*(?:includes|startsWith|endsWith|match|split|toLowerCase|toUpperCase)\s*\(/gi,
    message: "inspects the shape of a name or an identity field",
    fix: "names are data the host types; no code may read a tradition, community or rite out of one",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
  {
    id: "language-gated-rite",
    // "if Tamil then a special ritual section" — a language *tested in a condition* on the
    // same line as a rite word. The comparison is required, and that requirement is a
    // measured decision rather than a tolerance: the first version of this rule matched any
    // line carrying both vocabulary classes, and it fired on
    // `src/components/landing/DesignDirectionSection.tsx:13`, the display name of a visual
    // template ("Telugu Ceremonial"). A style name is not a branch, and §24 forbids logic
    // ("switch only on generic section.kind"), not the six design-direction titles a host
    // reads on the landing page. That name is disclosed as a content question for the human
    // review in docs/content-review/ rather than silently exempted or renamed here.
    pattern: /^(?=.*(?:===|!==|\bswitch\s*\())(?=.*(?:\blanguage\b|\blang\b|\bta\b|\bte\b|\bml\b|\bkn\b|tamil|telugu|malayalam|kannada))(?=.*\b(?:ritual|rite|ceremony|ceremonial|priest|purohit|mantra|vedic|auspicious|puja|havan|homam)\b).*/gi,
    message: "gates ceremonial behaviour on a language",
    fix: "the only per-language behaviour is which resolved section text and slot word a document draws, in src/lib/invitationSections.ts",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
  {
    id: "ceremonial-authority-claim",
    // The customer-facing claims §19 forbids without evidence: that a tradition is
    // authentic, that ritual wording is correct, that a practice is official. Adjacency,
    // not co-occurrence — "does not claim that any wording in it is traditional, correct,
    // or approved" is the honest scope sentence and stays writable.
    pattern: /\b(?:authentic|verified|correct|official|certified|genuine|traditional)\s+(?:tamil\s+|telugu\s+|kannada\s+|malayalam\s+)?(?:tradition|traditions|ritual|ceremony|ceremonial|rite|wording|practice)\b|\b(?:religiously|expert|scripturally|community)[ -](?:approved|certified|validated)\b/gi,
    message: "claims ceremonial, religious or community authority for wording",
    fix: "describe what a pack is — a prepared wording release — and never what no review has certified it to be",
    scope: ["src/", "index.html", "README.md", "content/"],
    exclude: ["src/test/"],
  },
  {
    id: "draft-candidate-claimed-shippable",
    // The two flags that make the Stage 4 candidate honest, flipped to `true`, and the
    // prose form of the same lie. `machine_assisted: true` is legitimately present in the
    // artifact and is deliberately not a finding here — the disclosure is the point.
    pattern: /\b(?:human_reviewed|humanReviewed|customer_selectable|customerSelectable)["']?\s*[:=]\s*true\b|\b(?:is|was|has been|now|already)\s+(?:human[- ]reviewed|culturally validated|expert-reviewed|community-approved)\b/gi,
    message: "presents the unreviewed draft candidate as reviewed or selectable",
    fix: "the candidate stays draft, human_reviewed false, customer_selectable false until a named human review exists — see docs/content-review/tamil-english-foundation-v1.md",
    scope: ["src/", "index.html", "README.md", "content/"],
    exclude: ["src/test/"],
  },
];

/** Copy that must stay acceptable: the honest replacement wording, plus planning vocabulary. */
export const MUST_NOT_MATCH = [
  "Razorpay",
  "payment",
  "entitlement",
  "Implemented foundations in this preview",
  "These pieces exist in the current codebase",
  "No account or app is needed to read this invitation.",
  "This invitation is not available",
  `const { data } = await client.schema('api').rpc('resolve_public_invitation');`,
  // Stage 4's cultural-safety near-miss controls. Each is a sentence this repository either
  // ships or must keep shipping, and each is one edit away from a phrase the rules above do
  // forbid — which is why they are asserted rather than assumed.
  "This pack does not claim that any wording in it is traditional, correct, or approved.",
  "Nothing here asks about religion, caste or community, and no role is guessed from a name.",
  "Tradition packs are optional. You can create an invitation without one.",
  "a wedding may only select an approved tradition pack release",
  "TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW",
  'body_source === "reviewed_pack"',
  // The design-direction name that made the first version of `language-gated-rite` fire. It
  // stays in the repository, so the rule's precision is now a checked fact rather than a
  // claim in a comment.
  'title: "Telugu Ceremonial"',
];

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

/** One violation per rule match in `text`, with 1-based line and column numbers. Rules
 *  that carry a `scope` are checked only against paths under one of those prefixes, and
 *  a rule's own `exclude` removes a path again — which is how the one module allowed to
 *  write a shape can stay in the repository while the same shape elsewhere is a finding. */
export function scanContent(relativePath, text) {
  const path = posix(relativePath);
  const violations = [];
  text.split(/\r?\n/).forEach((line, index) => {
    RULES.forEach((rule) => {
      if (rule.scope && !rule.scope.some((prefix) => path.startsWith(prefix))) return;
      if (rule.exclude && rule.exclude.some((prefix) => path.startsWith(prefix))) return;
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      re.lastIndex = 0;
      let match = re.exec(line);
      while (match !== null) {
        violations.push({
          rule: rule.id,
          path,
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
    "unverified-capability-framing": `<p>What you can actually do on this site right now.</p>`,
    "unverified-capability-list": `What actually works in this build:`,
    "legacy-table-in-client-code": `supabase.from('projects').select('*')`,
    "legacy-table-as-current-terminology": `// each row of the projects table is a customer`,
    "guest-door-called-with-arguments": `const { data } = await client.schema('api').rpc('resolve_public_invitation', { raw_token: token });`,
    "ad-hoc-supabase-client": `const supabase = createClient(url, anonKey);`,
    "canonical-table-read-outside-the-adapter": `const { data } = await supabase.from('weddings').select('*');`,
    "service-role-key-in-browser-code": `const key = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;`,
    "tradition-pack-identity-branch": `if (option.packKey === "tamil_english_foundation") showMuhurthamBlock();`,
    "tradition-selected-from-identity": `wedding.tradition_pack_release_id = suggestRelease(host.community);`,
    "identity-tested-by-name-shape": `if (person.surname.startsWith("Reddi")) assumeVocabulary();`,
    "language-gated-rite": `if (language === "ta") body = "The priest will confirm the auspicious time";`,
    "ceremonial-authority-claim": `<p>An authentic Tamil tradition for your invitation.</p>`,
    "draft-candidate-claimed-shippable": `{ "human_reviewed": true, "customer_selectable": true }`,
  };
  for (const [ruleId, text] of Object.entries(fixtures)) {
    if (!scanContent("src/fixture.tsx", text).some((v) => v.rule === ruleId)) {
      failures.push(`rule ${ruleId} did not fire on its fixture`);
    }
  }

  // The scoped rule must stay a rule about *live* surfaces: the same sentence in a
  // historical document is the record Stage 2 deliberately kept.
  const scaffoldInDocs = scanContent(
    "docs/audits/stage-2-domain-database.md",
    "The projects table was archived into the legacy schema.",
  );
  if (scaffoldInDocs.length > 0) {
    failures.push("scoped rule fired on a historical document; docs/** must stay writable as evidence");
  }

  // Canonical vocabulary that merely *contains* a retired name must not be mistaken
  // for one — a false positive here would push people to reword correct code.
  const canonicalVocabulary = [
    `supabase.from('weddings').select('id')`,
    `supabase.from('design_templates').select('preview_svg')`,
    `// the design_templates catalogue rows are reviewed before publishing`,
    `SELECT count(*) FROM legacy.projects;`,
  ].join("\n");
  const vocabularyHits = scanContent("src/integrations/supabase/weddings.ts", canonicalVocabulary);
  if (vocabularyHits.length > 0) {
    failures.push(
      `canonical vocabulary produced ${vocabularyHits.length} violation(s): ${[...new Set(vocabularyHits.map((v) => v.rule))].join(", ")}`,
    );
  }

  // A `scope` plus `exclude` rule is only worth having if the exempt path really is the
  // module it names, and the identical text elsewhere is still a finding. Both halves
  // below are the same four lines, read at two paths.
  const boundaryShapes = [
    `const { data } = await client.schema('api').rpc('resolve_public_invitation');`,
    `const client = createClient<Database>(url, key, { auth: { persistSession: false } });`,
    `const { data } = await supabase.from('weddings').select('id');`,
  ].join("\n");
  const sanctioned = scanContent("src/integrations/supabase/publicInvitation.ts", boundaryShapes);
  if (sanctioned.length > 0) {
    failures.push(
      `the adapter's own file was flagged: ${sanctioned.map((v) => v.rule).join(", ")}`,
    );
  }
  const unsanctioned = scanContent("src/pages/SomethingElse.tsx", boundaryShapes);
  const unsanctionedRules = unsanctioned.map((v) => v.rule).sort();
  if (unsanctionedRules.join(",") !== "ad-hoc-supabase-client,canonical-table-read-outside-the-adapter") {
    failures.push(`a page writing the same shapes produced ${unsanctionedRules.join(", ") || "nothing"}`);
  }

  const benign = [
    `-- A future Razorpay-class provider would be confirmed server-side (ADR 0005).`,
    `paid_status is pinned to 'unpaid' by the INSERT policy.`,
    `Trusted by practice rather than by customer counts, which we do not have.`,
    `<Button>Create Invitation Draft</Button>`,
    `Publishing, sharing, RSVP and payment are not available yet.`,
    `Implemented foundations in this preview`,
    `These pieces exist in the current codebase. Account-backed persistence still requires a verified Supabase environment.`,
    `Verified in Stage 1: the public pages render and protected routes redirect.`,
    `// the archived projects table is read only during migration`,
    `The design_templates rows are reviewed by an admin before publishing.`,
  ].join("\n");
  const benignHits = scanContent("docs/architecture/example.md", benign);
  if (benignHits.length > 0) {
    failures.push(
      `honest planning text produced ${benignHits.length} violation(s): ${[...new Set(benignHits.map((v) => v.rule))].join(", ")}`,
    );
  }

  // The Stage 4 rules are scoped to `src/`, so the block above cannot exercise them — a
  // governance sentence in `docs/` is out of scope by construction and would pass even
  // against a rule that fired on the whole repository. These lines are the same honest
  // sentences, read at an in-scope path, and they are the reason the cultural-safety rules
  // are shape rules: `packKey === "x"` is a finding, while the sentence saying the code
  // never writes one is the documentation this stage needs to keep.
  const culturalNearMiss = [
    `// The renderer never compares a pack key to anything, and no name is read for a tradition.`,
    `const body = source === "reviewed_pack" ? packText : hostText;`,
    `scope_statement: "This pack does not claim that any wording in it is traditional, correct, or approved."`,
    `intro="Nothing here asks about religion, caste or community, and no role is guessed from a name."`,
    `title: "Telugu Ceremonial",`,
    `<p>Tradition packs are optional. You can create an invitation without one.</p>`,
    `review_label: "TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW"`,
    `const isRetired = release.status === "deprecated";`,
    `// a release whose pack_key is unknown to this build is refused by name, not guessed at.`,
  ].join("\n");
  const culturalHits = scanContent("src/components/invitation/InvitationRenderer.tsx", culturalNearMiss);
  if (culturalHits.length > 0) {
    failures.push(
      `honest cultural-safety language produced ${culturalHits.length} violation(s): ${culturalHits.map((v) => `${v.rule} on ${v.matched}`).join(", ")}`,
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
