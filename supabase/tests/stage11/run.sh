#!/usr/bin/env bash
# Stage 11 database qualification runner. Throwaway Postgres only — no remote project, no `supabase
# link`, no `db push` against a hosted project, nothing persisted anywhere.
#
#   bash supabase/tests/stage11/run.sh                    # every chain, in Docker
#   bash supabase/tests/stage11/run.sh authority          # Stage 11's own batteries, alone
#   bash supabase/tests/stage11/run.sh historic           # Stage 2-6 suites at the Stage 11 head
#   bash supabase/tests/stage11/run.sh regress            # Stage 7, 8, 9 and 10's own pairs at this head
#   bash supabase/tests/stage11/run.sh race               # the two-operator concurrency tier, at head
#   STAGE11_LOCAL=1 PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres \
#     bash supabase/tests/stage11/run.sh authority        # an already-running cluster
#   STAGE11_LOCAL=1 PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres \
#     bash supabase/tests/stage11/run.sh race             # the concurrency tier on that cluster
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
# empty chain too. Battery 2 gets the *same* chain rather than a second empty one, because it sorts after
# battery 1 in the glob and inherits the three grant rows and four trail rows battery 1 leaves behind; that
# is why every absolute count in `85_support_lifecycle.sql` is either a delta from a number captured at the
# top of its own group or a digest, and why group Z's census counts rows this stage's two batteries created
# rather than cluster totals.
#
#   authority  bootstrap -> storage fixture -> published -> stage2..stage11 -> Stage 11's [89]*
#   race       bootstrap -> storage fixture -> published -> stage2..stage11 -> race fixtures, then five
#              arms of live concurrent sessions with their three assert files
#   historic   TWO chains, same stage loop: `clean` (no legacy seed) runs Stage 2's empty-chain outcome
#              suite, `legacy` (seeded) runs its historical-rows sibling. Both then run Stage 2's draft,
#              publication, attack and catalog suites -> Stage 4's two suites -> Stage 5's suites ->
#              Stage 6's suites
#   regress    four separate chains, each running exactly one older stage's own pair at the Stage 11 head
#
# Why `race` is a chain of its own rather than another file in `authority`: the five arms *commit*. A takedown
# that is refused leaves nothing, but a takedown that is serialised leaves a revoked publication, an
# invalidated artefact and a trail row, and battery 1's closing census counts grant and trail rows
# cluster-wide. The same reasoning is why Stage 10 gave its race tier an empty chain. What the race chain
# owns is `st11qual_race`, and the last line of the mode drops it, so nothing outlives the run — which is
# also why this tier never runs against `localvivaahvarnam`: §1 of the Stage 11 brief forbids concurrency
# against customer data, and these files could not run there without writing a real revocation.
#
# What the tier adds over the batteries, in one sentence each, because `run_tx` cannot express it: the
# batteries are one session and the threat rows in `docs/architecture/operations-admin-security.md` §13 that
# this tier exists for are about *two* sessions reaching the same row. So the shape is: a fixture chain, then
# `start_session` for each live client, `marker` to release the second client only once the first is provably
# inside its act, `session_log` for the chronology, and the assert files for the count. The rendezvous is
# `pg_locks` — an ungranted `transactionid` lock on the holder's transaction — not a sleep, and the holder
# refuses to commit until it has seen that row, so an arm that never interleaved is an invalid arm rather
# than a pass. See the `7X_race_arm*_*.sql` headers for what each arm claims and `8X_race_*_asserts.sql` for
# what each counted cell measures.
#
# `historic` contains no stage's own pair, for the reason above, and says nothing about the censuses those
# pairs print. That is a property of the instrument, not a gap in it.
#
# `app.stage_head=stage11` travels to the head-aware assertions for the reason every runner since Stage 5
# gives: an expectation that only holds at one head has to be duplicated, and one that names the head it is
# measuring is a stronger claim. What this head moves is inventories, not behaviour: across slices 1–5
# `private` gains five tables and fifteen functions, `internal_api` gains twenty-two bodies, `api` gains
# nineteen wrappers, and
# `service_role` *loses* UPDATE and DELETE on `private.audit_events`. The Stage 10 publish gate ships
# permissive and stays permissive, so every historical publication suite must still pass unmodified — if
# one of them refuses, that is a Stage 11 defect and not a stale expectation.
#
# The numbers this head should print, stated as a derivation rather than a guess so that a chain probe
# printing something else is a finding: Stage 10 shipped 22 `api` names, 39 `internal_api` names and 37
# `private` names. Slice 1 adds no wrapper, two `internal_api` bodies and three `private` functions; slice 2
# adds ten `api` wrappers, ten `internal_api` bodies and five `private` functions; the closed-is-terminal
# repair adds no name and replaces two bodies in place, making 32 / 51 / 45 — and battery 1's A06a–A06c
# measure exactly that sum from `pg_proc`. Slice 3 adds one `private` table and three `private` functions —
# the two request guards and the reference minter behind `private.privacy_requests` — plus four `api`
# wrappers and four `internal_api` bodies, making 36 / 55 / 48. Slice 4 adds one `private` table and four
# `private` functions — the note-order minter and the two referential guards that fire as triggers on
# `private.commerce_review_notes`, plus `operator_authorising_case`, the fifth `private` SECURITY DEFINER
# body — and five `internal_api` bodies behind four `api` wrappers, making 40 / 60 / 52 and 152 functions
# across the three schemas. The fifth body is the one with no wrapper: `operator_purge_publication_objects`
# plans the removal of a revoked publication's rendered objects and hands the delete itself to the trusted
# CLI's Storage call, so `stage4/50_pack_release.sql`'s I2 names it among the twin-less maintenance bodies
# and the customer surface does not carry it at all. Slice 5 adds one `api` wrapper and one `internal_api`
# body — `operator_operations_summary`, the health projection behind its one-line door — and no `private`
# function, making 41 / 61 / 52 and 154 functions across the three schemas. The asymmetry is the point of
# naming it: the twin-less half stays at twenty because slice 5's body is *paired*, unlike slice 4's purge,
# and the reason is the one this stage keeps giving — a health read is the single operational thing a
# signed-in operator's browser has to be able to ask for, so it needs a door, while a delete does not.
# `PUBLIC_TABLES` and
# `STORAGE_BUCKETS` must not move: a head that changes the customer-facing inventory while claiming to add
# only a server-side credential store has put its tables where an API role can see them. Slice 2 adds no
# bucket and no `public` table; its two new tables are in `private` for the same reason the grant table is,
# and `40_catalog.sql` C06 measures that again rather than taking this sentence on faith. Slice 4 keeps the
# rule — its one new table is `private.commerce_review_notes`, and the chain probe at
# `q11-logs/s11-s4-header-probe-1.txt` prints `PUBLIC_TABLES=20` and `STORAGE_BUCKETS=3` over
# `invitation-outputs, invitation-previews, wedding-assets`, the same twenty and the same three that every
# earlier head this runner logged. Slice 5 adds no table in any schema, and its own readout at
# `q11-logs/s11-s5-readout-1.txt` prints `PUBLIC_TABLES=20`, `PRIVATE_TABLES=13` and
# `STORAGE_BUCKETS=3: invitation-outputs,invitation-previews,wedding-assets` — the same twenty, thirteen and
# three that slice 4 logged, which is what a head that adds only a read should look like. Every number
# below is printed from `pg_proc` and `pg_class`, never grepped out of source, because a name declared
# twice with two argument lists counts twice here and once in a grep.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql` and the
# Stage 6 storage-schema fixture. It proves the grant table, the predicate, the two bodies, the audit
# columns, the CHECKs, the replay index, the append-only triggers and the grants. It does not prove
# PostgREST, Supabase Auth, the Storage API or an HTTP operator surface: the caller class that matters — a
# signed-in host with a real JWT — cannot exist here, so `test.uid` stands in for the claim and the wire
# half belongs to `supabase/tests/api/stage11_operations.test.mjs`. No browser opens a console. What these
# numbers carry is the authority model and the trail; what they cannot carry is authentication. The `race` mode
# adds the one thing the serial batteries structurally cannot: two and three live backends reaching the same
# publication row, the same idempotency key and the same thread ordinal at the same moment, with the caller
# still a `test.uid` shim rather than a JWT. A race tier that proves a lock serialised an act says nothing about
# whether an HTTP gateway would have let two requests reach it, and the tier below does not claim otherwise.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-all}"
case "$MODE" in authority|historic|regress|race|all) ;; *) echo "usage: $0 [authority|historic|regress|race|all]"; exit 2 ;; esac

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
  # A race session is a *live concurrent client*: `run_tx` cannot express a second backend, so each arm is
  # backgrounded psql processes whose rendezvous is inside the SQL. Deliberate delta from Stage 10's identical
  # helper, which omits `ON_ERROR_STOP`: this tier's arms *raise on purpose* when their own premise fails
  # (`FAIL arm 3: session B never blocked …`), and psql without that flag prints such an error, keeps going,
  # turns every later statement into "current transaction is aborted", and still exits 0. A plant that had
  # silently stopped being a plant would then be read as a completed arm. With the flag the session dies with a
  # non-zero status and `session_log` below refuses it. Nothing is weakened by it: every refusal this tier
  # *expects* is caught by the arm's own plpgsql handler and returned as data, so an expected outcome never
  # reaches psql's error path.
  start_session() { sql_bytes "$1" | psql -d "$DB" -v ON_ERROR_STOP=1 -tA -q > "$2" 2>&1 & LAST_PID=$!; }
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
  # The live-client helper again, with the same `ON_ERROR_STOP` reasoning as the local branch (see the note
  # there). `tr -d '\r'` has to happen host-side, before the pipe crosses into the container, because the image
  # ships no `tr` to lean on afterwards. `-U postgres` is not optional here either: `docker exec` inherits no
  # `PGUSER`, and Stage 9's runner recorded what a silent fallback to a role that does not exist looks like.
  start_session() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" \
               "$CTR" psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -tA -q > "$2" 2>&1 & LAST_PID=$!; }
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
  # that shape is safe. All four later slices have since arrived here as `85_`, `90_`, `92_` and `95_` — slice 4
  # took `92_`, not the `95_` this comment planned, because `90_` already belonged to slice 3's privacy battery,
  # and slice 5 then landed on the `95_` that plan named. Nothing here was edited to receive it: the glob matched
  # the new file on its first run, which is the property this shape is chosen for. What the glob cannot see is a
  # battery that runs but reports no total, so each of these five files also prints `PASSED (n)` and the
  # `lines` style below compares that number with the `PASS` lines it counted. Either way the guard is a glob
  # and not a filename: a stage whose own assertions are missing has not been qualified, whatever the historic
  # suites say about it.
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

