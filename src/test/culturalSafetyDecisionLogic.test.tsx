// §24 asks a question a text rule cannot answer. The checker in
// `scripts/check-product-contract.mjs` refuses the *shapes* that would derive a pack from a
// host's identity; what it cannot show is that the decision this application actually makes is
// invariant. So this file runs the decision itself — the adapter the picker calls, the answer
// the picker displays, and the resolver that turns a chosen release into wording — against
// three profiles that differ on every axis §24 names, and asks its two questions:
//
//   * With nothing selected on the wedding, all three profiles are answered "No tradition
//     pack". Not an empty pack and not a failure: the same option the platform shows anybody
//     who decided to write everything themselves.
//   * With an explicit selection, all three profiles get the same release, out of the same
//     queries. The names, the language columns and the address are planned and readable, and
//     the decision does not touch one of them.
//
// Language is the axis §24 draws a line under, and the line is real here: a wedding's own
// language legitimately picks *which wording of the release the host already owns* is drawn,
// and it never picks the release. The resolver cases below therefore assert both halves — the
// wording and the fallback receipt differ per profile, the release identity and the section
// list do not.
//
// No demographic branch is invented here in order to be refused. `venues` and
// `wedding_people` are planned so that a read of an address or a display name would show up as
// a query this test saw, and the assertion is that no such query happens.

import { describe, expect, it, vi } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import {
  emptyResult,
  planQueries,
  queriedTables,
  recordedSteps,
  rowReturned,
  type FakeStep,
} from "@/test/fakeSupabase";
import type { Database } from "@/integrations/supabase/types";
import type { HostFieldText, TraditionPackSource } from "@/lib/traditionPackResolver";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { supabase: fakeSupabase };
});

import TraditionPackPanel from "@/components/invitation/TraditionPackPanel";
import { getSelectedTraditionRelease } from "@/integrations/supabase/traditionReleases";
import { resolveTraditionPack } from "@/lib/traditionPackResolver";

type WeddingRow = Database["public"]["Tables"]["weddings"]["Row"];
type VenueRow = Database["public"]["Tables"]["venues"]["Row"];
type PersonRow = Database["public"]["Tables"]["wedding_people"]["Row"];
type ReleaseRow = Database["public"]["Tables"]["tradition_pack_releases"]["Row"];
type PackRow = Database["public"]["Tables"]["tradition_packs"]["Row"];

const PACK = "44444444-4444-4444-8444-444444444444";
const RELEASE = "55555555-5555-4555-8555-555555555555";
const STAMP = "2026-09-27T09:00:00+00:00";
const PACK_KEY = "tamil-english-foundation";

/** The value `TraditionPackPanel` uses for "write it yourself". The host-visible half of the
 *  assertion below is that option's own label, so this literal is not holding up the test. */
const NO_PACK = "none";

/** One release, one definition: everything below varies the *host*, never the pack.
 *
 *  Three sections, chosen so the three languages land on three different receipts inside the
 *  same release. `opening` permits the English fallback, so it can show a fallback *and* a
 *  direct read of the same wording. `blessing` is Tamil-only with no fallback, so a language
 *  the release does not cover has to come back as a named gap rather than as a guess.
 *  `welcome` reads a host field, which is where the couple's own names arrive. */
const DEFINITION = [
  {
    section_key: "opening",
    position: 1,
    kind: "text",
    required: true,
    heading: { ta: "அழைப்பு", en: "Invitation" },
    pack_text: { ta: "மங்கல நாள்", en: "An auspicious day" },
    allow_english_fallback: true,
  },
  {
    section_key: "welcome",
    position: 2,
    kind: "text",
    required: false,
    host_field: "welcome",
    heading: { ta: "அழைக்கிறார்கள்", en: "invite you" },
    allow_english_fallback: true,
  },
  { section_key: "family", position: 3, kind: "people_list", required: true },
  {
    section_key: "blessing",
    position: 4,
    kind: "text",
    required: false,
    heading: { ta: "ஆசி" },
  },
];

const wedding = (
  row: Pick<
    WeddingRow,
    "id" | "owner_user_id" | "title" | "primary_language" | "additional_languages"
  >,
): WeddingRow => ({
  created_at: STAMP,
  updated_at: STAMP,
  design_template_id: null,
  estimated_guest_count: 180,
  lifecycle_status: "draft",
  style_settings: {},
  tradition_pack_release_id: null,
  ...row,
});

