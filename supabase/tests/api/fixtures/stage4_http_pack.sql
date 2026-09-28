-- Stage 4 §8/§16/§17 — the TEST ONLY packs this repository's *local* stack carries so the HTTP
-- battery and the browser journeys have a catalogue with every lifecycle state in it.
--
-- Why a second fixture file exists, when `supabase/tests/stage4/60_reviewed_fixture.sql`
-- already walks a release through the whole lifecycle. That file rolls its own transaction
-- back — the only cleanup a release that has reached `approved` can have, because the guard
-- trigger refuses a DELETE once a release has left draft (ruling A2: a release that has left
-- draft is a review unit, not a row). A rollback is exactly right for a throwaway cluster and
-- exactly wrong for a suite that talks to a running PostgREST: the HTTP battery needs the row
-- to exist for *another connection*, in a state that survives. So this file commits, and it is
-- only ever applied to `supabase_db_localvivaahvarnam` by the API suite's own trusted route.
--
-- Why there are five packs rather than one, and why the extra four are permanent. §17 asks for
-- refusals with names on them: "pack with only draft release is invisible", "pack with only
-- reviewed release is invisible", "pack with only deprecated release is not offered as
-- selectable", "absent explicit fallback produces a validation issue rather than silent
-- English". None of those can be *measured* against a catalogue that holds only approved
-- releases, and a refusal asserted against a row that does not exist is the exact thing §17
-- forbids ("do not count 'permission denied because the payload was malformed' as a security
-- pass"). So each state gets a real row.
--
-- The rows that carry a `reviewed` or `approved` or `deprecated` status cannot be deleted
-- afterwards — that is ruling A2, and this fixture is subject to it like any other release.
-- The draft one can be, but deleting it would make the next run rebuild it, which is a
-- different shape of lying about the catalogue. So all of it stays, deliberately, in a local
-- development database, and every assertion count that reads it is scoped to the pack keys
-- named here. `stage4_tradition_packs.test.mjs` prints the whole ledger at the end of each run
-- so the accumulation is at least measured rather than assumed away.
--
-- What is honest about it:
--   * Every string says TEST ONLY. Each pack's own scope statement — the sentence a host reads
--     beside the name in the picker — states that no human reviewed it and it endorses
--     nothing, so a fixture cannot become a claim just because it reached `approved`.
--   * `machine_assisted` is true and the disclosure says what was actually done.
--   * The review metadata names itself a fixture review. The status is real — it was moved
--     through draft → reviewed → approved by the same triggers a content release moves
--     through — and nothing here asserts that a person with cultural authority read a word.
--     Directive §8 asks for a fixture that is indistinguishable *to the database*; §12 and the
--     prohibition on invented review mean it must stay distinguishable to a reader, which is
--     what the strings do.
--   * No Tamil string here is offered as correct Tamil. It is fixture text so a two-language
--     release has two languages to resolve, and the render qualification that reads it is
--     described as rendering verification, never as linguistic approval.
--
-- Idempotent by design: every row is created once and then walked forward only as far as it
-- has not already gone, so re-applying this file is a no-op and the battery's second run sees
-- the same catalogue as its first. `stage4_mint_release.sql` is for the one scenario that
-- cannot be made idempotent, because deprecating a release is one-way.

\set ON_ERROR_STOP on

BEGIN;

DO $fx$
DECLARE
  v_langs  constant text[] := ARRAY['en', 'ta'];
  -- Opening: present in both languages, and allowed to fall back. The three sections are
  -- identical between releases except for one English string, so a test that compares two
  -- frozen snapshots is comparing wording rather than structure. `%s` is that one string.
  v_both   constant text := $def${
    "sections": [
      {"section_key": "opening", "position": 1, "kind": "text", "required": true,
       "host_field": "welcome", "allow_english_fallback": true,
       "heading": {"en": "Opening", "ta": "தொடக்கம்"},
       "pack_text": {"en": "%s", "ta": "வணக்கம்"}},
      {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
       "heading": {"en": "Our families", "ta": "குடும்பம்"}},
      {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
       "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}}
    ],
    "event_vocabulary": [
      {"event_key": "muhurtham", "labels": {"en": "Muhurtham", "ta": "முஹூர்தம்"}}
    ]
  }$def$;
  -- The same document with the opening's Tamil wording taken away *and* the fallback
  -- explicitly allowed: §17's "explicit Tamil -> English fallback marks fallbackUsed=true".
  v_gap    constant text := $def${
    "sections": [
      {"section_key": "opening", "position": 1, "kind": "text", "required": true,
       "host_field": "welcome", "allow_english_fallback": true,
       "heading": {"en": "Opening"},
       "pack_text": {"en": "%s"}},
      {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
       "heading": {"en": "Our families", "ta": "குடும்பம்"}},
      {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
       "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}}
    ]
  }$def$;
  -- ... and with the fallback refused: §17's "absent explicit fallback produces a validation
  -- issue rather than silent English". Its release still declares `ta`, which is what makes
  -- the refusal about the missing string rather than about an undeclared language.
  v_locked constant text := $def${
    "sections": [
      {"section_key": "opening", "position": 1, "kind": "text", "required": true,
       "host_field": "welcome", "allow_english_fallback": false,
       "heading": {"en": "Opening"},
       "pack_text": {"en": "%s"}},
      {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
       "heading": {"en": "Our families", "ta": "குடும்பம்"}},
      {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
       "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}}
    ]
  }$def$;
  v_scope  constant text := 'TEST ONLY fixture for Stage 4 database and API qualification. It '
    || 'endorses no tradition, community, ritual or language claim, no string in it was read by '
    || 'a human reviewer with cultural authority, and it is not customer content.';
  v_want   record;
  v_cur    text;
BEGIN
  -- ------------------------------------------------------------------ the concepts
  FOR v_want IN
    SELECT * FROM (VALUES
      -- The one a host can choose, and the one the R1 -> R2 journey walks.
      ('aaaaaaaa-0004-4000-8000-000000000001'::uuid, 'stage4_http_fixture',
       'TEST ONLY — Synthetic HTTP Fixture'),
      -- A pack whose only release nobody has looked at yet: invisible, §17 case 3.
      ('aaaaaaaa-0004-4000-8000-000000000002', 'stage4_http_draft_only',
       'TEST ONLY — Draft Release Only'),
      -- A pack whose only release has been looked at but not approved: invisible, case 4.
      ('aaaaaaaa-0004-4000-8000-000000000003', 'stage4_http_reviewed_only',
       'TEST ONLY — Reviewed Release Only'),
      -- A pack with nothing left to choose, because its one release was retired before this
      -- database ever had a customer point at it: the case where hiding the concept is the
      -- difference between a retired product and a vanished one, case 5.
      ('aaaaaaaa-0004-4000-8000-000000000004', 'stage4_http_retired_only',
       'TEST ONLY — Retired Release Only'),
      -- A pack whose releases have a deliberate hole in the Tamil coverage, one patched by an
      -- explicit fallback and one not: cases 27 and 28.
      ('aaaaaaaa-0004-4000-8000-000000000005', 'stage4_http_language_gaps',
       'TEST ONLY — Language Coverage Gaps')
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
      -- Main pack: two selectable releases whose only difference is wording, and one retired
      -- release, so "a retired release is not offered" has a row of the same pack to sit
      -- beside rather than a row invented for the purpose.
      ('aaaaaaaa-0004-4000-8000-000000000101'::uuid, 'aaaaaaaa-0004-4000-8000-000000000001'::uuid,
       1, 'approved'::text, v_both, 'With the goodwill of both families.'::text),
      ('aaaaaaaa-0004-4000-8000-000000000102', 'aaaaaaaa-0004-4000-8000-000000000001',
       2, 'approved', v_both, 'With the goodwill of both families, in release two.'),
      ('aaaaaaaa-0004-4000-8000-000000000103', 'aaaaaaaa-0004-4000-8000-000000000001',
       3, 'deprecated', v_both, 'With the goodwill of both families, before it was retired.'),
      -- One release in each pre-approval state.
      ('aaaaaaaa-0004-4000-8000-000000000201', 'aaaaaaaa-0004-4000-8000-000000000002',
       1, 'draft', v_both, 'With the goodwill of both families, never looked at.'),
      ('aaaaaaaa-0004-4000-8000-000000000301', 'aaaaaaaa-0004-4000-8000-000000000003',
       1, 'reviewed', v_both, 'With the goodwill of both families, looked at but not shipped.'),
      -- The only release of its pack, retired, so the pack has nothing selectable left.
      ('aaaaaaaa-0004-4000-8000-000000000401', 'aaaaaaaa-0004-4000-8000-000000000004',
       1, 'deprecated', v_both, 'With the goodwill of both families, retired before anyone chose it.'),
      -- The two language-coverage holes.
      ('aaaaaaaa-0004-4000-8000-000000000501', 'aaaaaaaa-0004-4000-8000-000000000005',
       1, 'approved', v_gap, 'With the goodwill of both families, English only and allowed to say so.'),
      ('aaaaaaaa-0004-4000-8000-000000000502', 'aaaaaaaa-0004-4000-8000-000000000005',
       2, 'approved', v_locked, 'With the goodwill of both families, English only and not allowed to fall back.')
    ) AS w(id, pack, num, status, def, sentence)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tradition_pack_releases WHERE id = v_want.id) THEN
      -- Born as a draft, because the guard refuses any other birth state.
      INSERT INTO public.tradition_pack_releases
        (id, pack_id, release_number, definition_schema_version, languages, definition,
         author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
      VALUES (
        v_want.id, v_want.pack, v_want.num, 1, v_langs,
        replace(v_want.def, '%s', v_want.sentence)::jsonb,
        'TEST ONLY — synthetic fixture release', true,
        'TEST ONLY — drafted by a model from the Stage 4 section vocabulary and checked for '
        || 'shape and language coverage by an automated suite. No human reader of Tamil reviewed '
        || 'any string in this release.',
        'TEST ONLY — supabase/tests/api/fixtures/stage4_http_pack.sql',
        'Fixture release ' || v_want.num || ' of the Stage 4 HTTP battery'
      );
      RAISE NOTICE 'FIXTURE release % of pack % born as draft', v_want.num, v_want.pack;
    END IF;

    -- Walk it forward one legal step at a time, and stop at the state this file declares. A
    -- step that has already happened is skipped, which is what makes re-running this file
    -- produce nothing rather than an error or an extra release.
    LOOP
      SELECT r.status INTO v_cur FROM public.tradition_pack_releases r WHERE r.id = v_want.id;
      EXIT WHEN v_cur = v_want.status;

      IF v_cur = 'draft' THEN
        UPDATE public.tradition_pack_releases SET
          status = 'reviewed',
          review_label = 'TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW',
          review_basis = 'Automated Stage 4 database qualification only; no human qualification '
                         || 'is claimed by this record.',
          review_scope = 'Shape of the definition and the two declared languages. No ritual, '
                         || 'religious or community content was assessed.',
          reviewed_languages = v_langs,
          reviewed_at = now()
        WHERE id = v_want.id;
        RAISE NOTICE 'FIXTURE release % moved draft -> reviewed', v_want.id;
      ELSIF v_cur = 'reviewed' THEN
        UPDATE public.tradition_pack_releases SET status = 'approved', approved_at = now()
        WHERE id = v_want.id;
        RAISE NOTICE 'FIXTURE release % moved reviewed -> approved', v_want.id;
      ELSIF v_cur = 'approved' THEN
        UPDATE public.tradition_pack_releases SET status = 'deprecated', deprecated_at = now()
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
-- operator applying this file by hand can see the state they have just created. Scoped to the
-- five pack keys this file owns, so a minted release shows up too and nothing is quietly
-- excluded from the count.
SELECT 'FIXTURE-LEDGER|' || p.pack_key || '|' || r.release_number::text || '|' || r.status
  FROM public.tradition_pack_releases r
  JOIN public.tradition_packs p ON p.id = r.pack_id
 WHERE p.pack_key IN ('stage4_http_fixture', 'stage4_http_draft_only',
                      'stage4_http_reviewed_only', 'stage4_http_retired_only',
                      'stage4_http_language_gaps')
 ORDER BY p.pack_key, r.release_number;

SELECT 'FIXTURE-PACK-COUNT|' || count(*)::text FROM public.tradition_packs p
 WHERE p.pack_key LIKE 'stage4_http_%';
