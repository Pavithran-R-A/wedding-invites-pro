-- Stage 11 race tier, shared fixture. Run by `supabase/tests/stage11/run.sh race` (and `all`) before any
-- session pair, as one committed transaction, on the `race` chain — a throwaway database that runs nothing
-- else and is dropped at the end of the mode.
--
-- No customer data is reachable from here and none is used. Every account, wedding, publication, credential,
-- artefact, order, refund, ticket and grant below is minted from the literal uuid band named in the table
-- under "the cast", in a database created by `build_chain race` from the migration files. The local
-- `localvivaahvarnam` stack and any hosted project are not contacted by this file or by any file in this
-- directory: the race tier needs *two live clients against one schema*, which the throwaway container is the
-- only place in this repository where that is safe to arrange.
--
-- The cast, by role — each row is what one of the arms acts on, and every expectation is read from the
-- shipped bodies, not from this file's prose:
--   w1  arm 1: two operators, two distinct keys, two distinct live cases, one active publication. The rich
--       artefact set lives here (two `ready`, one `registered`, one `failed`) so the winner's effect set has
--       numbers that are not all the same number. RD05 returns here with a fresh key.
--   w2  arm 2: one key delivered concurrently by two sessions citing one case — the replay race.
--   w3  arm 3 A: the act that wins the key.
--   w4  arm 3 B: the act that loses it. A different wedding, the *same* key, so no row is shared except the
--       trail's key namespace; w4 must be left whole by the rollback.
--   w5  arm 4: the publication a hand lock holds, and the act a mid-flight revocation cannot stop.
--   w6  the money-only wedding: the one accepted review note of the tier is written here, so the
--       cross-*operation* key cells have a real first act to collide with — and its own active publication
--       is what RD03 and RD04 aim a spent key at, so a key collision is proved to be about the key.
--   w7  the stale-operator target: live, publishable, credential-bearing and never taken down, so a refusal
--       cannot be explained by the data being already spent.
--   w8  the thread-append wedding: a publication-free subject whose ticket …0909 carries arm 5's two
--       concurrent appends, so the ordinal race has nowhere else to go and cannot share a row with a
--       takedown.
--
-- Counted cells: this file prints baseline measurements with no case-id namespace of their own. The tier's
-- counted assertions are exactly the 25 ids §13 of `docs/architecture/operations-admin-security.md` already
-- names — `RC00`–`RC09` in `82_race_arm1_asserts.sql`, `RC10`–`RC16` in `83_race_arm4_asserts.sql` and
-- `RD00`–`RD07` in `84_race_replay_asserts.sql` — and no new range is introduced here or in any of those
-- three files.
--
-- The id band, fixed rather than random, because four concurrent sessions and three assert files have to
-- name the same rows without sharing a temp table: a temp table belongs to one backend, and a fixture the
-- next session cannot read is a fixture nobody can check. `0b0b0b00-0000-4000-8000-…`
--   …0001–0008 weddings w1–w8        …0101 host            …0111–0122 the twelve other accounts
--   …0201–0207 versions ver1–ver7    …0301–0310 the ten idempotency keys     …0401–0407 publications
--   …0501 household hh1              …0601–0608 credentials                  …0701–0709 artefacts
--   …0801–0802 entitlement/orders    …0811–0812 refunds                      …0901–0909 tickets
--
-- The key table, stated once here because every arm and every assert file cites it and a key whose owner is
-- inferred is a cell that silently measures the wrong act:
--   …0301 arm 1 session A's takedown of w1        …0302 arm 1 session B's, which is refused and must stay
--                                                  unspent
--   …0303 arm 2 *both* sessions' takedown of w2   — the concurrent replay, one key two deliveries
--   …0304 arm 3 *both* sessions' takedowns of w3  — the concurrent cross-wedding collision, and RD03's
--        and w4 respectively, and RD03's serial reuse of it against w6
--   …0305 arm 4's takedown of w5                  …0306 the fixture's own accepted note, and RD04's reverse
--                                                  reuse against the takedown door
--   …0307 arm 5 session A's hand append           …0308 arm 5 session B's door append, refused on the ordinal
--   …0309 the four stale attempts and RC13's      …0310 RD05's fresh key against a wedding already down
-- A refused act is allowed to share a key with another refused act precisely because neither writes a row;
-- RD07 then measures that no trail row anywhere carries …0302, …0308 or …0309.
SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT pg_catalog.set_config('s11f.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
-- Per-session, for the same reason every file in this directory repeats it: `pg_temp` is a backend's own
-- namespace, and `run.sh` pipes each file to its own `psql`, so nothing created by one session is visible
-- to another. It is also why this fixture is counted like a battery: a file the runner executes but that
-- reports no total is how a silently-skipped fixture stage reads as progress.
CREATE FUNCTION pg_temp.s11f_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('s11f.passed',
    (coalesce(nullif(current_setting('s11f.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11f_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL fixture: %', label;
  END IF;
  RAISE NOTICE 'PASS fixture: %', label;
  PERFORM pg_temp.s11f_add(1);
END $fn$;

-- A door called as a caller, never as the owner: `SET ROLE` plus the `test.uid` shim, and the role reset on
-- both exits so a refusal cannot leave the rest of the session holding a borrowed privilege.
CREATE FUNCTION pg_temp.s11f_as(p_uid uuid, p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_uid::text, false);
  PERFORM set_config('test.role', 'authenticated', false);
  BEGIN
    EXECUTE p_stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('test.uid', '', false);
    RAISE EXCEPTION 'FAIL fixture: % refused with % — the plant is wrong, not the arm', p_stmt,
      SQLSTATE || ' | ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN v;
END $fn$;

-- 64 hex characters, spelled from a label, for the three digest columns and `token_hash` the shipped CHECKs
-- demand. Same reason battery 92 gives: `md5` answers 32, so one more md5 is appended rather than the
-- shape loosened.
CREATE FUNCTION pg_temp.s11f_h64(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5(p) || md5(p || '::s11r') $fn$;

-- --------------------------------------------------------------------------- the accounts
-- Thirteen, and one of them (`…0120`) deliberately holds no grant at all: it is the control the stale
-- refusals are compared against, not a leftover.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT x, 's11r-' || n || '@stage11qual.test', '{}'::jsonb FROM (VALUES
  ('0b0b0b00-0000-4000-8000-000000000101'::uuid, 'host'),
  ('0b0b0b00-0000-4000-8000-000000000111'::uuid, 'op-arm1-a'),
  ('0b0b0b00-0000-4000-8000-000000000112'::uuid, 'op-arm1-b'),
  ('0b0b0b00-0000-4000-8000-000000000113'::uuid, 'op-arm2'),
  ('0b0b0b00-0000-4000-8000-000000000114'::uuid, 'op-arm3-a'),
  ('0b0b0b00-0000-4000-8000-000000000115'::uuid, 'op-arm3-b'),
  ('0b0b0b00-0000-4000-8000-000000000116'::uuid, 'op-arm4-waiter'),
  ('0b0b0b00-0000-4000-8000-000000000117'::uuid, 'op-stale-revoked'),
  ('0b0b0b00-0000-4000-8000-000000000118'::uuid, 'op-stale-expired'),
  ('0b0b0b00-0000-4000-8000-000000000119'::uuid, 'op-wrong-scope'),
  ('0b0b0b00-0000-4000-8000-000000000120'::uuid, 'op-never-granted'),
  ('0b0b0b00-0000-4000-8000-000000000121'::uuid, 'fin-note-author'),
  ('0b0b0b00-0000-4000-8000-000000000122'::uuid, 'host-other')
) v(x, n);

-- --------------------------------------------------------------------------- the weddings and what is live
INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT x, '0b0b0b00-0000-4000-8000-000000000101'::uuid,
       'Race ' || n, 'en', ARRAY[]::text[], '{}'::jsonb FROM (VALUES
  ('0b0b0b00-0000-4000-8000-000000000001'::uuid, 'w1 arm1 both-operators'),
  ('0b0b0b00-0000-4000-8000-000000000002'::uuid, 'w2 arm2 replay-key'),
  ('0b0b0b00-0000-4000-8000-000000000003'::uuid, 'w3 arm3 key-winner'),
  ('0b0b0b00-0000-4000-8000-000000000004'::uuid, 'w4 arm3 key-loser'),
  ('0b0b0b00-0000-4000-8000-000000000005'::uuid, 'w5 arm4 mid-flight-revoke'),
  ('0b0b0b00-0000-4000-8000-000000000006'::uuid, 'w6 note-fixture'),
  ('0b0b0b00-0000-4000-8000-000000000007'::uuid, 'w7 stale-target'),
  ('0b0b0b00-0000-4000-8000-000000000008'::uuid, 'w8 thread-append')
) v(x, n);

-- w8 gets no version and no publication: the thread-append case must be a ticket nothing can take down, or
-- the append race and a takedown would share a row and neither arm would mean what it says.
INSERT INTO public.invitation_versions (id, wedding_id, version_number, snapshot,
                                        snapshot_schema_version, created_by)
SELECT ('0b0b0b00-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid,
       ('0b0b0b00-0000-4000-8000-00000000000' || i)::uuid,
       1, '{}'::jsonb, 1,
       '0b0b0b00-0000-4000-8000-000000000101'::uuid
  FROM generate_series(1, 7) i;

INSERT INTO public.publications (id, wedding_id, version_id, status, published_at, revoked_at)
SELECT ('0b0b0b00-0000-4000-8000-0000000004' || lpad(i::text, 2, '0'))::uuid,
       ('0b0b0b00-0000-4000-8000-00000000000' || i)::uuid,
       ('0b0b0b00-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid,
       'active', now() - interval '1 hour', NULL
  FROM generate_series(1, 7) i;

INSERT INTO public.guest_households (id, wedding_id, display_name)
VALUES ('0b0b0b00-0000-4000-8000-000000000501'::uuid,
        '0b0b0b00-0000-4000-8000-000000000001'::uuid, 'Race household');

-- The five credential shapes on w1, then one public credential on each wedding a door could reach. The
-- `NULL::timestamptz` casts are load-bearing: in a multi-branch UNION ALL an all-unknown column is resolved
-- to text at the first join and the branch that later supplies a real timestamp fails against it.
-- `rsvp` is included on purpose — the shipped statement names two kinds and the third must survive it.
INSERT INTO private.access_tokens (id, token_hash, token_kind, wedding_id, publication_id, household_id,
                                   expiry_policy, revoked_at, created_at)
SELECT '0b0b0b00-0000-4000-8000-000000000601'::uuid,
       pg_temp.s11f_h64('s11r-token-w1-public'), 'public_invitation',
       ('0b0b0b00-0000-4000-8000-000000000001')::uuid,
       ('0b0b0b00-0000-4000-8000-000000000401')::uuid, NULL, 'no_expiry', NULL::timestamptz,
       now() - interval '1 hour'
UNION ALL SELECT '0b0b0b00-0000-4000-8000-000000000602'::uuid,
       pg_temp.s11f_h64('s11r-token-w1-guest'), 'guest_invitation',
       ('0b0b0b00-0000-4000-8000-000000000001')::uuid,
       ('0b0b0b00-0000-4000-8000-000000000401')::uuid,
       ('0b0b0b00-0000-4000-8000-000000000501')::uuid, 'no_expiry', NULL::timestamptz,
       now() - interval '1 hour'
UNION ALL SELECT '0b0b0b00-0000-4000-8000-000000000603'::uuid,
       pg_temp.s11f_h64('s11r-token-w1-rsvp'), 'rsvp',
       ('0b0b0b00-0000-4000-8000-000000000001')::uuid,
       ('0b0b0b00-0000-4000-8000-000000000401')::uuid,
       ('0b0b0b00-0000-4000-8000-000000000501')::uuid, 'no_expiry', NULL::timestamptz,
       now() - interval '1 hour'
UNION ALL SELECT ('0b0b0b00-0000-4000-8000-0000000006' || lpad((i + 2)::text, 2, '0'))::uuid,
       -- `i + 2`, not `i`: w1 already occupies …0601, …0602 and …0603, so a branch that numbered itself from
       -- its wedding would mint …0602 and …0603 a second time and the whole fixture would die on the primary
       -- key instead of planting the eight credentials the arms count.
       pg_temp.s11f_h64('s11r-token-w' || i || '-public'), 'public_invitation',
       ('0b0b0b00-0000-4000-8000-00000000000' || i)::uuid,
       ('0b0b0b00-0000-4000-8000-00000000040' || i)::uuid, NULL, 'no_expiry', NULL::timestamptz,
       now() - interval '1 hour'
  FROM generate_series(2, 5) i
UNION ALL SELECT '0b0b0b00-0000-4000-8000-000000000608'::uuid,
       pg_temp.s11f_h64('s11r-token-w7-public'), 'public_invitation',
       ('0b0b0b00-0000-4000-8000-000000000007')::uuid,
       ('0b0b0b00-0000-4000-8000-000000000407')::uuid, NULL, 'no_expiry', NULL::timestamptz,
       now() - interval '1 hour';

-- The artefacts, walked through the lifecycle the shipped guard defines rather than written into it: born
-- `registered`, then `uploading`, then `ready` with a digest for the ones that earned bytes, and one
-- `failed` with exactly one attempt and a named reason. `out1c` stays `registered` — an artefact with no
-- object behind it is the shape the invalidation count must not include.
CREATE TEMP TABLE s11f_out (tag text, id uuid, wed int, ver int, kind text, variant text, fmt text,
                            domain text, fate text) ON COMMIT DROP;
INSERT INTO s11f_out (tag, id, wed, ver, kind, variant, fmt, domain, fate) VALUES
  ('out1a', '0b0b0b00-0000-4000-8000-000000000701'::uuid, 1, 1, 'og_image', '1200x630', 'webp',
   'published_preview', 'ready'),
  ('out1b', '0b0b0b00-0000-4000-8000-000000000702'::uuid, 1, 1, 'pdf', 'a4', 'pdf', 'host_private',
   'ready'),
  ('out1c', '0b0b0b00-0000-4000-8000-000000000703'::uuid, 1, 1, 'qr', '40mm', 'png', 'host_private',
   'registered'),
  ('out1d', '0b0b0b00-0000-4000-8000-000000000704'::uuid, 1, 1, 'share_image', '1080x1350', 'png',
   'host_private', 'failed'),
  ('out2',  '0b0b0b00-0000-4000-8000-000000000705'::uuid, 2, 2, 'pdf', 'a4', 'pdf', 'host_private',
   'ready'),
  ('out3',  '0b0b0b00-0000-4000-8000-000000000706'::uuid, 3, 3, 'pdf', 'a4', 'pdf', 'host_private',
   'ready'),
  ('out4',  '0b0b0b00-0000-4000-8000-000000000707'::uuid, 4, 4, 'pdf', 'a4', 'pdf', 'host_private',
   'ready'),
  ('out5',  '0b0b0b00-0000-4000-8000-000000000708'::uuid, 5, 5, 'pdf', 'a4', 'pdf', 'host_private',
   'ready'),
  ('out7',  '0b0b0b00-0000-4000-8000-000000000709'::uuid, 7, 7, 'pdf', 'a4', 'pdf', 'host_private',
   'ready');

INSERT INTO public.invitation_outputs (id, wedding_id, version_id, output_kind, variant, format,
                                       render_config_hash, source_dto_digest, storage_domain, status)
SELECT o.id, ('0b0b0b00-0000-4000-8000-00000000000' || o.wed)::uuid,
       ('0b0b0b00-0000-4000-8000-0000000002' || lpad(o.ver::text, 2, '0'))::uuid,
       o.kind, o.variant, o.fmt, pg_temp.s11f_h64('s11r-config-' || o.tag),
       pg_temp.s11f_h64('s11r-dto-' || o.tag), o.domain, 'registered'
  FROM s11f_out o;

UPDATE public.invitation_outputs SET status = 'uploading'
 WHERE id IN (SELECT id FROM s11f_out WHERE fate <> 'registered');

UPDATE public.invitation_outputs SET status = 'ready',
       content_digest = pg_temp.s11f_h64('s11r-bytes-' || id::text)
 WHERE id IN (SELECT id FROM s11f_out WHERE fate = 'ready');

UPDATE public.invitation_outputs SET status = 'failed', attempt_count = 1,
       last_error = 'the render worker refused the page box'
 WHERE id IN (SELECT id FROM s11f_out WHERE fate = 'failed');

-- The registry as it looks the morning after: every artefact that earned bytes has an object sitting in a
-- bucket, and no body in this tier deletes one. `RD07` re-reads this count to prove the claim.
INSERT INTO storage.objects (id, bucket_id, name)
SELECT gen_random_uuid(),
       CASE WHEN o.domain = 'published_preview' THEN 'invitation-previews' ELSE 'invitation-outputs' END,
       t.object_key
  FROM s11f_out o
  JOIN public.invitation_outputs t ON t.id = o.id
 WHERE t.content_digest IS NOT NULL;

-- --------------------------------------------------------------------------- the money, frozen
-- Two orders and two refunds, only one of which a door is allowed to *read*: the accepted note is written
-- against `…0812` on w6, and the w1 pair exists so the closure census has money rows that every takedown in
-- this tier must leave byte-identical.
INSERT INTO public.entitlements (id, wedding_id, package_code, source, granted_at)
VALUES ('0b0b0b00-0000-4000-8000-000000000801'::uuid,
        '0b0b0b00-0000-4000-8000-000000000001'::uuid, 'classic', 'service',
        now() - interval '2 days');

INSERT INTO private.commerce_orders (id, wedding_id, owner_user_id, merchant_reference, package_code,
                                     price_version, amount_minor, currency, status, quote_expires_at,
                                     captured_at, entitlement_id)
SELECT ('0b0b0b00-0000-4000-8000-0000000008' || lpad(i::text, 2, '0'))::uuid,
       ('0b0b0b00-0000-4000-8000-00000000000' || w)::uuid,
       '0b0b0b00-0000-4000-8000-000000000101'::uuid,
       's11r-ord-' || i, 'classic', 1, 150000, 'INR', 'captured', now() + interval '1 day',
       now() - interval '2 days',
       CASE WHEN i = 1 THEN '0b0b0b00-0000-4000-8000-000000000801'::uuid END
  FROM (VALUES (1, 1), (2, 6)) v(i, w);

INSERT INTO private.commerce_refunds (id, order_id, kind, status, amount_minor, currency,
                                      provider_refund_ref, recorded_at, completed_at)
SELECT ('0b0b0b00-0000-4000-8000-00000000081' || i)::uuid,
       ('0b0b0b00-0000-4000-8000-00000000080' || i)::uuid, 'refund', 'recorded',
       50000, 'INR', NULL, now() - interval '6 hours', NULL
  FROM generate_series(1, 2) i;

-- --------------------------------------------------------------------------- the tickets
-- Nine, one per live subject, and `…0901`/`…0902` are w1's pair: arm 1 needs two operators to be authorised
-- by two *different* tickets, or the case row lock and the publication row lock would collide together and
-- the arm would not say which serialised the pair. The `case_ref` is minted by the shipped trigger; the
-- arms read it back rather than assuming a shape.
INSERT INTO private.support_cases (id, wedding_id, requester_user_id, opened_by_user_id, category,
                                   severity, host_summary)
SELECT ('0b0b0b00-0000-4000-8000-0000000009' || lpad(v.i::text, 2, '0'))::uuid,
       CASE WHEN v.wed IS NULL THEN NULL
            ELSE ('0b0b0b00-0000-4000-8000-00000000000' || v.wed)::uuid END,
       '0b0b0b00-0000-4000-8000-000000000101'::uuid,
       '0b0b0b00-0000-4000-8000-000000000101'::uuid,
       CASE WHEN v.i = 6 THEN 'billing_refund_inquiry' ELSE 'publication_delivery' END,
       'high', 'race tier ticket ' || v.i
  FROM (VALUES (1, 1), (2, 1), (3, 2), (4, 3), (5, 4), (6, 6), (7, 5), (8, 7), (9, 8)) v(i, wed);
-- Every arm gets the ticket of the wedding it acts on, because `operator_authorising_case` requires
-- `c.wedding_id = p_wedding_id` (`20261020190400_stage11_takedown_and_oversight.sql:237-240`) — a ticket
-- about another wedding is a refusal, and a refused plant is not an arm.

-- --------------------------------------------------------------------------- the authority
-- Minted through slice 1's trusted door rather than by hand, so the grant rows and their trail are the real
-- substrate the arms argue about. The door takes no idempotency key and is granted to no role, which is why
-- this runs as the chain owner with no `SET ROLE` — the same shape battery 92 uses.
CREATE TEMP TABLE s11f_grant (ord int, acct uuid, scope text, reason text,
                              exp timestamptz) ON COMMIT DROP;
INSERT INTO s11f_grant (ord, acct, scope, reason, exp) VALUES
  (1, '0b0b0b00-0000-4000-8000-000000000111'::uuid, 'operations',
     'stage11 race arm 1, first operator', NULL),
  (2, '0b0b0b00-0000-4000-8000-000000000112'::uuid, 'operations',
     'stage11 race arm 1, second operator', NULL),
  (3, '0b0b0b00-0000-4000-8000-000000000113'::uuid, 'operations',
     'stage11 race arm 2, both deliveries', NULL),
  (4, '0b0b0b00-0000-4000-8000-000000000114'::uuid, 'operations',
     'stage11 race arm 3, key winner', NULL),
  (5, '0b0b0b00-0000-4000-8000-000000000115'::uuid, 'operations',
     'stage11 race arm 3, key loser', NULL),
  (6, '0b0b0b00-0000-4000-8000-000000000116'::uuid, 'operations',
     'stage11 race arm 4, revoked while the act waits', NULL),
  (7, '0b0b0b00-0000-4000-8000-000000000117'::uuid, 'operations',
     'stage11 race stale shape, revoked below', NULL),
  (8, '0b0b0b00-0000-4000-8000-000000000118'::uuid, 'operations',
     'stage11 race stale shape, lapsed by plant', now() + interval '10 minutes'),
  (9, '0b0b0b00-0000-4000-8000-000000000119'::uuid, 'support',
     'stage11 race stale shape, wrong scope', NULL),
  (10, '0b0b0b00-0000-4000-8000-000000000121'::uuid, 'finance_review',
     'stage11 race note author', NULL);

DO $$
DECLARE r record; v jsonb; n int := 0;
BEGIN
  FOR r IN SELECT * FROM s11f_grant ORDER BY ord LOOP
    SELECT internal_api.grant_operator_role(r.acct, r.scope, r.reason,
             '0b0b0b00-0000-4000-8000-000000000101'::uuid, r.exp) INTO v;
    IF v IS NULL OR NOT (v ? 'grant_id') THEN
      RAISE EXCEPTION 'FAIL fixture: grant %/% answered %', r.acct, r.scope, coalesce(v::text, 'NULL');
    END IF;
    n := n + 1;
  END LOOP;
  IF n <> 10 THEN
    RAISE EXCEPTION 'FAIL fixture: minted % grants, expected 10', n;
  END IF;
END $$;

-- Two of the ten are made stale here rather than in an arm, because a lapsed grant cannot be minted (the
-- body refuses a past expiry) and only a *committed* revocation is the shape the arms need: a revoked row
-- is what "this account used to be able to do this" looks like in the table.
DO $$
DECLARE v jsonb;
BEGIN
  SELECT internal_api.revoke_operator_role('0b0b0b00-0000-4000-8000-000000000117'::uuid, 'operations',
         'stale before any arm runs', '0b0b0b00-0000-4000-8000-000000000101'::uuid) INTO v;
  IF v IS NULL OR NOT (v ? 'grant_id') THEN
    RAISE EXCEPTION 'FAIL fixture: the pre-arm revocation answered %', coalesce(v::text, 'NULL');
  END IF;
END $$;

-- The expiry plant moves *both* timestamps together, which is the write the shipped CHECK allows on the
-- trusted channel (`85_support_lifecycle.sql` V47/V48 measured the one-column version as a refusal): the row
-- stays `active` and only `expires_at` makes it unusable, which is exactly where a real credential sits when
-- it lapses with no cleanup job anywhere.
UPDATE private.operator_grants
   SET granted_at = '2026-01-01T00:00:00+00'::timestamptz,
       expires_at = '2026-01-02T00:00:00+00'::timestamptz
 WHERE user_id = '0b0b0b00-0000-4000-8000-000000000118'::uuid AND scope = 'operations';

-- --------------------------------------------------------------------------- the one accepted note act
-- Written by the shipped door, as the caller it belongs to, before any arm runs. `RD05` needs a real first
-- act under a real key for the *other* body to collide with, and a hand-plant would prove the index rather
-- than the collision the two bodies actually have.
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.s11f_as('0b0b0b00-0000-4000-8000-000000000121'::uuid,
        'SELECT api.operator_add_commerce_review_note('
      || '''0b0b0b00-0000-4000-8000-000000000812''::uuid, '
      || quote_literal((SELECT c.case_ref FROM private.support_cases c
                         WHERE c.id = '0b0b0b00-0000-4000-8000-000000000906'::uuid)) || ', '
      || '''in_review'', '
      || quote_literal('fixture note: the refund is under review; no money moved here') || ', '
      || '''0b0b0b00-0000-4000-8000-000000000306''::uuid)');
  IF v IS NULL OR NOT (v ? 'note_id') OR coalesce((v ->> 'replayed')::boolean, false) THEN
    RAISE EXCEPTION 'FAIL fixture: the note door answered %', coalesce(v::text, 'NULL');
  END IF;
END $$;

-- --------------------------------------------------------------------------- what the arms take as given
DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v FROM public.publications p
   WHERE p.status = 'active' AND p.wedding_id < '0b0b0b00-0000-4000-8000-000000000008'::uuid;
  PERFORM pg_temp.s11f_ok('the seven weddings w1–w7 each present exactly one active publication '
    || '(w8 presents none, by design)', v = 7);

  SELECT count(*) INTO v FROM private.support_cases c
   WHERE c.status = 'open' AND c.case_ref ~ '^SV-[A-Z2-7]{8}$';
  PERFORM pg_temp.s11f_ok('all nine tickets are open and carry a minted SV- reference, so no refusal in '
    || 'this tier can be explained by the authorising case', v = 9);

  SELECT count(*) INTO v FROM private.operator_grants g WHERE g.status = 'active';
  PERFORM pg_temp.s11f_ok('nine grants are live after one revocation, and the tenth account holds no grant '
    || 'at all — the never-granted control the stale sentences are compared against', v = 9);

  SELECT count(*) INTO v FROM private.audit_events a
   WHERE a.action = 'granted' AND a.subject_type = 'operator_grant';
  PERFORM pg_temp.s11f_ok('the trail carries one row per minted grant, so an arm that reads the trail is '
    || 'reading the doors'' own writes rather than a fixture shortcut', v = 10);

  SELECT count(*) INTO v FROM private.commerce_review_notes n
   JOIN private.audit_events a ON a.subject_key = n.id AND a.action = 'commerce_review_note_added';
  PERFORM pg_temp.s11f_ok('the one accepted note act left one note row and one trail row, which is the '
    || 'first act RD05 collides a takedown key against', v = 1);

  SELECT count(*) INTO v FROM private.access_tokens t
   WHERE t.revoked_at IS NULL;
  PERFORM pg_temp.s11f_ok('every credential in the fixture is live at the start, so a revoked one later is '
    || 'an effect and not a plant', v = 8);

  SELECT count(*) INTO v FROM public.invitation_outputs o WHERE o.status = 'ready';
  PERFORM pg_temp.s11f_ok('seven artefacts have bytes and none is yet invalidated, while the registered and '
    || 'failed rows are in place to be counted as untouched', v = 7);

  SELECT count(*) INTO v FROM storage.objects;
  PERFORM pg_temp.s11f_ok('the bucket registry holds one object per artefact that earned bytes, which is '
    || 'the number no body in this tier may change', v = 7);

  SELECT count(*) INTO v FROM private.audit_events;
  PERFORM pg_temp.s11f_ok('the trail this tier grows starts at the fixture''s own twelve rows — ten grants, '
    || 'one revocation, one note — and every closure count below is stated against that baseline', v = 12);
END $$;

SELECT 'STAGE11 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s11f.passed', true), ''), '0')::int || ')' AS result;
