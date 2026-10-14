#!/usr/bin/env bash
# Stage 9 database qualification runner. Throwaway Postgres only — no remote project, no
# `supabase link`, no `db push` against a hosted project, nothing persisted anywhere.
#
#   bash supabase/tests/stage9/run.sh                     # every chain, in Docker
#   bash supabase/tests/stage9/run.sh render              # Stage 9's own batteries
#   bash supabase/tests/stage9/run.sh guest               # Stage 8's pair, at the Stage 9 head
#   bash supabase/tests/stage9/run.sh family              # Stage 7's pair, at the Stage 9 head
#   bash supabase/tests/stage9/run.sh historic            # the older suites, both chain variants
#   STAGE9_LOCAL=1 PGHOST=127.0.0.1 PGPORT=54401 PGUSER=postgres \
#     bash supabase/tests/stage9/run.sh render            # an already-running cluster
#
# Why this file exists at all, before why it is shaped this way. Every runner before it applies
# `ls supabase/migrations/*.sql | grep -vE '_stage[0-9]+_'` and then loops its own stage order, so a
# `*_stage9_*` migration is invisible to all of them: `stage8/run.sh historic` reaches `stage8` and
# stops. Running Stage 2's catalogue at a Stage 8 head against a schema that contains Stage 9 would
# not be a re-measurement, it would be a measurement of a chain that was never built. So the head
# moves here, and the suites below it are re-measured against it.
#
# Why there are four kinds of chain. The reason is the same one `stage8/run.sh` records and it did not
# expire: both of Stage 8's batteries and both of Stage 7's end with a census that counts
# *cluster-wide* — how many guest households exist anywhere, how many credentials of each kind are
# live, the global `rsvp_responses` total, whether the `rsvp` token kind is still unused, how many
# approval requests and review credentials exist. Those are true on a chain that ran nothing but that
# pair, and false on a chain that has also run `tests/stage2/20_attacks.sql`, which deliberately
# commits seed rows. Stage 9's own batteries add a third census of exactly that shape — the output
# manifest's row counts and the bucket inventory are read cluster-wide — so they get their own empty
# chain too rather than joining the historic sweep and being read as a failure they are not.
#
#   render    bootstrap -> storage fixture -> published -> stage2..stage9 -> Stage 9's 80, then 90
#   guest     bootstrap -> storage fixture -> published -> stage2..stage9 -> Stage 8's 80, then 90
#   family    bootstrap -> storage fixture -> published -> stage2..stage9 -> Stage 7's 80, then 90
#   historic  bootstrap -> storage fixture -> published -> [legacy seed]
#             -> stage2..stage9 -> Stage 2's outcome, draft, publication, attack and catalog suites
#             -> Stage 4's two suites -> Stage 5's suites -> Stage 6's suites
#
# The `historic` sweep contains neither stage's own pair, so the totals it prints are re-measurements
# of *older* suites against a schema that contains Stage 9. They say nothing about the guest or render
# censuses and those say nothing about these. That is a property of the instrument, not a gap in it,
# and the three sections are labelled accordingly at the end.
#
# `app.stage_head=stage9` travels to the head-aware assertions for the reason every runner since
# Stage 5 gives: an expectation that only holds at one head has to be duplicated, and one that names
# the head it is measuring is a stronger claim. `pg_temp.st2_at_least()` accepts any `stage<N>` so the
# machinery itself needs no change — what changes is which branch each head-aware case takes.
#
# Two numbers are stated by the chain probe below and both are owned by this head, so neither is
# inherited from `stage8/run.sh`'s nineteen and thirty: Stage 9 appends exactly two names to `api` and
# two to `internal_api`, which makes twenty-one and thirty-two. A chain that applied Stage 9's
# migration and printed anything else has a problem this script cannot name and the suites below
# report as a mismatch.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql` and
# the Stage 6 storage-schema fixture. It proves the schema, the grants, the policies, the triggers,
# the token store, the event scoping, the RSVP state machine and the output manifest as SQL. It does
# not prove PostgREST, Supabase Auth or the Storage API: no rendered image is produced here, no PDF is
# byte-compared, no `x-guest-token` header is read by a gateway, no browser opens a share card, and no
# object is actually uploaded to a bucket. That is the separate render tier, HTTP battery and browser
# tier. See docs/audits/stage-9-render-exports.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-all}"
case "$MODE" in render|guest|family|historic|all) ;; *) echo "usage: $0 [render|guest|family|historic|all]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage9-$$"
export PGCLIENTENCODING=UTF8
export PGOPTIONS="-c app.stage_head=stage9"

