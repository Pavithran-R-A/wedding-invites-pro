// The client half of the release-definition contract, rule by rule.
//
// `private.guard_tradition_pack_release()` refuses a bad definition at write time, one
// exception at a time. This parser exists so the same rules can be answered *before* a row is
// attempted, and so a refusal never arrives as "invalid JSON": every branch below is asserted
// by the stable code it emits and, where the rule is about one place in the document, by the
// path it names. A test that only asserted "some issue happened" would pass whether the parser
// found the rule or crashed into a generic branch, which is exactly the opacity §2 forbids.
//
// The positive controls matter as much as the refusals. Several rules here are "absence" tests
// written against JSON null, and a parser that read `null` as "present" would pass every
// negative control in this file while refusing real documents.

import { describe, expect, it } from "vitest";
import { parseTraditionPackDefinition } from "@/lib/traditionPackDefinition";

const LANGUAGES = ["ta", "en"] as const;

/** A definition every rule in this file is measured against, and which must parse cleanly. */
const validDefinition = () => ({
  sections: [
    {
      section_key: "opening",
      position: 1,
      kind: "text",
      required: false,
      heading: { ta: "அழைப்பு", en: "Invitation" },
      pack_text: { ta: "நண்பர்களே", en: "Friends and family" },
    },
    {
      section_key: "welcome",
      position: 2,
      kind: "text",
      required: true,
      host_field: "welcome",
      allow_english_fallback: true,
    },
    { section_key: "family", position: 3, kind: "people_list", required: false },
    { section_key: "ceremonies", position: 4, kind: "event_list", required: true },
  ],
  event_vocabulary: [{ event_key: "muhurtham", labels: { ta: "முஹூர்த்தம்", en: "Auspicious time" } }],
  design_guidance: { lead_size: 28, motif_reference: "test-motif-01" },
});

const doc = () => JSON.parse(JSON.stringify(validDefinition())) as Record<string, unknown>;

const parse = (
  raw: unknown,
  options: { languages?: readonly string[]; schemaVersion?: number } = {},
) => parseTraditionPackDefinition(raw, options.languages ?? LANGUAGES, options.schemaVersion ?? 1);

const codes = (raw: unknown, options: { languages?: readonly string[]; schemaVersion?: number } = {}) =>
  parse(raw, options).issues.map((issue) => issue.code);

const findIssue = (raw: unknown, code: string, options: { languages?: readonly string[]; schemaVersion?: number } = {}) =>
  parse(raw, options).issues.find((issue) => issue.code === code);

