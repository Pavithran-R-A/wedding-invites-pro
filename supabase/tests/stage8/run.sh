#!/usr/bin/env bash
# Stage 8 database qualification runner. Throwaway Postgres only — no remote project, no
# `supabase link`, no `db push` against a hosted project, nothing persisted anywhere.
#
#   bash supabase/tests/stage8/run.sh                    # all four chains, in Docker
#   bash supabase/tests/stage8/run.sh guest              # Stage 8's own two batteries
#   bash supabase/tests/stage8/run.sh family             # Stage 7's two batteries, at Stage 8 head
#   bash supabase/tests/stage8/run.sh historic           # the older suites, both chain variants
#   STAGE8_LOCAL=1 PGHOST=127.0.0.1 PGPORT=54401 PGUSER=postgres \
#     bash supabase/tests/stage8/run.sh guest            # an already-running cluster
#
# Why there are three kinds of chain, stated before the code. Both of this stage's batteries end with a
# census that counts *cluster-wide*, and so does Stage 7's:
#
#   * `tests/stage8/90_guest_rsvp.sql` group Z asks how many guest households the cluster has, how many
#     credentials of each kind are live anywhere, what the global `rsvp_responses` total is, and whether
#     the `rsvp` token kind is still unused. Those are true on a chain that ran nothing but battery 1 and
#     battery 2, and false on a chain that has also run `tests/stage2/20_attacks.sql`, which deliberately
#     commits seed rows and whose own runner documents that ordering consequence.
#   * `tests/stage8/80_guest_invitation_links.sql` builds the family both batteries read (the two
#     weddings, the six households, the three uneven events, the frozen versions, the live publication)
#     and 90 takes its cast out of those committed rows by name. 90 does not build its own family:
#     running 80 alone is not a weaker test, it is a different one, and it does not pass.
#   * Stage 7's `80_family_review.sql` census (R1-R7) counts approval requests and review credentials
#     cluster-wide, for the reason `stage7/run.sh` records — which is why it, too, gets a chain that has
#     run nothing else, rather than being folded into the historic sweep and read as a failure it is not.
#
# So the chains are separated instead of the assertions:
#
#   guest     bootstrap -> storage fixture -> published -> stage2..stage8 -> 80, then 90
#   family    bootstrap -> storage fixture -> published -> stage2..stage8 -> Stage 7's 80, then 90
#   historic  bootstrap -> storage fixture -> published -> [legacy seed]
#             -> stage2..stage8 -> Stage 2's outcome, draft, publication, attack and catalog suites
#             -> Stage 4's two suites -> Stage 5's suites -> Stage 6's suites
#
# The `historic` sweep therefore does not contain either stage's own pair, and the totals it prints are
# re-measurements of *older* suites against a schema that contains Stage 8. They say nothing about the
# guest censuses, and the guest chain's numbers say nothing about these. That is a property of the
# instrument, not a gap in it; the three sections are labelled accordingly at the end.
#
# `app.stage_head=stage8` travels to the head-aware assertions for the reason every runner since Stage 5
# gives: an expectation that only holds at one head has to be duplicated, and one that names the head it
# is measuring is a stronger claim.
#
# Boundary, stated rather than hidden: plain Postgres plus `supabase/tests/rls/00_bootstrap.sql` and the
# Stage 6 storage-schema fixture. It proves the schema, the grants, the policies, the triggers, the token
# store, the event scoping and the RSVP state machine as SQL. It does not prove PostgREST, Supabase Auth
# or the Storage API: no guest door is opened over HTTP here, no `x-guest-token` header is read by a
# gateway, no JWT is verified, no browser renders an invitation. That is the separate HTTP battery, and
# the separate browser tier. See docs/audits/stage-8-guest-rsvp.md.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root

MODE="${1:-all}"
case "$MODE" in guest|family|historic|all) ;; *) echo "usage: $0 [guest|family|historic|all]"; exit 2 ;; esac

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-stage8-$$"
export PGCLIENTENCODING=UTF8
export PGOPTIONS="-c app.stage_head=stage8"

sql_bytes() { tr -d '\r' < "$1"; }

# Every line this script prints about a suite goes through `mask` on its way out, and the reason is
# specific to Stage 8 rather than defensive theatre. Stage 8's batteries mint guest credentials, and a
# failing assertion in this workflow routinely prints the value it was handed — which for the door and
# answer helpers *is* a live raw token. A failing run would otherwise hand that token to the terminal and
# to any log the operator redirects, and the stage's own privacy rule forbids a raw credential in records,
# committed code, telemetry and logs alike. Masking at the runner is the last place where it can be done
# for every suite at once, including a suite not yet audited for this.
#
# 43 is the measured length of a minted credential (32 random bytes, base64url without padding), which
# group Z8 re-asserts for the three raws it leaves for the HTTP tier. The pattern also eats Postgres'
# dashed column separators, which is why the printed output keeps the result rows and not the ruler.
mask() { sed -E 's/[A-Za-z0-9_-]{43}/[REDACTED-43]/g'; }

