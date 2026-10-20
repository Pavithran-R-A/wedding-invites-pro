#!/usr/bin/env bash
# Stage 11 database qualification runner. Throwaway Postgres only — no remote project, no `supabase
# link`, no `db push` against a hosted project, nothing persisted anywhere.
#
#   bash supabase/tests/stage11/run.sh                    # every chain, in Docker
#   bash supabase/tests/stage11/run.sh authority          # Stage 11's own batteries, alone
#   bash supabase/tests/stage11/run.sh historic           # Stage 2-6 suites at the Stage 11 head
#   bash supabase/tests/stage11/run.sh regress            # Stage 7, 8, 9 and 10's own pairs at this head
#   STAGE11_LOCAL=1 PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres \
#     bash supabase/tests/stage11/run.sh authority        # an already-running cluster
#
# The shape of this file is Stage 10's, deliberately: a new head gets a new runner whose chain reaches the
# new head, and every suite below it is re-measured against it. Each runner applies
# `ls supabase/migrations/*.sql | grep -vE '_stage[0-9]+_'` and then loops its own stage order, so a
# `*_stage11_*` migration is invisible to every runner before it. Running Stage 2's catalogue at a Stage 10
# head against a schema that contains Stage 11 would not be a re-measurement, it would be a measurement of
# a chain that was never built.
#
# Why the modes are split the way they are — Stage 8's, Stage 9's and Stage 10's reason, unchanged. Each
# stage's own batteries end with a census that counts *cluster-wide*: how many guest households exist
# anywhere, the ledger's applied/duplicate/held tallies, the output manifest's row counts, the global
# `rsvp_responses` total. Those are true on a chain that ran nothing but that pair and false on a chain that
# has also run `tests/stage2/20_attacks.sql`, which deliberately commits seed rows. Stage 11's battery 1
# adds a census of exactly that shape — grant rows by status, trail rows by action — so it gets its own
# empty chain too.
#
#   authority  bootstrap -> storage fixture -> published -> stage2..stage11 -> Stage 11's [89]*
#   historic   TWO chains, same stage loop: `clean` (no legacy seed) runs Stage 2's empty-chain outcome
#              suite, `legacy` (seeded) runs its historical-rows sibling. Both then run Stage 2's draft,
#              publication, attack and catalog suites -> Stage 4's two suites -> Stage 5's suites ->
#              Stage 6's suites
#   regress    four separate chains, each running exactly one older stage's own pair at the Stage 11 head
#
# `historic` contains no stage's own pair, for the reason above, and says nothing about the censuses those
# pairs print. That is a property of the instrument, not a gap in it.
#
# `app.stage_head=stage11` travels to the head-aware assertions for the reason every runner since Stage 5
# gives: an expectation that only holds at one head has to be duplicated, and one that names the head it is
# measuring is a stronger claim. What this head moves is inventories, not behaviour: `private` gains one
# table and one predicate, `internal_api` gains two service-only bodies, `api` gains nothing, and
# `service_role` *loses* UPDATE and DELETE on `private.audit_events`. The Stage 10 publish gate ships
# permissive and stays permissive, so every historical publication suite must still pass unmodified — if
# one of them refuses, that is a Stage 11 defect and not a stale expectation.
#
# The numbers this head should print, stated as a derivation rather than a guess so that a chain probe
# printing something else is a finding: Stage 10 shipped 22 `api` names, 39 `internal_api` names and 37
# `private` names. Slice 1 adds no wrapper, two `internal_api` bodies and one `private` function, making
# 22 / 41 / 38. `PUBLIC_TABLES` and `STORAGE_BUCKETS` must not move: a head that changes the
# customer-facing inventory while claiming to add only a server-side credential store has put its tables
# where an API role can see them. Every number below is printed from `pg_proc` and `pg_class`, never
# grepped out of source, because a name declared twice with two argument lists counts twice here and once
# in a grep.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql` and the
# Stage 6 storage-schema fixture. It proves the grant table, the predicate, the two bodies, the audit
# columns, the CHECKs, the replay index, the append-only triggers and the grants. It does not prove
# PostgREST, Supabase Auth, the Storage API or an HTTP operator surface: the caller class that matters — a
# signed-in host with a real JWT — cannot exist here, so `test.uid` stands in for the claim and the wire
# half belongs to `supabase/tests/api/stage11_operations.test.mjs`. No browser opens a console. What these
# numbers carry is the authority model and the trail; what they cannot carry is authentication.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-all}"
case "$MODE" in authority|historic|regress|all) ;; *) echo "usage: $0 [authority|historic|regress|all]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage11-$$"
export PGCLIENTENCODING=UTF8
export PGOPTIONS="-c app.stage_head=stage11"

