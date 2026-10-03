-- Stage 5 §23 — the TEST ONLY **version-2** packs this repository's *local* stack carries so the
-- Stage 5 HTTP battery has a catalogue whose releases declare the two facts Stage 4's do not:
-- `override_rule` and `requires_venue`.
--
-- Why this is a second seed file rather than more releases on `stage4_http_fixture`. Stage 4's
-- guard refuses `override_rule` and `requires_venue` on a `definition_schema_version = 1` row
-- outright — that asymmetry *is* the compatibility rule, and `50_pack_release.sql` pins it — so a
-- version-2 release cannot be added to a version-1 pack. It also cannot be asserted about from
-- one: every preview arm §23 asks for (`required_list_empty`, `event_venue_missing`,
-- `host_override_not_permitted`) sits behind `IF v_dsv >= 2` inside
-- `private.invitation_issue_records`, so a battery that selected a Stage 4 fixture release would
-- get a clean verdict and call it a pass. §23's cases are about a version-2 document, so this
-- fixture authors version-2 material rather than only asserting about it — the same lesson
-- `60_definition_vocabulary.sql` records about the guard's own whitelist.
--
-- What the five sections are for, one per §23 preview arm:
--   opening     text, required, `host_may_replace`, reads `welcome`
--              → reviewed wording by default; the host's own words flip the section to `host` with
--                `overrode_pack_text` true, and only on a replacement rule.
--   family     people_list, required
--              → `required_list_empty` with kind people_list when the wedding has no people.
--   ceremonies event_list, required, `requires_venue` true
--              → `required_list_empty` (events), and separately `event_venue_missing` for an
--                enabled event whose venue does not resolve. The flag is what makes the second arm
--                fire at all: the same event with no venue on a release that does not ask is a
--                document that freezes.
--   invitation text, required, `pack_only`, reads `family_introduction`, reviewed wording
--              → §12's other half over HTTP. The wording is reviewed and stays reviewed, so a host
--                typing into that box changes nothing on the page — and the engine records that
--                as the advisory `host_override_not_permitted` rather than dropping the words in
--                silence. `required` is satisfied by the release's own line, which is what makes
--                this section the non-blocking control beside the two blocking ones.
--   closing    text, required, `host_must_supply`, no reviewed wording
--              → §23's "incomplete required host prose": the release says this line is yours, the
--                host has not written it, and the document is not freezable until it exists.
--
-- Idempotent by design, exactly like `stage4_http_pack.sql`: rows are created once and then walked
-- forward only as far as this file declares, so re-applying it is a no-op and the battery's second
-- run — which §23 requires, without a reset — sees the same catalogue as its first. The lifecycle
-- this file does leave traces in is permanent by ruling A2 (a release that has reached `reviewed`
-- is a review unit, not a row, so the guard refuses its DELETE), which is why the battery's
-- retirement journey mints its own pack per run in `stage5_mint_pair.sql` instead of spending a
-- fixed row here.
--
-- What is honest about it, restated because a fixture reaches `approved` and an `approved` release
-- is the state a reader could mistake for a claim:
--   * Every string says TEST ONLY, and each pack's `scope_statement` — the sentence a host reads
--     beside the name — says no human reviewed it and it endorses nothing.
--   * `machine_assisted` is true, with a disclosure of what was actually done.
--   * The review record names itself a fixture review. The *status* is real: each row was moved
--     draft → reviewed → approved by the same triggers a content release travels through, so its
--     `review_packet_hash` was made by the same one writer. Nothing here says a person with
--     cultural authority read a word, and no case in the battery is satisfied by that reading.
--   * The Tamil strings exist so a two-language release has two languages to resolve. They are
--     not offered as correct Tamil, and the real Tamil candidate is not touched by this file: it
--     stays a draft, per §23.

\set ON_ERROR_STOP on

BEGIN;

