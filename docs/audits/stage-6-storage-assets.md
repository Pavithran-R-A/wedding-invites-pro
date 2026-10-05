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
