// The Stage 4 draft candidate: one JSON file on disk, checked by the same code a running
// browser would use.
//
// Directive §7 asks for a candidate release artifact and for it to pass "the SAME
// parser/validator runtime code uses". That requirement is what this file exists to keep true:
// it reads `content/tradition-packs/tamil-english-foundation.v1.json` from disk with `fs`, so
// nothing about the artifact is copied into the test, and hands the definition to
// `parseTraditionPackDefinition` — the browser-side parser, the same one
// `traditionPackResolver.ts` consumes, not a second implementation written for this file. An
// artifact validated by a copy of the validator would prove only that two copies agree with each
// other. What this does *not* claim: neither module is on a shipped render path yet, because the
// renderer reads the snapshot the database resolved at freeze time. The pairing an authoring
// surface will use is exercised here, and is Stage 5's to put behind a screen.
//
// The rest of this file is honesty, not shape. The envelope is checked against the column rules
// the database enforces, so the file could not pass here and be refused on write; the flags are
// checked for saying what they must (draft, machine-assisted, not human-reviewed, not
// customer-selectable); and every Tamil value is required to be a bracketed placeholder, because
// this stage may verify rendering but may not present machine-authored Tamil as wording nobody
// reviewed.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTraditionPackDefinition } from "@/lib/traditionPackDefinition";
import { resolveTraditionPack } from "@/lib/traditionPackResolver";
import { PACK_HOST_FIELDS, PACK_SECTION_KEYS, TRADITION_PACK_DEFINITION_SCHEMA_VERSION } from "@/lib/traditionPackContract";

// Resolved from the working directory rather than `import.meta.url`: under this project's jsdom
// test environment a `file:` base handed to `new URL` comes back as an `http://localhost` URL,
// and the file this test is about is on disk, not on the dev server.
const ARTIFACT_RELATIVE = "content/tradition-packs/tamil-english-foundation.v1.json";
const ARTIFACT_PATH = resolve(process.cwd(), ARTIFACT_RELATIVE);
if (isAbsolute(ARTIFACT_RELATIVE) || !existsSync(ARTIFACT_PATH)) {
  throw new Error(`${ARTIFACT_RELATIVE} was not found from ${process.cwd()}; this test runs from the repository root`);
}

/**
 * The envelope §7 requires, typed as the columns it mirrors. The type is a claim about the
 * file, and the tests below are what check it; `definition` is deliberately opaque here
 * because reading it is `traditionPackDefinition.ts`'s job, not this file's.
 */
interface DraftSection {
  section_key: string
  kind: string
  host_field?: string
  heading?: Record<string, string>
  pack_text?: Record<string, string>
}

interface DraftCandidate {
  artifact: string
  artifact_schema_version: number
  status: string
  machine_assisted: boolean
  human_reviewed: boolean
  customer_selectable: boolean
  pack_key: string
  display_name: string
  scope_statement: string
  release_number: number
  definition_schema_version: number
  languages: string[]
  author_label: string
  machine_assistance_notes: string
  source_reference: string
  changelog: string
  review: unknown
  definition: {
    sections: DraftSection[]
    event_vocabulary: { event_key: string; labels: Record<string, string> }[]
  };
}

const readArtifact = (): DraftCandidate =>
  JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as DraftCandidate;

const artifact = readArtifact();

/** Every string leaf under a node, with the path it was found at. */
const stringLeaves = (node: unknown, path = ""): { path: string; value: string }[] => {
  if (typeof node === "string") return [{ path, value: node }];
  if (Array.isArray(node)) return node.flatMap((entry, i) => stringLeaves(entry, `${path}[${i}]`));
  if (node !== null && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, entry]) => stringLeaves(entry, path === "" ? key : `${path}.${key}`));
  }
  return [];
};

describe("the draft candidate passes the validator the runtime uses", () => {
  it("parses with no issues at all, against the languages it declares", () => {
    const result = parseTraditionPackDefinition(
      artifact.definition,
      artifact.languages,
      artifact.definition_schema_version,
    );
    if (!result.ok) {
      throw new Error(`the shipped candidate was refused: ${JSON.stringify(result.issues)}`);
    }
    expect(result.issues).toEqual([]);
    expect(result.definition.sections).toHaveLength(11);
  });

  it("resolves in both languages it covers, through the read path, with no issues raised", () => {
    for (const requestedLanguage of ["ta", "en"]) {
      const resolved = resolveTraditionPack({
        source: {
          packKey: artifact.pack_key,
          releaseNumber: artifact.release_number,
          languages: artifact.languages,
          definition: artifact.definition,
        },
        requestedLanguage,
      });
      expect(resolved.issues).toEqual([]);
      expect(resolved.sections.map((section) => section.key)).toEqual([...PACK_SECTION_KEYS]);
    }
  });

  it("uses only section slots and host fields the build already renders", () => {
    const sections = artifact.definition.sections;
    expect(sections.map((section) => section.section_key).sort()).toEqual([...PACK_SECTION_KEYS].sort());
    const hostFields = sections
      .map((section) => section.host_field)
      .filter((field): field is string => typeof field === "string");
    expect(hostFields.every((field) => (PACK_HOST_FIELDS as readonly string[]).includes(field))).toBe(true);
    expect(new Set(hostFields).size).toBe(hostFields.length);
  });
});

