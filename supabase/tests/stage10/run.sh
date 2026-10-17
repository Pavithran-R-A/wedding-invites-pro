#!/usr/bin/env bash
# Stage 10 database qualification runner. Throwaway Postgres only — no remote project, no
# `supabase link`, no `db push` against a hosted project, nothing persisted anywhere.
#
#   bash supabase/tests/stage10/run.sh                     # every chain, in Docker
#   bash supabase/tests/stage10/run.sh commerce            # Stage 10's own batteries
#   bash supabase/tests/stage10/run.sh render              # Stage 9's pair, at the Stage 10 head
#   bash supabase/tests/stage10/run.sh guest               # Stage 8's pair, at the Stage 10 head
#   bash supabase/tests/stage10/run.sh family              # Stage 7's pair, at the Stage 10 head
#   bash supabase/tests/stage10/run.sh historic            # the older suites, both chain variants
#   STAGE10_LOCAL=1 PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres \
#     bash supabase/tests/stage10/run.sh historic          # an already-running cluster
#
# The shape of this file is Stage 9's, deliberately: a new head gets a new runner whose chain reaches
# the new head, and every suite below it is re-measured against it. That is not ceremony. Each runner
# applies `ls supabase/migrations/*.sql | grep -vE '_stage[0-9]+_'` and then loops its own stage order,
# so a `*_stage10_*` migration is invisible to every runner before it — `stage9/run.sh historic` reaches
# `stage9` and stops. Running Stage 2's catalogue at a Stage 9 head against a schema that contains
# Stage 10 would not be a re-measurement, it would be a measurement of a chain that was never built.
#
# Why there are five kinds of chain, which is Stage 8's and Stage 9's reason plus one of Stage 10's own.
# Both of Stage 8's batteries, both of Stage 7's, and Stage 9's pair each end with a census that counts
# *cluster-wide* — how many guest households exist anywhere, how many credentials of each kind are
# live, the global `rsvp_responses` total, the output manifest's row counts, the bucket inventory. Those
# are true on a chain that ran nothing but that pair and false on a chain that has also run
# `tests/stage2/20_attacks.sql`, which deliberately commits seed rows. Stage 10's own batteries add a
# ledger census of exactly that shape — event rows, applied/duplicate/held tallies, entitlement counts —
# so they get their own empty chain rather than joining the historic sweep and being read as a failure
# they are not.
#
#   commerce  bootstrap -> storage fixture -> published -> stage2..stage10 -> Stage 10's 80, then 90
#   render    bootstrap -> storage fixture -> published -> stage2..stage10 -> Stage 9's 80, then 90
#   guest     bootstrap -> storage fixture -> published -> stage2..stage10 -> Stage 8's 80, then 90
#   family    bootstrap -> storage fixture -> published -> stage2..stage10 -> Stage 7's 80, then 90
#   historic  bootstrap -> storage fixture -> published -> [legacy seed]
#             -> stage2..stage10 -> Stage 2's outcome, draft, publication, attack and catalog suites
#             -> Stage 4's two suites -> Stage 5's suites -> Stage 6's suites
#
# The `historic` sweep contains no stage's own pair — not Stage 10's, not Stage 9's, not Stage 8's or
# Stage 7's — for the reason the paragraph above gives: each of those pairs ends by counting rows that
# the attack suite has deliberately seeded. So the totals `historic` prints re-measure *older catalogues
# and boundaries* against a schema that contains Stage 10. They say nothing about the commerce or render
# censuses and those say nothing about these. That is a property of the instrument, not a gap in it, and
# the sections are labelled accordingly at the end.
#
# `app.stage_head=stage10` travels to the head-aware assertions for the reason every runner since
# Stage 5 gives: an expectation that only holds at one head has to be duplicated, and one that names
# the head it is measuring is a stronger claim. `pg_temp.st2_at_least()` accepts any `stage<N>` so the
# machinery itself needs no change — what changes is which branch each head-aware case takes. Stage 10
# is the first head that moves a *behaviour* rather than only an inventory: the publish gate on
# `public.publications` is inert while `publish_gate = 'permissive'`, which is the default the migration
# ships, so every historical publication suite must still pass unmodified. If one of them refuses to
# publish, that is a Stage 10 defect and not a stale expectation, and `commerce`'s chain is where the
# difference would show.
#
# What this head adds to the declared surface, stated as a derivation rather than a guess, so a chain
# probe that prints something else is a finding and not a surprise: Stage 10 appends exactly one name to
# `api` (`commerce_host_summary`) and seven to `internal_api` (`create_commerce_order`,
# `grant_commerce_entitlement`, `revoke_commerce_entitlement`, `expire_commerce_order`,
# `record_commerce_event`, `commerce_reconcile`, `commerce_host_summary`), which makes twenty-two and
# thirty-nine against Stage 9's twenty-one and thirty-two. Six tables and one policy row land in
# `private`, not `public`, so `PUBLIC_TABLES` and `STORAGE_BUCKETS` must not move: a head that changes
# the customer-facing inventory while claiming to add only a server-side ledger has put its tables where
# an API role can see them. The numbers below are printed from `pg_proc` and `pg_class`, never grepped
# out of source, because a name declared twice with two argument lists counts twice here and once in a
# grep.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql` and the
# Stage 6 storage-schema fixture. It proves the ledger schema, the append-only triggers, the freeze
# guards, the grants, the policies, the state machine, the idempotency rule and the host summary as SQL.
# It does not prove PostgREST, Supabase Auth, the Storage API or an HTTP webhook endpoint: no provider
# signature is verified here (that is `scripts/stage10-webhook-core.mjs` and the HTTP tier), no
# `x-provider` header is read by a gateway, no browser opens a pricing panel, and no customer is charged.
# See docs/audits/stage-10-commerce-foundations.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-all}"
case "$MODE" in commerce|render|guest|family|historic|all) ;; *) echo "usage: $0 [commerce|render|guest|family|historic|all]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage10-$$"
export PGCLIENTENCODING=UTF8
export PGOPTIONS="-c app.stage_head=stage10"

