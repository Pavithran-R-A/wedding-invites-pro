// The seam between the frozen document and the page: one ordered list of sections, from
// whatever shape the projection answered with, plus the list of what could not be drawn.
//
// Directive §13 asks for two things that pull against each other. A guest's page must show
// what the release said, in the release's order, and a guest holding a link published by a
// build newer than their browser's bundle must not get an error page. So this layer is where
// "I don't know that one" is decided — and the decision has to be visible, because a skipped
// section that says nothing is a silently missing paragraph on someone's invitation.
//
// Every case below runs the real parser first. A hand-built camelCase object would prove the
// normalizer's arithmetic and nothing about the contract; these prove that a payload the
// projection could answer with arrives here with the fields this file reads them under.

import { describe, expect, it } from "vitest";
import { parsePublicInvitation, type PublicInvitation } from "@/lib/publicInvitation";
import { normalizeInvitationSections, NO_PACK_SECTIONS } from "@/lib/invitationSections";
import {
  guestInvitation,
  guestInvitationPacked,
  guestPayload,
  packedGuestPayload,
  payloadOfWith,
  payloadWith,
} from "@/test/invitationFixture";

const normalize = (payload: unknown) => {
  const invitation = parsePublicInvitation(payload);
  if (invitation === null) throw new Error('the payload under test no longer parses');
  return normalizeInvitationSections(invitation);
};

const normalizeDocument = (invitation: PublicInvitation) => normalizeInvitationSections(invitation);

const codes = (invitation: unknown) => normalize(invitation).issues.map(issue => issue.code);

/** Read one section out of a no-pack document by its slot, so an assertion names the slot
 *  instead of counting positions in an array a later definition could reorder. */
const noPackSection = (slot: string, invitation: PublicInvitation) =>
  normalizeDocument(invitation).sections.find(section => section.key === slot);

describe("the no-pack document, expressed as a section list", () => {
  const tamil = parsePublicInvitation(guestPayload({ language: 'ta' })) as PublicInvitation;
  const english = parsePublicInvitation(guestPayload({ language: 'en' })) as PublicInvitation;

  it("draws the platform's six slots, in the platform's order, with nothing skipped", () => {
    const normalized = normalizeDocument(tamil);
    expect(normalized.issues).toEqual([]);
    expect(normalized.requested).toBe('ta');
    expect(normalized.sections.map(section => [section.key, section.position, section.kind])).toEqual([
      ['welcome', 1, 'text'],
      ['family_introduction', 2, 'text'],
      ['family', 3, 'people_list'],
      ['ceremonies', 4, 'event_list'],
      ['event_notes', 5, 'text'],
      ['closing', 6, 'text'],
    ]);
    // Stage 3's neutral ordering, which is what §13 asks to be kept — expressed as data, so
    // the no-pack page and a packed page go through the same loop.
    expect(normalized.sections.map(section => section.key)).toEqual(NO_PACK_SECTIONS.map(entry => entry.key));
  });

  it("places each slot in the part of the paper the platform owns", () => {
    const normalized = normalizeDocument(tamil);
    expect(normalized.sections.map(section => section.region)).toEqual([
      'opening', 'opening', 'body', 'body', 'body', 'closing',
    ]);
  });

  it("resolves the platform's one heading against the language the wedding asked for", () => {
    // The default definition declares `{"en": "The ceremonies"}` with no English fallback, and
    // `private.pack_text_for` answers that to an English request and nothing to another. The
    // battery measures the sentence in SQL; this measures the client reading it.
    expect(noPackSection('ceremonies', english)?.heading).toBe('The ceremonies');
    expect(noPackSection('ceremonies', tamil)?.heading).toBeNull();
  });

  it("treats a wedding that never chose a language as English, as the database does", () => {
    // `build_invitation_snapshot` resolves with `COALESCE(primary_language, 'en')`. A v2
    // document already carries that resolution in its section list, so the client only reads
    // it; a legacy document records no request at all and is resolved here — which is where
    // the two have to agree, or the same wedding previews one heading and freezes another.
    const unanswered = parsePublicInvitation(guestPayload({ language: null })) as PublicInvitation;
    const resolved = normalizeDocument(unanswered);
    expect(resolved.requested).toBeNull();
    expect(resolved.sections.find(section => section.key === 'ceremonies')?.heading).toBe('The ceremonies');

    const legacy = { ...unanswered, sections: null } as PublicInvitation;
    const normalized = normalizeDocument(legacy);
    expect(normalized.requested).toBeNull();
    expect(normalized.sections.find(section => section.key === 'ceremonies')?.heading).toBe('The ceremonies');
    expect(normalized.issues).toEqual([]);
  });

  it("carries the host's words as the host's, and an empty slot as nothing at all", () => {
    const normalized = normalizeDocument(tamil);
    expect(normalized.sections[0]).toEqual({
      key: 'welcome',
      kind: 'text',
      region: 'opening',
      position: 1,
      required: false,
      heading: null,
      content: 'With the blessings of our elders',
      provenance: { source: 'host', hostField: 'welcome', overrodePackText: false },
    });
    const empty = normalized.sections[5];
    expect(empty?.content).toBeNull();
    expect(empty?.provenance).toEqual({ source: 'none' });
  });

  it("reads a host's spaces-only line as nothing, not as a paragraph", () => {
    const blank = parsePublicInvitation(guestPayload({ draft: { welcome: '   ' } })) as PublicInvitation;
    const welcome = normalizeDocument(blank).sections.find(section => section.key === 'welcome');
    expect(welcome?.content).toBeNull();
    // The credit stays: the host did write in the field, and a space is a fact about the
    // draft. What changes is that nothing is drawn, which is the renderer's decision.
    expect(welcome?.provenance).toEqual({ source: 'host', hostField: 'welcome', overrodePackText: false });
  });
});

