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

/**
 * The only markup-injection boundaries this product has been audited against.
 *
 * `markup-injection-sink` exempts a line when two things hold at once: the file is exactly the one
 * named here, and the named sanitisation witness is still present in that file. Each `sink` string
 * vouches for one line, and only one — so a second sink in an audited file is a finding, and so is
 * an audited file that drops the sanitisation its entry names. The exemption therefore cannot be
 * widened from inside the exempted file, which is why this is a table rather than a path exclusion.
 *
 * Add an entry only with the review that earns it: what crosses the boundary, and what sanitises
 * it before the DOM sees it. Both SVG entries cross with database-authored artwork and sanitise it
 * through `src/lib/sanitizeSvg.ts`; the chart entry crosses with the theme block this package
 * generates itself and carries no host or database text at all.
 */
const AUDITED_HTML_SINKS = [
  {
    path: "src/pages/CreateProject.tsx",
    witness: "sanitizeSvg(tmpl.previewSvg)",
    sinks: ["__html: sanitizeSvg("],
  },
  {
    path: "src/pages/EditProject.tsx",
    witness: "sanitizeSvg(design.previewSvg)",
    sinks: ["__html: artwork"],
  },
  {
    // The shadcn chart primitive's own generated custom-property block: CSS text assembled from
    // `THEMES` and the chart config's colour values, never host or database prose. It opens the
    // tag on one line and puts `__html` on the next, so both lines are named.
    path: "src/components/ui/chart.tsx",
    witness: "__html: Object.entries(THEMES)",
    sinks: ["dangerouslySetInnerHTML={{", "__html: Object.entries(THEMES)"],
  },
];

