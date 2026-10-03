#!/usr/bin/env bash
# Stage 5 database qualification runner. Throwaway Postgres only — no remote project,
# no `supabase link`, no `db push`, nothing persisted anywhere.
#
#   bash supabase/tests/stage5/run.sh              # both chains, in Docker
#   bash supabase/tests/stage5/run.sh clean        # just the clean chain
#   STAGE5_LOCAL=1 PGHOST=127.0.0.1 PGPORT=54401 PGUSER=postgres \
#     bash supabase/tests/stage5/run.sh clean      # an already-running cluster
#
# Why this runner exists next to Stage 4's rather than replacing it. `stage4/run.sh` publishes
# a schema head at Stage 4 and qualifies it there; that chain, and the totals recorded in the
# Stage 4 audit against it, are evidence about the schema as Stage 4 left it and stay runnable
# unchanged. This file publishes one migration further — Stage 5 re-declares
# `private.guard_tradition_pack_release`, `private.resolve_invitation_sections` and
# `private.invitation_freeze_issues` forward and adds the issue engine, the review-hash
# machinery and the maintenance surface — and asks two different questions of that head:
#
#   1. Does Stage 4's battery still pass? It is re-run here, unmodified in intent, because
#      Stage 5 deliberately made `invitation_freeze_issues` a projection over machine-readable
#      records that reproduce Stage 4's sentences byte-for-byte (audit §3.4). Stage 4's
#      exact-array assertions are therefore the regression test of that refactor: if a sentence
#      or its order drifted, they fail. Four of them measure a *shape* Stage 5 intentionally
#      grew (the closed-walk name list, the two "this version is unknown to this build"
#      literals, and the function-inventory group), and those four are head-aware rather than
#      rewritten — see `pg_temp.s5_head()` in `50_pack_release.sql`. An expectation that only
#      holds at one head would have to be duplicated; an expectation that names which head it
#      is measuring is a stronger claim, and it is the one this runner relies on.
#   2. Do Stage 5's own guarantees hold? That is `70_issue_engine.sql`, `80_review_hash.sql`,
#      `90_maintenance_surface.sql` and the rest of `supabase/tests/stage5/`.
#
# The execution modes are inherited from Stage 4's runner and are not a detail: the document
# battery commits, because its fixtures are rows an approved release can never be deleted from;
# the §8-style lifecycle fixtures must roll back, because they walk a release to `approved` and
# prove the DELETE is refused, with rollback as the only cleanup the retention rule allows.
# `suite()` below therefore keeps Stage 4's cross-check between a suite's own printed total and
# the number of `NOTICE: PASS` lines it emitted — a total that can quietly shrink is not a gate.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql`
# for `anon` / `authenticated` / `service_role` and an `auth.users` shim. It proves the schema,
# the grants, the policies, the triggers, the record engine and the maintenance surface as SQL.
# It does not prove PostgREST or Supabase Auth behaviour — neither runs here — which is why the
# HTTP battery is a separate tier. See docs/audits/stage-5-pack-driven-authoring-review.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-both}"
case "$MODE" in clean|legacy|both) ;; *) echo "usage: $0 [clean|legacy|both]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage5-$$"
export PGCLIENTENCODING=UTF8

# Which head is being qualified, declared to every suite that asks (see `pg_temp.s4_head()`).
# It travels as a connection option rather than as a SQL edit because the suites run in their
# own sessions and must not be able to change the expectation they are being held to.
export PGOPTIONS="-c app.stage_head=stage5"

# Every SQL file reaches psql through `sql_bytes`, never a bare `<`: committed SQL is LF while a
# Windows checkout with `core.autocrlf` can hand the same file back as CRLF, and psql keeps those
# CR bytes inside dollar-quoted literals the suites compare exactly. Input normalisation only —
# no expectation, assertion or count is touched.
sql_bytes() { tr -d '\r' < "$1"; }

if [ "${STAGE5_LOCAL:-0}" = "1" ]; then
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
         echo "!! Use STAGE5_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_tx() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }
  run_rollback() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
fi

RESULTS=""
suite() { # suite <label> <file> <tx|rollback>
  [ -f "$2" ] || { echo "==> $1 skipped: $2 does not exist yet"; return 0; }
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
  DB="st5qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)  — schema head: Stage 5"
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
  # the reason `stage2/run.sh` records. Stage 5 is appended, not substituted: it is a forward
  # migration over the Stage 4 head, so a chain that skipped Stage 4 would not be this product.
  for stage in stage2 stage3 stage4 stage5; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m"
    done
  done

  # ---- Stage 4's qualification, re-run at the new head (question 1 above)
  suite "stage 4 pack documents (at Stage 5 head)" supabase/tests/stage4/50_pack_release.sql tx
  suite "stage 4 §8 fixture tooling (at Stage 5 head)" supabase/tests/stage4/60_reviewed_fixture.sql rollback

  # ---- Stage 5's own qualification
  for f in $(ls supabase/tests/stage5/*.sql 2>/dev/null | grep -vE '_rollback\.sql$' | sort); do
    suite "stage 5 $(basename "$f" .sql)" "$f" tx
  done
  for f in $(ls supabase/tests/stage5/*_rollback.sql 2>/dev/null | sort); do
    suite "stage 5 $(basename "$f" .sql)" "$f" rollback
  done

  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
}

if [ "$MODE" = both ] || [ "$MODE" = clean ];  then chain clean;  fi
if [ "$MODE" = both ] || [ "$MODE" = legacy ]; then chain legacy; fi

echo
echo "==> Stage 5 database qualification"
echo "$RESULTS"
echo "==> Stage 4's totals printed above were measured at the Stage 5 head. Stage 4's own"
echo "    runner still measures them at the Stage 4 head; neither set is added to the other."
echo "==> Boundary: plain Postgres + role/auth shim. PostgREST and Supabase Auth were"
echo "    not executing, so REST-level behaviour is not claimed by these numbers."
