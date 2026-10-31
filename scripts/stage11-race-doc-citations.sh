#!/usr/bin/env bash
# Engine-independent citation checker for the Stage 11 race-tier rows of
# docs/architecture/operations-admin-security.md.
#
# It answers two questions the doc cannot answer about itself:
#   1. every arm marker the threat matrix prints (NAME=...) is a string the run
#      log actually contains, and
#   2. every race cell name the doc names singly (RCnn/RDnn) is a cell the tier
#      actually declares -- and the range forms it uses (RC13-RC16) are
#      contiguous over the declarations.
#
# A "0" here is not a product pass; it is the audit text failing to outrun the
# evidence behind it.
#
# Usage: stage11-race-doc-citations.sh <run-log>
#   The log is a required argument with no default: it is an evidence capture, and this repository keeps
#   captures out of Git, so a default could only ever name a path on one machine. Point it at the capture you
#   produced by running `supabase/tests/stage11/run.sh race`.
#   The repository is the one holding this scripts/ directory.
#
# One coupling stated so a green run cannot be read as more than it is: rule 1 reads the arm markers out of one
# block of the doc -- the contiguous Markdown table that carries the race rows, found by walking the table around
# the row that opens "| Race: two operators". The block is located by content, not by line number, because this
# document is append-only and a pinned window silently shrinks on every edit above it. The block the anchor names
# is printed on every run, so a PASS always says which text it read; if the anchor finds no such table the
# checker exits 2 rather than passing over an empty window.
set -uo pipefail

self_dir_src="${0%/*}"; [ "$self_dir_src" = "$0" ] && self_dir_src=.
REPO="$(cd "$self_dir_src/.." 2>/dev/null && pwd)"
DOC="$REPO/docs/architecture/operations-admin-security.md"
TIER="$REPO/supabase/tests/stage11/race"
LOG="${1:?usage: stage11-race-doc-citations.sh <run-log>}"

fail=0
note() { printf '%-9s %s\n' "$1" "$2"; }
[ -f "$DOC" ] || { echo "SETUP: no doc at $DOC"; exit 2; }
[ -f "$LOG" ] || { echo "SETUP: no run log at $LOG"; exit 2; }
[ -d "$TIER" ] || { echo "SETUP: no tier dir at $TIER"; exit 2; }

# --- 1. markers printed by the race rows -------------------------------------
# The block is the contiguous Markdown table carrying the race rows, located by content so a doc edit above it
# cannot silently shrink what this rule reads.
race_anchor='| Race: two operators'
range=$(awk -v pat="$race_anchor" '
  /^\|/ { if (!inb) { inb=1; s=NR; hit=0 } e=NR; if (!hit && index($0,pat)) hit=1; next }
        { if (inb && hit) { print s, e; found=1; exit } inb=0; hit=0 }
  END   { if (!found && inb && hit) print s, e }
' "$DOC")
[ -n "$range" ] || { echo "SETUP: no table block naming \"$race_anchor\" in $DOC -- rule 1 has nothing to read"; exit 2; }
blk_lo=${range% *}; blk_hi=${range#* }
note BLOCK "rule 1 reads doc lines $blk_lo..$blk_hi ($(awk -v a="$blk_lo" -v b="$blk_hi" 'NR>=a && NR<=b' "$DOC" | grep -c '^|') table rows)"
markers=$(awk -v a="$blk_lo" -v b="$blk_hi" 'NR>=a && NR<=b' "$DOC" | grep -o -E '`[A-Z][A-Z0-9_]{2,}=' | tr -d '`=' | sort -u)
nm=$(printf '%s\n' "$markers" | grep -c .)
bad=0
while IFS= read -r m; do
  [ -n "$m" ] || continue
  grep -q -- "$m=" "$LOG" || { note ABSENT "$m (printed by the doc, absent from the run log)"; bad=$((bad + 1)); }
done <<< "$markers"
[ "$bad" -eq 0 ] && note PASS "all $nm arm markers appear verbatim in $(basename "$LOG")" || fail=1

# --- 2. cell names the doc names singly --------------------------------------
declared=$(grep -ho -E "s11r_cell\('(RC|RD)[0-9]{2}'" "$TIER"/*.sql | sed -E "s/.*'([A-Z0-9]+)'.*/\1/" | sort -u)
nd=$(printf '%s\n' "$declared" | grep -c .)
cited=$(grep -o -E '(RC|RD)[0-9]{2}' "$DOC" | sort -u)
nc=$(printf '%s\n' "$cited" | grep -c .)
bad=0
while IFS= read -r c; do
  [ -n "$c" ] || continue
  printf '%s\n' "$declared" | grep -qx -- "$c" \
    || { note PHANTOM "$c (named by the doc, declared by no tier file)"; bad=$((bad + 1)); }
done <<< "$cited"
[ "$bad" -eq 0 ] && note PASS "all $nc doc-named cells exist among the $nd declarations" || fail=1

# --- 3. the counts the doc prints, re-derived --------------------------------
# counted cells = the fixture plant's own s11f_ok cells + the numbered RC/RD cells
plant=$(grep -c "PERFORM pg_temp.s11f_ok(" "$TIER/70_race_fixtures.sql")
numbered=$nd
want=$((plant + numbered))
totals=$(grep -o -E 'STAGE11 RACE TESTS PASSED \([0-9]+\)' "$LOG" \
  | sed -E 's/.*\(([0-9]+)\)/\1/' | awk '{s+=$1} END {print s+0}')
note INFO "plant cells=$plant numbered=$numbered counted=$want; the log's suite totals add to ${totals:-0}"
if [ "${totals:-0}" -eq "$want" ]; then
  note PASS "the log's suite totals ($totals) equal the counted cells the tier declares ($want)"
else
  note MISMATCH "the log's suite totals ($totals) do not equal the tier's counted cells ($want)"; fail=1
fi

# --- 4. the blocks the doc writes as ranges (RC13-RC16) are hole-free ---------
for pre in RC RD; do
  n=$(printf '%s\n' "$declared" | grep -cE "^$pre")
  last=$(printf '%s\n' "$declared" | grep -E "^$pre" | sort | tail -1)
  expected=$(( 10#$(printf '%s' "${last#"$pre"}") + 1 ))
  if [ "$n" -eq "$expected" ]; then
    note PASS "$pre block is contiguous: $n cells, ${pre}00..$last"
  else
    note GAP "$pre block has $n cells but runs to $last -- a hole inside a range the doc writes"; fail=1
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "STAGE11 DOC CITATION CHECK PASSED (markers=$nm cells=$nc numbered=$numbered log=$(basename "$LOG"))"
  exit 0
fi
echo "STAGE11 DOC CITATION CHECK FAILED"
exit 1
