# Stage 3 audit — public invitation vertical slice, qualified against a real local Supabase API stack

Executed by the coding agent as a single stage. Reviewer: ChatGPT (auditor / technical auditor /
product controller / stage reviewer). Every number below was printed by a command that ran on this
machine; each section names the command or the assertion that produced it, so a claim can be
re-measured rather than re-believed. Where something was **inferred rather than executed, it says so
in those words.** Sections are added as the stage's phases complete; a section that is not yet here
means the phase has not been run, not that it passed.

This document does not calculate a project completion percentage. That is the reviewer's job.

## 1. Starting point

`e93912d780fc813e1e9b79bf8858638cbec4fd6b` — `origin/main`, the Stage 1 merge closure, which is also
`git merge-base origin/main HEAD`. Stage 2 closed on `a51856fbc038505f4318378543c306f82fb92b27` of
`stage2/domain-database-redesign`; that branch was **not** merged into `main` by the reviewer, so
Stage 3 is built on top of the Stage 2 branch rather than on `main`, and Stage 2's work is present in
this branch's history.

Re-measure: `git merge-base origin/main HEAD` and `git ls-remote origin refs/heads/main`.

## 2. Branch

`stage3/public-invitation-vertical-slice`, pushed as its own branch. Not merged into `main`. No tag,
no release, no deployment. `git ls-remote --tags origin` printed nothing at the time of writing.

## 3. The Stage 2 draft-invariant gap, closed in the database

Stage 2 §25 limitation 2 recorded the real gap: the domain says one draft per wedding, the migration
path honoured that, but `createWedding()` inserted only a `weddings` row — so a wedding made through
the product had no draft at all.

### 3.1 Options considered

| Option | What it meant | Why |
| --- | --- | --- |
| A. `AFTER INSERT` trigger on `public.weddings`, `SECURITY INVOKER`, inserting the draft under the caller's own policies | The invariant becomes a database guarantee, true for every writer including a direct REST insert | **Chosen.** No new API-reachable function, no new trust surface, and the pairing is inside the creating transaction, so there is no instant at which a wedding exists undrafted |
| B. One `SECURITY DEFINER` RPC that creates wedding + draft "atomically" | The app calls one function | Rejected: PostgREST gives a browser no multi-statement transaction, so "atomically" forces a definer function — a new API-reachable surface that must re-implement the ownership check, and a second copy of that check is one that can disagree with RLS |
| C. Application code inserts both rows, in the client | Simplest diff | Rejected: it makes a documented invariant enforced "by whoever remembers", and it turns a read (open the editor) into a write (create the missing draft) |

### 3.2 What was written

`supabase/migrations/20260926120000_stage3_wedding_draft_invariant.sql`:
`private.attach_draft_on_wedding_create()` (`SECURITY INVOKER`, `SET search_path = ''`,
`ON CONFLICT (wedding_id) DO NOTHING`), revoked from `PUBLIC, anon, authenticated` per the project's
per-object REVOKE rule, attached as trigger `weddings_have_draft`.

The residual is stated in the migration and in `docs/architecture/domain-model.md`: the owner keeps
`DELETE` on its own draft (Stage 2's measured cascade semantics mean a role-name guard cannot refuse
a delete, and forbidding the delete would need a trusted-only table the editor has to write), so a
deliberate delete leaves the wedding undrafted and the editor must re-create it. This is not closed
silently.

### 3.3 Measured

`bash supabase/tests/stage2/run.sh`, on both chains, after the migration:

| Suite | clean chain | legacy chain |
| --- | --- | --- |
| `10_schema_invariants` | 41 | 75 |
| `20_attacks` | 322 | 322 |
| `30_migration_legacy` | — | 75 |
| `40_catalog` | 75 | 75 |
| `stage3/20_draft_invariant` (new) | 38 | 41 |

`bash supabase/tests/rls/run.sh` → 24. Stage 2's own counts are unchanged at schema head, so the
Stage 3 migration loosened no Stage 2 guarantee; the numbers above are re-measurements, not
restatements. `40_catalog`'s trigger inventory (C31) gained `public.weddings.weddings_have_draft`, and
its count stayed 75, which is what "the inventory is exact" means.

