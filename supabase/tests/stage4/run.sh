#!/usr/bin/env bash
# Stage 4 database qualification runner. Throwaway Postgres only — no remote project,
# no `supabase link`, no `db push`, nothing persisted anywhere.
#
#   bash supabase/tests/stage4/run.sh              # both chains, in Docker
#   bash supabase/tests/stage4/run.sh clean        # just the clean chain
#   STAGE4_LOCAL=1 PGHOST=127.0.0.1 PGPORT=54401 PGUSER=postgres \
#     bash supabase/tests/stage4/run.sh clean      # an already-running cluster
#
# Why this file exists separately from `supabase/tests/stage2/run.sh`. §6 of the Stage 4
# directive: "Add a dedicated Stage 4 suite instead of hiding everything inside Stage 2/3.
# Keep the existing Stage 2/3 counters and print Stage 4 separately." The battery now lives
# under `supabase/tests/stage4/`, and so does its runner. Stage 2's totals are measured by
# Stage 2's runner; the numbers printed here never join them, and neither suite reads the
# other's counter — `50_pack_release.sql` group T asserts that `st2.passed` is unset in its
# own session.
#
# What runs, and in this order:
#
#   bootstrap -> published migrations -> Stage 2 chain -> Stage 3 chain -> Stage 4 chain
#             -> 50_pack_release.sql  (the document battery, one transaction, commits)
#             -> 60_reviewed_fixture.sql (the §8 lifecycle tooling, rolls itself back)
#
#   * The chain ends at schema head, because a lifecycle rule that only holds on an empty
#     catalogue is not a rule.
#   * The two files need two different execution modes, and that is not a detail. The battery
#     commits: its fixtures are rows an approved release can never be deleted from, and the
#     suite is read back afterwards. The §8 fixture *must not* commit: it walks a release to
#     `approved`, proves the DELETE is refused, and then relies on ROLLBACK as the only
#     cleanup §8 allows. Running it under `--single-transaction` would commit it and leave the
#     fixture behind, which is the opposite of what the file asserts.
#
# Where the battery came from. `50_pack_release.sql` was written running inside Stage 2's chain,
# and its first full run there printed 417 while falsifying two of its own assertions — an
# unscoped count of release number 900, and an unscoped claim that no row anywhere names an
# auditor. Both were repaired to read the rows they are about, giving 418, and every exact set in
# the file is filtered to the pack keys the battery itself owns for the same reason. It then
# moved here, and 418 was re-measured on both chains under this runner: a number that survives
# changing the suites that run before it is a number about the schema.
#
# Why each total is cross-checked against the suite's own output. The first real run of
# `60_reviewed_fixture.sql` reported `PASSED (8)` for a fixture that made 57 assertions: its
# counter lived in a session setting, and a setting written inside a transaction is reverted
# when that transaction rolls back — which is exactly the rollback this file requires. Nothing
# failed, and the run looked like a much smaller test. So `suite()` below refuses to print a
# total that disagrees with the number of `NOTICE:  PASS` lines the suite actually emitted. The
# measured agreement on the run recorded in docs/audits/stage-4-tradition-pack-foundation.md is
# 418 = 418 and 57 = 57, on each of the two chains.
#
# That agreed number is not fixed. The chain now prints 426 = 426: §17 case 30's single
# unknown-section-kind claim was split into the arms that are each separately measurable, and
# group A's grants claims were restated after §9 narrowed the customer's read path to a column
# grant. Both totals are reported in the Stage 4 audit; the earlier one is left above rather
# than overwritten, because it is evidence about the schema's earlier shape.
#
# Boundary this script cannot cross, stated rather than hidden: it runs plain Postgres with
# `supabase/tests/rls/00_bootstrap.sql` providing `anon` / `authenticated` / `service_role`
# and an `auth.users` table. It therefore proves the schema, the grants, the policies, the
# triggers and the frozen document. It does not prove PostgREST or Supabase Auth behaviour,
# because neither is running here; that half is the API batteries' job. See
# docs/audits/stage-4-tradition-pack-foundation.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-both}"
case "$MODE" in clean|legacy|both) ;; *) echo "usage: $0 [clean|legacy|both]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage4-$$"
export PGCLIENTENCODING=UTF8