/** Which audited sink lines exist in `text` at `path`. Line indexes, 0-based. */
function auditedSinkLines(path, lines, text) {
  const claimed = new Set();
  for (const entry of AUDITED_HTML_SINKS) {
    if (entry.path !== path) continue;
    if (!text.includes(entry.witness)) continue;
    for (const sink of entry.sinks) {
      const index = lines.findIndex((line, i) => !claimed.has(i) && line.includes(sink));
      if (index !== -1) claimed.add(index);
    }
  }
  return claimed;
}

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
    id: "reviewer-door-called-with-arguments",
    // Stage 7's second public door is the same shape question, and a relative's link is the same
    // kind of secret as a guest's: `api.resolve_family_review` is argument-free so the review
    // credential can only arrive in a header. An argument list here means a query string on a GET
    // — an address that outlives the wedding in an access log, a browser history and a `Referer`.
    // No `exclude`, for the same reason the guest rule has none: the module that must not write
    // this shape is the one that would be broken by it.
    pattern: /\.rpc\(\s*['"]resolve_family_review['"]\s*,/g,
    message: "passes arguments to the reviewer resolver, which would put a review credential in a URL",
    fix: "call `rpc('resolve_family_review')` with no arguments and send the credential in the x-review-token header",
    scope: ["src/"],
  },
  {
    id: "ad-hoc-supabase-client",
    // The guest page must hold no session and write nothing to storage; the signed-in app
    // must hold exactly one. A client constructed in a component is a third kind of
    // caller, and its auth/storage defaults are nobody's audited choice.
    pattern: /createClient\s*[(<]/g,
    message: "constructs a Supabase client outside the integration layer",
    fix: "read through src/integrations/supabase/ — publicInvitation.ts and publicReview.ts are the app's only two anonymous clients, one per public door",
    scope: ["src/"],
    exclude: ["src/integrations/supabase/", "src/test/"],
  },
  {
    id: "canonical-table-read-outside-the-adapter",
    pattern: /\.from\(\s*['"](?:weddings|wedding_people|venues|wedding_events|wedding_assets|invitation_drafts|invitation_versions|publications|design_templates|tradition_packs|tradition_pack_releases|approval_requests|approval_feedback)['"]\s*\)/g,
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
    // An identity, name, place or language value feeding a pack selection — the shape a
    // "suggest a pack from the couple's details" feature arrives in. Two things make this a
    // rule about logic rather than about vocabulary:
    //
    //   * It needs a *selection* token on the line. A disclaimer that says "nothing here asks
    //     about religion, caste or community" names no selection, so it stays writable in the
    //     source tree; the day a line carries both, the sentence is no longer a disclaimer.
    //   * The identity word must not be in object-key position (`(?! *:)`), because the honest
    //     case is a *projection*: `src/lib/traditionPackResolver.ts:273` builds
    //     `{ source: 'reviewed_pack', packKey: source.packKey, language: lang as string,
    //     fallbackUsed }`, which is directive §24's permitted half — a language choosing which
    //     wording a *already host-selected* release draws. Reading `language` there as a
    //     selection input would forbid the fallback feature.
    //
    // Proximity rather than data flow, because data flow is what
    // `src/test/culturalSafetyDecisionLogic.test.tsx` proves absent profile by profile; this rule
    // is the tripwire that keeps someone from writing it back in.
    pattern: /^(?=.*(?:=|&&|\|\||\bif\b|\bswitch\b|\bcase\b|=>|\.includes\(|\.startsWith\(|\.endsWith\())(?=.*\b(?:religion|caste|community|sect|surname|gotra|family_?name|familyName|given_?name|givenName|ethnicity|mother_tongue|primary_language|additional_languages|location|city|district|state|region|language|lang)\b(?! *:)(?![^\n]{0,20}(?:\b(?:not|never|neither|none|nobody|without|cannot)\b|n't\b)))(?=.*\b(?:tradition_pack_release_id|traditionReleaseId|selectedReleaseId|releaseOptionId|releaseId|packKey|pack_key|traditionPackId|SelectedTraditionRelease|selectTraditionRelease)\b(?! *:)).*$/gi,
    message: "connects an identity, name, place or language field to a tradition pack selection",
    fix: "a pack is chosen by the host and by nothing else; a language may choose which wording of the host's own release is drawn, never which release (directive §24, docs/product/content-governance.md rule 3)",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
  {
    id: "pack-selection-derived-by-name",
    // The same decision wearing a function name: `deriveRelease(profile)` hides the identity
    // column inside `profile`, so the proximity rule above cannot see it. These verbs are the
    // ones that mean "the code decided", and `select` is deliberately absent —
    // `selectTraditionRelease` is this product's own write, which is the host deciding.
    pattern: /\b(?:suggest|recommend|infer|derive|guess|predict|assume|auto|automatic(?:ally)?)[A-Za-z]{0,14}(?:Release|Pack|Tradition)[A-Za-z]{0,14}\s*\(|\b(?:release|pack|tradition)[_ ]?(?:suggestion|recommendation|match|matched|derived|derivation)\b|\b[A-Za-z0-9_]*(?:Release|Pack|Tradition)[A-Za-z0-9_]*\s*\((?:[^()]|\([^()]*\))*\b(?:religion|caste|community|sect|surname|gotra|family_?name|familyName|given_?name|givenName|ethnicity|mother_tongue|primary_language|additional_languages|city|district|state|region|location|language|lang)\b/gi,
    message: "names a function or value that derives a tradition pack, which this product has none of",
    fix: "delete the derivation: the catalogue is listed for the host and the only writer of a selection is the host's own choice",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
  {
    id: "identity-tested-by-name-shape",
    // `surname === "Iyer"` is the obvious form; `surname.startsWith("Reddi")` is the same
    // decision wearing a call. Both guess a community from a name, which is the invention
    // class this stage exists to make unrepresentable.
    pattern: /\b(?:surname|gotra|family_?name|given_?name|caste|community|religion|sect|ethnicity)\b\s*(?:\.\s*(?:includes|startsWith|endsWith|match|split|toLowerCase|toUpperCase|charAt|length|trim)|\s*[!=]==?)|\b(?:if|while|switch)\s*\((?:[^()\n]|\([^()]*\))*\b(?:surname|gotra|family_?name|given_?name|caste|community|religion|sect|ethnicity)\b\s*(?:[)!=<>]|\)|\.[^\n]*\))/gi,
    message: "inspects the shape or value of a name or an identity field",
    fix: "names are data the host types; no code may read a tradition, community or rite out of one",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
  {
    id: "place-tested-for-a-tradition",
    // A place read as a proxy for a community — "if the city is Madurai, assume Tamil rites".
    // Kept apart from the rule above because it does not need a selection token to be a
    // violation: inferring a tradition from a district is the invention, whoever consumes it.
    pattern: /^(?=.*\b(?:traditions?|packs?|releases?|rites?|rituals?|ceremon(?:y|ies|ial)|communit(?:y|ies)|caste|religion|tamil|telugu|kannada|malayalam|brahmin|iyer|reddi|nair|maratha|gujarati)\b)(?:(?=.*\b(?:city|district|state|region|location|pincode|village|town)\b\s*(?:\.\s*(?:includes|startsWith|endsWith|match)|[!=]==?\s*["'`]))|(?=.*\bif\b.{0,40}\b(?:city|district|state|region|location|village|town)\b.{0,40}\b(?:tamil|telugu|kannada|malayalam|brahmin|iyer|reddi|nair|maratha|gujarati)\b)).*$/gi,
    message: "reads a place as a signal of a tradition, community or rite",
    fix: "a venue's address is an address; nothing about a couple's origins is derivable from it and nothing may try",
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
  {
    id: "tamil-candidate-status-claim",
    // §24's three named claims: the Tamil candidate is reviewed, is approved, is customer
    // ready. The candidate noun is required, because `release 2 is approved` is true of a
    // synthetic TEST ONLY fixture and must stay writable in the panel that lists it. A copula
    // is required too, which is what lets the honest denial — "the Tamil candidate is not
    // approved" — stay a sentence the product can print rather than a phrase the gate forbids.
    pattern: /\b(?:tamil[- ]english[- ]foundation|tamil candidate|the candidate|tamil pack|tamil-english)\b[^\n]{0,50}\b(?:is|are|was|were|has been|have been|now|already|becomes?|looks)\s+(?:fully\s+|already\s+)?(?:reviewed|human[- ]reviewed|culturally reviewed|approved|customer[- ]ready|selectable|shippable|live|ready(?: for (?:hosts|customers))?|available(?: to hosts)?)\b|\b(?:is|are|was|has been|now|already)\s+(?:fully\s+)?(?:reviewed|approved|customer[- ]ready|selectable|shippable)\b[^\n]{0,50}\b(?:tamil[- ]english[- ]foundation|tamil candidate|the candidate|tamil pack)\b/gi,
    message: "claims the Tamil candidate is reviewed, approved or customer ready",
    fix: "it is a draft, machine-assisted and not selectable, and the copy has to say that — see directive §0's truth status for the candidate",
    scope: ["src/", "index.html", "README.md", "docs/product/", "docs/content-review/", "content/"],
    exclude: ["src/test/"],
  },
  {
    id: "machine-assisted-claimed-approved",
    // The silently-softened disclosure: machine-assisted wording presented as though the
    // assistance had been checked into approval. The copula between the two halves is the
    // whole of the precision — "AI-assisted wording has not been reviewed by a Tamil reader"
    // and "machine_assisted: true is the disclosure" both stay writable, and the lie
    // "AI-generated wording is human-reviewed" does not.
    pattern: /^(?!.*\b(?:no|not|never|neither|none|nobody|without|cannot)\b)(?=.*\b(?:ai|machine|model|llm)[-\s]?(?:generated|assisted|drafted|authored|written)\b)(?:(?:.*\b(?:is|are|was|were|has been|have been|now|already|becomes?|looks)\s+(?:fully\s+|already\s+)?(?:human[- ]reviewed|reviewed|approved|culturally validated|verified|signed[- ]off|finalized|complete|ready)\b)|(?:.*\b(?:treated as|counts as|considered|deemed)\b.{0,20}\b(?:approved|reviewed|final|ready)\b)).*$/gi,
    message: "lets machine-assisted or AI-generated wording read as reviewed or approved",
    fix: "say what it is: machine-assisted, human review recorded separately or not at all — directive §24 forbids the silent merge",
    scope: ["src/", "index.html", "README.md", "docs/product/", "docs/content-review/", "content/"],
    exclude: ["src/test/"],
  },
  {
    id: "main-landmark-absence-claim",
    // Found while assembling §40, one commit after the truth sync: `feature-readiness.md` still said the
    // host editor has no `main` landmark after `EditProject.tsx:654` had been repaired. The wording is
    // deliberately narrow — an absence verb directly on the landmark — because the honest sentence about
    // the same element is that its browser re-read is what is missing.
    pattern: /\b(?:has no|does not have|lacks|had no)\s+(?:`main`|main)\s+landmark\b/gi,
    message: "states that a page has no `main` landmark",
    fix: "check the source before repeating it — the editor's success branch renders `<main>` at `src/pages/EditProject.tsx:654`; if what is missing is a measurement, say that",
    scope: ["src/", "index.html", "README.md", "docs/product/", "docs/architecture/", "docs/content-review/", "content/"],
    exclude: ["src/test/"],
  },
  {
    id: "markup-injection-sink",
    // Writing HTML into the live DOM is the one place where this product's sanitisation boundary
    // can be deleted with a one-line change. Every shape below is a *write*: `container.innerHTML`
    // read back in a test is not a finding, `el.innerHTML = x` is. The three boundaries that
    // legitimately write are named in `AUDITED_HTML_SINKS`, each with the sanitisation that must
    // still be present for the exemption to hold, so adding a fourth sink anywhere — including in
    // an audited file — is a build failure rather than a silent trust extension.
    //
    // Scoped to `src/` because the directive's concern is the active app bundle. `src/test/` is
    // out: a test may attach markup to a detached node to prove a sanitizer works, and the hostile
    // shapes are pinned by this file's own fixtures, which live under the excluded `scripts/`.
    pattern: /(?:__html\s*:|dangerouslySetInnerHTML\s*=\s*\{\{|insertAdjacentHTML\s*\(|\.innerHTML\s*[+]?=[^=]|\.outerHTML\s*[+]?=[^=]|document\.write(?:ln)?\s*\()/g,
    message: "writes HTML into the live DOM",
    fix: "render the value as text, or sanitise it at the boundary and register the one line that writes it in AUDITED_HTML_SINKS with the sanitisation as its witness",
    scope: ["src/"],
    exclude: ["src/test/"],
  },
];

/** Copy the reviewer's door prints today, quoted verbatim from `src/pages/FamilyReview.tsx` and
 *  `src/integrations/supabase/publicReview.ts`. It is a named list rather than prose because "this
 *  sentence must stay allowed" is only a fact about a sentence the app prints, and a fixture written
 *  as a plausible rewording of the copy pins nothing: three of the four copy entries Stage 7 first
 *  shipped here were paraphrases of sentences that appear nowhere in `src/`. The test file reads the
 *  shipped reviewer source and fails if one of these strings stops appearing in it. */
export const SHIPPED_REVIEWER_COPY = [
  "This review link is not available.",
  "No account is needed to review a wedding invitation.",
  "There is no sign-in on this page and nothing here checks who you are.",
  "Your answer is recorded against version",
  "changed nothing on that version — only the family's own editor does that",
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
  // §24's own controls. The directive asks for near-miss cases so that honest comments and
  // documentation do not become meaningless findings, and these are the shapes that honest
  // writing about this feature actually takes: the language projection the resolver performs,
  // the host's own write, a denial of the candidate's status, and an address being validated.
  "? { source: 'reviewed_pack', packKey: source.packKey, language: lang as string, fallbackUsed },",
  "await selectTraditionRelease(user.id, wedding.id, option.id);",
  "the Tamil candidate is not approved, is not reviewed, and is not selectable by hosts",
  // The same rule's other half. Its noun requirement is the only reason a synthetic
  // fixture's own status line stays writable in the panel that lists it, so that line is
  // asserted here too — otherwise the requirement is a comment that a future widening can
  // delete without anything going red.
  'copy = "release 2 is approved",',
  "no machine-assisted wording here has been reviewed by a reader of Tamil",
  "AI-assisted wording has not been reviewed by a Tamil reader",
  'if (venue.city.trim() === "") toast("A city is required for the venue");',
  "const region = layout.regions.find((entry) => entry.id === section.region);",
  "a language selects which wording of the host's own release is drawn, never which release",
  // The sentence that replaced the claim the new rule below forbids. It talks about the same
  // element, so it is the case a future widening of that pattern would break.
  "the `main` landmark on the page a host works on is measured from source and pinned by a unit test, but has not been re-read in a browser since the repair",
  // The markup guard is about *writing* HTML. Reading serialized markup back is how the renderer's
  // own tests assert what they rendered (`src/test/invitationRenderer.test.tsx:445`), and
  // `src/lib/sanitizeSvg.ts` names the sink in the JSDoc that documents the boundary. Both shapes
  // are real lines in this repository, so the guard's narrowness is a checked fact, not a claim.
  "const html = container.innerHTML.toLowerCase();",
  "dangerouslySetInnerHTML). Every DB-provided SVG must pass through",
  // Stage 7's own near-misses. A reviewer page is written in the same vocabulary as a guest page,
  // so the copy it must be allowed to print is pinned here — as the app's own sentences, held in
  // `SHIPPED_REVIEWER_COPY` and read back out of the shipped source by the test file, rather than
  // as rewordings of it. The argument-free reviewer call is the shape the rule above exists to
  // permit, and the identity sentences are the product's honest claim: possession of a link is not
  // a verified person, and saying so must not become a finding.
  `const { data } = await client.schema('api').rpc('resolve_family_review');`,
  ...SHIPPED_REVIEWER_COPY,
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
 *  write a shape can stay in the repository while the same shape elsewhere is a finding.
 *  `markup-injection-sink` additionally honours `AUDITED_HTML_SINKS`, which can vouch for
 *  specific lines of specific files and for nothing else. */
export function scanContent(relativePath, text) {
  const path = posix(relativePath);
  const lines = text.split(/\r?\n/);
  const auditedLines = auditedSinkLines(path, lines, text);
  const violations = [];
  lines.forEach((line, index) => {
    RULES.forEach((rule) => {
      if (rule.scope && !rule.scope.some((prefix) => path.startsWith(prefix))) return;
      if (rule.exclude && rule.exclude.some((prefix) => path.startsWith(prefix))) return;
      if (rule.id === "markup-injection-sink" && auditedLines.has(index)) return;
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
    "reviewer-door-called-with-arguments": `const { data } = await client.schema('api').rpc('resolve_family_review', { p_token: token });`,
    "ad-hoc-supabase-client": `const supabase = createClient(url, anonKey);`,
    "canonical-table-read-outside-the-adapter": [
      `const { data } = await supabase.from('weddings').select('*');`,
      `const { data } = await supabase.from('wedding_assets').select('*');`,
      `const { data } = await supabase.from('approval_requests').select('status');`,
      `const { data } = await supabase.from('approval_feedback').select('message');`,
    ],
    "service-role-key-in-browser-code": `const key = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;`,
    "tradition-pack-identity-branch": `if (option.packKey === "tamil_english_foundation") showMuhurthamBlock();`,
    "tradition-selected-from-identity": [
      `wedding.tradition_pack_release_id = suggestRelease(host.community);`,
      `if (host.primary_language === "ta") option = releases.find((r) => r.packKey === "tamil-english-foundation");`,
    ],
    "pack-selection-derived-by-name": [
      `const option = suggestTraditionPack(weddingDetail);`,
      `selectTraditionRelease(user.id, wedding.id, releaseIdFor(host.primary_language));`,
    ],
    "identity-tested-by-name-shape": [
      `if (person.surname.startsWith("Reddi")) assumeVocabulary();`,
      `if (person.ethnicity === "Tamil-Brahmin") showVedicSection();`,
    ],
    "place-tested-for-a-tradition": `if (wedding.city === "Madurai") packKey = "tamil-english-foundation";`,
    "language-gated-rite": `if (language === "ta") body = "The priest will confirm the auspicious time";`,
    "ceremonial-authority-claim": `<p>An authentic Tamil tradition for your invitation.</p>`,
    "draft-candidate-claimed-shippable": `{ "human_reviewed": true, "customer_selectable": true }`,
    "tamil-candidate-status-claim": [
      `copy = "the Tamil candidate is approved for customer use",`,
      `copy = "it is now selectable for the Tamil candidate",`,
    ],
    "machine-assisted-claimed-approved": [
      `copy = "The AI-generated ceremonial wording is human-reviewed",`,
      `copy = "machine-assisted wording counts as approved content",`,
    ],
    "main-landmark-absence-claim": `| Host editor on a phone | the page a host works on has no \`main\` landmark |`,
    "markup-injection-sink": [
      `element.innerHTML = weddingDetail.hostNoteHtml;`,
      `<div dangerouslySetInnerHTML={{ __html: section.body }} />`,
      `node.insertAdjacentHTML("beforeend", importedMarkup);`,
      `document.write(response.markup);`,
    ],
  };
  for (const [ruleId, fixture] of Object.entries(fixtures)) {
    const texts = Array.isArray(fixture) ? fixture : [fixture];
    for (const text of texts) {
      if (!scanContent("src/fixture.tsx", text).some((v) => v.rule === ruleId)) {
        failures.push(`rule ${ruleId} did not fire on ${JSON.stringify(text)}`);
      }
    }
  }
  // §24 asks for a hostile self-test for *every* rule, so the map above cannot be a sample:
  // a rule added without a fixture is a rule nobody has ever seen fire, and a fixture whose
  // id has been renamed is an assertion that checks nothing.
  const fixtureIds = new Set(Object.keys(fixtures));
  for (const rule of RULES) {
    if (!fixtureIds.has(rule.id)) failures.push(`rule ${rule.id} has no hostile fixture in selfTest()`);
  }
  for (const id of fixtureIds) {
    if (!RULES.some((rule) => rule.id === id)) failures.push(`selfTest() fixture names an unknown rule: ${id}`);
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
  // below are the same three lines, read at two paths.
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

  // Stage 7 puts a second anonymous door in front of the same domain, so the same two questions
  // are asked of it rather than assumed: the sanctioned module stays clean at its own path, and a
  // page writing the identical shapes is still a finding. The third block asks the question the
  // guest rule's shape implies but cannot ask of one file — the argument form has to be a finding
  // *including* in the module that owns the call, because that module is precisely where somebody
  // would be tempted to write it, and the rule there carries no `exclude` for a reason.
  const reviewerShapes = [
    `const { data } = await client.schema('api').rpc('resolve_family_review');`,
    `const client = createClient<Database>(url, key, { auth: { persistSession: false } });`,
    `const { data } = await supabase.from('approval_requests').select('status');`,
  ].join("\n");
  const sanctionedReview = scanContent("src/integrations/supabase/publicReview.ts", reviewerShapes);
  if (sanctionedReview.length > 0) {
    failures.push(
      `the reviewer adapter's own file was flagged: ${sanctionedReview.map((v) => v.rule).join(", ")}`,
    );
  }
  const unsanctionedReview = scanContent("src/pages/FamilyReview.tsx", reviewerShapes);
  const unsanctionedReviewRules = unsanctionedReview.map((v) => v.rule).sort();
  if (unsanctionedReviewRules.join(",") !== "ad-hoc-supabase-client,canonical-table-read-outside-the-adapter") {
    failures.push(`a reviewer page writing the same shapes produced ${unsanctionedReviewRules.join(", ") || "nothing"}`);
  }
  const reviewerArgumentForm = `const { data } = await client.schema('api').rpc('resolve_family_review', { p_token: token });`;
  for (const path of ["src/integrations/supabase/publicReview.ts", "src/pages/FamilyReview.tsx", "src/lib/familyReview.ts"]) {
    if (!scanContent(path, reviewerArgumentForm).some((v) => v.rule === "reviewer-door-called-with-arguments")) {
      failures.push(`the reviewer argument form was not a finding at ${path}`);
    }
  }

  // …and the approval pair is only genuinely adapter-bound if reading them through `.from()` is a
  // finding at a page while the words themselves stay writable in the adapter and in a comment.
  const approvalVocabulary = [
    `// approval_requests is the row this token was minted against.`,
    `const status = row.approval_requests?.status;`,
  ].join("\n");
  const approvalHits = scanContent("src/lib/familyReview.ts", approvalVocabulary);
  if (approvalHits.length > 0) {
    failures.push(
      `prose about the approval tables produced ${approvalHits.length} violation(s): ${approvalHits.map((v) => v.rule).join(", ")}`,
    );
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
    // §24's permitted half: a language choosing which *wording* of the host's own release is
    // drawn. This is the real projection at src/lib/traditionPackResolver.ts:273, and it is the
    // reason the identity rule needs both an operator and a non-key position.
    `? { source: 'reviewed_pack', packKey: source.packKey, releaseNumber: source.releaseNumber, language: lang as string, fallbackUsed },`,
    `const { packKey, releaseNumber } = selectedRelease;`,
    `await selectTraditionRelease(user.id, wedding.id, option.id);`,
    `// if language === "ta" that never selects a pack_key; the host's own click does.`,
    `if (venue.city.trim() === "") toast("A city is required for the venue");`,
    `const region = layout.regions.find((entry) => entry.id === section.region);`,
    `copy = "the Tamil candidate is not approved, is not reviewed, and is not selectable by hosts";`,
    `copy = "no machine-assisted wording here has been reviewed by a reader of Tamil";`,
  ].join("\n");
  const culturalHits = scanContent("src/components/invitation/InvitationRenderer.tsx", culturalNearMiss);
  if (culturalHits.length > 0) {
    failures.push(
      `honest cultural-safety language produced ${culturalHits.length} violation(s): ${culturalHits.map((v) => `${v.rule} on ${v.matched}`).join(", ")}`,
    );
  }

  // The markup-injection guard is only worth having if the table is the *whole* exemption. Each
  // pair below is one audited boundary as it really appears in the shipped file, read at its own
  // path, and the four assertions after them are the ways an exemption could be quietly widened:
  // a second sink in an audited file, a sink whose file stopped sanitising, the same line at an
  // unaudited path, and a read-only `innerHTML` test assertion mistaken for an injection.
  const auditedBoundaries = {
    "src/pages/CreateProject.tsx": `dangerouslySetInnerHTML={{ __html: sanitizeSvg(tmpl.previewSvg) }}`,
    "src/pages/EditProject.tsx": [
      `const artwork = design ? sanitizeSvg(design.previewSvg) : null;`,
      `<div className="h-full w-full" dangerouslySetInnerHTML={{ __html: artwork }} />`,
    ].join("\n"),
    "src/components/ui/chart.tsx": [
      `      <style`,
      `        dangerouslySetInnerHTML={{`,
      `          __html: Object.entries(THEMES)`,
      `        }}`,
      `      />`,
    ].join("\n"),
  };
  for (const [path, text] of Object.entries(auditedBoundaries)) {
    const hits = scanContent(path, text);
    if (hits.length > 0) {
      failures.push(`the audited markup boundary ${path} was flagged: ${hits.map((v) => v.rule).join(", ")}`);
    }
  }
  const sinkChecks = [
    [
      "a second, unaudited sink in an audited file",
      "src/pages/CreateProject.tsx",
      [
        auditedBoundaries["src/pages/CreateProject.tsx"],
        `dangerouslySetInnerHTML={{ __html: tmpl.previewSvg }}`,
      ].join("\n"),
    ],
    [
      "a sink in a file that no longer carries its sanitisation witness",
      "src/pages/EditProject.tsx",
      `<div dangerouslySetInnerHTML={{ __html: artwork }} />`,
    ],
    [
      "an audited sink shape written at an unaudited path",
      "src/pages/SomeNewPage.tsx",
      auditedBoundaries["src/pages/EditProject.tsx"],
    ],
  ].map(([label, path, text]) => {
    if (!scanContent(path, text).some((v) => v.rule === "markup-injection-sink")) {
      return `the guard let through ${label}`;
    }
    return null;
  });
  for (const failure of sinkChecks) {
    if (failure) failures.push(failure);
  }
  const readOnlyMarkup = scanContent(
    "src/pages/Reading.tsx",
    `const html = container.innerHTML.toLowerCase();`,
  );
  if (readOnlyMarkup.some((v) => v.rule === "markup-injection-sink")) {
    failures.push("the guard flagged reading innerHTML, which is not an injection");
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
