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
| A. `AFTER INSERT` trigger on `public.weddings`, `SECURITY INVOKER`, inserting the draft under the caller's own policies | The invariant becomes a database guarantee, true for every writer including a direct REST insert | **Chosen, and written as file 120000.** No new API-reachable function, no new trust surface, and the pairing is inside the creating transaction, so there is no instant at which a wedding exists undrafted. Option C below is what forced §3.2's second file: as long as the caller could delete its own draft, INVOKER was the only body that fitted, and closing that hole took the privilege away from the caller — see §3.2 for the DEFINER swap that followed and why it is the same change rather than a reversal |
| B. One `SECURITY DEFINER` RPC that creates wedding + draft "atomically" | The app calls one function | Rejected: PostgREST gives a browser no multi-statement transaction, so "atomically" forces a definer function — a new API-reachable surface that must re-implement the ownership check, and a second copy of that check is one that can disagree with RLS |
| C. Application code inserts both rows, in the client | Simplest diff | Rejected: it makes a documented invariant enforced "by whoever remembers", and it turns a read (open the editor) into a write (create the missing draft) |

### 3.2 What was written

`supabase/migrations/20260926120000_stage3_wedding_draft_invariant.sql`:
`private.attach_draft_on_wedding_create()` (`SECURITY INVOKER` at this point, `SET search_path = ''`,
`ON CONFLICT (wedding_id) DO NOTHING`), revoked from `PUBLIC, anon, authenticated` per the project's
per-object REVOKE rule, attached as trigger `weddings_have_draft`.

That file left one residual and said so in its own header: the owner kept `DELETE` on its own draft,
so a deliberate delete could still leave a wedding undrafted. `supabase/migrations/20260926140000_stage3_close_draft_invariant.sql`
closes it rather than restating it — the header of the earlier file is now *false on one point*, which
is recorded there and here rather than edited away:

* the feared consequence was wrong. File 120000 said refusing a client `DELETE` would break
  wedding-cascade cleanup; Stage 2's own suite had already measured that a FK cascade runs as the
  child table's owner, not as the role that deleted the parent, so a cascade never needed the
  owner's `DELETE` privilege. Test F of `supabase/tests/stage3/20_draft_invariant.sql` re-measures
  that on this branch instead of trusting the paragraph;
* `REVOKE INSERT, DELETE ON public.invitation_drafts FROM anon, authenticated`, and
  the two policies that authorised them (`owners_manage_own_draft`, `owners_delete_own_draft`) are
  dropped. `SELECT` and `UPDATE` keep theirs;
* the trigger function therefore becomes `SECURITY DEFINER` — the same change, not a follow-up,
  because an INVOKER trigger would insert as `authenticated` against a table it can no longer write.
  `CREATE OR REPLACE` swaps the privilege with no window in which a wedding could be created
  undrafted. EXECUTE stays revoked from `PUBLIC, anon, authenticated`; the function lives in
  `private`, takes no caller argument, branches on no session state, and touches one
  fully-qualified relation, which is the narrowest form of the concern Stage 2 raised about definer
  functions. `private.handle_new_user` is the existing precedent, and catalogue check C26 now holds
  both names.

What remains allowed, stated as the correct residual rather than a gap: deleting a wedding still
cascades to its draft (one aggregate), and a *trusted* role (`postgres`, `service_role`) can still
delete a draft directly, because support repair has to stay possible. The assertion the suite makes is
"no operation a customer can perform through the API leaves a wedding undrafted", not "nothing can
ever delete a draft".

### 3.3 Measured

`bash supabase/tests/stage2/run.sh both`, on both throwaway chains, at schema head (this branch's
head includes both Stage 3 migrations and the Stage 3 §6 boundary):

| Suite | clean chain | legacy chain |
| --- | --- | --- |
| `stage2/30_migration_empty` / `30_migration_legacy` | 41 | 75 |
| `stage3/20_draft_invariant` | 46 | 49 |
| `stage3/30_publication` | 246 | 246 |
| `stage2/20_attacks` | 325 | 325 |
| `stage2/40_catalog` | 86 | 86 |

`bash supabase/tests/rls/run.sh` → 24.

**The count changes are investigated, not explained away.** Stage 2 closed at 41 / 75 / 322 / 75 for
the suites it owned (`run.sh`'s header still records that, and it remains reproducible from
`a51856f`). Two of its totals moved: `20_attacks` 322 → 325 and `40_catalog` 75 → 86. Diffing the two
files against `a51856f` shows why: +108 and +259 lines respectively, and the number of
`passed := passed + n` sites in `20_attacks.sql` goes from 43 to 48 — Stage 3 *added* assertions (a
draft-invariant INSERT/DELETE refusal at the grant layer, and the `api` schema's place in the
callable and definer inventories). **No `passed :=` line was deleted** (`git diff a51856f...HEAD` over
the two files contains none), and the ~20 removed lines that do appear are hand-inserted
`invitation_drafts` seeds the `weddings_have_draft` trigger makes unnecessary, plus the old spelling
of checks C13/C17/C26 that reappear widened rather than vanishing. So the rise is the suites getting
stricter, not a guarantee being lost — which is the only reading under which "Stage 2's numbers are
unchanged" would have been a true sentence, and it is why that sentence is not used here.

`20_draft_invariant` proves, per chain: pairing for a second owner and for `service_role`; content
`{}` and `updated_at = created_at`; a duplicate draft refused with 23505 and an orphan with 23503;
another account's draft INSERT and DELETE refused with 42501 **"permission denied for table"** (the
grant layer, the stronger answer) and its UPDATE refused with 42501 **"row-level security"**; a fault
injection (a temporary `BEFORE INSERT` guard on `invitation_drafts`) that aborts the wedding creation
with no wedding and no draft left; `ALTER TABLE … DISABLE TRIGGER` refused with 42501; the wedding
cascade still retiring the draft; a trusted role still able to delete a draft on its own; and the
universal invariants — no wedding with more than one draft, **no wedding without one**, no draft
without a wedding, and the trigger function not executable by any API role including `service_role`.

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
| PostgREST | `supabase_rest_localvivaahvarnam` | (internal) | `public.ecr.aws/supabase/postgrest:v16.2` |
| GoTrue / Auth | `supabase_auth_localvivaahvarnam` | (internal) | `public.ecr.aws/supabase/gotrue:v2.196.0` |
| Postgres | `supabase_db_localvivaahvarnam` | 54401 → 5432 (shadow 54402) | `public.ecr.aws/supabase/postgres:17.6.1.167` |
| Local SMTP capture | `supabase_inbucket_localvivaahvarnam` | 54403 → 8025 | `public.ecr.aws/supabase/mailpit:v1.30.2` |

`docker ps --format '{{.Names}}\t{{.Image}}'` printed those five image tags at the end of the stage,
and they correct the first draft of this table, which had PostgREST v16.3, GoTrue v2.197.0 and the
`17.6.1.171` Postgres image. The independent check on the row that matters most for §5.7's error
hygiene is the response header: every PostgREST answer recorded in §5 and §8.3 carries
`server: postgrest/16.2`, so the running engine and the image tag agree. The misreading was not
catchable from a version field in a response body, because this deployment answers with the header
only.

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

Stage 2 laid down the relational shape — immutable `invitation_versions`, one active `publications`
row per wedding, `private.access_tokens` — and stopped short of *issuing* a credential or *reading one
back*. Stage 3 does both, inside the database, in
`supabase/migrations/20260926130000_stage3_publication_resolution_boundary.sql` (1059 lines). Measured
by `supabase/tests/stage3/30_publication.sql` (**246 assertions, both chains**) and
`supabase/tests/api/stage3_publication.test.mjs` (**34 tests, API01–API34, through Kong**).

### 6.1 The decision, and what it was weighed against

An Edge Function boundary was evaluated first, as §6 required, and rejected on four grounds written
into the migration's header: every invariant a publication must respect is already relational (the
composite FK `publications (wedding_id, version_id) → invitation_versions (wedding_id, id)` makes
"wedding A publishes wedding B's version" *unrepresentable*, where a TypeScript boundary would make it
an `if`); this repository's gates cannot read a Deno function (`deno` is absent from PATH, and the one
edge image cached locally ships `edge-runtime` with no `deno` binary, so there is no
lint/typecheck/test to wire — measured while deciding, not assumed); a second runtime is a second
copy of the whitelist to rot; and Stage 0 turned `[edge_runtime]` off deliberately after deleting this
repository's only function. What the RPC does *not* buy is recorded in the same header: no per-IP rate
limiting, no request-scoped metadata, nothing between browser and Postgres but Kong and PostgREST.

### 6.2 The callable surface

`api` holds exactly seven functions. All are `SECURITY DEFINER`, owned by `postgres`, with
`SET search_path = ''` and fully-qualified bodies; all are `REVOKE ALL … FROM PUBLIC` first and
granted to their exact caller set second:

| Function | Granted to | What it may do |
| --- | --- | --- |
| `api.create_invitation_version(p_wedding_id uuid)` | `authenticated` | freeze the current draft as a new immutable version |
| `api.preview_invitation(p_wedding_id uuid)` | `authenticated` | the same DTO a guest would see, drawn from the live draft, for the owner only |
| `api.publish_invitation_version(p_wedding_id, p_version_id, p_expires_at)` | `authenticated` | point the wedding's one live link at a version; mints a credential only when there is no live link to reuse |
| `api.get_invitation_publication_state(p_wedding_id uuid)` | `authenticated` | version history + whether a link is live; never a credential |
| `api.rotate_invitation_token(p_wedding_id uuid)` | `authenticated` | revoke the live credential and mint a replacement for the *same* version |
| `api.revoke_invitation_publication(p_wedding_id uuid)` | `authenticated` | take the link down; permanent |
| `api.resolve_public_invitation()` | `anon`, `authenticated` | the guest door — zero arguments |

`service_role` is absent from the last row deliberately (it has no `USAGE` on `api` at all; it writes
the tables the boundary exists to protect), and a grant to a role that cannot reach the schema would
read as an invitation to "fix" that later. **API33** asserts the seven names are the whole schema and
that no eighth exists; **API34** asserts `api` is functions-only — no table, view or sequence — and
that nothing else in an exposed or private schema is executable by a browser role. The SQL half is
`40_catalog`'s C26/C28a/C28b/C29/C30/C32, which is the same inventory read from the catalog rather
than from a request.

### 6.3 The credential

`private.mint_public_invitation_token` takes 32 bytes from `extensions.gen_random_bytes` (the backend
CSPRNG) and writes
`rtrim(translate(encode(…, 'base64'), '+/', '-_'), '=')`: **256 bits of entropy in 43 URL-safe
characters**, so the address is dictatable over a phone call and needs no percent-encoding in a chat
app. Only `encode(digest(convert_to(raw, 'UTF8'), 'sha256'), 'hex')` is stored — `convert_to` is
spelled out so the hash covers the token's UTF-8 bytes rather than whatever `text::bytea` would yield
under a session's client encoding. The raw string exists in exactly one HTTP response, the one that
minted it.

No constant-time comparison is used, and the reason is stated rather than waved at: the lookup is an
equality probe on a unique index over the digest, so no code path compares two secrets byte by byte
and there is no partial-match signal to time. **API16** checks the credential is nowhere a reader can
recover it, and **API13** checks the state a host reads back carries no credential material — which is
why the panel's honest answer after a reload is "copy it from where you shared it, or make a new
link" (§7.4).

**Divergence, stated rather than glossed.** §I's literal signature was
`api.resolve_public_invitation(raw_token text)`; §H says "never put the token in a query string". Under
PostgREST those two instructions cannot both be obeyed: a function *with* arguments is addressable as
`GET /rest/v1/rpc/resolve_public_invitation?p_raw_token=…`, which is precisely the leak §H forbids (and
PostgREST will accept a GET against a volatile function). The built resolver takes **zero arguments**
and reads the credential from `current_setting('request.headers', true)::jsonb ->> 'x-invitation-token'`
— written by PostgREST, never by the caller. **API15** proves both halves of the consequence: the
token never appears in a URL the suite can observe, and a request that tries to pass it as a query
parameter is refused. The residual this leaves is disclosed, not hidden: the *browser address* is
still `/i/<token>`, because a shareable link has to carry its own credential and the SPA route reads
it from the path; that string is therefore in the visitor's history and in any access log that records
paths. What is eliminated is the API hop repeating it as a query string, and **API22**'s whitelist plus
§7's DTO keep it out of every response body.

### 6.4 Liveness rules and the one generic refusal

`private.invitation_for_token` is the whole policy in seven predicates: shape (43 bytes, URL-safe
alphabet) checked *before* hashing so junk never reaches arithmetic; digest equality; `token_kind`;
`revoked_at IS NULL`; `expires_at IS NULL OR expires_at > now()`; the publication still `active`; and
the composite join tying publication → version → the same wedding. Every failure returns `NULL`, which
`api.resolve_public_invitation` renders as the identical `{"available": false}`.

**API23** feeds it eleven kinds of wrong — absent header, empty, too short, right length wrong
alphabet, right alphabet short, right shape never minted, twice the length, base64 padding, a real
token with one character changed, a real token with a space *inside* it, a SQL fragment — and asserts
each is HTTP 200 with a body deep-equal to `{"available": false}`. One case is deliberately excluded
and the exclusion is measured: `' <token> '` *succeeds*, because RFC 9110 §5.5 has the recipient strip
surrounding whitespace, which the first draft of this test discovered by failing. **API31** shows an
expired credential is indistinguishable from one that was never real, and **API24** that a signed-in
visitor gets the same answer as an anonymous one.

