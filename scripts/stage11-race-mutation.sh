#!/usr/bin/env bash
# Mutation control for stage11-race-structure.sh.
#
# A validator that reports 30 PASS lines proves nothing until each of those 30 lines has been shown to be
# capable of saying FAIL. This script copies the tier into scratch 31 times: once unmuted, to prove the copy is
# equivalent to the tree, then 30 more times, breaking exactly one property per copy — the property a named rule
# claims to measure — and requiring that rule to fire. A rule that stays green against its own defect is
# decoration, and the honest fix is to write the rule again, not to keep the number.
#
# 30 lines come from 26 numbered rules: S02 owns two (wiring and order), and S07 owns four (one per assert
# file, plus the tier-wide arithmetic). The closing line reports the counts the run actually produced, so if a
# case is added and this paragraph is not updated, the mismatch shows up in the run rather than only here.
#
# Each case names the rule it targets and, where the defect is a cell id, was built from an id measured to
# occur exactly once across `race/*.sql` and `run.sh` — `RC01`, `RC14` — because an id that prose also cites
# takes S14 down with it. That co-firing is correct behaviour (a cell that stops existing must not stay cited)
# and is noted per case, but it blurs which property broke, so single-rule cases are the default.
#
# Nothing here touches the repository: every copy is made under a fresh mktemp directory and removed on exit,
# and the only files read from the repo are read. No copy is ever given a database: every mutation is checked
# by the structure validator alone, which opens no connection.
#
# Usage: stage11-race-mutation.sh [repo-root]
#   default: the repository that holds this scripts/ directory.
# Placement, measured rather than assumed: the 31-copy battery ran 5,113 s (85 m 13 s) end to end, so this is an
# instrument a human points at when the validator changes — not a gate. It is deliberately wired into no npm
# script and given no `*.test.mjs` wrapper, which is what keeps the battery out of `npm test` (vitest collects
# `scripts/**/*.test.mjs`) and out of the chain runner.

# `${0%/*}` is `$0` itself when `$0` carries no slash, so that form is read as the current directory — the same
# self-location stage11-race-structure.sh uses, and the reason neither file needs to name a machine.
self_dir_src="${0%/*}"; [ "$self_dir_src" = "$0" ] && self_dir_src=.
SELF_DIR="$(cd "$self_dir_src" 2>/dev/null && pwd)"
REPO="${1:-$(cd "$SELF_DIR/.." && pwd)}"
CHECK="$SELF_DIR/stage11-race-structure.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fired=0; inert=0; inert_list=""
n=0

fresh() { # fresh <name> -> prints the path of a private copy of the tier
  d="$WORK/$1/supabase/tests/stage11"
  mkdir -p "$d"
  cp "$REPO/supabase/tests/stage11/run.sh" "$d/run.sh"
  cp -r "$REPO/supabase/tests/stage11/race" "$d/race"
  printf '%s' "$WORK/$1"
}

# edit_in_place <file> <awk-program> — each mutation is one line wide: a deletion, a rewrite, or an append
# inside an existing block, so the rest of the file stays byte-identical to the tree under test and a failure
# names one property rather than a diff.
edit_in_place() { awk -f /dev/stdin "$1" > "$1.tmp" && mv "$1.tmp" "$1"; }

# need <case> <file> <post-mutation-needle> — a sed whose pattern no longer exists in the tree mutates nothing,
# and the validator then reports green for a rule that was never tested. Every rewrite case therefore proves
# the defect landed before asking a rule to catch it, and stops the run rather than padding the total.
need() {
  grep -qF "$3" "$2" && return 0
  printf 'SETUP  %-6s the mutated copy does not contain "%s" — the needle is stale against the current bytes\n' "$1" "$3"
  exit 2
}

