#!/usr/bin/env bash
# Stage 3 §5/§22 — run the API-level security suite against this repository's own
# local Supabase stack.
#
# What this adds over `supabase/tests/stage2/run.sh` and `supabase/tests/rls/run.sh`:
# those start a throwaway `postgres:16-alpine` and play database roles with `SET
# ROLE`, which proves grants, policies and triggers but never sees PostgREST, GoTrue
# or a JWT. This runner targets the *deployed* stack instead, so the same refusals are
# re-qualified through the HTTP layer the product actually uses.
#
# It never starts, stops, restarts or resets anything. If the stack is not already up,
# it says so and stops, because starting a stack is a decision with port and container
# consequences that this script should not make silently.
#
# It touches no remote project: the base URL is read from `.env.local` and rejected
# unless it resolves to a loopback host, and the suite repeats that check in code.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

# --- 1. which stack is this, and is it ours -----------------------------------------
PROJECT_ID=$(awk -F' *= *' '/^project_id/{gsub(/[",]/,"",$2); print $2; exit}' supabase/config.toml)
if [[ -z "${PROJECT_ID}" ]]; then
  echo "FATAL: no project_id in supabase/config.toml" >&2; exit 1
fi
DB_CTR="supabase_db_${PROJECT_ID}"
KONG_CTR="supabase_kong_${PROJECT_ID}"
REST_CTR="supabase_rest_${PROJECT_ID}"
AUTH_CTR="supabase_auth_${PROJECT_ID}"

# Exact name match. `docker ps --filter name=…` is a substring/regex match and would
# accept a different project's container that happens to contain this name.
running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]; }

for ctr in "$DB_CTR" "$KONG_CTR" "$REST_CTR" "$AUTH_CTR"; do
  if ! running "$ctr"; then
    echo "FATAL: $ctr is not running." >&2
    echo "       Start this repository's own stack with 'npx supabase start' and re-run." >&2
    echo "       (No stack is started here on purpose — see the header.)" >&2
    exit 1
  fi
done

if [[ ! -f .env.local ]]; then
  echo "FATAL: .env.local is missing. The suite reads SUPABASE_LOCAL_* only from that" >&2
  echo "       file; it deliberately never falls back to .env, which still carries the" >&2
  echo "       historical hosted project's defaults." >&2
  exit 1
fi

ENV_URL=$(awk -F'=' '/^SUPABASE_LOCAL_URL/{print $2; exit}' .env.local | tr -d '"')
case "$ENV_URL" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;;
  *) echo "FATAL: SUPABASE_LOCAL_URL=$ENV_URL is not loopback — refusing." >&2; exit 1 ;;
esac

echo "==> Stack: project_id=$PROJECT_ID  kong=$KONG_CTR  postgrest=$REST_CTR  gotrue=$AUTH_CTR  db=$DB_CTR"
echo "        url=$ENV_URL"

# A second interlock, at the shell rather than in the test file: the port in the URL has
# to be the port this repository's config.toml publishes. That is what makes it
# impossible for a stale `.env.local` to point the suite at the unrelated DueWeave stack
# on 54321, which would otherwise produce confident-looking results about someone else's
# database.
CONFIG_PORT=$(awk '/^\[api\]/{f=1; next} /^\[/{f=0} f && /^port[[:space:]]*=/{gsub(/[^0-9]/,"",$0); print; exit}' supabase/config.toml)
URL_PORT=$(printf '%s' "$ENV_URL" | sed -E 's#^https?://[^:/]+:?([0-9]*).*#\1#')
if [[ -z "$CONFIG_PORT" || "$URL_PORT" != "$CONFIG_PORT" ]]; then
  echo "FATAL: SUPABASE_LOCAL_URL uses port ${URL_PORT:-none} but supabase/config.toml [api] port is ${CONFIG_PORT:-unreadable}." >&2
  echo "       This suite only qualifies the stack belonging to this repository." >&2
  exit 1
fi
echo "        port $URL_PORT matches this repository's [api] configuration"

psql_q() {  # psql_q <sql> -> unaligned, untitled, single-line rows
  docker exec "$DB_CTR" psql -U postgres -v ON_ERROR_STOP=1 -tA -c "$1"
}