const venue = (
  id: string,
  weddingId: string,
  name: string,
  addressText: string,
  latitude: number,
  longitude: number,
): VenueRow => ({
  id,
  wedding_id: weddingId,
  name,
  address_text: addressText,
  latitude,
  longitude,
  map_url: null,
  notes: null,
  created_at: STAMP,
  updated_at: STAMP,
});

const person = (
  id: string,
  weddingId: string,
  displayName: string,
  roleKey: string,
  displayOrder: number,
): PersonRow => ({
  id,
  wedding_id: weddingId,
  display_name: displayName,
  display_order: displayOrder,
  group_key: null,
  group_label: null,
  role_key: roleKey,
  role_label: null,
  created_at: STAMP,
  updated_at: STAMP,
});

const packRow = (): PackRow => ({
  id: PACK,
  pack_key: PACK_KEY,
  display_name: "Tamil + English foundation",
  scope_statement: "Structural wording sections only; no ritual instruction.",
  created_at: STAMP,
  updated_at: STAMP,
});

const releaseRow = (): ReleaseRow => ({
  id: RELEASE,
  pack_id: PACK,
  release_number: 1,
  languages: ["ta", "en"],
  status: "approved",
  definition: { sections: DEFINITION },
  definition_schema_version: 1,
  reviewed_by: null,
  reviewed_at: null,
  reviewed_languages: null,
  review_label: null,
  review_basis: null,
  review_scope: null,
  review_packet_hash: null,
  approved_at: STAMP,
  deprecated_at: null,
  author_label: "Automated draft candidate assembly",
  machine_assisted: true,
  machine_assistance_notes: "Assembled from the machine-readable draft candidate.",
  source_reference: "content/tradition-packs/tamil-english-foundation.v1.json",
  changelog: null,
  created_at: STAMP,
  updated_at: STAMP,
});

interface Profile {
  readonly label: string;
  readonly wedding: WeddingRow;
  readonly venues: VenueRow[];
  readonly people: PersonRow[];
  readonly hostFields: HostFieldText;
}

const WEDDING_A = "33333333-3333-4333-8333-333333333333";
const WEDDING_B = "3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
const WEDDING_C = "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c";

const PROFILES: Profile[] = [
  {
    label: "Tamil-speaking, Madurai",
    wedding: wedding({
      id: WEDDING_A,
      owner_user_id: "11111111-1111-4111-8111-111111111111",
      title: "Anaya Krishnan & Karthik Raman",
      primary_language: "ta",
      additional_languages: ["en"],
    }),
    venues: [
      venue("7a000000-0000-4000-8000-000000000001", WEDDING_A, "Aan Mahal",
        "Madurai, Tamil Nadu 625001", 9.9252, 78.1198),
    ],
    people: [
      person("7b000000-0000-4000-8000-000000000001", WEDDING_A, "Anaya Krishnan", "partner_one", 1),
      person("7b000000-0000-4000-8000-000000000002", WEDDING_A, "Karthik Raman", "partner_two", 2),
    ],
    hostFields: { welcome: "Anaya Krishnan and Karthik Raman" },
  },
  {
    label: "Urdu-speaking, Hyderabad",
    wedding: wedding({
      id: WEDDING_B,
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      title: "Imraan Sheikh & Nikhil Rao",
      primary_language: "ur",
      additional_languages: ["hi", "en"],
    }),
    venues: [
      venue("7a000000-0000-4000-8000-000000000002", WEDDING_B, "Tank Bund Banquet",
        "Hyderabad, Telangana 500001", 17.385, 78.4867),
    ],
    people: [
      person("7b000000-0000-4000-8000-000000000003", WEDDING_B, "Imraan Sheikh", "partner_one", 1),
      person("7b000000-0000-4000-8000-000000000004", WEDDING_B, "Nikhil Rao", "partner_two", 2),
    ],
    hostFields: { welcome: "Imraan Sheikh and Nikhil Rao" },
  },
  {
    label: "English-speaking, Leeds",
    wedding: wedding({
      id: WEDDING_C,
      owner_user_id: "44444444-4444-4444-8444-444444444445",
      title: "Meghana Iyer & Sara Whitfield",
      primary_language: "en",
      additional_languages: ["ta"],
    }),
    venues: [
      venue("7a000000-0000-4000-8000-000000000003", WEDDING_C, "Great George Hall",
        "Leeds, West Yorkshire LS1 1RR", 53.7965, -1.5463),
    ],
    people: [
      person("7b000000-0000-4000-8000-000000000005", WEDDING_C, "Meghana Iyer", "partner_one", 1),
      person("7b000000-0000-4000-8000-000000000006", WEDDING_C, "Sara Whitfield", "partner_two", 2),
    ],
    hostFields: { welcome: "Meghana Iyer and Sara Whitfield" },
  },
];

