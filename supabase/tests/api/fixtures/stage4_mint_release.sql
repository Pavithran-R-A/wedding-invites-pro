-- Stage 4 §8/§16 — mint ONE more approved release of the fixture pack, for the single HTTP
-- scenario that cannot be made idempotent.
--
-- That scenario is "a new freeze from a release retired *after* it was chosen is refused". The
-- selection gate and the freeze gate differ at exactly this moment (`weddings_pack_release_gate`
-- says you may not *start* pointing at an unapproved release; `versions_pack_release_gate` says
-- you may not *freeze* from one that has since been retired), and proving the second half over
-- REST needs a release that is approved when a real host selects it and deprecated before that
-- same host freezes again. Deprecation is one-way, so the release that answers this question is
-- spent the moment it is used: no fixed fixture row can serve two runs. Hence a mint, one per
-- run, applied through the same trusted local route as the seed.
--
-- What it costs, stated rather than hidden: each run of the HTTP battery leaves one more
-- deprecated release on the fixture pack in *this repository's local stack*. It is invisible to
-- every customer read — RLS shows a deprecated release only to a wedding that points at it, and
-- the synthetic wedding that pointed at it is deleted by the battery — so the residue is a row
-- count in a dev database, and `stage4_tradition_packs.test.mjs` prints the ledger at the end of
-- every run so the accumulation is at least measured.
--
-- Like the seed, this is TEST ONLY content: `machine_assisted` true with its disclosure, and a
-- review record that names itself a fixture review. `service_role`'s HTTP path is deliberately
-- not used here, so the mint exercises the same content-maintenance identity the seed does.
--
-- Usage: psql -v rid=<uuid> -f supabase/tests/api/fixtures/stage4_mint_release.sql

\set ON_ERROR_STOP on

BEGIN;

-- Born as a draft, because the guard refuses any other birth state, and then walked forward a
-- step at a time by three separate statements — which is the same sequence a real release
-- travels, not a shortcut to its end state.
--
-- Its definition is release 1's with one English string replaced, so a test that compares the
-- two knows the difference is wording rather than an accident of how the JSON was typed out.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT
  :'rid'::uuid,
  r1.pack_id,
  (SELECT coalesce(max(r.release_number), 0) + 1
     FROM public.tradition_pack_releases r WHERE r.pack_id = r1.pack_id),
  1,
  r1.languages,
  jsonb_set(r1.definition, '{sections,0,pack_text,en}',
            '"With the goodwill of both families, minted to be retired mid-test."'),
  'TEST ONLY — minted fixture release', true,
  'TEST ONLY — copied from the Stage 4 HTTP fixture pack by an automated suite and given one '
  'different English string. No human reader of Tamil reviewed any string in this release.',
  'TEST ONLY — supabase/tests/api/fixtures/stage4_mint_release.sql',
  'Minted for the freeze-after-retirement refusal'
FROM public.tradition_pack_releases r1
WHERE r1.id = 'aaaaaaaa-0004-4000-8000-000000000101'
  AND r1.pack_id = (SELECT id FROM public.tradition_packs WHERE pack_key = 'stage4_http_fixture');

UPDATE public.tradition_pack_releases SET
  status = 'reviewed',
  review_label = 'TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW',
  review_basis = 'Automated Stage 4 API qualification only; no human qualification is claimed '
                 'by this record.',
  review_scope = 'Shape of the definition and the two declared languages. No ritual, religious '
                 'or community content was assessed.',
  reviewed_languages = ARRAY['en', 'ta'],
  reviewed_at = now()
WHERE id = :'rid'::uuid;

UPDATE public.tradition_pack_releases SET status = 'approved', approved_at = now()
WHERE id = :'rid'::uuid;

COMMIT;

-- One row of output for the caller to read back: id | number | status. If the mint did not
-- land on all three steps, the battery sees that here rather than in a confusing refusal later.
SELECT r.id || ' | ' || r.release_number || ' | ' || r.status
  FROM public.tradition_pack_releases r WHERE r.id = :'rid'::uuid;
