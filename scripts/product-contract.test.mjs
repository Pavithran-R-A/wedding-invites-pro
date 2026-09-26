import { describe, expect, it } from "vitest";
import {
  MUST_NOT_MATCH,
  RULES,
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
        `const supabase = createClient(url, anonKey);`,
        `const { data } = await supabase.from('weddings').select('*');`,
        `const key = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;`,
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
