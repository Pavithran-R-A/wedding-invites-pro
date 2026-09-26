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
