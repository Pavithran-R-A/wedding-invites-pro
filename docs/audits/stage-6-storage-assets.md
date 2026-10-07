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

## 25. A value-keyed sweep of I10's log surface found what the word sweep could not see (2026-10-07)

**25.1 Why this section exists.** §24.5 reported I10 clean over the artifact, and §19.6 and §22.3 before it did the
same over `src/` and `dist/`. Every one of those sweeps was keyed on *words* — `service_role`, `anon_key`, `eyJ` —
so each could only ever find a secret that someone had chosen to name. Invariant I10 as written in §3's table covers
"a secret that could bypass RLS … in `src/`, `index.html`, `dist/`, **or any log this stage writes**", and the log
surface had never been swept by anything stronger than that vocabulary. This section re-takes it keyed on the actual
credential *values* rather than on their names, which makes the vocabulary question irrelevant: a value match needs no
cooperation from whoever wrote the line. It found one thing.

**25.2 Method, stated because the method is the finding.** The four local credential values were read out of the
gitignored `.env.local` into shell variables and used only as `grep -F -e` patterns; no value, and no prefix of any
value, was ever printed — the logs record name, character length, hit count and file paths. Surfaces: `src/`,
`index.html`, `dist/`, every Stage 6 evidence log, every migration/test/doc, `git grep` over the tracked tree at HEAD,
and every added line in `1b1ef6d..HEAD` (the true base, taken per §24.10). `q6-logs/s6-i10-valuescan-01.log` and
`s6-i10-valuescan-02.log`.

**25.3 The finding, its exposure, and the repair.** `SUPABASE_LOCAL_DB_URL` — the direct PostgreSQL connection string,
whose userinfo carries the local database password and which bypasses RLS more completely than `service_role` does —
appeared in **two of this stage's own logs**, once each, at `q6-logs/s6-g15-storage-start.log:22` and
`q6-logs/s6-g17-start-storage.log:182`. Neither line was typed by a human or pasted deliberately: both are the Supabase
CLI's own start-summary table, captured because the session logged the command that started Storage. That is exactly how
a log-surface leak happens, and it is why the pattern vocabulary never saw it — no line contained the word `secret`.

Exposure measured rather than argued: `q6-logs/` sits outside the repository, so `git grep -F` over every tracked file
at HEAD returns 0 occurrences, the added-line scan over the whole `1b1ef6d..HEAD` range returns 0, and nothing in either
file was ever pushed or attached to a report. The two values that I10 names first — the secret key and the
`service_role` JWT — return 0 everywhere, including in these two logs. Repair: the value was replaced in place with
`[REDACTED_DB_URL]` by a literal-safe `perl -pi` (quotemeta, not regex, so the password's own punctuation cannot cause
an under-match), nothing else in either file was edited, and each file now carries an appended note stating what was
masked, when, and why. **Prevention rule for the engine session, which is the reason to publish this rather than leave
it in a log: raw `supabase start` output must never be written into `q6-logs/` unmasked.** A start capture is the most
likely place in this stage to print a credential, and the next session will run it.

**25.4 The rest of the value sweep, as measured.** After the redaction, over a bounded surface of **436** files
enumerated by explicit directory rather than by recursion: secret key (41 chars) 0 hits, `service_role` JWT (164 chars)
0 hits, direct DB URL (55 chars) 0 hits, publishable key (46 chars) **2** hits — `dist/assets/index-fTteksTz.js` and
`dist/assets/PublicInvitation-BCmmzCTc.js`. Those two names are the same name+hash pair §22.2 and §24.2 certified, so
the sweep provably ran against the artifact this branch describes rather than a rebuilt one, and the only credential in
the bundle remains the class `.env.example:3-5` authorises. The result corroborates §24.4 with a different instrument,
which is worth recording even though it changes no verdict.

**25.5 Two instrument failures, recorded because they were caught late.** The first widened attempt used
`grep -rlF .` from the parent directory and silently began walking `s5qual/node_modules`; the second pruned
`node_modules` but not `s5qual/.git`, and began grepping loose object files. Both were killed rather than allowed to
finish, and `s6-i10-valuescan-02.log` says so at its head. Both were caught because the run took long, **not** because
a number looked wrong — which is the weaker of the two detection paths available. Rule taken from it: a sweep prints
its own file count before it prints any hit, so an unbounded surface is visible in the log even when the run completes.
The same discipline caught a smaller error in this section's companion note: the static census that corroborates 90 and
80 first printed **92** and **82**, because a `grep` for the assertion helpers matches their own `CREATE FUNCTION`
lines as well as their call sites. Corrected in `q6-logs/s6-instrument-audit-01.log`, which now records the
definition-subtracted counts: registry 6 ok + 84 eq = **90**, policies 2 ok + 78 eq = **80**.

**25.6 The instrument question §25.5 was chasing, answered: there is no gap.** The worry was legitimate — `run.sh`
pins no absolute assertion total anywhere, and its `lines` style only checks that a suite's reported number equals the
PASS lines it printed, which a short-but-internally-consistent run would satisfy. It is answered inside each battery.
`80_asset_registry.sql:738` refuses below 89 and `90_storage_policies.sql:776` refuses below 79, and because the
counter increments only on a pass while a failed assertion raises and aborts its `DO` block (which makes `psql` exit
non-zero, which the runner hard-fails on), the counter can only be low because an assertion stopped running. Each floor
is one below its own measured total *including* the floor's own `L1` line, so exactly one assertion — the floor's own,
which cannot go missing without the block failing — sits outside its reach: 88 of 90, or 78 of 80, trips it. Stage 6's
two suites are registered with style `lines` (`run.sh:209`), so the floor, the runner's equality cross-check and the
call-site census pin 90 and 80 three ways. This is a confirmation, so per §22.7 it is not the reason this section
became a head — §25.3 is.

**25.7 What still has no answer.** All of it is the engine, and probe 15 is now fifteen for fifteen:
`docker_info_exit=124`, `docker_ps_exit=124`, both with 0 bytes of output
(`q6-logs/s6-engine-probe-15.log`). Disk is worse than the last reading in this file: `df -k /c` reports
**593,304 KB free of 498,133,316** at 100 % used, against the 2.1–2.2 GB §22 recorded — and that figure is itself
already overtaken. The two node runs this section then went on to execute (`q6-logs/s6-final-head-gates-05.log`,
`s6-final-head-build-05.log`) took it to **518,516 KB** and then **462,296 KB**, roughly 18 MB per production build,
none of it reclaimed. So the trend within one hour of writing is −131 MB, and it is node work, not the missing engine,
that is consuming it. That does not change the boundary — I will not prune a shared volume or delete another project's
data — but it does change what restarting Docker Desktop will require, it bounds how many more gate sets this machine
can certify, and it belongs in the one human-only action this stage is waiting on rather than in a silent retry loop.

## 26. The security tier taken statically, and the one published claim about the confirm edge it did not survive (2026-10-07)

**26.1 What this section is, and what it is not.** The objective asks for a security gate, and probe 16 (`q6-logs/s6-engine-probe-16.log`,
`docker_info_exit=124`, `docker_ps_exit=124`, both with 0 bytes) keeps every HTTP, SQL and browser tier waiting on the engine. Five of the
six questions a security review of this stage raises can be answered by reading the code and the DDL, so they were. Two things this
section is not: it is not an *independent* review — the delegated reviewer never produced a report, for the reason in §26.5, so the same
agent that wrote the adapter read it — and it is not a substitute for any gate. Evidence lines, file citations and the two open
measurements live in `q6-logs/s6-security-review-static-01.log`; this section carries only what it concluded. The review was read-only:
`git status --short` before and after it showed the same two external untracked files and nothing else.

**26.2 The six questions, and where each one closed.**