/** The columns that carry identity in the three tables that store it, named the way this
 *  database names them. `display_name` on `tradition_packs` is the *pack's* name and is
 *  deliberately absent: this list is about the host's data. */
const IDENTITY_COLUMNS: Record<string, readonly string[]> = {
  weddings: ["title", "primary_language", "additional_languages"],
  wedding_people: ["display_name", "role_key", "role_label", "group_label"],
  venues: ["name", "address_text", "latitude", "longitude"],
};

const FILTER_METHODS = ["eq", "in", "like", "ilike", "is", "order", "gt", "gte", "lt", "lte", "not"];

/** Every column name one step put on the wire: in a select list, as the column a filter or an
 *  ordering was placed on, or as a key of a write payload. */
const columnsOf = (step: FakeStep): string[] => {
  if (step.method === "select") {
    return String(step.args[0]).split(",").map((name) => name.trim());
  }
  if (FILTER_METHODS.includes(step.method)) return [String(step.args[0])];
  if (step.method === "update" || step.method === "insert") {
    return Object.keys((step.args[0] ?? {}) as Record<string, unknown>);
  }
  return [];
};

const columnsUsed = (steps: FakeStep[]): string[] => steps.flatMap(columnsOf);

/** `table.column` for every identity column this set of steps touched. */
const identityColumnsTouched = (steps: FakeStep[]): string[] =>
  steps
    .flatMap((step) => {
      const banned = IDENTITY_COLUMNS[step.table];
      if (banned === undefined) return [];
      return columnsOf(step).filter((name) => banned.includes(name)).map((name) => `${step.table}.${name}`);
    })
    .sort();

/** The queries as text, with only the two ids this caller owns masked out — so two profiles can
 *  be compared for "the same question" without their own primary keys defeating the check. */
const signature = (profile: Profile, steps: FakeStep[]): string[] =>
  steps.map((step) => {
    const args = step.args.map((arg) => {
      const raw = typeof arg === "object" && arg !== null ? JSON.stringify(arg) : String(arg);
      return raw
        .split(profile.wedding.owner_user_id)
        .join("<owner>")
        .split(profile.wedding.id)
        .join("<wedding>");
    });
    return `${step.table}.${step.method}(${args.join(",")})`;
  });

/** Ask the real adapter for this profile's answer, with every identity-bearing row planned and
 *  readable: a layer that wanted a name, an address or a language column could have had one. */
const askAdapter = async (profile: Profile, releaseId: string | null) => {
  planQueries({
    weddings: [rowReturned({ ...profile.wedding, tradition_pack_release_id: releaseId })],
    tradition_pack_releases: [rowReturned(releaseRow())],
    tradition_packs: [rowReturned(packRow())],
    venues: profile.venues.map(() => emptyResult()),
    wedding_people: profile.people.map(() => emptyResult()),
  });
  const result = await getSelectedTraditionRelease(
    profile.wedding.owner_user_id,
    profile.wedding.id,
  );
  return { result, steps: recordedSteps() };
};