describe("a document frozen from an approved release", () => {
  it("keeps the release's order, including where it disagrees with the platform's", () => {
    const normalized = normalize(packedGuestPayload());
    expect(normalized.issues).toEqual([]);
    expect(normalized.requested).toBe('ta');
    expect(normalized.sections.map(section => [section.key, section.position])).toEqual([
      ['welcome', 1],
      ['blessing', 2],
      ['family', 3],
      ['ceremonies', 4],
      ['closing', 5],
      ['event_notes', 6],
    ]);
    // Which region a slot sits in stays the platform's — a release reorders within a region and
    // does not move the paper's structure. `closing` is the sign-off slot whatever number the
    // release gave it, and the notes slot is body even when a release lists it last.
    expect(normalized.sections.map(section => section.region)).toEqual([
      'opening', 'body', 'body', 'body', 'closing', 'body',
    ]);
  });

  it("keeps the array's order rather than re-sorting by the declared position", () => {
    // The projection's array order is what the freeze stored. Two sections sharing a position
    // number is a defect in a definition, and the honest response is to draw them in the order
    // they arrived — not to invent a tie-break the database never specified.
    const tied = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 2, 'position'], 4),
    ) as PublicInvitation;
    const normalized = normalizeDocument(tied);
    expect(normalized.sections.map(section => section.key)).toEqual([
      'welcome', 'blessing', 'family', 'ceremonies', 'closing', 'event_notes',
    ]);
  });

  it("reports reviewed wording as reviewed, and the host's replacement of it as the host's", () => {
    const normalized = normalize(packedGuestPayload());
    expect(normalized.sections.find(section => section.key === 'blessing')?.provenance).toEqual({
      source: 'reviewed_pack',
      language: 'ta',
      fallbackUsed: false,
    });
    // §12: a host who wrote over the release's line is `host`, and the fact that a release line
    // existed is carried separately as `overrodePackText`. There is no third provenance word
    // meaning "the pack's, edited", and this file does not invent one.
    expect(normalized.sections.find(section => section.key === 'welcome')?.provenance).toEqual({
      source: 'host',
      hostField: 'welcome',
      overrodePackText: true,
    });
    expect(normalized.sections.map(section => section.provenance.source)).toEqual([
      'host', 'reviewed_pack', 'none', 'none', 'none', 'host',
    ]);
  });

  it("reports a release's declared fallback as the release's wording, in the language actually used", () => {
    // The fourth provenance case. `private.pack_text_for` reaches English only where the
    // release permits it, and writes both facts into the row it resolves — group R5 of
    // `supabase/tests/stage5/70_document_resolution.sql` measures that sentence in SQL. This
    // measures the client reading it without smoothing it: the wording stays the release's, the
    // language stays `en`, and the request the substitution answered stays in `requested`. A
    // normalizer that rewrote the language to the requested one would hand the host's preview a
    // document whose Tamil line is not Tamil, which is the same dishonesty in miniature that
    // §12 refuses at the level of who wrote a line.
    const substituted = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'body'], {
        source: 'reviewed_pack',
        text: '[placeholder English blessing line from the release]',
        language: 'en',
        fallback_used: true,
        overrode_pack_text: false,
      }),
    ) as PublicInvitation;
    const normalized = normalizeDocument(substituted);
    const blessing = normalized.sections.find(section => section.key === 'blessing');
    expect(blessing?.content).toBe('[placeholder English blessing line from the release]');
    expect(blessing?.provenance).toEqual({ source: 'reviewed_pack', language: 'en', fallbackUsed: true });
    expect(normalized.requested).toBe('ta');
    // A permitted substitution is not a defect, so it is drawn without an issue beside it.
    expect(normalized.issues).toEqual([]);
  });

  it("will not hand a host's line the release's credit, whatever the payload offers it", () => {
    // The third provenance case, taken as far as it can go. A host body carrying a `language`
    // and `fallback_used: true` is not a document the projection writes — the platform does not
    // know what language a person typed in — so this is the shape that would tempt a reader
    // into reporting the line as reviewed. The arms below are chosen by the source word alone,
    // so a field cannot buy credit: the host's arm has nowhere to put a language, and the words
    // `reviewed_pack` and `en` appear nowhere in what this section normalizes to.
    const odd = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 0, 'body'], {
        source: 'host',
        text: 'With the blessings of our elders',
        language: 'en',
        fallback_used: true,
        overrode_pack_text: true,
      }),
    ) as PublicInvitation;
    const welcome = normalizeDocument(odd).sections.find(section => section.key === 'welcome');
    expect(welcome?.provenance).toEqual({ source: 'host', hostField: 'welcome', overrodePackText: true });
    expect(JSON.stringify(welcome?.provenance)).not.toContain('reviewed_pack');
    expect(JSON.stringify(welcome?.provenance)).not.toContain('en');
  });

  it("says nothing about a section the release left without wording", () => {
    const cleared = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'body'], null),
    ) as PublicInvitation;
    const blessing = normalizeDocument(cleared).sections.find(section => section.key === 'blessing');
    expect(blessing?.content).toBeNull();
    expect(blessing?.provenance).toEqual({ source: 'none' });
  });
});

