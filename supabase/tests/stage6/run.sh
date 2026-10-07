#!/usr/bin/env bash
# Stage 6 database qualification runner. Throwaway Postgres only — no remote project,
# no `supabase link`, no `db push` against a hosted project, nothing persisted anywhere.
#
#   bash supabase/tests/stage6/run.sh              # both chains, in Docker
#   bash supabase/tests/stage6/run.sh clean        # just the clean chain
#   STAGE6_LOCAL=1 PGHOST=127.0.0.1 PGPORT=54401 PGUSER=postgres \
#     bash supabase/tests/stage6/run.sh clean      # an already-running cluster
#
# Why this runner exists, in one sentence stated before the code: the Stage 2 and Stage 4 runners
# enumerate `for stage in stage2 stage3 stage4` and the Stage 5 runner enumerates up to `stage5`, so
# a migration named `_stage6_` is invisible to all three — and all three still exit 0. That is the
# finding recorded in audit §13.2, and it is the reason the historic suites are re-run *here*, at the
# Stage 6 head, rather than trusted from a run whose schema did not contain Stage 6. The older
# runners stay exactly as they are, because their printed totals are evidence about the head they
# measured and rewriting them would make those numbers unreproducible.
#
#   storage fixture -> bootstrap -> published migrations -> [legacy fixture]
#             -> stage2..stage6 migrations
#             -> Stage 2's outcome, attack and catalog suites (at the Stage 6 head)
#             -> Stage 3's draft-invariant and publication suites
#             -> Stage 4's document + fixture-tooling suites
#             -> Stage 5's three suites
#             -> Stage 6's own suites
#
# The fixture is first among the schema-shaping steps on purpose. `storage.buckets` and
# `storage.objects` are created by the storage service on a real stack — measured on `supabase db
# reset`, where the Stage 6 migration applied cleanly because the schema already existed — so a bare
# Postgres cluster needs the same shape put in front of the app migrations or the Stage 6 file stops
# on a missing relation and the battery never measures a policy. See
# `supabase/tests/stage6/00_storage_schema.sql` for what that fixture reproduces and, explicitly,
# what it does not.
#
# `app.stage_head=stage6` travels to the head-aware assertions for the same reason Stage 5 set
# `stage5`: an expectation that only holds at one head has to be duplicated, and one that names the
# head it is measuring is a stronger claim.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql` and
# the storage fixture. It proves the schema, the grants, the policies, the triggers and the registry
# state machine as SQL. It does not prove PostgREST, Supabase Auth or the Storage API — no upload,
# no signed URL, no bucket-level MIME or size refusal happens here — which is why the HTTP and
# browser tiers are separate. See docs/audits/stage-6-storage-assets.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-both}"
case "$MODE" in clean|legacy|both) ;; *) echo "usage: $0 [clean|legacy|both]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage6-$$"
export PGCLIENTENCODING=UTF8
export PGOPTIONS="-c app.stage_head=stage6"

sql_bytes() { tr -d '\r' < "$1"; }

if [ "${STAGE6_LOCAL:-0}" = "1" ]; then
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
         echo "!! Use STAGE6_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_tx() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }
  run_rollback() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
fi

RESULTS=""
# suite <label> <file> <tx|rollback> <lines|counter>
#
# The fourth argument is stated per suite rather than inferred, because these files do not
# print alike, and both styles are legitimate:
#
#   lines    the suite raises one `PASS` notice per assertion, so the runner can cross-check the
#            total it reported against the output it actually produced. This is the check
#            `stage5/run.sh` makes, kept here for every suite that supports it. Measured at this
#            head: 30_migration_empty 42/42, 30_migration_legacy 76/76, 40_catalog 103/103,
#            50_pack_release 428/428, 60_reviewed_fixture 57/57, stage5 122/122 + 50/50 + 124/124,
#            stage6 90/90 + 80/80.
#
#   counter  the suite batches assertions behind a group banner, so its reported total and its
#            banner count differ by design. Measured at this head: 20_attacks 464 across 25
#            banners, 20_draft_invariant 46 across 9, 30_publication 284 across 231. Demanding
#            equality there would pin a banner count that moves whenever a group is reworded,
#            which is a second brittle instrument rather than a stronger one — so those suites
#            keep authority over their own count (each carries a floor assertion inside itself,
#            e.g. `20_attacks.sql` refuses a run below 458) and the runner prints both numbers
#            so a drift between runs is visible in the log.
suite() {
  [ -f "$2" ] || { echo "!! $1: $2 does not exist — a suite that is not there is not a pass."; exit 1; }
  echo "==> $1  ($([ "$3" = tx ] && echo 'single-transaction, commits' || echo 'own transaction, rolls back'))"
  local out status=0
  if [ "$3" = tx ]; then out="$(run_tx "$2" 2>&1)" || status=$?
  else out="$(run_rollback "$2" 2>&1)" || status=$?; fi
  echo "$out" | grep -E 'PASSED|ERROR|FAIL' | tail -5
  if [ "$status" -ne 0 ]; then
    echo "!! $1 FAILED (psql exit $status). Full tail of its output:"
    echo "$out" | tail -40
    exit 1
  fi
  local reported observed
  reported="$(echo "$out" | grep -oE 'PASSED \([0-9]+\)' | tail -1 | tr -dc '0-9')"
  observed="$(echo "$out" | grep -cE '^NOTICE:  PASS ' || true)"
  if [ -z "$reported" ]; then
    echo "!! $1 printed no PASSED (n) total, so its count is not measurable."
    exit 1
  fi
  case "$4" in
    lines)
      if [ "$reported" != "$observed" ]; then
        echo "!! $1 reported $reported assertions but printed $observed PASS lines."
        echo "!! The suite's counter and its own output disagree, so this run's totals cannot be"
        echo "!! trusted. Find which of the two mis-counts before reading any number below."
        exit 1
      fi ;;
    counter)
      if [ "$observed" -lt 1 ]; then
        echo "!! $1 reported $reported assertions but printed no PASS line at all, so the run"
        echo "!! cannot be shown to have executed anything."
        exit 1
      fi ;;
    *)
      echo "!! $1: suite style must be 'lines' or 'counter', got '$4'."
      exit 1 ;;
  esac
  RESULTS="$RESULTS
  $1: PASSED ($reported)  [PASS lines observed: $observed, counted: $4]"
}