* *Can browser code reach a privileged credential?* No. `src/integrations/supabase/client.ts:4-5` reads exactly `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`, and a grep of every `import.meta.env` reference in `src/` returns those two names and nothing else;
  Vite only exposes `VITE_`-prefixed keys, so an un-prefixed secret cannot leak by omission. `weddingAssets.ts:46` imports that client and
  no other. §25.4's value-keyed sweep already proved the same thing from the other direction.
* *Can a client influence a server-assigned or immutable column?* No, and the interesting case is closed twice. A presented `object_key`
  is refused with 42501 (`20261006120000…sql:61-64`) before the mint overwrites it (`:74`); an INSERT that claims anything but `staged`
  is refused (`:65-68`); `object_key`, `wedding_id` and `asset_kind` are each refused on UPDATE (`:106-114`); `tombstoned` is terminal
  (`:129-131`) and `ready` may only move to `tombstoned` (`:133-135`); and a no-state-change write that re-describes `mime_type` or
  `size_bytes` on a ready row still meets the verification (`:121-126`), which closes the "true at confirmation, edited into a lie
  afterwards" route. The segment the mint interpolates is not free text: `asset_kind` is CHECKed to five literals
  (`20260925120400_stage2_assets_entitlements_secrets.sql:14-15`) and `object_key` is CHECKed against a leading `/` and against `..` in
  the same DDL, so no traversal shape reaches the path at either layer.
* *Public-URL construction?* None. `getPublicUrl` appears nowhere in `src/` or `index.html`; the only storage URL call is
  `createSignedUrl(objectKey, 60)` (`weddingAssets.ts:168`), whose result is never written to a row, a snapshot or a projection
  (`ASSET_COLUMNS`, `:59-60`), and the bucket is inserted with `public = false` (`:30-33`).
* *Swallowed upload errors, and the orphan ordering?* The order is the only one the two guards accept, which is checkable statically:
  `upsert: false` (`:256`) against a table with no UPDATE policy (`:275-278`), and tombstone, collect bytes, delete row (`:344-356`)
  against a DELETE policy that needs `tombstoned` (`:263-273`) and a delete guard that refuses while the object resolves (`:207-212`).
  No storage failure is dropped silently: each both logs and returns a host-readable sentence (`:113-116`, `:257-259`, `:376-379`), and
  the 42501 on the confirm edge is translated rather than surfaced as a permission error (`:283-286`).
* *GRANT versus RPC parity — can the adapter actually do what it claims?* Yes for all seven calls. Table-level `SELECT`
  (`20260925120500…:26-46`) covers `object_key`, so the post-insert read-back is servable; `INSERT`/`UPDATE`/`DELETE` are granted at
  `:50-61` after `REVOKE ALL ON ALL TABLES` at `:19`; four policies exist for exactly those verbs and only to `authenticated`
  (`:311`, `:316`, `:321-328` with both `USING` and `WITH CHECK`, `:330`), each binding on `w.owner_user_id = auth.uid()`. Grants are
  table-level rather than column-level, so there is no hidden column grant that could starve a legitimate write. The three trigger
  functions are EXECUTE-revoked per object (`:84`, `:189`, `:219`), which the measured `anon_exec_mint=true` default made necessary and
  which costs the flow nothing because a trigger needs no EXECUTE from the writing role.
* *Does the UI call an upload ready before the database did?* No. `WeddingAssetsPanel.tsx:58-59` renders "Stored." only for
  `upload_status === 'ready'`, the preview control is disabled otherwise (`:236`), inline media renders only under the same condition
  (`:243`), and the adapter module is imported by the panel and its unit suite alone — `PublicInvitation.tsx:32`'s `{ kind: 'ready' }` is
  that page's own load phase, unrelated to `upload_status`, so the guest route cannot reach this code.

**26.3 The claim that did not survive: I4's type half may be comparing one client value against itself.** The confirm edge compares the
row's `mime_type` against the object's recorded `metadata->>'mimetype'` (`:150-156`, `:172-176`) and the migration explains that it does
so in order to claim that "a row that records `image/png` while the stored object is something else" is caught "against the bytes rather
than trusted" (`:167-171`). But the adapter fills *both* sides from a single client-supplied value: `putObject` sends
`contentType = draft.mimeType` (`weddingAssets.ts:256`) and `registerAsset` puts the same `draft.mimeType` in the row (`:238`). If the
storage service records the **declared** header, then for TYPE the comparison is client-value against client-value and the sentence
overstates the mechanism — an SVG or HTML payload declared as `image/png` would satisfy the row claim and the recorded metadata
together. `size` is not exposed the same way, because the recorded length is measured from real bytes. This is not a published falsehood:
`80_asset_registry.sql:10` already labels its `storage.objects` rows a stand-in, so the SQL battery never claimed to prove where the
metadata comes from, and §2's open-item table (`:132`) already lists whether `allowed_mime_types` is honoured locally as it is hosted. It
is an unproven claim about a mechanism, and the review deliberately did not edit the comment on the strength of a guess. M1 in
`q6-logs/s6-engine-runbook.md` §6 measures it in one upload and then chooses between three outcomes: leave the comment, weaken it to what
the mechanism does, or add a battery case. M2 there asks the adjacent question the adapter itself flags at `:204-206` — whether a refused
upload can leave partial bytes at the minted key, which would turn a legal staged-row delete into an O1 orphan that reports itself as
"the asset record could not be removed".

**26.4 No code was repaired by this review, and that is the finding.** Not because nothing was found — §26.3 is a real gap in what the
comment proves — but because the fix depends on which layer answers first, and repairing an unmeasured behaviour is the one thing the
standing rule forbids. The adapter's own honesty line (`:41-44`) still stands, and this section widens rather than narrows it: the module
has still never called a running stack.

**26.5 Why the review was not independent, recorded as an instrument result.** The delegated reviewer (`agentType ecc:security-reviewer`,
task `a74606c4f893c3edd`) could not deliver a report on this host: its transcript path
`…/subagents/agent-aecc:security-reviewer-604b0e57c0d51470.jsonl` contains a colon, Windows cannot create such a file, the directory held
a 0-byte entry named `agent-aecc`, the `tasks/*.output` symlink pointed at a non-existent target, and `task-*.json` never left
`status:"running"` (`updatedAt` was `createdAt` plus 216 ms). The task was stopped and the six questions were answered in the main agent.
The consequence belongs in the verdict: this tier is *self*-review, and an independent pass over the same six questions is still owed —
by a non-plugin agent type or by a human — before Stage 6 can call its security gate closed.

**26.6 Certification posture for this head, and the constraint that shaped it.** §22.7 asks a docs-only head to be certified by re-taking
the gate set at it. Five gates are re-taken here (`typecheck`, `product:check`, `dbtypes:check`, `lint`, `test`); the production build is
not, because this commit touches only `docs/audits/stage-6-storage-assets.md`, which `git show --stat` in the certification log proves, so
the `dist/` identity measured at `5731b35` (`asset_count=30 ref_count=30 differing_entries=0 certified_dist_files=33`,
`q6-logs/s6-section25b-cert-01.log`) carries forward by construction rather than by re-measurement. The reason is the drive, not
convenience: `df -k /c` read **319,012 KB free of 498,133,316, 100 % used** when this section was written, against the 449,012 falling to
410,692 KB that the certification run at `5731b35` recorded minutes earlier — roughly 90 MB gone with no build of mine in it. A build
costs about 18 MB, and an `ENOSPC` in the middle of a gate would produce an invalid attempt that then has to be disclosed and re-measured,
costing more than it saves. Note also that the tree is currently a **pnpm** tree (`node_modules/.modules.yaml` and `node_modules/.pnpm`
present, `vite` a symlink): the same external installer that re-drops the byte-identical `pnpm-lock.yaml` + `pnpm-workspace.yaml` pair
converted it after `5731b35` was certified. That pair remains untracked and unstaged here, as it does everywhere else in this stage.