# --- 2. what is actually deployed ----------------------------------------------------
# Everything here is read from the running containers and the local database. The
# runner deliberately does not shell out to `npx supabase …`: that would reach the npm
# registry on a machine where the CLI is not installed, and a security suite should not
# be making network requests to pass. The CLI version that started this stack is
# recorded in docs/audits/stage-3-public-invitation.md instead.
echo "==> Stack images"
docker inspect -f '  {{.Name}}  {{.Config.Image}}' "$DB_CTR" "$KONG_CTR" "$REST_CTR" "$AUTH_CTR"
psql_q "select '  db: ' || version()"

# What an HTTP run can leave behind, stated as a list rather than as five shell variables: Stage 6
# added the registry row and the bytes it points at, and Stage 7 added the four stores a review
# workflow writes (`approval_requests`, `approval_feedback`, `private.access_tokens`,
# `publications`) plus the version rows an ask is pinned to. A row in any of them under a wedding that
# still exists moves no `weddings` count at all, so the pre-Stage-7 census could not see it, and an
# over-broad teardown that cleared someone else's review rows would have looked like a pass.
# Stage 8 adds the three stores a household invitation writes (`guest_households`,
# `household_event_scopes`, `rsvp_responses`), which Stage 2 created and nothing until this stage ever
# wrote through a browser door, plus a kind-filtered read of `private.access_tokens`: the total above
# cannot tell a leaked guest credential from a leaked review credential, and the two have different
# owners, so a run that tore down the wrong kind would still have matched it.
# Stage 9 adds the manifest row and the two buckets it points at. Both halves matter: a render run
# that left an `invitation_outputs` row behind would move no `weddings` and no `invitation_versions`
# count, and an artefact byte left in either bucket under a key no row names is a public object with
# no owner. Both buckets are counted rather than just one, because which of them a given suite fills
# is a property of the suite, and a census that guessed would be silent about the other.
# Stage 10 adds the money model itself: the six `private.commerce_*` tables and `public.entitlements`.
# The reason is the same shape as Stage 9's, and sharper, because these are the rows a payment buys. A
# run that left an order, an event, a refund or an entitlement behind would move no `weddings` count at
# all, and the residue would read in a later run as a wedding that has paid — which is precisely the
# state Stage 10's whole design says no test may be able to fake. `commerce_policy` is counted because
# its absence is not neutral: the publish gate reads a missing policy row as permissive, so a suite
# that deleted it and did not restore it would leave the product unable to refuse anything. The policy
# posture is additionally checked by name below, because a count of 1 says nothing about which posture
# that one row carries.
# Stage 11 adds the five stores an operational act writes — the grant table the authority lives in, the
# ticket and its event thread, the privacy request register, and the refund-oversight note — and one
# kind-filtered read of `private.audit_events`, in the shape `guest_invitation_tokens` above already
# uses. The filter is not decoration. The trail is append-only by design, so a *successful* operator act
# leaves a row behind even when every state table has been torn down, and a raw count over
# `private.audit_events` would therefore refuse any run that did its job. The rows already sitting there are
# not few: twenty-nine real `INSERT INTO private.audit_events` statements live in the five
# `*_stage10_*.sql` migrations (counted by stripping comments first, so the prose mention of that phrase in
# slice 1's own header is not read as a statement — `q11-logs/s11-audit-site-count.cjs`, capture
# `s11-audit-site-count-1.txt`), and one Stage 10 battery's own census accounts for `policy_changed=7` from a
# single file on its own (`q10-logs/s10r-nested-run-4.txt:35`, re-measured at
# `q11-logs/s11-s3-st11qual_g10-80_commerce_ledger.txt:428`). What the live total on this stack is, the
# baseline line printed three paragraphs below names it for the run that has to be judged, instead of this
# comment remembering a number nobody re-read — which an earlier draft of this note did, with a count of
# thirty-four that no capture in `q10-logs` or `q11-logs` supports.
# Filtering by action *name* alone would have been the obvious move and is wrong, which the line below
# records rather than hides: Stage 10 writes an audit action called `revoked` when it pulls an
# entitlement, and Stage 11 writes an action called `revoked` when it pulls an operator grant. Those are
# different acts on different rows with different owners, and an action-only filter would have read a
# Stage 10 suite's normal ledger as Stage 11 residue — failing this tier for a reason that has nothing to
# do with the surface being qualified. So the predicate is the (action, subject_type) pair, which is the
# shape the ten `INSERT INTO private.audit_events` sites in the six `*_stage11_*.sql` migrations write
# (two in slice 1's authority file, three in slice 2's cases, one each in the closed-is-terminal repair
# and slice 3's privacy intake, three in slice 4's takedown and oversight, none in slice 5's health read —
# all six files named with their count in `q11-logs/s11-audit-site-count-stage11-only-1.txt`, so the zero
# is a measurement and not an absence in a list that only prints non-empty rows),
# and it is why `guest_invitation_tokens` above filters a *kind* and not just a table. The pair list itself is
# read rather than remembered: a sweep of those ten sites takes each one's `action` and `subject_type` literal
# out of its `VALUES` list, resolves them to nine distinct pairs — `case_released` is written by two of the
# ten, slice 2's release and the closed-is-terminal repair — and diffs them against the predicate below,
# finding nothing written-but-uncounted and nothing counted-but-never-written
# (`q11-logs/s11-census-pair-sweep.cjs`, capture `s11-census-pair-1.txt`).
# Because the comparison is an equality, a row left by an earlier run that died is already in the baseline
# and does not fail the next run; what fails it is a row this run wrote and did not account for. The
# Stage 11 battery prunes exactly the audit ids its own answers named, through the container's `postgres`
# channel, because `service_role` holds neither UPDATE nor DELETE there — that is slice 1's repair, not a
# hole, and `AI12`/`AI12b` in `supabase/tests/stage11/80_operator_authority.sql` measures the pruning path
# this census depends on existing.
# Add a store by adding one `select` line; the comparison below reads whatever names come back.
leak_census() {
  psql_q "select 'weddings='||count(*) from public.weddings
    union all select 'auth.users='||count(*) from auth.users
    union all select 'invitation_drafts='||count(*) from public.invitation_drafts
    union all select 'wedding_assets='||count(*) from public.wedding_assets
    union all select 'storage.objects(wedding-assets)='||count(*) from storage.objects where bucket_id = 'wedding-assets'
    union all select 'approval_requests='||count(*) from public.approval_requests
    union all select 'approval_feedback='||count(*) from public.approval_feedback
    union all select 'access_tokens='||count(*) from private.access_tokens
    union all select 'guest_invitation_tokens='||count(*) from private.access_tokens where token_kind = 'guest_invitation'
    union all select 'publications='||count(*) from public.publications
    union all select 'invitation_versions='||count(*) from public.invitation_versions
    union all select 'guest_households='||count(*) from public.guest_households
    union all select 'household_event_scopes='||count(*) from public.household_event_scopes
    union all select 'rsvp_responses='||count(*) from public.rsvp_responses
    union all select 'invitation_outputs='||count(*) from public.invitation_outputs
    union all select 'storage.objects(invitation-outputs)='||count(*) from storage.objects where bucket_id = 'invitation-outputs'
    union all select 'storage.objects(invitation-previews)='||count(*) from storage.objects where bucket_id = 'invitation-previews'
    union all select 'commerce_packages='||count(*) from private.commerce_packages
    union all select 'commerce_orders='||count(*) from private.commerce_orders
    union all select 'commerce_payment_attempts='||count(*) from private.commerce_payment_attempts
    union all select 'commerce_payment_events='||count(*) from private.commerce_payment_events
    union all select 'commerce_refunds='||count(*) from private.commerce_refunds
    union all select 'commerce_policy='||count(*) from private.commerce_policy
    union all select 'entitlements='||count(*) from public.entitlements
    union all select 'operator_grants='||count(*) from private.operator_grants
    union all select 'support_cases='||count(*) from private.support_cases
    union all select 'support_case_events='||count(*) from private.support_case_events
    union all select 'privacy_requests='||count(*) from private.privacy_requests
    union all select 'commerce_review_notes='||count(*) from private.commerce_review_notes
    union all select 'stage11_audit_rows='||count(*) from private.audit_events where
      (action, subject_type) in (('granted','operator_grant'), ('revoked','operator_grant'),
        ('case_claimed','support_case'), ('case_released','support_case'), ('status_changed','support_case'),
        ('privacy_status_changed','privacy_request'), ('publication_takedown','publication'),
        ('publication_objects_purge_planned','publication'), ('commerce_review_note_added','commerce_refund'))"
}
BASE_CENSUS=$(leak_census)
printf '%s\n' "$BASE_CENSUS" | sed 's/^/  ..  baseline /'