chain() { # chain <clean|legacy>
  DB="st6qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)  — schema head: Stage 6"
  echo "=================================================================="
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"

  echo "==> bootstrap (roles + auth shim)"
  run_tx supabase/tests/rls/00_bootstrap.sql

  echo "==> storage schema fixture (stands in for the storage service)"
  run_tx supabase/tests/stage6/00_storage_schema.sql

  local m
  for m in $(ls supabase/migrations/*.sql | grep -vE '_stage[0-9]+_' | sort); do
    run_tx "$m"
  done

  if [ "$1" = legacy ]; then
    echo "==> synthetic legacy fixture"
    run_tx supabase/tests/stage2/10_seed_legacy.sql
  fi

  # Stage files in their own stage order — the only order that matches a real deployment, for the
  # reason `stage2/run.sh` records. Stage 6 is appended, not substituted.
  for stage in stage2 stage3 stage4 stage5 stage6; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m"
    done
  done

  # ---- Stage 2's own suites, re-run at the new head. The outcome suite comes before the attack
  # ---- suite for the reason `stage2/run.sh` gives: the attack suite seeds rows, and the outcome
  # ---- counts were measured on a chain that had not been attacked.
  if [ "$1" = legacy ]; then
    # Counted as `lines`, and that is a measurement rather than a guess. The entry was written as
    # `counter` because a clone could not reproduce the legacy fixture in front of the stage chain,
    # so the pair had never been observed here. Measured on the chain that commits the legacy
    # fixture and every stage migration through Stage 6: this suite reported 76 assertions and
    # printed 76 `NOTICE:  PASS ` lines, so the two agree exactly and the stricter rule is the one
    # this suite can be held to. Its clean twin prints 42/42 for the same reason.
    suite "stage 2 migration outcome (historical rows, at Stage 6 head)" supabase/tests/stage2/30_migration_legacy.sql tx lines
  else
    suite "stage 2 migration outcome (nothing invented, at Stage 6 head)" supabase/tests/stage2/30_migration_empty.sql tx lines
  fi
  suite "stage 3 draft invariant (at Stage 6 head)" supabase/tests/stage3/20_draft_invariant.sql tx counter
  suite "stage 3 publication boundary (at Stage 6 head)" supabase/tests/stage3/30_publication.sql tx counter
  suite "stage 2 privilege + RLS attacks (at Stage 6 head)" supabase/tests/stage2/20_attacks.sql tx counter
  suite "stage 2 catalog conformance (at Stage 6 head)" supabase/tests/stage2/40_catalog.sql tx lines

  # ---- Stage 4's and Stage 5's suites, likewise.
  suite "stage 4 pack documents (at Stage 6 head)" supabase/tests/stage4/50_pack_release.sql tx lines
  suite "stage 4 §8 fixture tooling (at Stage 6 head)" supabase/tests/stage4/60_reviewed_fixture.sql rollback lines
  for f in $(ls supabase/tests/stage5/[0-9]*.sql 2>/dev/null | grep -vE '_rollback\.sql$' | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 6 head)" "$f" tx lines
  done
  for f in $(ls supabase/tests/stage5/*_rollback.sql 2>/dev/null | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 6 head)" "$f" rollback lines
  done

  # ---- Stage 6's own qualification. `00_*` is the fixture, not a suite, so it is excluded by the
  # ---- pattern rather than by a skip that would read as a pass.
  local found=0
  for f in $(ls supabase/tests/stage6/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 6 $(basename "$f" .sql)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 6 suite matched supabase/tests/stage6/[89]*.sql."
    echo "!! The runner would print historic totals only, which is exactly the §13.2 failure shape."
    exit 1
  fi

  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
}

if [ "$MODE" = both ] || [ "$MODE" = clean ];  then chain clean;  fi
if [ "$MODE" = both ] || [ "$MODE" = legacy ]; then chain legacy; fi

echo
echo "==> Stage 6 database qualification"
echo "$RESULTS"
echo "==> Every total labelled 'at Stage 6 head' is a re-measurement of an older suite against a"
echo "    schema that contains Stage 6. The older runners' own totals still describe their own heads;"
echo "    neither set is added to the other and no number here is quoted from a previous run."
echo "==> Boundary: plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase"
echo "    Auth and the Storage API were not executing, so REST-level and byte-level behaviour is not"
echo "    claimed by these numbers."
