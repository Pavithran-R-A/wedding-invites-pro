# Public invitation security model

> The standing record of how a wedding becomes a link a stranger can open, and what stops that link
> from becoming a way into someone else's data. Facts here are read from the schema and from tests
> that run against a real API; where a decision is recorded rather than a fact, the reason is in the
> same sentence. The stage that built it is
> [`../audits/stage-3-public-invitation.md`](../audits/stage-3-public-invitation.md) §6, which carries
> the measurements; the code is
> [`20260926130000_stage3_publication_resolution_boundary.sql`](../../supabase/migrations/20260926130000_stage3_publication_resolution_boundary.sql),
> with the privileged-body split of the closure repair in
> [`20260926150000_stage3_privileged_bodies_behind_wrappers.sql`](../../supabase/migrations/20260926150000_stage3_privileged_bodies_behind_wrappers.sql).

## 1. What is being protected

A shareable URL is a bearer credential. Anyone who has it sees the invitation, and the only way to
take that back is to destroy the credential. Everything below follows from that being the design, not
an oversight: the product chooses "a link that works with no account" over "a page nobody can reach",
and pays for it by making the link unguessable, revocable, and worth nothing beyond one document.

| Who is asking | What they can learn | What they cannot do |
| --- | --- | --- |
| anonymous, no credential | that `/i/<anything>` answers `{"available": false}` — the same bytes for a wrong, revoked, expired and never-existing address | enumerate; tell a bad address from a taken-down one; read any table (`SELECT` on all 19 `public` tables is refused by the grant layer, `PGRST*`/42501 for the unexposed ones) |
| a signed-in host, about someone else's wedding | nothing, and no signal that it exists: `[]` for a hidden row, one SQLSTATE and one message shared by "not yours" and "not there" | freeze, preview, publish, rotate or revoke it; write `invitation_versions`, `publications` or `private.access_tokens` at all |
| a host, about their own | everything the DTO carries, plus their version history and whether a link is live | mint an entitlement, grant itself a role, insert a frozen version by hand, read `access_tokens` / `audit_events` / `projects` / `guests` / `payments` / `templates` (not REST-addressable at all) |
| a guest holding a live link | one invitation document, 11 named fields | learn an identifier of any kind; receive markup; get a non-`https` link; get a second invitation |
| a reader of the database | the SHA-256 digest of every credential ever minted, and nothing that recovers one | — |

## 2. The callable surface

`api` is a schema with **no tables**: seven functions and nothing else. PostgREST exposes
`public` and `api` only, so `private`, `internal_api`, `legacy` and every internal builder are
unaddressable over HTTP before any policy is consulted.

| Function | Callable by | Derives its caller from |
| --- | --- | --- |
| `api.resolve_public_invitation()` | `anon`, `authenticated` | nothing — it takes no arguments at all |
| `api.preview_invitation(p_wedding_id)` | `authenticated` | `auth.uid()` |
| `api.create_invitation_version(p_wedding_id)` | `authenticated` | `auth.uid()` |
| `api.publish_invitation_version(p_wedding_id, p_version_id, p_expires_at)` | `authenticated` | `auth.uid()` |
| `api.get_invitation_publication_state(p_wedding_id)` | `authenticated` | `auth.uid()` |
| `api.rotate_invitation_token(p_wedding_id)` | `authenticated` | `auth.uid()` |
| `api.revoke_invitation_publication(p_wedding_id)` | `authenticated` | `auth.uid()` |

Rules the surface obeys, each of which a catalogue check enforces:

