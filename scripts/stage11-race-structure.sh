#!/usr/bin/env bash
# Engine-independent structure validator for the Stage 11 two-operator race tier.
#
# Why a separate instrument: the tier's claims are of two kinds. One kind needs a Postgres engine — does the
# trail index actually refuse the second delivery? — and that half cannot be measured here, because the shared
# Docker engine is down by instruction and §1 of the brief forbids concurrency against customer data. The other
# kind is a property of the bytes: is an arm registered, is its rendezvous witnessed rather than hoped for, does
# the driver wait on a string its session can actually print, is a broken plant fatal rather than cosmetic?
# Those are decidable without a database, and every rule below is one such claim.
#
# A green run here means "the instrument is wired as its own headers say" and nothing more. It is not a race
# tier pass: no cell in RC00-RC16 or RD00-RD07 executed, because no rule here touches a database.
#
# Each rule is written so that it can fire, and stage11-race-mutation.sh proves it by breaking one byte per rule
# in a copy of the tree and requiring that named rule to fail. A rule that cannot fire is decoration.
#
# Usage: stage11-race-structure.sh [repo-root]
#   default: the repository that holds this scripts/ directory, so a fresh clone validates its own tier.
# Paths are used as basenames throughout: the repository path contains spaces, and an unquoted command
# substitution over it splits into three arguments, which is how the first draft of this script reported
# phantom failures against files it had not actually opened.

# Resolved before the `cd` below, because a relative `$0` stops naming this directory once the script has moved.
# `${0%/*}` is `$0` itself when `$0` carries no slash — which is exactly how `bash stage11-race-structure.sh` is
# typed from inside this directory — so that form names the current directory instead, and the arity helper beside
# it is found rather than declared missing. The first version of this line reported S26 as an unmeasured rule
# purely because of how the validator had been invoked. The same self-location now also answers where the
# repository is, which is what made this script promotable: it no longer names a machine.
self_dir_src="${0%/*}"; [ "$self_dir_src" = "$0" ] && self_dir_src=.
SELF_DIR="$(cd "$self_dir_src" 2>/dev/null && pwd)"
REPO="${1:-$(cd "$SELF_DIR/.." && pwd)}"
RUN="$REPO/supabase/tests/stage11/run.sh"
RACE="$REPO/supabase/tests/stage11/race"

pass=0; fail=0; fails=""
ok()  { printf 'PASS %s: %s\n' "$1" "$2"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s: %s\n' "$1" "$2"; fail=$((fail + 1)); fails="$fails $1"; }
bad_detail() { local id="$1" msg="$2"; printf 'FAIL %s: %s\n' "$id" "$msg"; shift 2
  for d in "$@"; do printf '         %s\n' "$d"; done; fail=$((fail + 1)); fails="$fails $id"; }

[ -f "$RUN" ] && [ -d "$RACE" ] || { echo "!! cannot validate: $RUN or $RACE missing"; exit 2; }
cd "$RACE" || exit 2

SESSIONS="71_race_arm1_a.sql 72_race_arm1_b.sql 73_race_arm2_a.sql 74_race_arm2_b.sql
75_race_arm3_a.sql 76_race_arm3_b.sql 77_race_arm4_holder.sql 78_race_arm4_waiter.sql
79_race_arm4_revoke.sql 80_race_arm5_first.sql 81_race_arm5_second.sql"

# ---------------------------------------------------------------- S01 the driver parses as bash
if bash -n "$RUN" 2>/dev/null; then ok S01 "run.sh parses as bash"
else bad_detail S01 "run.sh does not parse" "$(bash -n "$RUN" 2>&1 | head -3)"; fi

# ---------------------------------------------------------------- S02 the race mode is wired end to end
# Each of the three has to be an executable line *inside the race dispatch block*. The first draft grepped the
# whole runner, and mutation control commented the chain build out with a line that repeated the words —
# `: # build_chain race removed by mutation control` — and the rule stayed green on a tier that would have run
# its arms against no database. A needle in a comment is not a wiring fact, and that is the defect here.
grep -qF 'authority|historic|regress|race|all)' "$RUN" && m_disp=1 || m_disp=0
wiring=$(awk '
  /= race \]; then/            { inb = 1 }
  inb && /^fi$/                { inb = 0 }
  inb && !/^[[:space:]]*#/ {
    if ($0 == "  build_chain race") print "build " NR
    if ($0 == "  run_race_battery") print "call " NR
    if ($0 ~ /^  admin_sql -c "DROP DATABASE IF EXISTS st11qual_race WITH \(FORCE\)"/) print "drop " NR
  }' "$RUN")
