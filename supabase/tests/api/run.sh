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
    union all select 'rsvp_responses='||count(*) from public.rsvp_responses"
}
BASE_CENSUS=$(leak_census)
printf '%s\n' "$BASE_CENSUS" | sed 's/^/  ..  baseline /'

# --- 3. preconditions that make the refusals mean something --------------------------
# Several tests below assert that a table is *not reachable* over REST. That assertion
# is worthless if the table simply was never created, so its existence is checked here,
# in SQL, against the same database the suite is about to hit.
echo "==> Preconditions"
MISSING=$(psql_q "
  select coalesce(string_agg(t, ', '), '')
  from (
    select x as t from unnest(array[
      'private.access_tokens', 'private.audit_events',
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

MIGRATIONS_APPLIED=$(psql_q "select count(*) from supabase_migrations.schema_migrations")
MIGRATIONS_LOCAL=$(find supabase/migrations -name '*.sql' | wc -l | tr -d ' ')
if [[ "$MIGRATIONS_APPLIED" != "$MIGRATIONS_LOCAL" ]]; then
  echo "FATAL: the stack has $MIGRATIONS_APPLIED migrations recorded; the repository has $MIGRATIONS_LOCAL." >&2
  echo "       Re-apply from zero with 'npx supabase db reset --local --no-seed'." >&2
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
[[ "$LEAK" == "0" ]] || exit 1

echo "==> RESULT: PASS (see the node --test summary above for the assertion count)"