# check <target-rule> <copy-dir> — run the validator against the mutated copy and report which rules fired.
check() {
  local target="$1" dir="$2" out code all
  out="$(bash "$CHECK" "$dir" 2>&1)"; code=$?
  all=$(printf '%s\n' "$out" | sed -n 's/^RACE TIER STRUCTURE CHECKS FAILED: [0-9]* of [0-9]* rules: *//p')
  n=$((n + 1))
  if [ "$code" = 0 ]; then
    printf 'INERT  %-6s the mutated copy still reported every rule green — this rule cannot see its own defect\n' "$target"
    inert=$((inert + 1)); inert_list="$inert_list $target"
  elif printf '%s\n' "$all" | grep -qE "(^| )$target( |/|$)"; then
    printf 'FIRED  %-6s exit=%s rules failing: %s\n' "$target" "$code" "$all"
    fired=$((fired + 1))
  else
    printf 'WRONG  %-6s the copy failed but not on the target rule (got: %s)\n' "$target" "$all"
    inert=$((inert + 1)); inert_list="$inert_list $target(wrong-rule)"
  fi
}

# ---------------------------------------------------------------- the baseline copy, unmoved
d="$(fresh baseline)"
if base_out="$(bash "$CHECK" "$d" 2>&1)"; then
  base_total=$(printf '%s\n' "$base_out" | sed -n 's/^RACE TIER STRUCTURE CHECKS PASSED (\([0-9]*\)).*/\1/p')
  printf 'BASELINE ok — an untouched copy of the tier passes all %s rules, so every FAIL below is caused by its own mutation\n' "$base_total"
else
  printf 'BASELINE FAILED — the copy is not equivalent to the tree; no mutation result below is interpretable\n'
  printf '%s\n' "$base_out" | tail -3
  exit 1
fi

# ---------------------------------------------------------------- S01 bash syntax
d="$(fresh s01)"; printf '\nif ; then\n' >> "$d/supabase/tests/stage11/run.sh"; check S01 "$d"

# ---------------------------------------------------------------- S02 the battery is no longer called
d="$(fresh s02)"; sed -i 's/^  build_chain race$/  : # build_chain race removed by mutation control/' \
  "$d/supabase/tests/stage11/run.sh"; check S02 "$d"

# ---------------------------------------------------------------- S02b the chain is dropped before the arms run
d="$(fresh s02b)"
edit_in_place "$d/supabase/tests/stage11/run.sh" <<'AWK'
{ if ($0 == "  run_race_battery") print "  admin_sql -c \"DROP DATABASE IF EXISTS st11qual_race WITH (FORCE)\" >/dev/null | mask"; print }
AWK
check S02b "$d"

# ---------------------------------------------------------------- S03 a suite stops being registered
d="$(fresh s03)"; sed -i '/82_race_arm1_asserts.sql tx lines/d' "$d/supabase/tests/stage11/run.sh"; check S03 "$d"

# ---------------------------------------------------------------- S04 an unterminated dollar-quote tag
d="$(fresh s04)"; sed -i '0,/^DO \$b\$/s/^DO \$b\$/DO \$c$/' "$d/supabase/tests/stage11/race/72_race_arm1_b.sql"; check S04 "$d"

# ---------------------------------------------------------------- S05 a session file printing a counted total
d="$(fresh s05)"; printf "\nSELECT 'STAGE11 RACE TESTS PASSED (0)' AS result;\n" \
  >> "$d/supabase/tests/stage11/race/72_race_arm1_b.sql"; check S05 "$d"

# ---------------------------------------------------------------- S06 a session file calling the counting helper
d="$(fresh s06)"; printf "\nSELECT pg_temp.s11r_cell('RC00','an arm scoring itself',true);\n" \
  >> "$d/supabase/tests/stage11/race/71_race_arm1_a.sql"; check S06 "$d"