b_line=$(printf '%s\n' "$wiring" | awk '$1 == "build" { print $2; exit }')
c_line=$(printf '%s\n' "$wiring" | awk '$1 == "call"  { print $2; exit }')
d_line=$(printf '%s\n' "$wiring" | awk '$1 == "drop"  { print $2; exit }')
if [ "$m_disp" = 1 ] && [ -n "$b_line" ] && [ -n "$c_line" ] && [ -n "$d_line" ]; then
  ok S02 "race mode accepted, and build ($b_line), battery ($c_line) and teardown ($d_line) are live lines of its own dispatch block"
else
  bad S02 "race wiring is not three live lines of the dispatch block: mode_accepted=$m_disp build=${b_line:-absent-or-commented} call=${c_line:-absent-or-commented} drop=${d_line:-absent-or-commented}"
fi
if [ -n "$b_line" ] && [ -n "$c_line" ] && [ -n "$d_line" ] && [ "$b_line" -lt "$c_line" ] && [ "$c_line" -lt "$d_line" ]; then
  ok S02b "the block's order is build -> battery -> teardown ($b_line < $c_line < $d_line): a drop ahead of the arms is a missing database, a build behind them is arms run against somebody else's chain"
else
  bad S02b "the block's order is not build -> battery -> teardown (build=${b_line:-?} call=${c_line:-?} drop=${d_line:-?})"
fi

# ---------------------------------------------------------------- S03 registration, in both directions
disk=$(ls *.sql | sort)
refd=$(grep -oE 'supabase/tests/stage11/race/[0-9A-Za-z_]+\.sql' "$RUN" | sed 's|.*/||' | sort -u)
absent=$(comm -13 <(printf '%s\n' "$disk") <(printf '%s\n' "$refd"))
unref=$(comm -23 <(printf '%s\n' "$disk") <(printf '%s\n' "$refd"))
# The serial Stage 11 batteries glob `supabase/tests/stage11/[89]*.sql`. That glob must never reach an arm
# file: run as a serial suite, an arm's two sessions become one backend and its numbers read as if they had
# interleaved.
serial=$(cd "$REPO" && ls supabase/tests/stage11/[89]*.sql 2>/dev/null | sed 's|.*/||' | grep -c '_race_')
if [ -z "$absent" ] && [ -z "$unref" ] && [ "$serial" = 0 ]; then
  ok S03 "15 files on disk, 15 referenced, nothing orphaned either way, and no arm file swept by the serial glob"
else
  bad_detail S03 "registration is not two-way" "referenced but absent: ${absent:-none}" \
    "on disk but never run: ${unref:-none}" "matched by the serial glob: $serial"
fi

# ---------------------------------------------------------------- S04 dollar-quote tags balanced
bad_tags=""
for f in *.sql; do
  while read -r n tag; do
    [ -n "$n" ] || continue
    [ $((n % 2)) -eq 0 ] || bad_tags="$bad_tags $f:$tag($n)"
  done < <(grep -oE '\$[A-Za-z_0-9]*\$' "$f" | sort | uniq -c)
done
if [ -z "$bad_tags" ]; then ok S04 "every \$tag\$ opens and closes an even number of times in all 15 files"
else bad S04 "unbalanced dollar-quote tags:$bad_tags"; fi

# ---------------------------------------------------------------- S05 only suite files print a counted total
tot=$(grep -l 'STAGE11 RACE TESTS PASSED (' *.sql | sort | tr '\n' ' ')
exp="70_race_fixtures.sql 82_race_arm1_asserts.sql 83_race_arm4_asserts.sql 84_race_replay_asserts.sql "
sess_tot=$(for f in $SESSIONS; do grep -l 'STAGE11 RACE TESTS PASSED (' "$f" 2>/dev/null; done | tr '\n' ' ')
if [ "$tot" = "$exp" ] && [ -z "$sess_tot" ]; then
  ok S05 "exactly the four suite files print a counted total; no session file can"
else
  bad_detail S05 "the tier's arithmetic is not where the runner counts it" "printing: $tot" "expected: $exp"
fi

# ---------------------------------------------------------------- S06 session files emit no counted evidence
emit=""
for f in $SESSIONS; do
  grep -qE "s11r_cell\(|s11f_ok\(|'PASS |PASSED \(" "$f" && emit="$emit $f"
