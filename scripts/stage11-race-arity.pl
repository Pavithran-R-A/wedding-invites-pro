#!/usr/bin/perl
# Arity checker for the Stage 11 race tier's pg_temp helpers.
#
# Why this exists: attempt 5 reached `84_race_replay_asserts.sql` RD06 and the engine said
# `function pg_temp.s11r_act(uuid, text, text) does not exist`. Three call sites had
#     || quote_literal('race tier: ... tried'), ', '
# instead of
#     || quote_literal('race tier: ... tried') || ', '
# — the door body text closed the helper call early, so a two-argument call became a three-argument one. No
# structural rule in stage11-race-structure.sh could see it, because the mistake is one character (`)` where `||`
# belongs) and every grep the validator does is satisfied by both spellings. Only execution found it, which is
# exactly why the brief says never to mark this tier passed without running it.
#
# What it checks: for each call to a named helper, the number of commas at parenthesis depth 1 (i.e. argument
# separators of *that* call) must equal the expected arity minus one. String literals are skipped, including
# the SQL `''` escape, and `-- ...` comments are skipped only when outside a literal, so a sentence in a label
# can never be read as code. Anything whose parens never balance is reported as UNCLOSED rather than guessed at.
use strict;
use warnings;

my %expect = (
  'pg_temp.s11r_act'        => 2,
  'pg_temp.s11r_cell'       => 3,
  'pg_temp.s11r_waits'      => 1,
  'pg_temp.s11r_peer_waits' => 1,
  'pg_temp.probe_act'       => 2,
);

my $bad = 0;
my $checked = 0;

# The file list is an argument, not a default, and an empty list is refused rather than reported as a pass:
# walking @ARGV with nothing in it examines zero calls and would print "0 helper calls examined, 0 malformed"
# and exit 0 -- the shape of a green line that measured nothing. This happened when the instrument was invoked
# bare from the repository root instead of as `perl scripts/stage11-race-arity.pl supabase/tests/stage11/race/*.sql`.
if (@ARGV == 0) {
  print STDERR "usage: stage11-race-arity.pl <race-tier .sql files...>   (no default: an empty list is not a pass)\n";
  exit 2;
}
for my $file (sort @ARGV) {
  open my $fh, '<', $file or die "cannot read $file: $!";
  local $/; my $src = <$fh>; close $fh;
  $src =~ s/\r//g;

  # Line numbers are kept, so a finding names the place a reader can open.
  for my $name (sort keys %expect) {
    my $pos = 0;
    while ((my $i = index($src, "$name(", $pos)) >= 0) {
      $pos = $i + length($name) + 1;
      # Skip a definition (`CREATE FUNCTION pg_temp.s11r_act(p_uid uuid, p_stmt text)`), which is not a call.
      my $head = substr($src, 0, $i);
      next if $head =~ /CREATE\s+FUNCTION\s+$/i;
      my $line = ($head =~ tr/\n//) + 1;
      my ($depth, $commas, $j, $in_str) = (0, 0, $pos, 0);
      # $pos points just after the open paren of the call.
      $depth = 1;
      while ($j < length($src)) {
        my $c = substr($src, $j, 1);
        if ($in_str) {
          if ($c eq "'") {
            if (substr($src, $j + 1, 1) eq "'") { $j += 2; next; }
            $in_str = 0;
          }
          $j++; next;
        }
        if ($c eq "'") { $in_str = 1; $j++; next; }
        if ($c eq '-' and substr($src, $j, 2) eq '--') {
          my $nl = index($src, "\n", $j);
          last if $nl < 0;
          $j = $nl;
          next;
        }
        if ($c eq '(') { $depth++; }
        elsif ($c eq ')') { $depth--; if ($depth == 0) { last; } }
        elsif ($c eq ',' and $depth == 1) { $commas++; }
        $j++;
      }
      $checked++;
      if ($depth != 0) {
        print "BAD   $file:$line $name is never closed before end of file\n"; $bad++; next;
      }
      my $arity = $commas + 1;
      if ($arity != $expect{$name}) {
        print "BAD   $file:$line $name called with $arity arguments, expected $expect{$name}\n"; $bad++;
      }
    }
  }
}

printf "call-arity check: %d helper calls examined, %d malformed\n", $checked, $bad;
exit($bad == 0 ? 0 : 1);
