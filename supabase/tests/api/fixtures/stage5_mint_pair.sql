-- Stage 5 §23 — mint ONE pack with TWO releases inside it, for the retirement journey that cannot
-- be made idempotent.
--
-- The journey §23 asks for is: a wedding selects R1, freezes V1, publishes it; R1 is then retired;
-- a *new* release R2 is approved afterwards; the wedding must not move by itself; and only an
-- explicit host selection of R2 lets a second version be frozen from it. Three of those steps are
-- one-way facts about a row — deprecation, approval, and a version having been frozen from a
-- release — so the release that answers this question is spent the moment it is used. A fixed
-- fixture row cannot serve two runs, and §23 requires a second run without a reset.
--
-- Why a whole pack rather than two more releases on `stage5_http_v2`, which is what
-- `stage4_mint_release.sql` does to its seed pack. Stage 4's own CAT-02 records the cost of that
-- choice: its assertion about "what this pack offers a customer" had to be rewritten from an exact
-- list into a set-of-statuses, because the mint put a row inside the pack the catalogue cases read.
-- Every CATALOGUE case §23 asks for is exactly that kind of assertion — an approved TEST ONLY
-- release is visible, a draft is not, a deprecated one is not offered — so the minted material gets
-- its own pack and the seed's four packs stay exactly as their file declares them.
--
-- What it costs, stated rather than hidden: one pack and two releases per run, permanently, in
-- *this repository's local stack*. Ruling A2 refuses the DELETE of a release that has left draft, so
-- no cleanup is available, and the residue is measured and printed by the battery's own ledger case
-- rather than assumed away. Every assertion that reads it is scoped to the minted uuids, which no
-- other case names.
--
-- Both releases are born as drafts and walked forward one legal step at a time, so the digest beside
-- each review record is made by the same trigger that makes a real one — a hand-written
-- `review_packet_hash` would be a fixture that fakes the thing under test. R2 deliberately stops at
-- `reviewed`: §23's "approve R2 does not switch the wedding" needs the approval to be an event
-- *inside* the run, and that step is the battery's own trusted statement.
--
-- Like the seed, everything here is TEST ONLY: `machine_assisted` true with its disclosure, and
-- review metadata that names itself a fixture review. `service_role`'s HTTP path is deliberately not
-- used, so the mint exercises the same content-maintenance identity the seed does.
--
-- If `aaaaaaaa-0005-4000-8000-000000000101` is not in the database, both INSERT…SELECTs below insert
-- nothing, the UPDATEs move nothing, and the line at the end prints no rows — which is what the
-- battery asserts on, rather than a precondition written twice.
--
-- Usage: psql -v pkey=<pack_key slug> -v pid=<uuid> -v r1=<uuid> -v r2=<uuid> \
--          -f supabase/tests/api/fixtures/stage5_mint_pair.sql
-- Every one of those is a psql variable substituted as a quoted literal (`:'name'`), and the
-- battery validates all four shapes before it gets here.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
VALUES (
  :'pid'::uuid, :'pkey', 'TEST ONLY — Stage 5 Retirement Journey',
  'TEST ONLY fixture minted by the Stage 5 HTTP battery for its retirement journey. It endorses no '
  || 'tradition, community, ritual or language claim, no string in it was read by a human reviewer '
  || 'with cultural authority, and it is not customer content.'
);

-- --------------------------------------------------------------- release 1, spent by the run
-- Copied from the seed's release 1 with one English string replaced, so the difference between the
-- two documents a guest could be given is wording and nothing else.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT
  :'r1'::uuid, :'pid'::uuid, 1, r.definition_schema_version, r.languages,
  jsonb_set(r.definition, '{sections,0,pack_text,en}',
            '"Minted to be retired in the middle of a test."'),
  r.author_label, r.machine_assisted,
  'TEST ONLY — copied from the Stage 5 HTTP seed release by an automated suite and given one '
  || 'different English string. No human reader of Tamil reviewed any string in this release.',
  'TEST ONLY — supabase/tests/api/fixtures/stage5_mint_pair.sql',
  'Minted for the §23 retirement journey'
FROM public.tradition_pack_releases r
WHERE r.id = 'aaaaaaaa-0005-4000-8000-000000000101';

UPDATE public.tradition_pack_releases SET
  status = 'reviewed',
  review_label = 'TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW',
  review_basis = 'Automated Stage 5 API qualification only; no human qualification is claimed by '
                 || 'this record.',
  review_scope = 'Shape of the version-2 definition and its two declared languages. No ritual, '
                 || 'religious or community content was assessed.',
  reviewed_languages = ARRAY['en', 'ta'],
  reviewed_at = now()
WHERE id = :'r1'::uuid;

UPDATE public.tradition_pack_releases SET status = 'approved' WHERE id = :'r1'::uuid;

-- ------------------------------------------------- release 2, approved later by the run itself
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT
  :'r2'::uuid, :'pid'::uuid, 2, r.definition_schema_version, r.languages,
  jsonb_set(r.definition, '{sections,0,pack_text,en}',
            '"Minted to be approved after the retirement, and reached only by an explicit host."'),
  r.author_label, r.machine_assisted,
  'TEST ONLY — copied from the Stage 5 HTTP seed release by an automated suite and given one '
  || 'different English string. No human reader of Tamil reviewed any string in this release.',
  'TEST ONLY — supabase/tests/api/fixtures/stage5_mint_pair.sql',
  'Minted for the §23 approve-does-not-switch case'
FROM public.tradition_pack_releases r
WHERE r.id = 'aaaaaaaa-0005-4000-8000-000000000101';

UPDATE public.tradition_pack_releases SET
  status = 'reviewed',
  review_label = 'TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW',
  review_basis = 'Automated Stage 5 API qualification only; no human qualification is claimed by '
                 || 'this record.',
  review_scope = 'Shape of the version-2 definition and its two declared languages. No ritual, '
                 || 'religious or community content was assessed.',
  reviewed_languages = ARRAY['en', 'ta'],
  reviewed_at = now()
WHERE id = :'r2'::uuid;

COMMIT;

-- One line per row the mint created, so the battery reads its own subject back rather than assuming
-- it: `|`-separated id | release_number | status | first 12 of the binding. A release that did not
-- reach the state the journey starts from is visible here, in the caller's own output, rather than
-- later as a confusing refusal.
SELECT 'FIXTURE-MINT|' || r.id || '|' || r.release_number::text || '|' || r.status
       || '|' || coalesce(left(r.review_packet_hash, 12), '(none)')
  FROM public.tradition_pack_releases r
 WHERE r.pack_id = :'pid'::uuid
 ORDER BY r.release_number;