# marker <file> <pattern> [polls] — the driver's half of the rendezvous. It waits for a milestone line to
# appear in a live session's log before starting the session behind it, so the interleaving is *arranged* and
# not hoped for. The default budget is deliberately longer than any wait inside the SQL (900 polls here, 600 =
# ~30 s there): a plant that never reached its lock should therefore surface as the session's own
# `ARM_INVALID` / `A*_GATE_FAILED` and a non-zero psql exit — a diagnosable failure — rather than as this
# message, which can only say that a line did not arrive. A pattern that never appears is an invalid arm,
# never a pass.
marker() {
  local n="${3:-900}"
  for _ in $(seq 1 "$n"); do
    grep -q "$2" "$1" 2>/dev/null && return 0
    sleep 0.05
  done
  echo "!! DRIVER_TIMEOUT: '$2' never appeared in $1 — the arm is invalid; read its partial output:"
  mask < "$1" | tail -20
  exit 1
}

# session_log <label> <file> <status> — session logs are chronology evidence, never counted assertions: a race
# log printing PASS lines it had not asserted is exactly the confusion the session/assert split prevents. This
# is also where the tier's *verdict* rule lives. An arm prints one of four shapes when it reaches a branch its
# own file did not plan for — `…_PLANT_BROKEN=`, `…_GATE_FAILED=`, `ARM_INVALID`, or the word `UNEXPECTED` on a
# refusal whose SQLSTATE or constraint was not the one the arm exists to measure — and every one of them means
# the instrument failed, not the product. Stage 10's driver caught a green run whose arm had never
# interleaved only by reading the logs afterwards; here the word itself ends the run, so a broken plant cannot
# reach an assert file at all. The check runs on the masked body and each of these tokens is short, so `mask`'s
# appetite for 36–43-character identifiers cannot hide a verdict.
session_log() {
  echo "==> $1 (session log, not a counted suite; exit $3)"
  local body
  body="$(mask < "$2")"
  [ "$3" -ne 0 ] && { echo "!! $1 FAILED (psql exit $3). Full tail:"; printf '%s\n' "$body" | tail -40; exit 1; }
  if printf '%s\n' "$body" | grep -qE 'UNEXPECTED|PLANT_BROKEN|GATE_FAILED|ARM_INVALID'; then
    echo "!! $1 reached a branch its own file did not plan for. That is a broken arm, not a product"
    echo "!! refusal, and it is not evidence about the control it was supposed to measure. The lines:"
    printf '%s\n' "$body" | grep -nE 'UNEXPECTED|PLANT_BROKEN|GATE_FAILED|ARM_INVALID'
    exit 1
  fi
  # The chronology vocabulary. A token that is on no arm's failure path and matches nothing here is printed by
  # the session and invisible in the log, which is what had happened to `B1_PUB_SEEN_AFTER_BLOCK` (B's own read
  # of the row `RC03` counts as terminal) and to `B3_OWN_VIEW_MIDTX` / `B3_OWN_VIEW_AFTER_ROLLBACK` (the loser's
  # view either side of the rollback `RD01` re-reads from a second connection). `PLANT_BROKEN`/`GATE_FAILED` are
  # deliberately absent: those exit above, with their own lines quoted.
  printf '%s\n' "$body" | { grep -E 'STARTED=|_PRE=|APPLIED=|LOCKED=|OUTCOME=|REFUSAL=|ANSWERED=|DETAIL=|BLOCKED=|COMMITTED=|MATCHES|_SEEN_|OWN_VIEW|TRAIL=|AUTH_|ENDED=|REVOKED=' || true; }
}