# ---------------------------------------------------------------- S07 a declared cell id is wrong
# RD03 is cited by five prose lines elsewhere in the tier, so this copy also fails S14 — correctly: a cell that
# stops existing must not stay cited by the arms that expect it. The per-file rule is the target and is named in
# the line below.
d="$(fresh s07)"; sed -i "s/s11r_cell('RD03'/s11r_cell('RD33'/" "$d/supabase/tests/stage11/race/84_race_replay_asserts.sql"
need s07 "$d/supabase/tests/stage11/race/84_race_replay_asserts.sql" "s11r_cell('RD33'"; check "S07/84_race_replay_asserts.sql" "$d"

# ---------------------------------------------------------------- S07b an assert file loses one of its ten cells
# RC01 is measured to appear once in the whole tier (its own declaration), so nothing else in the tree cites it
# and S14 stays green: this copy fails the 82 inventory and nothing else.
d="$(fresh s07b)"; sed -i "s/s11r_cell('RC01'/s11r_cell('RC31'/" "$d/supabase/tests/stage11/race/82_race_arm1_asserts.sql"
need s07b "$d/supabase/tests/stage11/race/82_race_arm1_asserts.sql" "s11r_cell('RC31'"
check "S07/82_race_arm1_asserts.sql" "$d"

# ---------------------------------------------------------------- S07c an assert file loses one of its seven cells
# Same shape on the 83 set, from RC14 — also a single-occurrence id.
d="$(fresh s07c)"; sed -i "s/s11r_cell('RC14'/s11r_cell('RC44'/" "$d/supabase/tests/stage11/race/83_race_arm4_asserts.sql"
need s07c "$d/supabase/tests/stage11/race/83_race_arm4_asserts.sql" "s11r_cell('RC44'"
check "S07/83_race_arm4_asserts.sql" "$d"

# ---------------------------------------------------------------- S07d the same cell declared by two files
# S07d is the tier-wide arithmetic: 25 declarations, 25 distinct ids. It cannot fire alone — borrowing an id is
# only possible by removing it from its owner, so the owner's per-file inventory breaks at the same time — but
# RC01 is single-occurrence, so S14 stays green and the failing set is exactly {S07/82, S07d}. A tier where two
# assert files answer for the same numbered cell would report 34 green cells while measuring 33 properties.
d="$(fresh s07d)"; sed -i "s/s11r_cell('RC01'/s11r_cell('RC10'/" "$d/supabase/tests/stage11/race/82_race_arm1_asserts.sql"
need s07d "$d/supabase/tests/stage11/race/82_race_arm1_asserts.sql" "s11r_cell('RC10'"
check S07d "$d"

# ---------------------------------------------------------------- S08 an advisory lock replaces the witness
d="$(fresh s08)"; printf '\nSELECT pg_advisory_lock(42);\n' >> "$d/supabase/tests/stage11/race/71_race_arm1_a.sql"; check S08 "$d"