done
if [ -z "$emit" ]; then
  ok S06 "no session file calls a counting helper or prints a PASS line — an arm is chronology, not a score"
else bad S06 "session files emitting counted evidence:$emit"; fi

# ---------------------------------------------------------------- S07 the 25 numbered cells, one set per assert file
cell_audit=""
inventory() { grep -oE "s11r_cell\('[A-Z]{2}[0-9]{2}'" "$1" | sed -E "s/.*'([A-Z]{2}[0-9]{2})'/\1/"; }
check_set() { # check_set <file> <expected-list-spaced>
  local file="$1" want="$2" got calls dup
  got=$(inventory "$file" | sort -u | tr '\n' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')
  want=$(printf '%s' "$want" | tr -s ' ' | sed 's/^ //; s/ $//')
  calls=$(inventory "$file" | wc -l | tr -d ' ')
  dup=$(inventory "$file" | sort | uniq -d | tr '\n' ' ')
  if [ "$got" = "$want" ] && [ "$calls" = "$(printf '%s\n' $want | wc -l | tr -d ' ')" ] && [ -z "$dup" ]; then
    ok "S07/$file" "$calls cells, exactly $want"
  else
    bad_detail "S07/$file" "cell inventory wrong (calls=$calls, duplicates=${dup:-none})" "got: [$got]" "want: [$want]"
  fi
}
check_set 82_race_arm1_asserts.sql "RC00 RC01 RC02 RC03 RC04 RC05 RC06 RC07 RC08 RC09"
check_set 83_race_arm4_asserts.sql "RC10 RC11 RC12 RC13 RC14 RC15 RC16"
check_set 84_race_replay_asserts.sql "RD00 RD01 RD02 RD03 RD04 RD05 RD06 RD07"
all_ids=$(grep -hoE "s11r_cell\('R[CD][0-9]{2}'" *.sql | grep -oE "R[CD][0-9]{2}")
uniq_ids=$(printf '%s\n' "$all_ids" | sort -u | wc -l | tr -d ' ')
if [ "$uniq_ids" = 25 ] && [ "$(printf '%s\n' "$all_ids" | wc -l | tr -d ' ')" = 25 ]; then
  ok S07d "25 numbered cells declared across the tier, none declared twice"
else
  bad S07d "declared cells: $uniq_ids unique out of $(printf '%s\n' "$all_ids" | wc -l | tr -d ' ') declarations"
fi

# ---------------------------------------------------------------- S08 the rendezvous is a witness, not an advisory lock
if grep -q 'pg_advisory' *.sql "$RUN"; then
  bad S08 "advisory locks present — the arm would then prove the harness can wait, not that the row was contended"
  grep -n 'pg_advisory' *.sql "$RUN" | head -3 | sed 's/^/         /'
else
  ok S08 "no pg_advisory* in the tier or the driver: cross-session order rests on pg_locks rows over real locks"
fi

# ---------------------------------------------------------------- S09 a broken plant is fatal, never cosmetic
orphan=""
for f in *.sql; do
  while IFS= read -r ln; do
    nxt=$(sed -n "$((ln + 1)),$((ln + 3))p" "$f" | grep -c 'RAISE EXCEPTION')
    [ "$nxt" -ge 1 ] || orphan="$orphan $f:$ln"
  done < <(grep -nE "RAISE NOTICE '[A-Z0-9_]*(PLANT_BROKEN|GATE_FAILED)=" "$f" | cut -d: -f1)
done
n_plant=$(grep -hcE "RAISE NOTICE '[A-Z0-9_]*(PLANT_BROKEN|GATE_FAILED)=" *.sql | awk '{s+=$1} END {print s}')
if [ -z "$orphan" ]; then
  ok S09 "all $n_plant plant/gate failure notices are followed within 3 lines by RAISE EXCEPTION"
else
  bad S09 "plant/gate notices that print and continue, so an invalid arm would exit 0:$orphan"
fi

# ---------------------------------------------------------------- S10 each rendezvous token is under its own timeout
# The guard has to be a test, not a mention. `77_race_arm4_holder.sql` writes the word `ARM_INVALID` inside the
# prose two lines above its first gate, and a rule that accepted any occurrence of the string as the guard
# called the arm guarded with the `IF` rewritten to an unfireable literal — which is the defect this rule
# exists to catch, so the window is comment-blind and looks for the shape of a real test on the gate value.
unguarded=""
for f in *.sql; do
  while IFS= read -r ln; do
    [ "$ln" -gt 6 ] || continue
    sed -n "$((ln - 6)),$((ln - 1))p" "$f" | grep -vE '^[[:space:]]*--' \
      | grep -qE "LIKE 'ARM_INVALID%" || unguarded="$unguarded $f:$ln"
  done < <(grep -nE "RAISE NOTICE '[A-Z0-9_]*(SEES_B_BLOCKED|SEES_WAITER_BLOCKED|SAW_REVOKE_COMMITTED)=" "$f" | cut -d: -f1)
done
if [ -z "$unguarded" ]; then
  ok S10 "each rendezvous token sits under an ARM_INVALID test on its own gate string — a poll that never saw the wait aborts"
else
  bad S10 "rendezvous tokens with no ARM_INVALID guard within 6 lines above:$unguarded"
fi

# ---------------------------------------------------------------- S11 the driver waits on strings the SQL can print
# `marker` greps the rendered session log, so a pattern holding a `%` placeholder, or a value the arm prints
# only on another branch, parks the driver for its whole budget and then calls a working arm invalid. This is
# the rule that caught arm 2's `B2_MATCHES_STORED=% returned=%`: true of the log line, absent from the file.
LOGMAP=$(grep -oE 'start_session supabase/tests/stage11/race/[0-9A-Za-z_]+\.sql "\$tmp/[a-z0-9]+\.log"' "$RUN" \
  | sed -E 's|.*race/([0-9A-Za-z_]+\.sql) "\$tmp/([a-z0-9]+)\.log"|\2=\1|')
nomatch=""; nmark=0
while IFS= read -r mline; do
  nmark=$((nmark + 1))
  log=$(printf '%s\n' "$mline" | awk '{print $2}' | tr -d '"' | sed 's|.*/||; s|\.log$||')
  pat=$(printf '%s\n' "$mline" | awk -F"'" '{print $2}')
  sql=$(printf '%s\n' "$LOGMAP" | grep -E "^$log=" | head -1 | cut -d= -f2)
  [ -n "$sql" ] || { nomatch="$nomatch [$log:no session]"; continue; }
  grep -qF "$pat" "$sql" || nomatch="$nomatch $sql:'$pat'"
done < <(grep -E '^  marker "\$tmp/' "$RUN")
if [ -z "$nomatch" ] && [ "$nmark" -ge 20 ]; then
  ok S11 "all $nmark driver markers are literal strings their session file can emit"
else
  bad S11 "marker patterns absent from the session that must print them (markers=$nmark):$nomatch"
fi

# ---------------------------------------------------------------- S12 a session that raises must exit non-zero
nos_stop=""
n_def=0
while IFS= read -r ln; do
  n_def=$((n_def + 1))
  sed -n "$((ln)),$((ln + 2))p" "$RUN" | grep -q 'ON_ERROR_STOP=1' || nos_stop="$nos_stop run.sh:$ln"
done < <(grep -n 'start_session() {' "$RUN" | cut -d: -f1)
if [ "$n_def" = 2 ] && [ -z "$nos_stop" ]; then
  ok S12 "both start_session definitions carry ON_ERROR_STOP=1 — a self-raising plant failure cannot exit 0"
else
  bad S12 "start_session definitions=$n_def, missing the flag:$nos_stop"
fi

# ---------------------------------------------------------------- S13 budgets: the SQL gives up before the driver
sql_max=$(grep -hoE "pg_temp\.s11r_(waits|peer_waits|sees_revoke)\([^)]*[0-9]+\)" *.sql | grep -oE '[0-9]+\)' | tr -d ')' | sort -n | tail -1)
drv=$(sed -n 's/^  local n="\${3:-\([0-9]*\)}"$/\1/p' "$RUN" | head -1)
short=""
while IFS= read -r b; do [ "$b" -lt "$sql_max" ] && short="$short $b"; done \
  < <(grep -oE "^  marker \"\\\$tmp/[a-z0-9]+\\.log\" '[^']+' [0-9]+" "$RUN" | awk '{print $NF}')
if [ -n "$sql_max" ] && [ -n "$drv" ] && [ "$drv" -ge "$sql_max" ] && [ -z "$short" ]; then
  ok S13 "driver budget $drv >= max in-SQL poll $sql_max, and no marker call shortens it — the session's own ARM_INVALID surfaces first"
else
  bad S13 "driver budget=${drv:-none}, sql max polls=${sql_max:-none}, shorter calls=${short:-none}"
fi

# ---------------------------------------------------------------- S14 every cited cell id exists
decl_ids=$(grep -hoE "s11r_cell\('R[CD][0-9]{2}'" *.sql | grep -oE "R[CD][0-9]{2}" | sort -u)
cited=$(grep -hoE "R[CD][0-9]{2}" *.sql "$RUN" | sort -u)
ghost=$(comm -13 <(printf '%s\n' "$decl_ids") <(printf '%s\n' "$cited") | tr '\n' ' ')
if [ -z "$ghost" ]; then
  ok S14 "every RC/RD token in the tier and the driver names a declared cell ($(printf '%s\n' "$cited" | wc -l | tr -d ' ') distinct)"
else
  bad S14 "citations to cells nothing declares — prose pointing at an instrument that is not there: $ghost. Stated limit: this catches a nonexistent id, not a real id mis-attributed to the wrong claim."
fi

# ---------------------------------------------------------------- S15 every token a session prints reaches the log
# The driver reads a session log through two vocabularies: the chronology grep, for a run that finished, and
# the abort grep, which quotes the failure lines before it exits. A token in neither is printed by the arm and
# hidden from every reader of the run log — which is what `B1_PUB_SEEN_AFTER_BLOCK` and arm 3's two own-view
# lines were until this rule stopped accepting "at least one of the file's tokens is visible" as passing.
chron=$(sed -n "s/.*grep -E '\(STARTED=[^']*\)' || true.*/\1/p" "$RUN" | head -1)
abort=$(sed -n "s/.*grep -qE '\(UNEXPECTED[^']*\)'; then.*/\1/p" "$RUN" | head -1)
tok_lines=""
for f in $SESSIONS; do
  tok_lines="$tok_lines$(grep -oE "RAISE NOTICE '[A-Z0-9_]+=" "$f" | sed "s|RAISE NOTICE '||; s|^|$f |" | tr '\n' ';')"
done
hidden=$(printf '%s\n' "$tok_lines" | tr ';' '\n' | awk -v c="$chron" -v a="$abort" \
  'NF { if ($2 !~ c && $2 !~ a) print " " $1 ":" $2 }' | tr -d '\n')
n_tok=$(printf '%s\n' "$tok_lines" | tr ';' '\n' | grep -cE '[A-Z0-9_]+=$')
if [ -z "$hidden" ] && [ -n "$chron" ] && [ -n "$abort" ]; then
  ok S15 "all $n_tok tokens the 11 sessions emit are in one of the two vocabularies the driver greps the log with"
else
  bad S15 "session tokens the printed run log would hide:$hidden (chron=${chron:-unparsed} abort=${abort:-unparsed})"
fi

# ---------------------------------------------------------------- S16 transaction style matches the invocation mode
mis=""
while IFS= read -r line; do
  file=$(printf '%s\n' "$line" | sed -E 's|.*race/([0-9A-Za-z_]+\.sql).*|\1|')
  mode=$(printf '%s\n' "$line" | awk '{print $(NF-1)}')
  [ -f "$file" ] || continue
  b=$(grep -c '^BEGIN;' "$file"); c=$(grep -c '^COMMIT;' "$file"); r=$(grep -c '^ROLLBACK;' "$file")
  case "$mode" in
    tx)  { [ "$b" = 0 ] && [ "$c" = 0 ] && [ "$r" = 0 ]; } || mis="$mis $file(tx B=$b C=$c R=$r)" ;;
    rollback) { [ "$b" -ge 1 ] && [ "$r" -ge 1 ] && [ "$c" = 0 ]; } || mis="$mis $file(rollback B=$b C=$c R=$r)" ;;
  esac