### 6.5 What a guest may learn

**API21** pins the shape: `{available, invitation}` at the top, exactly the eleven whitelist names
`private.public_invitation_dto` emits (`title`, `language`, `style`, `design_template`,
`tradition_pack`, `people`, `events`, `welcome`, `family_introduction`, `event_notes`, `closing`), and
inside them `language = {additional, primary}`, `style = {alignment, color, font, fontSize}`.
`version_number` and `heading` are asserted absent by name: a version counter is a fact about the
database, not about the wedding. **API22** walks the whole response and fails on any key among 23
banned names (`token`, `hash`, `owner_user_id`, `wedding_id`, `rsvp`, `paid_status`, `id`, …) — so an
addition to the snapshot cannot reach a guest without a whitelist edit.

Two content rules, each with its own positive control (§M):

* **Text is never markup.** **API25** writes `<img src=x onerror="alert(1)"> &amp; <script>boom()</script>`
  through the host's own draft, freezes and publishes it, and asserts the guest receives those bytes
  unchanged — the database does not sanitise, because the renderer puts no markup in the page (§7.2).
* **A map link is https or nothing.** **API26** tries `javascript:`, `data:`, `file:`, a
  protocol-relative link and an upper-case scheme through the browser's own `UPDATE`; all five are
  refused `23514` by the column's `^https://` CHECK, and the same write of an `https` link succeeds and
  reaches the guest through a published version. The projection's *independent* re-check — needed
  because a frozen snapshot is older than tomorrow's constraint — is proven where a hand-built history
  row can be fed to it, `30_publication.sql` D32. That re-check has a second, accidental witness:
  seeding §8's six shapes through the real API hit the same `venues_map_url_check` on a `javascript:`
  URL and aborted the insert, which is the write layer working on a path nobody wrote a test for.

### 6.6 Ownership comes from the JWT, not the request body

Every host RPC re-derives its caller from `auth.uid()` and checks `weddings.owner_user_id`, so a
wedding id in a body buys the caller nothing. **API06–API11**: the owner freezes v1 and v2 with
different words and each keeps its own (F/G); a foreign wedding is refused with one sentence that
reveals nothing about it, sharing SQLSTATE and message with "no such wedding" and "not signed in"
(the §5.7 rule, applied to an RPC); a missing primary language is refused *to the owner who can see
it*; a malformed uuid is a typed rejection rather than a crash or an existence answer. **API08**'s
refusal is paired with **API04**, which first proves the caller holds `EXECUTE` on every host verb —
without that, a 42501 would only show that grants were missing.

Publishing mutates neither the draft nor the frozen version (§G): **API20** reads a guest through a
live link, edits the draft underneath, and re-reads the same guest bytes. **API19** publishes v2
against a wedding whose link is already shared and asserts the *same* address now resolves to v2 with
`link_reused = true` and `path = null` — a host never gets two live links, and never loses the one
already sent. The mechanism behind that sentence is worth naming because §8's stored rows show it:
`publish_invitation_version` re-parents the wedding's one live credential row to the new publication
rather than minting a second secret, so "the address you already shared" is literally true and not a
re-mint disguised as one; a new secret is minted only when no live credential exists. **API17**
refuses republishing a version that is already live and refuses publishing another wedding's version;
**API18** refuses an expiry in the past. **API27** rotates: a new address,
the old one reported as revoked at a timestamp, history rows kept; **API28** rotation is the owner's
verb; **API29–API32** cover revocation's permanence, that a re-publish mints a *different* secret
rather than waking the revoked one, and that revoking with nothing published says so instead of
inventing a revision.

### 6.7 What §6 does not prove

1. **No rate limiting, no lockout, no per-IP anything.** A guest door that answers in 200/`false` for
   every guess is, by the same property that makes it safe to enumerate, unthrottled. 256 bits makes
   guessing hopeless; it does not make repeated load free. That is a gateway decision for a later
   stage, and it is the price recorded at §6.1 for not running a second runtime.
2. **No transport security measured.** The local gateway is plain HTTP on loopback, so "the token
   travels in a header" is proven about *shape*, not about TLS. A deployed link is an HTTPS question
   this stage cannot answer.
3. **Digest-only means no recovery.** A host who loses the shared address cannot be given it back.
   Rotation is the only way to a new one, and it takes the old one down with it — verified behaviour,
   and a product cost a real host will hit.
4. **`p_expires_at` is stored and honoured but not offered by the UI.** The panel publishes without an
   expiry; the RPC's expiry path is qualified in SQL and in API18/API31, not in the browser.
5. API22's 23 banned names are a *deny* list walked from the response, so it catches a rename that
   matches one of them; a future whitelist addition under a brand-new name is caught by API21's
   exact-keys assertion instead. Both assertions exist because neither alone is enough.

## 7. Rendering contract, editor and preview

### 7.1 One snapshot, one DTO, one renderer

The chain a document travels is deliberately short, and every link in it is shared:

```
draft or frozen version
  → private.build_invitation_snapshot(uuid)        one definition of what an invitation consists of
  → private.public_invitation_dto(version, jsonb)  one guest-facing whitelist, or NULL
  → api.preview_invitation / api.resolve_public_invitation
  → src/lib/publicInvitation.ts                    parse or refuse
  → src/components/invitation/InvitationRenderer   one component
```

`api.preview_invitation` (the host's canvas) and `api.resolve_public_invitation` (a guest's page) run
the *same* two SQL functions over the same projection, so a preview cannot flatter its author with a
layout their guests will not see. §P's "one renderer" is then enforced in TypeScript, not in prose:
`InvitationRenderer` is imported by exactly two callers — `EditProject.tsx:57` and
`PublicInvitation.tsx` — and `src/test/invitationRenderer.test.tsx` (15 tests) drives that one
component. The renderer is used for both, and no second copy of the layout exists anywhere in `src/`.

`src/lib/publicInvitation.ts` refuses the **whole payload** rather than the field that looked odd:
every one of the eleven names is read by hand out of the snake_case wire shape, so a projection that
emitted a number where it promised text yields `null`, and the page shows its single failure phrase
instead of a partial document. That is the same indifference `public_invitation_dto` shows an unknown
snapshot version, so the two halves agree on what "I cannot vouch for this" means. One exception is
mirrored deliberately: a map link whose scheme is not `https` is dropped to `null` and the venue stays,
because a guest who can read an address but not tap a map still holds a correct document.

### 7.2 What the renderer promises

* **No markup from host text.** Every host-authored string is a JSX text child, so React escapes it;
  the file injects no HTML at all. Line breaks the host typed are honoured with
  `white-space: pre-line`, which is text layout, not markup. The byte-identity of that promise is
  proven at §6.5's API25 and re-proven in jsdom, where a `<script>` tag in a welcome line renders as
  the words `<script>boom()</script>` and no element.
* **Nothing invented.** An absent muhurtham, venue or prose slot renders as nothing rather than as a
  plausible placeholder, and an event that froze with no content at all is dropped from the list, so
  the paper never shows an empty ruled box standing in for information.
* **A date is read from its own digits.** `formatDate`/`formatTime` parse
  `2026-11-14T07:30:00` with a regex and never call `new Date()` — a wall-clock muhurtham that crosses
  a client timezone on the way to the screen is the wrong ceremony's time. The DTO's timestamps are
  text for the same reason.
* **Design values are filtered, not trusted.** A font must match `^[A-Za-z ]{1,40}$`, a colour must be
  a 6-digit hex, a size is clamped to the range the paper can carry. The test names the reason the
  clamp belongs to the renderer and not only to the editor: a stale saved `999` still has to fit, and
  `red;}` or `Noto Sans Tamil}; background: url(http://…)` must not become CSS.

### 7.3 Two render defects, found by measuring and fixed with the measurement first

Both are Stage 3 regressions of my own making, both were reproduced before being changed, and both
were found by driving the real page rather than by reading the component.

1. **Unbreakable host text overflowed a phone.** A guest page seeded with a 465-character unbroken
   title measured **`scrollWidth 2786` against `clientWidth 345` at 360 CSS px** — the document ran off
   the screen and sideways. `overflow-wrap` is an inherited property and host text carries no break
   point of its own, so the article's own class list was the only place to set it: `break-words` added
   to the root `<article>`. After the fix the same shape measures **`scrollWidth 345 = clientWidth 345`,
   `overflowX: false`**. Pinned by the test *"lets host text break inside a phone-width column"*.
2. **A draft frozen straight from the planning page rendered unreadably.** A host who never opens the
   editor has `style_settings = '{}'` — the database default — so `fontSize` reaches the renderer as
   `null`, which the code treated as "say nothing" and left to the cascade. Measured at 360 px that
   document rendered at **the page's own 16 px body text with a 12.9 px caption**: a patrika an elder
   cannot read. `DEFAULT_LEAD = 26` now states the missing size, and the `article` always carries an
   explicit font size. Pinned by *"draws a draft that was frozen before the editor set a size"*, which
   asserts `26px` and that an empty style still centres.

The two fixes together are the honest answer to §Q: the earlier claim in the renderer's header comment
that the paper has "no motion at all" was also re-measured and corrected in place (see §7.6).

### 7.4 The editor, and what saving means (§S/§T)

`src/pages/EditProject.tsx`, reached from the dashboard at `/project/:id/edit`, is one screen: the
host's words (four prose slots through `DraftTextEditor`), the paper's settings (font, size, colour,
alignment), and the live canvas. Saving is **explicit**, not automatic — `SaveState` is exactly
`'saved' | 'saving' | 'failed'`, the status line is `role="status" aria-live="polite"`, and `dirty` is
`editKey(editor, draft) !== baseline`, which is why a baseline exists at all: typing and undoing is
not an unsaved change. The editor and the draft are disabled while a save is in flight, and on success
the baseline is set to the key that was *sent*, not the current one — anything typed during the
round-trip is correctly dirty again. The canvas then re-reads `api.preview_invitation` so what is
shown is the server's projection; a failed refresh leaves the local overlay in place, which shows the
same words.

A missing primary language is a **precondition shown in the UI**, not a failure discovered after the
freeze: the panel receives `languageChosen={design.primaryLanguage !== null}` and disables freezing
with an explanation, because a guest reading text in an unknown language is not something to learn
after the fact.

### 7.5 Publication and share, as the host sees them (§V/§Y)

`PublicationPanel` puts the buttons in the order of the guarantees behind them: freeze a version, then
point the live link at it. There is no "publish my draft" affordance, because no such operation
exists — §6's `link_reused`/`path` pair is what makes that honest. Copy-to-clipboard and Web Share are
offered when available; the WhatsApp affordance is an `<a href="https://wa.me/?text=…">` whose
pre-filled text is the link alone, so nothing leaves the page until the host taps it. Three claims the
panel refuses to make are written into its header and its copy:

* it will not show a live address again — the digest is all the database has, so after a reload the
  answer is "copy it from where you shared it, or make a new link", with rotation offered as that new
  link ("shown once" is the message when a mint actually happens);
* it will not say anything was sent — the settled copy is literally *"Nothing has been sent. Copy it,
  or hand the link to a chat app yourself."*;
* it will not imply a taken-down link can return — revocation is permanent; only publishing a new
  version produces a working address.

### 7.6 Design intent, measured (§Q/§R)

Warm paper, a ceremonial double rule in gold over maroon, one column that fits 360 px, generous type.
The rules are drawn with borders and one rotated square — no image, no font asset, no network. Motion:
measured on a live guest page as **0 running animations and no transition class on the article**; the
only moving element in the route is the line that reads "Loading…" before the article exists, and
`src/index.css`'s global `@media (prefers-reduced-motion: reduce)` block flattens that one to
`0.01ms`. The renderer's own comment said "no motion at all" until this was measured; it now says
what was measured.

Scripts: the editor offers the platform's font families and the stylesheet carries Noto faces per
supported script. This is **rendering verification, not linguistic review** — nothing in this stage
was read by a native speaker of Tamil, Telugu, Malayalam or Kannada, and no such claim is made. One
finding the sweep produced: on the multi-language fixture the host-chosen family `Noto Serif Tamil` is
**not** among the font faces the page actually loads (which include `Noto Sans Tamil`), so that choice
falls through to the script fallback. Recorded as a font-availability gap for a later stage, not
silently smoothed over.

### 7.7 Error copy (§AE)

PostgREST returns `message`, `details`, `hint` and `code`, and the first three are prose about tables,
columns, constraints and policies — accurate, and addressed to whoever is watching, which for a browser
app is the visitor's own devtools. `src/lib/safeError.ts` is the one mapper: it classifies into exactly
`forbidden | rejected | unreachable | unexpected`, keeps the **code** (the difference between "this
user may not do that" and "the stack was unreachable", which is a support question nobody can answer
from a fixed phrase), and contributes no server prose. Adapters return a phrase they chose; the
§5.7 finding about PostgREST's repair `hint` is what this rule exists for, and it is enforced by a
test that pins the hint's shape rather than by a comment.

### 7.8 Bundle, measured before and after (§AA)

Measured with `npm run build` on the tree §AK's `npm ci` produced, not inferred:

