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

**Dated correction to the A13 row (2026-10-07, §20.3).** That row's middle cell credits
`allow_only_operation('object.list')` with keeping download-scope and list-scope apart. Neither this stage's
policies nor either battery calls that function — it exists only as a definition the SQL fixture captures from the
live image — so the separation is carried by the policies' own key-shape predicates, and the spelling question §2.1
defers is answerable only against the running service. §20.2 therefore marks A13's SQL coverage *partial*, and the
tier that must answer it is HTTP, not SQL.

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

## 13. S6-4: the migration exists and is applied, and the historic runner proved nothing about it (2026-10-06)

**13.1 The migration.** `supabase/migrations/20261006120000_stage6_wedding_asset_storage.sql`: the
`wedding-assets` bucket row, the `upload_status` column, a BEFORE-INSERT key-minting trigger, UPDATE and DELETE
guards, and three `storage.objects` policies. `supabase db push --local` applied it with rc=0 and the structure read
back from the running database:

```
LEDGER=20
BUCKET=wedding-assets public=false limit=5242880 mime=image/jpeg+image/png+image/webp+audio/mpeg
       type=STANDARD ver=DISABLED lifecycle=NULL
POLICY wedding_members_read_asset_objects               cmd=SELECT permissive=PERMISSIVE roles=authenticated
POLICY wedding_members_remove_tombstoned_asset_objects  cmd=DELETE permissive=PERMISSIVE roles=authenticated
POLICY wedding_members_upload_staged_asset_objects      cmd=INSERT permissive=PERMISSIVE roles=authenticated
COL=upload_status text notnull=true default='staged'::text
TRIG=set_updated_at  TRIG=wedding_assets_guard_delete  TRIG=wedding_assets_guard_update
TRIG=wedding_assets_mint_object_key
```

Two dependencies were measured before writing, because both were assumptions carried over from §5: `authenticated`
holds `USAGE` on schema `storage` and `EXECUTE` on `storage.foldername`/`storage.extension` (both `true`), which is
what lets the `ready` transition read `storage.objects` **as the invoker**. That is a deliberate change from §5.2's
SECURITY DEFINER sketch: a definer function would look up bytes the caller has no policy for, turning a consistency
check into a privilege of its own. Same role, same policy, same answer — confirmation can only succeed where preview
would also succeed. `anon` also holds schema `USAGE` (`true`), which is why I7 is carried by the policies and by A4's
HTTP test rather than by schema ACLs.

**13.2 The runner did not apply it, and still reported complete success.** The first thing run after the push was the
historic Stage 2 battery, `bash supabase/tests/stage2/run.sh` → **rc=0**, both chains, printing `42 / 46 / 284 / 464
/ 103` (clean) and `76 / 49 / 284 / 464 / 103` (legacy). Those totals are *identical* to the pre-Stage-6 numbers
quoted in that runner's own header, and they must be read as the finding rather than as comfort:

```
supabase/tests/stage2/run.sh:149   for stage in stage2 stage3 stage4; do
supabase/tests/stage4/run.sh:166   for stage in stage2 stage3 stage4; do
supabase/tests/stage5/run.sh:144   for stage in stage2 stage3 stage4 stage5; do
```

Each runner enumerates the stages it applies, and `grep -vE '_stage[0-9]+_'` at `stage2/run.sh:134` keeps the numbered
stage files out of the "published migrations" pass. So a migration named `_stage6_` is invisible to the Stage 2 and
Stage 4 runners — and `stage5/run.sh:144` shows the precedent: Stage 5 added `stage5` to the loop of the runner it
wired into, and left the other two behind. The consequence is stated exactly, because it is the failure shape this
document exists to catch: **the historic battery that just printed green qualified a schema that does not contain
Stage 6**, while `stage2/run.sh:18-20` claims the opposite intent ("a later migration must be shown not to have
loosened a Stage 2 guarantee"). The Stage 5 migration was never applied by the Stage 2 battery either; that
pre-existing gap is found here by accident and is not silently inherited.

**13.3 Why this is not just wiring.** The Stage 6 migration references `storage.buckets` and `storage.objects`, and
those tables are created by the *storage service*, not by anything in `supabase/migrations`. On the bare
`postgres:16-alpine` clusters the runners start, the Stage 6 file would fail outright with `relation
"storage.buckets" does not exist` — and because `ON_ERROR_STOP=1` is genuinely set (`run.sh:82-100`), the runner would
stop rather than pass. So wiring `stage6` into a loop requires a **faithful storage schema fixture** that puts those
tables in front of the app migrations, which also answers §12.6's ordering question by construction: the fixture
stands in for "the storage service created its tables first". Two measurements depend on it. C18/C19 scan `pg_policy`
across **every** schema, so they are the assertions actually at risk from three new `storage` policies, and they have
to be measured with Stage 6 present. And `POLICY_COUNT_TOTAL=48` on the live stack becomes the number the harness must
reproduce.

**13.4 Nothing in this section is a behavioural result.** No upload, read, replace, delete, cross-account attempt or
MIME/size refusal has been exercised yet. 13.1 proves the DDL landed; 13.2 proves the existing instrument cannot see
it. Both are fixed in the next section, which is the point where Stage 6 either works or does not.

## 14. S6-4/S6-6: the registry battery runs at the Stage 6 head, and it finds a real hole in the migration (2026-10-06)

**14.1 The instrument first, because a result is worth no more than the loop that produced it.** Battery 1 is
iterated against a throwaway `postgres:16-alpine` container (`vivaahvarnam-stage6-iter`, database `st6iter`) built
by `q6-logs/s6-iterate.sh` — a scratch script outside the repository, not part of any gate. Its chain is exactly the
committed runner's: `supabase/tests/rls/00_bootstrap.sql`, then `supabase/tests/stage6/00_storage_schema.sql`, then
every migration in published order and then stage order through `stage6`. A battery file is then replayed inside
`begin; …; rollback;` so one chain serves many edits. That caching is a hazard the script now names: the chain is
applied once per container, so **a repaired migration is invisible to the battery until the head is rebuilt**, and
`REBUILD=1` was added because reading a green run against a cached chain would credit the fix to an edit that was
never applied. The committed instrument remains `supabase/tests/stage6/run.sh`, which cross-checks each suite's
printed `PASSED (n)` against the observed `NOTICE: PASS` lines and fails if the two disagree.

**14.2 The defect, found by the battery rather than by reading.** The T-block assertion `T2c` failed with
`got [no-er] want [42501]`. Root cause, in one line of the migration: `private.guard_wedding_asset_update()` began
with `IF NEW.upload_status = OLD.upload_status THEN RETURN NEW;`, so any write that left the state alone returned
before the guard read `storage.objects` at all. `mime_type` and `size_bytes` are ordinary columns a PATCH can name
without touching `upload_status`, and they are what the product serves as the description of a ready asset. The
result was that a row confirmed honestly against a 900-byte `audio/mpeg` object could be edited afterwards to claim
`text/html`, stay `ready`, and be rendered, downloaded and re-offered on a description the bytes never agreed to.
That is invariant I4 — the same lie the confirmation edge exists to refuse — arriving through a door the edge did not
watch.

The repair narrows the early return instead of deleting it: the guard now returns before any object read only when the
row is not `ready`, **or** when neither byte-claim moved. A same-status write to a `ready` row that moves
`mime_type` or `size_bytes` falls through to the verification the confirmation already performs, so it is refused by
the same evidence the confirmation demanded. It is deliberately not folded into the two state-transition refusals
below it, because those raise messages naming a transition and this write is not one; the accurate message is the
one the type comparison already gives ("the object at % is stored as %, but this row claims %"). Six assertions now
hold the repaired edge: `T2c` refuses the type lie, `T2cd` proves the lie did not land, `T2d` refuses a size lie by
the same route, `T2e` accepts *dropping* the claims (an absent claim is not a false one, so §I4 compares claims and
does not freeze the row), `T2f` accepts re-declaring them truthfully through the same route — which is the positive
control that says the verification ran rather than that it was skipped — and `T2g` shows the state never moved
during any of the description edits.

**14.3 Battery 1's measured result.** `STAGE6 REGISTRY TESTS PASSED (90)`, against 90 observed `NOTICE: PASS` lines,
exit 0, on a head built with the repaired guard. The file's own floor was raised from the provisional 55 to the
measured 89 (the count before `L1` itself), because a floor is only worth having at the number the machine actually
reaches. Coverage of that 90: `B` the bucket, column, trigger and policy shape; `K` minting — nine client
key/status/ownership refusals at 42501, the unknown-`asset_kind` path as 23514, the blank-claim case minted over and
removed, `K21` anon refused at the table *grant*, and `K22` no residue; `S` the `staged → ready` edge — present,
owned, matching type, matching size, unreadable metadata refused as 42501 rather than as a cast failure, a
same-named object in another bucket refused, a stranger's attempt shown to be a zero-row no-op *and* the row still
`staged`; `T` the rest of the machine; `D`/`O` the removal ordering and the two orphan classes counted by state;
`L` the ledger.

**14.4 Five instrument defects found on the way, recorded because each one was a candidate false pass.**
- `storage.protect_delete()` is reproduced faithfully in the fixture and has **no role exemption**: it refuses every
  `DELETE FROM storage.objects` and `… FROM storage.buckets` until the transaction sets `storage.allow_delete_query`,
  including the harness's own superuser statements. The file now routes removals through service-stand-in helpers
  that set the flag and put it straight back, and `D0` measures the refusal from a client role instead of quietly
  stepping over it. `D6`'s earlier wording claimed its deletes ran with the flag unset; that was false and is
  corrected in the label.
- `S4` originally asserted the cross-bucket refusal with a `WHERE` clause that matched no row. A zero-row UPDATE is
  not an error, so the assertion measured nothing — it could not have failed. Rebuilt so the collision is real. This
  class of bug fails loudly here (expected 42501, got no-error) rather than producing a pass, which is why it was
  catchable at all.
- `T4` assembled a concatenated literal *inside* the dynamic statement; psql answered **42601** (syntax error), and
  because the assertion compares `left(got, 5)`, a broken test would have been reported as a refusal that never
  happened. Now built with `quote_literal`, with `T4b` asserting the key the row holds is still the minted one.
- `left(x, 5)` applied to a *positive* control truncates `'no-error'` to `'no-er'`, so an acceptance can never match
  its expectation. Removed where the comparison is an acceptance (`S11`, `T2`, `T2b`, `D2`), kept for SQLSTATE.
- uuids interpolated bare into dynamic SQL (`WHERE id = <uuid>`) were a syntax and injection-shape problem waiting
  for the first edit that moved a value; every site now goes through a `quote_literal` helper. Two `O`-series
  expectations were also guesses about the residue — the measured residue is 4 rows, 2 `ready` / 1 `staged` / 1
  `tombstoned` — so those assertions count states instead of forcing the fixture to match prose.

**14.5 Shapes measured for battery 2, before writing its assertions.** Probed against the same head: `anon` holds
`Select`/`Insert`/`Update`/`Delete` on `storage.objects`, and so does `authenticated` — the storage tables sit
*outside* the Stage 2 grant allow-list that protects every customer table. Consequences, each probed rather than
assumed: anon `SELECT` from `storage.objects` returns **0 rows with no error**; anon `UPDATE` changes 0 rows; anon
`DELETE` with the service flag changes 0 rows; anon `INSERT` raises `new row violates row-level security policy for
table "objects"`. The asymmetry matters for what the HTTP tier will see, and both halves are now named in the
batteries: the registry refuses anon at the **grant** (42501, battery 1 `K21`, battery 2 `G3`), the object table
refuses it at the **policy** (empty list, battery 2 `R4`). Over REST those are a 403 and a `[]` — different answers,
so the labels say which mechanism produced them and the file that measures one does not quietly redefine the other.

**14.6 Battery 2 is written and is explicitly *not* a pass.** `supabase/tests/stage6/90_storage_policies.sql`
covers `G` (grant shape, so a later refusal is attributable to a policy and not to a missing GRANT), `P` (policy
census: three policies, none `FOR UPDATE`, all targeting `authenticated` alone — re-taken here because a dropped
read policy would otherwise turn every "stranger sees zero" assertion below it into a pass), `R` read/list, `I`
upload, `U` overwrite, `D` removal, `Z` the census it leaves, `L` the floor (provisionally 50). Its expectations are
two kinds and the file must not be quoted until the second kind has run: the probed shapes above, and everything
derived from reading which clause of which policy should answer each attack. Two of the derived ones are load-bearing
and self-contradictory unless measured: `I7` claims the second write to a live *staged* key is refused by the unique
index (**23505**), while `I10` claims the second write to a live *ready* key is refused by the policy's `WITH CHECK`
before any index is consulted (**42501**). If the order is the other way round, one of those labels is wrong, and
both are one run away from being known.

**14.7 The run then stopped for an external reason, classified rather than glossed.** The Docker daemon went
unresponsive mid-qualification. Evidence: `docker ps` exits **124** under a 12 s timeout on three consecutive
attempts spanning roughly five minutes; `docker info --format …` exits 124; `wsl -e bash -lc "docker ps -q"` exits
124; while WSL itself answers normally and reports `/dev/sdd` 1 % used. So the engine socket is not answering, not
the shell, and not the SQL. The likely pressure is the host volume: `Get-Volume` reports **C: 5.5 GB free of 476 GB
(99 % used)**, on which Docker Desktop's data lives. Nothing in `s5qual/` changed between battery 1's green run and
the hang — same container, same database, same replay loop — so this is recorded as an external-state failure and
not as a Stage 6 result. The two tasks left blocked on the daemon were this task's own (`s6-iterate.sh` on battery
2, and a `pg_stat_activity` probe) and were stopped; no container belonging to anything else was touched, and none
was restarted without being asked for.

