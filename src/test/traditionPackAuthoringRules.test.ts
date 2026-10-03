// Stage 5, client side: the version-2 authoring vocabulary, measured on the same rules the
// database enforces.
//
// Why these cases exist next to `supabase/tests/stage5/60_definition_vocabulary.sql`. The guard
// is the authority — an author cannot save a definition it refuses — but the editor is where a
// person finds out they made a mistake, and a mistake discovered only after a rejected write is
// a mistake attributed to the platform. So the client mirrors the guard clause for clause, and
// this file is what keeps the mirror from becoming a second opinion: each case names the
// declaration that is wrong, and each refusal is paired with the accepted form beside it, so a
// parser that simply rejects everything cannot pass.
//
// `scripts/check-db-contract.mjs` already proves the two *vocabularies* agree (the same names in
// both places). What it cannot compare is the shape rules — the ones about which combinations are
// meaningful — because those live inside a trigger body. This file is that other half.

import { describe, expect, it } from "vitest";

import { parseTraditionPackDefinition } from "@/lib/traditionPackDefinition";
import {
  PACK_OVERRIDE_RULES,
  PACK_SECTION_FIELD_KEYS,
  TRADITION_PACK_DEFINITION_SCHEMA_VERSION,
  TRADITION_PACK_DEFINITION_SCHEMA_VERSIONS,
} from "@/lib/traditionPackContract";

const languages = ["en", "ta"] as const;

const section = (over: Record<string, unknown> = {}) => ({
  section_key: "opening",
  position: 1,
  kind: "text",
  required: false,
  host_field: "welcome",
  override_rule: "host_may_replace",
  heading: { en: "Opening", ta: "தொடக்கம்" },
  pack_text: { en: "Wording.", ta: "வார்த்தைகள்." },
  ...over,
});

const definition = (...sections: Record<string, unknown>[]) => ({
  sections: sections.length > 0 ? sections : [section()],
});

const codes = (raw: unknown, schemaVersion = 2) =>
  parseTraditionPackDefinition(raw, languages, schemaVersion).issues.map((i) => i.code);

describe("the version-2 vocabulary this build claims", () => {
  it("names the two authoring rules in the section vocabulary the guard accepts", () => {
    // If either name disappears from the client list, an author's correct definition is refused
    // by the browser before the database ever sees it — and the contract checker is what normally
    // says so, but only because this list is compared. Asserting the pair here keeps the reason
    // in the test that uses it.
    expect(PACK_SECTION_FIELD_KEYS).toContain("override_rule");
    expect(PACK_SECTION_FIELD_KEYS).toContain("requires_venue");
    expect([...PACK_OVERRIDE_RULES].sort()).toEqual(
      ["host_may_replace", "host_must_supply", "pack_only"].sort(),
    );
  });

  it("authors at the newest version and reads every version it claims to", () => {
    expect(TRADITION_PACK_DEFINITION_SCHEMA_VERSIONS).toContain(
      TRADITION_PACK_DEFINITION_SCHEMA_VERSION,
    );
    expect(TRADITION_PACK_DEFINITION_SCHEMA_VERSION).toBe(2);
    expect([...TRADITION_PACK_DEFINITION_SCHEMA_VERSIONS].sort()).toEqual([1, 2]);
  });
});

describe("the declarations the version-2 contract refuses", () => {
  for (const [label, raw, code] of [
    ["an override rule between the three", definition(section({ override_rule: "host_maybe" })),
      "override_rule.unknown"],
    ["an override rule as a boolean", definition(section({ override_rule: true })),
      "override_rule.unknown"],
    ["an override rule on a list section",
      definition({ section_key: "family", position: 1, kind: "people_list", required: false,
        override_rule: "host_may_replace" }),
      "override_rule.on_list_section"],
    ["host_must_supply beside offered wording",
      definition(section({ override_rule: "host_must_supply" })),
      "override_rule.host_must_supply_offers_text"],
    ["host_must_supply that nobody could supply",
      definition({ section_key: "opening", position: 1, kind: "text", required: true,
        override_rule: "host_must_supply", heading: { en: "Opening" } }),
      "override_rule.host_must_supply_unfillable"],
    ["pack_only with nothing reviewed to show",
      definition({ section_key: "opening", position: 1, kind: "text", required: true,
        override_rule: "pack_only", heading: { en: "Opening" } }),
      "override_rule.pack_only_without_text"],
    ["requires_venue on a prose section", definition(section({ requires_venue: true })),
      "requires_venue.on_non_event_list"],
    ["requires_venue spelled as a string", definition(section({ requires_venue: "yes" })),
      "requires_venue.not_boolean"],
  ] as const) {
    it(`refuses ${label}`, () => {
      expect(codes(raw)).toContain(code);
    });
  }

  it("refuses the two version-2 fields on a release claiming version 1", () => {
    // The asymmetry is the compatibility rule, so both fields are checked: permitting one and
    // refusing the other would let a release claim the old contract while depending on half of
    // the new one.
    expect(codes(definition(section({ override_rule: "pack_only",
      pack_text: { en: "Reviewed." } })), 1)).toContain("section.v2_key_on_v1_definition");
    expect(codes(definition({ section_key: "ceremonies", position: 1, kind: "event_list",
      required: true, requires_venue: true, heading: { en: "Events" } }), 1))
      .toContain("section.v2_key_on_v1_definition");
  });
});

describe("the declarations it accepts, one per rule", () => {
  it("accepts each override rule in the shape that rule requires", () => {
    const cases = [
      definition(section({ override_rule: "host_may_replace" })),
      definition({ section_key: "opening", position: 1, kind: "text", required: true,
        override_rule: "pack_only", heading: { en: "Opening" },
        pack_text: { en: "Reviewed wording." } }),
      definition({ section_key: "opening", position: 1, kind: "text", required: true,
        override_rule: "host_must_supply", host_field: "welcome",
        heading: { en: "Opening" } }),
      definition({ section_key: "ceremonies", position: 1, kind: "event_list", required: true,
        requires_venue: true, heading: { en: "Events" } }),
    ];
    for (const raw of cases) expect(codes(raw)).toEqual([]);
  });

  it("accepts all three rules in one release, which is what a real candidate looks like", () => {
    expect(codes(definition(
      section({ section_key: "opening", position: 1, override_rule: "host_may_replace" }),
      { section_key: "blessing", position: 2, kind: "text", required: true,
        override_rule: "pack_only", heading: { en: "Blessing" },
        pack_text: { en: "Stays reviewed." } },
      { section_key: "event_notes", position: 3, kind: "text", required: false,
        override_rule: "host_must_supply", host_field: "event_notes",
        heading: { en: "Note" } },
    ))).toEqual([]);
  });

  it("leaves a pack_only section that also names a host field alone, because the field is real", () => {
    // The document has to be able to report that the host's words were not used, and it can only
    // do that if the field is allowed to exist.
    expect(codes(definition({ section_key: "blessing", position: 1, kind: "text", required: true,
      override_rule: "pack_only", host_field: "family_introduction",
      heading: { en: "Blessing" }, pack_text: { en: "Reviewed." } }))).toEqual([]);
  });

  it("says nothing about a version-1 document that claimed no new field", () => {
    // The forward-compatibility control: the same parser, the older claim, no new-code fired.
    // Without this, every check below could be passing because the version gate is inert.
    expect(codes({ sections: [{ section_key: "opening", position: 1, kind: "text",
      required: false, host_field: "welcome", heading: { en: "Opening" },
      pack_text: { en: "Wording." } }] }, 1)).toEqual([]);
  });
});
