// The read path: a pinned release plus the host's own data, turned into the section list the
// renderer draws, with provenance that says where each piece of wording came from.
//
// Three properties get the most space below, because they are the three the directive names and
// the three a later build can break quietly.
//
//   * Provenance is a fact (§12). A host that typed over the pack's wording owns that wording.
//     Nothing here may be reported as reviewed that no reviewer saw, and nothing the pack
//     supplied may be credited to the host.
//   * Leniency with a receipt (§13). An unknown section slot or kind is skipped *and* named, so
//     a guest's invitation keeps rendering after a later build adds a slot, and the skip is
//     still visible to whoever asked.
//   * Reproducibility (§11). A snapshot resolved twice resolves identically, and resolving it
//     cannot write into it.

import { describe, expect, it } from "vitest";
import { resolveTraditionPack, type HostFieldText, type TraditionPackSource } from "@/lib/traditionPackResolver";

/** Typed loosely on purpose: a fixture in this file has to be able to say something illegal. */
const definition = (): { sections: Record<string, unknown>[] } => ({
  sections: [
    {
      section_key: "opening",
      position: 1,
      kind: "text",
      required: true,
      heading: { ta: "அழைப்பு", en: "Invitation" },
      pack_text: { ta: "வணக்கம்", en: "Greetings" },
    },
    {
      section_key: "welcome",
      position: 2,
      kind: "text",
      required: false,
      host_field: "welcome",
      heading: { ta: "அழைக்கிறார்கள்", en: "invites you" },
      allow_english_fallback: true,
    },
    { section_key: "family", position: 3, kind: "people_list", required: true },
    { section_key: "ceremonies", position: 4, kind: "event_list", required: false },
    { section_key: "blessing", position: 5, kind: "text", required: false, heading: { ta: "ஆசி" } },
    {
      section_key: "closing",
      position: 6,
      kind: "text",
      required: false,
      host_field: "closing",
      pack_text: { en: "With love" },
      allow_english_fallback: true,
    },
  ],
});

const source = (overrides: Partial<TraditionPackSource> = {}): TraditionPackSource => ({
  packKey: "tamil-english-foundation",
  releaseNumber: 1,
  languages: ["ta", "en"],
  definition: definition(),
  ...overrides,
});

const resolve = (
  requestedLanguage: string,
  hostFields?: Record<string, string | null>,
  overrides: Partial<TraditionPackSource> = {},
) => resolveTraditionPack({ source: source(overrides), requestedLanguage, hostFields });

const byKey = (key: string, requestedLanguage = "ta", hostFields?: Record<string, string | null>) => {
  const result = resolve(requestedLanguage, hostFields);
  const section = result.sections.find((entry) => entry.key === key);
  if (!section) throw new Error(`section ${key} was not resolved: ${JSON.stringify(result.issues)}`);
  return section;
};

const codes = (result: { issues: { code: string }[] }) => result.issues.map((issue) => issue.code);