# --- 3. preconditions that make the refusals mean something --------------------------
# Several tests below assert that a table is *not reachable* over REST. That assertion
# is worthless if the table simply was never created, so its existence is checked here,
# in SQL, against the same database the suite is about to hit.
# Stage 11's five operational stores join the list for that same reason and with a sharper edge than the
# rows above it: `supabase/tests/api/stage11_operations_http.test.mjs` refuses a browser-shaped write to
# each of them, and a grant table that was never created would answer every one of those refusals with
# the right sentence for the wrong reason. The list is the pair to the census above — the census asks
# whether a run left rows behind, this asks whether there is a table for the run to have left them in.
echo "==> Preconditions"
MISSING=$(psql_q "
  select coalesce(string_agg(t, ', '), '')
  from (
    select x as t from unnest(array[
      'private.access_tokens', 'private.audit_events',
      'private.commerce_orders', 'private.commerce_payment_attempts',
      'private.commerce_payment_events', 'private.commerce_refunds',
      'private.commerce_packages', 'private.commerce_policy',
      'public.entitlements', 'public.publications',
      'private.operator_grants', 'private.support_cases', 'private.support_case_events',
      'private.privacy_requests', 'private.commerce_review_notes',
      'legacy.projects', 'legacy.guests', 'legacy.payments', 'legacy.templates'
    ]) x
    where position('.' in x) > 0
      and to_regclass(x) is null
  ) m")
if [[ -n "$MISSING" ]]; then
  echo "FATAL: these objects do not exist, so 'not reachable over REST' would pass for the" >&2
  echo "       wrong reason: $MISSING" >&2
  exit 1
fi
echo "  ok  the private/legacy objects the suite expects to be unreachable do exist"
echo "  ok  the Stage 10 money tables and the right row they buy exist, so a refusal over REST is a refusal"

MIGRATIONS_APPLIED=$(psql_q "select count(*) from supabase_migrations.schema_migrations")
MIGRATIONS_LOCAL=$(find supabase/migrations -name '*.sql' | wc -l | tr -d ' ')
if [[ "$MIGRATIONS_APPLIED" != "$MIGRATIONS_LOCAL" ]]; then
  # The two directions are different incidents and used to print the same sentence, which told an operator
  # to reset the database when the honest reading was that a forward migration had not been applied yet.
  # `db reset` drops rows other suites and other people put in this stack, so it is not advice to hand out
  # for a missing file — and a run that silently tested the older schema would have been worse still.
  echo "FATAL: the stack has $MIGRATIONS_APPLIED migrations recorded; the repository has $MIGRATIONS_LOCAL." >&2
  if (( MIGRATIONS_LOCAL > MIGRATIONS_APPLIED )); then
    echo "       The repository is ahead: $(( MIGRATIONS_LOCAL - MIGRATIONS_APPLIED )) forward migration(s) have" >&2
    echo "       not been applied to this stack, so the schema the suite would qualify is not the schema in" >&2
    echo "       source control. Apply them with 'npx supabase db push --local'. Do NOT reset: a reset would" >&2
    echo "       discard rows this stack already holds." >&2
  else
    echo "       The stack is ahead: it recorded $(( MIGRATIONS_APPLIED - MIGRATIONS_LOCAL )) migration(s) the" >&2
    echo "       repository no longer contains, which is drift rather than a pending file. Stop and reconcile" >&2
    echo "       the journal against 'git log -- supabase/migrations' before running anything." >&2
  fi
  exit 1
fi
echo "  ok  $MIGRATIONS_APPLIED migrations applied, matching supabase/migrations"

TRIGGER=$(psql_q "select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'weddings' and t.tgname = 'weddings_have_draft' and not t.tgisinternal")
if [[ "$TRIGGER" != "1" ]]; then
  echo "FATAL: public.weddings has $TRIGGER 'weddings_have_draft' trigger(s), expected 1." >&2
  exit 1
fi
echo "  ok  the Stage 3 draft invariant trigger is deployed"

POLICIES=$(psql_q "select count(*) from pg_policies where schemaname = 'public'")
TABLES=$(psql_q "select count(*) from pg_tables where schemaname = 'public'")
echo "  ..  public schema: $TABLES tables, $POLICIES policies"

# --- 4. the suite -------------------------------------------------------------------
# One `node --test` per file, in sequence. `node --test <glob>` runs each file in its
# own process *concurrently*, and these files share a database: one counts rows before
# and after to prove it leaked nothing, and a parallel run would move those counts
# underneath it. The environment names the container the publication suite uses for
# the one thing no HTTP route can do — clear `private.access_tokens`, whose absence
# from the exposed schemas is the point of the boundary.
export STAGE3_DB_CONTAINER="$DB_CTR"
for f in $(ls supabase/tests/api/*.test.mjs | sort); do
  echo "==> node --test $f"
  node --test "$f"
done

# --- 5. the run must not leave anything behind --------------------------------------
# Synthetic accounts are removed by the suite through the Auth admin API, and every row
# it created hangs off those accounts or off a wedding it deletes. So the pre-run counts
# have to come back exactly. A drift here is a leak, and a leak in either direction
# (rows added, or rows that were there before and are now gone) fails the run.
echo "==> Post-run check: the local database is back where it started"
NOW_CENSUS=$(leak_census)
LEAK=0
while IFS= read -r base_line; do
  [[ -n "$base_line" ]] || continue
  name=${base_line%%=*}; was=${base_line#*=}
  # Read by name rather than by position: the two lists are produced by the same statement, but a
  # silent reordering would otherwise compare one store's total against another's.
  now=$(printf '%s\n' "$NOW_CENSUS" | awk -F'=' -v n="$name" '$1 == n { print $2 }')
  if [[ -z "$now" ]]; then
    echo "FATAL: $name was counted before the run and not after it." >&2; LEAK=1; continue
  fi
  if [[ "$was" != "$now" ]]; then
    echo "FATAL: $name went from $was to $now rows — the run did not clean up." >&2
    LEAK=1
  else
    echo "  ok  $name back to $was rows"
  fi
done <<< "$BASE_CENSUS"
ORPHANS=$(psql_q "select count(*) from public.invitation_drafts d where not exists (select 1 from public.weddings w where w.id = d.wedding_id)")
if [[ "$ORPHANS" != "0" ]]; then
  echo "FATAL: $ORPHANS draft rows have no wedding — the Stage 3 invariant broke mid-run." >&2
  LEAK=1
fi
# The census above counts the policy *row*; this names the posture that row came back with, because the two
# are different claims and only one of them is a count. Stage 10's publish gate reads a missing row or a
# non-permissive one as a decision about every wedding in the database, so a suite that left
# `entitlement_required` standing would refuse the next suite's publish and make it look like a product
# defect. `(none)` is written with the `nullif` idiom the Stage 10 gate repair uses, not a bare
# `coalesce(array_to_string(...))` — the empty list stringifies to '' and would print as an empty tail.
POLICY_POSTURE=$(psql_q "select coalesce(string_agg(publish_gate || '/' || coalesce(nullif(array_to_string(publish_required_package_codes, ','), ''), '(none)'), ' + '), '(no row)') from private.commerce_policy")
if [[ "$POLICY_POSTURE" != "permissive/(none)" ]]; then
  echo "FATAL: the commerce policy came back as '$POLICY_POSTURE', not the shipped 'permissive/(none)'." >&2
  LEAK=1
else
  echo "  ok  the commerce policy is back at the shipped permissive posture with no package named"
fi
[[ "$LEAK" == "0" ]] || exit 1

echo "==> RESULT: PASS (see the node --test summary above for the assertion count)"