describe("a section this build cannot draw", () => {
  it("is skipped, named, and costs nothing else on the page", () => {
    const withUnknownKind = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'kind'], 'deity_list'),
    ) as PublicInvitation;
    const normalized = normalizeDocument(withUnknownKind);
    expect(normalized.sections.map(section => section.key)).toEqual([
      'welcome', 'family', 'ceremonies', 'closing', 'event_notes',
    ]);
    expect(normalized.issues).toHaveLength(1);
    expect(normalized.issues[0]).toMatchObject({
      code: 'render.unknown_kind_skipped',
      path: 'sections.items[1]',
    });
    // The message carries the word that caused it, so a content author is not hunting for a
    // spelling mistake in a definition that says nothing about it.
    expect(normalized.issues[0]?.message).toContain('deity_list');
  });

  it("skips an unknown kind on an optional section and names it, exactly as it does a required one", () => {
    // The case §22 asks for by name: an *optional* section carrying a kind this build has no
    // drawing rule for. It is handled by the same two lines as the required case above, and
    // that is the right answer rather than an oversight — "the release did not require this
    // paragraph" is not the same fact as "this build can draw it", and a normalizer that
    // quietly kept only the required failures would drop the one word a content author needs.
    // Upstream, the same section is a blocking record whatever its `required` flag says
    // (`kind_unrenderable` in `private.invitation_issue_records`, group I8 of the Stage 5
    // battery), so nothing new can be frozen on it; a page already published is what this
    // layer is for.
    const optional = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 5], {
        section_key: 'event_notes',
        position: 6,
        kind: 'venue_list',
        required: false,
        host_field: 'event_notes',
        heading: null,
        body: {
          source: 'host',
          text: 'Lunch follows the ceremony.',
          language: null,
          fallback_used: null,
          overrode_pack_text: false,
        },
      }),
    ) as PublicInvitation;
    expect(optional.sections?.items[5]?.required).toBe(false);
    const normalized = normalizeDocument(optional);
    expect(normalized.sections.map(section => section.key)).toEqual([
      'welcome', 'blessing', 'family', 'ceremonies', 'closing',
    ]);
    expect(normalized.issues).toEqual([
      expect.objectContaining({
        code: 'render.unknown_kind_skipped',
        path: 'sections.items[5]',
        message: expect.stringContaining('venue_list'),
      }),
    ]);
  });

  it("skips a section whose kind the projection never wrote at all", () => {
    // Absence is the same case as an unfamiliar word: either way this build has no drawing
    // rule for it, and drawing nothing beats guessing that it was a text section.
    const noKind = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'kind'], undefined),
    ) as PublicInvitation;
    expect(noKind.sections?.items[1]?.kind).toBeNull();
    const normalized = normalizeDocument(noKind);
    expect(normalized.sections.map(section => section.key)).not.toContain('blessing');
    expect(codes(packedGuestPayload())).toEqual([]);
  });

  it("skips an unfamiliar slot rather than inventing a place for it", () => {
    const renamed = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'section_key'], 'sankalpam'),
    ) as PublicInvitation;
    const normalized = normalizeDocument(renamed);
    expect(normalized.issues.map(issue => issue.code)).toEqual(['render.unknown_slot_skipped']);
    expect(normalized.issues[0]?.message).toContain('sankalpam');
    expect(normalized.sections.map(section => section.key)).toEqual([
      'welcome', 'family', 'ceremonies', 'closing', 'event_notes',
    ]);
  });

  it("draws a section whose host field this build has nowhere to put, and says so", () => {
    // The words are already in the body the projection resolved, so the guest loses nothing;
    // what the host is told is that a field this build does not know was named.
    const odd = parsePublicInvitation(
      payloadOfWith(guestInvitation(), ['invitation', 'sections', 'items', 0, 'host_field'], 'grandmother'),
    ) as PublicInvitation;
    const normalized = normalizeDocument(odd);
    expect(normalized.sections.find(section => section.key === 'welcome')?.content)
      .toBe('With the blessings of our elders');
    expect(normalized.issues).toHaveLength(1);
    expect(normalized.issues[0]).toMatchObject({ code: 'render.unknown_host_field' });
    expect(normalized.sections.find(section => section.key === 'welcome')?.provenance)
      .toEqual({ source: 'host', hostField: null, overrodePackText: false });
  });

  it("draws wording from a provenance word it does not know, and claims no provenance for it", () => {
    const odd = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'body', 'source'], 'community'),
    ) as PublicInvitation;
    const blessing = normalizeDocument(odd).sections.find(section => section.key === 'blessing');
    expect(blessing?.content).toBe('[placeholder blessing line from the release]');
    expect(blessing?.provenance).toEqual({ source: 'unknown', reported: 'community' });
    expect(codes(payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'body', 'source'], 'community')))
      .toEqual(['render.unknown_provenance']);
  });

  it("refuses to guess which review covers a section it cannot place", () => {
    // The whole point of the issue list: a skipped section is reported, never quietly dropped.
    const normalized = normalize(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'kind'], 'deity_list'),
    );
    expect(normalized.sections).toHaveLength(5);
    expect(normalized.issues).toHaveLength(1);
  });});