**26.7 Correction to §26.3's open-items list, found by reading the HTTP battery instead of the adapter's comment.**
§26.3 ended with two measurements the engine supposedly owed, and it drafted them from the adapter's own uncertainty
markers (`weddingAssets.ts:204-206`) rather than from the battery that had already gone and checked them. Re-reading
`supabase/tests/api/stage6_storage.test.mjs` changes both halves, so the correction is published rather than the
original left standing.

*The orphan question is mostly closed already, and it was closed by an assertion, not by hope.* **UPL-04** (`:557-581`)
registers a staged row with a disallowed `mime_type` claim, PUTs real PNG bytes under that declaration in each of three
spellings, and asserts the bucket's `415 InvalidMimeType` **and** `objectPresent(row.object_key) === false` at `:572`,
then that the confirmation answers `42501` with `no stored object exists at …` and that the row is still `staged`.
**UPL-05** (`:583-597`) does the same for the ceiling: one byte over, `EntityTooLarge`, and `objectPresent(...) === false`
at `:592`. So the shape §6/M2 worried about — a refused upload leaving bytes so that the staged-row delete trips the
delete guard and reports itself as "the asset record could not be removed" — is measured against for both refusal
classes the product can produce at the bucket, and the answer is that nothing is left behind. What is genuinely still
uncovered is narrower: a refusal that arrives *mid-stream*, after bytes began reaching the service. Nothing in the
battery contradicts the adapter's worry and nothing confirms it; it needs a client-injectable fault, and it is recorded
in `q6-logs/s6-engine-runbook.md` §7 as the lower-priority of the two rather than dropped.

*The MIME question survives, and reading the battery made it sharper rather than softer.* **UPL-04 tests one direction
only**: the declared type is *disallowed* while the bytes are real PNG, which the bucket refuses. It never tests the
direction that invariant I4 and the blueprint's "no user-supplied SVG or HTML" rule actually depend on — a request that
declares an **allowed** type (`image/png`) over bytes that are HTML or SVG. If the storage service records the declared
header, that upload is accepted, the row's `mime_type` claim matches `metadata->>'mimetype'` because both are the same
client value (`weddingAssets.ts:238` fills the row, `:256` sends the header), the pair reaches `ready`, and the payload
is markup served under a signed URL that calls itself a PNG — in which case the migration's "refusing the type at the
bucket is stronger than sanitising it later" (`20261006120000…sql:37-38`) and "checked against the bytes rather than
trusted" (`:167-171`) both overstate what the design enforces. If the service sniffs, both sentences are exactly right.
This is now the single measurement that decides the section's verdict, it is one PUT with the helpers that already
exist, and its three outcomes (refused by the bucket / accepted and confirmable / accepted but caught elsewhere) are
written out in run-book §7 so the engine session cannot mistake the middle one for a pass.

*Nothing was edited in anticipation of the answer.* No comment in the migration, no sentence in the readiness copy, and
no battery case was changed by §26 or by this correction, because each of those edits is only honest after the PUT has
been made and its refusal or acceptance read.

**26.8 The disk reading that made the build omission a rule rather than a preference.** The five gates re-taken at
`0d3d6a8` (`q6-logs/s6-section26-cert-01.log`) consumed **306,044 → 231,900 KB** of free space on `C:` on their own —
about 74 MB per gate set, most of it in the last two gates — and the drive fell another ~5 MB in the minute after the
run finished with no command of mine executing. At that slope the production build this head deliberately omits is not
a saving but a necessity: it would need its own ~18 MB plus output, and an `ENOSPC` in the middle of a gate produces an
invalid attempt that has to be disclosed and re-measured, which costs more than it spares. Recorded here because the
omission in §26.6 is a judgement about the machine, not a relaxation of the convention.

## 27. The independent security pass finally ran, what a second reader confirmed, and the one inference it made that the battery has not measured (2026-10-07)

**27.1 The instrument worked this time, and that is the finding §26.5 said it owed.** §26.5 recorded that the
delegated reviewer had produced no report because Windows forbids `:` in a filename while plugin-scoped agent
transcripts are named `agent-<plugin>:<agent-type>-<id>.jsonl` — the file existed only as a 0-byte truncated
`agent-aecc` and its task record froze at `running`. This pass used a **non-plugin** agent type, whose transcript
name contains no colon, and it delivered: `duration_ms=211236`, `tool_uses=20`, six questions and both open items
answered from the files. It was briefed read-only, told the engine was down so anything needing the stack must be
marked UNPROVEN rather than guessed, and told not to run npm, vitest, builds, docker or git writes because the §26
certification was executing concurrently. `git status --short` after it showed the same two external untracked
`pnpm-*` files and nothing else. Full report and my per-item verdicts: `q6-logs/s6-security-review-independent-01.log`.

**27.2 It independently confirmed all six questions, and answered one of them better than §26 did.** Q1 (credential
surface), Q2 (client-influenced server-assigned columns), Q3 (no public URL, signed URL never persisted), Q4 (error
swallowing and removal order), Q5 (grants versus policies) and Q6 (the panel never claims `ready` early) came back
VERIFIED at the same lines §26.2 cites, reached without reading §26 first. Its Q5 is the stronger argument of the
two: §26.2 argued from the DDL that revoking `EXECUTE` on the three trigger functions costs nothing, whereas this
pass pointed at battery cases that *already run as* `authenticated` and succeed (`80_asset_registry.sql:228`, `:390`,
`90_storage_policies.sql:193`) against the case that asserts `authenticated` holds no `EXECUTE` on any of the three
functions (`90:303-312`). That is behaviour as evidence rather than DDL as reasoning, which is this audit's usual
standard, so it replaces my formulation.

**27.3 Its three findings, checked against the files, produced no new proven defect.**
*(1, medium)* the confirm edge's type half may compare one client value against itself — **this is §26.3 and M1,
reached independently**, which is the useful part: a second reader with no stake in the adapter's design landed on
the same unproven sentence in the migration (`20261006120000…sql:167-171`, `:37-38`). *(2, low)* `weddingAssets.ts:207`
cleans a failed upload with `deleteRow` alone, so a refused upload that left bytes would produce the delete guard's
"still in storage" refusal and the host would read a misleading sentence. Verified in the file — and **already
disclosed by the code's own comment at `:203-206`**, which names exactly that consequence. It is reachable only
through M2's mid-stream abort, so §26.4's discipline holds: no repair on an unproven condition. The repair it
proposed (`retirePair` for `deleteRow`) was checked and is safe whether or not bytes exist — `staged → tombstoned`
is legal (`20261006120000…sql:127-135` blocks only tombstoned-onward and ready-sideways) and a Storage `DELETE` over
an absent key is the measured 200-with-`[]` — so it is the pre-named fix if the fault-injection case shows a partial
object. *(3, low)* `is_generated` and the full `asset_kind` vocabulary including `generated_output` are client-writable
(`20260925120400_stage2_assets_entitlements_secrets.sql:14-15`, `:25`). Verified, then graded down by two facts it
could not have known: nothing in `src/` reads `is_generated` (only `types.ts:828`/`:841`/`:854` and
`src/test/weddingAssetUploadRules.test.ts:282-284`, which asserts the adapter forwards the kind), and §19.3
(`:895-896`) says the platform "*would*" produce such a derivative — conditional presentation, not a claim of
enforcement. No published sentence is contradicted and no user-visible state is forged, so this is a Stage 2 schema-
governance note carried forward, not a Stage 6 defect.

**27.4 The one place where the independent reasoning overreached, and it is the place that matters.** It writes that
UPL-04 "proves the bucket decides MIME on the declared header", therefore markup declared `image/png` "**would** be
accepted". What UPL-04 (`stage6_storage.test.mjs:557-581`) measures is that a *disallowed declaration is sufficient to
refuse* — real PNG bytes under `text/html` answered `415`. That does not establish that an allowed declaration is
sufficient to *accept*, because a service may gate on the header and additionally sniff on the write path; the two
propositions are different, and only the second one makes the confirm edge's type half self-comparing. Its own closing
line concedes byte-sniffing is UNPROVEN on this host, so the overreach is in the sentence, not the conclusion. This is
exactly the gap `UPL-07` in `q6-logs/s6-m1-upl07-draft.md` was written to close, and it is why that draft's expected
values are three outcomes rather than one.