sql_bytes() { tr -d '\r' < "$1"; }

# Every line this script prints about a suite goes through `mask` on its way out. Stage 8's runner
# introduced this for the raw guest credentials its batteries mint; Stage 9 keeps it for the same
# reason and one of its own: the preview key this stage mints is also a 43-character unguessable
# string, and while it is not a credential in the sense a guest token is, the published-preview row's
# key is the only thing standing between an opaque URL and a random guess, and a failing assertion
# that prints the value it was handed would put it in the terminal and in any log the operator
# redirects. The pattern also eats Postgres' dashed column separators, which is why the printed output
# keeps the result rows and not the ruler.
mask() { sed -E 's/[A-Za-z0-9_-]{43}/[REDACTED-43]/g'; }

if [ "${STAGE9_LOCAL:-0}" = "1" ]; then
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
         echo "!! Use STAGE9_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_tx() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }
  # `-U postgres` here too, and its absence was measured rather than guessed: Stage 9's first
  # `historic` run died silently at `stage4/60_reviewed_fixture.sql`, the one rollback-style suite in
  # the sweep, because `docker exec` inherits no `PGUSER` and psql tried to connect as `root` — so
  # every file this runner reaches without `--single-transaction` was in fact never executed.
  run_rollback() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
  # The census probe needs the chain's own database *and* the chain's own session GUC, so it cannot
  # reuse `admin_sql`: that helper exists to create and drop databases, which only makes sense against
  # the maintenance database, and it carries no `PGOPTIONS`. Stage 7's runner recorded this as a
  # measured failure of its own instrument — a probe written with `admin_sql` printed three zeros
  # about the wrong database, sitting above suites that assert real counts — and the same trap is here
  # unchanged, because a summary line that measures nothing is worse than no summary line.
  probe_sql() { docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q -tA "$@"; }
fi

