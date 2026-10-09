#!/usr/bin/env bash
# Stage 7 database qualification runner. Throwaway Postgres only — no remote project, no
# `supabase link`, no `db push` against a hosted project, nothing persisted anywhere.
#
#   bash supabase/tests/stage7/run.sh                  # all three chains, in Docker
#   bash supabase/tests/stage7/run.sh review           # Stage 7's own two batteries
#   bash supabase/tests/stage7/run.sh historic         # the twelve older suites, both chains
#   STAGE7_LOCAL=1 PGHOST=127.0.0.1 PGPORT=54401 PGUSER=postgres \
#     bash supabase/tests/stage7/run.sh review         # an already-running cluster
#
# Why the Stage 6 shape is not enough, stated before the code. The Stage 6 runner builds one
# database per chain and runs *everything* in it — the older suites first, then Stage 6's own. That
# works while a suite's assertions are relational. `tests/stage7/80_family_review.sql` ends with a
# census (R1-R7) that counts rows across the whole cluster: "no approval request exists that does not
# belong to one of this battery's three weddings", "exactly one review credential is live". Those are
# true on a chain and false on a chain that has also run `tests/stage2/20_attacks.sql`, which
# deliberately commits seed rows — two weddings, two reviewers, two approval requests — and Stage 2's
# own runner documents that ordering consequence. So Stage 7 splits the databases instead of the
# assertions:
#
#   review    storage fixture -> bootstrap -> published -> stage2..stage7  -> 80, then 90
#   historic  storage fixture -> bootstrap -> published -> [legacy seed]
#             -> stage2..stage7 -> Stage 2's outcome, draft, publication, attack, catalog suites
#             -> Stage 4's two suites -> Stage 5's suites -> Stage 6's suites
#
# 80 before 90, and in the same database: 90 does not build its own family. It reads the wedding, the
# seven asks and the nine credentials 80 committed, and asserts against them by name and by count.
# Running 90 alone is not a weaker test, it is a different one, and it does not pass — which is why
# `review` cannot be given a single-suite argument.
#
# `app.stage_head=stage7` travels to the head-aware assertions for the reason every runner since
# Stage 5 gives: an expectation that only holds at one head has to be duplicated, and one that names
# the head it is measuring is a stronger claim.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql` and
# the Stage 6 storage fixture. It proves the schema, the grants, the policies, the triggers, the
# token store and the state machine as SQL. It does not prove PostgREST, Supabase Auth or the Storage
# API: no review link is opened over HTTP here, no JWT is verified, no header is read. That is the
# separate HTTP battery, and the separate browser tier. See docs/audits/stage-7-family-approval.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-both}"
case "$MODE" in review|historic|both) ;; *) echo "usage: $0 [review|historic|both]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage7-$$"
export PGCLIENTENCODING=UTF8
export PGOPTIONS="-c app.stage_head=stage7"

sql_bytes() { tr -d '\r' < "$1"; }

# Every line this script prints about a suite goes through `mask` on its way out, and the reason is
# specific to Stage 7 rather than defensive theatre. The boundary battery's comparison helper prints
# the value it was given when an assertion fails, and in this workflow one of the values routinely
# compared *is* a live review credential. A failing run would therefore hand its raw token to the
# terminal and to any log the operator redirects — which §I10 forbids in database records, committed
# code, telemetry and logs alike. Masking at the runner is the last place where it can be done for
# every suite at once, including a suite that has not been audited for this yet.
#
# 43 is the measured length of a minted credential (32 random bytes, base64url without padding). The
# pattern also eats Postgres' dashed column separators, which is why the printed output keeps the
# result rows and not the ruler.
mask() { sed -E 's/[A-Za-z0-9_-]{43}/[REDACTED-43]/g'; }