sql_bytes() { tr -d '\r' < "$1"; }

# Every line this script prints about a suite goes through `mask` on its way out, for the reason the
# Stage 8 runner introduced it and the Stage 9 runner kept it. Stage 10 keeps it for a third reason of
# its own: the merchant reference this stage mints is a 37-character unguessable string that is also the
# provider's order id, and a failing ledger assertion that prints the value it was handed would put an
# order handle in the terminal and in whatever log the operator redirects. The pattern also eats
# Postgres' dashed column separators, which is why the printed output keeps the result rows and not the
# ruler.
mask() { sed -E 's/[A-Za-z0-9_-]{36,43}/[REDACTED-LONG]/g; s/[A-Za-z0-9_-]{43}/[REDACTED-43]/g'; }

if [ "${STAGE10_LOCAL:-0}" = "1" ]; then
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
         echo "!! Use STAGE10_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
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
# and both styles are legitimate. Stage 10's own batteries use `lines` for the reason each runner since
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

build_chain() { # build_chain <commerce|render|guest|family|clean|legacy>
  DB="st10qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)  — schema head: Stage 10"
  echo "=================================================================="
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" | mask

  echo "==> bootstrap (roles + auth shim)"
  run_tx supabase/tests/rls/00_bootstrap.sql | mask

  # Stage 9's migration inserts two rows into `storage.buckets`, so the fixture that stands in for the
  # storage service has to exist before the stage loop, exactly as it does for Stages 6 to 9. Applying
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
  # reason `stage2/run.sh` records. Stage 10 is appended, not substituted: the migrations its ledger
  # references (`public.weddings`, `public.entitlements`, `public.publications`, `private.audit_events`)
  # stay where their own stages put them, which is the point — Stage 10 claims to add a server-side
  # model to the one schema rather than to fork it.
  for stage in stage2 stage3 stage4 stage5 stage6 stage7 stage8 stage9 stage10; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m" | mask
    done
  done

  probe_sql \
    -c "select 'DECLARED_HEAD=' || coalesce(current_setting('app.stage_head', true), '(unset)')" \
    -c "select 'API_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'" \
    -c "select 'INTERNAL_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'internal_api'" \
    -c "select 'PUBLIC_TABLES=' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'" \
    -c "select 'COMMERCE_TABLES=' || count(*) || ': ' || coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '(none)') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relkind = 'r' and c.relname like 'commerce%'" \
    -c "select 'LEDGER_ROWS=' || (select count(*) from private.commerce_payment_events) || ' ORDERS=' || (select count(*) from private.commerce_orders) || ' ENTITLEMENTS=' || (select count(*) from public.entitlements)" \
    -c "select 'POLICY=' || publish_gate || ' GATE_PACKAGES=' || coalesce(array_length(publish_required_package_codes,1),0)::text || ' LIVE_CAPTURE=' || live_capture_enabled::text || ' REFUND_MODE=' || refund_revocation_mode from private.commerce_policy" \
    -c "select 'STORAGE_BUCKETS=' || count(*) || ': ' || coalesce(string_agg(b.id, ', ' ORDER BY b.id), '(none)') from storage.buckets b" \
    | mask
}

