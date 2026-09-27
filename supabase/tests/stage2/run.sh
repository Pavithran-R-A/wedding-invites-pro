#!/usr/bin/env bash
# Stage 2 database qualification runner. Throwaway Postgres only — no remote project,
# no `supabase link`, no `db push`, nothing persisted anywhere.
#
#   bash supabase/tests/stage2/run.sh              # both chains, in Docker
#   bash supabase/tests/stage2/run.sh legacy       # just the historical chain
#   STAGE2_LOCAL=1 PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres \
#     bash supabase/tests/stage2/run.sh            # an already-running cluster
#
# Why two chains, and why the order below is fixed:
#
#   bootstrap -> published migrations -> [fixture] -> Stage 2 chain -> Stage 3 chain
#             -> outcome suite -> Stage 3 draft-invariant suite -> attack suite
#             -> catalog suite
#
#   * The chain ends at schema head, which is what a customer's database actually
#     looks like now. The Stage 2 suites therefore qualify the *current* schema, not
#     the schema as of Stage 2's commit: a Stage 3 migration must be shown not to
#     have loosened a Stage 2 guarantee. Stage 2's own totals at commit a51856f were
#     41 / 75 / 322 / 75 and remain reproducible from that commit. On this branch the
#     same two suites print 325 and 94, because Stage 3 and its closure repair added
#     assertions to them (draft-invariant INSERT/DELETE refusals, the `api` schema
#     catalogue, and the `internal_api` half of the boundary); every
#     other number below is the record of this branch, measured, not recalled.
#   * The fixture is applied *between* the published migrations and the Stage 2 chain,
#     so the migration is tested against real-shaped history rather than an empty
#     schema. Skipping it is the clean chain, which proves the opposite half: that the
#     mapping invents nothing.
#   * The outcome suite runs BEFORE the attack suite on purpose. `20_attacks.sql`
#     seeds rows, and psql's `--single-transaction` commits when a file succeeds, so
#     those rows are still there afterwards. Every count in `30_migration_*.sql` was
#     measured on a chain that had not been attacked, and running them in the other
#     order would turn exact numbers into lies.
#   * The catalog suite is last because it reads structure, not data, and the attack
#     suite's `SET ROLE` probes leave no schema changes behind.
#
# Boundary this script cannot cross, stated rather than hidden: it runs plain Postgres
# with `supabase/tests/rls/00_bootstrap.sql` providing `anon` / `authenticated` /
# `service_role` and an `auth.users` table. It therefore proves the schema, the
# grants, the policies and the migration. It does not prove PostgREST or Supabase Auth
# behaviour, because neither is running. See docs/audits/stage-2-domain-database.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-both}"
case "$MODE" in clean|legacy|both) ;; *) echo "usage: $0 [clean|legacy|both]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage2-$$"
export PGCLIENTENCODING=UTF8

if [ "${STAGE2_LOCAL:-0}" = "1" ]; then
  PSQLED=(psql -U "${PGUSER:-postgres}" -d postgres -v ON_ERROR_STOP=1)
  run_sql() { psql -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -q < "$1"; }
  admin_sql() { "${PSQLED[@]}" -q "$@"; }
  echo "==> Backend: existing cluster (PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432})"
else
  cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  echo "==> Starting $IMAGE as $CTR"
  docker run -d --name "$CTR" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null
  for _ in $(seq 1 90); do
    docker exec "$CTR" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$CTR" pg_isready -U postgres >/dev/null 2>&1 \
    || { echo "!! Postgres did not become ready (image pull blocked, or container unavailable)."; \
         echo "!! Use STAGE2_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_sql() { docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
                psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < "$1"; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
fi

# One suite run, its counts echoed, and its assertion total remembered so the summary
# at the end is a measurement rather than a recollection. A suite that fails must print
# why: capturing its output without echoing it on the failure path would turn a real
# red into a silent exit.
RESULTS=""
suite() { # suite <label> <file>
  echo "==> $1"
  local out status=0
  out="$(run_sql "$2" 2>&1)" || status=$?
  echo "$out" | grep -E 'PASSED|ERROR|FAIL' | tail -5
  if [ "$status" -ne 0 ]; then
    echo "!! $1 FAILED (psql exit $status). Full tail of its output:"
    echo "$out" | tail -25
    exit 1
  fi
  RESULTS="$RESULTS
  $1: $(echo "$out" | grep -oE 'PASSED \([0-9]+\)' | tail -1)"
}

chain() { # chain <clean|legacy>
  DB="st2qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)"
  echo "=================================================================="
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"

  echo "==> bootstrap (roles + auth shim)"
  run_sql supabase/tests/rls/00_bootstrap.sql

  local m
  for m in $(ls supabase/migrations/*.sql | grep -vE '_stage[0-9]+_' | sort); do
    run_sql "$m"
  done

  if [ "$1" = legacy ]; then
    echo "==> synthetic legacy fixture"
    run_sql supabase/tests/stage2/10_seed_legacy.sql
  fi

  # Stage files are applied in their own order, then the next stage's, because that is
  # the only order that matches a real deployment: the legacy migration writes its
  # drafts before the Stage 3 draft trigger exists, and the trigger then governs every
  # wedding created from here on. A single flat glob would put the trigger ahead of the
  # migration it is supposed to follow and fail on a duplicate-key error that no real
  # database can reach.
  for m in $(ls supabase/migrations/*.sql | grep _stage2_ | sort); do
    run_sql "$m"
  done
  for m in $(ls supabase/migrations/*.sql | grep _stage3_ | sort); do
    run_sql "$m"
  done

  if [ "$1" = legacy ]; then
    suite "migration outcome (historical rows)" supabase/tests/stage2/30_migration_legacy.sql
  else
    suite "migration outcome (nothing invented)" supabase/tests/stage2/30_migration_empty.sql
  fi

  suite "draft invariant"          supabase/tests/stage3/20_draft_invariant.sql
  suite "publication boundary"    supabase/tests/stage3/30_publication.sql
  suite "privilege + RLS attacks" supabase/tests/stage2/20_attacks.sql
  suite "catalog conformance"     supabase/tests/stage2/40_catalog.sql
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
}

if [ "$MODE" = both ] || [ "$MODE" = clean ];  then chain clean;  fi
if [ "$MODE" = both ] || [ "$MODE" = legacy ]; then chain legacy; fi

echo
echo "==> Stage 2 database qualification"
echo "$RESULTS"
echo "==> Boundary: plain Postgres + role/auth shim. PostgREST and Supabase Auth were"
echo "    not executing, so REST-level behaviour is not claimed by these numbers."