**14.8 Two consequences that must be cleared before any further Stage 6 claim.** First, the local Supabase stack
still has the **pre-repair** copy of `20261006120000_stage6_wedding_asset_storage.sql` applied — the `db reset` that
put it there ran before §14.2's edit. Until it is reset again, nothing measured over HTTP about a ready row's
description means anything, because the stack is running the version with the hole in it. Second, the historic
suites have still not been re-run at the Stage 6 head (`bash supabase/tests/stage6/run.sh both`), so §13.2's finding
stands uncorrected: the numbers the older runners print are still about a schema that does not contain Stage 6.

**14.9 What is still unproven, restated so §14 is not read wider than it is.** No upload, no edge-level MIME or
size refusal, no signed URL, no download, no guest-page render has been exercised. Battery 1 proves the registry
side as SQL, on a fixture that stands in for the storage service's tables. Battery 2, once it runs, proves the
policy side as SQL — writes to `storage.objects` under a caller's role, which is still not a byte upload. The HTTP
tier and the browser tier remain unbuilt, and the migration itself remains uncommitted and therefore unpushed.

## 15. S6-6: the HTTP tier is built, it is green, and three of its assertions were written backwards first (2026-10-07)

**15.1 Three probes, because the transport does not obey the design document.** Before any assertion was
written down, the shapes were collected by three throwaway scripts — `q6-logs/s6-probe3.sh`,
`s6-probe4.sh`, `s6-probe5.sh`, logs `s6-p3-shapes-02.log`, `s6-p4-shapes-02.log`, `s6-p5-shapes-01.log`. Each
ended with its own census and all four lines read zero every time:
`RESIDUE wedding_assets=0 / objects=0 / weddings=0 / auth_users=0`. Writing the battery from the design instead
of from these would have produced confident assertions about responses the stack never sends.

**15.2 Three forecasts the measurement reversed.**

- A request to upload with no token at all is **not** a 401. It is `400` with `code: "NoSuchKey"`, because the
  storage service resolves the object first and the anonymous role simply cannot see it. The refusal arrives
  *as* the body, so "the response had bytes" is not evidence that bytes were served; the assertion that survives
  is the pair "the served bytes are not the PNG" plus "the first byte is `{`".
- A second write to a key that already exists, without `x-upsert`, is `400` with
  `code: "409" / "Duplicate"`, not an overwrite and not a 401.
- A `DELETE` that RLS refuses answers **`200 []`**. It is a success status carrying an empty list. Read this
  together with the registry side, where a stranger's `DELETE` of a row it cannot see answers `204` and changes
  nothing: an empty or empty-looking answer is not an answer about the row, which is why every refusal in the
  battery is *re-read* with a following `SELECT` instead of inferred from a status code.

**15.3 The status table that the `Prefer` header writes.** `return=representation` decides the success code, so
the same logical operation reports differently depending on the client's preference: `POST` with it is 201 plus
the row; `PATCH` with it is 200 plus the row; `PATCH` without it is 204; `DELETE` without it is 204; `DELETE`
with it and no matching row is 200 `[]`. A refusal carries its error body in every one of those modes, which is
what makes the error assertions independent of the preference the helper happens to set.

**15.4 The battery, and what it took to get it green.** `supabase/tests/api/stage6_storage.test.mjs`, run under
its own tag: **33 tests in 6 suites, 33 pass, 0 fail, 21.9 s** (`q6-logs/s6-http-iter-02.log`), and its teardown
prints `wedding_assets total=0` and `objects in the bucket=0` from the database itself rather than asserting it
cleaned up. The first attempt (`s6-http-iter-01.log`) was 27 pass / 6 fail, and every one of the six was an
instrument defect, not a product defect:

- MINT-02/03/04 each read the registry back after a refusal and omitted the acting account, so the helper sent
  no token and the read was refused at the *grant* (401) instead of showing whether a row survived. The refusal
  was still being proven; the read that confirmed it was measuring the wrong door.
- A4 asserted `bytes.length === 0` on a refused download. The refusal body is 88 bytes long. Replaced, per
  §15.2, with the pair that actually says no image was served.
- A13 found an object name it did not expect. It was this run's own cascade: A4 had aborted before its cleanup.
  A query after the run showed 0 rows and 0 objects, so the bucket was not in a state the product had failed to
  reach.
- STA-03 expected `NULL|NULL` for a `ready` row's mime and size, copied from a probe row that had been staged
  without claims. The measured behaviour is `{image/png, 68, ready}`: the confirmation *checks* a claim against
  the object rather than recording the object's own description.

**15.5 §14.8's first consequence is cleared by a passing test, not by a reset command.** The two repaired-edge
cases — a `ready` row re-described with a false type, and a size claim that disagrees with the bytes — answer
`403 / 42501` with "the object at … is stored as image/png, but this row claims …". That message exists only in
the post-§14.2 migration, so the stack under test is the repaired copy. §14.8's second consequence is cleared
the same way: `q6-logs/s6-stage6chain-04.log` replays every historic chain at the Stage 6 head and prints
stage 2 migration outcome 42, stage 3 draft invariant 46, stage 3 publication 284, stage 2 privilege+RLS 464,
stage 2 catalog 103, stage 4 documents 428, stage 4 §8 tooling 57, stage 5 review-binding 122, vocabulary 50,
document-resolution 124, and the two Stage 6 batteries at 90 and 80, with `chain_exit_code=0`.

**15.6 The runner now counts the two stores an HTTP run can dirty silently.** `supabase/tests/api/run.sh`
compares before/after counts for `public.wedding_assets` and for
`storage.objects where bucket_id = 'wedding-assets'`, alongside the three it already checked. A registry row and
the bytes it points at can both survive a run that leaves `weddings`, `auth.users` and `invitation_drafts`
untouched, and "metadata gone, bytes still there" is precisely the orphan class this stage exists to make
observable — so it is measured by the runner rather than trusted to any suite's teardown.

## 16. Stage 6 made a Stage 3 assertion false, and the honest reading is that Stage 3 was measuring the wrong thing (2026-10-07)

**16.1 The gate, taken seriously.** `bash supabase/tests/api/run.sh` was run whole rather than file by file, and
it failed: `api_run_exit_code=1` (`q6-logs/s6-api-run-01.log`). Preconditions were green
("ok 20 migrations applied, matching supabase/migrations"), `stage3_publication.test.mjs` passed 38/38, and
`stage3_security.test.mjs` came back 55 pass / 1 fail. `set -euo pipefail` then stopped the chain, so stage 4,
5 and 6 never ran. That single failure is the only reason the chain did not reach my new file.

**16.2 What failed, and why, read rather than guessed.** The case is
*a child row cannot be attached to another account's wedding via wedding_assets*, and the assertion that broke
expected `/row-level security policy/` but received
`wedding_assets.object_key is minted by the database and cannot be supplied`. The Stage 3 builder at
`supabase/tests/api/stage3_security.test.mjs:449` hand-supplies an `object_key`, and PostgreSQL evaluates an RLS
`WITH CHECK` *after* the BEFORE ROW triggers — so the Stage 6 mint trigger now answers that insert before row
level security is consulted at all. The claim was never about the key, and the test's own control insert on the
line below would have failed for the same reason, which is how one failure revealed that both halves of the case
had silently become about a different mechanism.

**16.3 The repair, and why it is not a weakening.** The key was dropped from that one builder, leaving
`{ wedding_id, asset_kind: 'photo' }`, so the foreign-wedding insert is answered by RLS again
(`403 / 42501 / new row violates row-level security policy for table "wedding_assets"`) and its control is a
`201`. Nothing was relaxed: the presented-key case keeps being proven, in Stage 6, by MINT-02 — seven spellings
of a supplied key, each refused, then a re-read showing no row survived — and the RLS case by MINT-04. A comment
at the repair site says which case covers what, because the next reader will otherwise be tempted to put the
key back.