run_stage10_batteries() {
  local found=0 f
  # `[89]*` is the shape every runner since Stage 7 uses, and the fail-if-zero guard below it is the
  # reason that shape is safe. Until Stage 10's own pair exists, `commerce` and `all` exit 1 here,
  # which is the honest reading: a stage whose own assertions are missing has not been qualified,
  # whatever the historic suites say about it.
  for f in $(ls supabase/tests/stage10/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 10 $(basename "$f" .sql)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 10 suite matched supabase/tests/stage10/[89]*.sql."
    echo "!! The runner would print historic totals only, which is the failure shape the Stage 7 runner"
    echo "!! records: an older enumeration that exits 0 while the new stage is invisible to it."
    exit 1
  fi
}

run_stage9_batteries() {
  local found=0 f
  for f in $(ls supabase/tests/stage9/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 9 $(basename "$f" .sql) (at Stage 10 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 9 suite matched supabase/tests/stage9/[89]*.sql, so the render manifest boundary"
    echo "!! was never re-measured against this schema. That is a missing regression, not a pass."
    exit 1
  fi
}

run_stage8_batteries() {
  local found=0 f
  # Stage 8's pair is re-run here, at the Stage 10 head, on a chain that runs nothing else — the same
  # isolation its own runner gave its censuses. A drift between this section's totals and the ones
  # `stage9/run.sh` printed at Stage 9's head is the point of running it: Stage 10 adds six private
  # tables, one policy row and a trigger on `public.publications` to a schema whose guest censuses count
  # rows and buckets cluster-wide.
  for f in $(ls supabase/tests/stage8/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 8 $(basename "$f" .sql) (at Stage 10 head)" "$f" tx lines
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
    suite "stage 7 $(basename "$f" .sql) (at Stage 10 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 7 suite matched supabase/tests/stage7/[89]*.sql, so the family review boundary was"
    echo "!! never re-measured against this schema. That is a missing regression, not a pass."
    exit 1
  fi
}

run_historic_suites() { # run_historic_suites <clean|legacy>
  if [ "$1" = legacy ]; then
    suite "stage 2 migration outcome (historical rows, at Stage 10 head)" supabase/tests/stage2/30_migration_legacy.sql tx lines
  else
    suite "stage 2 migration outcome (nothing invented, at Stage 10 head)" supabase/tests/stage2/30_migration_empty.sql tx lines
  fi
  # Outcome before attacks, for the reason `stage2/run.sh` gives and this runner is the one place it
  # matters: the attack suite seeds rows, and the outcome counts were measured on a chain that had not
  # been attacked.
  suite "stage 3 draft invariant (at Stage 10 head)" supabase/tests/stage3/20_draft_invariant.sql tx counter
  suite "stage 3 publication boundary (at Stage 10 head)" supabase/tests/stage3/30_publication.sql tx counter
  suite "stage 2 privilege + RLS attacks (at Stage 10 head)" supabase/tests/stage2/20_attacks.sql tx counter
  suite "stage 2 catalog conformance (at Stage 10 head)" supabase/tests/stage2/40_catalog.sql tx lines

  suite "stage 4 pack documents (at Stage 10 head)" supabase/tests/stage4/50_pack_release.sql tx lines
  suite "stage 4 §8 fixture tooling (at Stage 10 head)" supabase/tests/stage4/60_reviewed_fixture.sql rollback lines
  local f
  for f in $(ls supabase/tests/stage5/[0-9]*.sql 2>/dev/null | grep -vE '_rollback\.sql$' | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 10 head)" "$f" tx lines
  done
  for f in $(ls supabase/tests/stage5/*_rollback.sql 2>/dev/null | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 10 head)" "$f" rollback lines
  done
  for f in $(ls supabase/tests/stage6/[89]*.sql 2>/dev/null | sort); do
    suite "stage 6 $(basename "$f" .sql) (at Stage 10 head)" "$f" tx lines
  done
}

if [ "$MODE" = all ] || [ "$MODE" = commerce ]; then
  build_chain commerce
  run_stage10_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st10qual_commerce WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = render ]; then
  build_chain render
  run_stage9_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st10qual_render WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = guest ]; then
  build_chain guest
  run_stage8_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st10qual_guest WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = family ]; then
  build_chain family
  run_stage7_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st10qual_family WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = historic ]; then
  for variant in clean legacy; do
    build_chain "$variant"
    run_historic_suites "$variant"
    admin_sql -c "DROP DATABASE IF EXISTS st10qual_$variant WITH (FORCE)" >/dev/null | mask
  done
fi

echo
echo "==> Stage 10 database qualification"
echo "$RESULTS"
echo "==> Stage 10's own batteries ran on a chain that ran nothing else, because their closing census"
echo "    counts ledger rows and entitlements cluster-wide; Stage 9's, Stage 8's and Stage 7's pairs"
echo "    each ran on their own empty chain for the reason their own runners give. The older suites ran"
echo "    on chains that had not been given Stage 10's orders or events. No set of numbers here is"
echo "    evidence about another database, and none of them should be quoted as if it were."
echo "==> Every total labelled 'at Stage 10 head' is a re-measurement of an older suite against a schema"
echo "    that contains Stage 10. The older runners' own totals still describe their own heads."
echo "==> Boundary: plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase Auth,"
echo "    the Storage API and any HTTP webhook receiver were not executing, and no provider signature was"
echo "    verified — the ledger's inputs here are digests and a declared validity bit, not HMAC bytes."
echo "    What these numbers carry is the schema, the state machine, the idempotency and freeze guards,"
echo "    the append-only triggers, the grants and the publish gate. Payment initiation, capture, refund"
echo "    and dispute *over a wire* belong to the Node verifier, the HTTP tier and the browser tier."