# ---------------------------------------------------------------- S09 a plant failure that prints and continues
# The mutated line is *deleted*, not replaced: the first version of this mutation wrote a comment naming
# `RAISE EXCEPTION` in its place, and the rule greps that string from the next three lines, so the copy was
# green against a defect of its own making. A mutation cannot mention the thing it removes.
d="$(fresh s09)"
edit_in_place "$d/supabase/tests/stage11/race/79_race_arm4_revoke.sql" <<'AWK'
{ L[NR] = $0 }
END {
  k = 0; del = 0
  for (i = 1; i <= NR; i++) if (L[i] ~ /RAISE NOTICE 'R4_PLANT_BROKEN=/) { k = i; break }
  for (i = k + 1; i <= NR && i <= k + 3; i++) if (L[i] ~ /RAISE EXCEPTION/) { del = i; break }
  for (i = 1; i <= NR; i++) if (i != del) print L[i]
}
AWK
check S09 "$d"

# ---------------------------------------------------------------- S10 a rendezvous token with no timeout above it
# The guard is rewritten to a test the helper can never satisfy, on one exact line, rather than deleted: the
# file's prose two lines above the gate also carries the word the rule looks for, and an anchored single-line
# rewrite is the only shape that leaves the block parseable while removing the real check.
d="$(fresh s10)"
edit_in_place "$d/supabase/tests/stage11/race/77_race_arm4_holder.sql" <<'AWK'
{
  if ($0 == "  IF v_gate LIKE 'ARM_INVALID%' THEN")
    print "  IF v_gate IS NULL THEN";
  else print
}
AWK
check S10 "$d"

# ---------------------------------------------------------------- S11 a marker the session can never print
d="$(fresh s11)"; sed -i "s/'A1_APPLIED='/'A1_APPLIED=never-emitted'/" "$d/supabase/tests/stage11/run.sh"; check S11 "$d"

# ---------------------------------------------------------------- S12 a session that raises but still exits 0
d="$(fresh s12)"; sed -i 's/^  start_session() { sql_bytes "\$1" | psql -d "\$DB" -v ON_ERROR_STOP=1/  start_session() { sql_bytes "$1" | psql -d "$DB"/' \
  "$d/supabase/tests/stage11/run.sh"; check S12 "$d"

# ---------------------------------------------------------------- S13 the driver gives up before the session does
d="$(fresh s13)"; sed -i 's/local n="${3:-900}"/local n="${3:-50}"/' "$d/supabase/tests/stage11/run.sh"; check S13 "$d"

# ---------------------------------------------------------------- S14 prose citing a cell that was never declared
d="$(fresh s14)"; printf '\n-- the same outcome is also counted as RC21, which the assert files do not declare\n' \
  >> "$d/supabase/tests/stage11/race/71_race_arm1_a.sql"; check S14 "$d"

# ---------------------------------------------------------------- S15 a session whose lines the printed log hides
# Renaming arm 4's whole `W4_` namespace was the first version of this mutation, and it is wrong twice over:
# the driver's markers name those tokens, so S11 fired instead of S15, and every renamed line stayed visible
# under a different name. The defect this rule claims is one displayed token that matches neither of the
# driver's two greps, so exactly one token is renamed — to a word no vocabulary alternative contains.
d="$(fresh s15)"; sed -i 's/B2_DETAIL=/B2_EXTRA=/' "$d/supabase/tests/stage11/race/74_race_arm2_b.sql"; check S15 "$d"

# ---------------------------------------------------------------- S16 a tx-mode file ending its own transaction
d="$(fresh s16)"; printf '\nCOMMIT;\n' >> "$d/supabase/tests/stage11/race/70_race_fixtures.sql"; check S16 "$d"

# ---------------------------------------------------------------- S17 a wait that is a sleep rather than a witness
d="$(fresh s17)"
edit_in_place "$d/supabase/tests/stage11/race/71_race_arm1_a.sql" <<'AWK'
{ if ($0 ~ /^  v_gate := pg_temp/) print "  PERFORM pg_sleep(7); -- mutated: an unbounded arbitrary wait"; print $0 }
AWK
check S17 "$d"

# ---------------------------------------------------------------- S18 one arm's idempotency key reused by another arm
d="$(fresh s18)"; sed -i 's/000000000302/000000000303/g' "$d/supabase/tests/stage11/race/72_race_arm1_b.sql"; check S18 "$d"

# ---------------------------------------------------------------- S19 a row that is not under the plant prefix
d="$(fresh s19)"; printf "\nSELECT '11111111-2222-4444-8888-555555555555'::uuid AS a_real_wedding;\n" \
  >> "$d/supabase/tests/stage11/race/71_race_arm1_a.sql"; check S19 "$d"

# ---------------------------------------------------------------- S20 a verdict written in an index name
d="$(fresh s20)"
edit_in_place "$d/supabase/tests/stage11/race/72_race_arm1_b.sql" <<'AWK'
{ print; if ($0 ~ /B1_REFUSAL=expected-no-active-publication/) print "    RAISE NOTICE 'B1_WHERE=audit_events_one_row_per_idempotency_key';" }
AWK
check S20 "$d"

# ---------------------------------------------------------------- S21 arm 4's ids no longer compared
d="$(fresh s21)"; sed -i 's/if \[ -z "\$hx" \] || \[ "\$hx" != "\$rx" \]; then/if [ -z "$hx" ]; then/' \
  "$d/supabase/tests/stage11/run.sh"; check S21 "$d"

# ---------------------------------------------------------------- S22 a hosted endpoint on an executable line
d="$(fresh s22)"; printf "\nSELECT set_config('s11r.target', 'https://project-ref.supabase.co', false);\n" \
  >> "$d/supabase/tests/stage11/race/71_race_arm1_a.sql"; check S22 "$d"

# ---------------------------------------------------------------- S23 a token printed in another arm's namespace
# `W4_DETAIL=` is deliberately a token S15 keeps green — `DETAIL=` is in the chronology vocabulary — so the
# only rule that can see an arm borrowing another arm's prefix is the one written for it. A `RC99`-style id
# would fire S14 as well and blur which property broke.
d="$(fresh s23)"
edit_in_place "$d/supabase/tests/stage11/race/71_race_arm1_a.sql" <<'AWK'
{ if ($0 == "END $a$;") print "  RAISE NOTICE 'W4_DETAIL=crossed';"; print }
AWK
check S23 "$d"

# ---------------------------------------------------------------- S24 the blind name join put back
# This is the defect that killed tier attempt 3, so the rule that forbids its return has to be shown to
# recognise it. The mutation is the original line, word for word, re-added to ARM 1's helper as an executable
# statement: if the rule cannot see the exact bytes that caused the failure, it cannot prevent a repeat.
d="$(fresh s24)"
edit_in_place "$d/supabase/tests/stage11/race/71_race_arm1_a.sql" <<'AWK'
{ if ($0 == "    PERFORM pg_sleep(0.05);" && !done) { print "    PERFORM (SELECT count(*) FROM pg_stat_activity a WHERE a.application_name = p_peer);"; done=1 } print }
AWK
check S24 "$d"

# ---------------------------------------------------------------- S25 the driver stops binding the pid
d="$(fresh s25)"; sed -i '/rendezvous "ARM 5"/d' "$d/supabase/tests/stage11/run.sh"; check S25 "$d"

# ---------------------------------------------------------------- S26 the one-character call-arity defect
# Tier attempt 5's actual failure, re-added byte for byte: RD06's door body text concatenated with `|| ', '`
# became `), ', '`, which closes `s11r_act(` early. A grep over the line reads the same either way, so the
# mutation is the shape the rule was built for — and if S26 stays green against the exact bytes that stopped
# the tier, the rule is decoration and the arity checker has to be written again.
d="$(fresh s26)"
sed -i "s/already tried') || ', '/already tried'), ', '/" "$d/supabase/tests/stage11/race/84_race_replay_asserts.sql"
grep -q "already tried'), ', '" "$d/supabase/tests/stage11/race/84_race_replay_asserts.sql" \
  || { printf 'SETUP  S26    the mutation needle did not match; re-derive it against the current bytes\n'; exit 2; }
check S26 "$d"

printf '\n'
if [ "$n" != "$base_total" ]; then
  printf 'COVERAGE the battery ran %s mutations but the validator emits %s PASS lines. A rule with no mutation case is a\n' "$n" "$base_total"
  printf 'COVERAGE rule that has never been shown it can fail, so this run is not a mutation-control pass at any count.\n'
  exit 1
fi
if [ "$inert" = 0 ]; then
  printf 'MUTATION CONTROL PASSED (%s of %s rules, each fired against its own defect; 1 unmuted copy also passed)\n' "$fired" "$n"
  exit 0
fi
printf 'MUTATION CONTROL FAILED: %s of %s rules did not fire on their own defect:%s\n' "$inert" "$((fired + inert))" "$inert_list"
exit 1