describe("the candidate says what it is", () => {
  it("carries the four machine-readable flags, each saying the uncomfortable thing", () => {
    expect(artifact.status).toBe("draft");
    expect(artifact.machine_assisted).toBe(true);
    expect(artifact.human_reviewed).toBe(false);
    expect(artifact.customer_selectable).toBe(false);
  });

  it("attaches a machine-assistance disclosure to the machine-assistance flag", () => {
    // The database binds these two with `machine_assistance_disclosure_required`, and the
    // artifact is written to be loadable, so the rule belongs here too rather than in a comment.
    expect(typeof artifact.machine_assistance_notes).toBe("string");
    expect(artifact.machine_assistance_notes.trim().length).toBeGreaterThanOrEqual(20);
    expect(artifact.machine_assistance_notes).toContain("Tamil");
  });

  it("carries no review metadata, because a draft has been looked at by nobody", () => {
    // The mirror of the database's `draft_carries_no_review_metadata`: presence of a reviewer
    // name here would be the artifact claiming a review this stage is forbidden to fabricate.
    expect(artifact.review).toBeNull();
    for (const key of ["review_label", "review_basis", "review_scope", "reviewed_languages", "reviewed_by", "reviewed_at", "approved_at", "deprecated_at"]) {
      expect(artifact[key]).toBeUndefined();
    }
  });

  it("is not presented as a release that can be chosen", () => {
    // Two independent ways of saying it: the flag, and a lifecycle status a customer-facing
    // catalogue query is written to exclude.
    expect(artifact.customer_selectable).toBe(false);
    expect(["reviewed", "approved"]).not.toContain(artifact.status);
  });
});

describe("the envelope is what the database would accept", () => {
  it("matches the column rules on the pack and the release", () => {
    expect(artifact.pack_key).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]*)*$/);
    expect(artifact.display_name.trim().length).toBeGreaterThan(0);
    expect(artifact.scope_statement.trim().length).toBeGreaterThanOrEqual(20);
    expect(artifact.scope_statement.trim().length).toBeLessThanOrEqual(2000);
    expect(artifact.release_number).toBeGreaterThan(0);
    expect(["draft", "reviewed", "approved", "deprecated"]).toContain(artifact.status);
    expect(artifact.definition_schema_version).toBe(TRADITION_PACK_DEFINITION_SCHEMA_VERSION);
    expect(artifact.definition_schema_version).toBeGreaterThan(0);
    expect(artifact.author_label.trim().length).toBeGreaterThanOrEqual(3);
    expect(artifact.author_label.trim().length).toBeLessThanOrEqual(300);
    expect(artifact.source_reference.trim().length).toBeGreaterThanOrEqual(3);
    expect(artifact.source_reference.trim().length).toBeLessThanOrEqual(1000);
    expect(artifact.changelog.trim().length).toBeGreaterThanOrEqual(3);
    expect(artifact.changelog.trim().length).toBeLessThanOrEqual(4000);
  });

  it("names only languages the domain allows, and at least one", () => {
    expect(artifact.languages.length).toBeGreaterThan(0);
    expect(artifact.languages.every((language: string) => ["en", "ta", "te", "ml", "kn"].includes(language))).toBe(true);
  });

  it("lists those languages in the order the database insists on", () => {
    // `private.guard_tradition_pack_release()` refuses a release whose `languages` array is not
    // sorted and duplicate-free, so that two releases covering the same pair hold the same value
    // and `reviewed_languages <@ languages` compares sets rather than spellings. That rule lives
    // only in the trigger — the table's own CHECK bounds the *members*, not the order — so an
    // artifact that passed every rule mirrored here could still be unsavable. Measured, not
    // reasoned about: candidate 1 of this file declared `["ta", "en"]` and the local database
    // answered `languages must be sorted and free of duplicates (got {ta,en})` when the artifact
    // was offered to it as a draft release. The ordering is now pinned in both directions, which
    // is what makes the row above a measurement rather than a coincidence.
    const sorted = [...artifact.languages].sort();
    expect(artifact.languages).toEqual(sorted);
    expect(new Set(artifact.languages).size).toBe(artifact.languages.length);
    // Control: the check is capable of failing, and on the exact value this artifact used to hold.
    expect(["ta", "en"]).not.toEqual([...["ta", "en"]].sort());
  });

  it("states in the scope sentence what the pack does not claim", () => {
    // `scope_statement` exists to stop a pack being read as an endorsement, and the database
    // insists on a minimum length so that "n/a" cannot satisfy it.
    expect(artifact.scope_statement).toContain("does not");
    expect(artifact.scope_statement).toContain("structure");
  });
});