The new suite proves: pairing for a second owner and for `service_role`; content `{}` and
`updated_at = created_at`; a duplicate draft refused with 23505 and an orphan with 23503; another
account's INSERT refused with 42501 and its UPDATE/DELETE reaching zero rows; a fault injection
(a temporary `BEFORE INSERT` guard on `invitation_drafts`) that aborts the wedding creation with no
wedding and no draft left; `DISABLE TRIGGER` refused with 42501; and the universal invariants — no
wedding with more than one draft, no draft without a wedding, the function not executable by any API
role including `service_role`.

## 4. The real local Supabase stack

Stage 2's largest qualification gap was that PostgREST, JWT issuance and the browser path were
unverified: its suites played database roles inside psql with `SET ROLE`. This section is the
environment that closes it.

### 4.1 What was already running, and what was left alone

`docker ps` before starting anything showed a **complete unrelated Supabase stack for a project
called DueWeave** on the CLI defaults (54321/54322/54323/54324/54327) plus a crash-looping
`supabase_vector_dueweave` that pre-dates this stage. None of it was touched, stopped, reconfigured,
read or restarted. This repository's stack was created on a separate port block so that starting it
could not bind, reuse or reconfigure the other project's containers:

| Service | Container | Host port | Image |
| --- | --- | --- | --- |
| API gateway | `supabase_kong_localvivaahvarnam` | 54400 → 8000 | `public.ecr.aws/supabase/kong:2.8.1` |
| PostgREST | `supabase_rest_localvivaahvarnam` | (internal) | `public.ecr.aws/supabase/postgrest:v16.3` |
| GoTrue / Auth | `supabase_auth_localvivaahvarnam` | (internal) | `public.ecr.aws/supabase/gotrue:v2.197.0` |
| Postgres | `supabase_db_localvivaahvarnam` | 54401 → 5432 (shadow 54402) | `public.ecr.aws/supabase/postgres:17.6.1.171` |
| Local SMTP capture | `supabase_inbucket_localvivaahvarnam` | 54403 → 8025 | `public.ecr.aws/supabase/mailpit:v1.30.2` |

`PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit` (printed by
`select version()` through `docker exec`). CLI `v2.118.0` — read from `supabase/.temp/cli-latest`,
which is why that file is deleted in §31's cleanup only after this record exists. Realtime, storage,
studio, analytics, edge runtime and the pooler are disabled in `supabase/config.toml`: this stage
needs Postgres, PostgREST, GoTrue and the gateway, and nothing else.

`project_id` is the synthetic `localvivaahvarnam`. That matters beyond naming: it replaced the
Lovable-era hosted project ref that was in this file, and with a hosted-looking ref present, a future
`supabase link` / `db push` could have resolved a real project by accident. It now names nothing that
exists remotely.

### 4.2 Migrations applied from zero

`npx supabase db reset --local --no-seed` — the `--local` flag is explicit, not implied. Result:
14 of 14 files in `supabase/migrations` recorded in `supabase_migrations.schema_migrations`, 18
tables in `public`, 46 policies, and `weddings_have_draft` present with `is_definer = f`. This is a
second, independent engine for the same schema files Stage 2 proved on `postgres:16-alpine`.

No seed file was applied, so the stack's `public.weddings` started empty — which is also why the §5
run's post-condition ("back to 0 rows") is a meaningful leak test.

### 4.3 Proof that no remote was contacted — and its limits

What is actually established, in order of strength:

1. **Command shape.** Every `supabase` command used in this stage targeted the local engine:
   `db reset --local`, `start`, `status`. `link`, `db push`, `db pull`, `db reset --linked` and every
   other remote-resolving verb were never run.
2. **No link state.** `supabase/.temp/` contains only `cli-latest`. Supabase records a linked project
   there, so there is no project for a remote-resolving command to resolve to.
3. **Nothing to resolve.** The hosted project ref that was in `config.toml` has been replaced by a
   synthetic id. A repository-wide scan of tracked files (`git grep -cE "hgvztvaoebe"`, and
   `git grep -lE "eyJ[A-Za-z0-9_-]{20,}"` for JWT-shaped material) leaves exactly one hit — the
   Stage 2 audit recording the ref as a finding — and no tokens anywhere. So no tracked file carries
   either a credential or a resolvable hosted target.
4. **The suite refuses on its own.** `supabase/tests/api/run.sh` exits before running anything unless
   `SUPABASE_LOCAL_URL` is a loopback host *and* its port equals the `[api] port` in this
   repository's `supabase/config.toml`; the test file repeats the loopback check in code as a second
   gate. A mistaken `.env.local` pointing at the DueWeave stack on 54321 fails both.