| | before lazy-splitting | after (the final, pinned tree) |
| --- | --- | --- |
| entry `index-*.js` | 847.91 kB / 257.32 kB gzip | **488.93 kB / 147.23 kB gzip** |

`InvitationRenderer` splits to **7.72 kB / 2.83 kB gzip**, `sanitizeSvg` to 29.89 / 11.52, the editor
route (`EditProject`) to 58.60 / 19.32, the landing's `Index` to 17.99 / 5.90, and the guest route to
2.38 kB / 1.17 kB — the guest page is one small chunk plus the shared renderer, which is the point of
splitting it at all. **The 500 kB warning no longer fires**, and it was not silenced: the threshold in
`vite.config.ts` is untouched, and §8.6 records the intermediate measurement that made this change
obvious rather than quiet.

Everything measured in the browser earlier in this stage — this figure included, at 557.06 kB /
164.95 kB gzip — ran on a `node_modules` tree that had drifted from `package-lock.json`
(`@supabase/supabase-js` 2.117.1 installed against `^2.97.0` declared and pinned). §AK's clean
reinstall is what found it. Both numbers are reported because both were real; the pinned one is the
authoritative one, and the API suites were re-run against it afterwards (§8.6).

## 8. Browser E2E, viewports, accessibility, network, gates, cleanup

### 8.0 What this section can and cannot quote

The directive's §AD step list is a numbered 26-step sequence, and **the directive files were gone from
disk when this section was executed** — only `wedding-invites-pro/` remained. So the E2E below is
recorded as the sequence that was *actually run*, in the order it was run, and this section explicitly
does **not** claim verbatim conformance to a list it cannot re-read. Everything the list demanded
structurally — a real browser, a real local API, no hosted target, a guest with no session, the six
content shapes, the four QA viewports — is present and measured; the numbered wording is not quoted
because it is unrecoverable.

### 8.1 The E2E, as its rows remember it

Run against the dev server (`127.0.0.1:5173`) with the §4 stack behind it, in a real Chromium page
over CDP. Every timestamp below was read back out of the local database afterwards, from the rows this
session created — the sequence is therefore reconstructed from stored facts, not from notes taken
while clicking.

| When (UTC) | What the rows say | Stage 3 claim it lands |
| --- | --- | --- |
| 11:35:23 | `auth.users` gets `s3e2e+744@example.test`, `is_sso_user = false`, signed in again at 11:43:56 | sign-up and sign-in through the product's own forms, on local GoTrue |
| 11:38:20 | a `weddings` row (`Arun weds Deepa — E2E`) and, in the same statement, its `invitation_drafts` row | §3's trigger, on the platform image, from the app's own insert |
| 11:39:07 | `invitation_versions` v1, `snapshot_schema_version = 1` | §F's explicit freeze |
| 11:39:24 | first `publications` row + first `access_tokens` row | §V's publish, §H's mint |
| 11:45:34 / 11:46:03 | v2 frozen; old publication `revoked`, new `active` row, **the same credential row re-parented** to it | §G/§K: the address already sent now shows v2 |
| 11:52:34 | second credential minted, first one `revoked_at` set, both rows kept | §K rotation with history; §L permanence |
| 11:53:29 | that publication revoked | §V's take-down |
| 11:59:38 → 11:59:40 | publish and revoke two seconds apart | §L again, from the UI rather than the suite |
| 12:00:26 / 12:00:39 / 12:00:41 | draft `updated_at`, v3 frozen, new active publication with a live credential, `expiry_policy = no_expiry` | the state the guest page was then measured against |

The guest half was then opened in a **second browser context with no session at all**: one RPC call,
the document drawn, and no storage written (`persistSession: false`). What is *not* claimed here: the
venue, ceremony and people rows this invitation carries were seeded with trusted local SQL
(`.s3-seed-e2e.sql`, deleted at §AM), because Stage 3 §S scoped the editor's writing surface to prose
and styling only. The E2E therefore exercised the app's real read path over content the app cannot yet
author, and this file says so rather than letting the screenshot imply otherwise.

### 8.2 The six content shapes

`.s3-shapes.mjs` (scratch, deleted at §AM) signed up one synthetic account (`s3ac+shapes-<tag>@example.test`,
generated local-only password), created six weddings **through the host's own authenticated API
session**, then froze and published each one. Nothing was inserted into `private`, and the draft of
every wedding arrived from §3's trigger rather than being hand-made:

| shape | what it holds |
| --- | --- |
| `full` | Tamil primary + English, 2 ceremonies, 5 people, multi-line address, real `https` OSM map link, all four prose slots |
| `minimal` | one welcome line and nothing else |
| `no-venue` | null style, one ceremony with `venue IS NULL`, "Venue to be announced." |
| `unbreakable` | 465-character unbroken title, repeated unbroken strings in prose/name/address, `fontSize '120'`, `color '#notacolor'`, right alignment, 40-char font name, long `https` map URL |
| `multi-language` | Tamil primary, Telugu/Kannada/Malayalam prose, left aligned |
| `notes-only` | only `event_notes`, no prose slots at all |

Seeding produced one unplanned piece of evidence: the `unbreakable` row's first draft carried a
`javascript:` map URL, and the write was refused by `venues_map_url_check` **before** any test could
observe it — after three of the six weddings had already been created, so those three owners' rows were
deleted in dependency order (`DELETE 3/3/3/4/1`) and the shape was re-seeded with a long `https` URL.
That is §6.5's write layer working on a path nobody had written a test for, and the reason §Z's rule
lives in a `CHECK` rather than only in the projection.

### 8.3 §AC: the four QA viewports, measured

Every number below is `getBoundingClientRect` / `scrollWidth` / computed style read out of the live
page after waiting for the `article` to exist; the viewport itself was set with CDP device emulation,
because `resize_page` silently no-ops while an emulation override is active (measured: `innerWidth`
stayed 1440 until the override was replaced).

All six shapes at **360 × 740**: `overflowX: false` and `scrollWidth 345 ≤ clientWidth 345` on every
one, article widths **313–328 px**, no embedded media, one `<h1>`, `touchTargetsUnder44: []`,
`liveRegions: 0` on a settled page, **0 running animations**, dates drawn from their own digits
("14 November 2026"), `lang` set per shape, and the map anchor carrying
`rel="noopener noreferrer" target="_blank"` in a **158 × 52 px** box.

Wider viewports, on the two extreme shapes (widest content, smallest document):

| | 390 × 844 | 768 × 1024 | 1440 × 900 |
| --- | --- | --- | --- |
| `unbreakable` | article 358 px, left 16 | article 544, left 104 | article 544, left 440 |
| `minimal` | fits without scroll | article 544, left 112 | article 544, left 448 |

The 16 px asymmetry in the last column is the vertical scrollbar, not a layout bug. These two shapes
were swept across all four viewports; the other four were measured at 360 × 740 and on the desktop
viewport, which is what "no overflow at the narrowest width" needs to be true for.

### 8.4 §AB: what was checked, and the claim that is *not* made

No WCAG conformance is claimed. What follows is a checklist pass whose items were each measured in the
live page or asserted in a test:

* structure — one `<h1>`, heading order `H1 → H2 → H2 → H2 → H3 → H3`, `lang` on the article from the
  host's chosen language, `aria-label` naming the document, ceremony sections labelled;
* contrast — text against paper, computed from resolved styles with proper sRGB linearisation, spanned
  **8.82** (multi-language, `#0b4f4a`) to **12.63** (full, `#7a1f2b`), with `minimal` at **11.85**
  (`#333333`); every shape is above 4.5:1 for body text on these numbers;
* interaction — every tappable element ≥ 44 px (measured list: empty), a visible `:focus-visible` ring
  from the global stylesheet, keyboard-reachable map link, no element depending on hover;
* motion — 0 animations on the document, and the stylesheet's global `prefers-reduced-motion` block
  flattening the single "Loading…" indicator to 0.01 ms;
* screen-reader surface — the guest page has no live region once settled, so nothing announces
  spuriously; the status phrases in the editor and the guest route are `role="status"` with
  `aria-live="polite"`.

**Limitation, stated because it changes what the pass means:** screenshot and pixel capture do not work
in this environment (`take_screenshot` failed on every attempt), so **glyph fidelity could not be
verified visually** — no check that a Tamil codepoint rendered as a letter rather than a tofu box, and
§7.6's font-family finding is the trace of that gap. Type contrast, sizes and structure were measured
from resolved styles, which is not the same evidence as looking at it. This is *rendering
verification*, and no linguistic or typographic review by a native speaker was performed.

### 8.5 §AL: what the network actually did

Two observations, both from the browser's own request log with the page's network domain filtered:

* **Production preview** (`vite preview` on `127.0.0.1:4173`), guest route: **13 requests, of which 0
  went to any hosted `supabase.co` host and 3 to Google Fonts**. The API traffic is exactly one
  `POST /rest/v1/rpc/resolve_public_invitation` plus its CORS preflight, and **the preflight carries no
  credential**. 0 storage writes, 0 cookies, the credential present only as the
  `x-invitation-token` header, and the response header `server: postgrest/16.2` printing the API
  version that §4.1's corrected table now records. The DTO in that response has no identifier in it
  (§6.5).
* **Dev server**, same route: the same single RPC plus ~50 loopback module requests that Vite serves
  per cold load — which is also what made "still loading" a measurement trap: `navigate_page`'s 10 s
  default timed out mid-load twice and produced a null `article` and a false "Loading…" reading until
  probes were made to wait for the element and re-query rather than reuse a handle.

Disclosed rather than buried, per "do not repeat Stage 2's zero-network overstatement": the page loads
Google Fonts from a third-party host (§7.6), `npx` reaches the npm registry when a tool is fetched, and
nothing in this stage captured packets to prove anything beyond what the browser's own log shows. The
`wa.me` share affordance is an `<a href>` and issues no request until the host taps it. §8.7 re-runs
this observation on the final bundle, because the one measured here was the drifted tree.

### 8.6 §AK: the final gates, run after the last code edit

Sequence, exactly as the directive requires: the dev and preview servers were stopped, `node_modules`
was deleted, `npm ci` reinstalled from the lockfile (**506 packages added, 0 vulnerabilities of high or
above, exit 0**), and only then did anything below run. No number in this subsection is carried over
from an earlier pass.