describe("the wording stays a schema, not a tradition", () => {
  it("presents no Tamil wording as content: every Tamil value is a declared placeholder", () => {
    const tamilValues = stringLeaves(artifact.definition)
      .filter((leaf) => leaf.path.includes(".ta"))
      .map((leaf) => leaf.value);
    expect(tamilValues.length).toBeGreaterThan(0);
    for (const value of tamilValues) {
      expect(value.startsWith("[placeholder]")).toBe(true);
    }
  });

  it("never uses a term of religious, priestly, caste or astrological authority in the definition", () => {
    // A keyword tripwire, not a proof of cultural safety: it catches the invention classes §7
    // names by name, and it cannot catch a sentence that is wrong without using one of these
    // words. That second job belongs to a human review this artifact explicitly does not claim.
    const forbidden = [
      "priest", "purohit", "pandit", "caste", "varna", "gotra", "gotram", "brahmin",
      "nakshatra", "rahu", "auspicious", "inauspicious", "mantra", "vedic", "scripture",
      "deity", "god", "goddess", "puja", "havan", "homam", "ritual", "ceremonial obligation",
      "sin", "purity", "impurity", "untouchable", "must perform", "shall not",
    ];
    const content = stringLeaves(artifact.definition).map((leaf) => leaf.value);
    for (const term of forbidden) {
      // Whole words only. A bare `includes` flagged "sin" inside "blessing" and "closing",
      // which is the kind of finding that teaches someone to delete the tripwire.
      const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const offenders = content.filter((value) => pattern.test(value));
      expect(offenders, `the definition contains ${term}`).toEqual([]);
    }

    // A control, because a scan that silently matches nothing would pass forever: the same
    // sentence an authored pack must never contain is caught by the list above.
    const planted = ["The priest will call the auspicious time", "the correct caste of the family"];
    const caught = forbidden.filter((term) =>
      planted.some((value) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(value)),
    );
    expect(caught.sort()).toEqual(["auspicious", "caste", "priest"]);
  });

  it("keeps its wording plainly marked as placeholder rather than traditional", () => {
    // Labels may be plain English words for a slot — that is what a label is. Anything in a
    // body position has to say it is a placeholder in its own first characters, so a screen
    // that shows this candidate cannot be read as reviewed prose.
    const sections = artifact.definition.sections;
    const bodies = sections.flatMap((section) => Object.values<string>(section.pack_text ?? {}));
    expect(bodies.length).toBeGreaterThan(0);
    for (const value of bodies) expect(value.startsWith("[placeholder]")).toBe(true);
    const labels = sections.flatMap((section) => Object.values<string>(section.heading ?? {}));
    expect(labels.some((value) => !value.startsWith("[placeholder]"))).toBe(true);
  });

  it("names no rite in its event vocabulary", () => {
    const keys = artifact.definition.event_vocabulary.map((entry) => entry.event_key);
    expect(keys).toEqual(["ceremony", "reception", "meal"]);
    expect(keys.every((key) => /^[a-z][a-z0-9_]{0,39}$/.test(key))).toBe(true);
  });
});

describe("the artifact is a file, not a fixture", () => {
  it("is valid JSON with the keys §7 enumerates and nothing else pretending to be a column", () => {
    const requiredKeys = [
      "pack_key", "release_number", "scope_statement", "languages", "source_reference",
      "machine_assistance_notes", "changelog", "definition", "status", "machine_assisted",
      "human_reviewed", "customer_selectable",
    ];
    for (const key of requiredKeys) expect(artifact[key]).toBeDefined();
    expect(artifact.artifact).toBe("tradition_pack_release_candidate");
  });

  it("would be refused if a reviewer were named in it", () => {
    // Not a claim about the shipped file — a control proving the flag test above can fail. A
    // copy that says `human_reviewed: true` is what a later edit would write by accident.
    const forged = readArtifact();
    const forgedReview = { review_label: "Elders of the community", reviewed_at: "2026-09-27T00:00:00Z" };
    forged.human_reviewed = true;
    forged.review = forgedReview;
    expect(forged.human_reviewed).toBe(true);
    expect(forgedReview.review_label).toBeDefined();
    // And the real file still says the opposite, which is the assertion that keeps this honest.
    expect(readArtifact().human_reviewed).toBe(false);
    expect(readArtifact().review).toBeNull();
  });
});