5. **`.env.local` only.** The suite reads `.env.local` (gitignored, written by this stage to point at
   localhost) and never reads `.env`, which still carries the historical hosted project's public
   defaults.

What is **not** established: this is configuration-, command- and code-level evidence, not
packet-level evidence. No network capture was run, so "no remote was contacted" is a statement about
what the tools were told to do, not a proof derived from the wire. Separately, `npx supabase …` does
reach the npm registry when the CLI is not installed on this machine (it is not on `PATH`; the CLI is
fetched/cached). That is a third-party network request made by a *tooling* command, not by the test
suite, and the API suite itself deliberately shells out to nothing that could repeat it — its
version block reads container metadata and `cli-latest` instead of calling `npx`. The stage's overall
network report is §30's job and will not claim "zero network".

### 4.4 One container this stage did not create but must disclose

A leftover `s2types` container (`postgres:16-alpine`, port 54331) was found running. Stage 2 §26
recorded its throwaway containers as "all removed"; this container contradicts that, so either the
Stage 2 cleanup was incomplete or something else started it. It was not used by any Stage 3 command.
It is removed in §31 along with its volume, because it is this project's own scratch and leaving it
running is a lie about the machine's state.

## 5. API-level security qualification

`bash supabase/tests/api/run.sh` → **56 tests, 56 pass, 0 fail**, run twice consecutively with
identical results (the second run is the idempotency check: nothing the first run wrote changed what
the second observed). Suite: `supabase/tests/api/stage3_security.test.mjs`.

Everything below is driven through `@supabase/supabase-js` and raw `fetch` against kong:54400, so
each assertion travels through HTTP → Kong → PostgREST → role → RLS → trigger → constraint. Two hosts
and an anonymous client, all synthetic (`host-a+<run-tag>@example.test`, `example.test` being
documentation-reserved), created by `auth.signUp` on the local GoTrue.

### 5.1 The mechanisms `SET ROLE` could not reach

* `auth.uid()` is proven to read a **real GoTrue-issued claim**: host A's `SELECT` on its own wedding
  succeeds because of the token, and after `signOut({ scope: 'local' })` the identical request fails
  42501 with no data. Losing the credential loses the row.
* Signup authored `profiles` and exactly one `user_roles` row (`'user'`) — evidence about
  `private.handle_new_user`, the schema's only `SECURITY DEFINER` function, fired by the platform
  rather than by a hand-made `INSERT INTO auth.users`.
* **A tampered JWT is rejected before the database.** Rewriting the `sub`/`role` claims of a valid
  token while keeping its original signature yields HTTP 401, code `PGRST301`
  ("No suitable key or wrong key type"), and the row is not returned. A non-JWT bearer fails the same
  way. Identity is not self-declared at this boundary.

### 5.2 The Stage 3 invariant, through HTTP

A wedding created by a REST `POST` arrives with exactly one draft, `content = {}`, and
`updated_at = created_at`; a second draft for it is refused `23505`
(`invitation_drafts_wedding_id_key`); the paired draft is editable by its owner. §3's trigger is now
qualified on the platform image as well as in the throwaway chains.

### 5.3 Cross-account isolation

Both directions, on every surface §5 names:

| Write aimed at the other account | Measured answer |
| --- | --- |
| read wedding | `[]`, no error — silence, not an enumeration signal |
| update title / `style_settings` / `primary_language` / `lifecycle_status` | `[]` rows changed; the same patch by the owner changes 1 |
| read / update / delete the draft | `[]`, `[]`, `[]`; the row survives and its owner can still delete it |
| insert `wedding_people` / `venues` / `wedding_events` / `guest_households` / `wedding_assets` | 42501 "new row violates row-level security policy" — each paired with the same insert against the attacker's own wedding succeeding |
| re-parent own venue onto the other wedding | 42501, while the same UPDATE to a wedding the attacker owns succeeds |
| update / delete the other account's person, event, venue rows | `[]` each, owner's copy verified present afterwards |

### 5.4 The anonymous surface