* the exposed `api` functions are `SECURITY INVOKER` wrappers holding one `SELECT` each. The
  privileged implementations they call live in `internal_api`, which PostgREST does not expose: those
  are `SECURITY DEFINER`, owned by `postgres`, `SET search_path = ''`, bodies fully qualified — they
  need privileges their callers do not have, and that is exactly why the search path is pinned, the
  grant list is exact, and the bodies are not themselves reachable over HTTP. The split is recorded in
  [ADR 0006's deviation record](decisions/0006-database-rpc-publication-boundary.md);
* `REVOKE ALL … FROM PUBLIC` first, then `GRANT EXECUTE` to the one or two roles that need it.
  `service_role` holds no `EXECUTE` on any `api` function and no `USAGE` on the schema: it is not a
  browser and does not need the browser boundary;
* `REVOKE ALL … FROM PUBLIC` first, then `GRANT EXECUTE` to the one or two roles that need it.
  `service_role` holds no `EXECUTE` on any `api` function and no `USAGE` on the schema: it is not a
  browser and does not need the browser boundary;
* the internal builders (`private.build_invitation_snapshot`, `private.public_invitation_dto`,
  `private.map_link_or_null`, `private.dto_text`, `private.mint_public_invitation_token`,
  `private.invitation_for_token`) are `SECURITY INVOKER`, live in `private`, and are revoked from
  `PUBLIC, anon, authenticated`;
* no function lives in `public` at all, so a REST call cannot reach a domain table's logic by
  guessing a name.

The inventory is closed in two directions on purpose: `API33` says the seven names are all of `api`
from the HTTP side, `API34` and SQL checks C26/C28a/C28b/C29/C30/C32 say it from the catalog side. An
eighth function that someone forgets to revoke shows up as a red catalogue test, not as a live hole.

## 3. The credential

**Mint.** 32 bytes from `extensions.gen_random_bytes`, base64url without padding: 256 bits in 43
URL-safe characters. Only
`encode(digest(convert_to(raw, 'UTF8'), 'sha256'), 'hex')` is stored, in `private.access_tokens`, under
a unique index. The raw string exists in exactly one HTTP response — the call that created it — which
is why the product can say "copy it now" and cannot say "here it is again".

**Why there is no lookup oracle.** The digest probe is an equality test on a unique index, so no path
compares two secrets byte by byte and there is no partial-match timing to measure. Shape is tested
*before* hashing (43 bytes, `[A-Za-z0-9_-]`), so junk cannot make the function do arithmetic. Failure
is one value: `{"available": false}`, returned as HTTP 200 for every kind of wrong.

**Transport.** The credential travels in the `x-invitation-token` request header, read inside the RPC
from `current_setting('request.headers', true)`. It is never a function argument, because PostgREST
would then accept `GET /rest/v1/rpc/resolve_public_invitation?p_raw_token=…`, and a query string is
logged by proxies, kept in browser history and leaked through `Referer`. The **browser address** is
still `/i/<token>` — a shareable link has to carry its own credential, and there is no other channel
to the guest — so the residual is disclosed rather than argued away: the path segment appears in that
visitor's history and in path-logging infrastructure. What is eliminated is the API hop repeating it,
and the whitelist below keeps it out of every response body.

**Referrer, measured rather than assumed.** The guest document is served with
`<meta name="referrer" content="no-referrer">` (in `index.html`, before the stylesheet links), and the
request log of a live guest page was read back through CDP rather than reasoned from browser defaults:

| Request out of the guest page | Measured `referer` |
| --- | --- |
| `GET https://fonts.googleapis.com/css2?family=…` (the stylesheet the invitation needs) | present with an **empty value**, `sec-fetch-site: cross-site` |
| a font resource request issued by the live guest document (`sec-fetch-dest: font`, `sec-fetch-mode: cors`, to `fonts.gstatic.com`) | `http://127.0.0.1:5173/` — the **origin only, path stripped**; no `/i/<token>` |
| `POST /rest/v1/rpc/resolve_public_invitation` (loopback API) | present with an empty value |

**No measured request carried the credential in `Referer`.** The second row is the honest limit of the
meta tag's reach: for that one request the browser applied an origin-only referrer instead of sending
nothing, so this document claims *the path does not leak to third parties*, not *no referrer is ever
sent*. `document.referrer` on the guest page is `""`. Four `fonts.gstatic.com` font files were loaded
by the page; their individual request headers were not each dumped (binary response bodies), so the
font-row evidence above is from a same-document request of the same type, and the stylesheet row is a
real page request.

What this does **not** claim, stated because the residual is the interesting part: the credential still
appears in that visitor's **browser history**, in any **same-origin server log** that logs request
paths, and in **hosting/CDN request logs** for `/i/<token>`. A referrer policy changes what leaves the
browser to other origins; it cannot remove a URL from the places a URL is written. Anyone with those
logs has the link.

**Lifetime.**

| Event | What happens to the credential |
| --- | --- |
| publish, no live link exists | a new secret is minted and returned once |
| publish again, link already live | the old publication is revoked, a new active row is created, and the **existing credential row is re-parented** to it — the address already shared now shows the new version |
| rotate | the live secret is revoked, a new one is minted, the old row keeps its `revoked_at` |
| revoke | the publication and its credential are marked revoked. Permanent: nothing un-revokes a row, and re-publishing mints a **different** secret |
| expiry | `expires_at` + `expiry_policy`; an expired credential answers exactly as an unrevoked, never-existing one would |

Deleting a wedding cascades to its publication and its credentials, so a removed account cannot leave a
live door behind it. `private.access_tokens` is append-and-revoke history: rotation keeps rows rather
than updating one, which is what makes "which link did I send, and when did it stop working" answerable
in support.

## 4. What a guest may learn

`private.public_invitation_dto` is the only gate from a stored snapshot to a response, and it is a
whitelist of 11 names: `title`, `language`, `style`, `design_template`, `tradition_pack`, `people`,
`events`, `welcome`, `family_introduction`, `event_notes`, `closing`. It is version-gated: a snapshot
whose `snapshot_schema_version` it does not recognise returns `NULL`, which means *unavailable*, not
*best-effort parse*. The TypeScript half (`src/lib/publicInvitation.ts`) refuses the whole payload on
any unexpected shape for the same reason; both halves answer "I cannot vouch for this" identically.

Three content rules hold from the database through to the screen:

* **identifiers never cross.** No uuid, no email, no version counter, no `wedding_id`, no
  `publication_id`, no token or digest. `API22` walks the live response and fails on any of 23 banned
  key names.
* **host text is never markup.** The database does not sanitise and does not need to: it stores text,
  transmits text byte-identically (`API25`) and the renderer emits it only as an escaped JSX text
  child. Sanitising at rest would be a second, lazier definition of "safe" that the renderer could
  disagree with.
* **a map link is `https` or it is nothing.** Enforced twice: the column's `CHECK` means a browser role
  cannot store another scheme at all, and `private.map_link_or_null` re-checks at read time because a
  frozen snapshot is older than tomorrow's constraint. An unsafe link degrades to "no link", not to
  "no invitation" — mirrored in the client parser.

The single design consequence a reviewer should press hardest: **preview and public page are the same
projection of the same snapshot function.** `api.preview_invitation` and `api.resolve_public_invitation`
run `build_invitation_snapshot` → `public_invitation_dto`, so a host cannot be shown a document their
guests will not see, and a bug fixed in one place is fixed for both.

## 5. Failure posture

* One generic guest refusal (§1, §3).
* Host refusals share a SQLSTATE and a message across "not signed in", "not yours" and "not there", so
  an RPC cannot reopen the enumeration question the table reads closed.
* **Server prose never reaches a user.** PostgREST returns `message`/`details`/`hint`, and Postgres
  writes them accurately about tables, columns, constraints and policies. Measured on this stack: an
  anonymous `GET /rest/v1/weddings` answers with
  `Grant the required privileges to the current role with: GRANT SELECT ON public.weddings TO anon;`.
  That is not a credential and leaks no row, and it is still internal vocabulary addressed to a
  stranger. `src/lib/safeError.ts` is the one mapper: it keeps the **code** (a stable identifier, and
  the only thing that distinguishes "may not" from "unreachable") and contributes no server text. A
  page shows a phrase its adapter chose. The test that pins the hint's shape is what keeps this from
  decaying into `error.message` again.
* The guest route does not mount the account session machinery at all: `/i/:token` is rendered outside
  `AuthProvider`, so opening an invitation neither inspects nor refreshes anyone's session (pinned in
  `src/test/appRoutingAuthIsolation.test.tsx`, and measured as **0 requests to `/auth/v1`** on a live
  guest page). The client that read call is built with `persistSession: false`, so a visit writes
  nothing to storage — no session, no refresh token, nothing left on a shared family phone. Measured:
  `localStorage`, `sessionStorage` and `document.cookie` all empty after a full guest read, on the
  available page and on the refusal page.