sql_bytes() { tr -d '\r' < "$1"; }

# Every line this script prints about a suite goes through `mask` on its way out, for the reason the Stage 8
# runner introduced it and Stage 9's and Stage 10's kept it. Stage 11 keeps it for a reason of its own: an
# operator grant row carries a uuid that, once a console exists, identifies a named human's credential, and
# a failing assertion that prints the value it was handed would put that in the terminal and in whatever log
# the operator redirects. The pattern also eats Postgres' dashed column separators, which is why the printed
# output keeps the result rows and not the ruler.
mask() { sed -E 's/[A-Za-z0-9_-]{36,43}/[REDACTED-LONG]/g; s/[A-Za-z0-9_-]{43}/[REDACTED-43]/g'; }

if [ "${STAGE11_LOCAL:-0}" = "1" ]; then
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
         echo "!! Use STAGE11_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_tx() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }
  # `-U postgres` here too, and its absence was measured rather than guessed: Stage 9's first `historic` run
  # died silently at `stage4/60_reviewed_fixture.sql`, the one rollback-style suite in the sweep, because
  # `docker exec` inherits no `PGUSER` and psql tried to connect as `root` — so every file this runner
  # reaches without `--single-transaction` was in fact never executed.
  run_rollback() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
  # The census probe needs the chain's own database *and* the chain's own session GUC, so it cannot reuse
  # `admin_sql`: that helper exists to create and drop databases, which only makes sense against the
  # maintenance database, and it carries no `PGOPTIONS`. Stage 7's runner recorded this as a measured
  # failure of its own instrument — a probe written with `admin_sql` printed three zeros about the wrong
  # database, sitting above suites that assert real counts.
  probe_sql() { docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q -tA "$@"; }
fi

