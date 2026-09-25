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
      ].join("\n"),
    );
    expect([...new Set(detected.map((v) => v.rule))].sort()).toEqual([...ruleIds].sort());
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
    ].join("\n");
    expect(scanContent("docs/product/commercial-model.md", honest)).toEqual([]);
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