xact_id() { # xact_id <file> <key> — pull one short numeric transaction id out of a session log. Transaction
  # ids are what bind two logs together, they are nowhere near 36 characters long, and the two lines this is
  # used on print them as data rather than as prose, so a shell comparison here is a measurement and not a
  # guess about scheduling.
  grep -o "$2=[0-9]\+" "$1" 2>/dev/null | head -1 | cut -d= -f2
}

# rendezvous <label> <holder log> <holder gate line> <peer log> <peer start line> — the identity half of every
# arm. A holder can only report *pids*: `pg_stat_activity` reads inside an open transaction are frozen at the
# backends that existed when that transaction began, so the peer that connects and parks afterwards is
# invisible there whatever `stats_fetch_consistency` says (measured in tier attempt 3's aftermath: the holder
# counted the same six rows on all 600 polls while an outside session listed the peer among eight, and
# `q11-logs/probe_pid_rendezvous.sh` confirmed the holder's `pg_locks` poll did see the peer's pid). The arm
# therefore stops at "a backend is ungranted on my transaction id" and this function finishes the sentence from
# the other side: the peer's own log carries the pid its backend printed about itself, into a file this script
# opened for that client alone. That is stronger than the name join it replaces — `application_name` is a label
# a session gives itself and proves nothing about who it is — and it is the same two-log shape ARM 4 already
# builds out of transaction ids. No match, either because the value is missing or because a third backend
# waited here, ends the run: an arm that did not interleave cannot be read as a product result.
rendezvous() {
  local obs pid
  obs="$(grep "$3" "$2" 2>/dev/null | head -1 | { grep -o 'waiterpids=[0-9,]*' || true; } | cut -d= -f2)"
  pid="$(grep -o "$5=pid [0-9]\+" "$4" 2>/dev/null | head -1 | cut -d' ' -f2)"
  if [ -z "$obs" ] || [ -z "$pid" ]; then
    echo "!! $1: the rendezvous is not measurable (holder waiterpids='$obs', peer's own pid='$pid')."
    echo "!! Either the holder printed no waiter list or the peer printed no backend id of its own, so nothing"
    echo "!! here binds the two sessions and the counted cells describe a sequence that was never observed."
    exit 1
  fi
  case ",$obs," in
    *",$pid,"*)
      echo "==> $1 rendezvous confirmed: the holder saw backend $pid ungranted on its own transaction (waiterpids=$obs)." ;;
    *)
      echo "!! $1: the holder saw waiterpids=$obs and its peer's own backend is $pid, so the client that parked"
      echo "!! on this transaction is not the peer this arm was written around. The interleave happened, but not"
      echo "!! between the two sessions the arm names — read the two logs before citing any cell below."
      exit 1 ;;
  esac
}