RESULTS=""
# suite <label> <file> <tx|rollback> <lines|counter>
#
# The fourth argument is stated per suite rather than inferred, because these files do not print alike and
# both styles are legitimate. Stage 11's own battery uses `lines`: the reported total and the printed line
# count must agree exactly, and this script refuses the run when they do not.
suite() {
  [ -f "$2" ] || { echo "!! $1: $2 does not exist — a suite that is not there is not a pass."; exit 1; }
  echo "==> $1  ($([ "$3" = tx ] && echo 'single-transaction, commits' || echo 'own transaction, rolls back'))"
  local out status=0
  if [ "$3" = tx ]; then out="$(run_tx "$2" 2>&1)" || status=$?
  else out="$(run_rollback "$2" 2>&1)" || status=$?; fi
  out="$(printf '%s\n' "$out" | mask)"
  # The `|| true` keeps this line's exit status from becoming the runner's. Under `pipefail` a suite that
  # dies with a message that is none of these words — `psql: error: connection …` is spelled in lower case —
  # ended the script here, silently, before the handler below could report the exit status it had already
  # captured. Nothing is loosened: the status check and the empty-total check both still fail the run.
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

build_chain() { # build_chain <authority|historic|commerce|render|guest|family>
  DB="st11qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)  — schema head: Stage 11"
  echo "=================================================================="
  admin_sql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" | mask

  echo "==> bootstrap (roles + auth shim)"
  run_tx supabase/tests/rls/00_bootstrap.sql | mask

  # Stage 9's migration inserts rows into `storage.buckets`, so the fixture that stands in for the storage
  # service has to exist before the stage loop, exactly as it does for Stages 6 to 10.
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

  # Stage files in their own stage order — the only order that matches a real deployment, for the reason
  # `stage2/run.sh` records. Stage 11 is appended, not substituted: the tables its credentials reference
  # (`auth.users`, `private.audit_events`, `public.weddings`) stay where their own stages put them, which is
  # the point — Stage 11 claims to add an operational layer to the one schema rather than fork it.
  for stage in stage2 stage3 stage4 stage5 stage6 stage7 stage8 stage9 stage10 stage11; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m" | mask
    done
  done

  probe_sql \
    -c "select 'DECLARED_HEAD=' || coalesce(current_setting('app.stage_head', true), '(unset)')" \
    -c "select 'API_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'" \
    -c "select 'INTERNAL_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'internal_api'" \
    -c "select 'PRIVATE_FUNCS=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'" \
    -c "select 'PUBLIC_TABLES=' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'" \
    -c "select 'PRIVATE_TABLES=' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relkind = 'r'" \
    -c "select 'OPERATOR_GRANTS=' || count(*) || ' ACTIVE=' || count(*) filter (where status = 'active') from private.operator_grants" \
    -c "select 'AUDIT_POSTURE=svc_select=' || has_table_privilege('service_role','private.audit_events','SELECT')::text || ' svc_insert=' || has_table_privilege('service_role','private.audit_events','INSERT')::text || ' svc_update=' || has_table_privilege('service_role','private.audit_events','UPDATE')::text || ' svc_delete=' || has_table_privilege('service_role','private.audit_events','DELETE')::text || ' before_update_triggers=' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'audit_events' and c.relnamespace = 'private'::regnamespace and not t.tgisinternal and t.tgtype::int & 16 = 16)" \
    -c "select 'COMMERCE_TABLES=' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relkind = 'r' and c.relname like 'commerce%'" \
    -c "select 'LEDGER_ROWS=' || (select count(*) from private.commerce_payment_events) || ' ORDERS=' || (select count(*) from private.commerce_orders) || ' ENTITLEMENTS=' || (select count(*) from public.entitlements) || ' AUDIT_ROWS=' || (select count(*) from private.audit_events)" \
    -c "select 'POLICY=' || publish_gate || ' GATE_PACKAGES=' || coalesce(array_length(publish_required_package_codes,1),0)::text || ' LIVE_CAPTURE=' || live_capture_enabled::text || ' REFUND_MODE=' || refund_revocation_mode from private.commerce_policy" \
    -c "select 'STORAGE_BUCKETS=' || count(*) || ': ' || coalesce(string_agg(b.id, ', ' ORDER BY b.id), '(none)') from storage.buckets b" \
    | mask
}

run_stage11_batteries() {
  local found=0 f
  # `[89]*` is the shape every runner since Stage 7 uses, and the fail-if-zero guard below it is the reason
  # that shape is safe. Later Stage 11 slices add `85_`, `90_` and `95_` to this glob, which is why the guard
  # is a glob and not a filename: a stage whose own assertions are missing has not been qualified, whatever
  # the historic suites say about it.
  for f in $(ls supabase/tests/stage11/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 11 $(basename "$f" .sql)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 11 suite matched supabase/tests/stage11/[89]*.sql."
    echo "!! The runner would print historic totals only, which is the failure shape the Stage 7 runner"
    echo "!! records: an older enumeration that exits 0 while the new stage is invisible to it."
    exit 1
  fi
}

run_stage10_batteries() {
  local found=0 f
  for f in $(ls supabase/tests/stage10/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 10 $(basename "$f" .sql) (at Stage 11 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 10 suite matched supabase/tests/stage10/[89]*.sql, so the commerce ledger boundary was"
    echo "!! never re-measured against this schema. That is a missing regression, not a pass."
    exit 1
  fi
}

run_stage9_batteries() {
  local found=0 f
  for f in $(ls supabase/tests/stage9/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 9 $(basename "$f" .sql) (at Stage 11 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 9 suite matched supabase/tests/stage9/[89]*.sql, so the render manifest boundary was"
    echo "!! never re-measured against this schema."
    exit 1
  fi
}

run_stage8_batteries() {
  local found=0 f
  for f in $(ls supabase/tests/stage8/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 8 $(basename "$f" .sql) (at Stage 11 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 8 suite matched supabase/tests/stage8/[89]*.sql, so the guest boundary was never"
    echo "!! re-measured against this schema."
    exit 1
  fi
}

run_stage7_batteries() {
  local found=0 f
  for f in $(ls supabase/tests/stage7/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 7 $(basename "$f" .sql) (at Stage 11 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 7 suite matched supabase/tests/stage7/[89]*.sql, so the family review boundary was"
    echo "!! never re-measured against this schema."
    exit 1
  fi
}

run_historic_suites() { # run_historic_suites <clean|legacy>
  # The two chains are not a redundancy and collapsing them is a measured failure of this instrument, not a
  # stale expectation to widen: the first run of this mode seeded the legacy fixture and then asked the
  # *empty-chain* suite whether the canonical domain had rows, and it correctly answered that
  # `public.design_templates` holds five — the ones `20260925120600_stage2_migrate_legacy_projects.sql`
  # copies from the seeded legacy projects. "Nothing was invented" and "the historical rows arrived" are two
  # different claims about two different chains, and Stage 10's runner keeps them apart for that reason.
  if [ "$1" = legacy ]; then
    suite "stage 2 migration outcome (historical rows, at Stage 11 head)" supabase/tests/stage2/30_migration_legacy.sql tx lines
  else
    suite "stage 2 migration outcome (nothing invented, at Stage 11 head)" supabase/tests/stage2/30_migration_empty.sql tx lines
  fi
  # Outcome before attacks, for the reason `stage2/run.sh` gives and this runner is the one place it matters:
  # the attack suite seeds rows, and the outcome counts were measured on a chain that had not been attacked.
  suite "stage 3 draft invariant (at Stage 11 head)" supabase/tests/stage3/20_draft_invariant.sql tx counter
  suite "stage 3 publication boundary (at Stage 11 head)" supabase/tests/stage3/30_publication.sql tx counter
  suite "stage 2 privilege + RLS attacks (at Stage 11 head)" supabase/tests/stage2/20_attacks.sql tx counter
  suite "stage 2 catalog conformance (at Stage 11 head)" supabase/tests/stage2/40_catalog.sql tx lines

  suite "stage 4 pack documents (at Stage 11 head)" supabase/tests/stage4/50_pack_release.sql tx lines
  suite "stage 4 §8 fixture tooling (at Stage 11 head)" supabase/tests/stage4/60_reviewed_fixture.sql rollback lines
  local f
  for f in $(ls supabase/tests/stage5/[0-9]*.sql 2>/dev/null | grep -vE '_rollback\.sql$' | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 11 head)" "$f" tx lines
  done
  for f in $(ls supabase/tests/stage5/*_rollback.sql 2>/dev/null | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 11 head)" "$f" rollback lines
  done
  for f in $(ls supabase/tests/stage6/[89]*.sql 2>/dev/null | sort); do
    suite "stage 6 $(basename "$f" .sql) (at Stage 11 head)" "$f" tx lines
  done
}

if [ "$MODE" = all ] || [ "$MODE" = authority ]; then
  build_chain authority
  run_stage11_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st11qual_authority WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = regress ]; then
  # Four chains, one per older stage's own pair, because each pair closes with a cluster-wide census and
  # commits rows of its own. A foundation that weakens Stage 3's publication, Stage 6's private assets,
  # Stage 8's guest privacy, Stage 9's delivery claims or Stage 10's ledger is not a foundation.
  for pair in commerce render guest family; do
    build_chain "$pair"
    case "$pair" in
      commerce) run_stage10_batteries ;;
      render)   run_stage9_batteries ;;
      guest)    run_stage8_batteries ;;
      family)   run_stage7_batteries ;;
    esac
    admin_sql -c "DROP DATABASE IF EXISTS st11qual_$pair WITH (FORCE)" >/dev/null | mask
  done
fi

if [ "$MODE" = all ] || [ "$MODE" = historic ]; then
  for variant in clean legacy; do
    build_chain "$variant"
    run_historic_suites "$variant"
    admin_sql -c "DROP DATABASE IF EXISTS st11qual_$variant WITH (FORCE)" >/dev/null | mask
  done
fi

echo
echo "==> Stage 11 database qualification"
echo "$RESULTS"
echo "==> Stage 11's own batteries ran on a chain that ran nothing else, because their closing census counts"
echo "    grant rows and trail rows cluster-wide. The four older pairs each ran on their own empty chain for"
echo "    the reason their own runners give, and the Stage 2-6 sweep ran on chains that carry Stage 11's"
echo "    schema but hold no operator grant row — the OPERATOR_GRANTS=0 census is printed above each of them,"
echo "    and that is the difference between a fresh deployment and a qualified one. No set of numbers here"
echo "    is evidence about another database."
echo "==> Every total labelled 'at Stage 11 head' is a re-measurement of an older suite against a schema that"
echo "    contains Stage 11. The older runners' own totals still describe their own heads."
echo "==> Boundary: plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase Auth,"
echo "    the Storage API and any HTTP operator surface were not executing, and no JWT was verified. The"
echo "    caller class that matters most to this stage — a signed-in hostile host at the wire — is claimed"
echo "    here only through the test.uid shim, and its measurement belongs to the API battery."
echo "    What these numbers carry is the grant table, the predicate, the two service-only bodies, the audit"
echo "    columns, the CHECKs, the replay index, the append-only refusal and the privilege revocations."
