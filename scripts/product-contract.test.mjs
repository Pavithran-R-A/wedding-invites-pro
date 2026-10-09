import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MUST_NOT_MATCH,
  RULES,
  SHIPPED_REVIEWER_COPY,
  isScannedPath,
  scanContent,
  scanRepository,
  selfTest,
} from "./check-product-contract.mjs";

const ruleIds = RULES.map((rule) => rule.id);

describe("product contract checker", () => {
  it("passes its own fixture assertions", () => {
    expect(selfTest()).toEqual([]);
  });

  it("detects every retired-brand and retired-claim form", () => {
    const detected = scanContent(
      "src/pages/Index.tsx",
      [
        `const name = "YourInvite";`,
        `// Wedding Invites Pro`,
        `<span>yourinvite.in</span>`,
        `const PRICE_PER_GUEST = 5;`,
        `Pay & Create Project`,
        `Payment successful`,
        `₹199`,
        `Trusted by 1000 couples`,
        `Real stories from couples`,
        `What you can actually do on this site right now.`,
        `What actually works in this build:`,
        `supabase.from('projects').select('*')`,
        `// the projects table holds one row per customer`,
        `const { data } = await client.schema('api').rpc('resolve_public_invitation', { raw_token });`,
        // `reviewer-door-called-with-arguments` — the same mistake on the reviewer's door, which
        // is Stage 7's addition to this list. The two doors are one rule each because a checker
        // only covers the wording it was written with.
        `const { data } = await client.schema('api').rpc('resolve_family_review', { raw_review_token });`,
        `const supabase = createClient(url, anonKey);`,
        `const { data } = await supabase.from('weddings').select('*');`,
        `const key = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;`,
        `if (option.packKey === "tamil_english_foundation") showMuhurthamBlock();`,
        `wedding.tradition_pack_release_id = suggestRelease(host.community);`,
        `const option = suggestTraditionPack(weddingDetail);`,
        `if (person.surname.startsWith("Reddi")) assumeVocabulary();`,
        `if (wedding.city === "Madurai") packKey = "tamil-english-foundation";`,
        `if (language === "ta") body = "The priest will confirm the auspicious time";`,
        `<p>An authentic Tamil tradition for your invitation.</p>`,
        `{ "human_reviewed": true, "customer_selectable": true }`,
        `copy = "the Tamil candidate is approved for customer use",`,
        `copy = "The AI-generated ceremonial wording is human-reviewed",`,
        // `main-landmark-absence-claim` — the sentence this rule was added to refuse.
        `| Host editor on a phone | the page a host works on has no main landmark |`,
        // `markup-injection-sink` — a new, unaudited write of markup into the live DOM.
        `element.innerHTML = weddingDetail.hostNoteHtml;`,
      ].join("\n"),
    );
    expect([...new Set(detected.map((v) => v.rule))].sort()).toEqual([...ruleIds].sort());
  });

  it("keeps the scaffold-vocabulary rule out of historical documents", () => {
    const sentence = `The projects table was archived into the legacy schema in Stage 2.`;
    expect(scanContent("docs/architecture/domain-model.md", sentence)).toEqual([]);
    expect(
      scanContent("src/pages/Dashboard.tsx", sentence).map((v) => v.rule),
    ).toEqual(["legacy-table-as-current-terminology"]);
  });

  it("does not mistake a canonical name for a retired one", () => {
    expect(
      scanContent(
        "src/integrations/supabase/weddings.ts",
        [
          `supabase.from('weddings').select('id')`,
          `supabase.from('design_templates').select('preview_svg')`,
          `// the design_templates rows are reviewed before they are offered`,
          `SELECT count(*) FROM legacy.projects;`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("holds every table the adapter actually queries inside the adapter rule", () => {
    // Stage 4 found this rule's table list named seven of the nine tables the adapter reads:
    // `wedding_people`, `venues` and the new `tradition_pack_releases` were absent, so a stray
    // `.from()` on them outside the adapter would have passed CI. Stage 7 also adds
    // `wedding_assets`, which Stage 6 correctly recorded as a missing adapter boundary.
    // The list is now derived from
    // what the adapter does, so a future table that leaves it out is a visible gap in this
    // assertion rather than an invisible one in the gate.
    const stray = [
      `const a = await supabase.from('wedding_people').select('*');`,
      `const b = await supabase.from('venues').select('*');`,
      `const c = await supabase.from('tradition_pack_releases').select('*');`,
      `const d = await supabase.from('wedding_assets').select('*');`,
    ].join("\n");
    expect([
      ...new Set(
        scanContent("src/pages/EditProject.tsx", stray).map((v) => v.rule),
      ),
    ]).toEqual(["canonical-table-read-outside-the-adapter"]);

    // The positive control: the identical statements are legal where they belong, and an
    // unrelated table name is not swept in by the widening.
    expect(scanContent("src/integrations/supabase/weddingContent.ts", stray)).toEqual([]);
    expect(
      scanContent("src/pages/EditProject.tsx", `supabase.from('rsvp_responses').select('*')`),
    ).toEqual([]);
  });

  it("keeps the Stage 4 cultural-safety rules about code shapes, not governance sentences", () => {
    // The rules added for §24 and §25 are scoped to `src/` and to `content/`, so a sentence
    // in `docs/` cannot be a finding no matter what it says. Inside the source tree the
    // honest disclaimer and the forbidden branch differ by an operator, which is the whole
    // design — and `Telugu Ceremonial` is the measured case that forced the precision: the
    // first version of `language-gated-rite` fired on that landing-page template name,
    // because it matched vocabulary rather than logic.
    const honest = [
      `// The renderer never compares a pack key to anything, and no name is read for a tradition.`,
      `const body = source === "reviewed_pack" ? packText : hostText;`,
      `scope_statement: "This pack does not claim that any wording in it is traditional, correct, or approved."`,
      `intro="Nothing here asks about religion, caste or community, and no role is guessed from a name."`,
      `title: "Telugu Ceremonial",`,
      `<p>Tradition packs are optional. You can create an invitation without one.</p>`,
      `const isRetired = release.status === "deprecated";`,
      `? { source: 'reviewed_pack', packKey: source.packKey, releaseNumber: source.releaseNumber, language: lang as string, fallbackUsed },`,
      `const { packKey, releaseNumber } = selectedRelease;`,
      `await selectTraditionRelease(user.id, wedding.id, option.id);`,
      `// if language === "ta" that never selects a pack_key; the host's own click does.`,
      `if (venue.city.trim() === "") toast("A city is required for the venue");`,
      `const region = layout.regions.find((entry) => entry.id === section.region);`,
      `copy = "the Tamil candidate is not approved, is not reviewed, and is not selectable by hosts";`,
      `copy = "no machine-assisted wording here has been reviewed by a reader of Tamil";`,
    ].join("\n");
    expect(scanContent("src/components/invitation/InvitationRenderer.tsx", honest)).toEqual([]);

    const branch = `if (option.packKey === "tamil_english_foundation") showMuhurthamBlock();`;
    expect(
      scanContent("src/components/invitation/InvitationRenderer.tsx", branch).map((v) => v.rule),
    ).toEqual(["tradition-pack-identity-branch"]);

    // Each of §24's five identity vocabulary classes, in the shape a real derivation takes.
    const byRule = {
      "tradition-selected-from-identity": `if (wedding.primary_language === "ta") releaseId = tamilRelease;`,
      "pack-selection-derived-by-name": `selectTraditionRelease(user.id, wedding.id, releaseIdFor(host.religion));`,
      "identity-tested-by-name-shape": `if (person.ethnicity === "Tamil-Brahmin") showVedicSection();`,
      "place-tested-for-a-tradition": `if (profile.region === "Tamil Nadu") releaseId = TAMIL_RELEASE_ID;`,
      "tamil-candidate-status-claim": `copy = "the Tamil candidate is approved for customer use",`,
      "machine-assisted-claimed-approved": `copy = "The AI-generated ceremonial wording is human-reviewed",`,
    };
    for (const [ruleId, line] of Object.entries(byRule)) {
      expect(scanContent("src/pages/Editor.tsx", line).map((v) => v.rule), line).toContain(ruleId);
    }
    // And the lines that are not derivations: inside a release the host already picked, a
    // language is only a lookup key and a fallback comparison. These are the four measured
    // shapes from `traditionPackResolver.ts` where a language value and a pack identifier sit
    // close enough to look like one to a vocabulary-only rule.
    const languageIsNotASelector = [
      `const readFromMap = (map: Record<string, unknown> | null, language: string): string | null =>`,
      `  map === null ? null : nonBlank(map[language])`,
      `    const candidates = candidateLanguages(section, input.requestedLanguage, source.languages)`,
      `    const fallbackUsed = lang !== null && lang !== input.requestedLanguage`,
    ];
    for (const line of languageIsNotASelector) {
      expect(scanContent("src/lib/traditionPackResolver.ts", line).map((v) => v.rule), line).toEqual([]);
    }

    // The same sentence, in a governance document, is out of scope by construction — which is
    // why the rule cannot be quietly widened to `docs/` later without this assertion moving.
    expect(scanContent("docs/product/content-governance.md", branch)).toEqual([]);
  });

  it("treats the draft candidate's own flags as honest and a flipped flag as a finding", () => {
    // §25's second concern: a live claim that the unreviewed candidate is reviewed or
    // selectable. The shipped artifact's real flag values are the passing case, so the rule
    // cannot be satisfied by rewording the artifact.
    const honest = [
      `  "status": "draft",`,
      `  "machine_assisted": true,`,
      `  "human_reviewed": false,`,
      `  "customer_selectable": false,`,
    ].join("\n");
    expect(scanContent("content/tradition-packs/tamil-english-foundation.v1.json", honest)).toEqual([]);
    expect(
      scanContent(
        "content/tradition-packs/tamil-english-foundation.v1.json",
        `  "human_reviewed": true,`,
      ).map((v) => v.rule),
    ).toEqual(["draft-candidate-claimed-shippable"]);
  });

  it("reports the exact position of each hit", () => {
    const [first, second] = scanContent("src/a.ts", `ok\n  YourInvite YourInvite`);
    expect(first).toMatchObject({ line: 2, column: 3, matched: "YourInvite", rule: "retired-brand-name" });
    expect(second).toMatchObject({ line: 2, column: 14 });
  });

  it("leaves honest Stage 0 / Stage 1 language untouched", () => {
    const honest = [
      `The paid_status column is server-authoritative; a Razorpay-class provider is a later decision.`,
      `Publishing, sharing, RSVP and payment are not available yet.`,
      `Create Invitation Draft`,
      `Trusted by practice, not by invented customer counts.`,
      `Implemented foundations in this preview`,
      `These pieces exist in the current codebase. Account-backed persistence still requires a verified Supabase environment.`,
      `Verified in Stage 1: the public pages render and protected routes redirect.`,
      `Sign-up, log-in and logout against a real project — FOUNDATION, no configured Supabase project was verified.`,
    ].join("\n");
    expect(scanContent("docs/product/commercial-model.md", honest)).toEqual([]);
  });

  it("rejects only the verified-availability framing, not the word implemented", () => {
    const hits = scanContent(
      "src/components/landing/HowItWorks.tsx",
      `The checker itself is implemented; that sentence is fine.`,
    );
    expect(hits).toEqual([]);
    expect(
      scanContent("README.md", `What actually works in this build:`).map((v) => v.rule),
    ).toEqual(["unverified-capability-list"]);
  });

  it("never treats a payment-provider or commerce planning word as banned", () => {
    for (const phrase of MUST_NOT_MATCH) {
      expect(scanContent("docs/example.md", phrase)).toEqual([]);
    }
  });

  it("pins the reviewer copy guard to the copy the reviewer page actually prints", () => {
    // The guard above says these sentences must stay acceptable; this test says they are the
    // sentences. Stage 7 first shipped three of them as plausible rewordings that appear nowhere
    // in `src/`, which vouched for copy the product does not print and left the copy it does print
    // unpinned — a pattern list cannot notice that about itself, so the shipped source is read.
    const shippedReviewerSource = [
      "src/pages/FamilyReview.tsx",
      "src/integrations/supabase/publicReview.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const sentence of SHIPPED_REVIEWER_COPY) {
      expect(shippedReviewerSource, sentence).toContain(sentence);
      expect(MUST_NOT_MATCH, sentence).toContain(sentence);
    }
  });

  it("excludes historical evidence and the checker itself", () => {
    expect(isScannedPath("docs/audits/stage-0-truth-security.md")).toBe(false);
    expect(isScannedPath("scripts/check-product-contract.mjs")).toBe(false);
    expect(isScannedPath("node_modules/react/index.js")).toBe(false);
    expect(isScannedPath(".env")).toBe(false);
  });

  it("scans the real active surfaces", () => {
    for (const path of ["index.html", "package.json", "README.md", "src/config/product.ts", "docs/product/brand-clearance.md"]) {
      expect(isScannedPath(path)).toBe(true);
    }
  });

  it("passes against the current repository state", () => {
    const { scannedFileCount, violations } = scanRepository();
    expect(scannedFileCount).toBeGreaterThan(50);
    expect(violations).toEqual([]);
  });
});
