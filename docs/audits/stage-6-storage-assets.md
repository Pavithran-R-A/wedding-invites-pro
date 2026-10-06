# Stage 6 — Storage assets: uploads, one private bucket, and registry consistency

Branch `stage6/storage-assets`. Base and merge-base `1b1ef6dcc6c7893c42afc29787e3724ab062eb1b`, which is also
`refs/heads/main` at the time this stage opened (Stage 5 was merged upstream between 16:55 and 17:18 IST on
2026-10-05; `../q6-logs/s6-g1-remote-reconcile.log` holds the `git ls-remote` capture). Working clone
`Documents/Qoder/2026-09-24/37be0a2a/s5qual`; every measurement in this file is from that clone.

Append-only. A section is never edited after it is committed; a wrong statement is corrected by a later section
that names it.

## 1. Scope, taken from the repository rather than from this stage's ambition

The repository defines Stage 6 in exactly one line, `docs/architecture/domain-model.md:374`:

> `| Uploads and Storage policies | registry table only, no Storage integration | Stage 6 |`

Nothing else in `docs/` or `README.md` assigns work to Stage 6 (the only other hits are Stage 5's own
"no Stage 6 was started" closure statements). So the scope of this stage is: give the existing
`public.wedding_assets` registry a real Storage backend, with the bucket, object-key, RLS and consistency
contracts written down first. Guest-facing asset delivery is not in that line, and §7 rules on it explicitly.

The pre-existing doctrine this stage must honour is `docs/architecture/stage-2-domain-blueprint.md` §15
(`:308-324`), quoted: "Content-type validated and re-encoded where possible; **no user-supplied SVG or HTML
ever rendered without the sanitiser boundary**; size limits enforced before storage; private buckets with
time-limited signed URLs, never public URLs guessed from ids", sensitivity "Wedding photographs of minors and
relatives … private-by-default, no public listing, deletion propagation to generated derivatives, and a stated
retention period", and the storage decision "Table. Object storage cannot enforce app-level permissions, and
each asset needs lifecycle, scan state, and provenance."

### 1.1 What the schema already says (read, not assumed)

* `supabase/migrations/20260925120400_stage2_assets_entitlements_secrets.sql:11-33` creates
  `public.wedding_assets` with `id`, `wedding_id → weddings ON DELETE CASCADE`, `asset_kind` in
  `('photo','monogram','decorative','audio','generated_output')`, `label`, `object_key text NOT NULL UNIQUE`
  with `CHECK (length(btrim(object_key)) > 0 AND object_key NOT LIKE '/%' AND object_key NOT LIKE '%..%')`,
  `mime_type`, `size_bytes bigint CHECK (>= 0 OR NULL)`, `is_generated`, `created_at`, `updated_at`, plus
  `wedding_assets_wedding_kind_idx` and the `set_updated_at` trigger. Its own header at `:8` already says the
  upload itself is later work: "-- Customer asset metadata (upload itself is Storage work, later stage)".
  There is no bucket column and no server-only write path.
* `supabase/migrations/20260925120500_stage2_rls_and_grants.sql`: RLS enabled (`:95`), table-level `GRANT SELECT`
  (statement at `:27`, `public.wedding_assets` as a list member at `:40`), `GRANT INSERT, UPDATE, DELETE`
  (statement at `:50`, member at `:59`), and four permissive `TO authenticated` policies — `owners_read_assets`
  (`:311`), `owners_manage_assets` (`:316`), `owners_update_assets` (`:321`), `owners_delete_assets` (`:330`) —
  every one of them `EXISTS (SELECT 1 FROM public.weddings w WHERE w.id = wedding_assets.wedding_id AND
  w.owner_user_id = auth.uid())`.
* Storage is absent from the stack today: `supabase/config.toml:47-48` is `[storage]` / `enabled = false`, and
  `docker ps` measured five containers only — `supabase_db_localvivaahvarnam`,
  `supabase_rest_localvivaahvarnam`, `supabase_auth_localvivaahvarnam`, `supabase_kong_localvivaahvarnam`,
  `supabase_inbucket_localvivaahvarnam`. `pg_namespace` lists `storage` (the postgres image always creates the
  schema) while `select tablename from pg_tables where schemaname='storage'` returned **zero rows**, so there
  are no `buckets`/`objects` tables until the storage service runs.
* No SQL, TS or config file anywhere in the repository references `storage.objects` or `storage.buckets`
  (inventory in §2.1 of the Stage 6 pre-work read; the search covered `supabase/`, `src/`, `scripts/`, `content/`).

### 1.2 The tripwires a Stage 6 migration must consciously satisfy or consciously extend