if [ "${STAGE7_LOCAL:-0}" = "1" ]; then
  run_tx()     { sql_bytes "$1" | psql -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -q; }
  run_rollback() { sql_bytes "$1" | psql -d "$DB" -v ON_ERROR_STOP=1 -q; }
  admin_sql()  { psql -U "${PGUSER:-postgres}" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
  probe_sql()  { psql -d "$DB" -v ON_ERROR_STOP=1 -q -tA "$@"; }
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
         echo "!! Use STAGE7_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_tx() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }
  run_rollback() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
  # The census probe needs the chain's own database *and* the chain's own session GUC, so it cannot
  # reuse `admin_sql`: that helper exists to create and drop databases, which only makes sense against
  # the maintenance database, and it carries no `PGOPTIONS`. Measured on the first run of this script,
  # the probe written with `admin_sql` printed `DECLARED_HEAD=(unset) API_NAMES=0 INTERNAL_NAMES=0` —
  # three numbers about the wrong database, sitting in the log directly above the suites that assert
  # 13 and 24. A summary line that measures nothing is worse than no summary line, because it reads as
  # a confirmation.
  probe_sql() { docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q -tA "$@"; }
fi

RESULTS=""
# suite <label> <file> <tx|rollback> <lines|counter>
#
# The fourth argument is stated per suite rather than inferred, because these files do not print
# alike and both styles are legitimate. Measured on the chains this script builds, at this head:
#
#   lines    one `PASS` notice per assertion, so the reported total and the printed lines agree
#            exactly: stage2 42/42 and 76/76 and 103/103, stage4 428/428 and 57/57, stage5 122/122
#            + 50/50 + 124/124, stage6 90/90 + 80/80, stage7 255/255 + 116/116.
#
#   counter  assertions batched behind a group banner, so the two numbers differ by design:
#            20_attacks 464 across 25 banners, 20_draft_invariant 46 across 9 on the clean chain
#            (49 on the legacy one), 30_publication 284 across 231. Demanding equality there would
#            pin a banner count that moves whenever a group is reworded, so those suites keep
#            authority over their own count — each carries a floor assertion inside itself, e.g.
#            `80_family_review.sql` refuses a run below 254 — and the runner prints both numbers so
#            a drift between runs is visible in the log.
suite() {
  [ -f "$2" ] || { echo "!! $1: $2 does not exist — a suite that is not there is not a pass."; exit 1; }
  echo "==> $1  ($([ "$3" = tx ] && echo 'single-transaction, commits' || echo 'own transaction, rolls back'))"
  local out status=0
  if [ "$3" = tx ]; then out="$(run_tx "$2" 2>&1)" || status=$?
  else out="$(run_rollback "$2" 2>&1)" || status=$?; fi
  out="$(printf '%s\n' "$out" | mask)"
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

build_chain() { # build_chain <review|clean|legacy>
  DB="st7qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)  — schema head: Stage 7"
  echo "=================================================================="
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" | mask

  echo "==> bootstrap (roles + auth shim)"
  run_tx supabase/tests/rls/00_bootstrap.sql | mask

  echo "==> storage schema fixture (stands in for the storage service)"
  run_tx supabase/tests/stage6/00_storage_schema.sql | mask

  local m
  for m in $(ls supabase/migrations/*.sql | grep -vE '_stage[0-9]+_' | sort); do
    run_tx "$m" | mask
  done

  if [ "$1" = legacy ]; then
    echo "==> synthetic legacy fixture"
    run_tx supabase/tests/stage2/10_seed_legacy.sql | mask
  fi

  # Stage files in their own stage order — the only order that matches a real deployment, for the
  # reason `stage2/run.sh` records. Stage 7 is appended, not substituted.
  for stage in stage2 stage3 stage4 stage5 stage6 stage7; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m" | mask
    done
  done

  # The surface the Stage 7 batteries then assert against, printed rather than assumed: thirteen
  # exposed wrappers, twenty-four internal bodies, and the head the session declared. A chain that
  # applied Stage 7's migration but produced a different shape here has a problem this script cannot
  # name and the suites below will report as a mismatch.
  probe_sql \
    -c "select 'DECLARED_HEAD=' || coalesce(current_setting('app.stage_head', true), '(unset)')" \
    -c "select 'API_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'" \
    -c "select 'INTERNAL_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'internal_api'" \
    | mask
}

run_stage7_batteries() {
  local found=0 f
  # `[89]*` is the measured shape of this directory: Stage 7's qualification is the 80/90 pair and
  # there is no `00_*` fixture here — the storage fixture this chain needs is Stage 6's, applied by
  # `build_chain` above. Naming the expected prefix is what turns "the loop ran over nothing" into a
  # failure instead of a quiet pass.
  for f in $(ls supabase/tests/stage7/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 7 $(basename "$f" .sql)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 7 suite matched supabase/tests/stage7/[89]*.sql."
    echo "!! The runner would print historic totals only, which is exactly the §13.2 failure shape"
    echo "!! that made this runner exist: an older enumeration that exits 0 while the new stage is"
    echo "!! invisible to it."
    exit 1
  fi
}

run_historic_suites() { # run_historic_suites <clean|legacy>
  if [ "$1" = legacy ]; then
    suite "stage 2 migration outcome (historical rows, at Stage 7 head)" supabase/tests/stage2/30_migration_legacy.sql tx lines
  else
    suite "stage 2 migration outcome (nothing invented, at Stage 7 head)" supabase/tests/stage2/30_migration_empty.sql tx lines
  fi
  # Outcome before attacks, for the reason `stage2/run.sh` gives and this runner is the one place it
  # matters: the attack suite seeds rows, and the outcome counts were measured on a chain that had
  # not been attacked.
  suite "stage 3 draft invariant (at Stage 7 head)" supabase/tests/stage3/20_draft_invariant.sql tx counter
  suite "stage 3 publication boundary (at Stage 7 head)" supabase/tests/stage3/30_publication.sql tx counter
  suite "stage 2 privilege + RLS attacks (at Stage 7 head)" supabase/tests/stage2/20_attacks.sql tx counter
  suite "stage 2 catalog conformance (at Stage 7 head)" supabase/tests/stage2/40_catalog.sql tx lines

  suite "stage 4 pack documents (at Stage 7 head)" supabase/tests/stage4/50_pack_release.sql tx lines
  suite "stage 4 §8 fixture tooling (at Stage 7 head)" supabase/tests/stage4/60_reviewed_fixture.sql rollback lines
  local f
  for f in $(ls supabase/tests/stage5/[0-9]*.sql 2>/dev/null | grep -vE '_rollback\.sql$' | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 7 head)" "$f" tx lines
  done
  for f in $(ls supabase/tests/stage5/*_rollback.sql 2>/dev/null | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 7 head)" "$f" rollback lines
  done
  for f in $(ls supabase/tests/stage6/[89]*.sql 2>/dev/null | sort); do
    suite "stage 6 $(basename "$f" .sql) (at Stage 7 head)" "$f" tx lines
  done
}

if [ "$MODE" = both ] || [ "$MODE" = review ]; then
  build_chain review
  run_stage7_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st7qual_review WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = both ] || [ "$MODE" = historic ]; then
  for variant in clean legacy; do
    build_chain "$variant"
    run_historic_suites "$variant"
    admin_sql -c "DROP DATABASE IF EXISTS st7qual_$variant WITH (FORCE)" >/dev/null | mask
  done
fi

echo
echo "==> Stage 7 database qualification"
echo "$RESULTS"
echo "==> Stage 7's own two batteries ran on a chain that ran nothing else, because 80's closing"
echo "    census counts rows cluster-wide; the twelve older suites ran on chains that had not been"
echo "    given Stage 7's family. Neither set of numbers is evidence about the other database."
echo "==> Every total labelled 'at Stage 7 head' is a re-measurement of an older suite against a"
echo "    schema that contains Stage 7. The older runners' own totals still describe their own heads."
echo "==> Boundary: plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase"
echo "    Auth and the Storage API were not executing, so no REST-level or browser-level claim is"
echo "    carried by these numbers."