DO $fx$
DECLARE
  v_langs  constant text[] := ARRAY['en', 'ta'];
  -- The one English string that differs between release 1 and release 2 of the selectable pack.
  -- `%s` is that string; everything else in the two definitions is byte-identical, so a test that
  -- compares two frozen documents is comparing wording and not an accident of how the JSON was
  -- typed out.
  v_v2     constant text := $def${
    "sections": [
      {"section_key": "opening", "position": 1, "kind": "text", "required": true,
       "host_field": "welcome", "override_rule": "host_may_replace",
       "heading": {"en": "Opening", "ta": "தொடக்கம்"},
       "pack_text": {"en": "%s", "ta": "வணக்கம்"}},
      {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
       "heading": {"en": "Our families", "ta": "குடும்பம்"}},
      {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
       "requires_venue": true,
       "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}},
      {"section_key": "invitation", "position": 4, "kind": "text", "required": true,
       "host_field": "family_introduction", "override_rule": "pack_only",
       "heading": {"en": "The invitation", "ta": "அழைப்பு"},
       "pack_text": {"en": "Together with their families, you are invited to share their joy.",
                     "ta": "குடும்பத்தாருடன் சேர்ந்து உங்களை வரவேற்கிறோம்."}},
      {"section_key": "closing", "position": 5, "kind": "text", "required": true,
       "host_field": "closing", "override_rule": "host_must_supply",
       "heading": {"en": "Closing", "ta": "முடிவு"}}
    ],
    "event_vocabulary": [
      {"event_key": "muhurtham", "labels": {"en": "Muhurtham", "ta": "முஹூர்தம்"}}
    ]
  }$def$;
  v_scope  constant text := 'TEST ONLY fixture for Stage 5 database and API qualification. It '
    || 'endorses no tradition, community, ritual or language claim, no string in it was read by '
    || 'a human reviewer with cultural authority, and it is not customer content.';
  v_want   record;
  v_cur    text;
BEGIN
  -- ------------------------------------------------------------------ the concepts
  FOR v_want IN
    SELECT * FROM (VALUES
      -- The one a host can choose, and the one every PREVIEW / FREEZE / PUBLICATION case is built
      -- on. Two approved releases, so "a host has to select the newer one explicitly" has a row.
      ('aaaaaaaa-0005-4000-8000-000000000001'::uuid, 'stage5_http_v2',
       'TEST ONLY — Stage 5 HTTP Version-2 Fixture'),
      -- A pack whose only release nobody has looked at yet: invisible, §23 CATALOGUE.
      ('aaaaaaaa-0005-4000-8000-000000000002', 'stage5_http_draft_only',
       'TEST ONLY — Stage 5 Draft Release Only'),
      -- Looked at, bound to a digest, not shipped: invisible as a choice, and the only row here
      -- whose review binding was made by the draft → reviewed edge rather than hand-written.
      ('aaaaaaaa-0005-4000-8000-000000000003', 'stage5_http_reviewed_only',
       'TEST ONLY — Stage 5 Reviewed Release Only'),
      -- Retired before any wedding ever pointed at it, so "a deprecated release cannot newly be
      -- selected" is measured against a real row rather than an absent one.
      ('aaaaaaaa-0005-4000-8000-000000000004', 'stage5_http_retired_only',
       'TEST ONLY — Stage 5 Retired Release Only')
    ) AS w(id, key, name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tradition_packs WHERE id = v_want.id) THEN
      INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
      VALUES (v_want.id, v_want.key, v_want.name, v_scope);
      RAISE NOTICE 'FIXTURE pack % created', v_want.key;
    ELSE
      RAISE NOTICE 'FIXTURE pack % already present', v_want.key;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------- the releases
  FOR v_want IN
    SELECT * FROM (VALUES
      ('aaaaaaaa-0005-4000-8000-000000000101'::uuid, 'aaaaaaaa-0005-4000-8000-000000000001'::uuid,
       1, 'approved'::text,
       'With the goodwill of both families, release one.'::text),
      ('aaaaaaaa-0005-4000-8000-000000000102', 'aaaaaaaa-0005-4000-8000-000000000001',
       2, 'approved', 'With the goodwill of both families, release two.'),
      ('aaaaaaaa-0005-4000-8000-000000000201', 'aaaaaaaa-0005-4000-8000-000000000002',
       1, 'draft', 'With the goodwill of both families, never looked at.'),
      ('aaaaaaaa-0005-4000-8000-000000000301', 'aaaaaaaa-0005-4000-8000-000000000003',
       1, 'reviewed', 'With the goodwill of both families, looked at but not shipped.'),
      ('aaaaaaaa-0005-4000-8000-000000000401', 'aaaaaaaa-0005-4000-8000-000000000004',
       1, 'deprecated', 'With the goodwill of both families, retired before anyone chose it.')
    ) AS w(id, pack, num, status, sentence)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tradition_pack_releases WHERE id = v_want.id) THEN
      -- Born as a draft, because the guard refuses any other birth state — including a row that
      -- arrives already carrying a review binding, which is the INSERT half of §23's
      -- "authenticated cannot alter review_packet_hash" told from the other side.
      INSERT INTO public.tradition_pack_releases
        (id, pack_id, release_number, definition_schema_version, languages, definition,
         author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
      VALUES (
        v_want.id, v_want.pack, v_want.num, 2, v_langs,
        replace(v_v2, '%s', v_want.sentence)::jsonb,
        'TEST ONLY — synthetic Stage 5 fixture release', true,
        'TEST ONLY — drafted by a model from the Stage 5 section vocabulary and checked for '
        || 'shape and language coverage by an automated suite. No human reader of Tamil reviewed '
        || 'any string in this release.',
        'TEST ONLY — supabase/tests/api/fixtures/stage5_http_pack.sql',
        'Fixture release ' || v_want.num || ' of the Stage 5 HTTP battery'
      );
      RAISE NOTICE 'FIXTURE release % of pack % born as draft', v_want.num, v_want.pack;
    END IF;

    -- Walk it forward one legal step at a time, and stop at the state this file declares. A step
    -- that has already happened is skipped, which is what makes re-applying this file produce
    -- nothing rather than an error or an extra release.
    LOOP
      SELECT r.status INTO v_cur FROM public.tradition_pack_releases r WHERE r.id = v_want.id;
      EXIT WHEN v_cur = v_want.status;

      IF v_cur = 'draft' THEN
        UPDATE public.tradition_pack_releases SET
          status = 'reviewed',
          review_label = 'TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW',
          review_basis = 'Automated Stage 5 database and API qualification only; no human '
                         || 'qualification is claimed by this record.',
          review_scope = 'Shape of the version-2 definition, its two override rules, its venue '
                         || 'declaration and the two declared languages. No ritual, religious or '
                         || 'community content was assessed.',
          reviewed_languages = v_langs,
          reviewed_at = now()
        WHERE id = v_want.id;
        RAISE NOTICE 'FIXTURE release % moved draft -> reviewed', v_want.id;
      ELSIF v_cur = 'reviewed' THEN
        UPDATE public.tradition_pack_releases SET status = 'approved'
        WHERE id = v_want.id;
        RAISE NOTICE 'FIXTURE release % moved reviewed -> approved', v_want.id;
      ELSIF v_cur = 'approved' THEN
        UPDATE public.tradition_pack_releases SET status = 'deprecated'
        WHERE id = v_want.id;
        RAISE NOTICE 'FIXTURE release % moved approved -> deprecated', v_want.id;
      ELSE
        RAISE EXCEPTION 'FIXTURE release % is in status %, which this seed does not know how to '
                        'reach', v_want.id, v_cur;
      END IF;
    END LOOP;
  END LOOP;
END
$fx$;

COMMIT;

-- The ledger, printed rather than assumed: the battery's own setup reads these lines, and an
-- operator applying this file by hand can see the state they have just created. Scoped to the four
-- pack keys this file owns, so `stage5_mint_pair.sql`'s per-run pack is deliberately not in it.
SELECT 'FIXTURE-LEDGER|' || p.pack_key || '|' || r.release_number::text || '|' || r.status
  FROM public.tradition_pack_releases r
  JOIN public.tradition_packs p ON p.id = r.pack_id
 WHERE p.pack_key IN ('stage5_http_v2', 'stage5_http_draft_only',
                      'stage5_http_reviewed_only', 'stage5_http_retired_only')
 ORDER BY p.pack_key, r.release_number;

-- Every release this seed owns, with its contract version and its binding, because §23's write
-- cases need to know the digest was made by the trigger and not typed in: a NULL here means the
-- walk above did not pass the draft → reviewed edge.
SELECT 'FIXTURE-BINDING|' || r.id || '|' || r.status || '|' || r.definition_schema_version::text
       || '|' || coalesce(left(r.review_packet_hash, 12), '(none)')
  FROM public.tradition_pack_releases r
  JOIN public.tradition_packs p ON p.id = r.pack_id
 WHERE p.pack_key LIKE 'stage5_http_%'
 ORDER BY r.id;