| Instrument | Anchor | Why it bites here |
|---|---|---|
| `C18 every policy targets authenticated alone` | `supabase/tests/stage2/40_catalog.sql:456-459` | Unfiltered by schema — a `TO public` storage policy fails the Stage 2 battery. §7 uses this as evidence. |
| `C19 every policy is permissive` | `:460-461` | Stage 6 storage policies must be permissive and must not need RESTRICTIVE logic to be safe. |
| `C20 each canonical table has exactly one SELECT policy … = 19::bigint` | `:462-466` | Counts `public` only. Stage 6 adds no `public` table, so the literal must stay 19; if it moves, that is a scope breach. |
| `C21/C22` write-policy sets, server-only tables | `:467-485` | `wedding_assets` is already in `owner_crud_tbls` (`:138-140`); no new entry should be needed. |
| `C24 private schema tables carry no policy` | `:485` | The Stage 6 key/consistency trigger functions go in `private`, which stays policy-free. |
| inventory arrays + quantity columns | `:112-212`, `:944-962` | Column-set assertions over `public` tables: a new `wedding_assets` column must be reflected here, not silently tolerated. |
| asset CHECK refusals and constraint names | `supabase/tests/stage2/20_attacks.sql:1166-1177`, `:1299-1302` | Seed rows (`:314-316`) insert literal `object_key` values; a server-minted key changes what those inserts mean, and the battery has to say so out loud. |
| `B28 the assets and the entitlements are not part of an invitation` | `supabase/tests/stage3/30_publication.sql:517-519` | The published snapshot must still contain no `object_key` after Stage 6. |
| REST cross-tenant + anon denial rows | `supabase/tests/api/stage3_security.test.mjs:444-462`, `:515-529` | Includes `object_key: 'unowned/${RUN_TAG}/${n}.jpg'` expecting 42501 — a key the client may no longer supply at all. |
| migration-count interlock | `supabase/tests/api/run.sh:114-121` | Applied ledger must equal the file count, dynamically; each new Stage 6 file is counted, none may be skipped. |
| exact column parity with generated types | `scripts/check-db-contract.mjs` (`NON_CLIENT_SCHEMAS = ["private","legacy"]` `:52`, `FORBIDDEN_CANONICAL_COLUMNS` `:61-72`, Row-vs-catalog diff `:511-516`) | `upload_status` must land in `src/integrations/supabase/types.ts` byte-for-byte, and no forbidden scaffold column may appear. |
| surface containment | `check-db-contract.mjs` + `scripts/check-product-contract.mjs` | `.from(`/`.rpc(` are banned in `src/pages` and `src/components`; every storage call must live in the adapter module. |
| `service-role-key-in-browser-code` | `scripts/check-product-contract.mjs` (`/SERVICE_ROLE_KEY/g` over `src/`, `index.html`) | Storage makes a service-key shortcut tempting; the rule stays and §8 adds a bundle-level check. |