run_race_battery() {
  # Five arms, three assert files, one fixture — the shape §1 of the Stage 11 brief asks for and the shape
  # Stage 10's race tier established. The arms run in this order because the assert files read the *committed*
  # residue: 82 measures arms 1 and 2, 83 measures arm 4, and 84 measures arms 3 and 5 plus the closure census
  # over all of them, so it runs last and rolls back its own writes. The tmp directory holds session logs, is
  # removed on return, and can name no real couple: every row these arms touch was planted by
  # `70_race_fixtures.sql` under the `0b0b0b00-…` prefix on the throwaway `st11qual_race` database, which the
  # mode below drops.
  local tmp a1 b1 a2 b2 a3 b3 h4 w4 r4 a5 b5 st hx rx LAST_PID
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  suite "stage 11 70_race_fixtures" supabase/tests/stage11/race/70_race_fixtures.sql tx lines

  # `start_session` hands the pid back through LAST_PID and never through command substitution: `x=$(f &
  # echo $!)` makes the backgrounded psql a child of a subshell that exits at once, so the parent's `wait`
  # returns before the session has finished — Stage 10's driver hit that and recorded it.
  echo "==> ARM 1: two operators, one wedding, two keys (sessions 71 + 72)"
  start_session supabase/tests/stage11/race/71_race_arm1_a.sql "$tmp/a1.log"; a1=$LAST_PID
  marker "$tmp/a1.log" 'A1_APPLIED='
  start_session supabase/tests/stage11/race/72_race_arm1_b.sql "$tmp/b1.log"; b1=$LAST_PID
  st=0; wait "$a1" || st=$?; session_log "71_race_arm1_a" "$tmp/a1.log" "$st"
  st=0; wait "$b1" || st=$?; session_log "72_race_arm1_b" "$tmp/b1.log" "$st"
  marker "$tmp/a1.log" 'A1_SEES_B_BLOCKED='
  marker "$tmp/a1.log" 'A1_COMMITTED='
  marker "$tmp/b1.log" 'B1_REFUSAL=expected-no-active-publication'
  rendezvous "ARM 1" "$tmp/a1.log" 'A1_SEES_B_BLOCKED=' "$tmp/b1.log" 'B1_STARTED'

  echo "==> ARM 2: one operator, one key, delivered twice at once (sessions 73 + 74)"
  start_session supabase/tests/stage11/race/73_race_arm2_a.sql "$tmp/a2.log"; a2=$LAST_PID
  marker "$tmp/a2.log" 'A2_APPLIED='
  start_session supabase/tests/stage11/race/74_race_arm2_b.sql "$tmp/b2.log"; b2=$LAST_PID
  st=0; wait "$a2" || st=$?; session_log "73_race_arm2_a" "$tmp/a2.log" "$st"
  st=0; wait "$b2" || st=$?; session_log "74_race_arm2_b" "$tmp/b2.log" "$st"
  marker "$tmp/a2.log" 'A2_SEES_B_BLOCKED='
  marker "$tmp/a2.log" 'A2_COMMITTED='
  marker "$tmp/b2.log" 'B2_ANSWERED=replayed-record-answer'
  marker "$tmp/b2.log" 'B2_MATCHES_STORED=audit-id-equals-stored-row'
  rendezvous "ARM 2" "$tmp/a2.log" 'A2_SEES_B_BLOCKED=' "$tmp/b2.log" 'B2_STARTED'

  suite "stage 11 82_race_arm1_asserts" supabase/tests/stage11/race/82_race_arm1_asserts.sql tx lines

  echo "==> ARM 3: one key across two weddings, refused by the trail index (sessions 75 + 76)"
  start_session supabase/tests/stage11/race/75_race_arm3_a.sql "$tmp/a3.log"; a3=$LAST_PID
  marker "$tmp/a3.log" 'A3_APPLIED='
  start_session supabase/tests/stage11/race/76_race_arm3_b.sql "$tmp/b3.log"; b3=$LAST_PID
  st=0; wait "$a3" || st=$?; session_log "75_race_arm3_a" "$tmp/a3.log" "$st"
  st=0; wait "$b3" || st=$?; session_log "76_race_arm3_b" "$tmp/b3.log" "$st"
  marker "$tmp/a3.log" 'A3_SEES_B_BLOCKED='
  marker "$tmp/a3.log" 'A3_COMMITTED='
  marker "$tmp/b3.log" 'B3_REFUSAL=expected-trail-index-refusal'
  rendezvous "ARM 3" "$tmp/a3.log" 'A3_SEES_B_BLOCKED=' "$tmp/b3.log" 'B3_STARTED'

  echo "==> ARM 4: authority revoked while the act is parked (sessions 77 + 78, one-shot 79)"
  # Three clients, and the driver starts the third only after the second has printed its entry token. The
  # revoking session's own gate is `pg_locks`, so it waits for the act to be provably parked before it writes,
  # and the holder waits for the revocation to be a committed row before it releases. No sleep is load-bearing
  # anywhere in this arm.
  start_session supabase/tests/stage11/race/77_race_arm4_holder.sql "$tmp/h4.log"; h4=$LAST_PID
  marker "$tmp/h4.log" 'A4_LOCKED='
  start_session supabase/tests/stage11/race/78_race_arm4_waiter.sql "$tmp/w4.log"; w4=$LAST_PID
  marker "$tmp/w4.log" 'W4_STARTED='
  start_session supabase/tests/stage11/race/79_race_arm4_revoke.sql "$tmp/r4.log"; r4=$LAST_PID
  st=0; wait "$h4" || st=$?; session_log "77_race_arm4_holder" "$tmp/h4.log" "$st"
  st=0; wait "$r4" || st=$?; session_log "79_race_arm4_revoke" "$tmp/r4.log" "$st"
  st=0; wait "$w4" || st=$?; session_log "78_race_arm4_waiter" "$tmp/w4.log" "$st"
  marker "$tmp/h4.log" 'A4_SEES_WAITER_BLOCKED='
  marker "$tmp/h4.log" 'A4_SAW_REVOKE_COMMITTED='
  marker "$tmp/h4.log" 'A4_COMMITTED='
  marker "$tmp/r4.log" 'R4_SEES_WAITER_BLOCKED='
  marker "$tmp/r4.log" 'R4_COMMITTED='
  marker "$tmp/w4.log" 'W4_APPLIED='
  marker "$tmp/w4.log" 'W4_AUTH_AFTER=refused-as-revoked'
  rendezvous "ARM 4 holder" "$tmp/h4.log" 'A4_SEES_WAITER_BLOCKED=' "$tmp/w4.log" 'W4_STARTED'
  rendezvous "ARM 4 revoker" "$tmp/r4.log" 'R4_SEES_WAITER_BLOCKED=' "$tmp/w4.log" 'W4_STARTED'
  # The arm's premise, checked rather than eyeballed: the third client says it saw an act ungranted on
  # transaction id N, and the first client says N is its own. Two logs naming the same id is what turns "the
  # revocation was written while *this* lock was held" into a fact about the data. If they disagree, the
  # revocation landed against some other transaction and `RC10`–`RC12` would be counting a sequence other than
  # the one their headers describe — true numbers about an arm that did not happen.
  hx="$(xact_id "$tmp/h4.log" 'xact')"
  rx="$(xact_id "$tmp/r4.log" 'xid')"
  if [ -z "$hx" ] || [ "$hx" != "$rx" ]; then
    echo "!! ARM 4 lock ids do not agree: holder xact='$hx', observed by the revoking client as xid='$rx'."
    echo "!! The revocation was not written while the act was parked on this holder's publication lock, so"
    echo "!! this arm's chronology is not what its files claim. Read the three logs before citing any cell"
    echo "!! below; an arm that did not interleave is an invalid arm."
    exit 1
  fi
  echo "==> ARM 4 rendezvous confirmed on transaction id $hx"

  suite "stage 11 83_race_arm4_asserts" supabase/tests/stage11/race/83_race_arm4_asserts.sql tx lines

  echo "==> ARM 5: two trusted-channel appenders, one thread ordinal (sessions 80 + 81)"
  start_session supabase/tests/stage11/race/80_race_arm5_first.sql "$tmp/a5.log"; a5=$LAST_PID
  marker "$tmp/a5.log" 'A5_APPLIED='
  start_session supabase/tests/stage11/race/81_race_arm5_second.sql "$tmp/b5.log"; b5=$LAST_PID
  st=0; wait "$a5" || st=$?; session_log "80_race_arm5_first" "$tmp/a5.log" "$st"
  st=0; wait "$b5" || st=$?; session_log "81_race_arm5_second" "$tmp/b5.log" "$st"
  marker "$tmp/a5.log" 'A5_SEES_B_BLOCKED='
  marker "$tmp/a5.log" 'A5_COMMITTED='
  marker "$tmp/b5.log" 'B5_REFUSAL=expected-ordinal-collision'
  rendezvous "ARM 5" "$tmp/a5.log" 'A5_SEES_B_BLOCKED=' "$tmp/b5.log" 'B5_STARTED'

  suite "stage 11 84_race_replay_asserts" supabase/tests/stage11/race/84_race_replay_asserts.sql rollback lines
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

if [ "$MODE" = all ] || [ "$MODE" = race ]; then
  build_chain race
  run_race_battery
  # The scoped teardown §1 asks for, in two halves: `84_race_replay_asserts.sql` rolls back the one cell that
  # writes through a door, and dropping the database here removes everything the five arms committed. Nothing
  # this tier produced survives its own mode, and nothing of anyone else's was ever in it — the database name is
  # this runner's own, created at the top of the chain and dropped at the bottom of it.
  admin_sql -c "DROP DATABASE IF EXISTS st11qual_race WITH (FORCE)" >/dev/null | mask
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
echo "==> The race tier is the only mode here that ran two or three live backends against one row at once. Its"
echo "    numbers are the assert files' (RC00–RC16, RD00–RD07); its session logs are chronology and are never"
echo "    counted, which is why a session prints no PASS line at all. Where the two disagree, the logs say what"
echo "    order the statements happened in and the cells say what the database ended up holding — and an arm"
echo "    whose rendezvous never happened fails here, on its own word, rather than becoming a number."
echo "    The race chain's committed residue is real: five takedowns' worth of revoked publications,"
echo "    invalidated artefacts and trail rows, all of it planted by this tier's own fixture and all of it"
echo "    dropped with st11qual_race above. It never ran against the local development stack, and it never can:"
echo "    §1 of the Stage 11 brief forbids concurrency against customer data, and no cell in this tier would"
echo "    survive being pointed at a wedding belonging to a real couple."
echo "==> Boundary: plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase Auth,"
echo "    the Storage API and any HTTP operator surface were not executing, and no JWT was verified. The"
echo "    caller class that matters most to this stage — a signed-in hostile host at the wire — is claimed"
echo "    here only through the test.uid shim, and its measurement belongs to the API battery."
echo "    What these numbers carry is the grant table, the predicate, the two service-only bodies, the audit"
echo "    columns, the CHECKs, the replay index, the append-only refusal and the privilege revocations."