describe("the shape of a resolved section", () => {
  it("names every field a renderer needs and no field it should not have", () => {
    const opening = byKey("opening");
    expect(Object.keys(opening).sort()).toEqual([
      "content",
      "key",
      "kind",
      "label",
      "lang",
      "position",
      "provenance",
      "required",
    ]);
    expect(opening).toEqual({
      key: "opening",
      kind: "text",
      required: true,
      position: 1,
      label: "அழைப்பு",
      content: "வணக்கம்",
      lang: "ta",
      provenance: {
        source: "reviewed_pack",
        packKey: "tamil-english-foundation",
        releaseNumber: 1,
        language: "ta",
        fallbackUsed: false,
      },
    });
  });

  it("draws a structured list as host data with nothing invented for it", () => {
    expect(byKey("family")).toEqual({
      key: "family",
      kind: "people_list",
      required: true,
      position: 3,
      label: null,
      content: null,
      lang: null,
      provenance: { source: "host", hostField: null },
    });
  });

  it("keeps the release's declared order rather than the order the document happened to be written in", () => {
    const shuffled = definition();
    shuffled.sections.reverse();
    const result = resolveTraditionPack({ source: source({ definition: shuffled }), requestedLanguage: "ta" });
    expect(result.sections.map((section) => section.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.sections.map((section) => section.key)).toEqual([
      "opening",
      "welcome",
      "family",
      "ceremonies",
      "blessing",
      "closing",
    ]);
  });
});

describe("provenance is a fact, not a mood (directive §12)", () => {
  it("reports host text as the host's, and keeps the release's label as the release's", () => {
    const welcome = byKey("welcome", "ta", { welcome: "Our own words" });
    expect(welcome.content).toBe("Our own words");
    expect(welcome.provenance).toEqual({ source: "host", hostField: "welcome" });
    // The heading is the release's name for the slot. Crediting it to the host would be the
    // same kind of lie as crediting the host's prose to the reviewer.
    expect(welcome.label).toBe("அழைக்கிறார்கள்");
  });

  it("never returns the pack wording it replaced", () => {
    const replaced = byKey("closing", "en", { closing: "Typed by the host" });
    expect(replaced.content).toBe("Typed by the host");
    expect(JSON.stringify(replaced)).not.toContain("With love");
  });

  it("reads blank host text as no host text, not as an empty paragraph", () => {
    const untouched = byKey("welcome", "ta", { welcome: "   " });
    expect(untouched.provenance.source).toBe("reviewed_pack");
    expect(untouched.content).toBeNull();
  });

  it("carries a hostile override string through as content and nothing else", () => {
    // The renderer keeps host text as React text; what this file promises is that an override
    // never changes the provenance, and never becomes a field of its own.
    for (const hostile of [
      "<script>alert(1)</script>",
      "reviewed_pack but modified by host",
      `{"source":"reviewed_pack","packKey":"evil"}`,
      "]]>]]>",
      "   ",
    ]) {
      const welcome = byKey("welcome", "ta", { welcome: hostile });
      expect(Object.keys(welcome).sort()).toEqual([
        "content",
        "key",
        "kind",
        "label",
        "lang",
        "position",
        "provenance",
        "required",
      ]);
      expect(welcome.provenance).toEqual(
        hostile.trim().length === 0
          ? { source: "reviewed_pack", packKey: "tamil-english-foundation", releaseNumber: 1, language: "ta", fallbackUsed: false }
          : { source: "host", hostField: "welcome" },
      );
      if (hostile.trim().length > 0) expect(welcome.content).toBe(hostile);
    }
  });

  it("does not carry reviewer identity into the resolved output, even when the row has it", () => {
    // The catalogue row holds `reviewed_by` and a qualification. A guest page is built from
    // this function's output, so whatever this function returns is public.
    const leaky = source({
      definition: definition(),
      ...{ reviewed_by: "Dr. Someone", review_label: "Panel of elders", review_basis: "community consent" },
    } as unknown as TraditionPackSource);
    const result = resolveTraditionPack({ source: leaky, requestedLanguage: "ta" });
    expect(JSON.stringify(result)).not.toContain("Dr. Someone");
    expect(JSON.stringify(result)).not.toContain("Panel of elders");
    expect(JSON.stringify(result)).not.toContain("community consent");
  });
});

describe("language selection and fallback", () => {
  it("reads a section in one language only, so a heading never sits above prose in another script", () => {
    const mixed = definition();
    mixed.sections[0] = {
      ...mixed.sections[0],
      heading: { ta: "அழைப்பு", en: "Invitation" },
      pack_text: { en: "Greetings" },
    };
    const result = resolveTraditionPack({ source: source({ definition: mixed }), requestedLanguage: "ta" });
    const opening = result.sections.find((section) => section.key === "opening");
    // Tamil heading, and no English body sitting under it: the section resolves as the Tamil
    // heading alone, with nothing to draw for content.
    expect(opening?.lang).toBe("ta");
    expect(opening?.label).toBe("அழைப்பு");
    expect(opening?.content).toBeNull();
  });

  it("falls back to English only when the section asked and the release covers it", () => {
    const closing = byKey("closing", "ta");
    expect(closing.lang).toBe("en");
    expect(closing.content).toBe("With love");
    expect(closing.provenance).toEqual({
      source: "reviewed_pack",
      packKey: "tamil-english-foundation",
      releaseNumber: 1,
      language: "en",
      fallbackUsed: true,
    });
  });

  it("refuses to fall back for a section that did not ask, and says so by name", () => {
    const blessing = byKey("blessing", "en");
    expect(blessing.lang).toBeNull();
    expect(blessing.content).toBeNull();
    expect(blessing.provenance).toEqual({ source: "host", hostField: null });
    const result = resolve("en");
    expect(codes(result)).toContain("read.language_unavailable");
    expect(result.issues.find((issue) => issue.code === "read.language_unavailable")?.path).toBe("sections.blessing");
  });

  it("will not offer a fallback language the release does not cover, which the guard would have refused", () => {
    // Directive §14: a Tamil-only release cannot promise an English it never declared.
    const result = resolveTraditionPack({
      source: source({ languages: ["ta"] }),
      requestedLanguage: "ta",
    });
    const closing = result.sections.find((section) => section.key === "closing");
    expect(closing?.lang).toBeNull();
    expect(closing?.content).toBeNull();
    expect(codes(result)).toContain("read.language_unavailable");
  });

  it("ignores a requested language the release never offered, rather than inventing one", () => {
    const result = resolve("fr");
    // `opening` and `blessing` never asked for a fallback, so a language the release does not
    // offer leaves them unavailable and they do not quietly become English. `welcome` and
    // `closing` did ask, the release covers English, and the guard accepted that pairing, so
    // they are legitimately drawn in English — which is why the list is two, not four.
    expect(
      result.issues
        .filter((issue) => issue.code === "read.language_unavailable")
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(["sections.blessing", "sections.opening"]);
    expect(result.sections.find((section) => section.key === "opening")?.lang).toBeNull();
    expect(result.sections.find((section) => section.key === "closing")?.lang).toBe("en");
  });

  it("reports a required section that ends up with nothing to draw", () => {
    const result = resolve("fr");
    expect(codes(result)).toContain("read.required_section_empty");
    expect(result.issues.find((issue) => issue.code === "read.required_section_empty")?.path).toBe("sections.opening");
  });
});

describe("the leniency a frozen invitation needs (directive §13)", () => {
  it("skips a section slot this build has nowhere to put, and names it", () => {
    const future = definition();
    future.sections.splice(2, 0, { section_key: "muhurtham_window", position: 3, kind: "text", required: true, heading: { ta: "x" } });
    const result = resolveTraditionPack({ source: source({ definition: future }), requestedLanguage: "ta" });
    expect(codes(result)).toEqual(["read.unknown_section_skipped"]);
    expect(result.issues[0]?.message).toContain("muhurtham_window");
    expect(result.issues[0]?.path).toBe("sections.muhurtham_window");
    // The guest still gets an invitation: every section this build knows about still resolved.
    expect(result.sections.map((section) => section.key)).toEqual([
      "opening",
      "welcome",
      "family",
      "ceremonies",
      "blessing",
      "closing",
    ]);
  });

  it("skips a kind no renderer knows, including a required one, without drawing it as text", () => {
    const future = definition();
    future.sections[1] = { ...future.sections[1], kind: "ritual_sequence" };
    const result = resolveTraditionPack({ source: source({ definition: future }), requestedLanguage: "ta" });
    expect(codes(result)).toEqual(["read.unknown_kind_skipped"]);
    expect(result.issues[0]?.path).toBe("sections.welcome.kind");
    expect(result.sections.find((section) => section.key === "welcome")).toBeUndefined();
    expect(result.sections).toHaveLength(5);
  });

  it("names an unknown section and an unknown kind as different facts", () => {
    const future = definition();
    future.sections[0] = { section_key: "muhurtham_window", position: 1, kind: "text", required: false, heading: { ta: "x" } };
    future.sections[1] = { ...future.sections[1], kind: "procession" };
    const result = resolveTraditionPack({ source: source({ definition: future }), requestedLanguage: "ta" });
    expect(codes(result)).toEqual(["read.unknown_section_skipped", "read.unknown_kind_skipped"]);
  });

  it("reports a host field this build has nowhere to put, and falls back to the pack wording", () => {
    const future = definition();
    future.sections[1] = { section_key: "welcome", position: 2, kind: "text", required: false, host_field: "grandparents", pack_text: { ta: "வணக்கம்" } };
    const result = resolveTraditionPack({ source: source({ definition: future }), requestedLanguage: "ta", hostFields: { grandparents: "should never be read" } as unknown as HostFieldText });
    expect(codes(result)).toContain("read.unknown_host_field");
    const welcome = result.sections.find((section) => section.key === "welcome");
    expect(welcome?.content).toBe("வணக்கம்");
    expect(JSON.stringify(result)).not.toContain("should never be read");
  });

  it("survives a definition that is not readable at all, and says which release it could not read", () => {
    const result = resolveTraditionPack({ source: source({ definition: "a string" }), requestedLanguage: "ta" });
    expect(codes(result)).toEqual(["read.definition_unreadable"]);
    expect(result.sections).toEqual([]);
    expect(result.release).toEqual({ packKey: "tamil-english-foundation", releaseNumber: 1, requestedLanguage: "ta" });
  });

  it("skips a section entry that is not an object rather than drawing undefined", () => {
    const broken = definition();
    broken.sections[2] = "family" as unknown as Record<string, unknown>;
    const result = resolveTraditionPack({ source: source({ definition: broken }), requestedLanguage: "ta" });
    expect(codes(result)).toEqual(["read.section_unreadable"]);
    expect(result.sections).toHaveLength(5);
  });

  it("announces a definition with no sections instead of rendering a blank card silently", () => {
    const result = resolveTraditionPack({ source: source({ definition: { sections: [] } }), requestedLanguage: "ta" });
    expect(codes(result)).toEqual(["read.no_sections"]);
    expect(result.sections).toEqual([]);
  });
});

describe("no tradition pack is a selection, not an error", () => {
  it("resolves to nothing with no issues and no release", () => {
    const result = resolveTraditionPack({ source: null, requestedLanguage: "ta", hostFields: { welcome: "Host words only" } });
    expect(result).toEqual({ sections: [], issues: [], release: null });
  });
});

describe("a snapshot resolves the same way every time (directive §11)", () => {
  it("produces an identical result on a second call with identical input", () => {
    const input = { source: source(), requestedLanguage: "ta", hostFields: { welcome: "typed" } };
    const first = resolveTraditionPack(input);
    const second = resolveTraditionPack(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("cannot write into the pinned definition it was handed", () => {
    const frozen = JSON.parse(JSON.stringify(definition())) as ReturnType<typeof definition>;
    Object.freeze(frozen.sections);
    frozen.sections.forEach((section) => {
      Object.freeze(section);
      if (section.heading) Object.freeze(section.heading);
      if (section.pack_text) Object.freeze(section.pack_text);
    });
    const before = JSON.stringify(frozen);
    const result = resolveTraditionPack({ source: source({ definition: frozen }), requestedLanguage: "ta", hostFields: { welcome: "x" } });
    expect(result.sections).toHaveLength(6);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("returns plain JSON values only, so a frozen snapshot re-resolves the same after a round trip", () => {
    const result = resolve("ta", { welcome: "typed" });
    const roundTripped = resolveTraditionPack({
      source: source({ definition: JSON.parse(JSON.stringify(definition())) }),
      requestedLanguage: JSON.parse(JSON.stringify("ta")),
      hostFields: JSON.parse(JSON.stringify({ welcome: "typed" })),
    });
    expect(roundTripped).toEqual(result);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