## 6. Where each rule is tested

| Rule | SQL (`30_publication.sql`, groups named below; throwaway Postgres, both chains) | HTTP (real Kong + PostgREST + GoTrue) |
| --- | --- | --- |
| surface is exactly the seven, and no privileged body is exposed | G — the `api` surface as one matrix, plus the `internal_api` inventory (its functions, its zero relations, and that `api`'s seven are `SECURITY INVOKER`); plus C26/C28a/C28b/C29/C30/C32 in `40_catalog.sql` | `API01`–`API05`, `API33`, `API34` |
| ownership comes from the caller, and strangers reach nothing | B, B2/B3 | `API06`–`API11` |
| freeze is explicit, and a version never moves | B | `API07`, `API19`, `API20` |
| credential shape, storage and transport | C | `API12`–`API16` |
| generic refusal, whitelist, projection rules | D (including D32's unsafe-link case) | `API21`–`API24` |
| a credential can only point at a live, same-wedding version | E | `API17`, `API18` |
| no client may write the publication tables directly | F, F2 | §5's `stage3_security.test.mjs` |
| rotation, expiry, revocation as a guest experiences them | H — including the case where a publication is live but its credential row is not there, which the repair migration's `v_publication_found` flag now decides instead of a leftover `FOUND` | `API27`–`API32`, plus `API35` for that same case through HTTP |

Every refusal above is paired with a control that must succeed — the same write by the owner, the same
insert against the attacker's own wedding, an `https` link after five refused schemes — because a test
that fails for a missing required field proves nothing.

## 7. What this boundary does not do

1. **No rate limiting or lockout.** The property that makes the door un-enumerable (200 + one generic
   body) also means a guesser is never told to stop, and never throttled. 256 bits makes guessing
   hopeless; it does not make load free. Throttling is a gateway decision for a later stage.
2. **No measured transport security.** The qualified stack is plain HTTP on loopback, so header
   placement is proven and TLS is not.
3. **No credential recovery.** Digest-only means a lost link cannot be shown again; rotation is the
   only way forward and it takes the old address down with it.
4. **No email verification or recovery flows in scope**, and Realtime/Storage/Edge are disabled on the
   qualified stack, so nothing here claims behaviour about them.
5. **Edge Functions were considered and refused**, on four grounds recorded in the migration's header —
   the decisive one being verification, not feasibility: no `deno` on this machine, so an edge boundary
   would be the one security surface in this repository that no gate ever reads.
6. **The publication UI does not offer an expiry**, although the RPC stores and honours one.

## 8. Changing this boundary

A future stage that adds a callable function, a DTO field or a liveness rule has to move the proof with
it, or the catalogue stops meaning anything:

* new `api` function → grant its exact caller role, revoke `PUBLIC`, then update C26/C28a/C28b,
  `API33`/`API34`. A schema grant is never the fix for a function that should not exist;
* new DTO field → `private.public_invitation_dto` **and** `src/lib/publicInvitation.ts`, then
  `API21`'s exact-keys assertion and the client's shape tests. Adding it in one place only is the rot
  the two-pinned lists exist to catch;
* new liveness predicate → `private.invitation_for_token` plus `30_publication.sql` group H *and* a
  `resolve_public_invitation` case in the HTTP suite, since a rule proven only in SQL is a rule
  PostgREST may still translate differently;
* new error surface → the phrase goes in the adapter, the code goes through `classify()`, and nothing
  adds `error.hint` to a page.