**16.4 Measured, in isolation, before claiming anything about the chain.**
`node --test supabase/tests/api/stage3_security.test.mjs` → **56 pass / 0 fail**, `isolation_exit_code=0`
(`q6-logs/s6-stage3-isolation-01.log`), with the repaired case named in the passing list. A census taken
immediately after: `assets=0`, `objects=0`, `weddings=0`, `users=0`. That answers the question §15.6 raises for
this file — the Stage 3 control now creates a `wedding_assets` row, and it goes with its wedding through the
`ON DELETE CASCADE` on `wedding_assets.wedding_id`, which the delete guard permits because the row is `staged`
and no object was ever uploaded to its key. So the widened leak check is satisfiable by Stage 3's own teardown,
and not merely hoped for.

**16.5 What this section does not claim.** The full chain has not gone green at this head. It was blocked
minutes after the isolation run, by §18, and the browser tier has not been started.

## 17. The node gates at the current tree, measured, with the caveat the tree itself carries (2026-10-07)

`npm run typecheck`, `npm run product:check`, `npm run dbtypes:check`, `npm run lint`, `npm run test` were run
serially against this working tree — which already contains the Stage 6 migration, the adapter, the regenerated
types and both battery files — and each printed its exit code next to its own name in
`q6-logs/s6-node-gates-01.log`: `exit_code=0` for all five. `npm run build` separately: `build_exit_code=0`,
`dist_kb=1062`, with `index` at 577.47 kB (172.28 kB gzip), `Header` at 132.19 kB and `EditProject` at 103.75 kB,
and the same `chunkSizeWarningLimit` advisory the earlier stages recorded.

Two things this does not license. First, `product:check` passing means the Stage 6 additions did not break the
contract checker's canonical-table and file-count rules; it is not evidence about the storage behaviour, which is
§15's and the browser tier's job. Second, `node_modules` in this clone carries **both** `.modules.yaml` and
`.package-lock.json`, so the 1062 kB describes the tree as found rather than a clean install — the installer
marker check is the reason the clean-install gate stays in the closure rather than being assumed from this pair.

## 18. The engine did not come back this time, what was tried, and precisely what is now blocked (2026-10-07)

**18.1 §14.7 was an interruption; this is a stop.** The daemon has not answered a single request since.
Evidence, all of it measured rather than inferred: `docker version --format …` exits **124** under a 20 s timeout
on **fourteen consecutive attempts spanning about five minutes**; `docker exec supabase_db_localvivaahvarnam psql -c "select 1"`
exits 124; `wsl -e bash -lc "docker system df"` exits 124 while `wsl -l -v` in the same command answers normally;
and `monitor.log` — Docker Desktop's own API-proxy journal, which had been rotating roughly every four minutes —
stops at a `POST /v1.56/containers/supabase_db_localvivaahvarnam/exec` at `17:19:57 +0530` with nothing recorded
after it. The shell works, WSL works, the CLI works (`docker context ls` answers instantly), and the engine behind
the socket does not.

**18.2 Three recoveries attempted, each with its measured outcome.**
(i) `Stop-Process -Force` on `Docker Desktop.exe`, `com.docker.backend.exe`, `com.docker.build.exe`,
`docker-monitor.exe`: it reported each one stopped, and `Win32_Process` still lists the *same* PIDs
(18052, 7288, 25512) with the *same* creation times. The kill did not take, because this session is not elevated
and cannot signal them. (ii) Relaunching `"C:\Program Files\Docker\Docker\Docker Desktop.exe"`: no new instance
appeared and the socket still answered 124. (iii) `wsl -t docker-desktop`, deliberately scoped to Docker's own
distro: it went `Running` → **`Stopped`**, and `Ubuntu` was left `Running` and untouched — but the wedged backend
did not respawn the VM, and the socket still answers 124. Free space on the volume that holds Docker's data is
**5.5 GB of 476 GB (99 % used)**, the same pressure §14.7 named.

**18.3 No writes happened under the truncated log.** The chain that was running when the engine died left
`q6-logs/s6-api-run-02.log` at **0 bytes**, confirmed independently by PowerShell's `Length`. So that run
produced no suite output and reached the product with no HTTP write of any kind; nothing in §15 or §16 depends on
it, and nothing was inferred from it. The hung processes belonged to this task and this task only — `run.sh` and
its child `node --test supabase/tests/api/stage5_admin_cli.test.mjs` — and they were stopped before anything else
was attempted. (Recorded because it affects how the timestamps in this section should be read: on this host the
file mtimes and `date` disagree by roughly eighteen hours, so every claim above is keyed to command output and
log content, never to a clock.)

**18.4 What is blocked, and it is the stack-bound half of the stage.** The serial HTTP chain at this head;
therefore the Stage 5 admin-CLI file and the joint run of stage 3 → stage 6 with the widened leak equality; the
browser tier in its entirety; every SQL battery, since each starts `postgres:16-alpine` through the same daemon;
and consequently the commits and the push, because the migration, the battery, the adapter, the `run.sh` census
and the §16 repair must each be covered by a green run taken at the SHA that carries them. I am not committing
ahead of that.

**18.5 The one action here that is genuinely human.** Docker Desktop has to be restarted from an elevated
context or from its own GUI, which a non-elevated agent session cannot do; and with 5.5 GB free on `C:` the
restart may not hold, in which case the durable fix is a decision about what to remove that belongs to the owner
of this machine. I will not delete anything belonging to another project, and I will not prune shared Docker
storage: the engine on this host also carries a second project's containers, and the last thing this stage needs
is a leak check that passes because somebody else's data was cleared to make room.

**18.6 Restated so §15-§17 are not read wider than they are.** No browser-tier assertion has been made. No
observation exists yet that a privileged header never leaves the browser, that no non-loopback request is issued,
or that `/object/public/` is never used. The Stage 6 batteries pass at the SQL and HTTP tiers on the repaired
migration; the stage as a whole has no green chain, no commit and no push, and therefore **no PASS is claimed for
Stage 6** — the stage is bounded by §18.4 until the engine returns.

## 19. The host's own file panel, the one primitive the driver was missing, and what a widened truth sweep found (2026-10-07)

§18 closed with the engine dead and the stack-bound half of the stage blocked. This section records the work
that a dead engine does not block, and it is careful about the difference between *compiling*, *being
checked*, and *having been driven*.