describe("what a release declares required", () => {
  it("names a required section whose wording is absent", () => {
    const cleared = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'body'], null),
    ) as PublicInvitation;
    // The fixture's blessing is the release's required one; emptied, it is a hole in the page
    // rather than a section the host never filled.
    expect(cleared.sections?.items[1]?.required).toBe(true);
    const normalized = normalizeDocument(cleared);
    expect(normalized.issues).toEqual([
      expect.objectContaining({ code: 'render.required_section_empty', path: 'sections.items[1]' }),
    ]);
    expect(normalized.issues[0]?.message).toContain('blessing');
    // Still in the list: this layer reports, and the renderer decides that a section with
    // neither heading nor content has nothing to draw.
    expect(normalized.sections.map(section => section.key)).toContain('blessing');
  });

  it("names a required section whose wording is only spaces", () => {
    const doc = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'body', 'text'], '   '),
    ) as PublicInvitation;
    expect(normalizeDocument(doc).issues.map(issue => issue.code)).toEqual(['render.required_section_empty']);
  });

  it("names a required list the document has nothing to fill", () => {
    // `family` and `ceremonies` are optional in the fixture, so the same document with an
    // empty roster reports nothing — the issue is the release's requirement, not our
    // preference for a fuller page.
    const noPeople = payloadOfWith(guestInvitationPacked(), ['invitation', 'people'], []);
    const noEvents = payloadOfWith(guestInvitationPacked(), ['invitation', 'events'], []);
    expect(codes(noPeople)).toEqual([]);
    expect(codes(noEvents)).toEqual([]);

    const requiredRoster = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 2], {
        section_key: 'family',
        position: 3,
        kind: 'people_list',
        required: true,
        host_field: null,
        heading: null,
        body: null,
      }),
    ) as PublicInvitation;
    expect(normalizeDocument({ ...requiredRoster, people: [] } as PublicInvitation).issues)
      .toEqual([expect.objectContaining({ code: 'render.required_list_empty' })]);
    expect(normalizeDocument(requiredRoster).issues).toEqual([]);

    const requiredCeremonies = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 3], {
        section_key: 'ceremonies',
        position: 4,
        kind: 'event_list',
        required: true,
        host_field: null,
        heading: null,
        body: null,
      }),
    ) as PublicInvitation;
    expect(normalizeDocument({ ...requiredCeremonies, events: [] } as PublicInvitation).issues)
      .toEqual([expect.objectContaining({ code: 'render.required_list_empty' })]);
    expect(normalizeDocument(requiredCeremonies).issues).toEqual([]);
  });

  it("does not report a required section that is simply full", () => {
    expect(normalize(packedGuestPayload()).issues).toEqual([]);
  });
});