if [ "${STAGE8_LOCAL:-0}" = "1" ]; then
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
         echo "!! Use STAGE8_LOCAL=1 against a local cluster; do not treat a pull failure as a code failure."; exit 3; }
  run_tx() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }
  run_rollback() { sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q; }
  admin_sql() { docker exec -i "$CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
  # The census probe needs the chain's own database *and* the chain's own session GUC, so it cannot reuse
  # `admin_sql`: that helper exists to create and drop databases, which only makes sense against the
  # maintenance database, and it carries no `PGOPTIONS`. This is Stage 7's runner recording a measured
  # failure of its own instrument — the probe written with `admin_sql` printed three zeros about the wrong
  # database, sitting above suites that assert real counts — and the same trap is here unchanged, because
  # a summary line that measures nothing is worse than no summary line: it reads as a confirmation.
  probe_sql() { docker exec -i -e PGCLIENTENCODING=UTF8 -e PGOPTIONS="$PGOPTIONS" "$CTR" \
               psql -d "$DB" -U postgres -v ON_ERROR_STOP=1 -q -tA "$@"; }
fi

RESULTS=""
# suite <label> <file> <tx|rollback> <lines|counter>
#
# The fourth argument is stated per suite rather than inferred, because these files do not print alike and
# both styles are legitimate. Stage 8's own two batteries use the `lines` style, which is measured from
# their harness rather than assumed: each has exactly three `RAISE NOTICE 'PASS %'` sites — one inside
# `ok`, one inside `eq`, and one per probe row inside `run` — and each ends with a single
# `SELECT '<suite> PASSED (n)'`, so the reported total and the printed line count must agree exactly, and
# this script refuses the run when they do not.
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

build_chain() { # build_chain <guest|family|clean|legacy>
  DB="st8qual_$1"
  echo
  echo "=================================================================="
  echo "==> Chain: $1  (database $DB)  — schema head: Stage 8"
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

  # Stage files in their own stage order — the only order that matches a real deployment, for the reason
  # `stage2/run.sh` records. Stage 8 is appended, not substituted.
  for stage in stage2 stage3 stage4 stage5 stage6 stage7 stage8; do
    for m in $(ls supabase/migrations/*.sql | grep "_${stage}_" | sort); do
      run_tx "$m" | mask
    done
  done

  # The surface the Stage 8 batteries then assert against, printed rather than assumed: nineteen exposed
  # wrappers and thirty internal bodies, at the head this session declared. Both numbers are re-derivable
  # without running anything — Stage 7's runner measured thirteen and twenty-four at its own head, and
  # this migration adds exactly six names to each schema:
  #
  #   api.           get_guest_invitation_state, issue_guest_invitations, resolve_guest_invitation,
  #                  revoke_guest_invitation, rotate_guest_invitation, submit_guest_rsvp
  #   internal_api.  the same six bodies, plus this migration re-creating two earlier internal names
  #                  (`publish_invitation_version`, `revoke_invitation_publication`) to repair the
  #                  nested-call grant, which changes no name and so no count.
  #
  # Read them as rows of `pg_proc`, not as names in source: a name declared twice with two argument lists
  # would count twice here and once in the grep above. A chain that applied Stage 8's migration and
  # printed a different shape has a problem this script cannot name and the suites below report as a
  # mismatch.
  #
  # Those two numbers belong to this chain and to no other: the loop above stops at `stage8`, so the
  # Stage 7 chain's own thirteen and twenty-four remain `stage7/run.sh`'s to print, and it should not
  # print these.
  probe_sql \
    -c "select 'DECLARED_HEAD=' || coalesce(current_setting('app.stage_head', true), '(unset)')" \
    -c "select 'API_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'" \
    -c "select 'INTERNAL_NAMES=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'internal_api'" \
    | mask
}

run_stage8_batteries() {
  local found=0 f
  # `[89]*` is the measured shape of this directory: Stage 8's qualification is the 80/90 pair and there is
  # no `00_*` fixture here — the storage fixture this chain needs is Stage 6's, applied by `build_chain`
  # above. Naming the expected prefix is what turns "the loop ran over nothing" into a failure instead of a
  # quiet pass.
  for f in $(ls supabase/tests/stage8/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 8 $(basename "$f" .sql)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 8 suite matched supabase/tests/stage8/[89]*.sql."
    echo "!! The runner would print historic totals only, which is the failure shape the Stage 7 runner"
    echo "!! records: an older enumeration that exits 0 while the new stage is invisible to it."
    exit 1
  fi
}

run_stage7_batteries() {
  local found=0 f
  # Stage 7's pair is re-run here, at the Stage 8 head, on a chain that runs nothing else — the same
  # isolation Stage 7 gave its own censuses. A drift between this section's totals and the ones
  # `stage7/run.sh` printed at Stage 7's head is the point of running it: Stage 8 changed the guest
  # credential store Stage 7's review boundary reads from.
  for f in $(ls supabase/tests/stage7/[89]*.sql 2>/dev/null | sort); do
    found=1
    suite "stage 7 $(basename "$f" .sql) (at Stage 8 head)" "$f" tx lines
  done
  if [ "$found" = "0" ]; then
    echo "!! No Stage 7 suite matched supabase/tests/stage7/[89]*.sql, so Stage 7's family boundary was"
    echo "!! never re-measured against this schema. That is a missing regression, not a pass."
    exit 1
  fi
}

run_historic_suites() { # run_historic_suites <clean|legacy>
  if [ "$1" = legacy ]; then
    suite "stage 2 migration outcome (historical rows, at Stage 8 head)" supabase/tests/stage2/30_migration_legacy.sql tx lines
  else
    suite "stage 2 migration outcome (nothing invented, at Stage 8 head)" supabase/tests/stage2/30_migration_empty.sql tx lines
  fi
  # Outcome before attacks, for the reason `stage2/run.sh` gives and this runner is the one place it
  # matters: the attack suite seeds rows, and the outcome counts were measured on a chain that had not been
  # attacked.
  suite "stage 3 draft invariant (at Stage 8 head)" supabase/tests/stage3/20_draft_invariant.sql tx counter
  suite "stage 3 publication boundary (at Stage 8 head)" supabase/tests/stage3/30_publication.sql tx counter
  suite "stage 2 privilege + RLS attacks (at Stage 8 head)" supabase/tests/stage2/20_attacks.sql tx counter
  suite "stage 2 catalog conformance (at Stage 8 head)" supabase/tests/stage2/40_catalog.sql tx lines

  suite "stage 4 pack documents (at Stage 8 head)" supabase/tests/stage4/50_pack_release.sql tx lines
  suite "stage 4 §8 fixture tooling (at Stage 8 head)" supabase/tests/stage4/60_reviewed_fixture.sql rollback lines
  local f
  for f in $(ls supabase/tests/stage5/[0-9]*.sql 2>/dev/null | grep -vE '_rollback\.sql$' | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 8 head)" "$f" tx lines
  done
  for f in $(ls supabase/tests/stage5/*_rollback.sql 2>/dev/null | sort); do
    suite "stage 5 $(basename "$f" .sql) (at Stage 8 head)" "$f" rollback lines
  done
  for f in $(ls supabase/tests/stage6/[89]*.sql 2>/dev/null | sort); do
    suite "stage 6 $(basename "$f" .sql) (at Stage 8 head)" "$f" tx lines
  done
}

if [ "$MODE" = all ] || [ "$MODE" = guest ]; then
  build_chain guest
  run_stage8_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st8qual_guest WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = family ]; then
  build_chain family
  run_stage7_batteries
  admin_sql -c "DROP DATABASE IF EXISTS st8qual_family WITH (FORCE)" >/dev/null | mask
fi

if [ "$MODE" = all ] || [ "$MODE" = historic ]; then
  for variant in clean legacy; do
    build_chain "$variant"
    run_historic_suites "$variant"
    admin_sql -c "DROP DATABASE IF EXISTS st8qual_$variant WITH (FORCE)" >/dev/null | mask
  done
fi

echo
echo "==> Stage 8 database qualification"
echo "$RESULTS"
echo "==> Stage 8's own two batteries ran on a chain that ran nothing else, because 90's closing census"
echo "    counts rows cluster-wide, and 80's family is the fixture 90 reads; Stage 7's pair ran on its own"
echo "    empty chain for the same reason its own runner gives. The older suites ran on chains that had"
echo "    not been given Stage 8's guest families. No set of numbers here is evidence about another"
echo "    database, and none of them should be quoted as if it were."
echo "==> Every total labelled 'at Stage 8 head' is a re-measurement of an older suite against a schema"
echo "    that contains Stage 8. The older runners' own totals still describe their own heads."
echo "==> Boundary: plain Postgres + role/auth shim + a storage-schema fixture. PostgREST, Supabase Auth"
echo "    and the Storage API were not executing, so no REST-level, header-level or browser-level claim is"
echo "    carried by these numbers — the guest door's actual HTTP status and body, the"
echo '    `x-guest-token`/`x-invitation-token` separation and the rendered invitation are the HTTP and'
echo "    browser tiers' to prove."