**27.5 The pass settled a severity question §26 had left implicit: even in the bad case, this is integrity, not XSS.**
It traced where asset bytes can land. The only consumer is `WeddingAssetsPanel.tsx:269-277`, an `<img src>` or an
`<audio src>` chosen by `inlineMedia(asset.mimeType)` — never `innerHTML`, and the label at `:272` is React-escaped.
The app's single `dangerouslySetInnerHTML` (`src/pages/EditProject.tsx:851`) is fed by `sanitizeSvg(design.previewSvg)`
at `:613`, a platform template rather than a wedding asset. So if M1's accepted-and-ready branch is what the engine
finds, the sentence to change is "refusing the type at the bucket is stronger than sanitising it later" — a claim about
which layer enforces a type — not a claim that markup could execute. That distinction is what the repair has to be
measured against, and it was not in §26.

**27.6 Five structural reasons the audit had not stated, all verified here, none of them a hole in Stage 6.**
Cross-wedding key squatting is impossible because of the *content* of the minted prefix — an owner-checked `wedding_id`
plus the row `id` — together with `object_key UNIQUE` (`20260925120400…:19`); §26.2 argued only that a presented key is
refused. The `..` and leading-slash CHECKs (`:20-22`) catch neither a single `.` segment nor a `%2e%2e` spelling, so
they are belt-and-braces whose real protection is that no surface accepts a client key — a note for any future surface.
A signed URL is a bearer artefact for its 60 s and hands the bytes to any holder regardless of RLS; it is never
persisted (`WeddingAssetsPanel.tsx:97`, `:211`) and the panel's own copy says so (`:279-280`), but "never stored" was
never a claim about reuse inside the TTL, and this is the honest limit of the mechanism. `label text` (`:16`) has no
length CHECK, so an owner can write a long label to their own row — storage hygiene, carried forward with the
`is_generated` note, no injection. And the two-host race surface is empty for a reason §26 never gave: the registry
policies bind a wedding to a single `owner_user_id`, so only one account can ever hold a given row writable.

**27.7 Net effect on the stage.** The security tier is no longer a self-review — the disclosure in §26.1/§26.5 is
closed. No new defect was proven, so nothing was repaired, and the two measurements that decide the remaining open
question (`UPL-07` for M1, a fault-injection case for M2) are unchanged and still engine-blocked, along with the HTTP,
SQL and browser tiers. Probe 17 (`q6-logs/s6-engine-probe-17.log`, `timeout 10 docker version` → `124`) is the
seventeenth consecutive unanswered engine probe, and free `C:` fell from 306,044 KB to 130,764 KB across §26's and
§27's work while my own commands were the only ones running against it.

## 28. §27's certification gap is closed, and the engine diagnosis got a second, corrected reading (2026-10-07)

The human took the two machine actions §27 had to escalate (`q6-logs/s6-section28-cert-01.log` addendum: restart
Docker, free `C:`). This section records what each produced, measured rather than assumed, and one correction to a
reading taken in the middle of that work.

**28.1 Disk freed; it is volatile, and none of it is ours.**
`free C:` went 171,812 KB (probe 17) → 253,216 → 464,168 KB by 12:53 UTC. It then fell to 204,444 KB at the start of
the re-certification run and rose to 478,988 KB by the end of that same run (`q6-logs/s6-section28b-testcert-01.log`).
Two of my own commands overlap that window — `npx supabase --version` had to download the CLI (2.120.0; nothing named
`supabase` is on this host's `PATH`, so every call pays it) while vitest ran — but the swings are larger than either
explains, which is the same external consumption §26.8 measured. `df`'s `%USE` column still reads 100 because 464 MB of
498 GB is 0.09 %. Consequence unchanged: the graduated floor in `s6-section28-cert.sh` stays, and a gate counts only if
it actually ran.

**28.2 The one gate §27 recorded as not certified is now certified at the same head.**
`npm run test` at `2aecb11` gave `gate_exit_code=0`, `Test Files 31 passed (31)`, `Tests 466 passed (466)`,
`Duration 116.15s`. `local_equals_remote=YES`, `worktree_tracked_changes_at_end=0`, and the two untracked pnpm files
were never staged. §27's head therefore now stands at **five of five node gates green**, and the sentence "the `test`
gate is NOT certified at 2aecb11" is superseded by this one — §27 is left in place untouched, because it recorded the
state honestly at the time it was written. The capture was scanned for privileged *values* before it entered
`q6-logs/`: `SUPABASE_LOCAL_SECRET_KEY` (length 41), `SUPABASE_LOCAL_SERVICE_ROLE_KEY` (164) and
`SUPABASE_LOCAL_DB_URL` (55) each scored `lines_with_hit=0`, as did the `postgresql://` shape —
`privileged_value_hits_total=0`, so the raw file is I10-clean and was kept as `s6-section28b-test-raw.log`.

**28.3 A structural correction to what is actually blocked, found by reading the runner rather than the run-book.**
`supabase/tests/stage6/run.sh:44-47` starts its **own** throwaway cluster (`postgres:16-alpine`, container
`vivaahvarnam-stage6-$$`) and its header states the boundary: plain Postgres plus the RLS bootstrap and the storage
fixture. So the SQL tier needs *an engine*, not the `localvivaahvarnam` Supabase stack — it was wrong to lump it in
with the HTTP and browser tiers, which do need `supabase start`. The runner's escape hatch is
`STAGE6_LOCAL=1` against an already-running cluster, but that path needs `psql`, and `psql` is absent both from the
host `PATH` and from WSL Ubuntu. Installing a system dependency was not done silently. Net: 90/80 registry-and-policy
and the historic stage2–5 suites remain blocked, but on the narrower and cheaper condition of a working engine only.

**28.4 Where the engine actually is.** `com.docker.backend` and `Docker Desktop` are running with `StartTime`
6 Oct 15:10 — i.e. the backend was **not** recycled by the restart. The `docker-desktop` WSL distro, which is that
backend's VM, reports `State: Stopped` while `Ubuntu` reports `Running`. The CLI is healthy on both sides (WSL's
reports 29.8.1; `docker context ls` answers and shows `desktop-linux*` on
`npipe:////./pipe/dockerDesktopLinuxEngine`, so no stale `DOCKER_HOST`), and `docker context ls` reads only local
config, so it is not engine evidence. Every command that does contact the daemon times out: host `docker version` 90 s
→ 124, host `docker ps` 60 s → 124, and from inside WSL `docker version` → `code=124`, `docker ps` → `code=124`. One
`docker ps` did answer earlier (`exit=0`, header row only, zero containers) — the only engine reply in eighteen probes.
The weakest reading the evidence allows: a VM that is stopped, not a socket or naming fault on this side; consistent
with the stack having been lost rather than merely paused.

