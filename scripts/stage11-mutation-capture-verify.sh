#!/usr/bin/env bash
# Verifier for a stage11-race-mutation.sh capture.
#
# "MUTATION CONTROL PASSED (30 of 30)" is a sentence the battery writes about itself. This script re-reads the
# capture and re-derives that sentence from the per-case lines, so a run cannot report a pass it did not
# assemble: every case must name a rule that actually appears in its own "rules failing:" set, no case may be
# INERT/WRONG/SETUP/COVERAGE, and the closing verdict and exit marker must both be present and agree.
#
# What the capture must carry, because this script reads it and the battery alone does not write all of it:
# `mutation_control_exit=<code>` and `tree_head=<sha>` come from whoever runs the battery and stamps its output
# (`stage11-race-mutation.sh ... >capture.txt 2>&1; echo "mutation_control_exit=$?" >>capture.txt`), and they are
# the two lines that tie a verdict to the bytes and exit code it was produced with. A capture without them is
# refused here rather than trusted.
#
# Usage: stage11-mutation-capture-verify.sh <capture>
set -uo pipefail
LOG="${1:?usage: stage11-mutation-capture-verify.sh <capture>}"
[ -f "$LOG" ] || { echo "SETUP: no capture at $LOG"; exit 2; }

fail=0
note() { printf '%-9s %s\n' "$1" "$2"; }

grep -q '^BASELINE ok' "$LOG" \
  && note PASS "the unmuted copy passed all rules, so every FAIL below is its own mutation" \
  || { note ABSENT "no BASELINE ok line -- the copy's equivalence to the tree was never proven"; fail=1; }

# every non-target rule that co-fires is listed, so the report can say which cases blurred
inert=$(grep -c -E '^(INERT|WRONG|SETUP|COVERAGE)' "$LOG")
[ "$inert" -eq 0 ] && note PASS "no INERT/WRONG/SETUP/COVERAGE line in the capture" \
  || { note DEFECT "$inert case(s) did not land as intended"; sed -n -E 's/^(INERT|WRONG|SETUP|COVERAGE).*//p' "$LOG" | head -20; fail=1; }

fired=$(grep -c '^FIRED' "$LOG")
nofire=0
cofire=""
while IFS= read -r line; do
  target=$(printf '%s\n' "$line" | awk '{print $2}')
  rules=$(printf '%s\n' "$line" | sed -E 's/.*rules failing: *//')
  if printf '%s\n' "$rules" | grep -qw -- "$target"; then
    others=$(printf '%s\n' "$rules" | tr ' ' '\n' | grep -v -x -- "$target" | tr '\n' ' ')
    [ -n "${others// /}" ] && cofire="$cofire
  $target also fired: $others"
  else
    note NOFIRE "$target did not fire on its own defect (failing: $rules)"; nofire=$((nofire + 1))
  fi
  case "$line" in *"exit=0"*) note NOEXIT "$target was reported FIRED with exit=0"; fail=1 ;; esac
done < <(grep '^FIRED' "$LOG")
[ "$nofire" -eq 0 ] && note PASS "all $fired cases name a rule that appears in their own failing set"

verdict=$(grep -o -E 'MUTATION CONTROL PASSED \(([0-9]+) of ([0-9]+) rules[^)]*\)' "$LOG" | tail -1)
if [ -n "$verdict" ]; then
  claimed=$(printf '%s\n' "$verdict" | sed -E 's/.*PASSED \(([0-9]+) of ([0-9]+).*/\1/')
  total=$(printf '%s\n' "$verdict" | sed -E 's/.*PASSED \([0-9]+ of ([0-9]+).*/\1/')
  [ "$claimed" -eq "$fired" ] && [ "$total" -eq "$fired" ] \
    && note PASS "the closing verdict's $claimed/$total equals the $fired FIRED lines" \
    || { note MISMATCH "verdict says $claimed of $total but the capture carries $fired FIRED lines"; fail=1; }
else
  note ABSENT "no PASSED verdict line"; fail=1
fi

code=$(grep -o -E 'mutation_control_exit=[0-9]+' "$LOG" | tail -1 | cut -d= -f2)
[ "${code:-}" = "0" ] && note PASS "mutation_control_exit=0 recorded in the capture" \
  || { note BADCODE "mutation_control_exit=${code:-missing}"; fail=1; }

head_sha=$(grep -o -E 'tree_head=[0-9a-f]+' "$LOG" | tail -1 | cut -d= -f2)
[ -n "$head_sha" ] && note INFO "capture's tree_head=$head_sha"
[ -n "$cofire" ] && note INFO "co-firing cases (correct behaviour, recorded so a reader knows which property broke):$cofire"

echo
[ "$fail" -eq 0 ] && { echo "MUTATION CAPTURE VERIFIED ($fired cases, baseline green, exit 0)"; exit 0; }
echo "MUTATION CAPTURE VERIFIER REFUSES THIS RUN"; exit 1
