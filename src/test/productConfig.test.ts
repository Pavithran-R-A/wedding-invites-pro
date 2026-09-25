import { describe, expect, it } from "vitest";
import { PRODUCT, PRODUCT_STATUS_LABEL } from "@/config/product";
import { LANGUAGES } from "@/lib/i18n";

describe("product configuration", () => {
  it("carries the contract values and nothing else", () => {
    expect(PRODUCT).toEqual({
      name: "VivaahVarnam",
      descriptor: "Digital Wedding Patrika",
      tagline: "Tradition, beautifully invited.",
      status: "Preview",
      market: "South India first",
    });
  });

  it("holds no pricing, contact or domain data that could become a live claim", () => {
    const keys = Object.keys(PRODUCT).map((key) => key.toLowerCase());
    for (const forbidden of ["price", "gst", "tax", "email", "phone", "domain", "url", "entity", "address"]) {
      expect(keys.filter((key) => key.includes(forbidden))).toEqual([]);
    }
    expect(JSON.stringify(PRODUCT)).not.toMatch(/₹|\.in\b|@/);
  });

  it("labels the product status for reuse in copy", () => {
    expect(PRODUCT_STATUS_LABEL).toBe("VivaahVarnam — Preview");
  });
});

describe("language rollout order", () => {
  it("is English first, then the priority South-Indian languages", () => {
    expect(LANGUAGES.map((language) => language.code)).toEqual(["en", "ta", "te", "ml", "kn"]);
  });

  it("names every language in its own script", () => {
    const nonEnglish = LANGUAGES.filter((language) => language.code !== "en");
    for (const language of nonEnglish) {
      expect(language.nativeLabel).not.toBe(language.label);
      expect(language.nativeLabel.length).toBeGreaterThan(0);
    }
  });
});