const mountPicker = async (profile: Profile, releaseId: string | null) => {
  planQueries({
    tradition_packs: [rowReturned([packRow()]), rowReturned(packRow())],
    tradition_pack_releases: [rowReturned([releaseRow()]), rowReturned(releaseRow())],
    weddings: [rowReturned({ ...profile.wedding, tradition_pack_release_id: releaseId })],
    venues: profile.venues.map(() => emptyResult()),
    wedding_people: profile.people.map(() => emptyResult()),
  });
  const view = render(
    <TraditionPackPanel
      userId={profile.wedding.owner_user_id}
      weddingId={profile.wedding.id}
      suppliedSlotLabels={[]}
      onSelectionChanged={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(within(view.container).queryByRole("radio", { name: /^No tradition pack/ })).toBeTruthy(),
  );
  return view;
};

/** Which option the host is actually shown as chosen — the decision result, not the internal
 *  value that produced it. */
const shownAsChosen = (container: HTMLElement): string[] =>
  within(container)
    .getAllByRole("radio")
    .filter((radio) => (radio as HTMLInputElement).checked)
    .map((radio) => (radio as HTMLInputElement).value);

const pinnedSource = (): TraditionPackSource => ({
  packKey: PACK_KEY,
  releaseNumber: 1,
  languages: ["ta", "en"],
  definition: { sections: DEFINITION },
});

/** Resolve one section of the host's own release, in the language this profile's wedding
 *  records — which is how the snapshot builder asks (`COALESCE(primary_language, 'en')`). */
const sectionOf = (profile: Profile, key: string, source: TraditionPackSource | null) => {
  const resolved = resolveTraditionPack({
    source,
    requestedLanguage: profile.wedding.primary_language ?? "en",
    hostFields: profile.hostFields,
  });
  return { resolved, section: resolved.sections.find((entry) => entry.key === key) };
};

describe("the pack decision over three unlike profiles", () => {
  it("answers No tradition pack for every profile when nothing has been selected", async () => {
    for (const profile of PROFILES) {
      const { result, steps } = await askAdapter(profile, null);
      expect(result, profile.label).toEqual({ data: null, error: null });
      // The wedding row is the only table read: with nothing chosen there is no pack to look
      // up, so any other read here would be a pack arriving from somewhere the host never
      // pointed at.
      expect(queriedTables(), profile.label).toEqual(["weddings"]);
      expect(identityColumnsTouched(steps), profile.label).toEqual([]);

      const view = await mountPicker(profile, null);
      const noPack = within(view.container).getByRole("radio", {
        name: /^No tradition pack — write it yourself/,
      }) as HTMLInputElement;
      expect(shownAsChosen(view.container), profile.label).toEqual([NO_PACK]);
      expect(noPack).toBeChecked();
      view.unmount();
    }
  });

  it("resolves to no wording source at all for every profile when nothing has been selected", () => {
    // The same answer one layer down: nothing to resolve, so no section and no issue invented to
    // explain an empty choice — in any of the three languages.
    for (const profile of PROFILES) {
      const resolved = resolveTraditionPack({
        source: null,
        requestedLanguage: profile.wedding.primary_language ?? "en",
        hostFields: profile.hostFields,
      });
      expect(resolved, profile.label).toEqual({ sections: [], issues: [], release: null });
    }
  });

  it("keeps one chosen release the answer for all three profiles, from identical queries", async () => {
    const decisions: unknown[] = [];
    const signatures: string[][] = [];
    for (const profile of PROFILES) {
      const { result, steps } = await askAdapter(profile, RELEASE);
      expect(result.error, profile.label).toBeNull();
      decisions.push(result.data);
      signatures.push(signature(profile, steps));
      expect(identityColumnsTouched(steps), profile.label).toEqual([]);

      const view = await mountPicker(profile, RELEASE);
      expect(shownAsChosen(view.container), profile.label).toEqual([RELEASE]);
      expect(
        within(view.container).getByRole("radio", { name: /Tamil \+ English foundation/ }),
      ).toBeChecked();
      view.unmount();
    }

    // One answer three times over, out of one question three times over. That is §24's second
    // sentence: the selection is the host's, so the identity around it is not an input to it.
    expect(decisions[1]).toEqual(decisions[0]);
    expect(decisions[2]).toEqual(decisions[0]);
    expect(signatures[1]).toEqual(signatures[0]);
    expect(signatures[2]).toEqual(signatures[0]);
    expect(decisions[0]).toMatchObject({
      id: RELEASE,
      packKey: PACK_KEY,
      releaseNumber: 1,
      retired: false,
    });
  });

  it("reads no name, address or language column on the way to either answer", async () => {
    const runs: FakeStep[][] = [];
    for (const profile of PROFILES) {
      runs.push((await askAdapter(profile, null)).steps);
      runs.push((await askAdapter(profile, RELEASE)).steps);
    }
    expect(runs.flatMap(identityColumnsTouched)).toEqual([]);
    // Control: the scan is not looking for names that could never have appeared. The tables it
    // did read are known, the release-side `languages` column is one it legitimately asked for,
    // and the identity columns it must not ask for are the ones the planned rows carry.
    const readTables = new Set(runs.flat().map((step) => step.table));
    expect(readTables).toEqual(new Set(["weddings", "tradition_pack_releases", "tradition_packs"]));
    expect(columnsUsed(runs.flat())).toContain("languages");
    expect(columnsUsed(runs.flat())).toContain("tradition_pack_release_id");
    expect(PROFILES[0].wedding.title).toContain("Krishnan");
    expect(PROFILES[0].venues[0].address_text).toContain("Madurai");
  });
});

describe("language inside a release the host already owns", () => {
  it("draws different wording of the same release for the three profiles' languages", () => {
    // The distinction §24 makes explicit. `ta` reads the release's Tamil line; `ur` is not a
    // language the release covers, so it arrives at the English line *with the fallback named*;
    // `en` reads the same English line directly. Same release, three receipts — and the one
    // thing none of them changed is which pack the invitation borrows from.
    const receipts = PROFILES.map((profile) => {
      const { section } = sectionOf(profile, "opening", pinnedSource());
      return { lang: section?.lang, content: section?.content, provenance: section?.provenance };
    });
    expect(receipts).toEqual([
      {
        lang: "ta",
        content: "மங்கல நாள்",
        provenance: { source: "reviewed_pack", packKey: PACK_KEY, releaseNumber: 1, language: "ta", fallbackUsed: false },
      },
      {
        lang: "en",
        content: "An auspicious day",
        provenance: { source: "reviewed_pack", packKey: PACK_KEY, releaseNumber: 1, language: "en", fallbackUsed: true },
      },
      {
        lang: "en",
        content: "An auspicious day",
        provenance: { source: "reviewed_pack", packKey: PACK_KEY, releaseNumber: 1, language: "en", fallbackUsed: false },
      },
    ]);
  });

  it("names a language gap instead of filling it, and never points at another pack", () => {
    // `blessing` is Tamil-only and did not ask for English, so for the Urdu and English profiles
    // there is no wording to read. The honest answer is an issue that says so — not a different
    // release, and not a translation nobody wrote.
    const blessing = PROFILES.map((profile) => {
      const { resolved, section } = sectionOf(profile, "blessing", pinnedSource());
      return {
        source: section?.provenance.source,
        codes: resolved.issues.map((issue) => issue.code),
        release: resolved.release === null ? null : `${resolved.release.packKey}#${resolved.release.releaseNumber}`,
      };
    });
    expect(blessing).toEqual([
      { source: "reviewed_pack", codes: [], release: `${PACK_KEY}#1` },
      { source: "host", codes: ["read.language_unavailable"], release: `${PACK_KEY}#1` },
      { source: "host", codes: ["read.language_unavailable"], release: `${PACK_KEY}#1` },
    ]);
  });

  it("keeps the section list and the release identity identical across the three profiles", () => {
    const results = PROFILES.map((profile) =>
      resolveTraditionPack({
        source: pinnedSource(),
        requestedLanguage: profile.wedding.primary_language ?? "en",
        hostFields: profile.hostFields,
      }),
    );
    for (const resolved of results) {
      expect(resolved.sections.map((entry) => entry.key)).toEqual([
        "opening",
        "welcome",
        "family",
        "blessing",
      ]);
      // Nothing a section reports can name a different pack: the only release that appears
      // anywhere in a resolved document is the one the host selected.
      const packsNamed = new Set(
        resolved.sections.flatMap((section) =>
          section.provenance.source === "reviewed_pack"
            ? [`${section.provenance.packKey}#${section.provenance.releaseNumber}`]
            : [],
        ),
      );
      expect(packsNamed).toEqual(new Set([`${PACK_KEY}#1`]));
    }
    expect(results.map((resolved) => resolved.release?.requestedLanguage)).toEqual([
      "ta",
      "ur",
      "en",
    ]);
  });

  it("never credits a reviewer with the couple's own names, in any language", () => {
    // The heading is the release's; the names are the host's. Checked across all three profiles
    // because this is the property a language branch could break while still resolving the same
    // pack: the host-text path has to win in every one of them.
    for (const profile of PROFILES) {
      const { section } = sectionOf(profile, "welcome", pinnedSource());
      expect(section, profile.label).toMatchObject({
        key: "welcome",
        content: profile.hostFields.welcome,
        provenance: { source: "host", hostField: "welcome" },
      });
    }
  });
});

describe("the control that keeps the cases above from passing vacuously", () => {
  it("gives the three profiles different names, different language data and different places", () => {
    const titles = PROFILES.map((profile) => profile.wedding.title);
    const languages = PROFILES.map((profile) =>
      [profile.wedding.primary_language, ...profile.wedding.additional_languages].join("+"),
    );
    const places = PROFILES.map((profile) => profile.venues[0].address_text);
    const names = PROFILES.map((profile) =>
      profile.people.map((one) => one.display_name).join("+"),
    );

    expect(new Set(titles).size).toBe(3);
    expect(new Set(languages).size).toBe(3);
    expect(new Set(places).size).toBe(3);
    expect(new Set(names).size).toBe(3);
    // And they are three different rows owned by three different accounts, which is what makes
    // the identical-decision assertion a fact about the decision rather than about shared data.
    expect(new Set(PROFILES.map((profile) => profile.wedding.id)).size).toBe(3);
    expect(new Set(PROFILES.map((profile) => profile.wedding.owner_user_id)).size).toBe(3);
  });
});