done < <(grep -E '^  suite "stage 11 [0-9]' "$RUN")
for f in $SESSIONS; do
  b=$(grep -c '^BEGIN;' "$f"); c=$(grep -c '^COMMIT;' "$f"); r=$(grep -c '^ROLLBACK;' "$f")
  { [ "$b" = 1 ] && { [ "$c" -ge 1 ] || [ "$r" -ge 1 ]; }; } || mis="$mis $f(session B=$b C=$c R=$r)"
done
if [ -z "$mis" ]; then
  ok S16 "suite files hold no top-level transaction statements (they run inside --single-transaction); each session file owns and ends its own"
else
  bad S16 "transaction style disagrees with how the file is invoked:$mis"
fi

# ---------------------------------------------------------------- S17 no arbitrary waits: one cadence, every poll bounded
args=$(grep -hoE 'pg_sleep\([0-9.]+\)' *.sql | sort -u | tr '\n' ' ')
unbound=""
for f in $(grep -l 'pg_sleep' *.sql); do
  grep -q 'ARM_INVALID' "$f" || unbound="$unbound $f"
done
if [ "$args" = "pg_sleep(0.05) " ] && [ -z "$unbound" ]; then
  ok S17 "the tier's only pg_sleep is the 0.05 poll cadence, and every file that polls can return ARM_INVALID — the brief's 'no arbitrary sleeps' holds at this width"