RESULTS=""
# suite <label> <file> <tx|rollback> <lines|counter>
#
# The fourth argument is stated per suite rather than inferred, because these files do not print alike
# and both styles are legitimate. Stage 9's own batteries use `lines` for the reason each runner since
# Stage 8 gives: the reported total and the printed line count must agree exactly, and this script
# refuses the run when they do not.
suite() {
  [ -f "$2" ] || { echo "!! $1: $2 does not exist — a suite that is not there is not a pass."; exit 1; }
  echo "==> $1  ($([ "$3" = tx ] && echo 'single-transaction, commits' || echo 'own transaction, rolls back'))"
  local out status=0
  if [ "$3" = tx ]; then out="$(run_tx "$2" 2>&1)" || status=$?
  else out="$(run_rollback "$2" 2>&1)" || status=$?; fi
  out="$(printf '%s\n' "$out" | mask)"
  # The `|| true` keeps this line's exit status from becoming the runner's. Under `pipefail` a suite
  # that dies with a message that is none of these words — `psql: error: connection …` is spelled in
  # lower case — ended the script here, silently, before the handler below could report the exit
  # status it had already captured. Nothing is loosened: the status check and the empty-total check
  # both still fail the run, and a green suite that prints no `PASSED (n)` is still a failure.
  echo "$out" | { grep -E 'PASSED|ERROR|FAIL' || true; } | tail -5
  if [ "$status" -ne 0 ]; then
    echo "!! $1 FAILED (psql exit $status). Full tail of its output:"
    echo "$out" | tail -40
    exit 1
  fi
  local reported observed
  reported="$(echo "$out" | grep -oE 'PASSED \([0-9]+\)' | tail -1 | tr -dc '0-9')"
  observed="$(echo "$out" | grep -cE '^NOTICE:  PASS ' || true)"
  if [ "$reported" = "" ]; then
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

build_chain() { # build_chain <render|guest|family|clean|legacy>
  DB="st9qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)  — schema head: Stage 9"
  echo "=================================================================="
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" | mask

  echo "==> bootstrap (roles + auth shim)"
  run_tx supabase/tests/rls/00_bootstrap.sql | mask

  # Stage 9's migration inserts two rows into `storage.buckets`, so the fixture that stands in for the
  # storage service has to exist before the stage loop, exactly as it does for Stages 6 to 8. Applying
  # it after the migrations would make the INSERT fail on a missing table and the failure would read as
  # a schema defect rather than as an instrument that was assembled in the wrong order.
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
  # reason `stage2/run.sh` records. Stage 9 is appended, not substituted: the migrations it depends on
  # (`invitation_versions`, the asset registry, the storage guard triggers) stay where their own
  # stages put them.
  for stage in stage2 stage3 stage4 stage5 stage6 stage7 stage8 stage9; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m" | mask
    done
  done

  # The surface the Stage 9 batteries then assert against, printed rather than assumed: twenty-one
  # exposed wrappers and thirty-two internal bodies at the head this session declared. Both numbers are
  # re-derivable without running anything — Stage 8's runner measured nineteen and thirty at its own
  # head, and Stage 9's migration adds exactly two names to each schema:
  #
  #   api.           render_invitation_document, list_invitation_outputs
  #   internal_api.  the same two bodies
  #
  # The maintenance surface does not move: eleven names, none of them wrapped, and Stage 9 adds no
  # privileged act. Read these as rows of `pg_proc`, not as names in source — a name declared twice
  # with two argument lists would count twice here and once in a grep.
  probe_sql \
    -c "select 'DECLARED_HEAD=' || coalesce(current_setting('app.stage_head', true), '(unset)')" \
    -c "select 'API_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'" \
    -c "select 'INTERNAL_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'internal_api'" \
    -c "select 'PUBLIC_TABLES=' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'" \
    -c "select 'STORAGE_BUCKETS=' || count(*) || ': ' || coalesce(string_agg(b.id, ', ' ORDER BY b.id), '(none)') from storage.buckets b" \
    | mask
}

run_stage9_batteries() {
  local found=0 f
  # `[89]*` is the shape every runner since Stage 7 uses, and the fail-if-zero guard below it is the
  # reason that shape is safe. Stage 9's own batteries are the 80/90 pair; naming the expected prefix
  # is what turns "the loop ran over nothing" into a failure instead of a quiet pass. Until they
  # exist — this stage's render tier is written after the substrate — `render` and `all` exit 1 here,
  # which is the honest reading: a stage whose own assertions are missing has not been qualified,
  # whatever the historic suites say about it.
  for f in $(ls supabase/tests/stage9/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 9 $(basename "$f" .sql)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 9 suite matched supabase/tests/stage9/[89]*.sql."
    echo "!! The runner would print historic totals only, which is the failure shape the Stage 7 runner"
    echo "!! records: an older enumeration that exits 0 while the new stage is invisible to it."
    exit 1
  fi
}

run_stage8_batteries() {
  local found=0 f
  # Stage 8's pair is re-run here, at the Stage 9 head, on a chain that runs nothing else — the same
  # isolation its own runner gave its censuses. A drift between this section's totals and the ones
  # `stage8/run.sh` printed at Stage 8's head is the point of running it: Stage 9 adds a table and two
  # buckets to a schema whose guest censuses count rows and buckets cluster-wide.
  for f in $(ls supabase/tests/stage8/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 8 $(basename "$f" .sql) (at Stage 9 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 8 suite matched supabase/tests/stage8/[89]*.sql, so the guest boundary was never"
    echo "!! re-measured against this schema. That is a missing regression, not a pass."
    exit 1
  fi
}

run_stage7_batteries() {
  local found=0 f
  for f in $(ls supabase/tests/stage7/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 7 $(basename "$f" .sql) (at Stage 9 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 7 suite matched supabase/tests/stage7/[89]*.sql, so the family review boundary was"
    echo "!! never re-measured against this schema. That is a missing regression, not a pass."
    exit 1
  fi
}

run_historic_suites() { # run_historic_suites <clean|legacy>
  if [ "$1" = legacy ]; then
    suite "stage 2 migration outcome (historical rows, at Stage 9 head)" supabase/tests/stage2/30_migration_legacy.sql tx lines
  else
    suite "stage 2 migration outcome (nothing invented, at Stage 9 head)" supabase/tests/stage2/30_migration_empty.sql tx lines
  fi
  # Outcome before attacks, for the reason `stage2/run.sh` gives and this runner is the one place it
  # matters: the attack suite seeds rows, and the outcome counts were measured on a chain that had not
  # been attacked.
  suite "stage 3 draft invariant (at Stage 9 head)" supabase/tests/stage3/20_draft_invariant.sql tx counter
  suite "stage 3 publication boundary (at Stage 9 head)" supabase/tests/stage3/30_publication.sql tx counter
  suite "stage 2 privilege + RLS attacks (at Stage 9 head)" supabase/tests/stage2/20_attacks.sql tx counter
  suite "stage 2 catalog conformance (at Stage 9 head)" supabase/tests/stage2/40_catalog.sql tx lines

  suite "stage 4 pack documents (at Stage 9 head)" supabase/tests/stage4/50_pack_release.sql tx lines
  suite "stage 4 §8 fixture tooling (at Stage 9 head)" supabase/tests/stage4/60_reviewed_fixture.sql rollback lines
  local f
  for f in $(ls supabase/tests/stage5/[0-9]*.sql 2>/dev/null | grep -vE '_rollback\.sql$' | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 9 head)" "$f" tx lines
  done
  for f in $(ls supabase/tests/stage5/*_rollback.sql 2>/dev/null | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 9 head)" "$f" rollback lines
  done
  for f in $(ls supabase/tests/stage6/[89]*.sql 2>/dev/null | sort); do
    suite "stage 6 $(basename "$f" .sql) (at Stage 9 head)" "$f" tx lines
  done
}

if [ "$MODE" = all ] || [ "$MODE" = render ]; then
  build_chain render
  run_stage9_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st9qual_render WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = guest ]; then
  build_chain guest
  run_stage8_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st9qual_guest WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = family ]; then
  build_chain family
  run_stage7_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st9qual_family WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = historic ]; then
  for variant in clean legacy; do
    build_chain "$variant"
    run_historic_suites "$variant"
    admin_sql -c "DROP DATABASE IF EXISTS st9qual_$variant WITH (FORCE)" >/dev/null | mask
  done
fi

echo
echo "==> Stage 9 database qualification"
echo "$RESULTS"
echo "==> Stage 9's own batteries ran on a chain that ran nothing else, because their closing census"
echo "    counts manifest rows and bucket ids cluster-wide; Stage 8's and Stage 7's pairs each ran on"
echo "    their own empty chain for the reason their own runners give. The older suites ran on chains"
echo "    that had not been given Stage 9's output rows. No set of numbers here is evidence about"
echo "    another database, and none of them should be quoted as if it were."
echo "==> Every total labelled 'at Stage 9 head' is a re-measurement of an older suite against a schema"
echo "    that contains Stage 9. The older runners' own totals still describe their own heads."
echo "==> Boundary: plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase Auth"
echo "    and the Storage API were not executing, and nothing was rendered — no image, no PDF, no QR"
echo "    payload and no byte comparison is carried by these numbers. The manifest's shape, its grants,"
echo "    its lifecycle and its read surface are; the artefacts themselves belong to the render, HTTP"
echo "    and browser tiers."