| Gate | Command | Result |
| --- | --- | --- |
| lint | `npm run lint` | **0 errors**, 8 warnings — all `react-refresh/only-export-components` in `src/components/ui/*`, pre-existing and untouched |
| typecheck | `npm run typecheck` | clean |
| generated types | `npm run dbtypes:check` | OK — 16 migration files, 18 `public` + 10 non-client tables, 18 tables in client types, 11 query column groups reconciled, **0 findings** |
| product contract | `npm run product:check` | OK — 156 active files scanned, **0 violations**, including the four Stage 3 shape rules (§AI) |
| unit + component | `npm run test` | **138 tests in 15 files, all passing** |
| build | `npm run build` | succeeds; entry 488.93 kB / 147.23 kB gzip, no chunk-size warning (§7.8) |
| production audit | `npm audit --omit=dev --audit-level=high` | **exit 0** — 2 *moderate* advisories against `react-router`/`react-router-dom` (an open-redirect bypass in `<Link>`/`useNavigate`, and `deserializeErrors()` constructor injection in SSR hydration). Both are inside the declared `^6.30.1` range's vulnerable span, the fix npm offers is `--force` to a different major, and the range was **not** widened or bumped to make this line quiet — recorded as an open dependency finding |
| database, throwaway chains | `bash supabase/tests/stage2/run.sh both` | clean 41 / 46 / 246 / 325 / 86, legacy 75 / 49 / 246 / 325 / 86 — identical to the earlier run this stage recorded, re-measured rather than cited |
| database, Stage 0 baseline | `bash supabase/tests/rls/run.sh` | **24** |
| API over the real stack | `bash supabase/tests/api/run.sh` | publication **34/34**, security **56/56**, post-run leak check back to the pre-run row counts (7 weddings / 3 `auth.users` / 7 drafts at that point) |
| whitespace | `git diff --check` | exit 0 (CRLF *warnings* from Git's line-ending normalisation only, no whitespace errors) |

One disclosure about the reinstall itself: this machine's npm blocks dependency lifecycle scripts, and
the run printed `install-scripts` warnings for `@swc/core@1.13.2` and `esbuild@0.21.5`. Nothing was
approved or worked around; every gate above ran on that tree and passed, including ESLint (swc) and the
build (esbuild), so the block is recorded rather than quietly treated as a failure.

The only edits made after the table above were to markdown (this file's §8.6–§8.10 and §7.8), which no
code gate reads. The two checks that *do* scan documents were run again afterwards and match:
`product:check` → 156 files, 0 violations; `git diff --check` → exit 0. Everything else above is
therefore a measurement of the tree that is being pushed, not of an earlier state of it.

### 8.7 The bundle drift, and what it invalidated

§7.8's before/after table changed **because of** the clean reinstall, and the mechanism matters more
than the number: the tree the earlier browser work ran on carried
`@supabase/supabase-js` **2.117.1**, while `package.json` declares `^2.97.0` and the lockfile pins
**2.97.0**. A drifted `node_modules` is exactly the class of thing §AK exists to catch, and it changed
two measured facts:

* the entry chunk (557.06 kB → 488.93 kB), and with it whether Vite's 500 kB warning fires;
* the client library version that every earlier HTTP assertion in this stage travelled through.

Both were then re-established on the pinned tree rather than argued: the API suites were re-run (90
tests, §8.6), and the production guest page was rebuilt, re-served and re-measured in the browser:

| | pinned-tree measurement |
| --- | --- |
| requests for one guest load | **12** — the document, 5 local asset chunks, 1 Google Fonts stylesheet + 2 font files, **1 `POST /rest/v1/rpc/resolve_public_invitation` and its `OPTIONS` preflight** (§8.5's earlier log showed 13 on the drifted bundle; the shape is the same and the API half is one call either way) |
| hosted `supabase.co` requests | **0** |
| third-party origins | `fonts.googleapis.com`, `fonts.gstatic.com` only |
| credential placement | header on the POST; no token in any request URL in the log (the *browser address* carries it, §6.3) |
| document at 360 × 740 | `scrollWidth 345 = clientWidth 345`, no horizontal overflow, article 313 px wide, `font-size: 28px` (the host's own choice), `lang="ta"`, colour `rgb(122, 31, 43)`, **0 running animations** |

The renderer fixes in §7.3 are unaffected by the drift — both were in application code, and their tests
are among the 138.

### 8.8 §AM: cleanup, and what was deliberately not touched

* **Fixture rows removed from the local stack, in dependency order:**
  `DELETE 10` from `private.access_tokens`, `DELETE 10` from `public.publications`, `DELETE 9` from
  `public.invitation_versions`, `DELETE 7` from `public.weddings` (which cascades the 7 drafts, 13
  people, 5 venues and 8 events), `DELETE 3` from `auth.users` for the `@example.test` accounts.
  Afterwards every one of those tables, plus `profiles`, `user_roles`, `entitlements`,
  `guest_households` and `private.audit_events`, counts **0**. The synthetic invitation tokens died with
  those rows; no credential was exported anywhere.
* **Scratch files deleted:** every `.s3-*` file (the shape seeder and its manifest, the seed SQL, the
  seven probe scripts and logs, the loop and rebuild helpers). `pnpm-lock.yaml` and
  `pnpm-workspace.yaml` were left **untracked and unstaged**, exactly as found.
* **Containers:** this project's stack stopped with `npx supabase stop --no-backup` (no database dump
  written into `supabase/.branches`), and this project's two throwaway Postgres containers
  (`st3loop`, `s2types`) were removed — the second of them a Stage 2 leftover whose existence
  contradicted Stage 2 §26's "all removed", which is why §4.4 discloses it. Neither had a named volume,
  so none was deleted.
* **Not touched:** the twelve `*_dueweave` containers of the unrelated project on 54321–54327, including
  its crash-looping `supabase_vector_dueweave`, which was restarting before this stage began and is
  still restarting now. `docker ps` after the cleanup confirms all twelve still up, as before.
* **Kept on purpose:** `.env.local` (gitignored; loopback URL and this stack's local keys) and
  `supabase/.temp/cli-latest`, because the README's "API testing against the local stack" section is
  unrunnable without them. Both are local-only credentials for a stack that is now stopped.

### 8.9 §AO/§AP: push and CI

`stage3/public-invitation-vertical-slice` was pushed normally — no `--force`, no `--force-with-lease`,
no amend, no rebase, no history rewrite — and the remote SHA was read back with
`git ls-remote origin refs/heads/stage3/public-invitation-vertical-slice` rather than taken on trust
from the push output. **`main` was not merged into, no tag was created, no pull request was opened and
nothing was deployed.** The Stage 2 branch remains unmerged for the reviewer to decide on, so
`origin/main` is still the Stage 1 closure commit this branch started from.

Hosted CI: `.github/workflows/ci.yml` triggers on pushes to `main` and PRs targeting `main`, so a branch
push starts nothing. This repository's monthly runner allocation was already recorded as exhausted in
earlier stage audits (`EXTERNAL CI QUOTA DEFERRAL`), which means the gates above are the only execution
evidence this stage has, and none of them ran on a hosted runner.

### 8.10 What Stage 3 does not claim

Stated so the next reviewer does not have to infer it. Not implemented, not partially implemented, not
"coming in this branch": guest RSVP or any guest input of any kind; family approval; PDF, image or
video export; QR codes; payments, pricing, GST or entitlement granting; the admin console; the audit
trail as a product surface; reviewed tradition or template content (both tables are empty of platform
content this build can show a customer); an event/venue/family editor; uploads and Storage;
Realtime; deployment of any kind. The landing page's language about publishing describes what the code
in this branch does **locally**, and the readiness matrix says so in the same breath.

Beyond that, three things this file asserts which a reader may reasonably want to dispute, with their
weakest point named:

1. *"No remote project was contacted."* True of every command run, provable by command shape and by
   the absence of link state (§4.3) — but not packet-verified, and `npx` and Google Fonts do reach
   third-party hosts. §8.5 states which requests those were.
2. *"The invitation renders correctly in five scripts."* It renders *something* legibly in each fixture
   language and the structure was measured; no native speaker reviewed the wording, and glyph fidelity
   could not be captured. §8.4.
3. *"One draft per wedding, guaranteed."* Guaranteed against everything a customer can do through the
   API, not against a trusted role's manual `DELETE` (§3.2) — and the difference is asserted by name in
   `20_draft_invariant.sql` rather than implied by the invariant's phrasing.

## 9. POST-INDEPENDENT-REVIEW CLOSURE REPAIR

This label is the review's own requirement, and so is the rule that shapes the section: **§1–§8 stay
exactly as they were written**, including the sentences that turned out to be wrong. Where this pass
contradicts an earlier claim, the earlier text is left standing as the record of the error and the
subsection here is the correction, pointed at by section number. Nothing in §8 is deleted, softened or
quietly re-measured into agreement.

### 9.0 What the review asked for, and what this pass was allowed to touch

These sections of the directive asked for a change to the tree rather than for more evidence, and the
table lists each one with the label this session carried for it:

| Directive | The defect, as the review stated it | What landed |
| --- | --- | --- |
| §2 | the release could not author people, venues and ceremonies from the product at all, so the §3 journey was only reachable through the database | a row editor in `src/components/invitation/ContentEditor.tsx` over a read/write layer in `src/integrations/supabase/weddingContent.ts`, held by 19 + 23 new unit tests (`contentEditor`, `weddingContentQueries`), and walked end to end by §9.1's steps 6–8 |
| §3 | the qualified E2E's people, venues and events were seeded with trusted SQL (§8.1 admits it), so the editor's own write path was never walked end to end | the whole journey re-run on the **production build**, every row created through the UI (§9.1) |
| §4 | the guest route sat inside the account tree, so opening a shared link touched the visitor device's auth state | `/i/:token` moved out of `AuthProvider` — `AccountApplication` at `src/App.tsx:47`, the sibling route at `:82` — pinned by the five cases in `src/test/appRoutingAuthIsolation.test.tsx` (§9.1's steps 13–14, §9.10) |
| §5 | `no-referrer` was reasoned about, not measured | the fonts request's actual `referer` header read out of the browser's network log (§9.3) |
| §6 | the privileged publication bodies sat in the exposed `api` schema | seven `SECURITY DEFINER` bodies moved to unexposed `internal_api`, wrappers left invokable (§9.7, ADR 0006) |
| §7 | document metadata described capability the release does not ship | three description fields rewritten, README's ADR range corrected, landing copy re-read in the browser on the final build (§9.4) |
| §8 | the recorded `Noto Serif Tamil` font finding (§7.6) was **false** | retracted with the check that shows it was false; §8.4's capture limitation retracted with it (§9.5) |
| §9 | revocation decided its own outcome from `FOUND` after an intervening `UPDATE` | `v_publication_found`, captured where it is true, plus a SQL group and `API35` that reach the exact shape (§9.6) |

A reading note for the rest of §9: a bare section number in that first column and in the paragraphs that
follow it is the **directive's** numbering, while `§8.1`, `§7.6`, `§4.3` and the like elsewhere in this
section are **this document's** own sections — the two series collide, and the subsection headings here
(`9.3 §5`, `9.7 §6`) give both on purpose.

Two more asked for records instead of code: §10 wanted ADR 0006 amended with a deviation record rather
than re-authored, and §11 wanted old and new test counts side by side (§9.7, §9.8). §12 (ten content
shapes × four viewports), §13 (request classification on the final build) and §14 (the whole battery
after a clean reinstall) were re-executions of §7/§8's evidence on the tree that is actually being
pushed; they are §9.9, §9.10 and §9.11.

Provenance, disclosed the way §8.0 disclosed it: the directive reached this session as an attached file,
and that file was gone from disk before this section was written. Its section numbering and the
requirements quoted throughout §9 were carried in-session, so **quotations are of wording this session
retained, not of a document re-read**. Where a demand was structural — "no direct SQL/database seeding
of people/events/venues is allowed in this final E2E", "Do not merely reason from browser defaults",
"Report OLD counts + NEW counts", "Do not claim the path itself disappears from browser history" — it is
met and the evidence is below. Where the numbered wording would have to be recited to be verified, it is
not recited.

Scope, held: this pass repaired the items in that table and re-measured what §11–§14 asked about. It did
not start Stage 4, did not merge, did not tag, did not deploy, and did not repair the four observations
§9.13 records as found-and-left.

### 9.1 §3: the host-to-guest journey again, with no SQL anywhere near it

Run against **`vite preview` on `127.0.0.1:4173`** serving the production bundle of §9.11 — not the dev
server §8.1 used — with the §4 local stack behind it, in a real Chromium page over CDP. The guest half
ran in a page with no session, no storage and no cookies. **No SQL was written to create or populate any
invitation content in this run**; every click below is a UI action, and every timestamp was read back
out of the local database afterwards, from the rows this session created, so the table is reconstructed
from stored facts rather than from notes taken while clicking. Synthetic-account creation is the one
thing that went through GoTrue's own local sign-up form, as the directive permits.

| # | What was done in the browser | What the rows and the page say |
| --- | --- | --- |
| 1–2 | Landing → "Create your invitation" → sign-up form, `s3final+e2e@example.test` with a local-only password (not recorded here, and the row is deleted at §9.14) | `auth.users` row `ea0a5c27-3820-4cc4-9faf-4d4310556d30`, `is_sso_user = false`, created 05:26:48 UTC; the app landed on `/login`, so the session was not assumed |
| 3 | Signed in through the form | Dashboard with **0** drafts — nothing pre-existed for this account |
| 4 | "New wedding" → title "Arun weds Deepa — Final E2E", main language Tamil, estimated guests 120 → create | `weddings` row `57886709-ac62-4091-93d4-994fae17950c` at 05:28:32 UTC |
| 5 | *(no action — this is the point)* | `invitation_drafts` row `a19ef7c1-3e73-4c54-9639-25c6f4e509d9`, same statement and same timestamp, written by §3's trigger from the app's own insert |
| 6 | Editor → People → three "Add person" rows: `அருண் குமார்` / role `Groom` / group `Groom's family`; `தீபா லட்சுமி` / `Bride` / `Bride's family`; `குவிலு ராணி` with **no role word**, group `Bride's family` | three `wedding_people` rows, all `role_key = 'host_defined'`, all `group_key IS NULL`, `display_order` 1/2/3, and the third row's `role_label` `NULL` |
| 7 | Venue → name `கல்யாண மண்டபம்`, two-line address, map link `https://www.google.com/maps/search/?api=1&query=13.03+80.27` | one `venues` row, `map_url` `https` and nothing else |
| 8 | Ceremony → `திருமணம்`, 2026-11-14 08:00 → 09:30, timezone `Asia/Kolkata`, linked to that venue → the §9.2 caveat attaches to this row | one `wedding_events` row, `event_key = 'host_defined'`, `starts_at`/`ends_at` as above, venue FK set, order 1 |
| 9 | Four prose blocks typed (welcome, family introduction, event notes, closing) and the style panel set to `Noto Sans Tamil`, `#1f6f52`, size `30`, left | `content` holds all four keys; `style_settings` = `{"font":"Noto Sans Tamil","color":"#1f6f52","fontSize":"30","alignment":"left","foilEnabled":false}`, draft `updated_at` 05:41:15 |
| 10 | Preview | the same renderer the guest gets, showing exactly these rows |
| 11 | "Freeze this version" | `invitation_versions` v1, `snapshot_schema_version = 1`; the panel states "Version 1 is frozen. It cannot be edited." |
| 12 | Publish | `publications` row + `private.access_tokens` row at 05:42:01, `expiry_policy = 'no_expiry'`; the link is shown **once** with a copy affordance — the raw credential exists nowhere in the database (only `token_hash`, §6.3) |
| 13 | Link opened in a page with no session | article rendered: `html lang="en"`, `article lang="ta"`, one `<h1>`, `scrollWidth == clientWidth`, computed `30px` / `rgb(31, 111, 82)` / `left` / `"Noto Sans Tamil"`, one anchor with `rel="noopener noreferrer" target="_blank"` |
| 14 | The guest's own text compared with the host's inputs | every host value present and nothing invented: the three people drawn as `Groom · அருண் குமார்`, `Bride · தீபா லட்சுமி` and `குவிலு ராணி` (name only, because its stored `role_label` is null); the strings `host_defined`, every `role_key`/`group_key` value and every uuid absent from the document; `localStorage` and `sessionStorage` empty; **0 cookies** |
| 15–16 | Host edits the welcome line, appends ` — புதிய அழைப்பு`, saves | guest reload shows the **old** text: v1 is a frozen snapshot and the edit touched only the draft |
| 17–18 | Freeze v2 (the version selector's native list), publish | same address, and the panel now reads "A link is live showing version 2"; `link_reused` true, so no new path was minted; guest reload shows the new clause. `(snapshot->'draft')->>'welcome'` differs between the two version rows — read out of the database, not inferred |
| 19–21 | "New link, same version" | second credential at 05:44:47; the **old** link answers the one generic refusal, "This invitation is not available", with no names, no venue, no dates in it; the new link renders v2 |
| 22–23 | "Take the link down" | panel reverts to "This invitation has not been published yet" with rotate and revoke disabled; guest reload of the live link shows the same generic refusal |
| 24 | Rows read back | both `publications` rows `status = 'revoked'` with `revoked_at` set, both `public_invitation` tokens revoked (`token_hash` prefixes `71f46cb6f3c7`, `bc59d38c3ebf`), no active publication for the wedding |

Two things this run replaces rather than adds to: §8.1's journey ran on the dev server, and its
venue/ceremony/people rows came from `.s3-seed-e2e.sql`, so it never proved the editor could author an
invitation. This one does, on the bundle that ships from this branch. §8.1's text stands as the record of
what was actually run at that moment.

### 9.2 The one step in that journey that was not a keystroke

Disclosed because the directive requires it in as many words ("If any is inferred rather than executed:
say so") and because an automation shortcut inside a UI-only claim is exactly the thing a reviewer should
not have to hunt for.

Step 8's two `datetime-local` fields could not be filled by emulated keystrokes. What was tried, and
what happened:

* `fill_form` reported success and left both inputs at `""` — it resolves the field's label, not the
  widget's internal date segments;
* clicking a segment's uid then `type_text` (CDP `insertText`) produced nothing, because the segments
  live in the input's shadow tree and are not addressable nodes;
* `press_key` per digit did reach the widget but landed in the wrong segment and produced
  `202608-11-14T00:14` — the year segment accepted `202608` (it takes values up to 275760), which is
  evidence the keystrokes were delivered and not swallowed;
* `Control+A` then `type_text` did nothing further.

The value was therefore set by calling the native input value setter on the product's own
`<input type="datetime-local">` and dispatching bubbling `input` and `change` events — the same events a
keyboard-driven change fires — producing `["2026-11-14T08:00","2026-11-14T09:30"]`, which the app's
controlled `TextField` accepted, held in state, saved, and which then appeared in the frozen snapshot, in
the guest DTO and in the guest document.

So: the handler → state → save → freeze → DTO → renderer chain is **executed** evidence. What is *not*
demonstrated is a human typing digits into that widget with real keys in this environment; no product
defect was shown by the failure above, and none is claimed — the fault was in the automation layer's
ability to focus a shadow-DOM segment, and nothing in the application distinguishes the synthetic event
from a typed one. The alternative was to seed `starts_at` with SQL, which the directive's §3 forbids, or
to drop the step, which would have hidden it.

### 9.3 §5: the referrer, measured rather than reasoned about

`index.html:12` carries `<meta name="referrer" content="no-referrer" />`, with the comment above it
stating what it does and does not reach. It is in the built document, not only in the source: the
`served` `dist/index.html` (md5 `788a374ddb36159d1fcb4d37c75f6f31`) contains the tag, and the loaded page
reported `document.querySelector('meta[name=referrer]').content === 'no-referrer'`.

The measurement the review asked for is the header, and it was read from the browser's own request log
for the guest load of §9.1:

* the `https://fonts.googleapis.com/css2?family=…` request carries **`referer:` with an empty value** —
  not "absent because the browser defaulted to it", but present-and-empty on a page whose address is
  `/i/<credential>`;
* the credential appears in **0 request URLs** in that log (checked as a substring over all 21 URLs, not
  by eyeballing three of them);
* the only third-party origins contacted are `fonts.googleapis.com` and `fonts.gstatic.com`.

The limit the directive insisted on is kept in the same words as §5's doc change
(`public-invitation-security.md`): `no-referrer` covers requests the page makes. The path **does** remain
in browser history, in whatever access log the hosting layer keeps, and in this local stack's own request
records. No claim is made that this pass removed those, and none is made about `Referrer-Policy` response
headers, which are a hosting-layer mechanism this build does not set.

### 9.4 §7: what the document says about itself

The three description fields in `index.html` now describe this release, in these words: the `description`
meta names it as "a South-India-first digital wedding patrika" whose flow is "signs in, writes and styles
an invitation, freezes it as a version, and publishes it as a link guests read without an account", and
then states the negation — "RSVP, approval workflows and printing are not part of this release."
`og:description` and `twitter:description` carry the same sentence with the same negation, so a link card
cannot be more generous than the page it points at. The review's specific checks:

* no field claims RSVP, guest replies, family approval, PDF/image/video export, QR codes, payments,
  pricing or an admin console;
* no usage, customer count, testimonial or launch claim appears in any of them, and none was invented to
  fill the space;
* `README.md:192` cited "ADRs 0001–0005" while ADR 0006 exists — corrected to 0001–0006, and the range
  was re-checked against the directory rather than against the sentence.

The landing page was then re-read **in the browser on the final build** rather than in source: the
"How it works" steps describe write → freeze → publish → share, and the copy that could have implied a
guest reply is written as a promise about a later release. Nothing on it asserts capability this branch's
code does not implement — the check that pinned this is `npm run product:check` (§9.11), whose shape
rules include the claims §AI added for exactly this purpose.

### 9.5 §8: the font finding was false, and what replaced it

§7.6 recorded: "on the multi-language fixture the host-chosen family `Noto Serif Tamil` is **not** among
the font faces the page loads (which include `Noto Sans Tamil`), so that choice falls through to the
script fallback." **That finding was wrong as written**, and the review was right to call it out.

The check that shows it: `src/pages/EditProject.tsx:87` `FONT_FAMILIES` lists exactly six families —
Playfair Display, DM Sans, Noto Sans Tamil, Noto Sans Telugu, Noto Sans Kannada, Noto Sans Malayalam —
and `index.html:18` requests exactly those six from Google Fonts, so nothing named `Noto Serif` is
offered by the editor or loaded by the page: `grep -rn "Noto Serif" src index.html` returns no match.
Searching the whole tree instead of those two paths finds the string only where it is a record or a
written value, never a capability — §7.6 of this file, `render-contract.md` §5's retraction, the
legacy-chain fixtures `supabase/tests/stage2/10_seed_legacy.sql:84` and `30_migration_legacy.sql:189`
(which write `{"font": "Noto Serif", …}` into a historical row on purpose), and §9.9's sweep, where four
shapes declare it as a style object. That contrast is exactly what §7.6 missed: **what a database row can
be made to hold is not what a host can choose.** The finding therefore described a choice no host can make,
and it reached the audit report without being re-checked against the list it named.
`render-contract.md` §5's finding 3 is now headed "Retracted" and keeps the same correction; the paragraph
above stays as the historical record of the error.

Nothing was substituted for it. No font-availability gap was measured in this pass and none is claimed.
What *was* measured, and is claimed: across all 10 shapes at all 4 viewports the guest document's
resolved `font-family`, `font-size`, `color` and `text-align` equalled the values that shape's own style
object declares (§9.9), and on the §9.1 page — where those values were chosen in the editor's style
panel rather than written by a harness — the document computed to `30px`, `rgb(31, 111, 82)`, `left` and
`"Noto Sans Tamil"`, with the faces fetched from Google Fonts.

Two more retractions follow from the same pass, because §8.4 and §8.10 rested on a premise that did not
hold:

* **§8.4's limitation is retracted.** "screenshot and pixel capture do not work in this environment
  (`take_screenshot` failed on every attempt)" was true of the attempts made then and false as a general
  statement. With CDP device emulation set to 360 × 740 @3x (mobile + touch) the guest page captured
  normally, and the Tamil, Telugu, Malayalam, Kannada, mixed-script and hostile-markup shapes were
  captured and looked at.
* **§8.10 item 2's "glyph fidelity could not be captured" is therefore no longer true.** Every Indic
  codepoint in those captures drew as a letter of its own script — no tofu boxes, no clipped vowel
  signs. The mixed-script capture additionally proved per-codepoint fallback: its computed
  `font-family` was `"Noto Sans Tamil"` throughout, yet its Kannada, Telugu, Malayalam and Devanagari
  codepoints each rendered through the browser's fallback without disturbing line width.

What replaces the overclaim is a narrower one, and it is still an overclaim risk a reader should price:
this is **rendering verification only**. No native speaker of Tamil, Telugu, Kannada or Malayalam read
any of it, no linguistic or typographic review was performed, and no WCAG conformance is claimed (§9.13
records one contrast measurement that is short of 3:1).

One fixture artifact is disclosed rather than smoothed over, because it was visible in the first capture:
the `tamil` shape's three prose fields were seeded by the sweep generator with 19 stray Telugu codepoints
— a bug in the generator, not in the renderer, and it showed up as fallback glyphs in the image. The rows
were corrected and republished as a V2 on the same link, and the re-captured page holds **0 Telugu and
170 Tamil codepoints**.

### 9.6 §9: revocation that does not ask a stale `FOUND` what happened

The body of the revocation path ended with a result assembled as `'revoked', FOUND OR v_count > 0`,
where `FOUND` was read *after* the credential `UPDATE` two statements above it. In PL/pgSQL `FOUND` is a
session flag describing the most recent statement, so it no longer referred to the publication lookup at
all. The consequence was not cosmetic: for an active publication whose live credential row is missing —
a shape a host's screen can reach, and the one the review pointed at — the flag said "nothing", the
publication stayed `active`, and the response said `revoked: false` while a link was still being taken
down, or the reverse.

The repair captures the lookup where it is true and never consults the flag afterwards:

* `supabase/migrations/20260926150000_stage3_privileged_bodies_behind_wrappers.sql:320` declares
  `v_publication_found boolean := false`, `:337` sets it immediately after the publication `SELECT`, and
  `:356–357` use it for both the `revoked` flag and the `publication_id` the caller gets back;
* the historical migration is **not** touched — this is a forward repair in the same file as §9.7's move,
  because the body being relocated was also the body being corrected;
* `supabase/tests/stage3/30_publication.sql`'s group H (the file's own header at `:1777` names the flag)
  asserts both halves of the disjunction separately, so neither arm can be satisfied by the wrong
  statement;
* `API35` (`supabase/tests/api/stage3_publication.test.mjs:935`) is the HTTP half, through the host's own
  RPC: create a complete wedding → freeze → publish → *confirm the link resolves* → delete the live
  credential out from under it with trusted SQL → revoke. It then asserts
  `{ revoked: true, publication_id: <the real id>, tokens_revoked: 0 }`, that the deleted token no longer
  resolves (`{ available: false }`), and that `get_invitation_publication_state` comes back with no live
  link rather than `link_active: false` beside a publication id — the difference between "there is no
  link" and "your link is out of date", which is a promise to the host's screen, not a row count.

Per the standing rule about refusal tests, the `API35` fixture builds complete rows: an insert that would
have failed on a missing required field would have proved nothing about `FOUND`.

### 9.7 §6 and §10: where the privileged bodies live, and what the ADR still says

The review's structural finding: seven publication-path functions were `SECURITY DEFINER` bodies
declared inside `api`, the one schema PostgREST exposes. Grants limited who could *call* them; nothing
limited what a caller could *address*, and the wrapper/implementation distinction the design was arguing
for existed only in comments. The forward migration
`supabase/migrations/20260926150000_stage3_privileged_bodies_behind_wrappers.sql` splits them:

* `api.*` keeps the same names, signatures and grants, and each wrapper is now `SECURITY INVOKER` with an
  empty `search_path` — it is the surface, not the privilege;
* the bodies move to `internal_api`, which is **not** in PostgREST's exposed
  `pgrst.db_schemas`, each `SECURITY DEFINER` with `SET search_path TO ''`;
* `service_role` holds no `USAGE` on `internal_api` at all, so even a leaked service key cannot reach the
  privileged body directly; the browser roles gain `USAGE` and nothing else, and `API37` asserts that
  grant is exactly its size;
* `API36` asserts the converse half from the HTTP layer: `internal_api` is not a profile, so its
  functions are not addressable by any path PostgREST will serve.

ADR 0006 was **amended, not re-authored**, per §10's instruction not to rewrite history as if the first
architecture never existed: the original Decision, Reasons and Rejected sections stand with their
reasoning, one sentence was added in-line pointing at the record below them, and the file ends with
"Deviation record — where the privileged bodies live (closure repair, 2026-09-27)", which says what
changed, what did not, that the callable surface is identical, and that the suites passed before and
after. Its Evidence section now cites both measurements honestly: 34 HTTP tests API01–API34 with 246 SQL
assertions at the time of the original decision, and 37 tests API01–API37 with 269 assertions after the
move (§9.8 has the full old/new table).

### 9.8 §11: every suite, old count and new count

The directive's instruction was not to replace numbers: "Report OLD counts + NEW counts. Do not silently
replace suites and report only the larger number." Every "now" column below is from a run made in the
closure pass on the pinned tree, not from §8's records, and the Stage 2 column is reproducible from
commit `a51856f`.

| Suite | Stage 2 at `a51856f` | §8.6, pre-closure | now | Δ this pass |
| --- | --- | --- | --- | --- |
| Stage 0 RLS baseline (`tests/rls`) | — | 24 | **24** | 0 |
| Stage 2 migration outcome, clean chain | 41 | 41 | **41** | 0 |
| Stage 2 migration outcome, legacy chain | 75 | 75 | **75** | 0 |
| Stage 3 draft invariant, clean chain | — (did not exist) | 46 | **46** | 0 |
| Stage 3 draft invariant, legacy chain | — | 49 | **49** | 0 |
| Stage 3 publication boundary SQL | — | 246 | **269** | **+23** |
| Stage 2 privilege + RLS attacks | 322 | 325 | **325** | 0 |
| Stage 2 `api` catalogue conformance | 75 | 86 | **94** | **+8** |
| HTTP publication (`tests/api`, 37 tests) | — | 34 | **37** | **+3** — `API35` (§9.6), `API36`/`API37` (§9.7) |
| HTTP security (`tests/api`, 56 tests) | — | 56 | **56** | 0 |
| vitest unit + component | — | 138 / 15 files | **188 / 18 files** | **+50 / +3 files** — the three new files hold 47 of them (`contentEditor` 19, `weddingContentQueries` 23, `appRoutingAuthIsolation` 5) and the other 3 are added cases in `editInvitationPage.test.tsx` (+1) and `invitationRenderer.test.tsx` (+2) |

Nothing was retired, renamed out of a count or replaced by a smaller suite: the two suites that grew did
so by **added** assertion groups (revocation's `FOUND` case and the `internal_api` half of the catalogue),
and the three HTTP tests and three vitest files are new files/cases, not restatements of old ones. Both
SQL chains were re-run end to end for this table (`bash supabase/tests/stage2/run.sh both`, exit 0), and
the post-run leak check on the HTTP suites again returned the database to its pre-run row counts.

### 9.9 §12: ten content shapes × four viewports, on the final bundle

§8.2 measured six shapes at 360 px and two of them at three more viewports. §12 asked for the matrix
without the holes, so the sweep was rebuilt at ten shapes × four viewports — **40 loads** of real guest
pages against the final build.

The harness for this one *was* SQL-seeded, and that is disclosed rather than glossed: `.s12-shapes.sql`
(scratch, deleted at §9.14) created one wedding per shape under a trusted local role, populated people,
venues and events, then froze and published **through the product's own privileged functions**
(`internal_api.create_invitation_version` / `publish_invitation_version`, §9.7's layout) and recorded each
raw credential. That is legitimate for a *render* sweep — §3's no-seeding rule governs the journey that
claims to prove the editor, and §9.1 is that journey with zero SQL in it. It is not legitimate for an
authoring claim, and no authoring claim is made from these 40 loads.

| shape | what it stresses |
| --- | --- |
| `minimal` | prose and two people, with `style_settings` `{}` and **no venue and no ceremony at all** |
| `long-title` | a literal 465-character unbroken title, with a long paragraph beside it |
| `five-events` | five ceremonies — two with no end time and two with no venue — across one hall |
| `long-venue` | a 260-character venue name and the same again as its address, with no line breaks given |
| `tamil` / `telugu` / `malayalam` / `kannada` | one Indic script as the primary language, each with its own chosen font, colour, size and alignment |
| `mixed-script` | Kannada, Telugu, Malayalam and Devanagari codepoints inside a Tamil document |
| `hostile-markup` | `<script>`, `<img onerror>`, `<marquee>`, `<h1>`, `javascript:` hrefs in every prose slot, and `color: "red;}"` / `fontSize: "999"` / `alignment: "justify; url(http://evil.example)"` |

Two details of that fixture matter to the reading of the results, so they are stated rather than left
implicit. First, the harness writes `role_key` from the label it is given (`Groom` → `groom`) and writes
`host_defined` when the label is blank — so the Indic and hostile shapes each carry a person whose
`role_label` is `NULL` beside `role_key = 'host_defined'`, which is exactly the row that would have shown
a machine key under the old renderer. Second, four shapes deliberately carry the font value
`"Noto Serif"`, which no editor offers: it is a fall-through case for the renderer, not evidence about
what a host can choose, and §9.5 is where that distinction was got wrong the first time.

Measured across all 40:

* **overflow** — `documentElement.scrollWidth == clientWidth` on every load, and **0** elements whose
  right edge passed the viewport, at 360 × 740, 390 × 844, 768 × 1024 and 1440 × 900. This is the re-run
  of the `break-words` rule that §4 of the render contract exists to record;
* **host intent survives the chain** — the guest document's resolved `font-family`, `font-size`, `color`
  and `text-align` equalled the values in that shape's own style object, on all 10 shapes at all 4
  viewports. Two of those 40 sets are worth reading precisely, because both are mechanism rather than
  accident: `minimal` declares `{}`, so its document renders at the stated defaults
  (`DEFAULT_LEAD = 26`, `var(--ink)`, centred) instead of at the page's 16 px body text — the defect
  §4 of the render contract exists for — and `hostile-markup` declares an invalid `alignment`, which
  `parseStyle` answers by refusing the **whole** style object, so its `999` and `red;}` never reach a
  declaration either. The four shapes carrying `"Noto Serif"` resolved to a stack led by that family and
  fell through to the document's own script stack, which is the designed behaviour, not the gap §7.6
  invented. This is the measurement that replaces §9.5's retracted claim with a number;
* **structure** — one `<h1>` per document, `lang` on the article taken from the shape's own primary
  language, and dates drawn from their stored digits rather than from a locale guess;
* **links** — the venue anchors that appeared were `https`, carried `rel="noopener noreferrer"
  target="_blank"`, and the non-`https` alternative never reached a page because `venues_map_url_check`
  refuses the write (§8.2's unplanned evidence, same constraint, still doing the job);
* **injection** — the `hostile-markup` shape's markup, style strings and `javascript:` hrefs produced no
  element, no attribute and no declaration of their own in the document; they were drawn as words. React's
  escaping is the mechanism and the renderer's 15 pinned cases are the guarantee; the screenshot of that
  shape (§9.5) is the picture;
* **machine values** — no uuid, and no `host_defined`, appeared in any of the 40 documents, including the
  five shapes that hold a person whose `role_label` is `NULL`: those people rendered by name alone, with
  no separator beside them.
* **keyboard** — Tab walked the venue links in DOM order, Shift+Tab walked back, and the fourth Tab left
  the document; every stop matched `:focus-visible` and was scrolled into view. The contrast shortfall
  this measurement also produced is §9.13's, not a passing grade.

Screenshot capture worked for this pass, so six of the ten shapes were also captured at 360 × 740 @3x and
looked at as images (§9.5). Where capture is quoted, the claim is "this rendered as letters of that
script", and nothing more.

### 9.10 §13: where the final build's requests actually went

One cold load of a real guest page from the final bundle, classified from the browser's request log by
destination:

| destination | count | what it is |
| --- | --- | --- |
| the local preview origin (`127.0.0.1:4173`) | 8 | 1 document + 7 same-origin chunks / stylesheet / icon |
| `fonts.googleapis.com` | 1 | the stylesheet |
| `fonts.gstatic.com` | 10 | the font files that stylesheet pulls |
| local API (`127.0.0.1:54400`) | 2 | 1 `POST /rest/v1/rpc/resolve_public_invitation` + its `OPTIONS` preflight |
| anything else | **0** | — |
| **total** | **21** | |

* **0** requests to any hosted `supabase.co` host, and no command in this stage addressed a remote
  project (§4.3's proof, unchanged);
* **0** occurrences of the credential in any request URL, including the fonts requests (§9.3);
* the resolver call's own headers, read rather than reasoned about: `apikey` and `authorization` carrying
  **the same publishable key value** — so the anonymous key, never a user JWT — plus
  `x-invitation-token: <the 43-character credential>`, `content-profile: api`,
  `x-client-info: supabase-js-web/2.97.0`, an **empty** `referer`, a body of `{}`, no `Cookie` header, and
  no `Set-Cookie` in the response.

Against §8.7's pinned-tree count of **12**, this is 21. The growth is entirely inside two already-known
categories — Google Fonts files went 2 → 10 and local assets 5 → 7 — and neither the API half (1 POST +
1 preflight, both before) nor the set of third-party origins (Google Fonts only, before and now) changed.
**This pass did not isolate the cause of that difference** and does not offer one as a finding; what it
did was recount on the shipped bundle, in one cold load, and publish the categories. There is no "zero
network" claim here or anywhere else in this file, and the page genuinely reaches two Google hosts.

### 9.11 §14: the battery, on the final tree

The order §14 demanded — nothing quoted from an earlier run, and the reinstall before anything else. The
dev and preview servers were stopped, `node_modules` was deleted, `npm ci` reinstalled from
`package-lock.json` (**exit 0**), and only then did the gates below run. Afterwards the only changes to
the tree were markdown.

| Gate | Command | Result |
| --- | --- | --- |
| lint | `npm run lint` | **0 errors**, 8 warnings — all pre-existing `react-refresh/only-export-components` in `src/components/ui/*` |
| typecheck | `npm run typecheck` | clean |
| generated types | `npm run dbtypes:check` | OK — **17** migration files reconciled, 0 findings, regenerated from the **local** database with no `--linked` flag anywhere in the command |
| product contract | `npm run product:check` | OK — **158** active files, **0 violations** |
| unit + component | `npm run test` | **188 tests / 18 files, all passing** |
| build | `npm run build` | succeeds; largest chunk (the entry) **489.05 kB / 147.25 kB gzip**, `InvitationRenderer` **7.80 kB / 2.85 kB gzip** in its own chunk, the guest route in its own — `vite.config.ts`'s warning threshold untouched, so nothing was quieted by raising it |
| production audit | `npm audit --omit=dev --audit-level=high` | **exit 0** — 2 *moderate* `react-router` advisories, unchanged from §8.6, range not widened (§9.13) |
| database, both chains | `bash supabase/tests/stage2/run.sh both` | clean 41 / 46 / 269 / 325 / 94; legacy 75 / 49 / 269 / 325 / 94 — **exit 0** |
| database, Stage 0 baseline | `bash supabase/tests/rls/run.sh` | **24**, exit 0 |
| API over the real local stack | `bash supabase/tests/api/run.sh` | publication **37/37**, security **56/56**, exit 0, and the post-run leak check returned the row counts it started from |
| whitespace | `git diff --check` | exit 0 |
| UI regression | the §9.1 journey | run on the build from this battery, at the end of the sequence |

**Re-run after §9's own markdown**, because a report that edits the tree it certifies must say so:
`npm run lint` → 0 errors / the same 8 warnings; `npm run typecheck` → clean; `npm run dbtypes:check` →
17 migration files, 0 findings; `npm run test` → **188 / 18 files** again; `npm run build` → the asset
names came back **byte-identical** — all 30 assets' content-hash and byte-size triples matched a
fingerprint captured before the document work (`diff` between the two captures differs only in the
whitespace of my own printing, not in one hash or one length), and `dist/index.html` kept md5
`788a374ddb36159d1fcb4d37c75f6f31`, the §9.3 document. That is the proof that the bundle §9.1's journey
was tested in is the bundle this branch describes; `npm audit` → exit 0; `git diff --check` → exit 0.

**Then twice more, as §9 kept being written.** After the §9.0 table, §9.1's wording fix and the §9.7/§9.8
numbering fixes, the whole set ran again: lint **0 errors** / the same 8 pre-existing `react-refresh`
warnings, typecheck clean, `dbtypes:check` 17 migration files / 0 findings, `product:check` **154** files /
**0 violations**, `npm run test` **188 tests / 18 files**, and `npm run build` exit 0 with the entry chunk
at **489.05 kB / 147.25 kB gzip**, `InvitationRenderer` at **7.80 kB / 2.85 kB gzip**, **30** assets in
`dist/assets` and `dist/index.html` at md5 `788a374ddb36159d1fcb4d37c75f6f31` again — the same three
fingerprints, so those edits touched nothing the bundle is built from.

The lines immediately below were measured against the tree as this section's **last** commit left it, after
§9.14's cleanup rewrite and §9.5's font paragraph: lint, typecheck and `product:check` each exit **0**, and
`git diff --check` is exit 0 over the working tree and over the closure range from `78a37da`. Nothing
outside `docs/` changed after the run above, and `docs/audits/` is outside the product checker's scanned
paths, which is why the test total and the bundle numbers are quoted from that run rather than repeated a
fourth time.

Two counts legitimately moved and are reported moved rather than smoothed:

* `product:check` now prints **154** active files where the table above printed 158. The checker scans
  `.txt` among its extensions and does not skip dotted files, so the four scratch `*.txt` dumps §9.9's
  harness left in the repository root were being counted; §9.14 deleted them, and 154 is what the tree
  under this commit contains. **0 violations both times.**
* The same suite ran in **5.95 s** once and **38.17 s** once on this machine, which is the §9.12
  contention note in the other direction — the wall clock moves, the pass count does not.

The two database runners were executed again after §9.14's deletes, on the now-empty local stack, and
returned the same numbers as the table above — `stage2/run.sh both` exit 0 with 41 / 46 / 269 / 325 / 94
clean and 75 / 49 / 269 / 325 / 94 legacy, `rls/run.sh` at 24, and `api/run.sh` at 37/37 and 56/56 with
its post-run check now reporting `weddings back to 0 rows`, `auth.users back to 0 rows`, `invitation_drafts
back to 0 rows`. That is also the check that §9.14 removed test *data* and nothing the suites need.

Two interlocks worth naming, because they are the difference between "a suite passed" and "this suite
could not have quietly hit something else": the SQL runners refuse to start unless the target is a
loopback host on a port they created themselves, and the API runner reads its URL from `.env.local`,
which holds only the loopback URL and this stopped-and-started local stack's keys. `--single-transaction`
and the throwaway containers mean no SQL assertion in this table can persist anything to the stack.

### 9.12 Drift this pass found in its own instruments

Three measurements moved underneath the earlier sections, and each is recorded as an instrument note
rather than folded into a result:

* **PostgREST 16.2 → 16.3.** §4.1's corrected table and §8.5 both read `server: postgrest/16.2` off the
  live local stack; this pass read **`postgrest/16.3`** from the same response header on the same host
  and port. Nothing in Stage 3 pins a PostgREST version, no assertion in any suite depends on one, and the
  API suites were re-run afterwards on 16.3 (§9.11) — so the effect on the evidence is nil, but the number
  in §8.5 is no longer what the stack reports, and saying so is cheaper than being caught by it.
* **vitest timeouts that were not test failures.** An earlier run of `npm run test` in this pass produced
  5000 ms timeouts on files that pass in ~2 s. Per "if a gate fails, investigate; do not weaken the gate",
  the cause was isolated before anything was edited: `--no-file-parallelism` ran **188/188**, and a
  subsequent plain parallel run also passed **188/188** (§9.11), which points at worker oversubscription
  on this machine rather than at a slow assertion. No timeout value, no `test` config and no assertion was
  changed to make the line green.
* **The entry chunk grew, 488.93 kB → 489.05 kB** (gzip 147.23 → 147.25), and `InvitationRenderer` with
  it, 7.72 → 7.80 kB. §7.8's figures were the pinned tree before §9.1's editor work; the final build is
  larger on the same file set and still under the untouched 500 kB threshold. Both numbers stay in the
  file because both were real at their moment.

### 9.13 Observations recorded and deliberately not repaired

The pass was told to fix the closure defects and nothing else, so these are disclosures, not work:

1. **The keyboard focus indicator is 2.54:1 against the paper**, where WCAG 1.4.11 asks 3:1 of a focus
   indicator. It is a single 2 px `box-shadow` ring in `rgb(205, 146, 45)` with a transparent `outline`,
   measured against the card's own `rgb(255, 246, 240)`. Body text and link text
   measure 8.82:1 on the same paper and the links are 216 × 47 CSS px, so this is one narrow shortfall
   rather than a general accessibility problem — and no design token was changed on a guess.
   `render-contract.md` §5 finding 5 carries it. **Repaired by the next pass; see §10.4** — including
   the correction that the colour in this bullet is `--gold`, applied by a per-component override,
   and not `--ring`, which was already the ceremonial token.
2. **Two moderate `react-router` advisories remain** (an open-redirect bypass in `<Link>`/`useNavigate`,
   and `deserializeErrors()` constructor injection in SSR hydration — the app is not SSR, and the
   `Link` usage takes literals). npm's fix is a `--force` major bump; `^6.30.1` was not widened, and the
   advisory pair is unchanged from §8.6's record.
3. **`document.title` is unbounded** — 465 characters on the `long-title` shape. Browsers cope; a chat
   app's link card may not. Truncating it is a sharing decision for whoever next owns sharing.
4. **The `wa.me` share affordance still carries the invitation URL in a query string** (§6.3's known
   limit). It is an `<a href>` that issues no request until the host taps it, so nothing leaks on page
   load, and the review did not list it as a closure defect.

### 9.14 §16/§17: cleanup scoped to this pass

Everything below is a row or file this pass created, deleted by exact name, and then verified — not a
"probably fine" sweep of a directory.

* **Rows removed from the local stack**, in dependency order, in one transaction:
  `DELETE 14` from `private.access_tokens`, `DELETE 16` from `public.publications`, `DELETE 16` from
  `public.invitation_versions`, `DELETE 10` from the §9.9 harness table followed by
  `DROP TABLE public.s12_manifest`, `DELETE 12` from `public.weddings` scoped to the two synthetic owners
  (which cascaded their 12 drafts, 32 people, 12 venues and 16 events), `DELETE 2` from `public.user_roles`,
  `DELETE 0` from `public.profiles`, `DELETE 2` from `auth.users`. The `profiles` line matched nothing and
  is reported as it printed; the post-check below is what makes it a disclosed oddity rather than a
  silent one. Afterwards `weddings`, `invitation_drafts`, `invitation_versions`, `publications`,
  `private.access_tokens`, `wedding_people`, `venues`, `wedding_events`, `auth.users`, `profiles`,
  `user_roles`, `entitlements`, `guest_households` and `private.audit_events` all count **0**, and
  `to_regclass('public.s12_manifest')` is null.
* **Both E2E accounts went with them** — `s3final+e2e@example.test` (this pass, §9.1) and
  `s3cr1+hosta@example.test` plus its `Arun weds Deepa — closure E2E` wedding (the superseded attempt
  that ran before the §14 reinstall, recorded at §9.1's "replaces rather than adds to"). Their raw
  credentials were never in the database in any case (§6.3 stores a hash), and the ones this pass held in
  a scratch file are deleted with it, so no live link survives this section.
* **Scratch files deleted**, by exact path: the sixteen `.s12-*` files in the repository root — the shape
  harness, its variants, the generator script and dumps, and `.s12-tokens.txt`, which held raw
  credentials and is the reason this bullet exists — plus `depth.txt` and every log and fingerprint file
  this pass wrote into the parent session directory (`s14*`, `s14b*`, `api.log`, `rls.log`,
  `stage2-both.log`), which are this session's scratch, not this repository's.
  `git status` now shows the tree with only this stage's real additions
  untracked, and `pnpm-lock.yaml` / `pnpm-workspace.yaml` are **still untracked and unstaged**, exactly as
  found (§8.8's discipline, not repeated by accident).
* **Throwaway containers:** the SQL runners create and remove their own; `docker ps -a` after §9.11's
  runs showed no leftovers from them, and this pass created none of its own.
* **This project's local stack** was then stopped with `npx supabase stop --no-backup`, run from the
  repository root with `supabase/config.toml`'s synthetic `project_id = "localvivaahvarnam"` as its only
  target selector and no linked-project state in `supabase/.temp` (the directory holds `cli-latest` and
  nothing else), so no remote project could be addressed by it. What it left behind, measured afterwards:
  `docker ps -a` matching `localvivaah` returns nothing, `docker volume ls` has no `localvivaah` volume
  either — so no `--no-backup` dump was written into `supabase/.branches` (that directory holds only the
  gitignored `_current_branch` pointer), nothing listens on 127.0.0.1:54400/54401/54403, and the next
  `supabase start` rebuilds the schema from the migration chain, which is the state §9.11's post-cleanup
  re-runs were measured against.
* **Not touched, and one number corrected:** the unrelated DueWeave project is still running — `docker ps`
  counts **eleven** `*_dueweave` containers now, including the crash-looping `supabase_vector_dueweave`,
  and its three volumes are still listed. §8.8 recorded "twelve"; that count in this file was one too
  high, and the correction belongs here rather than in §8.8's text. Nothing of theirs was stopped,
  reconfigured or removed by this pass — the bullet exists to say exactly that. `.env.local` (gitignored,
  loopback URL and this stack's local keys) and `supabase/.temp/cli-latest` are kept for the same reason
  §8.8 gives: the README's "API testing against the local stack" section is unrunnable without them.

### 9.15 What §9 does not claim

§8.10's list still stands in full — no RSVP, guest input, approval, PDF/image/video export, QR, payments,
entitlement granting, admin console, audit surface, reviewed tradition or template content, event/venue
editor beyond what §9.1's editor writes, uploads, Storage, Realtime, or deployment of any kind — and this
pass adds four limits of its own:

1. **One browser, one machine, one run.** §9.1's journey and §9.9's sweep were executed in a single
   Chromium via CDP on one Windows host against one local stack. Nothing is claimed about Safari, iOS
   WebView, Firefox, or a screen reader actually reading the document aloud — the accessibility evidence
   is DOM and computed-style measurement, and no WCAG conformance is asserted anywhere in this file.
2. **The datetime fields were driven, not typed** (§9.2). The chain from the app's own change handler
   onwards is executed evidence; keystroke entry into that widget is not.
3. **The 12 → 21 request delta is described, not explained** (§9.10). The categories are counted and the
   invariants (one API call plus preflight, Google Fonts as the only third party, 0 hosted requests, 0
   credentials in URLs) hold in both observations; a cause for the larger count was not isolated.
4. **Retracted claims are retracted, not re-verified in the other direction.** §9.5 shows the
   `Noto Serif Tamil` finding was false as written; it does not establish that the font story is
   correct in every respect, only that this pass measured what it can see. Likewise, "glyph fidelity
   could not be captured" (§8.4) is replaced by "captured and looked at", which is a weaker claim than
   the one §8.4 was being honest about not making: **no native speaker reviewed any of it.**

## 10. FINAL TRUTH SYNC, AND THE FOCUS RING CLOSED

Starting tree `a2b19c76`, already pushed and already accepted on its substance. This pass was told to
add no surface: re-read the readiness document against what §9 actually measured, correct one comment
that overstated its own justification, and close the one accessibility shortfall §9.13 had chosen to
carry. §5's exclusions still hold in full — no RSVP, approval, QR, image/PDF/video export, payment,
entitlement, admin, account-deletion, `document.title` truncation, `wa.me` redesign, router migration or
Stage 4 tradition content was touched, and nothing was merged, tagged or deployed.

### 10.1 The readiness document, line by line

`docs/product/feature-readiness.md` calls itself the anti-delusion document, and it had gone stale in
exactly the direction that flatters the build: it still described the pre-§9 world. Twelve statements
were corrected, each against a §9 measurement rather than against a preference:

| what it claimed | what it says now, and why |
| --- | --- |
| "PostgREST 16.2" in the preamble | the preamble now prints the reading that matches the stack at the end of the branch (`postgrest/16.3`, re-read off the live loopback header in this pass) and names 16.2 as the earlier measurement, which §4.1/§8.5 keep as their record |
| "three modules", `weddings.ts` "is the only module naming a table" | **false**, and corrected to the four modules that exist: `weddings.ts`, `weddingContent.ts`, `publication.ts`, `publicInvitation.ts` — the first two naming seven tables between them, the last two naming none and calling `api` wrappers |
| "Two of the eighteen are read by product code" | seven are read or written directly, and `publications` plus `private.access_tokens` are reached only through the wrapper functions; the other eleven are listed as carrying no client `.from()` at all |
| "13 imperative migrations" | **17**, which `npm run dbtypes:check` prints independently; Stage 2's 13 stays in Stage 2's audit as Stage 2's count |
| "322 security assertions … plus 75 catalog assertions" | 325 and 94 **at the current head** (§9.11), with the earlier pair labelled as what Stage 2 closed with. The counts were not backdated: Stage 3's own migrations added tables, and therefore policies, and therefore assertions |
| "Eight scaffold tables moved to `legacy`" | seven tables and four enum types, which is what the archive migration actually moves |
| "Measured at 360×740 on six content shapes" | 10 shapes × 4 viewports = 40 loads of real guest pages (§9.9), with the resolved font/size/colour/alignment matching each shape's own style object |
| "glyph fidelity unverifiable in this environment" | screenshots **did** succeed for the stated subset, and the claim they support is deliberately weaker: rendering verification, no native-speaker review, no WCAG claim |
| "never loaded with real data against a verified project" (dashboard) | the query ran under a real JWT in a real browser (§9.1 step 3) and rendered its **0-draft empty state**; the row stays `FOUNDATION`, because what has never been seen is a dashboard listing one real row. The qualification narrowed; the status did not inflate |
| sign-up / log-in / protected routes / logout | split into what the local stack proved and what nothing has proved: sign-up and log-in are `IMPLEMENTED (local stack qualification only)` with the synthetic account named and deleted, the signed-in pass-through is exercised, and **Log out was rendered but never clicked**, so it stays `FOUNDATION` |
| "Data-access adapter `FOUNDATION`" | `IMPLEMENTED (local stack only)`, citing §9.1's 24-step journey plus the 37 + 56 HTTP assertions, and keeping "no hosted project was ever contacted" in the same cell |
| "Hosted CI verification — runs are deferred by quota" | the honest shape of the evidence: **no run exists for this branch at all** (the workflow triggers only on `main` push or PR), and `main`'s latest attempt failed in ~2 s with no steps and no log. Quota remains the operating explanation, labelled as one |

Two rows are new, because §9 measured things the document had no line for: **keyboard operation of the
guest page** (with the 2.54:1 finding stated while it was still true, and the repaired value pointed at
§10.4) and **referrer leakage on the guest page** (with the browser-default correction from §10.3).

### 10.2 The truth search

Every tracked file was grepped for the phrases that could now mislead a reader: `PostgREST 16.2`,
`Noto Serif Tamil`, `glyph fidelity could not`, `13 migrations`, `322 security`, `75 catalogue`,
`six shapes`, `only module naming`, `never loaded with real data`, `not exercised against`.

The hits divided into three kinds, and the handling differs by kind:

* **Present-state claims that are now wrong** — all in `feature-readiness.md`, fixed above, plus one
  sentence in `stage-2-domain-blueprint.md`'s I-28 row that printed 322 as though it were the current
  figure. It now reads "what Stage 2 closed with" and points at the larger count at the current head.
* **Historical record that must not be "fixed"** — §1–§8 of this file, §9.5's retraction of the font
  finding, and §8.4's "could not be captured" note all stay verbatim. §9.5 and §9.12 exist to retract
  them, and a retraction that edits its own subject stops being a retraction.
* **Self-referential text** — this file and `scripts/` are excluded from `product:check`'s walk by
  design (`EXCLUDED_PREFIXES` in `scripts/check-product-contract.mjs:49`), which is worth stating out
  loud here: **no automated gate checks whether this audit tells the truth.** The readiness document is
  the machine-policed artefact; these sections are policed only by the next reader.

### 10.3 The referrer comment, corrected without touching the policy

`index.html` keeps `<meta name="referrer" content="no-referrer" />` byte-for-byte; `git diff` on that
file shows comment lines on both sides of it and nothing else. What changed is the justification, which
had overstated the threat: it said a browser "would" send the guest's full `/i/<credential>` address to
`fonts.googleapis.com` without the tag. Current browsers default to `strict-origin-when-cross-origin`,
which sends only the origin on a cross-origin HTTPS request, so the tag is not plugging that leak. The
rewritten comment says what the tag is actually for — making the property explicit and ours rather than
inherited from a default, and suppressing the referrer for **same-origin** requests too, where that
default does send the full path — keeps §9.3's measurement (the fonts request carried no `Referer` at
all), and keeps the limit no meta tag reaches: the credential is still in browser history and in
whatever access logs the hosting stack keeps.

This pass did not re-run the network capture, so §9.3's numbers remain the evidence and are cited, not
re-measured. One thing this pass did produce by accident is worth recording: while probing focus on the
guest page, a synthetic activation of the venue map link **did** navigate, and Chrome opened the host's
own typed `https://www.google.com/maps/…` URL in a new tab of the isolated context. The tab was closed
by this pass. The invitation credential is not in that destination URL, and no claim is made about that
request's `Referer` — the debugger attached after the request had completed, so it was not observed
either way.

### 10.4 The focus indicator, repaired and measured

**What changed** is one class list, `src/components/invitation/InvitationRenderer.tsx:174`: the map link
carried `focus-visible:ring-gold`, a per-component override of the design system, and now carries the
same `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
focus-visible:ring-offset-background` set that `button.tsx`, `input.tsx`, `Dashboard.tsx` and
`EditProject.tsx` already use. No colour was invented and no token was edited: `--ring` was already
`--ceremonial` (`src/index.css:55`), and the global `:focus-visible` rule (`src/index.css:134`) was
already the intended behaviour. The defect was the override, so the repair is its removal — which is why
this closes rather than carries §9.13's item 1.

**§9.13's own description of the colour was wrong, and is corrected here as well as in
`render-contract.md` §5:** `rgb(205, 146, 45)` is `--gold`, not `--ring`.

Measured on the production build served at `http://127.0.0.1:4173`, guest page opened in an **isolated
CDP browser context** (so no session, no storage, no cookies shared with the host tab), viewport
504 × 828 CSS px at dpr 1.25, driven by real CDP `Tab` / `Shift+Tab` key events:

| | indicator | adjacent background | ratio |
| --- | --- | --- | --- |
| before (§9.13) | 2 px ring `rgb(205, 146, 45)` | paper `rgb(255, 246, 240)` | **2.54:1** |
| after, guest map link | 2 px ring `rgb(107, 30, 44)` | paper offset band `rgb(255, 246, 240)` | **10.66:1** |
| after, host editor controls | same ring | same band, over a `rgb(252, 246, 238)` card | **10.66:1** against the band, 10.59:1 against the card |

The computed value read off the focused link, verbatim:
`rgb(255, 246, 240) 0px 0px 0px 2px, rgb(107, 30, 44) 0px 0px 0px 4px, rgba(0, 0, 0, 0) 0px 0px 0px 0px`
— the 2 px paper offset band, then the 2 px ceremonial ring outside it, with `outline` transparent. The
ring's own maroon against the link's maroon border is 1.00:1 and is not the relevant measure: the offset
band separates them, which is what the band is for.

Keyboard traversal re-run, on this invitation's real guest page (one venue, therefore one tabbable
control): `Tab` lands on *Open the venue map* with `:focus-visible` true and the ring above present; the
next `Tab` leaves the document (`document.activeElement` is `BODY`); `Shift+Tab` returns to the link with
the ring. On the host editor, the first `Tab` stop and the `Save Draft`, `Publish` and
`Take the link down` buttons all resolve to the identical maroon ring on the paper band. A viewport
screenshot of the focused guest page was taken and read: the indicator renders as a dark double outline
with a visible paper gap, clearly distinguishable from the card.

Pinned statically in `src/test/invitationRenderer.test.tsx`: the map link's class list must contain
`focus-visible:ring-ring` and must **not** contain `focus-visible:ring-` followed by any palette colour
(`gold|ceremonial|green|ink|line|surface`). That is the test that would fail if the override came back.
`npm test` after the change: **189 tests in 18 files**, one more than §9.11's 188, which is this test.

Two limits, stated rather than smoothed:

* This is one control's indicator and one page's traversal, in one Chromium on one Windows host at one
  viewport. **No WCAG conformance is claimed for the product** — only that this indicator now measures
  above the 3:1 that WCAG 1.4.11 asks of a focus indicator. No screen reader was run.
* **One observation found and deliberately not repaired:** the editor's prose textareas do not resolve to
  the token ring. Measured after a cache-ignoring reload, `#…-welcome` reports
  `outline: solid 2.4px rgb(44, 36, 33)` with all three `box-shadow` layers transparent, while the
  `--tw-ring-*` variables on the same element are correctly set to the ceremonial colour — i.e. those
  fields show the browser's own focus outline instead of the design-system one. It is pre-existing (this
  pass's diff touches one line of `InvitationRenderer.tsx` and seven of its test), it is a *higher*
  contrast than the token ring rather than a shortfall, and its cause was not isolated — so it is
  recorded here as an unexplained inconsistency in the editor, not as a fixed defect.

### 10.5 The journey that made something to measure, and the battery on this tree

The guest page above had to exist, so it was made the way §9.1 insists on making them: sign-up through
the product's own form against the local stack's GoTrue (`s10focus+e2e@example.test`), log-in, dashboard
empty state, create a wedding, then one venue row and one ceremony row typed into the editor's own forms,
`Save Draft`, *Freeze this draft as a version*, *Publish*, and the shown-once address opened in the
isolated context. No SQL was used to author anything; the only SQL in this section is the read-only
discovery and the scoped delete in §10.6. §9.2's disclosure repeats itself: the two `datetime-local`
fields were set through the widget's native value setter plus `input`/`change`, not by emulated
keystrokes, because the emulated keystrokes do not reach them.

Gates, run after the last edit:

| gate | result |
| --- | --- |
| `npm run lint` | 0 errors, 8 warnings — all `react-refresh/only-export-components`, seven in `src/components/ui/` and one in `src/components/auth/AuthProvider.tsx`, none of them new in §9.11's set |
| `npm run typecheck` | clean |
| `npm run dbtypes:check` | "Database contract OK — 17 migration file(s). schema: 18 public + 10 non-client table(s); client types: 18 table(s); data layer: 23 query column group(s) reconciled, 0 finding(s)" |
| `npm run product:check` | "Product contract OK — 154 active file(s) scanned, 0 violation(s)" |
| `npm test` | 18 files, **189 passed**, 0 failed |
| `npm run build` | built; guest route `PublicInvitation` 2.38 kB and `InvitationRenderer` 7.86 kB still split from `index` 557.19 kB (gzip 164.96 kB) |
| `npm audit --omit=dev --audit-level=high` | 0 high/critical; the same 2 moderate `react-router` advisories §9.13 item 2 records |
| `git diff --check` | clean (the only stderr is a `core.autocrlf` notice on the test file, not a whitespace error) |

Two numbers moved and both were investigated before being reported:

* **`product:check` prints 154, where §9.11 recorded 158.** The tracked file set is identical to the
  commit under audit — `git diff --name-status` against it lists modified files only, with no `A` and no
  `D` — so the four missing files were untracked scratch with scanned extensions
  (`.txt`/`.mjs`/`.json`/`.md`), deleted by §9.14 *after* §9.11 measured. The count went down because
  the tree got cleaner, not because the checker got quieter. `docs/audits/` and `scripts/` are excluded
  from its walk either way.
* **The entry chunk is 557.19 kB, not §9.11's 489.05 kB.** This pass re-verified the cause found earlier
  in the same tree: `node_modules` is now pnpm-managed (`.pnpm/`, `.modules.yaml`, Vite resolved from
  `.pnpm/vite@5.4.21_…`) and was rebuilt after §9.11's battery ran. Reverting both bundle-affecting files
  and rebuilding produced **byte-identical** output (557,198 bytes), so this pass's change is not the
  cause. Vite's 500 kB warning threshold was **not** raised; the warning still prints, and the guest-facing
  chunks are still separate.

Because a source file changed, the whole battery was re-run on the live local stack rather than trusted
from §9.11, and every count matched it exactly:

| suite | result |
| --- | --- |
| `supabase/tests/rls/run.sh` | **24** Stage 0 assertions, `RESULT: PASS` |
| `supabase/tests/stage2/run.sh both`, clean chain | outcome **41**, draft invariant **46**, publication boundary **269**, privilege + RLS attacks **325**, catalogue **94** |
| same, legacy chain | outcome **75**, draft invariant **49**, publication **269**, attacks **325**, catalogue **94** |
| `supabase/tests/api/run.sh` | publication **37/37**, security **56/56**, preconditions "17 migrations applied, matching supabase/migrations", post-run "weddings back to 1 rows / auth.users back to 1 / invitation_drafts back to 1" |

The API runner printed its target before touching it —
`project_id=localvivaahvarnam`, containers `supabase_{kong,rest,auth,db}_localvivaahvarnam` — which is
the proof that the 1 row it returned to was this pass's synthetic wedding, not somebody else's data. No
hosted project was contacted by any command in this section.

### 10.6 Cleanup, scoped to what this pass created

* **Rows**, deleted in one transaction by exact id (wedding `7b3af3ca-…`, user `017e59ee-…`), printed as
  executed: `access_tokens 1`, `publications 1`, `invitation_versions 1`, `wedding_events 1`,
  `venues 1`, `wedding_people 0` (this pass never added a person), `invitation_drafts 1`, `weddings 1`,
  `user_roles 1`, `profiles 1`, `auth.users 1`. Afterwards every one of
  `weddings`, `invitation_drafts`, `invitation_versions`, `publications`, `private.access_tokens`,
  `wedding_people`, `venues`, `wedding_events`, `auth.users`, `profiles`, `user_roles`, `entitlements`,
  `guest_households` and `private.audit_events` counts **0**. The published address died with its
  credential row, so no live link survives this section.
* **Processes:** the `vite preview` server (PID 35040, bound to `127.0.0.1:4173` and confirmed not
  listening on any other interface while it ran) was terminated, and nothing now listens on
  4173/54400/54401/54403. The tab the accidental navigation opened was closed.
* **Files:** `s10-preview.log` in the parent session directory, written by this pass, deleted by exact
  path. Nothing was deleted recursively, and no state, worktree or temp root was touched.
* **Stack:** `npx supabase stop --no-backup`, run from the repository root against
  `supabase/config.toml`'s synthetic `project_id = "localvivaahvarnam"` with no linked-project state
  (`supabase/.temp` holds only `cli-latest`). After it: no `localvivaah` container in `docker ps -a`, no
  `localvivaah` volume, and `supabase/.branches` holding only the `_current_branch` pointer — so no
  backup dump was written. `.env.local` (loopback URL, this stack's local keys) is kept, as §8.8 and
  §9.14 keep it, because the README's local-testing section is unrunnable without it.
* **Untouched:** the unrelated DueWeave stack still runs **11** containers, none of them stopped,
  reconfigured or removed by this pass. `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain untracked and
  unstaged, exactly as found.

### 10.7 What §10 does not claim

§8.10's list and §9.15's four limits stand in full, and this pass adds three of its own:

1. **The accessibility evidence is one control deep.** A repaired focus ratio on the guest page's map
   link, plus the same ring on four editor controls, is not an accessibility audit of the product, and
   no conformance is claimed anywhere in this file. The editor's textarea inconsistency (§10.4) is the
   clearest sign of how narrow the sample is.
2. **The journey in §10.5 corroborates §9.1; it does not replace it.** One wedding, one venue, one
   ceremony, no people, no rotation or revocation attempted, and the datetime fields driven rather than
   typed.
3. **Nothing was deployed, merged, tagged or re-migrated.** The local stack was stopped, not reset, and
   the next `supabase start` rebuilds from the same 17-file chain §9.11 qualified.