else
  bad S17 "sleep arguments:[$args] files polling with no bound:${unbound:-none}"
fi

# ---------------------------------------------------------------- S18 an idempotency key stays inside its arm
arm_of() { case "$1" in
  71_*|72_*) echo arm1 ;; 73_*|74_*) echo arm2 ;; 75_*|76_*) echo arm3 ;;
  77_*|78_*|79_*) echo arm4 ;; 80_*|81_*) echo arm5 ;; *) echo other ;; esac; }
spread=""; outofblock=""
for k in $(grep -hoE '0000000003[0-9][0-9]' $SESSIONS | sort -u); do
  groups=""
  for f in $(grep -lE "$k" $SESSIONS | sort -u); do groups="$groups $(arm_of "$f")"; done
  n=$(printf '%s' "${k#0000000003}")
  n=$((10#$n))
  [ "$n" -ge 1 ] && [ "$n" -le 13 ] || outofblock="$outofblock $k"
  g=$(printf '%s\n' $groups | sort -u | wc -l | tr -d ' ')
  [ "$g" = 1 ] || spread="$spread $k($(printf '%s' "$groups" | tr ' ' ','))"
done
if [ -z "$spread" ] && [ -z "$outofblock" ]; then
  ok S18 "each …03xx key is mentioned inside one arm only, and every key lies in the allocated block 0301-0313"
else
  bad S18 "keys shared across arms:${spread:-none} keys outside the block:${outofblock:-none}"
fi

# ---------------------------------------------------------------- S19 synthetic rows only, race chain only
real_uuid=$(grep -hoE "'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'" *.sql \
  | sort -u | grep -v "^'0b0b0b00" | wc -l | tr -d ' ')
race_block=$(awk '/= race \]; then/,/^fi$/' "$RUN")
other_chain=$(printf '%s\n' "$race_block" | grep -oE 'st11qual_[a-z]*' | sort -u | grep -v '^st11qual_race$' | tr '\n' ' ')
teardown=$(grep -lE 'TRUNCATE|DROP TABLE|DELETE FROM' *.sql | grep -v '^70_race_fixtures.sql$' | tr '\n' ' ')
if [ "$real_uuid" = 0 ] && [ -z "$other_chain" ] && [ -z "$teardown" ]; then
  ok S19 "every uuid literal is under the 0b0b0b00 plant prefix, the race block names only its own chain, and only the fixture file issues teardown DDL"
else
  bad S19 "non-synthetic uuids=$real_uuid other chains='$other_chain' teardown outside 70='$teardown'"
fi

# ---------------------------------------------------------------- S20 a verdict survives mask()
# `session_log` masks before printing, and mask() redacts any run of 36-43 characters. A verdict word that long
# arrives in the run log as `[REDACTED-LONG]`: the tier's exit status is untouched, but the line a human cites as
# evidence stops saying anything — which is how arm 2's and arm 3's long refusal words read until they were
# shortened. The rule applies the driver's *own* mask program rather than a copy of it, so changing mask()
# changes what this flags instead of leaving the two out of date with each other.
MASK_PROG=$(sed -n "s/^mask() { sed -E '\(.*\)'; }$/\1/p" "$RUN" | head -1)
swallowed=""; n_verdicts=0
if [ -z "$MASK_PROG" ]; then
  bad S20 "mask()'s program could not be read out of run.sh, so the rule that depends on it cannot be measured"
else
  while IFS= read -r line; do
    n_verdicts=$((n_verdicts + 1))
    [ "$(printf '%s' "$line" | sed -E "$MASK_PROG")" = "$line" ] || swallowed="$swallowed SQL:$line"
  done < <(grep -hoE "RAISE NOTICE '[A-Z0-9_]+=[A-Za-z0-9_ -]+'" *.sql)
  while IFS= read -r pat; do
    n_verdicts=$((n_verdicts + 1))
    [ "$(printf '%s' "$pat" | sed -E "$MASK_PROG")" = "$pat" ] || swallowed="$swallowed marker:$pat"
  done < <(grep -E '^  marker "\$tmp/' "$RUN" | awk -F"'" '{print $2}')
  if [ -z "$swallowed" ] && [ "$n_verdicts" -ge 20 ]; then
    ok S20 "all $n_verdicts punctuation-free verdict literals and marker patterns are unchanged by mask() itself"
  else
    bad S20 "verdicts mask() rewrites (measured $n_verdicts):$swallowed"
  fi
fi

# ---------------------------------------------------------------- S21 arm 4's ids are compared, not eyeballed
h_id=$(grep -cE 'hx="\$\(xact_id "\$tmp/h4\.log" .xact.\)"' "$RUN")
r_id=$(grep -cE 'rx="\$\(xact_id "\$tmp/r4\.log" .xid.\)"' "$RUN")
guard=$(awk '/\$hx" != "\$rx/ {f=NR} f && NR-f<=8 && /exit 1/ {print "yes"; exit}' "$RUN")
if [ "$h_id" = 1 ] && [ "$r_id" = 1 ] && [ -n "$guard" ]; then
  ok S21 "the holder's own xact id and the revoker's observed xid are both extracted and compared, with exit 1 within 8 lines of disagreement"
else
  bad S21 "arm 4 id equality not wired: holder=$h_id revoker=$r_id guard=${guard:-missing}"
fi

# ---------------------------------------------------------------- S22 no live or hosted target is reachable
# Measured on executable lines only, because both files *comment* about the boundary: `run.sh:48` and
# `70_race_fixtures.sql:8` say the tier never runs against `localvivaahvarnam`, and a rule that read a
# disclaimer as a connection string would fail the tree for documenting the thing it refuses to do.
live=$( { grep -hvE '^[[:space:]]*--' *.sql; grep -vE '^[[:space:]]*#' "$RUN"; } \
  | grep -inE 'localvivaahvarnam|\.supabase\.co|db_url|session_url|supabase (db|functions|start)' | head -3)
if [ -z "$live" ]; then
  ok S22 "no executable line in the tier or the driver names the local stack, the Supabase CLI or a hosted endpoint"
else
  bad S22 "the race tier reaches for a live or hosted target; §1 forbids concurrency against customer data:"
  printf '         %s\n' "$live"
fi

# ---------------------------------------------------------------- S23 each arm owns the tokens it prints
# `76_race_arm3_b.sql` emitted `B3_W4_SEEN_BY_B` and `B3_W4_AFTER_ROLLBACK` — two of arm 3's observations
# carrying arm 4's waiter prefix, which mutation control surfaced by accident. A run log grepped or sorted by
# prefix attributes them to the wrong session, and nowhere else in the tier is a token's owner written down.
# The prefixes are read off the files themselves rather than a table, so a sixth arm cannot join a list this
# rule never consults.
ns_bad=$(printf '%s\n' "$tok_lines" | tr ';' '\n' | awk '
  NF { file = $1; tok = $2
       if (match(tok, /^[A-Z][0-9]/)) { pre = substr(tok, RSTART, RLENGTH)
         lead[file] = pre; nlead[file, pre] = 1
         if (!(pre in islead)) { islead[pre] = 1; nl++; LEADS[nl] = pre } }
       lines[NR] = file "\t" tok }
  END { for (i = 1; i <= NR; i++) { split(lines[i], a, "\t"); f = a[1]; t = a[2]
          for (p = 1; p <= nl; p++) { L = LEADS[p]
            if (L != lead[f] && t ~ ("(^|_)" L "(_|$)")) out = out " " f ":" t "(" L ")" }
          for (p = 1; p <= nl; p++) if (nlead[f, LEADS[p]] && LEADS[p] != lead[f])
            out = out " " f "(two own prefixes: " lead[f] "/" LEADS[p] ")" }
        print out }')
if [ -z "$ns_bad" ]; then
  ok S23 "every token sits in the namespace of the session that prints it, and no session spans two namespaces"
else
  bad S23 "tokens carrying another arm's prefix, or a file with two own prefixes:$ns_bad"
fi

# ---------------------------------------------------------------- S24 the wait witness is a pid, never a name
# Tier attempt 3 died here: the arms' rendezvous joined `pg_locks` to `pg_stat_activity` on the peer's
# `application_name`, and a session inside an open transaction reads that view frozen at the backends that
# existed when the transaction began, so the parked peer was invisible no matter how long the arm polled. The
# rule is now structural: no executable line in any session file touches `pg_stat_activity` at all, and every
# holder helper reports `waiterpids`. Comment lines are stripped first, because the rationale for *not* using
# the view necessarily names it — and a needle that searched raw bytes would then flag the explanation of the
# repair as the defect.
stata=""
for f in $SESSIONS; do
  hits=$(sed 's/--[^"]*$//' "$f" | { grep -n 'pg_stat_activity' || true; })
  [ -n "$hits" ] && stata="$stata $f"
done
pids_calls=$(for f in $SESSIONS; do sed 's/--[^"]*$//' "$f" | { grep -q "waiterpids" && echo "$f"; }; done | wc -l | tr -d ' ')
if [ -z "$stata" ] && [ "$pids_calls" = 6 ]; then
  ok S24 "no session file reads pg_stat_activity in an executable line, and all 6 wait helpers return waiterpids"
else
  bad S24 "name-view dependence is back (files:$stata) or a wait helper stopped reporting pids (helpers with waiterpids=$pids_calls, expected 6)"
fi

# ---------------------------------------------------------------- S25 the driver binds the pid it was handed
# A holder can only say "backend N is parked on me". That is evidence about the lock table, not about which
# client N was — the arm that never interleaved would still pass on somebody else's wait. The binding lives in
# the driver: each pair's waiterpids must contain the pid that peer printed about itself, and disagreement has
# to end the run. Delete one call, and one arm is unattributed; delete the exit, and the check becomes a
# comment.
rv_calls=$(grep -cE '^  rendezvous "ARM ' "$RUN" 2>/dev/null || true)
rv_body=$(awk '/^rendezvous\(\) \{/,/^\}$/' "$RUN")
rv_exit=$(printf '%s\n' "$rv_body" | { grep -cE '^\s+exit 1' || true; })
if [ "$rv_calls" = 6 ] && [ -n "$rv_body" ] && [ "$rv_exit" -ge 2 ]; then
  ok S25 "all 6 arms bind the holder's waiterpids to the peer's own logged pid, with exit 1 on both unverifiable and mismatched"
else
  bad S25 "rendezvous calls=$rv_calls (expected 6), function present=$([ -n "$rv_body" ] && echo yes || echo no), exits=$rv_exit (expected >=2)"
fi

# ---------------------------------------------------------------- S26 every helper call has the arity its definition declares
# Tier attempt 5 died on this, and no grep in this file could have seen it coming: three RD06 call sites read
#     || quote_literal('race tier: ...'), ', '
# where `||` belonged, so the door body text closed `s11r_act(` early and the engine reported
# `function pg_temp.s11r_act(uuid, text, text) does not exist`. The mistake is one character and both spellings
# satisfy every needle above, so the rule counts arguments structurally instead of matching text:
# stage11-race-arity.pl walks each call, skips SQL literals (with their `''` escape) and `--` comments, and
# requires exactly one depth-1 comma for a two-argument helper. Requiring a non-zero number of calls examined is
# what keeps the rule from passing vacuously if the needle or the file list ever goes empty.
ARITY="$SELF_DIR/stage11-race-arity.pl"
if [ ! -f "$ARITY" ]; then
  bad S26 "stage11-race-arity.pl is missing next to this validator, so call arity is unmeasured"
else
  arity_out=$(perl "$ARITY" "$RACE"/*.sql 2>&1); arity_code=$?
  arity_n=$(printf '%s\n' "$arity_out" | { grep -oE '[0-9]+ helper calls examined' | grep -oE '^[0-9]+' || true; })
  if [ "$arity_code" = 0 ] && [ "${arity_n:-0}" -ge 40 ]; then
    ok S26 "all $arity_n pg_temp helper calls in the tier carry the arity their definitions declare"
  else
    bad_detail S26 "helper call arity is wrong or unmeasured (examined=${arity_n:-0}, exit=$arity_code)" \
      "$(printf '%s\n' "$arity_out" | head -6)"
  fi
fi

printf '\n'
if [ "$fail" = 0 ]; then
  printf 'RACE TIER STRUCTURE CHECKS PASSED (%s) — instrument shape only, at engine independence.\n' "$pass"
  printf 'NOT a race-tier pass: no database was touched, so RC00-RC16 and RD00-RD07 have not executed.\n'
  exit 0
fi
printf 'RACE TIER STRUCTURE CHECKS FAILED: %s of %s rules:%s\n' "$fail" "$((pass + fail))" "$fails"
exit 1