describe("a valid definition parses", () => {
  it("accepts the shape the database guard accepts, with no issues at all", () => {
    const result = parse(validDefinition());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("keeps the section list as written, including the fields a caller needs to draw it", () => {
    const result = parse(validDefinition());
    if (!result.ok || result.definition === null) throw new Error("the valid fixture was refused");
    expect(result.definition.sections.map((section) => section.sectionKey)).toEqual([
      "opening",
      "welcome",
      "family",
      "ceremonies",
    ]);
    expect(result.definition.sections[1]).toEqual({
      sectionKey: "welcome",
      position: 2,
      kind: "text",
      required: true,
      hostField: "welcome",
      heading: null,
      packText: null,
      allowEnglishFallback: true,
    });
    expect(result.definition.sections[0]?.hostField).toBeNull();
    expect(result.definition.eventVocabulary).toEqual([
      { eventKey: "muhurtham", labels: { ta: "முஹூர்த்தம்", en: "Auspicious time" } },
    ]);
    expect(result.definition.designGuidance).toEqual({ leadSize: 28, motifReference: "test-motif-01" });
  });

  it("treats the optional halves as optional, not as empty objects", () => {
    const bare = {
      sections: [{ section_key: "opening", position: 1, kind: "text", required: false, heading: { ta: "அழைப்பு" } }],
    };
    const result = parse(bare, { languages: ["ta"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.eventVocabulary).toBeNull();
    expect(result.definition.designGuidance).toBeNull();
    expect(result.definition.sections[0]?.packText).toBeNull();
    expect(result.definition.sections[0]?.allowEnglishFallback).toBe(false);
  });

  it("reads an explicit JSON null the same way the guard reads an absent key", () => {
    // The guard's absence tests are written `key IS NULL OR jsonb_typeof(key) <> 'null'`, so a
    // writer that put JSON null in `host_field` is not adding a host field. A client that read
    // null as a value would refuse a row the database accepts.
    const withNulls = doc();
    (withNulls.sections as Record<string, unknown>[])[1] = {
      section_key: "welcome",
      position: 2,
      kind: "text",
      required: true,
      host_field: null,
      heading: null,
      pack_text: null,
      allow_english_fallback: null,
    };
    (withNulls as Record<string, unknown>).design_guidance = null;
    const result = parse(withNulls);
    // `welcome` now says nothing, which is the rule that fires, not a null-reading artefact.
    expect(codes(withNulls)).toContain("section.says_nothing");
    expect(codes(withNulls)).not.toContain("host_field.unknown");
    expect(codes(withNulls)).not.toContain("fallback.not_boolean");
    expect(codes(withNulls)).not.toContain("design_guidance.not_object");
    expect(result.ok).toBe(false);
  });
});

describe("the rules the definition itself is under", () => {
  it("refuses a schema version this build does not understand, before looking at the document", () => {
    const issue = findIssue(validDefinition(), "definition.schema_version", { schemaVersion: 2 });
    expect(issue).toBeDefined();
    expect(issue?.path).toBe("definition_schema_version");
    expect(issue?.message).toContain("2");
    // A version this build cannot read must not be half-validated into a longer list.
    expect(parse(validDefinition(), { schemaVersion: 2 }).issues).toHaveLength(1);
  });

  it("refuses a definition that is not an object", () => {
    for (const raw of ["sections", 7, null, undefined, []]) {
      expect(codes(raw)).toEqual(["definition.not_object"]);
    }
  });

  it("names every top-level key nobody specified", () => {
    const withExtra = doc();
    withExtra["ritual_instructions"] = {};
    const issue = findIssue(withExtra, "definition.unknown_key");
    expect(issue?.message).toContain("ritual_instructions");
    expect(issue?.path).toBe("definition");
  });

  it("refuses a release with no sections, rather than an invitation with no content", () => {
    expect(codes({ sections: [] })).toEqual(["sections.empty"]);
    expect(codes({})).toEqual(["sections.empty"]);
    expect(codes({ sections: "opening" })).toEqual(["sections.empty"]);
  });
});

describe("the rules one section is under", () => {
  // A fixture that names its own position keeps it; one that does not is numbered 1..count, so
  // the dense-position tests below can still ask for a position the parser must refuse.
  const sectionOnly = (section: Record<string, unknown>, count = 1) => ({
    sections: Array.from({ length: count }, (_, i) =>
      "position" in section ? { ...section } : { ...section, position: i + 1 },
    ),
  });

  it("refuses a section that is not an object", () => {
    expect(codes({ sections: ["opening"] })).toContain("section.not_object");
  });

  it("names unknown keys inside a section without losing the section", () => {
    const issue = findIssue(
      sectionOnly({ section_key: "opening", position: 1, kind: "text", required: false, heading: { ta: "x" }, casteness: true }),
      "section.unknown_key",
    );
    expect(issue?.message).toContain("casteness");
  });

  it("refuses a section_key outside the slots this build renders, and names the one it saw", () => {
    const issue = findIssue(sectionOnly({ section_key: "garbha_griha", position: 1, kind: "text", required: false }), "section.key_unknown");
    expect(issue?.message).toContain("garbha_griha");
    expect(findIssue(sectionOnly({ position: 1, kind: "text", required: false }), "section.key_unknown")?.message).toContain("(none)");
  });

  it("refuses a section slot named twice", () => {
    expect(codes(sectionOnly({ section_key: "opening", kind: "text", required: false, heading: { ta: "x" } }, 2)))
      .toContain("section.duplicate_key");
  });

  it("refuses a position that is not a whole number", () => {
    expect(codes(sectionOnly({ section_key: "opening", position: "1", kind: "text", required: false, heading: { ta: "x" } })))
      .toContain("section.position_not_number");
    expect(codes({ sections: [{ section_key: "opening", kind: "text", required: false, heading: { ta: "x" } }] }))
      .toContain("section.position_not_number");
    expect(codes(sectionOnly({ section_key: "opening", position: 1.5, kind: "text", required: false, heading: { ta: "x" } })))
      .toContain("section.position_not_number");
  });

  it("refuses a position outside 1..n, which is what makes the positions dense with no gaps", () => {
    expect(codes(sectionOnly({ section_key: "opening", position: 0, kind: "text", required: false, heading: { ta: "x" } })))
      .toContain("section.position_out_of_range");
    expect(codes(sectionOnly({ section_key: "opening", position: 2, kind: "text", required: false, heading: { ta: "x" } })))
      .toContain("section.position_out_of_range");
    // Three sections with positions 1, 2, 4: the fourth slot is outside 1..3, so a release
    // cannot leave a hole for a section it does not declare.
    expect(codes({
      sections: [
        { section_key: "opening", position: 1, kind: "text", required: false, heading: { ta: "x" } },
        { section_key: "welcome", position: 2, kind: "text", required: false, heading: { ta: "x" } },
        { section_key: "blessing", position: 4, kind: "text", required: false, heading: { ta: "x" } },
      ],
    })).toContain("section.position_out_of_range");
  });

  it("refuses two sections claiming one position, because the renderer sorts by it", () => {
    expect(codes({
      sections: [
        { section_key: "opening", position: 1, kind: "text", required: false, heading: { ta: "x" } },
        { section_key: "welcome", position: 1, kind: "text", required: false, heading: { ta: "x" } },
      ],
    })).toContain("section.position_duplicate");
  });

  it("refuses a kind no renderer knows, and never defaults it to text", () => {
    const issue = findIssue(sectionOnly({ section_key: "opening", position: 1, kind: "ritual_sequence", required: false }), "section.kind_unknown");
    expect(issue?.message).toContain("ritual_sequence");
    expect(codes(sectionOnly({ section_key: "opening", position: 1, required: false, heading: { ta: "x" } })))
      .toContain("section.kind_unknown");
  });

  it("refuses `required` that is not a boolean, because freeze behaviour depends on it", () => {
    for (const required of ["true", 1, undefined]) {
      expect(codes(sectionOnly({ section_key: "opening", position: 1, kind: "text", required, heading: { ta: "x" } })))
        .toContain("section.required_not_boolean");
    }
  });

  it("refuses a section that says nothing: no heading, no reviewed wording, no host field", () => {
    expect(codes(sectionOnly({ section_key: "opening", position: 1, kind: "text", required: false })))
      .toContain("section.says_nothing");
  });

  it("does not call a heading-only section an empty one", () => {
    // The slot is named and has nothing to say under the name — a review would have caught it,
    // so it is a refusal, not a silent pass.
    expect(codes(sectionOnly({ section_key: "opening", position: 1, kind: "text", required: false, heading: { ta: "x" } })))
      .toEqual([]);
  });
});

describe("the rules about lists and host fields", () => {
  const withSections = (sections: Record<string, unknown>[]) => ({ sections });

  it("allows at most one people list, counted per kind", () => {
    // The shared-counter bug this pins: with one counter over both kinds, a release could
    // declare two people lists as long as it declared no event list. The renderer draws one
    // list of people, so that claim was about a rule that did not exist.
    expect(codes(withSections([
      { section_key: "family", position: 1, kind: "people_list", required: false },
      { section_key: "couple", position: 2, kind: "people_list", required: false },
      { section_key: "ceremonies", position: 3, kind: "event_list", required: false },
    ]))).toContain("section.second_people_list");
    expect(codes(withSections([
      { section_key: "family", position: 1, kind: "people_list", required: false },
      { section_key: "ceremonies", position: 2, kind: "event_list", required: false },
      { section_key: "venue", position: 3, kind: "event_list", required: false },
    ]))).toContain("section.second_event_list");
    // One of each kind is the shape a real invitation uses, and stays clean.
    expect(codes(withSections([
      { section_key: "family", position: 1, kind: "people_list", required: false },
      { section_key: "ceremonies", position: 2, kind: "event_list", required: false },
    ]))).toEqual([]);
  });

  it("refuses a list kind that reads a host field, and one that carries reviewed wording", () => {
    expect(codes(withSections([{ section_key: "family", position: 1, kind: "people_list", required: false, host_field: "welcome" }])))
      .toContain("list.host_field_forbidden");
    expect(codes(withSections([{ section_key: "ceremonies", position: 1, kind: "event_list", required: false, pack_text: { ta: "x" } }])))
      .toContain("pack_text.on_list_kind");
    // A list kind whose host_field is JSON null is not reading a host field.
    expect(codes(withSections([{ section_key: "family", position: 1, kind: "people_list", required: false, host_field: null }])))
      .toEqual([]);
  });

  it("refuses an unknown host field by name", () => {
    const issue = findIssue(withSections([{ section_key: "opening", position: 1, kind: "text", required: false, host_field: "father_name" }]), "host_field.unknown");
    expect(issue?.message).toContain("father_name");
  });

  it("refuses two sections reading the same host field", () => {
    expect(codes(withSections([
      { section_key: "opening", position: 1, kind: "text", required: false, host_field: "welcome" },
      { section_key: "closing", position: 2, kind: "text", required: false, host_field: "welcome" },
    ]))).toContain("host_field.duplicate");
  });
});

describe("the rules about language", () => {
  const withHeading = (heading: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    sections: [{ section_key: "opening", position: 1, kind: "text", required: false, heading, ...extra }],
  });

  it("refuses a fallback the release does not cover, which is directive §14's honesty rule", () => {
    // A pack covering Tamil alone cannot promise to fall back to an English it never declared.
    const issue = findIssue(
      withHeading({ ta: "x" }, { allow_english_fallback: true }),
      "fallback.language_not_covered",
      { languages: ["ta"] },
    );
    expect(issue?.path).toBe("sections[0].allow_english_fallback");
    expect(codes(withHeading({ ta: "x" }, { allow_english_fallback: true }))).toEqual([]);
  });

  it("refuses `allow_english_fallback` that is not a boolean", () => {
    expect(codes(withHeading({ ta: "x" }, { allow_english_fallback: "yes" }))).toContain("fallback.not_boolean");
  });

  it("refuses a language the release does not claim, in a heading and in pack text alike", () => {
    expect(codes(withHeading({ sa: "x" }))).toContain("heading.language_not_covered");
    expect(codes({ sections: [{ section_key: "opening", position: 1, kind: "text", required: false, pack_text: { sa: "x" } }] }))
      .toContain("pack_text.language_not_covered");
  });

  it("names the offending language in the path, so an editor can point at it", () => {
    expect(findIssue(withHeading({ sa: "x" }), "heading.language_not_covered")?.path).toBe("sections[0].heading.sa");
  });

  it("refuses a heading or pack text that is not an object of languages", () => {
    expect(codes(withHeading("x" as unknown as Record<string, unknown>))).toContain("heading.not_object");
    expect(codes({ sections: [{ section_key: "opening", position: 1, kind: "text", required: false, pack_text: ["x"] }] }))
      .toContain("pack_text.not_object");
  });

  it("refuses blank, non-string and over-long values, quoting the cap that fired", () => {
    for (const value of ["   ", 42, "x".repeat(161)]) {
      expect(codes(withHeading({ ta: value as unknown as string }))).toContain("heading.value_invalid");
    }
    expect(codes({ sections: [{ section_key: "opening", position: 1, kind: "text", required: false, pack_text: { ta: "x".repeat(4001) } }] }))
      .toContain("pack_text.value_invalid");
    // The cap is a length, so the exact maximum is legal.
    expect(codes(withHeading({ ta: "x".repeat(160) }))).toEqual([]);
  });
});

describe("the rules about the event vocabulary and design guidance", () => {
  const withVocabulary = (eventVocabulary: unknown) => ({ ...doc(), event_vocabulary: eventVocabulary });

  it("refuses an event vocabulary that is not an array, or longer than the cap", () => {
    expect(codes(withVocabulary("muhurtham"))).toContain("event_vocabulary.not_array");
    expect(codes(withVocabulary(Array.from({ length: 51 }, (_, i) => ({ event_key: `e${i}`, labels: { ta: "x" } })))))
      .toContain("event_vocabulary.too_many");
    expect(codes(withVocabulary(Array.from({ length: 50 }, (_, i) => ({ event_key: `e${i}`, labels: { ta: "x" } })))))
      .toEqual([]);
  });

  it("refuses an entry that is not an object or carries an extra key", () => {
    expect(codes(withVocabulary(["muhurtham"]))).toContain("event_vocabulary.entry_not_object");
    expect(codes(withVocabulary([{ event_key: "muhurtham", labels: { ta: "x" }, deity: "any" }])))
      .toContain("event_vocabulary.unknown_key");
  });

  it("refuses an event key that is not a slug, exactly as the database spells the pattern", () => {
    for (const eventKey of ["Muhurtham", "muhur tham", "_muhurtham", "1muhurtham", "", "x".repeat(41)]) {
      expect(codes(withVocabulary([{ event_key: eventKey, labels: { ta: "x" } }])))
        .toContain("event_vocabulary.event_key_not_slug");
    }
    expect(codes(withVocabulary([{ event_key: "muhurtham_day_1", labels: { ta: "x" } }])))
      .toEqual([]);
  });

  it("refuses labels that are unreadable or name an uncovered language", () => {
    expect(codes(withVocabulary([{ event_key: "muhurtham" }]))).toContain("event_vocabulary.labels_not_object");
    expect(codes(withVocabulary([{ event_key: "muhurtham", labels: { sa: "x" } }])))
      .toContain("event_vocabulary.language_not_covered");
    expect(codes(withVocabulary([{ event_key: "muhurtham", labels: {} }]))).toContain("event_vocabulary.labels_empty");
  });

  it("refuses design guidance that is not an object, carries an unknown key, or is out of range", () => {
    expect(codes({ ...doc(), design_guidance: "gold" })).toContain("design_guidance.not_object");
    expect(codes({ ...doc(), design_guidance: { lead_size: 28, font_family: "serif" } })).toContain("design_guidance.unknown_key");
    expect(codes({ ...doc(), design_guidance: { lead_size: 6 } })).toContain("design_guidance.out_of_range");
    expect(codes({ ...doc(), design_guidance: { lead_size: 73 } })).toContain("design_guidance.out_of_range");
    expect(codes({ ...doc(), design_guidance: { lead_size: "28" } })).toContain("design_guidance.out_of_range");
    expect(codes({ ...doc(), design_guidance: { motif_reference: "   " } })).toContain("design_guidance.out_of_range");
    expect(codes({ ...doc(), design_guidance: { motif_reference: "x".repeat(201) } })).toContain("design_guidance.out_of_range");
    // The ends of the range are inside it.
    expect(codes({ ...doc(), design_guidance: { lead_size: 8 } })).toEqual([]);
    expect(codes({ ...doc(), design_guidance: { lead_size: 72 } })).toEqual([]);
  });

  it("names which half of design guidance was out of range", () => {
    expect(findIssue({ ...doc(), design_guidance: { lead_size: 200 } }, "design_guidance.out_of_range")?.path)
      .toBe("design_guidance.lead_size");
    expect(findIssue({ ...doc(), design_guidance: { motif_reference: "x".repeat(300) } }, "design_guidance.out_of_range")?.path)
      .toBe("design_guidance.motif_reference");
  });
});

describe("what a refusal is allowed to look like", () => {
  it("reports every rule that fired at once, rather than the first one only", () => {
    // An author editing a document needs the whole list; a parser that returned the first
    // refusal would make them fix one fault, resubmit, and discover the next one there.
    const broken = doc();
    broken["ritual_authority"] = true;
    (broken.sections as Record<string, unknown>[])[0].position = 1;
    (broken.sections as Record<string, unknown>[])[1] = {
      section_key: "welcome", position: 1, kind: "text", required: "yes", host_field: "caste",
    };
    const found = codes(broken);
    expect(found).toContain("definition.unknown_key");
    expect(found).toContain("section.position_duplicate");
    expect(found).toContain("section.required_not_boolean");
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps every issue a stable code, a path inside the document, and one sentence", () => {
    const broken = doc();
    (broken.sections as Record<string, unknown>[])[2].kind = "event_list";
    broken["event_vocabulary"] = "no";
    const result = parse(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "section.second_event_list",
      "event_vocabulary.not_array",
    ]);
    for (const issue of result.issues) {
      expect(issue.code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      expect(issue.path).toMatch(/^(definition|definition_schema_version|sections|event_vocabulary|design_guidance)/);
      expect(issue.message.length).toBeGreaterThan(20);
      expect(issue.message).not.toContain("undefined");
      expect(issue.message).not.toContain("[object");
    }
  });

  it("never claims a definition is valid while carrying issues", () => {
    const result = parse({ sections: [{ section_key: "opening", position: 1, kind: "text", required: true }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.definition).toBeNull();
    expect(result.issues.map((i) => i.code)).toEqual(["section.says_nothing"]);
  });
});