`docs/product/feature-readiness.md:187` ("no Storage bucket, upload or key producer exists — the registry is
empty") and `:221-222` (no client `.from()` on `wedding_assets`; migration count prose) are the documentation
claims this stage either falsifies or rewrites — recorded in §8 rather than edited in place. One discrepancy is
flagged, not resolved: `:222` and the `dbtypes:check` sentence it quotes both say **18** migration files, while
`ls supabase/migrations | wc -l` on this branch measures **19**. The re-measurement belongs to S6-8; this pass
will not restate a number it has not produced since Docker stopped answering.

## 2. Current Supabase Storage behaviour, verified instead of remembered

Sources were fetched on 2026-10-05 and kept verbatim in `../q6-logs/` so a later reader can re-check the wording
rather than trust this table: `doc-access-control.md` (4,397 B), `doc-file-limits.md` (1,921 B),
`doc-schema-design.md` (2,744 B), `doc-helper-functions.md` (3,444 B), `doc-creating-buckets.md` (3,335 B),
`doc-ownership.md` (1,590 B), `doc-downloads.md` (4,110 B) — all from `raw.githubusercontent.com/supabase/
supabase/master/apps/docs/content/…`. The CLI used for the local checks is the cached platform binary reporting
`2.119.0` (`%LOCALAPPDATA%\npm-cache\_npx\b96a6bd565c470ce\node_modules\@supabase\cli-windows-x64\bin\supabase.exe`),
which matches `supabase/.temp/cli-latest` = `v2.119.0`; the Stage 2-5 audits recorded `2.118.0`, so this stage
runs one CLI minor version ahead of the last qualified one and says so.

| Claim used by the design | Verified wording (abridged quotes) | Where |
|---|---|---|
| Deny-by-default | "By default Storage does not allow any uploads to buckets without RLS policies. You selectively allow certain operations by creating RLS policies on the `storage.objects` table." | access-control |
| **upsert triad** | "The only RLS policy required for uploading objects is to grant the `INSERT` permission… To allow overwriting files using the `upsert` functionality you will need to additionally grant `SELECT` and `UPDATE` permissions." | access-control |
| Ownership column | "the owner is the user who created the resource and the value is derived from the `sub` claim in the JWT. We store the `owner` in the `owner_id` column"; "`owner` is deprecated and will be removed. Use `owner_id` instead"; with a `service_key` "the owner will not be set and the resource will be owned by anyone". | ownership |
| Ownership ≠ access control | "By itself, the ownership of a resource does not provide any access control." | ownership |
| Path helpers | `storage.foldername(name)` returns the folder array (`public/subfolder/avatar.png` → `['public','subfolder']`), `storage.filename()`, `storage.extension()`. | helper-functions |
| **Operation-aware SELECT** (newer than this repo's prior knowledge) | "`storage.allow_only_operation()` … Returns `true` when the current Storage API operation exactly matches the provided operation name … such as object listing versus object download"; names normalise so `storage.object.list` ≡ `object.list`; "without it users would be able to list the bucket contents". | helper-functions, access-control |
| Bucket config columns | `buckets { id PK, name, public, file_size_limit bigint, allowed_mime_types text[], owner_id }`; `objects { id, bucket_id FK, name, metadata jsonb, path_tokens, version, owner_id }` | schema-design |
| SQL is for reading, not writing | "it's crucial to consider all records in Storage tables as read-only. All operations, including uploading, copying, moving, and deleting, should **exclusively go through the API** … Deleting the metadata doesn't remove the object in the underlying storage provider." | schema-design |
| Don't alter the storage schema; indexes are invited | "We strongly recommend refraining from making any alterations to the `storage` schema … However, we encourage you to add custom indexes … for the RLS policies you create" | schema-design |
| Bucket creation is plain SQL too | `insert into storage.buckets (id, name, public) values ('avatars','avatars',true);` and `createBucket('avatars', { public, allowedMimeTypes, fileSizeLimit })` | creating-buckets |
| File-name character set | names may contain alphanumerics and only ``_ - . ' , ! * & $ @ = ; : + ? ( )`` plus whitespace | file-limits |
| Two limits, nested | "Additionally, you can specify the maximum file size on a per bucket level … but it can't be higher than this global limit." | file-limits |
| Service key bypasses everything | "Service keys entirely bypass RLS policies, granting you unrestricted access to all Storage APIs." | access-control |
| Signed URLs | private-bucket objects "are not accessible via a public URL"; `createSignedUrl(path, expiresIn)`; signed URLs use "a dedicated internal key … separate from your project's Auth JWT signing key", stay valid until expiry across auth-key rotation, and revocation needs support contact | downloads |
| Local stack services for storage | `supabase start --help` lists `storage-api` and `imgproxy` among the `--exclude` names, i.e. both exist in CLI 2.119.0 | measured CLI output |
| No bucket-as-code in this CLI | `supabase storage --help` subcommands are `ls cp mv rm` only; there is no `buckets` command in 2.119.0 (asking for it printed the root command list) | measured CLI output |

Two consequences that are not obvious and that the design below depends on:

1. **The Storage service impersonates the API role.** A browser upload executes its `INSERT` into
   `storage.objects` as `authenticated`, so that role must keep table-level `INSERT`/`DELETE` privileges for the
   API to function at all; the security boundary is the policy, plus the fact that `storage` is **not** in
   `[api] schemas = ["public","api"]` (`supabase/config.toml:32`), so no client can reach the SQL table over
   REST. "No direct INSERT/UPDATE/DELETE against storage metadata tables" is therefore implemented and proven as
   *unreachability over the exposed surface*, not as a revocation that would break uploads. §6 A11 measures the
   REST attempt rather than asserting it.
2. **`UPDATE` is a policy we can choose not to have.** Because the upsert triad is real, refusing to grant an
   `UPDATE` policy on `storage.objects` makes in-place overwrite impossible — which is the cheaper invariant to
   defend than a replace path that silently re-points a `ready` row at different bytes. §5.3 turns that into the
   replace lifecycle, and §6 A7 proves the refusal.

### 2.1 Unverified by documentation, scheduled as measurements

* Whether `supabase db reset`/`start` applies our migrations before or after the storage service creates
  `storage.buckets`/`storage.objects`. If migrations run first, a `CREATE POLICY … ON storage.objects` or
  `INSERT INTO storage.buckets` fails outright, and a guard that silently skips it would be **a rule that did
  not run, not a rule that passed**. Stage 6 therefore requires the storage objects to exist before the Stage 6
  migration is *considered applied*, and the harness asserts it (S6-3).
* The exact `storage.buckets` column types in image `public.ecr.aws/supabase/storage-api` as started by CLI
  2.119.0, and whether `allowed_mime_types`/`file_size_limit` are honoured locally the same way as hosted.
* Whether the operation names accepted by `storage.allow_only_operation()` in the local image match the documented
  `object.list` / `storage.object.get_authenticated` spellings. A wrong spelling makes a policy inert.

## 3. Ownership and storage invariants

Numbered so the batteries can cite them.

| ID | Invariant | Enforced by |
|---|---|---|
| I1 | Every asset belongs to exactly one wedding, and the wedding belongs to exactly one host account. Ownership of an asset is never a property of the asset row alone. | existing `wedding_id` FK + `owners_*` policies + I2/I3 |
| I2 | The object key is produced by the database, from `wedding_id`, `asset_kind` and the row's own `id`. A client cannot supply, choose or influence any segment of it. | new BEFORE trigger on `public.wedding_assets`; refused with a named SQLSTATE if any non-empty key is presented |
| I3 | An object may exist in Storage only where a registry row already claims that exact key. There is no such thing as an unregistered object inside the wedding bucket, in steady state. | `INSERT` policy on `storage.objects` requires `EXISTS` a `staged` row with `object_key = name` |
| I4 | A row may claim `ready` only while the bytes exist with the same bucket, key, MIME type and size the row records. | `UPDATE` trigger reading `storage.objects` (read-only use of the storage schema, per §2) |
| I5 | A row never becomes a lie: `ready` may only move to `tombstoned`, never back to `staged`, and a `ready` row may not be deleted while its object exists. | transition trigger + delete precondition |
| I6 | An object may be deleted only if the registry row for it is `tombstoned`, or if no row ever claimed it (orphan sweep). | `DELETE` policy on `storage.objects` |
| I7 | No asset, object, URL or listing is reachable by `anon`. Every Stage 6 policy targets `authenticated` alone, like the rest of the product. | policy `TO authenticated` + `C18` |
| I8 | Nothing about an asset's location is public: no public bucket, no `TO public` policy, no public URL, and preview goes through a short-lived signed URL only. | bucket `public = false` + §2 signed-URL facts + B28 stays green |
| I9 | The set of writable things a browser can reach is unchanged: `storage` and `private` and `internal_api` remain unexposed over REST. | `[api] schemas` untouched + A11 |
| I10 | A secret that could bypass RLS (`service_role`, storage admin tokens) never appears in `src/`, `index.html`, `dist/`, or any log this stage writes. | existing product-contract rule + §8 bundle/credential sweep |

## 4. Bucket and object-key contract

* **Bucket id `wedding-assets`**, one bucket for the whole product, `public = false`,
  `file_size_limit = 5242880` (5 MiB) and `allowed_mime_types = ('image/jpeg','image/png','image/webp','audio/mpeg')`.
  No `image/svg+xml`, no `text/html`, no `application/pdf` in V1 — the blueprint's "no user-supplied SVG or HTML"
  rule is enforced at the bucket, before any sanitiser or renderer is involved. The local global limit must be
  equal or higher; measured, not assumed (S6-3).
* **Key grammar**: `weddings/<wedding-uuid>/<asset-kind>/<asset-row-uuid>`, four segments, no extension. The last
  segment is the registry row's own `id`, so `objects.name` and `wedding_assets.object_key` are two views of one
  fact, and the pair is unique without a second identifier. Dropping the extension is deliberate: the served
  type comes from the object's stored metadata and the row's `mime_type`, so a file name can never disagree with
  what it actually is, and every character in the grammar is inside the documented file-name set (`/` as the
  separator plus UUID hex, hyphens and the kind vocabulary).
* `storage.foldername(name)` for such a key is `['weddings', <wedding-uuid>, <asset-kind>]`, so a policy can bind
  segment 2 to a wedding the caller owns and segment 3 to the declared kind without parsing strings in application
  code.
* **No user-controlled path exists at any layer.** The browser learns the key only from the `INSERT … RETURNING`
  of its own registry row. `dist/` never sees a path template, and the UI has no field that accepts one.
* `object_key`'s existing CHECK (no leading `/`, no `..`, non-blank) is kept. It is no longer the primary defence,
  but it stays as the second one so that a future code path that writes the table outside the trigger still cannot
  smuggle a traversal shape.

## 5. Registry ↔ object consistency

### 5.1 One new column

`upload_status text NOT NULL DEFAULT 'staged' CHECK (upload_status IN ('staged','ready','tombstoned'))`.

No `bucket` column: the design has exactly one bucket, and a second source of truth about it would be a column
that could disagree with the policy that pins `bucket_id`. That disagreement is A9 below, and it is refused by
construction instead of being reconciled later.

### 5.2 The state machine, and what each edge proves

```
(staged)  --object present, mime+size match-->  (ready)
(staged)  -->  (tombstoned)   (abandon an upload)
(ready)   -->  (tombstoned)   (begin removal)
(any)     -->  (deleted row)  only when status <> 'ready' AND no object at that key
```

* `staged` means "the database minted a key for this row and nothing is claimed about the bytes". It is the
  initial state on every insert, forced by the trigger; a client cannot insert `ready`.
* `staged → ready` is the only transition that reads `storage.objects`, checking bucket, name, `owner_id` equal to
  the wedding's `owner_user_id`, and the object's recorded size/MIME against the row. A row that claims `ready`
  while the object is absent is the failure mode this stage exists to prevent, so this edge is exercised in both
  directions (I4).
* `tombstoned` is the only state from which bytes may be deleted (I6) and, once the bytes are gone, the row.
  Deletion is therefore always object-then-row, which is the ordering that keeps a pointer to un-collected bytes
  from being lost — the exact hazard the docs warn about ("Deleting the metadata doesn't remove the object in the
  underlying storage provider").
* Two orphan classes remain and are named rather than hidden: **O1** bytes with no row (reachable only by an
  orphan sweep, since I3 blocks new uploads to unclaimed keys), **O2** a row with no bytes (`staged` forever,
  never rendered as available). The battery counts both and asserts that a correctly-sequenced flow leaves neither.

### 5.3 Upload, preview, replace, delete as the product actually calls them

1. **Register**: adapter inserts `{wedding_id, asset_kind, label, mime_type, size_bytes}` only. PostgREST returns
   the row including the minted `object_key` and `upload_status = 'staged'`.
2. **Upload bytes**: `storage.from('wedding-assets').upload(object_key, file, { contentType })`. Application-side
   validation of type and size happens *before* this call (blueprint: "size limits enforced before storage"), and
   the bucket independently refuses the same two things.
3. **Confirm**: adapter updates the row to `ready`; the trigger verifies against `storage.objects` or refuses.
4. **List/preview**: rows are read through the existing `owners_read_assets` policy; each preview is a
   `createSignedUrl(key, 60)` — time-limited, never stored, never rendered into a published snapshot (B28).
5. **Replace** = register+upload a **new** row and object, confirm it, then tombstone-and-remove the old pair.
   There is no in-place overwrite: `storage.objects` gets no `UPDATE` policy (§2 consequence 2), so `upsert: true`
   is refused by the database rather than discouraged by convention. The key never changes meaning while a row is
   live, and "replace" is a sequence of two already-proven flows instead of a third.
6. **Delete** = tombstone the row, `storage.remove([key])`, delete the row. Each step is separately observable,
   and a crash between them is one of the two named orphan classes, not an undefined state.

## 6. Attack cases, and the tier that will prove each refusal

| # | Attack | Expected refusal | Tier |
|---|---|---|---|
| A1 | Second authenticated account lists/reads/downloads the owner's objects | 0 rows visible; read of a known key refused | SQL policy + HTTP + browser |
| A2 | Second account uploads into the owner's wedding prefix | `INSERT` WITH CHECK fails on segment 2 | SQL + HTTP |
| A3 | Second account deletes the owner's object | `DELETE` USING fails | SQL + HTTP |
| A4 | `anon` (publishable key, no session) reads, lists or uploads | refused; policies target `authenticated` only | HTTP + browser |
| A5 | Guessed key for a foreign wedding (valid UUID shape, unknown row) | no registry row ⇒ no read, no write; storage read yields 400/404 | HTTP |
| A6 | Client-supplied `object_key` (arbitrary, traversal `../../`, leading `/`, other wedding's prefix, over-long) | registry insert refuses with the trigger's SQLSTATE; storage insert refuses on key mismatch | SQL + HTTP |
| A7 | `upsert: true` overwrite of an existing object | refused — no `UPDATE` policy exists (triad proven empirically) | HTTP |
| A8 | Wrong MIME (`image/svg+xml`, `text/html`, `application/octet-stream`) | bucket `allowed_mime_types` refuses before any byte is written | HTTP + app-level unit |
| A9 | Oversized file, and a claim that disagrees with the bucket limit | bucket `file_size_limit` refuses; app-side check refuses earlier; `ready` transition refuses a `size_bytes` that does not match the object | app unit + SQL + HTTP |
| A10 | Re-parent a row: `UPDATE … SET wedding_id = <other>` or move it under someone else's wedding | `wedding_id`/`asset_kind`/`object_key`/`id` are immutable on UPDATE; and the new wedding would have to be one the caller owns anyway | SQL + HTTP |
| A11 | Direct SQL on the metadata tables: REST `POST/GET /rest/v1/storage.objects`, `/storage.buckets`, and an `rpc` probe | unreachable: `storage` is not an exposed schema; recorded as measured status codes | HTTP |
| A12 | `service_role`/secret key present anywhere a browser can see it, or in a log | none: contract rule + `dist/` grep + bundle digest sweep + widened added-line credential scan | node + artifact sweep |
| A13 | Listing the bucket as a co-tenant, and listing as anon, to harvest other users' object names | only the caller's own keys appear; `allow_only_operation('object.list')` keeps download-scope and list-scope from widening each other | SQL + HTTP |
| A14 | Public-URL guess (`/storage/v1/object/public/wedding-assets/…`) for a private bucket, and after a row is tombstoned | refused by bucket `public = false`; no public path exists in any snapshot (B28) | HTTP + publication battery |

## 7. Ruling: guest-facing asset delivery does not belong in Stage 6

Guest publication is **out of scope**, and the repository contract is what says so, in three pieces of evidence:

1. `domain-model.md:374` assigns Stage 6 "Uploads and Storage policies" and nothing else. `feature-readiness.md:187`
   describes the asset row as host-side registry state. No document ties guest rendering to assets.
2. `supabase/tests/stage3/30_publication.sql:517-519` (B28) asserts the published invitation snapshot contains no
   `object_key`. Guest rendering of an uploaded photo would require putting that key — or a URL built from it —
   into the snapshot, which is precisely the assertion Stage 3 closed and this stage is instructed to preserve.
3. `40_catalog.sql:456-459` (C18) fails any policy that targets a role other than `authenticated`. Serving guests
   means either a public bucket or a `TO public` SELECT policy, so the existing battery would have to be *weakened*
   to admit guest assets. Weakening a Stage 2 security tripwire to make a feature fit is the one move this pass has
   been built to refuse.

The threat model is also unresolved on its own terms: an anonymous guest link is the product's delivery mechanism,
so `anon` would need to read wedding media, which converts a private family photograph into an object addressable
by anyone who has the URL for as long as the bucket keeps it. The two candidate answers each need their own stage:
(a) time-limited signed URLs minted per guest view (needs a guest-authenticated or edge minting path, plus a
revocation story — the docs note signed URLs "remain valid until their expiry" and cannot be revoked without a
support contact); or (b) a re-encoded, watermarked derivative in a separate public bucket with its own retention
rule. Neither is a policy tweak, and the blueprint's own sensitivity note (minors' photographs, "no public
listing", "deletion propagation to generated derivatives", "a stated retention period") is unimplementable until a
retention rule exists. Stage 6 therefore ships **host-private upload/management only**, with preview through
short-lived signed URLs, and leaves guest delivery to a later stage with an explicit threat model. Do not expose
family assets publicly to make rendering easy.

## 8. How each requirement will be measured

* SQL battery `supabase/tests/stage6/10_storage_assets.sql` (+ a `20_attacks.sql` half): invariants I2–I6 and
  policies, run through the existing `supabase/tests/rls/run.sh`-style harness as `authenticated` and `anon`,
  including the `storage.allow_only_operation` spelling check that §2.1 defers.
* HTTP battery `supabase/tests/api/stage6_storage.test.mjs`, added to `run.sh`'s serial loop: A1–A5, A7, A8, A11,
  A13, A14 against kong on `127.0.0.1:54400`, using throwaway sign-ups, with the existing loopback/port/leak
  preconditions intact and the migration-count interlock updated by the harness, not by hand.
* Browser journey: sign up → create wedding → register/upload/confirm → list → preview via signed URL → replace →
  tombstone/delete, with the second account logged in to attempt A1/A2/A3 from the UI, and network observation
  proving (a) no `service_role` header ever leaves the browser, (b) no request to any non-loopback host, (c) no
  `/object/public/` URL appears anywhere.
* Node gates, each bracketed by the installer-provenance probe, plus the production-bundle credential sweep and the
  added-line secret scan over the Stage 6 commit range.

## 9. Environment record while this section was written (kept because it is a measurement)

`df` on `C:` reported **407 MB free** (409,591,808 bytes of a 476 GB volume), and from that moment every
`docker exec` against `supabase_db_localvivaahvarnam` stopped returning: `select count(*) from
supabase_migrations.schema_migrations` timed out at 60 s, a plain `select 1` under `timeout 20` produced no
output, and even `docker ps` hung and was killed. A second probe after this section was drafted produced no
container list either, and free space had fallen further to **370 MB**. Earlier reads in the same hour succeeded (the §1.1 schema and
`pg_tables` results above are from them), so this is host capacity, not repository state. Consequences recorded
honestly: no Stage 6 gate has run yet; the applied-migration ledger count is **not** measured (19 is the count of
files on disk only); and S6-3/S6-4 cannot start until the local Docker engine can serve a query again. Nothing was
deleted, pruned or restarted in response — shared Docker images belong to a second project on this machine, and
this session's own artifacts are 576 MB (`wedding-invites-pro`), 298 MB (`s5qual`), 234 MB
(`s5-browser-harness`) and 3.0 MB (`q5-logs`), none of which is enough on its own.

## 10. The engine died outright, and the dependency tree was replaced under this branch (measured 2026-10-06)

This section exists because two things happened to the environment rather than to the code, and §9's prediction
("cannot start until the engine can serve a query again") turned out to be optimistic. No Stage 6 implementation
work is recorded here; nothing in §8 has been executed.

**10.1 The reclaim ran, and was not what relieved the pressure.** `q6-logs/s6-g9-reclaim.log` begins at
`before_free=6.6G`, i.e. by the time the authorized deletions executed the volume had already recovered on its own
from the 370 MB recorded in §9. Six named paths were removed, each logged with its size, `rm_rc=0` and
`exists_after=no`: `/tmp/node-compile-cache` 197M, `/tmp/DockerDesktopUpdates` 168M, `/tmp/DiagOutputDir` 318M,
`/tmp/energy-trace.etl` 109M, `s5-browser-harness/profile` 206M, `s5-browser-harness/node_modules` 29M.
`after_free=7.5G`. The 576 MB `wedding-invites-pro` clone was on the authorized list and was **not** deleted: it was
proved to hold 0 unpushed commits first, and keeping an intact clone costs less than destroying one someone else
may want. Disk is **not** the present constraint — `df` now reports 12 G free of 476 G (98 % used).

**10.2 The container-level remedy in this session's authorization cannot be carried out, because there is no
engine left to address.** Progression, each step in its own log: `s6-g11` — `docker restart
supabase_db_localvivaahvarnam` timed out, `rc=124`; `s6-g12` — `docker version` and `docker ps` stopped hanging and
started failing instantly with `failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine … The system cannot find the file specified`; `s6-g13` — the control plane
was gone and the data plane followed it: `/rest/v1/ → 000`, `/auth/v1/health → 000`, `/storage/v1/bucket → 000`,
where the earlier probe in the same file's history read 200 / 200 / 503. Today's check is worse than "hung": the
full Windows process table (297 entries) contains **zero** `docker`/`com.docker`/`Docker Desktop` processes, and the
only surviving piece is `wslservice.exe` (PID 5876). `docker context ls` still names `desktop-linux` as current,
which shows the *configuration* is intact and only the VM is absent. Starting Docker Desktop is the action that
would recover the stack, and it is outside what this session was granted ("`docker restart` on the `supabase_*`
containers belonging to localvivaahvarnam only … leave every other container alone") — an engine start resumes
whatever other projects' containers carry restart policies, on a shared machine, and the §9 constraint that
`DueWeave` stays untouched is still in force. So the state is reported and the action is asked for, not improvised.

**10.3 Correction to §9's inventory, and to a Stage 5 statement, by naming them rather than editing them.**
`s5-browser-harness` is now 25 KB (`chrome-launch.scratch.log`, `package.json`, `package-lock.json`); its `profile`
and `node_modules` were deleted under the authorization above. That makes
`stage-5-pack-driven-authoring-review.md:3356` stale — it described that harness as "the one piece of browser state
still on disk". Stage 5's file is not edited; this section supersedes the claim.

**10.4 Second finding, independent of Docker: the Stage 6 clone's `node_modules` is no longer npm-provenanced.**
The S6-2 probe read 357 top-level directories, no `.pnpm`, no `.modules.yaml`, and a real `node_modules/vite`. Today
the same clone reads `.pnpm/` with 467 entries, `.modules.yaml` present (33,253 bytes), `node_modules/vite` a
**symlink** into `.pnpm/vite@6.4.3_@types+node@22.20.4_jiti@1.21.7/node_modules/vite`, and 325 top-level directories
— rising to 327 while the commands in 10.5 were running, so the tree was being mutated underneath the measurement.
The timestamps place the replacement precisely: `node_modules/.pnpm` and `.modules.yaml` are both
`2026-10-05 19:02:53 +0530`, the same minute as the `c2f9872` commit and push. Two `node.exe` processes are live on
this host. `pnpm-lock.yaml` (214,689 bytes) and `pnpm-workspace.yaml` (91 bytes) remain untracked and were never
staged; they are **not** byte-identical to the sibling clone's copies (`md5 c502f3bcc3cf715065ac288725d983da` here
against `a98d3ed5477b0ca7c1e71a2aa5f92f46` there), so the earlier "external pnpm re-drops a byte-identical lockfile"
note does not describe this event — a full install happened. Consequence, stated plainly: **no node gate below can
be reported as the directive's `npm ci` on an npm-provenanced clean tree.** `npm ci` is the repair, and it deletes
`node_modules` while an external installer is live in the same tree, so it is not run blind.

**10.5 What did run at `c2f9872`, labelled honestly as diagnostics on a non-conforming tree.** Each exit code was
read from a file-redirected run in an adjacent `echo`, never after a pipe.

| Instrument | rc | Measured output |
| --- | --- | --- |
| `npm run lint` | 0 | 9 problems, **0 errors**, 9 `react-refresh/only-export-components` warnings |
| `npm run product:check` | 0 | `181 active file(s) scanned, 0 violation(s)` |
| `node scripts/check-product-contract.mjs --self-test` | 0 | `29 rule(s) verified` |
| `npm run typecheck` | 0 | `tsc --noEmit -p tsconfig.app.json`, no diagnostics |
| `npm run dbtypes:check` | 0 | `19 migration file(s)`; `19 public + 10 non-client table(s)`; `19` client tables, `29` query column groups, `0 finding(s)` |
| `npm test` | 0 | **30 files passed, 440 tests passed**, duration 99.00 s |
| `npm run build` | 0 | `✓ built in 41.38s`; `dist` 1,062 KB; largest chunk `index-BglJXl4G.js` 577.47 kB (172.28 kB gzip) |
| `npm audit --omit=dev --audit-level=high` | 0 | `found 0 vulnerabilities` |
| `git diff --check` | 0 | empty |
| `dist` credential sweep | — | `grep -rl "service_role" dist` → **0 files**; no JWT-shaped literal hits |

Two readings of that table, both wanted: the suite is fully engine-independent, which is why 440 tests pass with no
database at all and confirms these tests do not touch the stack; and `dbtypes:check` is a **file-and-types checker**,
not DB introspection, so its `19` is a count of migration *files on disk*. §9's admission therefore stands
unchanged: the applied-migration ledger count is still **not measured**, and nothing in this table supplies it.

**10.6 Repository state, proved safe while the environment was not.** `s5qual` is the Stage 6 clone: branch
`stage6/storage-assets` at `c2f987222e8a513865c1a6adee790ea7a6634551`, and `git ls-remote
origin refs/heads/stage6/storage-assets` reads back that same SHA, so the S6-2 design note is pushed and nothing is
stranded locally. `origin/stage5/pack-driven-authoring-review` and the local base branch both read `1b1ef6d`, and
`origin/main` reads `328f0e3` — main was not moved by this session. Working tree: clean except the two untracked
pnpm files. No `config.toml` edit, no migration, no policy and no adapter code has been written; S6-3 through S6-7
remain unstarted, and no Stage 6 gate has run. A rule that did not run is not a rule that passed, and a diagnostic
on a substituted tree is not a qualification gate.

## 11. One number in §10.6 was wrong, and this section names it (measured 2026-10-06)

§10.6 asserted "`origin/main` reads `328f0e3`". That value came from `git for-each-ref refs/remotes` in a clone,
which lists **locally cached remote-tracking refs**, not the remote. The push read-back taken moments later asks the
server directly:

```
git ls-remote origin refs/heads/main refs/heads/stage5/pack-driven-authoring-review refs/heads/stage6/storage-assets
1b1ef6dcc6c7893c42afc29787e3724ab062eb1b  refs/heads/main
1b1ef6dcc6c7893c42afc29787e3724ab062eb1b  refs/heads/stage5/pack-driven-authoring-review
f823905b7dcdc6ddfe2fab8d55d442fe9a5b2285  refs/heads/stage6/storage-assets
```

The correct reading is that hosted `main` **is** `1b1ef6d`, exactly the base the Stage 6 directive named, so
`328f0e3` is a stale cache in the other clone (`wedding-invites-pro`, whose `refs/remotes/origin/main` still points
at the Stage 4 commit) and says nothing about the server. §10.6's conclusion — main was not moved by this session —
is true, and its number was not. `refs/heads/stage6/storage-assets` at `f823905` matches local `HEAD`, so the record
of §10 is pushed. Nothing was rebased, reset or force-pushed to get there: the push was the ordinary
`c2f9872..f823905` fast-forward.

## 12. S6-3: Storage is on the local stack, and six design assumptions were measured against it (2026-10-06)

**12.1 Recovery, and one instrument that failed while the thing it measured was fine.** The user started Docker
Desktop (this session's authorization covered only `docker restart` on this project's containers, so the engine start
itself was asked for, not taken). The first proof was mine and it was wrong twice over: a 38-iteration poll loop
reported no engine because it grepped `docker version` for the string `Server Version`, and modern `docker version`
writes the server block as `Server:` followed by `Version:` — the string never existed in that output. `docker ps`
succeeded on the same data, listing five `localvivaahvarnam` containers "Up About an hour", which puts engine
recovery at roughly 11:25 IST, i.e. after §10's process-table reading and before the poll. The poll's exit code was
also 0 the whole time, because a `break`-less loop that never matched is not a failure to `bash`. Recorded so the
next pass probes with `docker ps` and reads `Server:` — an instrument that cannot go red is not evidence.

**12.2 The measurement §9 and §10.5 both had to withhold is now taken.**
`select count(*) from supabase_migrations.schema_migrations` → **19**, against 19 files on disk, and
`dbtypes:check` independently reports `19 migration file(s)`. The ledger is now read from the live database rather
than inferred, and the stack's own `supabase start` restored it from the project docker volume
("Local data are backed up to docker volume"), so the Stage 5 schema survived the Storage switch-on.
`/rest/v1/ → 200`, `/auth/v1/health → 200`, and `/storage/v1/bucket` moved from 503 to served.

**12.3 Turning Storage on is a two-step operation, and the first step lies.** `supabase/config.toml` `[storage]`
flipped to `enabled = true`, then `supabase start` returned **rc=0** while doing nothing at all: its log is three
lines — "supabase start is already running", the stopped-services list, "supabase local development setup is
running" — and the measurement immediately after read `storage_relcount=0`, `storage.objects` nonexistent and
`storage_fns=NONE`. A success exit code that reports "already running" while the requested service is absent is a
false green, and it is the single most dangerous shape of failure for a qualification pass. `supabase stop`
(project-scoped; `docker ps` before it showed zero non-`localvivaahvarnam` containers, so `DueWeave` was not
reachable) followed by `supabase start` is what actually brought up `supabase_storage_localvivaahvarnam`, pulling
`storage-api:v1.79.28` — a newer pin than the `v1.72.1` already on the host, which is why §2's documentation quotes
and this image's behaviour differ. `imgproxy` did **not** start; nothing in Stage 6 depends on it, and that is
recorded as an observation rather than fixed.

**12.4 Measured platform semantics.** All of it read from the running database, not from memory or the saved docs.

* `storage.buckets` columns: `id text!`, `name text!`, `owner uuid?`, `owner_id text?`, `created_at timestamptz?`,
  `updated_at timestamptz?`, `public boolean?`, `avif_autodetection boolean?`, `file_size_limit bigint?`,
  `allowed_mime_types text[]?`, `type storage.buckettype!`, `versioning_status text!`,
  `lifecycle_configuration jsonb?`, `lifecycle_configuration_generation uuid?`. Defaults: `public=false`,
  `type='STANDARD'`, `versioning_status='DISABLED'`, `avif_autodetection=false`, timestamps `now()`. The enum is
  `STANDARD, ANALYTICS, VECTOR`. A bare INSERT therefore yields a **private, non-versioned** bucket, which is
  exactly the §4 requirement with nothing extra to remember.
* `storage.objects` columns: `id uuid`, `bucket_id text`, `name text`, `owner uuid`, `owner_id text`,
  `created_at/updated_at/last_accessed_at timestamptz`, `metadata jsonb`, `path_tokens text[]`, `version text`,
  `owner_id text`, `user_metadata jsonb`, **`archived_at timestamptz`, `is_delete_marker boolean`,
  `is_versioned boolean`**. Storage is a versioned object store now, with delete markers — see 12.5.
* `storage` holds 10 tables: `buckets`, `buckets_analytics`, `buckets_vectors`, `iceberg_namespaces`,
  `iceberg_tables`, `migrations`, `objects`, `s3_multipart_uploads`, `s3_multipart_uploads_parts`,
  `vector_indexes`.
* **RLS is on and there are zero policies**: `relrowsecurity = true` on both `buckets` and `objects`,
  `relforcerowsecurity = false`, and `pg_policies` for schema `storage` reads `NONE`. Deny-by-default is now an
  observation, not a quote.
* Table-level grants: `anon` and `authenticated` hold `DELETE,INSERT,SELECT,UPDATE`; `service_role` and `postgres`
  additionally hold `REFERENCES,TRIGGER,TRUNCATE`. So the client roles *can* address the table and only RLS stops
  them — the policy is the whole boundary, and no grant-stripping is available or needed.
* **`storage` is unreachable over PostgREST**, which is the exposure question §1.2's C22/C24 tripwires care about:
  `[api] schemas` is still `["public","api"]`, and with the publishable key
  `/rest/v1/objects → 404 PGRST205 "Could not find the table"`, `/rest/v1/storage/objects → 404 PGRST125`,
  `/rest/v1/buckets → 404 PGRST205`. The only path to storage metadata is the Storage API itself, so the existing
  schema-exposure contract needed no change and no new tripwire. Consequence for the checker, measured rather than
  hoped: `dbtypes:check` still reads `19 public + 10 non-client table(s)` because `NON_CLIENT_SCHEMAS` is
  `["private","legacy"]` and does not include `storage` — so enabling Storage silently moved 10 tables outside
  every contract checker. Stage 6 will not widen that list (it would change what the historic gate certifies); the
  gap is recorded here and closed by the Stage 6 SQL battery instead.
* `storage.objects` is owned by `supabase_storage_admin`; `postgres` is **not** superuser
  (`usesuper = false`). The capability that Stage 6 depends on was therefore probed rather than assumed:
  `CREATE POLICY … ON storage.objects FOR SELECT TO authenticated …` **succeeds as the migration role**
  (verified inside `begin; … rollback;`, and the follow-up read confirmed `storage_policies_now=NONE`,
  `buckets_now=EMPTY`). An `INSERT` into `storage.buckets` setting `public`, `file_size_limit` and
  `allowed_mime_types` also succeeded and was rolled back the same way. No probe left state behind.
* Triggers already on these tables: `protect_objects_delete` and `protect_buckets_delete` → `storage.protect_delete()`,
  `update_objects_updated_at`, `enforce_bucket_name_length_trigger`, `protect_bucket_control_insert`/
  `_update` → `protect_bucket_control_columns`, `protect_bucket_control_update_role` →
  `enforce_bucket_lifecycle_service_role`.
* `storage.protect_delete()` raises `Direct deletion from storage tables is not allowed. Use the Storage API
  instead.` with `ERRCODE 42501` **unless** `current_setting('storage.allow_delete_query', true) = 'true'`.
* `storage.allow_only_operation(expected text)` compares against `storage.operation()`, which is
  `current_setting('storage.operation', true)`; it strips a leading `storage.` from both sides and returns
  `FALSE` when the expected value is NULL/empty. Unset GUC ⇒ no operation matches ⇒ an operation-scoped policy
  denies. That is the safe direction, and it is why such a policy is usable.
* `protect_bucket_control_columns()` guards **only** `lifecycle_configuration` /
  `lifecycle_configuration_generation` (and requires `type = 'STANDARD'` before they may change). Its INSERT path
  permits the row when both are NULL and otherwise demands membership of the storage service role, with the hint
  "Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward."

**12.5 What those six facts do to the §3–§6 design.** They are not cosmetic, so each is answered here rather than
in a later migration comment.

1. *The directive's "no direct INSERT/UPDATE/DELETE against storage metadata tables" is platform-enforced.* A new
   attack case (**A15**) tests it as written: as `authenticated` and as `postgres`, `delete from storage.objects
   where …` must fail with 42501 and leave the row. Our design gains nothing by pretending to enforce it alone, and
   loses the tripwire if we ever assert the opposite.
2. *Object deletion is not row deletion.* `is_delete_marker` / `archived_at` / `version` mean the Storage API's
   delete may be a marker write on a versioned bucket. Our `tombstoned` state therefore stays **registry-side**
   (a `wedding_assets` status transition) and must never be inferred from "the `storage.objects` row is gone".
   The consistency rules O1/O2 are re-expressed as: a row may be `ready` only if the API reports the object;
   a `tombstoned` row says nothing about the object's row.
3. *Retention cannot be declared as bucket configuration in a migration.* The lifecycle columns are service-role
   territory, so the blueprint §15 "stated retention period" is implemented as application-visible registry state
   plus an explicit deletion path, not `lifecycle_configuration`. Stage 6 records the rule and ships no fake
   lifecycle.
4. *No UPDATE policy is still the right call, and now for a stronger reason.* `update_objects_updated_at` and the
   versioning columns are maintained by the service; an UPDATE policy aimed at `authenticated` would let a client
   touch a table whose columns the platform itself manages. Replace stays copy-on-write: new key, new object, then
   a registry-side tombstone.
5. *Bucket creation as code works, with the platform defaults doing the security-relevant part.* The Stage 6
   migration sets `public = false`, `file_size_limit`, `allowed_mime_types` and leaves lifecycle NULL — the probe
   proved the INSERT path is available to the migration role, and the `versioning_status` default keeps us out of
   the delete-marker semantics entirely.
6. *Operation-scoped SELECT is usable but not yet necessary.* A listing policy that only opens for
   `storage.object.list` denies the plain read path too, so it is a sharper tool than §5 needs; the design keeps
   ordinary ownership-bound policies and defers the operation spelling to the battery, where it gets measured
   rather than guessed.

**12.6 Still unmeasured.** Whether `supabase db reset` applies the 19 (+1 Stage 6) migrations before or after the
storage service creates its own schema (the §2.1 question) — it can only be observed on a reset, and the reset is
part of S6-4's qualification rather than done speculatively now. Also unmeasured: what `imgproxy`'s absence does to
transform requests, because Stage 6 as designed performs none.