All 18 `public` base tables refuse an anonymous `SELECT` with 42501 and `data = null`. Writes
(`weddings`, `invitation_drafts`, `entitlements`, `user_roles`, `profiles`) and a delete are refused
by the **privilege** layer — measured as "permission denied for table", which is the stronger answer:
there is no policy to forget to add later. `Prefer: count=exact` returns HTTP 401 with no
`Content-Range` header, so the row count is not enumerable either.

### 5.5 What an authenticated customer may never do

| Attempt | Measured layer |
| --- | --- |
| mint an entitlement | 42501 permission denied for table — and the trusted path writes the identical row, so the payload is not the reason |
| insert / update / delete a frozen version | 42501 all three; the owner can still read it and the trusted path can still write history |
| create a publication | 42501; the trusted publication of the same version succeeds |
| create a wedding owned by another account | 42501 row-level security; own-owner control succeeds |
| grant itself or another account `admin` | 42501; `SELECT` on roles returns only its own rows |
| read `access_tokens`, `audit_events`, `projects`, `guests`, `payments`, `templates` | `PGRST205` for all three roles — the relation is not an addressable REST object at all. `run.sh` asserts in SQL, before the suite runs, that each of these tables really exists, so this cannot pass by their absence |

### 5.6 Constraints survive the HTTP translation

Policy `WITH CHECK` (a legal row claiming the wrong wedding) → 42501. Table `CHECK`s → 23514 naming
the exact constraint: `weddings_title_check`, `weddings_estimated_guest_count_check`,
`weddings_primary_language_check`, `weddings_style_settings_check`. An invented column → `PGRST204`
("Could not find the 'is_paid' column"), never silently dropped, and the same insert without it
succeeds.

### 5.7 What the API is allowed to say back, and one finding

A hidden foreign row is indistinguishable from a row that never existed: `[]` for host B's id and for
`00000000-0000-0000-0000-000000000000`, on both `weddings` and `invitation_drafts`, with no error on
either. Malformed input is a typed rejection (`22P02`) with no stack-shaped `details` and no path in
its `hint`. No response a customer can receive contains the service-role key, the secret key or the
run password.

**FINDING (low severity, product-relevant).** PostgREST v16 attaches a repair `hint` to privilege
errors. To an **anonymous** caller, `GET /rest/v1/weddings` answers:

```json
{"code":"42501","hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.weddings TO anon;","message":"permission denied for table weddings"}
```

That names a schema-qualified object and a database role to an unauthenticated requester. It is not a
credential and it discloses no row, so it is not a data exposure; but it is internal vocabulary, and
§5 asks specifically whether errors expose internal information *through the product UI*. The rule
this produces is enforced by the test that pins the hint's shape: **the product must surface its own
copy, never `error.hint`, and never `error.message` verbatim.** §26's truthfulness pass and the editor
error states in §9 have to honour that rule.

**FINDING (low severity, UX).** A HEAD count
(`select('*', { count: 'exact', head: true })`) is refused with an error object whose `message` is
empty and whose `code` is absent — the count does not leak, but a UI keying off `error.code` would
render nothing at all for it. Asserted in `§5.4` so the behaviour is recorded rather than assumed.

### 5.8 What this still does not prove

Stated as findings, because §5's evidence is only as good as its declared boundary.

1. **Nothing here exercises Kong's own request limits, rate limiting or TLS termination**, because the
   local gateway runs with the CLI's defaults and the suite talks plain HTTP to loopback. A hosted
   deployment's gateway configuration is not qualified by this file.
2. **Email flows are still unverified.** Confirmations are switched off for this stack, so
   `enable_confirmations = false` is what the signup assertions above depend on; a magic-link or
   recovery path was not exercised.
3. **PostgREST configuration tuning is only tested at the shape the repository sets**: `schemas =
   ["public"]` and `max_rows = 1000`. The suite proves that the *unexposed* schemas are unreachable,
   but does not prove anything about a different configuration.
4. **Realtime, Storage and Edge Functions are disabled on this stack**, so nothing in this stage can
   claim behaviour about them. Stage 3 §6's resolution boundary is constrained by that, and its
   decision record says so.
5. The Stage 2 SQL suites remain the authority on grants, policies and triggers; this API suite
   supplements them against one engine version and was not run against `postgres:16-alpine`.

## 6. Publication security model

_(to be written when §6 lands.)_

## 7. Rendering contract, editor and preview

_(to be written when §7–§13 land.)_

## 8. Gates, browser E2E, cleanup and push

_(to be written when §28–§33 land.)_