# Every SQL file reaches psql through `sql_bytes`, never through a bare `<` redirect: this
# repository's committed SQL is LF, while a Windows checkout with `core.autocrlf` can hand the
# same file back as CRLF, and psql keeps those CR bytes inside dollar-quoted literals that the
# suites compare exactly. Stripping CR at the stdin boundary makes the database receive the
# committed bytes on every platform. Input normalisation only — no expectation, assertion or
# count is touched, and a genuine regression still fails the same way.
sql_bytes() { tr -d '\r' < "$1"; }

if [ "${STAGE4_LOCAL:-0}" = "1" ]; then
  run_tx()   { sql_bytes "$1" | psql -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -q; }
  run_rollback() { sql_bytes "$1" | psql -d "$DB" -v ON_ERROR_STOP=1 -q; }
  admin_sql() { psql -U "${PGUSER:-postgres}" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
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
         echo "!! Use STAGE4_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_tx() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }
  run_rollback() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
fi

RESULTS=""
suite() { # suite <label> <file> <tx|rollback>
  echo "==> $1  ($([ "$3" = tx ] && echo 'single-transaction, commits' || echo 'own transaction, rolls back'))"
  local out status=0
  if [ "$3" = tx ]; then out="$(run_tx "$2" 2>&1)" || status=$?
  else out="$(run_rollback "$2" 2>&1)" || status=$?; fi
  echo "$out" | grep -E 'PASSED|ERROR|FAIL' | tail -5
  if [ "$status" -ne 0 ]; then
    echo "!! $1 FAILED (psql exit $status). Full tail of its output:"
    echo "$out" | tail -25
    exit 1
  fi
  # The suite's own total, cross-checked against the assertions it actually printed.
  #
  # This exists because `60_reviewed_fixture.sql` was first measured reporting 8 for a run that
  # made 57 assertions: its counter lived in a session setting, and a setting written inside a
  # transaction is reverted when that transaction rolls back. Nothing in the run failed — the
  # instrument simply counted less than it did, and a total that can quietly shrink is not a
  # gate. `PASSED (n)` is the suite's arithmetic; the PASS lines are the evidence. They must
  # agree, and if they do not, neither number is worth printing.
  local reported observed
  reported="$(echo "$out" | grep -oE 'PASSED \([0-9]+\)' | tail -1 | tr -dc '0-9')"
  observed="$(echo "$out" | grep -cE '^NOTICE:  PASS ' || true)"
  if [ -z "$reported" ]; then
    echo "!! $1 printed no PASSED (n) total, so its count is not measurable."
    exit 1
  fi
  if [ "$reported" != "$observed" ]; then
    echo "!! $1 reported $reported assertions but printed $observed PASS lines."
    echo "!! The suite's counter and its own output disagree, so this run's totals cannot be"
    echo "!! trusted. Find which of the two mis-counts before reading any number below."
    exit 1
  fi
  RESULTS="$RESULTS
  $1: PASSED ($reported)  [assertion lines observed: $observed]"
}

chain() { # chain <clean|legacy>
  DB="st4qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)"
  echo "=================================================================="
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"

  echo "==> bootstrap (roles + auth shim)"
  run_tx supabase/tests/rls/00_bootstrap.sql

  local m
  for m in $(ls supabase/migrations/*.sql | grep -vE '_stage[0-9]+_' | sort); do
    run_tx "$m"
  done

  if [ "$1" = legacy ]; then
    echo "==> synthetic legacy fixture"
    run_tx supabase/tests/stage2/10_seed_legacy.sql
  fi

  # Stage files in their own stage order — the only order that matches a real deployment, for
  # the reason `stage2/run.sh` records: the legacy migration writes drafts before the Stage 3
  # draft trigger exists, and the trigger governs everything from there on.
  for stage in stage2 stage3 stage4; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m"
    done
  done

  suite "stage 4 pack documents"    supabase/tests/stage4/50_pack_release.sql  tx
  suite "stage 4 §8 fixture tooling" supabase/tests/stage4/60_reviewed_fixture.sql rollback

  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
}

if [ "$MODE" = both ] || [ "$MODE" = clean ];  then chain clean;  fi
if [ "$MODE" = both ] || [ "$MODE" = legacy ]; then chain legacy; fi

echo
echo "==> Stage 4 database qualification"
echo "$RESULTS"
echo "==> These totals are Stage 4's own. Stage 2's and Stage 3's counters are printed by"
echo "    supabase/tests/stage2/run.sh and are not added to, folded into, or read by these."
echo "==> Boundary: plain Postgres + role/auth shim. PostgREST and Supabase Auth were"
echo "    not executing, so REST-level behaviour is not claimed by these numbers."
