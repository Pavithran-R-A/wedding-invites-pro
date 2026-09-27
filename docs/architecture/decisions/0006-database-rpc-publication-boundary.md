# ADR 0006 — The publication boundary is a database RPC, not an Edge Function

**Status:** Accepted (Stage 3, implemented and qualified against a real local API stack).
**Date:** 2026-09-26
**Affects:** Every unauthenticated read of customer content, every host-side write that crosses the
`public`/`private` line, the shape of the callable API surface, CI

## Context

A published invitation must be readable by a guest who has no account. That single requirement forces
a design question Stage 2 could defer: **who turns a shareable link into a row of data, and what stops
that someone from being a way into everything else?**

The two candidates were a database-resident RPC exposed through PostgREST, and an Edge Function holding
a service-role key. The stakes are the ones Stage 0 exists to keep honest: a bearer credential, a
cross-tenant read, and a security boundary nobody can see in a code review.

## Decision

**The boundary lives in the database.** A purpose-built `api` schema holds exactly seven
`SECURITY DEFINER` functions with pinned empty search paths and exact per-role `EXECUTE` grants; the
guest door is one argument-free function that reads its credential from a request header; the
resolution rules are SQL predicates; the only thing that can leave is a whitelisted DTO.

*(The first sentence described the layout as first implemented. The seven names, their signatures,
their grants and their behaviour are unchanged; where the privileged bodies live is not — see
**Deviation record** at the end of this file.)*

## Reasons, in order of how much they weighed

1. **The invariants are relational, and SQL is the only place that can enforce them for every
   writer.** `publications (wedding_id, version_id) → invitation_versions (wedding_id, id)` as a
   composite foreign key makes "wedding A publishes wedding B's version" *unrepresentable*;
   `one_active_publication_per_wedding` makes two live links impossible;
   `access_tokens_token_hash_key` makes one secret address one row. A TypeScript boundary would
   re-implement all three as `if` statements that hold only for callers that happen to route
   through it.
2. **This repository's gates cannot read a Deno function.** Measured on this machine while deciding,
   not assumed: `deno` is absent from `PATH`, and the only edge image cached locally
   (`edge-runtime:v1.74.3`, from an unrelated project) ships `/usr/local/bin/edge-runtime` and no
   `deno` binary — so there is no `check`/`lint` to wire into typecheck, ESLint, vitest or Actions.
   An edge boundary would be the one security surface in this project whose source no gate ever
   reads. Note that this is an argument about *verification*, not feasibility: enabling the runtime is
   technically possible.
3. **A second runtime is a second copy of the rules.** The public field whitelist and the liveness
   predicates would exist in SQL *and* in the function, with a second place to rot. Stage 3 forbids
   two invitation implementations at the rendering layer for the same reason.
4. **Re-enabling Edge Functions would reverse a documented Stage 0 repair.** `[edge_runtime]` was
   switched off when the only function in the repository was deleted (`pricing-quote`:
   `verify_jwt=false`, CORS `*`, caller-supplied costs). `config.toml` still says why.

## What was rejected, and why that is not an oversight

- **A `SECURITY DEFINER` "create wedding + draft atomically" RPC** (considered in the same stage):
  PostgREST gives a browser no multi-statement transaction, so "atomically" forces a definer function
  that must re-implement the ownership check — a second copy of a check that can disagree with RLS.
  An `AFTER INSERT` trigger achieved the same guarantee with no new callable surface.
- **Letting the app insert both rows.** Makes a documented invariant enforced by whoever remembers,
  and turns a read (open the editor) into a write (create the missing draft).
- **A function argument for the guest token.** `api.resolve_public_invitation(p_raw_token text)` reads
  cleanly and is wrong under this transport: PostgREST will accept
  `GET /rest/v1/rpc/resolve_public_invitation?p_raw_token=…`, putting a bearer credential in a URL,
  where access logs, browser history and `Referer` will keep it longer than the invitation is live.
  Zero arguments plus a request header is the same boundary without the leak — and `API15` proves the
  query-string form is refused.

## Consequences

*Positive:* one projection serves preview and publication, so a host cannot be shown a document their
guests will not see; grants and policies are testable with the same two harnesses the rest of the
schema uses; nothing new has to be deployed for the guest page to exist; the callable surface is a
seven-row catalogue assertion rather than a code-review promise.

*Negative, and accepted:* the DEFINER functions are a privilege a caller cannot be trusted with, so
the price of this decision is a permanent obligation to keep the inventory exact (catalogue checks
C26/C28a/C28b/C29/C30/C32 and `API33`/`API34` are not decoration); a browser-callable definer path is
the shape Stage 2 warned about, bounded here by re-deriving every caller from `auth.uid()` rather than
by moving the layer; and there is **no rate limiting, no per-IP throttle and no request metadata** on
an unauthenticated hot path, which a gateway must eventually own.

## Evidence

[`../../audits/stage-3-public-invitation.md`](../../audits/stage-3-public-invitation.md) §6 (34 HTTP
tests API01–API34, 246 SQL assertions on two chains, as first recorded) and its closure-repair section,
which re-measured the same suites at 37 tests API01–API37 and 269 assertions after the
`internal_api` move, and
[`../public-invitation-security.md`](../public-invitation-security.md), which is the standing record
rather than the stage report.

## Deviation record — where the privileged bodies live (closure repair, 2026-09-27)

**Status:** Accepted, unchanged. This section records a correction *inside* the decision, not a
replacement of it.

The first Stage 3 implementation put all seven `SECURITY DEFINER` bodies directly in `api` — the schema
PostgREST serves. Independent review of the pushed branch compared that layout with current Supabase
guidance on privileged functions and objected: because `api` is exposed, every privileged body was
itself a Data API object that a correctly-signed request could name, which collapses
"the exposed surface is the privileged surface" and "the privileged surface is the audited surface"
into one sentence. The layout survived only because each body re-derives its caller from `auth.uid()` —
a lot of weight for a convention to carry.

The final design separates the two roles:

```
api           exposed.  Seven SECURITY INVOKER wrappers, one `SELECT` each, no tables.
internal_api  NOT exposed. The SECURITY DEFINER implementations. No tables.
```

Why this shape rather than a different one:

- **It keeps the reasons above intact.** The invariants stay relational and enforceable for every
  writer (reason 1); nothing had to run in a Deno/Edge runtime, so every gate still reads this
  boundary's source (reasons 2–4). No transaction crossed an API boundary.
- **The browser-visible API inventory is unchanged.** Same seven names, same identity signatures, same
  grants, same refusal phrases, same DTO. The frontend calls exactly what it called before, and the API
  suites were re-run *as written* to prove behaviour did not move.
- **Privileged bodies are no longer themselves Data API objects.** A request can name a wrapper; the
  wrapper holds no logic and no privilege of its own.
- **Exact `EXECUTE` grants remain measurable.** The catalogue assertions now pin two schemas and the
  privilege split between them, so a wrapper that grew a body or a definer body that leaked into the
  exposed schema is a failing test rather than a review finding.
- **Ownership checks live in one privileged implementation**, not duplicated across a wrapper and a
  body — which is why the wrappers are one `SELECT` apiece and are not allowed to validate anything.

What this does *not* claim: that the first layout was exploitable. It was not shown to be — the
suites passed before and after. It is recorded as a deviation from guidance that this repository
should not have had to discover in review, and the history of the first layout is preserved in
`20260926130000_stage3_publication_resolution_boundary.sql`; the repair is the forward migration
`20260926150000_stage3_privileged_bodies_behind_wrappers.sql`. No historical migration was edited.