describe("the normalizer's own promises", () => {
  it("is deterministic, so a guest page is reproducible from its snapshot alone", () => {
    const first = normalize(packedGuestPayload());
    const second = normalize(packedGuestPayload());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("hands the renderer only the fields it documented, and no name the payload grew", () => {
    // A forward-compatibility case in the direction that matters: a newer projection that
    // starts writing a `release_id` per section must not have it ride through this layer into
    // the page, where a guest could quote it back at the platform.
    const grown = parsePublicInvitation(
      payloadOfWith(guestInvitationPacked(), ['invitation', 'sections', 'items', 1, 'release_id'], 'b1b1b1b1-1111-1111-1111-111111111111'),
    ) as PublicInvitation;
    expect(grown).not.toBeNull();
    const normalized = normalizeDocument(grown);
    for (const section of normalized.sections) {
      expect(Object.keys(section).sort()).toEqual([
        'content', 'heading', 'key', 'kind', 'position', 'provenance', 'region', 'required',
      ]);
    }
    expect(JSON.stringify(normalized)).not.toContain('b1b1b1b1');
  });

  it("reports a legacy document with no section list as the platform's list, with no issues", () => {
    const legacy = { ...(parsePublicInvitation(guestPayload({ language: 'en' })) as PublicInvitation), sections: null };
    const normalized = normalizeDocument(legacy as PublicInvitation);
    expect(normalized.requested).toBeNull();
    expect(normalized.issues).toEqual([]);
    expect(normalized.sections.map(section => section.key)).toEqual([
      'welcome', 'family_introduction', 'family', 'ceremonies', 'event_notes', 'closing',
    ]);
    expect(normalized.sections.map(section => section.required)).toEqual([false, false, false, false, false, false]);
  });

  it("does not let a payload with an unknown top-level field become a different document", () => {
    // The version gate itself is the database's: `private.public_invitation_dto` returns NULL
    // for any `p_snapshot_schema_version` other than the one this build projects, which
    // `50_pack_release.sql` measures. The client's half is that such a name never arrives, and
    // an extra key is not allowed to change what is drawn.
    const withExtra = payloadWith(['invitation', 'snapshot_schema_version'], 3);
    const plain = guestPayload();
    expect(normalize(withExtra)).toEqual(normalize(plain));
  });
});