**19.1 Why a panel was the remaining gap at all.** §8 requires the Stage 6 browser journey to run "from the
UI", and at the start of this section `grep -rn weddingAssets src/` returned nothing: §13–§15 had built the
adapter, the migration and both batteries, but no screen mounted it. §7 had already ruled the stage to be
host-private upload and management with preview through a short-lived signed URL, so the surface was
determined by the ruling, not invented here. `src/components/invitation/WeddingAssetsPanel.tsx` was written
against that, mounted in `src/pages/EditProject.tsx`'s aside between the existing separators, and follows the
conventions the pack panel established: newest-read-wins ticket (§20's Stage 5 defect), one failure phrase
rather than a list, `role="alert"` for refusals and `aria-live="polite"` for the live region, 44px controls,
`<section aria-labelledby>`, native radios for the choose-one question "which stored file does this new one
stand in for". Three rules are stated in its header because they are the rules the migration enforces: the
panel speaks only through `weddingAssets.ts` and never exposes an `object_key` field; a signed URL is rendered
as media and never as text; and nothing in it is a guest claim, because B28 still asserts the published
snapshot carries no `object_key`.

**19.2 The panel carries its own not-qualified banner.** The component prints, in the host's own language,
that this surface has not been exercised: no browser journey has driven it and no HTTP battery has run
against the adapter it calls, because the engine died (§18). That is not decoration. `feature-readiness.md`
labels the row `FOUNDATION` rather than `IMPLEMENTED` for exactly this reason, and a banner in the UI is what
keeps a future reader of the *screen* from inheriting the assumption that a screen someone once wrote has
been shown to work.

**19.3 The bucket's vocabulary was not copied into the browser.** The panel deliberately has no `accept`
attribute on its file input and no prose list of allowed types or sizes. Those limits are the bucket's, and
the adapter already refuses a file they would reject with one sentence that is measured by §15. Duplicating
them in markup and copy would create a second source that rots when the migration changes — and a second
source that a host could read as a promise the server does not keep. The four kinds the panel offers to click
are a presentation list, not a rule: `generated_output` is absent because it names a derivative the platform
would produce rather than a file a host uploads, and an unknown kind is still answered by the table's CHECK.
The adapter's header said "no copy of that list is kept here to rot" and, once the panel existed, that
sentence needed making precise rather than deleting, so it now names the panel's list as a presentation list.
That was a truth-sync, not a silent divergence.

**19.4 One CDP primitive, added rather than worked around.** `scripts/stage5-browser-driver.mjs` exposes no
raw `send` to journey files and has no file-input capability, and an upload journey cannot be written without
one. `setFileByLabel(labelText, filePath)` now resolves the labelled input through the same `FIND_BY_LABEL`
the other setters use, takes a node id and calls `DOM.setFileInputFiles`, then **reads the file back** and
throws if the input still holds nothing. The read-back is the point: a picker that silently took nothing would
turn the journey into a measurement of the product's refusal of a zero-byte file while reporting that it had
uploaded a PNG. What the primitive pointedly does *not* do is claim the framework reacted to the change — a
journey asks that question with `pressButtonWhenReady`, which reports `disabled` as the product's own verdict.
`node --check` on the driver: `driver_check_code=0`. **The primitive has never executed**, which is why §19.7
is written the way it is.

**19.5 Everything provable without a database, measured at the panel tree.** Each gate printed its own exit
code beside its own name (`q6-logs/s6-panel-gates-01.log`), and each is quoted from that log rather than
recalled:

| gate | result | exit |
| --- | --- | --- |
| `npm run typecheck` | clean | `0` |
| `npm run lint` | 9 problems, **0 errors**, 9 warnings | `0` |
| `npm run product:check` | **184 active file(s) scanned, 0 violations** | `0` |
| `npm run dbtypes:check` | 20 migrations; 19 public + 10 non-client tables; 19 client tables; 34 query column groups reconciled, 0 findings | `0` |
| `npm run test` | **30 files, 440 tests, all passed** | `0` |

All nine lint warnings sit in files this stage did not touch (`AuthProvider`, `ContentEditor`, and seven
`src/components/ui/` primitives); neither `WeddingAssetsPanel.tsx` nor `EditProject.tsx` appears in the output.
The production build (`q6-logs/s6-panel-build-01.log`): `build_exit_code=0`, `dist_kb=1074` against §17's
`1062` — **+12 kB**, which is the same change `EditProject` shows chunkwise (103.75 kB → 115.90 kB), `index`
unchanged at 577.47 kB (gzip 172.27 kB against §17's 172.28 kB, so the movement is the panel's chunk rather
than the shared bundle), 31 asset files, and the familiar `chunkSizeWarningLimit` advisory.
Both installer markers are still present in `node_modules` (`.modules.yaml` and `.package-lock.json`), so
`1074 kB` describes the tree as found, not a clean install; the clean-install gate stays in the closure for
that reason and is not assumed from this pair. §8 asks for each gate to be *bracketed* by the
installer-provenance probe; here the probe ran once over the tree and printed both markers into the build log
rather than around every gate, so the per-gate bracketing is a closure-run obligation, and it is recorded as
unfinished rather than claimed.

**19.6 The I10 bundle sweep, re-taken over the new surface.** `q6-logs/s6-panel-sweep-01.log`, `scanned_kb=1045`
across `src/`, `index.html` and `dist/`: **eight** privileged shapes — `service_role`, `SERVICE_ROLE`,
`eyJhbGciOi`, `supabase_service`, `"role": *"service`, `postgres://`, `eyJ`, `object/public` — each printing
`files_matched=0`, and `hosted_origin_files=0`. `dist/` is the built bundle, so a zero there is a statement
about what would ship rather than about what is written in a source file. One hygiene slip is recorded because
the log is evidence: the sweep's `.env.local` context line printed the publishable key's value. It is the
browser-public anon key, not a privileged secret, and invariant I10 is about the privileged ones — but a
credential-shaped value does not belong in a file that gets read by later audits, so the value is redacted in
place and the redaction is what §19.6 now describes.

**19.7 The instrument that was *not* written, and why that is the disciplined choice.** `scripts/stage6-
journeys` does not exist yet. Stage 5 accumulated six instrument defects that only execution revealed
(§15.4 of this file is the same story three times over: a read that omitted its token, a length assertion on a
refusal body, an expectation copied from a probe row that had been staged differently), and an authored-but-
never-run journey file is precisely that failure mode in waiting — confident prose about responses the stack
may not send. So the journeys will be authored and executed in the same sitting, against the four transport
shapes §15.2 had to learn by measurement. The only piece added early is the driver primitive in §19.4, which
is a capability rather than a claim.

**19.8 The truth sweep, widened before it was trusted.** The readiness matrix was repaired in four places
(the asset row promoted `PLANNED V1` → `FOUNDATION` with the measured evidence beside it; the adapter census
from six to the count that includes `weddingAssets.ts`; the "tables no product code reads or writes yet" list,
which `wedding_assets` now leaves; the schema-count sentence that assumed nine untouched tables), the domain
model in three (`wedding_assets`'s write path, the stage attribution line, and the deferred-work row, which
now reads "Built, not qualified" and names the promotion as guest delivery plus a threat model plus a
retention rule), the Stage 2 blueprint's I-27 once the sweep found its "there is no upload path" sentence, and
the README in five. Both doc-scanning gates were re-run after those edits: `product_check_exit_code=0`,
`typecheck_exit_code=0` (`q6-logs/s6-docsync-gates-01.log`). §7's quotation of the old `feature-readiness.md`
line is kept as written, because it records what was true when §7 was written; this section is the place that
notes the quoted sentence has since been repaired.

**19.9 Two claims this section drafted from memory, both corrected by reading the files instead.** Writing
the README's new Stage 6 paragraph from recall produced "seven spellings of a supplied key, each followed by a
re-read proving no row survived" for the **SQL** battery. Against `supabase/tests/stage6/80_asset_registry.sql`
the registry battery refuses **five** shapes (K6 a legal-looking prefix, K7 traversal, K8 absolute path, K9
another wedding's prefix, K10 over-long) and measures a sixth — a whitespace-only claim — as *not a refusal*
but an absent claim the minter writes over (K11–K11c), so the guarantee is "no client string is ever stored as
a key" rather than "every non-empty string is refused". The seven-spelling-plus-re-read property belongs to
HTTP MINT-02 (§16.3), where the re-read is what turns a refusal into evidence. The README now states the SQL
battery's actual shape.

The second error ran the other way, and is the more instructive one. The draft recorded a **battery gap**:
that the migration's `asset_kind` immutability guard (`20261006120000_stage6_wedding_asset_storage.sql:113`,
raised as `42501` because the kind is a segment of the minted key) was enforced but never asserted. It is
asserted, four times, in the T group: **T4** the minted key cannot be rewritten even to another key of the
same legal grammar under the same wedding, **T4b** the row still carries the key it was minted with (a re-read
inside the SQL tier, not only in HTTP), **T5** the row cannot be re-parented to another wedding, **T6** the
kind cannot be swapped — each sent as `authenticated` with the owning account named, each expected to answer
`42501`. A first grep for `UPDATE public.wedding_assets SET object_key|asset_kind|wedding_id` found them at
`80_asset_registry.sql:595/602/606`, which is what overturned the claim; the earlier search had looked for a
word ("immutable") that the assertions spell as `§I2` in their case names. So there is **no gap to close**,
and the guard's coverage is stated here with its case ids rather than as an absence. Reading the same lines
also surfaced a measurement-integrity note the battery carries at :588, worth repeating because it applies to
every `left(sqlstate, 5)` assertion in this repository: an earlier draft of T4 concatenated a literal *inside*
the dynamic statement, the run answered `42601` — a syntax error from psql, not a policy refusal — and the
five-character comparison would have scored that as a refusal that never happened. Quoting through
`quote_literal` is what keeps a broken instrument from being green.

**19.10 Evidence consolidated, and one ambiguity in every earlier citation resolved by naming it.** All Stage
6 logs cited by §12–§18 live in `…/2026-09-24/37be0a2a/q6-logs/`, which is the **parent of the repository
root**, not a directory inside the clone. This session's first logs went instead to `s5qual/q6-logs/` — inside
the tree, untracked, and therefore one careless `git add` away from being committed. Its twelve files were
moved into the canonical directory (now 119 files, no name collisions) and `s5qual/q6-logs/` was removed;
`git status --porcelain` no longer lists it. Readers of §15–§19 should resolve any `q6-logs/…` path against
`…/37be0a2a/`. Nothing else was deleted, and no file belonging to another stage or project was touched.

**19.11 Engine re-probe, taken rather than assumed.** Two more attempts, each with its exit code read from an
adjacent `code=$?` and not from a pipeline: `timeout 25 docker version` → `engine_probe_exit=124`, and
`timeout 25 docker ps` → `ps_exit=124`. `q6-logs/s6-engine-probe-08.log` is **0 bytes**, which is what a killed
hang writes when it writes nothing: the daemon produced no output before the timeout. §18.5's position stands
unchanged, and the genuinely-human action is still the one it names — Docker Desktop restarted from an
elevated context or its own GUI, with the 5.5 GB-free question belonging to the owner of this machine. I did
not touch another project's containers or prune shared storage, and I did not delete anything to make room.

**19.12 The added-line secret scan (§8's last non-Docker obligation), taken over the candidate commit content
rather than over a SHA that does not exist yet.** The scan assembled the added lines of the tracked diff plus
the full bodies of the untracked Stage 6 files — `candidate_lines=5439` — and deliberately **excluded**
`pnpm-lock.yaml` and `pnpm-workspace.yaml`, which are never staged on this project (§10's substituted tree).
`q6-logs/s6-addedline-secret-scan-01.log`. Zero-counts, in order: `BEGIN PRIVATE KEY`, `AKIA…`, `ghp_…`,
`github_pat_…`, `xox[abpsr]-`, `AIza…`, JWT-shaped `eyJ…`, `sb_secret_…`, `postgres://user:pass@`,
`*.supabase.co`, `VITE_SUPABASE_ANON_KEY=<value>` — all **0**.

Four patterns matched and each was classified rather than waved past, because a sweep only covers its own
wording and a zero is not the same thing as a verdict:
`service_role`/`SERVICE_ROLE` 59 each — every one is a *role name* (`SET ROLE service_role`,
`REVOKE … FROM service_role`) or audit prose about that grant layer; proved by a follow-up search for a
token-shaped value in the position after the word, which returned nothing. `SUPABASE_SERVICE` 1 — the audit
sentence naming the I10 sweep's own pattern list. `anon_key` 17 — column and role vocabulary in comments.
`…token=…` 2 — one comment describing the shape the service hands back, and the battery's own
`?token=not-a-token` tamper case. The single payload-bearing long base64 string is `iVBORw0KGgoAAAANSUhEUgAAAAE…`,
the 1×1 PNG the HTTP battery uploads as test bytes. One grep in the first pass failed rather than matching
(`grep -Eic` read `-----BEGIN` as an option); it was re-issued with `--` and answered 0, so the census covers
every pattern it claims to. **Verdict: no privileged credential, secret value or hosted origin would enter the
Stage 6 commit range.** The scan must be repeated over the actual commit range at closure — this is the
pre-commit form of that obligation, not a substitute for it.

**19.13 What this section does not license.** No browser journey has run; no `setFileByLabel` call has run;
the serial HTTP chain has not gone green at a state carrying the panel; the Stage 6 journeys file is still
unwritten, deliberately (§19.7); and there is still no Stage 6 commit, no push and no remote SHA to verify
against. The gates in §19.5 are evidence that the new surface compiles, is linted, is contract-checked and
ships without a privileged secret — nothing more, and §18.4 remains the boundary of this stage until a chain
run exists at the SHA that carries it.


## 20. The coverage map rebuilt from the batteries rather than from the invariant ids, one documentation hole it found, and the app tier that closed it (2026-10-07)

This section exists because §6 wrote down a tier for each attack case and nothing in the repository yet answered
"which of those tiers actually has an artefact at this head, and which is a promise?" A map was the only way to find
out, and building it produced one real finding (§20.3) plus one real gap that this section then closed (§20.4). No
number in §17 or §19.5 is restated or revised here; those tables stand as measured.

**20.1 The map was rebuilt from labels, not from ids.** The first attempt to answer the question used the invariant
ids as search keys — which is a mistake, because the batteries do not name themselves after §6. The real label
vocabulary was read off the files: the registry battery's helpers are `pg_temp.s6r_ok` / `s6r_eq` (with `s6r_lit`
and `s6r_add` as composition and tally helpers) and the policy battery's are `s6p_ok` / `s6p_eq` / `s6p_lit` /
`s6p_add`, and each label is a group letter plus either a §-reference or an invariant id — `K6`, `S7 §I4`,
`T5 §I2`, `D0 §A15`, `R1 … (A1)`. Prefixing the wrong pattern (`s6_ok`, `s6_eq`) returned zero matches, which is the
kind of zero that would have been reported as "no coverage" if the files had not been opened. The census was then
cross-checked against the files rather than trusted: excluding the helper definitions themselves,
`80_asset_registry.sql` carries **90** assertions (84 `s6r_eq` + 6 `s6r_ok`) and `90_storage_policies.sql` carries
**80** (78 `s6p_eq` + 2 `s6p_ok`) — counted both as call sites and as literal labels, and the two counts agree.
Those are the same 90 and 80 §15 records from `q6-logs/s6-stage6chain-04.log`, so the map and the green run are
describing the same battery. Registry groups: **B** shape, **K** key minting, **S** staged→ready, **T** state machine
and immutability, **D** deletion ordering, **O** orphan census. Policy groups: **G** grants, **P** policy census,
**R** read, **I** insert, **U** update-absence, **D** delete, **F** fixture, **Z** end-state.

**20.2 Attack case × tier, as artefacts rather than as intentions.**

| # | SQL | HTTP | App unit | Browser |
|---|---|---|---|---|
| A1 | measured — `R1`, `R2`, `R3`, `K19`, `K20`, `S11` | chain not green at this head (§18.4) | n/a — no browser code is involved in a policy answer | not run |
| A2 | measured — `I4`, `I6`, `I9`, `K18` | chain not green at this head | n/a | not run |
| A3 | measured — `D3`, `D3b`, `D4` | chain not green at this head | partly — `removeAsset`'s sequence is measured, the refusal is not | not run |
| A4 | measured — `G2`, `G3`, `R4`, `R5`, `I8`, `D6`, `P3` | chain not green at this head | n/a | not run |
| A5 | measured — `R6`, `R7`, `D5`, `Z4` | chain not green at this head | n/a | not run |
| A6 | measured — `K6`–`K11c`, `T4`, `T4b` | chain not green at this head | measured — the register payload has no `object_key` key at all, and the upload uses the read-back key | not run |
| A7 | measured — `P2`, `I7`, `I7b`, `I7c`, `U7`–`U7g` | chain not green at this head | measured — `upsert` is sent as `false`, and the mutation in §20.6 proves the case notices `true` | not run |
| A8 | bucket facts measured — `B4` | chain not green at this head | **measured — new** (`§20.4`) | not run |
| A9 | claim-vs-bytes measured — `S7`, `S8`, `S10`, `T2c`, `T2d` | chain not green at this head | **measured — new** (`§20.4`) | not run |
| A10 | measured — `T5`, `T6`, `K9` | chain not green at this head | n/a | not run |
| A11 | **not this case** — `G4`, `G5`, `G6`, `B9`–`B11` measure RLS-enabled and grant shape *inside* Postgres; whether the `storage` schema is reachable over REST at all is only answerable by the HTTP tier | chain not green at this head, and this row is the chain's to answer | n/a | not run |
| A12 | n/a | n/a | measured — node gates + contract rule | n/a |
| A13 | **partial — see §20.3** | chain not green at this head, and the operation-spelling question is only answerable there | n/a | not run |
| A14 | measured — `B2`, `Z7` | chain not green at this head | n/a | not run |
| A15 | measured — `D0`, `D0b` (policy battery) and `D0`–`D5b` (registry battery, different group) | chain not green at this head | partly — the tombstone→collect→delete order is measured; the platform's refusal is not | not run |

Reading the table honestly: the SQL column is the only tier that is green at a state carrying this code, and it is
green for §15's chain, not for anything added since. The HTTP column says "chain not green at this head" for every
row because §18.4's block applies to the whole chain, not to a subset of cases — so no row in that column can be
upgraded without the engine. The app-unit column was empty for A8 and A9 when this section began; that was the gap.

**20.3 `storage.allow_only_operation` is defined and called by nothing — and the SQL tier cannot answer the question
about it.** §2.1 defers one question to the running stack: whether the operation names the local image accepts match
the documented spelling (`object.list` versus `storage.object.list`), and §6 wrote the A13 refusal as
"`allow_only_operation('object.list')` keeps download-scope and list-scope from widening each other." A repository
-wide search for the identifier returns exactly two kinds of hit: the audit's own prose (§2.1, §6, §12.4), and **one
definition** at `supabase/tests/stage6/00_storage_schema.sql:171`, which the fixture captures verbatim from the live
image via `pg_get_functiondef()`. There is no call site: not in Stage 6's migration, not in either battery, not in
any earlier stage's policies. So the function the A13 clause credits with keeping two scopes apart is a comparator
this product's policies never consult, and the separation §6 describes is carried entirely by the three policies'
own key-shape predicates (`R0`, `R3`, `R8`, `R9`), which is what those labels actually measured. The search covered
`src/`, both batteries and every migration, so the silence is about the code and SQL, not about prose.

The tempting repair was to add an SQL assertion that calls `storage.allow_only_operation('object.list')` and expects
`true` under a set `storage.operation`. That was **not** done, and the reason is on the record: no Storage service
runs in the SQL fixture, so the only value of `current_setting('storage.operation', true)` there is the one the
fixture itself set. Such a test would measure the fixture's copy of the comparator against the fixture's own
`GUC` — a proxy that turns the A13 row green without saying a word about the image. §12.5.6 already ruled the
operation-scoped SELECT "usable but not yet necessary"; this section keeps that ruling and moves the finding, so
A13's SQL coverage is marked *partial* rather than *measured*, and the whole question is named as belonging to the
HTTP tier against the running service, which is §18.4's blocked half. Once the chain runs, the answer needed is one
observation, not a policy change: what `storage.operation()` returns during a real download and a real list, and
whether a leading `storage.` is ever present in it.

**20.4 The app tier for A8 and A9 was written, and it is green.** §6 assigned both cases an "app-level unit" /
"app unit" tier and §5.3's ordering gave the adapter a third obligation that no existing file tested: the
client-side half of A8 and A9 is *pure decisions* — a MIME set, a byte ceiling, a check order, a payload shape — and
none of it required Docker, PostgREST, Storage or Postgres. `src/test/weddingAssetUploadRules.test.ts` is new:
**26 tests, 26 passed, `unit_exit_code=0`** (`q6-logs/s6-app-tier-iter-02.log`), against a recording stand-in for the
generated client that follows `fakeSupabase.ts`'s existing rule that an unplanned read is not a silent success. The
file's header states its own boundary rather than borrowing the SQL tier's: the `File` stand-in carries `size` and
`type` only, the bucket's own MIME and size refusals belong to HTTP, and the mint trigger and the claim comparison
belong to SQL — "a gate that returns the right words after already writing a row would be a gate that leaves the
orphan it claims to avoid."

What it actually pins, in four groups:
* **The pre-flight gate as refusal-plus-silence.** Eight cases, each ending in `expect(fake.steps()).toEqual([])`:
  no kind chosen, zero-byte file, `image/svg+xml`, `text/html`, `application/octet-stream`, a file one byte over the
  ceiling, and the ordering (`KIND_NEEDED` before `EMPTY_FILE` before type before size) — because the ordering is
  what decides which sentence a host with a 6 MB SVG is told.
* **What crosses the wire on the register step.** The exact payload key set is
  `["asset_kind","label","mime_type","size_bytes","wedding_id"]`, so "sends no `object_key`" is asserted as an absent
  key rather than as a comment; `upsert: false`; the upload is addressed with the key read back from the insert, and
  the fixture's read-back key is deliberately not derivable from the wedding id — a module that built a key from a
  template would fail that case; and the claim sent at confirmation is byte-for-byte the claim registered.
* **The sequence and both rollbacks.** Happy path `["db:insert","storage:upload","db:update"]`; a failed upload
  `["db:insert","storage:upload","db:delete"]` with no confirmation attempted; a `42501` at the confirmation edge
  retiring the pair as `update, remove, delete` and surfacing a sentence that does **not** contain the MIME string
  (`safeError` keeping Postgres prose out of host-visible text, measured at the call that has the most of it to
  leak); a non-`42501` code *not* reported as a claim disagreement; a zero-row update treated as failure; the two
  removal shapes (`tombstoned` → `["storage:remove","db:delete"]`, `ready` →
  `["db:update","storage:remove","db:delete"]` with payload `{upload_status:"tombstoned"}`); bytes that cannot be
  collected stopping the sequence before the row delete; and a failed replacement leaving the previous row and key
  absent from every recorded step.
* **The two reads a host is entitled to.** The signed URL is requested against the one bucket, for the row's own
  key, with a TTL of at most 60 seconds, and an answer with no URL in it is a failure; the list read carries only a
  `wedding_id` filter and orders `created_at` then `id`.

**20.5 The first run of the new battery failed eight cases, and all eight were instrument defects.**
`q6-logs/s6-app-tier-iter-01.log` records `8 failed | 18 passed (26)`, `unit_exit_code=1`. Neither cause was the
adapter, and neither fix was a weakened expectation:
1. Seven of the eight were sequence assertions compared against the raw step log, which also records builder steps
   (`from`, `select`, `eq`, `order`). The instrument now separates *calls* from *builder steps* — `ops()` filters to
   the six verbs that actually leave the tab (`insert`, `update`, `delete`, `upload`, `remove`, `createSignedUrl`)
   while `steps()` stays raw for the payload and silence assertions. The expectations are exactly as strict as the
   ones that failed.
2. The eighth was an under-planned queue in the replace case: a fresh upload that fails legitimately deletes the
   **new** row, so the scenario needed a second planned response. That is the fixture admitting it had not been
   written for the rollback it was being asked to prove.

A third defect was closed before it could produce a false green: a queue with *unused* planned responses would let a
scenario describe calls that never happened, so the fixture exposes `dbRemaining()` and an `afterEach` asserts it is
zero. The drained-queue rule is the mirror of the unplanned-read rule, and it is what trimmed a duplicate plan in the
tombstoned-removal case.

**20.6 The instrument can fail, verified by three reverted mutations.** A green battery that cannot go red is not
evidence, so each of the three rules §20.4 claims to pin was broken in the adapter and the named case re-run:
`q6-logs/s6-app-tier-mutations-01.log`. Widening `ALLOWED_MIME` to include `image/svg+xml` →
`1 failed`, case "refuses an SVG by name", `vitest_exit_code=1`. Changing the ceiling comparison from `>` to `>=` →
`1 failed`, case "sends a legal file at the ceiling". Changing `upsert: false` to `upsert: true` → `1 failed`, case
"asks for no overwrite". `adapter_sha256_before` and `adapter_sha256_after` are both
`26fcbe9df98c85d76db55fdb8f19ec9fa378e3cde4750905e5608e079fab6c92` and the log records `restore=byte-identical`.
These are the three mutations §12's "the adapter refuses on the host's behalf" list names, and each is now covered by
a case that notices it.

**20.7 One stale statement in the adapter's own header was corrected.** `weddingAssets.ts` carried a block reading
"NOT YET QUALIFIED … the local stack's generated types do not carry `upload_status` yet … nothing in it may be
reported as verified." The second half of that was written when the generated types lagged the migration and is no
longer true of the first half: the client-side half of the file is now exercised. It was replaced with a
"WHERE THIS FILE HAS BEEN MEASURED" block that names the test file, names the three mutations and their cases, and
says plainly what still has not happened — no call from this module to a running stack (the HTTP battery speaks REST
and Storage directly rather than through these functions) and no browser run at all. The test count was deliberately
left out of the code comment; a number in a comment is the kind of claim that rots while the tests around it change.

**20.8 §8's per-gate bracketing, which §19.5 recorded as the unfinished form of the installer check.** §19.5 ran the
gates and separately proved the tree's installer provenance; §8 asked for the provenance probe *around each gate* so
that a gate's result is tied to a tree state rather than to a session. Done now, `q6-logs/s6-node-gates-bracketed-01.log`:
five gates, each with a before-probe, the gate, and an after-probe. `npm run typecheck`, `npm run test`,
`npm run lint`, `npm run product:check`, `npm run dbtypes:check` → **`gate_exit_code=0` for all five**, and every
probe line in the file is identical:
`installer_probe: npm_marker=present pnpm_marker=present lockfiles_tracked=package-lock.json`. Two numbers moved
because this section's work is in the tree, and each is what it should be: `npm run test` is **31 files / 466 tests**
(one file and 26 tests newer than §19.5's run — the new battery, nothing else), and `product:check` is
**185 active files, 0 violations**. Lint is 0 errors / 9 warnings, unchanged, and the db contract reports 20
migrations, 19 public + 10 non-client tables, 34 query column groups, 0 findings. §17's and §19.5's tables are left
exactly as they were measured; README's live claims were synced to 185 files and to the new bullet.

**20.8a The exit codes were re-taken, because the first attempt measured the wrong process.** The log above was
written before this section, and when §20.8 was drafted its `gate_exit_code` lines were trusted without checking how
they were produced. The re-run made for this section (`q6-logs/s6-doc-append-gates-01.log`) initially used
`npm run <gate> | tail -6`, which puts `$?` on the far side of a pipeline — so the number in that log measured
`tail`, not the gate. It was superseded immediately by `q6-logs/s6-doc-append-gates-02.log`, which runs each gate to
a file and reads `$?` adjacent to the gate itself: `product:check`, `typecheck`, `lint` and `dbtypes:check` all
return **`gate_exit_code=0`**, with the same 185 files / 0 violations, clean typecheck, 0 errors 9 warnings, and the
same db-contract census. `npm run test` was re-measured the same way (`q6-logs/s6-suite-exitcode-01.log`:
`suite_exit_code=0`, **31 files / 466 tests**, `head=568b36f`) so no part of §20.8 rests on a pipeline-derived
number. This is the same rule §19.11 applied to the engine probe, and the fact that it caught a defect in a log this
session wrote is the argument for applying it to every exit code rather than only to surprising ones.

**20.9 What this section does not change.** The engine is still down, re-probed for this section rather than
recalled: `timeout 20 docker version` → `engine_probe_exit=124`, and `df` on the volume holding Docker's data says
**2.3 GB free of 476 GB, 100 % used**. That figure moves between probes (1.9 GB earlier in the same session, 5.5 GB
where §18.2 measured it), which is what a shared volume looks like and is why §18.5's and §19.11's position is
unchanged rather than restated as a new number. The serial HTTP chain has not gone green at this head, no browser
journey has run, the A13 operation question is still open and now has a named tier instead of an assumption, no
Stage 6 commit exists, and there is nothing pushed. The app tier closed here is the first Stage 6 obligation since
§18 that did not need the engine, and it is the only one — which is the whole reason the map in §20.2 was worth
building before waiting for the stack again.

## 21. The Stage 6 implementation is committed and published on the stage branch — as work, not as a verdict (2026-10-07)

**21.1 Why this happened now, and what it is not.** §18.4 and §19.13 both held the commits until a chain run
existed at the head that carried them. The engine has not answered since (`timeout 20 docker version` → `124`, and
the volume holding Docker's data is at 2.3 GB free of 476 GB, both re-measured for §20.9), and the tree at this
point was 19 modified files plus 6 untracked paths living entirely on one disk that is 100 % used. Withholding the
commits any longer protects nothing: a stage branch is where unqualified work belongs, and every file published
here says in its own text which tiers are green and which have not run. **This is a publication of implementation,
not a Stage 6 PASS.** No merge, no main, no deploy, no hosted project, no Stage 7.

**21.2 The commit set.** Seven commits on top of `568b36f`, each with an explicit path list, in the order the
dependency runs:

| commit | paths |
| --- | --- |
| `feat(storage)` the bucket, minted key, state machine and `storage.objects` policies | `supabase/migrations/20261006120000_stage6_wedding_asset_storage.sql` |
| `test(storage)` the two Stage 6 SQL batteries | `supabase/tests/stage6/` (00, 80, 90, run.sh) |
| `test(api)` the Stage 6 HTTP battery + its two leak counters and the chain wiring | `supabase/tests/api/stage6_storage.test.mjs`, `supabase/tests/api/run.sh` |
| `fix(tests)` the historical batteries Stage 6 invalidated | the two Stage 2 SQL files, Stage 3 publication SQL, Stage 4 pack-release SQL, the three Stage 5 SQL files, and `stage3_security.test.mjs` |
| `feat(app)` the adapter, the host's panel, the page mount, the regenerated types | `weddingAssets.ts`, `WeddingAssetsPanel.tsx`, `EditProject.tsx`, `types.ts` |
| `test(app)` the 26-case adapter battery + the driver's file-input primitive | `weddingAssetUploadRules.test.ts`, `stage5-browser-driver.mjs` |
| `docs(stage6)` this audit's sections 13–20 plus the synced live claims | README, the two architecture docs, the readiness matrix, this file |

Two things each commit message says out loud, because a message is the only place a reader meets the work before
they meet the audit: the HTTP and browser tiers have not run at this head, and the Stage 6 `wedding_assets` probe in
the Stage 3 suite stopped sending an `object_key` because a BEFORE INSERT mint trigger answers a supplied key ahead
of the RLS `WITH CHECK` — which would have made an isolation case report a minting refusal instead of the thing it
claims to test. `pnpm-lock.yaml` and `pnpm-workspace.yaml` are still untracked and still not staged: the final
status line of the commit run lists exactly those two paths and nothing else.

**21.3 The added-line secret scan, re-taken over the content that was actually committed.** §19.12 called its own
run the pre-commit form of this obligation; this is the commit form. Assembled the same way — added lines of
`git diff -U0` over the tracked paths, plus the full bodies of the nine untracked Stage 6 files, with the two pnpm
files excluded — `q6-logs/s6-addedline-secret-scan-02.log` carries **candidate_lines=6135**, and `git diff --stat
568b36f..HEAD` reports **6135 insertions**, so the census and the commit range describe the same bytes. Zero counts:
AWS access keys, `ghp_`, `github_pat_`, Slack tokens, Google API keys, JWT-shaped strings, `VITE_SUPABASE_ANON_KEY=`
with a value, and — after the first pass escaped its own dots — hosted `supabase.co` origins. Four patterns matched
and each is classified in the log rather than passed over: `BEGIN PRIVATE KEY`, `sb_secret_` and `postgres://user:pass@`
all appear once, inside the audit sentence at §19.12 that lists this sweep's own pattern names; `supabase.co`
unescaped also catches the two file-path strings the batteries read `supabase/config.toml` through. The two
long base64-shaped strings are this section's own sha256 literal (hex is a subset of the base64 alphabet) and the
1×1 PNG the HTTP battery uploads as test bytes. All four app files in the range — `weddingAssets.ts`,
`WeddingAssetsPanel.tsx`, `weddingAssetUploadRules.test.ts`, `EditProject.tsx` — contain **0** occurrences of the
privileged role name, counted individually and appended to the same log, which is what the adapter's own I10 note
promised. Conclusion: no privileged credential, secret value or hosted origin entered the range.

**21.4 The push and the read-back.** `git push origin HEAD:refs/heads/stage6/storage-assets` →
`568b36f..f0f5088`, `push_exit=0`, and `git ls-remote origin refs/heads/stage6/storage-assets` answers
`f0f508844dca0b9a5bff78710c40d1827b2ca643`, equal to `git rev-parse HEAD` — `sha_match=YES`. The refspec is the
stage branch only; `main` was not fetched, rebased, touched or pushed to.

**21.5 Node gates at the pushed head, measured rather than inherited.** `q6-logs/s6-gates-pushed-head-01.log` was
taken with `worktree_tracked_changes=0` and each `$?` read beside its own `npm run` with no pipe in between:
`typecheck`, `product:check`, `dbtypes:check`, `lint` and `test` → **`gate_exit_code=0` for all five**, at
`head=f0f5088…` with `head_after` identical. 185 active files and 0 contract violations, 20 migrations with 34 query
column groups reconciled and 0 findings, 0 lint errors / 9 warnings, **31 files / 466 tests**. This is the first
Stage 6 head that has carried its own green node run rather than borrowing one from the tree it was cut from.

**21.6 What is still open, and it is unchanged in kind.** The serial HTTP chain at this head; the SQL batteries
re-run at it rather than at the earlier chain head; the whole browser tier, including the three network observations
(no privileged header leaves the browser, no non-loopback request, no `/object/public/`); the A13 operation-spelling
question §20.3 hands to the running service; the production-build render check; the added-line scan re-taken over any
range a later repair extends; and the Stage 6 journey file §19.7 deliberately left unwritten until a driver run can
hold it. The single human-only action is the one §18.5 names: Docker Desktop restarted from an elevated context or
its own GUI, on a volume whose free space its owner controls. Nothing in this section asserts that Stage 6 is
qualified; it asserts that the work is published where it can be reviewed, and that the boundary §18.4 drew is
still the boundary.

## 22. The head that carries the commit set, the artifact built at it, and the one match the bundle sweep found (2026-10-07)

**22.1 Why a section after the one that published the work.** §21.5 measured the node gates at the head the seven
implementation commits created. Writing §21 changed the tree, so the head that carries *this* stage's audit is one
docs-only commit further (`dbf02e4`), and a section that reports a green run has to point at a run taken at the head
it ships from — which is why the gates and the build were re-measured after it rather than cited from before it.

**22.2 The artifact run at the published head.** `q6-logs/s6-final-head-build-02.log`: `npm run build` at `dbf02e4`
with a tracked-clean tree → **`build_exit_code=0`**, `built in 38.88s`, `dist_kb=1074`. The census now has its method
stated on the record, because two different numbers were circulating for the same build: vite prints **31** output
lines, of which **30** are under `dist/assets/` (the extra line is `dist/index.html`), while `find dist -type f` counts
**33** because it also sees the two root files vite does not print, `favicon.ico` and `robots.txt`. So §19.5's "31 asset files" (the log's
`dist_asset_files=31`) and this run's `find`-based 30/33 are two probes over two sets, not a lost asset — the panel
build re-measured the same way returns 31 printed lines and 30 under `dist/assets/`, exactly the same set.

Identity is asserted the way that can be checked rather than eyeballed: the **30 chunk names with their content
hashes** are diffed file-for-file between the §19.5 panel build and this one and the diff is empty
(`chunk_name_and_hash_set_identical=YES`) — `index-fTteksTz.js` 577.47 kB (gzip 172.27), `Header-DPODPWZC.js` 132.19 kB,
`EditProject-CjuTfpnK.js` 115.90 kB (gzip 33.81), `sanitizeSvg-CfK6a1-E.js` 29.89 kB, `Index-mcRxrBTH.js` 18.19 kB,
`index-DSeE7ILB.css` and the 24 smaller chunks. A hash set is stronger evidence than the `dist_kb` figure, since a
changed import or a new lazy route would rename a file; identical hashes are the correct expectation for a docs-only
change.

The five node gates were re-taken at the same head with each `$?` read beside its own command
(`q6-logs/s6-final-head-gates-01.log`): typecheck, `product:check` (185 files, 0 violations), `dbtypes:check`
(20 migrations), lint (0 errors, 9 warnings) and test (**31 files / 466 tests**) → **`gate_exit_code=0` for all five**,
with `worktree_tracked_changes=0` before and `head_after` equal to the head the run started at.

**22.2a Two instrument errors in the measurement above, recorded because they changed reported numbers.** The first
pass of this section reported `dist_asset_files=33` from a build log whose asset listing had been tail-limited to five
lines, and §22's draft then asserted that "both build logs list 30 asset lines", which the logs contradict: grepping
the retained output for `dist/assets` returns **0** matches in both, because vite writes ANSI colour escapes into the
line before the path, so a plain prefix match never sees it. Both faults were fixed the same way — strip the escapes
(`sed 's/\x1b\[[0-9;]*m//g'`) before matching, and enumerate the built tree with `find` rather than counting printed
lines. The corrected numbers are the ones in §22.2; `-01`'s tail-limited listing is left in place rather than rewritten,
and its `secret_prefix_in_dist=1` classification survives because it was taken from the file contents, not the listing.

**22.3 I10 over the artifact, including the match that was not a hit.** The dist sweep on this build returns
`privileged_name_in_dist=0`, `hosted_origin_in_dist=0`, `secret_prefix_with_token_chars=0` and `jwt_shaped_in_dist=0`.
One file matches the bare secret-prefix pattern, and reading it rather than counting it settles it: the bundle contains
the nine characters `sb_secret_` with nothing after them, inside the client library's own key-shape predicate
(`qw=t=>t.startsWith("sb_publishable_")||t.startsWith("sb_secret_")`). A search for that prefix followed by twenty or
more token characters returns 0 across `dist/`, and a JWT shape (header payload, i.e. two dotted base64url segments)
returns 0 — so the hit is a dependency recognising the shape of a credential this product never ships, not a
credential. The closing sentence of this paragraph used to read "the local config still names only
`http://localhost:8080`", and §24.4 found that claim by measuring rather than recalling it: it is false as written.
`localhost:8080` is only `supabase/config.toml:68-69`'s auth `site_url` and redirect pattern; the application's own base
URL, in the gitignored `.env.local`, is the loopback Kong port `http://127.0.0.1:54400`. Both are loopback and neither
is a hosted project, so this paragraph's conclusion is unaffected, and `supabase link`/`db push`/`db pull` were never
run.

**22.4 The added-line scan for the range the audit commit extends.** The head this section publishes from adds 68 lines
of prose and nothing else (`68 0 docs/audits/stage-6-storage-assets.md`); `q6-logs/s6-final-head-gates-01.log` carries
its census over `f0f5088..dbf02e4`, `candidate_lines=68`: AWS/GitHub/Slack/Google token shapes, JWT shapes,
`sb_secret_` with a value, hosted `supabase.co` origins, an anon-key assignment and a long privileged-key form all
**0**. One line matches three pattern *names* (`BEGIN PRIVATE KEY`, `sb_secret_`, `postgres://user:pass@`) and it is
§21.3 describing this sweep — the same self-reference §19.12 classified, now twice-removed from any value.

**22.5 The branch push triggers no CI, and that is the repository's design rather than a gap.**
`.github/workflows/ci.yml` fires on `push` to `main` and on `pull_request` targeting `main`, so
`gh run list --branch stage6/storage-assets` correctly returns an empty list; there is no red run to investigate and
no green one to claim. CI is therefore evidence this stage does not have, and cannot get without crossing the merge
boundary §18.4 and the standing scope both forbid.

**22.6 Still open after this section, unchanged in kind.** The serial HTTP chain and the SQL batteries at this
head, the browser tier with its three network observations, the A13 operation-spelling question (§20.3), the Stage 6
journey file, and the added-line scan for any range a later repair adds. All of them need the engine: this section's
probe returned `engine_probe_exit=124` and `docker_ps_exit=124` (`q6-logs/s6-engine-probe-10.log`), which is what every
probe that recorded a code has returned — the one exception being `-08`, whose file is empty, so it reports no
outcome rather than a success. The same log carries `C: 476G 473G 2.4G 100% /c`; §20.9's probe measured 1.9 G free, so
the free figure is moving while the used percentage stays pinned, and the volume owner, not this stage, controls it.
No merge, no main, no deploy, no hosted project, no Stage 7.

**22.7 What this section does and does not claim about its own commit.** The commit that carries this prose changes
only this file, so no gate result reported here depends on a run taken after it: the gates and the build cited above
were both measured at `dbf02e4`, which already contains §20 and §21. The convention this stage keeps is that the
docs-only head created after a section is certified by re-taking the gate set at it and recording the run in
`q6-logs/` under that head's own SHA, rather than by writing a predicted result into the document it is certifying.
A reader who wants the number at the final head reads the log named by the closing report, not the prose.

## 23. The three things provable without an engine, taken at the head §22 created (2026-10-07)

**23.1 Why this section exists while the stack is down.** The closure tier is engine-bound, but three obligations were
still unmet and none of them needed Postgres: the gate set at the head §22's own commit created (which §22.7 promised
rather than predicted), I10 over the two surfaces no added-line scan has ever covered — the whole tracked tree and this
stage's own evidence directory — and a static answer to the question "when the engine comes back, will this runner
actually execute the batteries, and is the Stage 0 billing guard still asserted at a head that archived it?" All three
are answered below by measurement; none of them is a substitute for the tiers §23.6 still owes.

**23.2 The gates at `5470858`.** `q6-logs/s6-final-head-gates-02.log`, each `$?` read beside its own command, tree
tracked-clean before and after, `head_after` equal to `head`: typecheck **0**, `product:check` **0** (185 active files,
0 violations), `dbtypes:check` **0** (20 migrations; 19 public + 10 non-client tables; 19 client tables; 34 query column
groups, 0 findings), lint **0** (0 errors, 9 warnings), test **0** (31 files, 466 tests, 108.65s). So the head that
carries §22 has its own green run rather than inheriting `dbf02e4`'s, which is what §22.7 said would happen.

**23.3 The SQL runners, verified without a database.** `bash -n` over `supabase/tests/api/run.sh` and the `rls`,
`stage2`, `stage4`, `stage5`, `stage6` runners returns **0 for all six** — a syntax error discovered now costs one
engine-blocked afternoon less than one discovered when the stack returns. Then the wiring itself, read rather than
trusted: `stage6/run.sh` enumerates Stage 2's outcome suite (per chain), Stage 3's draft-invariant and publication
suites, Stage 2's attack and catalog suites **in the same order `stage2/run.sh` uses** (outcome before attacks, because
the attack suite seeds rows the outcome counts were measured against), then Stage 4's two suites, Stage 5's three, and
Stage 6's own two via `[89]*.sql`, with a guard that exits 1 if that glob matches nothing — the §13.2 failure shape,
where an invisible stage still prints a pass. Each suite's transaction mode was cross-checked against the runner that
owns it: `50_pack_release` `tx` and `60_reviewed_fixture` `rollback` match `stage4/run.sh`, and Stage 5's three suites
are `tx` in `stage5/run.sh` and `tx` here, with its `*_rollback.sql` glob genuinely empty (three files, none of them
rollback-named). No suite is executed under a mode its own runner does not use.

**23.4 The coverage question that resolves to "not a hole", answered from the files.** `bash supabase/tests/rls/run.sh`
— the Stage 0 gate ADR 0005 calls *the* gate, 24 assertions, the one that grew the paid-state INSERT cases — is **not**
invoked by the Stage 6 chain, and reading the two relevant migrations says that is correct rather than an oversight.
Its selector is `grep -vE '_stage([2-9]|[1-9][0-9]+)_'`, a range rather than an alternation for the reason printed
beside it: it deliberately qualifies the *published* Stage 0/1 shape and aborts on anything later. And at this head the
object it guards no longer exists — `20260925120700_stage2_archive_legacy_scaffold.sql:52` runs
`DROP TRIGGER IF EXISTS projects_paid_status_guard ON public.projects` and line 73 moves the enum out with
`ALTER TYPE public.paid_status SET SCHEMA legacy`. So "the Stage 0 suite was not re-run at the Stage 6 head" reads like
a gap and is not one; the live equivalent of the property — a client may not mint its own billing state — is asserted
by `supabase/tests/stage2/20_attacks.sql`, which names `entitlements` **29** times, including INSERT probes at lines
356, 435, 459 and 1298–1314 on the chain this runner does execute. This section records the reasoning because the
census line alone would have invited someone to re-open it.

**23.5 I10 over the two surfaces the added-line scans never reached** (`q6-logs/s6-i10-treesweep-01.log`). The tracked
tree is **256 files**; over it, every value-shaped pattern returns 0 files and 0 lines: `service_role` followed by 20+
key characters, `sb_secret_` likewise, a three-segment JWT, `AKIA…`, `ghp_…`, `github_pat_…`, `xox[baprs]-…`, `AIza…`,
an `ANON_KEY=` with a value, and a 15+ character hosted `supabase.co` ref. This stage's evidence directory is
**152 files / 816 kB**, outside the repo and never committed, and its value-shaped privileged patterns also return 0.
Every non-zero match was read rather than counted; they are **six files** across four classes. Three lines of this audit
(1015, 1253, 1335) name the sweep's own pattern labels. `.env.example:12` holds the literal placeholder
`https://your-project-ref.supabase.co`, and the Stage 5 audit quotes that same placeholder. `s6-final-head-build-01.log`
matches the secret-prefix regex through its own variable name, `sb_secret_followed_by_token_chars`, because underscores
are word characters. And the two shape logs carry Storage **signed-URL tokens** from an earlier HTTP battery run (`…/object/sign/wedding-assets/…?token=eyJhbGciOi…`). That last one is the
match worth stating plainly instead of waving: I10 forbids a privileged key, and a signed URL is not one — it is an
expiring grant for exactly one object, issued by the local stack to a session that already owned the row, its decoded
body is the object path (`{"url":"wedding-assets/weddings…`), and the stack that minted it is the one currently
refusing to start. What would violate I10 is a `service_role` value, and there is none in any surface swept here:
`src`, `index.html` and `dist` contain **0** files even with the bare role *name*, while `supabase/migrations` (11
files), `supabase/tests` (23) and `docs` (11) name that role because granting to it and refusing it are the point of
those files.

**23.6 What this section does not prove, unchanged.** None of the above observes a running system. No header has been
shown not to leave the browser, no REST path shown unreachable, no byte shown written or refused, no signed URL shown
to expire — those are the HTTP tier's 33 cases, the six SQL batteries' 90 + 80 plus the historic suites re-measured at
this head, and the browser tier with its three network observations. The probe taken while writing this section
returned `engine_probe_exit=124` again (`q6-logs/s6-engine-probe-11.log`). No merge, no main, no deploy, no hosted
project, no Stage 7.

## 24. The artifact at the published head, and the credential class the dist sweep had never been asked about (2026-10-07)

**24.1 Why this section exists when §23 said nothing engine-free remained.** §23.6 closed by listing what was left and
attributing all of it to the absent engine. Two items were not engine-bound after all: the production build, which needs
only Node, and the question of what the built artifact actually *contains*. Answering the second overturned a sentence
§22.3 published, so it cannot be left as a log entry — a claim this file states about its own evidence has to be corrected
in this file.

**24.2 The build taken at `0ff4d8c`, the head this stage has actually published.** §22.2 certified a build at `dbf02e4`
and §23 re-took the five gates at `5470858`, but no build had been taken at the pushed head. `q6-logs/s6-final-head-build-03.log`
does that: **`build_exit_code=0`**, `✓ built in 39.58s`, `index-fTteksTz.js` 577.47 kB (gzip 172.27), and
`chunk_name_and_hash_set_identical=YES` with `differing_entries=0` against the 30-name list §22.2 measured — the expected
result for a run whose only input change is prose, and the reason the census is of names and hashes rather than sizes.
File counts, both methods stated because they differ and are reconciled here rather than left as an apparent
discrepancy: grepping the escape-stripped output for the literal `dist/assets` yields **30** lines, while §22.2's
**31** counts vite's printed total including `dist/index.html`; `find dist/assets -type f` → **30**, `find dist -type f` →
**33**. `dist_ignored=YES`, with `worktree_tracked_changes_before=0` and `worktree_tracked_changes_after=0`, so the
artifact never touches the tree.

**24.3 The node gates at the same head, and the regress §22.7 was written to avoid.** `q6-logs/s6-final-head-gates-03.log`:
typecheck, `product:check` (185 files, 0 violations), `dbtypes:check` (20 migrations, 19 public + 10 non-client, 19 client
tables, 34 column groups, 0 findings), lint (0 errors, 9 warnings) and test (31 files / 466 tests, 103.46 s) →
**`gate_exit_code=0` for all five**, each read adjacent to its own command, with `head_after` equal to the head the run
started at. No section was written *for* that certification, which is exactly what §22.7 prescribes: `0ff4d8c` was its own
certified head until this one. The head this section creates gets the same treatment — a log under its SHA, not another
section predicting it.

**24.4 What the artifact carries, which the I10 vocabulary could not see.** I10 has been operationalised all stage long as
patterns of the *privileged* class: `service_role`, `sb_secret_` followed by token characters, a JWT shape,
`postgres://user:pass@`, `BEGIN PRIVATE KEY`, a hosted `supabase.co` origin. Every one of those returns **0** in this fresh
build, as it did in §22.3's. But that pattern set can never answer "does the bundle contain a credential?", because the
credential a browser client is *supposed* to hold belongs to the other class. It is there: the local stack's
`sb_publishable_…` key appears **twice** in `dist/assets/index-fTteksTz.js`, each time as the second argument sitting beside
`http://127.0.0.1:54400` — Vite's `VITE_` replacement inlining `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at
the only two modules that read them (`src/integrations/supabase/client.ts`, `src/integrations/supabase/publicInvitation.ts`).
The third `sb_publishable_` occurrence is the library predicate §22.3 already quoted. Provenance was measured rather than
assumed, because "looks like a dependency default" was my first guess and it was wrong: the token is absent from
`node_modules/@supabase/*`, and repo-wide (excluding `dist/`) it appears only in `.env.local`, on
`VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_LOCAL_PUBLISHABLE_KEY`.

**24.5 Why that is a PASS, and the stronger evidence the sweep now produces.** `.env.example:3-5` is this repository's own
contract for the class: "These are BROWSER-PUBLIC Supabase settings (they ship to every visitor in the JS bundle). They are
NOT secrets and are NOT equivalent to a service_role / secret key", and `:15` narrows the field to "the ANON key only". The
bundle holding a publishable key is therefore the design working, not I10 being bent around it — and the case for that got
much stronger in the same run. The *same* gitignored file also carries `SUPABASE_LOCAL_SECRET_KEY`,
`SUPABASE_LOCAL_SERVICE_ROLE_KEY` (a JWT) and `SUPABASE_LOCAL_DB_URL`; none is `VITE_`-prefixed, and the artifact returns 0
for each of those shapes (`secret_prefix_with_token_value=0`, `jwt_shape=0`, `privileged_name_service_role_in_dist=0`,
`postgres_url_with_credentials=0`, `private_key_marker=0`). So the sweep now demonstrates that the build-time env
allow-list actually separates the two classes, which is a different and better claim than "no privileged string was found".
`.gitignore:17` (`.env.*`) keeps the file untracked; `git ls-files` for `.env*` returns only `.env.example`.

**24.6 The origin census, and the §22.3 sentence it repaired.** Every absolute URL host baked into the artifact, counted:
`www.w3.org` 23 (SVG namespaces), `github.com` 4, `localhost` 3, `reactrouter.com` 2, `fonts.googleapis.com` 2,
`127.0.0.1` 2, then `wa.me`, `reactjs.org`, `fonts.gstatic.com` once each. `hosted_supabase_origin=0` and, notably,
`localhost:8080` **0** — the three bare `http://localhost` strings are library internals (a React Router origin-reading
default, a gotrue `http://localhost:9999` constant, and supabase-js's trusted-host allow-list, which literally pushes
`"*.supabase.co","*.supabase.in"` alongside `localhost`/`127.0.0.1`/`[::1]`). That allow-list is also the single
`supabase.co` string in the bundle: a wildcard *pattern*, not an origin carrying a project ref. The project's own baked base
URL is `http://127.0.0.1:54400`. Which is why §22.3's "the local config still names only `http://localhost:8080`" was
wrong as written — `localhost:8080` exists only as `supabase/config.toml:68-69`'s auth `site_url` and redirect pattern, a
different knob from the API base, and the paragraph there now says so. What survives the repair is its conclusion: every
origin in every surface is loopback, and no hosted project is named.

**24.7 A second inaccuracy, deliberately not written into the tracked record.** `.env.local`'s header comment claims its
values "OVERRIDE the hosted-project defaults in `.env`", and there is no `.env` to override (measured: `ls .env` → no such
file; only `.env.example` is tracked). The safety property the comment describes is delivered by the file's *absence* plus
loopback values, not by an override. It is an ignored file, so editing its prose would add nothing to the repository's
evidence; it is recorded here so the next reader knows the local config was read rather than recalled, and the comment is
left for its owner.

**24.8 The instrument defect in this section's own probe, corrected before the probe was cited.** `q6-logs/s6-engine-probe-12.log`
first recorded `docker_info_exit=0` and `container_lookup_exit=1`. Both were read off the **end of a pipeline**, so they
were the codes of `head` and `grep` — the same class of fault §22.2a records twice for the build, now caught in a probe.
Re-measured with output redirected and `$?` adjacent to each command: `docker info` → **124, 0 bytes**; `docker ps -a` →
**124, 0 bytes**; `docker version` → **124, 0 bytes**. The engine answers no RPC at all, so the presence or absence of the
`localvivaahvarnam` containers is currently **unobservable, not established absent**, and no residue claim may be drawn
from that file in either direction. Disk across the two readings minutes apart: `C: 476G 473–474G 2.1–2.2G 100% /c`.

**24.9 What this section still does not prove.** A build is not behaviour. No browser has loaded this artifact, no request
has been observed leaving it, no upload has been attempted, no policy consulted, no signed URL minted or expired. The
engine-bound tiers are unchanged in kind — the serial HTTP chain, `stage6/run.sh both` re-measuring 90 + 80 and the historic
suites at this head, the browser tier with its journeys authored and executed in one sitting (§19.7), the A13 operation
spelling (§20.3). §24.4 does add one thing the browser tier can now check cheaply rather than discover: because the bundle's
only baked Supabase origin is loopback, *any* non-loopback Supabase request observed from the built app would be a config
regression rather than an unknown. The probe taken while finishing this section returned 124 again. No merge, no main, no
deploy, no hosted project, no Stage 7.

**24.10 A stale number this section inherited, and the mechanism §11 could not see from the other clone.** The push
read-back for §24 first recorded `origin_main_sha=1b1ef6d… (unchanged, expected 328f0e3fef5a prefix)` — one line
containing both the correct measurement and an incorrect expectation, and the expectation came from session context
rather than from the file. §11 already settled the fact: hosted `main` **is** `1b1ef6d`, the base the Stage 6 directive
named, and `328f0e3` is a stale cache that "says nothing about the server". What §11 could not record is *why* the cache
survives in **this** clone, and the answer is a config value rather than a forgotten fetch:

```
$ git config --get-all remote.origin.fetch
+refs/heads/stage5/pack-driven-authoring-review:refs/remotes/origin/stage5/pack-driven-authoring-review
```

The fetch refspec is pinned to one branch, so `git fetch origin main` refreshes `FETCH_HEAD` but can never update
`refs/remotes/origin/main`, which still reads `328f0e3` here. Consequence for every later stage in this clone: a base or
main comparison must be taken from `git ls-remote` (or an explicit fetch of the ref wanted), never from
`git rev-parse origin/main` or `for-each-ref` — the tracking ref in this working copy is permanently stale by design.
The config was read, not modified, and nothing was rebased, reset or force-pushed: `main` is unmoved, and the only push
in `q6-logs/s6-section24-push-01.log` is the branch fast-forward `0ff4d8c..f6786c6`.