**28.5 Correction, because two of these numbers were first read wrongly.** The WSL probe was initially written as
`… | head -8; echo "exit=$?"`, which reports `head`'s status, not docker's — and it printed an empty `server=` field
that looked like a successful version query. Re-run with the code captured adjacent to each command (§ the standing
rule, and `s6-engine-runbook.md` §0's own instruction) gave the `code=124` values above. Recorded here because the
same pipeline-tail reading, left uncorrected, would have made the engine look reachable and this stage would have
published a tier that never ran.

**28.6 Instruments staged for the engine sitting, so it is executed rather than designed.**
`q6-logs/s6-stack-start-masked.sh` makes §1 of the run-book executable: the raw `supabase start` output goes to `/tmp`,
is masked by both structure (`postgresql://`, JWT-shaped, the summary table's `URL` row) and the three privileged
*values*, and only then may a copy enter `q6-logs/` — the script prints hit counts and exits 7 rather than keeping a
log that carries a credential. `q6-logs/s6-m1-upl07-draft.md` is the paste-ready M1 case with its three outcomes
pre-named; §8's warning stands that it must not be applied while a head is being certified, and this head's
certification is what §28.2 just completed.

**28.7 Net effect on the stage.** The node tier at the published head is complete: `2aecb11` is five-gates green with
remote equal to local. Nothing new was proven about the implementation, so nothing was repaired. Blocked on the engine
alone: the SQL batteries (90/80 plus historic stage2–5), the HTTP tier, `UPL-07`/M1, the `pg_roles` measurement §5
requires before §25.3's recalled ranking can be corrected, and the browser tier with its four network observations.
The boundary is unchanged — no merge, no `main`, no deploy, no hosted Supabase, no Stage 7.

## 29. The published head is five gates green, and nineteen engine probes finally got a root cause (2026-10-07)

**29.1 §28's head is certified.** `2b0d101` (`1 file changed, 66 insertions(+)`, the audit alone) gave
`typecheck`, `product:check`, `dbtypes:check`, `lint`, `test` all at `gate_exit_code=0`;
`Product contract OK — 185 active file(s) scanned, 0 violation(s)`; `Database contract OK — 20 migration
file(s)`, `19 public + 10 non-client table(s)`, `34 query column group(s) reconciled, 0 finding(s)`;
lint `9 problems (0 errors, 9 warnings)`; `Test Files 31 passed (31)` / `Tests 466 passed (466)`;
`local_equals_remote=YES`, `worktree_tracked_changes=0`, the two pnpm files still unstaged and untracked.
Evidence: `q6-logs/s6-section29-cert-01.log` and `q6-logs/s6-section29-test-raw.log`.

**29.2 The instrument lied once and was re-measured rather than believed.** In that first run the test gate
printed `gate_exit_code=0` but its capture (12,900 bytes) ended at the last per-test line with **no
`Test Files / Tests / Duration` summary** — compare 19,037 bytes with the block at `2aecb11` minutes
earlier. A zero exit code does not carry a count, and the counts are what this audit cites. No `FAIL`
line and no non-zero code appeared in either capture, so it is classified as a truncated-report gap
during a violent disk swing, not a test failure; the gate was re-run alone (free `C:` 938,384 KB) and gave
`code=0` with `31 passed (31)` / `466 passed (466)` in 111.16 s. The first capture is recorded as a gap,
not used as evidence.

**29.3 Disk, restated because the picture changed.** Free `C:` over one sitting: 464,168 → 204,444 →
353,684 → 478,988 → 230,176 → 944,552 → 1,556,328 KB. It roughly tripled with nothing of mine releasing
it, so §26.8's "we are the ones consuming it" reading was wrong for the upward direction: this is a shared
host whose pressure moves both ways. The graduated floor stays — it costs nothing and it is what caught
§27's gap — but the earlier framing that the gate set is the driver is corrected here.

**29.4 Root cause of the nineteen probes, located inside the VM.** After the human's restart, the engine
still answered nothing, and the diagnosis got three layers deeper:
- `wsl --start -d docker-desktop` is rejected by this WSL build; starting the distro by *invoking* it
  works, and `wsl -l -v` then reports `docker-desktop  Running` — so the VM filesystem comes up on demand.
- With the VM up, five more `docker version` polls over ~2.5 minutes all gave `code=124`, and inside the
  VM: `ps -ef | grep -E 'dockerd|containerd|vpnkit'` matched nothing, and `/var/run/docker.sock` does not
  exist there. **The engine VM is alive with no daemon running in it.**
- `com.docker.backend` and `Docker Desktop` have `StartTime` 6 Oct 15:10 — the supervisor that launches
  `dockerd`, `vpnkit` and the Windows named-pipe binding was never recycled, which is exactly the failure
  mode nineteen `exit=124` probes describe. The CLI is healthy on both sides (WSL reports Docker 29.8.1;
  `docker context ls` answers and shows `desktop-linux` on the expected pipe, and Ubuntu's
  `/var/run/docker.sock` exists but is the same dead path).
Four repairs were considered and refused: hand-starting `dockerd` inside Docker Desktop's own VM would
produce an engine with no port forwarding and no pipe binding on a host another project shares;
`wsl --shutdown` recycles the Ubuntu distro too; pruning Docker storage and deleting another project's
data remain refused; and installing a system Postgres for the runner's `STAGE6_LOCAL=1` path would both be
a silent system dependency and a different server build than the `postgres:16-alpine` the batteries were
written against. What is needed is a real Docker Desktop engine restart from the GUI — a human action.

**29.5 Stage position.** Node tier: complete at the published head. Blocked on §29.4's single cause: the
SQL batteries (90 registry / 80 policy, plus the historic stage2–5 suites), the HTTP tier, `UPL-07`/M1, the
`pg_roles` row §5 requires before §25.3's recalled ranking can be replaced, and the browser tier with its
four network observations. No repair was made in this section — nothing new was proven about the
implementation, and the only defect-class candidate (M1) has its instrument staged at
`q6-logs/s6-m1-upl07-draft.md`, unapplied, waiting for an engine. Boundary unchanged: no merge, no `main`,
no deploy, no hosted Supabase, no Stage 7.

## 30. The §29 head is certified, run-book §4's closure scan is done, and the engine is down to one human click (2026-10-07)

**30.1 Certification of `d30fe0a`** (`1 file changed, 52 insertions(+)`, the audit alone): all five gates
`gate_exit_code=0` — `Product contract OK — 185 active file(s) scanned, 0 violation(s)`;
`Database contract OK — 20 migration file(s)`, `19 public + 10 non-client table(s)`, `34 query column group(s)
reconciled, 0 finding(s)`; lint `9 problems (0 errors, 9 warnings)`; `Test Files 31 passed (31)` /
`Tests 466 passed (466)` in 119.04 s, this time with `test_summary_present=YES` from the guard §29.2 earned.
`local_equals_remote=YES`, `worktree_tracked_changes=0`, the two pnpm files still untracked and unstaged.
Evidence: `q6-logs/s6-section30-cert-d30fe0a.log`. Free `C:` was 1,235,588 KB at the start and 1,218,600 KB at
the end — the gate set cost about 17 MB, consistent with §26.8, on a disk whose free space had meanwhile
roughly tripled from outside this repo.

**30.2 The extended-range added-line scan (run-book §4's closure item) ran without an engine.**
`1b1ef6d..d30fe0a` = 7,374 added lines. Against the four privileged values from `.env.local`:
`SUPABASE_LOCAL_SECRET_KEY` (41) → 0, `SUPABASE_LOCAL_SERVICE_ROLE_KEY` (164) → 0, `SUPABASE_LOCAL_DB_URL`
(55) → 0, `VITE_SUPABASE_PUBLISHABLE_KEY` (46) → 0; and 0 connection-string lines, 0 JWT-shaped strings, 0
`Bearer <20+>` strings in added source. The one non-zero count is the *word* `service_role`, 75 added lines,
and it was characterised instead of waved away: 44 in `supabase/tests/stage3/30_publication.sql`, 18 in this
audit, 6 in `supabase/tests/stage6/00_storage_schema.sql`, 4 in `90_storage_policies.sql`, 3 in the Stage 6
migration — every one of them the Postgres role name inside `GRANT`/`REVOKE` or prose naming invariant I10.
A role name is not a secret; the secret is the JWT, and that shape scores 0. A deliberately wider pattern
(`service_role` assigned to a 20+ char run, or `eyJ`) did match 4 lines, and reading them with every ≥20-char
run masked showed all four are this audit *listing its own sweep pattern names* (`eyJhbGciOi`, `postgres://`,
`…?token=eyJ`) — prose about patterns, not patterns' payloads. Evidence and the stated limits (committed added
lines only; two uncommitted `q6-logs/` files still carry expired 60-second signed-URL tokens from an earlier
HTTP run; a value added and later removed inside the range would not appear):
`q6-logs/s6-i10-extension-scan-05.log`.

**30.3 Engine.** Probe 21 at 13:41 UTC: `docker version` → `code=124`. The human has chosen the fix
(quit and relaunch Docker Desktop, which is the only action that recycles `com.docker.backend` and starts
`dockerd` inside the VM it owns); `Get-Process` still shows that process at StartTime 6 Oct 15:10, so the
relaunch has not happened yet. Nothing was started by hand inside the VM and `wsl --shutdown` was not used —
see §29.4 for why both were refused.

**30.4 Stage position, stated as gaps rather than as a verdict.** Complete: node tier at the published head;
the static security tier and its independent pass (§26, §27); the I10 log-surface work including this
extended-range scan. Still open, all behind §30.3's one cause: the SQL batteries at this head (90 registry /
80 policy plus historic stage2–5), the HTTP tier, `UPL-07` for M1, the `pg_roles` row that must replace
§25.3's recalled ranking, the A13 `allow_only_operation('object.list')` spelling, and the browser tier with
its four network observations. Stage 6 is therefore **not** fully qualified, and this section says so rather
than letting the certified tiers imply otherwise. Boundary unchanged: no merge, no `main`, no deploy, no
hosted Supabase, no Stage 7.

## 31. The artifact the browser tier needs was rebuilt and re-matched, and one deletion of my own caused it (2026-10-07)

**31.1 Why `dist/` was missing.** During the 0-KB disk emergency (§26.8, §28) I reclaimed my own
`s5qual/dist` — 1,074 KB. That was legitimate at the time and it is the certified artifact's directory,
so the browser tier's target had to be restored. Stated plainly because the audit's earlier habit note
("build to a throwaway `--outDir` so the certified `dist/` is never overwritten") was written precisely to
protect an artifact that was later deleted outright: the constraint is not *overwriting* it, it is that the
browser tier cannot run against an absent build.

**31.2 Rebuild at `dbd8e60`, engine-free, and it matches §22 exactly.** `npm run build` → `build_exit=0`
(read adjacent), `built in 50.61s`, `dist_file_count=33` — the same count §22 certified — and the 30 bare
asset names under `dist/assets` compared with `comm -3` against `q6-logs/s6-g4-asset-names.txt` gave
`diff_count=0`. Chunk names *and* content hashes therefore reproduce, which is the same identity claim §22
made about the artifact at that head. `worktree_tracked_changes=0` (`dist` is gitignored, `.gitignore:11`).
Net disk cost of this build was 2,244 KB (1,334,936 → 1,332,692) because the vite cache was already warm,
so §2's "≈18 MB per build" is the cold number, not the warm one. Evidence:
`q6-logs/s6-dist-rebuild-dbd8e60.log`.

**31.3 I10 re-taken on the rebuilt artifact.** `q6-logs/s6-i10-valuescan.sh` again, output
`s6-i10-valuescan-05.log`: the three privileged values (41, 164 and 55 characters) score **0** on every
surface — `src/`, `index.html`, `dist/`, `q6-logs/`, tracked-at-HEAD and added-lines. The publishable key
(46) scores `dist_files_with_hit=2` and nothing else, which is §24's designed exception, not a new finding.
The trailing counts (`SECRET_KEY` 2 files, `SERVICE_ROLE` 12, `DB_URL` 2) are *variable names* in scripts,
docs and CI, each with a value-hit of 0.

**31.4 Certifications landed this sitting.** `2b0d101` → §28.1; `d30fe0a` → §29.1; `dbd8e60` → all five
gates `gate_exit_code=0` with `Test Files 31 passed (31)` / `Tests 466 passed (466)` at 121.99s,
`test_summary_present=YES`, `local_equals_remote=YES`, `worktree_tracked_changes=0`
(`q6-logs/s6-section31-cert-dbd8e60.log`). Each head was pushed immediately with an explicit refspec and
read back; hosted `main` stayed at `1b1ef6dcc6c7893c42afc29787e3724ab062eb1b` at every check.

**31.5 Still one blocker, unchanged and human-sited.** Probes 21–23: `docker version` → `code=124` at
13:41, 13:46 and 13:50 UTC, and `Get-Process com.docker.backend` still reports StartTime 6 Oct 15:10 — the
engine's supervisor has not been recycled, so the fix chosen at §30.3 has not happened yet. What Stage 6
still needs from an engine, in run-book order: the HTTP tier, `supabase/tests/stage6/run.sh both` (90
registry / 80 policy, plus the historic stage2–5 suites), `UPL-07` for M1, the `pg_roles` row that replaces
§25.3's recalled ranking, the A13 `allow_only_operation('object.list')` spelling, the browser tier with its
four network observations, and the audit section that records all of them. Everything that could be proven
without the engine has now been proven and pushed. Stage 6 is **not** fully qualified; saying so is the
honest close of this sitting, and the boundary holds — no merge, no `main`, no deploy, no hosted Supabase,
no Stage 7.

## 32. One published mechanism claim corrected, and the M1 instrument rebuilt before it was ever run (2026-10-07)

**32.1 The engine is still not there; this section is the work that did not need it.** Probe 24 repeated §31.5's measurement at
14:00:48 UTC: `docker version --format '{{.Server.Version}}'` with the code read adjacent inside the same command returned
`code=124` and an empty `server=`, and stderr was empty — the CLI never reached a daemon rather than reporting one unhealthy. The
restart chosen at §30.3 has still not happened, so every item listed at §31.5 remains owed. What changed below was found by reading
the battery, the migration and `run.sh` against each other, which costs no engine time and would otherwise have been discovered
inside the one session that has it.

**32.2 A sentence at `:1662` attributed the size half to a mechanism the code does not use.** §26.3 laid out M1 and then separated the
two halves of the confirm edge's comparison: "…then for TYPE the comparison is client-value against client-value… `size` is not
exposed the same way, because the recorded length is measured from real bytes" (`:1660-1662`). The migration does not read bytes.
The confirm edge selects `metadata ->> 'mimetype'` and `metadata ->> 'size'` in one statement
(`20261006120000_stage6_wedding_asset_storage.sql:150-157`) and compares each to the row's claim (`:172-180`), so **both** halves are
sourced from the same jsonb blob, and any sentence that distinguishes them by *where the value comes from* was overstating the SQL.
The line was written as an inference from `UPL-01`'s measured `size = 68` on a 68-byte PNG, and that observation is consistent with
either "length measured from bytes" or "length taken from the request" — it separates nothing. The asymmetry that does have a
mechanical basis is about the client's channels rather than the trigger: the upload's size is the body itself, which a client cannot
declare independently of what it sends, whereas the type travels in a `Content-Type` header that can say anything
(`weddingAssets.ts:256`, and `storagePut`'s `mime` argument at `stage6_storage.test.mjs:185-197`). So size remains *probably*
faithful and type *probably* not — but the audit will not carry "probably" about a mechanism it can measure. The revised `UPL-07`
reads `metadata->>'size'` and the length of the bytes the service hands back through the authenticated read endpoint in the same case,
which settles both halves at once; if they ever disagree, `:1662` was false in a second way and this section is where that is recorded.

**32.3 Three defects in the draft instrument, each of which would have failed the case for an unrelated reason.** Checked line by
line against `stage6_storage.test.mjs`, all found without running anything, and all now fixed in
`q6-logs/s6-m1-upl07-draft.md` (revision 2):
- It asked the database for `octet_length(data)`. No case in the battery has ever touched a `data` column — `UPL-01` (`:496-513`)
  reads `owner_id` and the two metadata keys and nothing else — and local storage can keep payloads off that column. Because
  `sqlRows` (`:137-143`) runs `psql -v ON_ERROR_STOP=1` through `execFileSync`, a missing column does not yield a null and a note;
  it throws out of the helper and the case *errors*. The byte ground now comes from `storageRead` (`:205-215`), whose behaviour is
  already measured by `READ-01` (`:627-634`) comparing a returned buffer to `PNG` byte for byte.
- It pinned the refusal to `statusCode '415'`. That code is measured for *disallowed declarations* (`UPL-04`, `:557-581`); nothing has
  observed what a content-checking service does to an allowed declaration over markup, so the pin would have made a correct
  refusal look like a failure. The case now prints `code`, `error` and `message` and asserts only the two facts the invariant lives
  on: nothing is stored, and the row does not leave `staged`.
- Its third branch matched `/mime type|not supported|markup|html|svg/i` — vocabulary this database never emits. `:128-180` raises a
  closed set of six messages, all under `ERRCODE '42501'`, and the branch now matches against the two that can mean a
  content disagreement (`… is stored as …, but this row claims …` and `… is … bytes, but this row claims …`) while the rest of the
  body is printed for the record rather than guessed at.
The teardown mapping was checked against the same file rather than assumed, because `supabase/tests/api/run.sh` fails the *whole*
HTTP tier if `wedding_assets` or `storage.objects(wedding-assets)` does not return to its pre-run count: a refused upload with no
object goes through `dropStaged` (`:1003-1009`, measured for exactly that shape), and any object-bearing shape goes through
`removeAsset` (`:1011-1024`), which the trigger permits from either `staged` or `ready` since only `tombstoned`-onward and
`ready`-sideways are refused (`:128-137`).

**32.4 Two assumptions the same reading corrected, both of which had been carried forward.** First, the HTTP tier has no case-count
assertion: `supabase/tests/api/run.sh` ends on the residue comparison and on the orphan check, and the only pre-flight refusals are
the bucket-config guards at `stage6_storage.test.mjs:316-319`, which stop the run if `file_size_limit` or `allowed_mime_types` is not
the design's values. The "33/33" used throughout this audit is therefore a description of a node summary, not a gate — so adding
`UPL-07` breaks no count, and any future statement that a count "must" match should name which assertion enforces it or stop saying
it. Second, provenance of the tree these heads were certified on: `node_modules` currently carries both `/.package-lock.json` (npm)
and `/.modules.yaml` (pnpm), with `node_modules/vite` a symlink into `.pnpm/` dated 2026-10-05 19:02, matching the mtime of the
untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` that §26.6 and §29.3 already document as an outside install. So the five gates at
every head certified from that moment onward — including `ea5be7f` and the `dist/` rebuild at `dbd8e60` — were measured on a
pnpm-layout tree while the repository's committed lockfile is npm's. That is disclosed, not repaired: the results are what they are,
the pair remains untracked and unstaged, and a clean `npm ci` tree is the thing the next certification run should be taken on if one
is wanted rather than assumed. Free space at the time of writing is 1,197,828 KB, above both floors in §26.8.

**32.5 Stage 6 remains not qualified, and the blocker is unchanged.** Nothing here moved a gate toward green: §32.2 *weakens* a
published claim rather than strengthening one, and §32.3 is an instrument that has still never executed. M1 is still open, M2's
mid-stream-abort question is still open, and the engine-sited list at §31.5 stands in full. The boundary holds — no merge, no `main`,
no deploy, no hosted Supabase, no Stage 7.

## 33. A Stage 6-introduced accessibility defect, found and repaired while the engine was still down

§30.4 left the browser tier unstarted, which made the waiting useful in a different way than the §16
pre-flight: the tier's instrument is a tracked file, so its thresholds can be read now and held against the
component this stage added. The instrument asserts two things about actionable controls, and both are
`check`s rather than `measure`s:

- `scripts/stage5-a11y-mobile.mjs:687-690` — *no enabled control is smaller than 24×24 CSS px*
  (`MIN_TARGET_PX = 24`, `:89`);
- `:697-701` — *no enabled control in the host workbench is smaller than 44×44 CSS px*, whose comment
  states the provenance plainly: 44 is "this product's own acceptance target … stated in
  `docs/product/design-principles.md` … not merely the AAA ask §30 assumed". That document carries it twice
  (`:30` "Touch targets at least 44×44px", `:97` "| Touch target | ≥44×44px, ≥8px apart |").

The instrument counts a radio as actionable — its `INTERACTIVE` selector is
`'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link]'` (`:136`) —
and it sizes a press area from the control's own `<label>`, not from the control: `const wrap =
el.closest('label'); const effective = wrap ? rectOf(wrap) : own;` (`:182-183`). So the panel's
replace-target control was measured against those two checks before any browser ran:

| fact | value | how it is known |
|---|---|---|
| the control | `<input type="radio">` with `className="… h-4 w-4 …"` | `WeddingAssetsPanel.tsx:238` as committed at `a10da61` |
| its box | 1rem = **16 CSS px** square | Tailwind `h-4`/`w-4` under this project's `src/index.css:109` `html { … }` with `font-size: 1rem` |
| its label | none — the row uses `aria-label`, and no `<label>` wraps it | `:231-239`; confirmed structurally, not by reading alone (33.4) |
| effective target | therefore its own 16×16 | `:182-183`, the no-wrap branch |
| verdict | below the 24 px floor **and** below the 44 px workbench assertion | `:687-690`, `:697-701` |

This is a defect Stage 6 introduced: the panel is `S6-6a` work, and every other control in the same
component was written at `h-11`.

### 33.1 The five sibling controls were rejected as defects, with a reason that had to be measured

The panel also carries four `size="sm"` buttons and one `size`-less `Input`, each given `h-11` in
`className` while the shared component's variant supplies `h-9` (`src/components/ui/button.tsx:21`) or
`h-10` (`input.tsx:11`). Whether those conflict is a cascade question, and the built stylesheet said the
wrong-looking thing: in `dist/assets/index-DSeE7ILB.css` the offsets are `.h-10{`=10387, `.h-11{`=10407,
`.h-12{`=10428 but `.h-8{`=10680 and `.h-9{`=10697 — the smaller utilities come *later*, so equal-specificity
CSS order would let `h-9` beat `h-11` and five more sub-44 controls would have been "found".

They are not defective, because the merge happens before the cascade. `src/lib/utils.ts` is
`twMerge(clsx(inputs))`, and `Button`/`Input` build their class list through `cn`, so a conflicting height
utility is dropped and the caller's `h-11` is the only height on the element. The distinction is worth
recording because it is the kind that turns an honest-looking sweep into five invented defects: had `cn`
been plain `clsx`, the panel would carry six failures instead of one, and the repair would have been a
different change.

### 33.2 The repair, and what it deliberately does not claim

`WeddingAssetsPanel.tsx` now wraps that radio in its own `<label className="-m-3.5 shrink-0 cursor-pointer p-3.5">`.
`p-3.5` is 0.875rem = 14 px, so the label box is 14 + 16 + 14 = **44 px** on both axes — the figure the
instrument asserts, reached by the mechanism it recognises rather than by enlarging a radio, which is what
`:680-681` prescribes ("a 16px radio inside a padded label is a label-sized press target"). The negative
margin keeps the row's geometry as drawn; its cost is that the label's box overhangs the row's own `p-3`
(12 px) by 2 px, which the tier's overflow check (`:665-666`) measures rather than my assertion.

Pinned with `src/test/weddingAssetsPanelTargets.test.tsx`, which asserts the DOM relation the instrument
consumes (`radio.closest('label')` non-null) and that the radio keeps its own `aria-label` so a future
wrapping cannot leave it unnamed. It asserts nothing about pixels — jsdom lays nothing out, and a number
invented there would be exactly the kind of claim this audit has had to retract twice.

**Before → after, both captured:**

    $ npx vitest run src/test/weddingAssetsPanelTargets.test.tsx      # panel unwrapped
    vitest_before_code=1
    AssertionError: expected null not to be null      (57| expect(radio.closest('label')).not.toBeNull())
    Test Files  1 failed (1) · Tests  1 failed | 1 passed (2)

    $ npx vitest run src/test/weddingAssetsPanelTargets.test.tsx      # panel wrapped
    vitest_after_code=0
    Test Files  1 passed (1) · Tests  2 passed (2)

The `1 failed | 1 passed` shape of the first run is the part that matters: the naming assertion already
passed and the structural one failed, so the red was the missing label and not a broken harness. The full
five node gates for this tree are in `../q6-logs/` under this head's own SHA, per §22.7.

**Not claimed.** That 44 px is *measured on screen* — that is the browser tier's own obligation, and it is
also the tier that has to confirm the overhang, the `elementFromPoint` centre (`:183`) still answering to
the radio itself, and the `gap-2` 8 px separation `design-principles.md:97` asks for. The panel header's
`NOT YET QUALIFIED` block stays where it is: this repair makes the tier one failure poorer, not one verdict
richer. §26.7's discipline also applies — the change was made in a clean worktree with no gate in flight,
and `dist/` is rebuilt from the head that carries it so the browser tier measures these bytes.

## 34. The README carried a delivery claim the repository had already outgrown, and three numbers with no run ID attached (2026-10-07)

The engine is still down — this sitting opened with probe 31 at `timeout 45 docker version` →
`probe_code=124`, the thirty-first consecutive timeout — so this section is the work a dead engine does
not block: re-reading the *live* claims in `README.md` against the repository as it now stands, rather
than against the tree each claim was first written into. Four defects were found, every one of them
decidable from a file or from `git`, and all four are repaired in the same commit as this section.

**34.1 The false one.** `README.md`'s Stage 6 closing paragraph ended "…was blocked by §18, which is
also why Stage 6 carries no commit and no push." That sentence is not merely stale, it is the wrong
direction: it told a reader the stage was *undelivered* when in fact the stage is committed and pushed.
Measured this sitting, adjacent rather than remembered:

    local_head=8e62c386667b537031969e39fe167c3e4707d928
    8e62c386667b537031969e39fe167c3e4707d928  refs/heads/stage6/storage-assets
    git_status_short=only the two untracked foreign pnpm files

`origin/main` was not touched by this stage and `git branch -r` still lists Stage 5's branch beside it.
The replacement wording keeps the boundary and moves the cost onto the right axis: what the engine's
death withholds is *qualification*, not delivery, and the missing artefact is a re-run, not a push.

**34.2 Which earlier sections §34.1 supersedes, named rather than edited.** This file is append-only
(`:8`), and three of its own sections say the thing `README.md` repeated: **§14.9** (`:696`) "the
migration itself remains uncommitted and therefore unpushed"; **§18.6** (`:860`) "the stage as a whole
has no green chain, no commit and no push"; **§19.13** (`:1035`) "there is still no Stage 6 commit, no
push and no remote SHA to verify against." All three were accurate when written — §29 and §30 are the
sections that later recorded the commits and the read-back — and none is rewritten here. What is worth
saying once is that the phrase "no commit" in §18.6 and §19.13 always meant *no implementation commit at
a state with a green chain*, because §10.5 (`:378`) had already recorded `c2f9872` pushed to this very
branch — timestamped `2026-10-05 19:02:53 +0530` at `:348`, more than a day before either section was
written. A reader who took the later phrase literally would conclude the branch was
empty; it was documentation-only. `README.md`'s sentence had exactly that failure, which is how it got
found.

**34.3 Three numbers with no provenance, now carrying their run IDs.** The Stage 6 section lists the SQL
chain, the HTTP battery and the §16 isolation result as measured — all true — without naming the capture
each came from, so they read as current-tree evidence at any head. Each figure was traced back to its
log and dated, and the dates line up with the engine's death rather than with the tree's history:

| Claim | Capture | Stamp as measured | Result as printed |
| --- | --- | --- | --- |
| 90 and 80 Stage 6 assertions + the historic re-measurements | `q6-logs/s6-stage6chain-04.log` | 2026-10-06 16:43 | `chain_exit_code=0`; `80_asset_registry` PASSED (90), `90_storage_policies` PASSED (80), each with `PASS lines observed` beside it |
| 33 HTTP tests | `q6-logs/s6-http-iter-02.log` | 2026-10-06 17:14 | `tests 33 / suites 6 / pass 33 / fail 0`, 21.9 s |
| §16's repaired Stage 3 case | `q6-logs/s6-stage3-isolation-01.log` | 2026-10-06 17:18 | `pass 56 / fail 0`, and the repaired case is in the passing list by name: `✔ a child row cannot be attached to another account's wedding via wedding_assets` |

So no engine-tier number in this stage is newer than **2026-10-06 17:18**, and the README now says so.
The whole-directory HTTP run beside them (`s6-api-run-01.log`, 17:15) is `api_run_exit_code=1` and stays
red as the record of the §16 defect — the isolation run repaired and measured that one file, it did not
re-run the directory, and no serial chain has gone green since.

**34.4 The part that strengthens rather than weakens the figures: `supabase/` has not moved since.** A
dated measurement is only honest if the reader knows whether the thing measured still exists. Checked
directly:

    git diff --stat eb88405 HEAD -- supabase/     →  (no output)
    git diff --stat eb88405 HEAD -- src/          →  6 files changed, 1403 insertions(+)

`eb88405` is the last commit that touches `supabase/` (the §16 historical-battery repair). Every
migration, every SQL battery and every HTTP test file HEAD carries is therefore **byte-identical to the
bytes those 2026-10-06 runs executed** — the figures are old, the tree they describe is this tree, at
least for the files those tiers read. What has changed since is `src/` alone (the adapter, the panel,
two unit-test files), and neither tier imports it: `stage6_storage.test.mjs` pulls only `node:test`,
`node:assert/strict`, `node:child_process`, `node:fs`, `node:path`, `node:url` and `@supabase/supabase-js`,
and the SQL batteries are `psql` scripts run against a fixture head. This is not a re-run and does not
pretend to be one — the stack itself is gone, and a migration that is *applied* to a container that no
longer exists is not being enforced by anything right now. What it does mean is that when the engine
returns, a green replay of those two tiers would be a replay *of this head's files*, not a repair of a
drift the README had quietly hidden.

**34.5 The stale count, and the false premise that nearly replaced it.** `README.md` said "185 files at
the current Stage 6 tree". Every certification log from §26 through §33 does print 185, so the number
was current *for those heads*; `8e62c38` added `src/test/weddingAssetsPanelTargets.test.tsx`
(`git log --diff-filter=A` on that file), and the head certification at `8e62c38`
(`q6-logs/s6-head-cert-8e62c38.log`) prints **`Product contract OK — 186 active file(s) scanned, 0
violation(s)`** with `gate_exit_code=0` beside all five gates and `test_summary_present=YES`. The README
now carries 186 with that head and log named, and calls the move a third one rather than the second.

This is also where a correction about my own working notes belongs, because the fix was nearly wrong in
the other direction: an earlier sitting recorded "my count attempt used the wrong pattern" for
`src/test/weddingAssetUploadRules.test.ts` and left "26 unit tests" flagged unverified. Re-measured with
`grep -c -E "^\s*(test|it)\("` the file returns **26**, so the README's figure needed no change — the
defect was in the probe, not in the claim. The lesson is the same one §34.5 carries for 185: an
unverified number and a wrong number are different problems, and only one of them is repaired by
editing copy.

**34.6 What §34 does not license.** No engine tier has been re-run. The browser tier has not started, so
the four network observations (N1–N4, run-book §18) remain unperformed — and N4 in particular cannot be
performed by the staged instrument as it stands, because `needlesFor()` carries the six configured
credentials and not the signed-URL token. The a11y repair at `8e62c38` is still *code* whose 44 px
target has never been measured on a screen (§33's own boundary). Stage 6 is **not qualified**, it is
committed, pushed, and bounded by §18.4 until the engine answers.
