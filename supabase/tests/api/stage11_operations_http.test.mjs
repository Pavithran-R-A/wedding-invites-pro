// Stage 11 §3/§5/§6/§7/§8/§9 at the HTTP layer: what the deployed stack answers when a real session, a
// real grant, a real published artefact and a real object in a bucket are involved — the four things no
// SQL battery can supply.
//
// What the SQL tier already covers, and what this file therefore refuses to repeat.
// `supabase/tests/stage11/80_operator_authority.sql` … `95_operations_health.sql` walk the whole machinery
// on a throwaway Postgres: the four scopes, the lifecycle edges, every vocabulary refusal, both idempotency
// levels, the audit guards' `pg_trigger_depth()` branch, the referential nulling, the 626-cell health
// battery, and the eight refusals of the purge body. That tier has no PostgREST, no GoTrue, no Kong and no
// JWT, so `auth.uid()` — the only thing every operational door authorises against — does not exist there,
// and a door that is *not exposed* is invisible rather than refused. This file asks only what needs the
// stack:
//
//   A  the authority matrix over the wire: all nineteen Stage 11 doors, each met by anon, by a signed-in
//      account with no grant, by an operator holding a *different* scope, and by the operator whose scope
//      it is — and for the seventeen walled doors the middle two of those answers are the byte-identical
//      42501 sentence, while the two host list doors have no wall at all and answer an empty 200 to all
//      three; plus the three bodies that were deliberately given no door, in the three spellings a client
//      can try; plus the five stores unreachable in every credential shape; plus the shipped console
//      instrument actually run against this stack on both of its channels.
//   C  a support ticket as two parties read it: opened by its host, queued, claimed, noted on both arms,
//      transitioned, released — and the internal arm never visible to the person the ticket is about.
//   T  a takedown with bytes behind it: a real PNG at a real key, a real signed URL, and the *same* URL
//      read on both sides of every half of the chain, because §6's sentence about file links outliving a
//      revocation is only evidence if somebody fetched one.
//   R  refund oversight that cannot move money: the queue and the note, with the ledger read before and
//      after each act.
//   V  privacy intake as a host files it and a desk works it: the duplicate anchor is the caller's own
//      (account, wedding, kind) rather than a key, the host and the desk are served two different
//      projections of one row, and a spent advance key answers from the trail instead of from the row.
//   H  the health summary's own claims: which blocks answer, which admit they cannot, that no
//      identifier rides in the payload, and that reading it wrote nothing.
//   AI the trail from the outside: the relation has no route through the API in any verb or credential, no
//      credential this run holds reaches any row this run wrote, and every Stage 11 row this run wrote
//      falls inside the (action, subject_type) pairs `run.sh`'s own census counts.
//
// WHERE THE BOUNDARY OF THESE NUMBERS IS. Group A's console arm and group T's purge plan reach
// `internal_api` through `psql` as the stack's own `postgres` role — inside its container by default, or
// over the loopback port it publishes — because that is the only channel those three bodies answer to, and
// `before()` proves the channel and the REST layer are one database rather than assuming it. Nothing here
// is evidence about hosted infrastructure: every account is synthetic, every object is one 70-byte PNG
// generated for this run, and every credential this file mints is revoked or deleted by `after()`.
//
// Teardown is child-before-parent in FK order, and the audit trail goes *before* the weddings it names:
// `private.audit_events.wedding_id` is `ON DELETE SET NULL`, so deleting a wedding first would leave every
// row this run recorded standing with a null subject and no way back to this run — the schema's right
// answer for a real family's erasure and the wrong answer for a run that promised to leave nothing.
//
// `run.sh` runs this file serially with the others and fails the whole gate if any census count moves, and
// its census now carries `operator_grants`, `support_cases`, `support_case_events`, `privacy_requests`,
// `commerce_review_notes` and a `stage11_audit_rows` read that filters on the nine (action, subject_type)
// pairs Stage 11 writes. The five store names below are copied from that census rather than derived from
// this suite's own reach, and copied *whole* including the stores this suite never touches: a suite that
// measures a shorter list than the gate cannot catch its own leak in the place it promised to catch it. The
// nine pairs are not copied — AI-03 reads them out of `run.sh`'s own text and asserts there are nine, so a
// tenth pair added to the gate cannot leave a stale list in this file passing over it.
//
// WHAT HAS ACTUALLY RUN. On 2026-10-25 groups A and C executed against the `localvivaahvarnam` stack with
// all six Stage 11 migrations applied. A went green on its fifth attempt — A-01 to A-07, 7 tests, 7 pass, 0
// fail (`q11-logs/s11-http-stage11-a5.txt`, a capture that records no exit code) — after attempts that failed
// 1 case with 7 cancelled, then cancelled all 7, then failed 4, then failed 2. The 8 `a1` reports over the 7
// `a5` reports is node's accounting of the suite's own failing `before()` hook (its capture opens with a SQL
// syntax error over an empty IN-list, above the case banner), not a case this file dropped: A-01 to A-07 are
// named in both. C went
// green on its third — C-01 to C-09, 9, 9, 0, with `node_test_exit=0` in the same capture
// (`q11-logs/s11-http-c3.txt`) — after runs failing 7 of 10 and 1 of 9. T, R, V, AI and H have never
// executed: they are written, they pass `node --check`, and they are waiting on the stack. Neither capture
// prints the git head. Both ran after `0a035fbe3224cab70a3d420fdd5f827ebd6afd8b` was committed (its own
// commit date is 2026-10-25T14:49:16+05:30; the two captures are stamped 16:15:39 and 18:26:01 the same
// afternoon), and that was the repository's head at the time — but neither this file nor `run.sh`'s census
// extension was in its tree yet, so what those two greens tested was that head *plus a working tree*, and a
// run whose head matters has to print it rather than leave a reader to infer it from a file's mtime. This
// file's own first commit, findable as the oldest entry in `git log -- supabase/tests/api/stage11_operations_http.test.mjs`,
// is the head from which the census extension and this suite exist together in one tree; every capture made
// from that head onward carries the head and this file's own sha256, printed from the `before()` hook below
// ahead of the first assertion, and the two 2026-10-25 captures predate that line and are quoted here as the
// incomplete records they are.
//
// WHERE THE SENTENCES COME FROM. Every string in SAY is transcribed from the migration at the line given, not
// from a probe log, and the citations are mechanical rather than remembered: a sweep of all 112 entries
// against the six files' current bytes on 2026-10-26 put every needle on a line it cites
// (`q11-logs/s11-say-citation-check.cjs`, capture `s11-say-citation-2.txt`; the capture before the two
// citations it corrected, `s11-say-citation-1.txt`, is the evidence that the sweep can miss). One needle
// lands only once Postgres' doubled `''` is read back as the single apostrophe it sends, and the sweep names
// that one rather than counting it silently. Where the stack answered something the migration does not say,
// this file records what it answered instead of what was expected; the two places are the `%`-split
// idempotency sentences (the note above SAY) and the profile-header asymmetry (A-05), each named in the case
// that measured it. The key lists in EXPECT_KEYS are swept the same way, against the migrations rather than
// against a probe log, and on 2026-10-26 all nineteen were found inside the door's own body
// (`q11-logs/s11-projection-derivation-sweep.cjs`, capture `s11-projection-derivation-7.txt`). The captures
// before that one are kept because they are the proof the sweep can fail rather than confirm:
// `s11-projection-derivation-3.txt` scores 0 of 19, because its parser read whole migration files instead of
// one definition's slice and so attributed every file's first `RETURN` to every door in it, and
// `s11-projection-derivation-2.txt` scores 17, because it looked for one build_object where two doors join a
// variable to one.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const OUTPUT_BUCKET = 'invitation-outputs';

const env = (() => {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
})();
const url = env.SUPABASE_LOCAL_URL;
const anonKey = env.SUPABASE_LOCAL_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
if (!url) throw new Error('SUPABASE_LOCAL_URL is missing from .env.local');
if (!LOOPBACK.has(new URL(url).hostname)) {
  throw new Error(`refusing to run: ${url} is not a loopback Supabase target`);
}
if (!anonKey || !serviceKey) throw new Error('local keys are missing from .env.local');

const PROJECT_ID = (() => {
  const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
  const m = /^project_id\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(toml);
  if (!m) throw new Error('no project_id in supabase/config.toml');
  return m[1].trim();
})();
if (PROJECT_ID !== 'localvivaahvarnam') {
  throw new Error(`refusing to run: project_id is ${PROJECT_ID}, and this suite only writes to localvivaahvarnam`);
}

/** The same two channels Stage 10's suite offers, for the same reason: the daemon can be wedged while the
 *  database it published is still answering, and a battery that can only speak through `docker exec` would
 *  report that as a product failure. Chosen once, never fallen back to, and the port must be the one this
 *  repository's own `[db]` section publishes, so a stale URL cannot aim the authority fixtures at the
 *  DueWeave stack. `before()` proves channel and REST agree. */
const DB_URL = process.env.STAGE11_DB_URL ?? '';
const PSQL_BIN = process.env.STAGE11_PSQL ?? 'psql';
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}
const CONFIG_DB_PORT = (() => {
  const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
  const m = /^\[db\][\s\S]*?^port\s*=\s*(\d+)/m.exec(toml);
  if (!m) throw new Error('no [db] port in supabase/config.toml');
  return m[1];
})();
let TARGET;
if (DB_URL) {
  let parsed;
  try {
    parsed = new URL(DB_URL);
  } catch {
    throw new Error('refusing to run: STAGE11_DB_URL is not a postgres URL');
  }
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error(`refusing to run: STAGE11_DB_URL resolves to ${parsed.hostname}, not a loopback host`);
  }
  if ((parsed.port || '5432') !== CONFIG_DB_PORT) {
    throw new Error(`refusing to run: STAGE11_DB_URL uses port ${parsed.port || '5432'} but this `
      + `repository's [db] port is ${CONFIG_DB_PORT}`);
  }
  if (!parsed.username) throw new Error('refusing to run: STAGE11_DB_URL names no database role');
  TARGET = { mode: 'url', url: DB_URL };
} else {
  TARGET = { mode: 'docker', container: DB_CONTAINER };
}

const RUN_TAG = process.env.STAGE11_HTTP_RUN_TAG
  ?? `s11http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
if (!/^[a-z0-9_-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE11_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
}
/** The one string this run plants into a host's own summary, so that "the health payload carries no
 *  identifiers" is measured rather than believed: the same scan that must miss it there must hit it on the
 *  surface that is allowed to carry it, or the scan proves nothing about either. */
const SENTINEL = `sentinel-${RUN_TAG}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CASE_REF = /^SV-[A-Z2-7]{8}$/;
const REQUEST_REF = /^PR-[A-Z2-7]{8}$/;
/** Well-formed and belonging to nothing, in each of the three shapes a caller could name. */
const NOT_A_WEDDING = '00000000-0000-4000-8000-000000000000';
const NOT_A_REFUND = '11111111-1111-4111-8111-111111111111';
const NOT_A_CASE_REF = 'SV-AAAAAAAA';
const NOT_A_REQUEST_REF = 'PR-AAAAAAAA';

const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;

/** A JWT is 43 characters of that alphabet and an object digest is 64 hex, so neither belongs in a log that
 *  outlives the repository. Every string this file prints or puts into an assertion message passes through
 *  here; the checks themselves are never relaxed by it. */
const shown = (value) => String(value)
  .replace(/[A-Za-z0-9_-]{43}/g, '[REDACTED-43]')
  .replace(/[0-9a-f]{64}/g, '[REDACTED-64]');
const json = (value) => shown(JSON.stringify(value));

// ---------------------------------------------------------------------------
// The sentences, each transcribed from the migration at the line given.
// ---------------------------------------------------------------------------
const MIG = {
  authority: '20261020190000_stage11_operator_authority.sql',
  cases: '20261020190100_stage11_support_cases.sql',
  terminal: '20261020190200_stage11_closed_is_terminal.sql',
  privacy: '20261020190300_stage11_privacy_intake.sql',
  takedown: '20261020190400_stage11_takedown_and_oversight.sql',
  health: '20261020190500_stage11_operations_health.sql',
};
const SAY = {
  // the predicate's own sentence, which is what every one of the thirteen operator doors answers. Every line
  // number below came out of a single `grep -nF -i` sweep over the six migration files on 2026-10-25, not out
  // of manual reading: the sweep lists every place the byte-string occurs, including the second arm of a
  // two-arm check and the re-statement a later migration makes of an earlier rule.
  queueNo: 'the caller may not read the case queue',                    // cases:896
  caseNo: 'the caller may not read this support case',                   // cases:717, 969, 980
  caseOpenNo: 'the caller may not open a case about this wedding',       // cases:556
  replyNo: 'the caller may not reply on this support case',              // cases:807
  noteNo: 'the caller may not add a note to this support case',          // cases:1043, 1065
  claimNo: 'the caller may not claim this support case',                 // cases:1140, 1150
  releaseNo: 'the caller may not release this support case',             // cases:1260, 1270, terminal:229, 239
  transitionNo: 'the caller may not change this support case',           // cases:1371, 1408
  privacyOpenNo: 'the caller may not open a privacy request about this wedding', // privacy:272
  privacyQueueNo: 'the caller may not read the privacy queue',           // privacy:395
  privacyChangeNo: 'the caller may not change this privacy request',     // privacy:466, 490
  commerceQueueNo: 'the caller may not read the commerce review queue',  // takedown:668
  refundNo: 'the caller may not annotate this refund',                   // takedown:776, 798, 804
  planNo: 'the caller may not plan a takedown for this wedding',         // takedown:268
  takedownNo: 'the caller may not take this publication down',           // takedown:347, 365
  healthNo: 'the caller may not read the operations summary',            // health:105
  purgePlanNo: 'the caller may not plan this purge',                     // takedown:540
  needsSession: 'this door needs a signed-in account',                   // cases:522, 642, 708, 787, privacy:258, 342
  // the input rules every door states before it reads or writes anything
  openKey: 'opening a support case requires an idempotency key',          // cases:527
  summaryNeeded: 'a support case must say what is wrong',                 // cases:543
  summaryBound: 'the summary of a support case must fit in 2000 characters', // cases:547
  replyKey: 'a reply requires an idempotency key',                        // cases:790
  replyBody: 'a reply must say something',                                // cases:794
  replyBound: 'a reply must fit in 4000 characters',                      // cases:797
  noteKey: 'a note requires an idempotency key',                          // cases:1052
  noteBody: 'a note must say something',                                  // cases:1055
  noteBound: 'a note must fit in 4000 characters',                        // cases:1058
  transitionBody: 'a transition message is either real text or absent',   // cases:1401
  takedownKey: 'a takedown requires an idempotency key',                  // takedown:357
  planNeedsWedding: 'a takedown plan names a wedding',                    // takedown:272
  alreadyStatus: 'this case is already',                                  // cases:1440 — `%` after the word
  keyOtherAct: 'this idempotency key already belongs to a different act',  // privacy:503, takedown:378, 591, 812
  privacyKey: 'advancing a privacy request requires an idempotency key',    // privacy:478
  privacyNoteBound: 'a privacy request note is either real text or absent', // privacy:266
  privacyAdvNoteBound: 'an operator note is either real text or absent',    // privacy:482
  // the keys and ref each door demands before it reads anything, in the door's own words — three doors
  // state the same rule with three different nouns, so the battery asserts each one rather than one
  // generic sentence a reader would have to translate back.
  caseRefNeeded: 'a case ref must be supplied to read one case',            // cases:711, 972
  claimKey: 'a claim requires an idempotency key',                           // cases:1143
  releaseKey: 'a release requires an idempotency key',                       // cases:1263, terminal:232
  transitionKey: 'a status change requires an idempotency key',              // cases:1379
  // key reuse *within* one case, which the bodies catch themselves, as opposed to reuse across cases,
  // which they do not see and the trail's unique index does — the difference is C-09's whole subject.
  // Both sentences carry a `%` where Postgres substitutes the row's kind or the trail's action, so each is
  // kept as the two literal halves around that hole: one spanned fragment scored a real refusal as a
  // failure, which is what the first executed run of C-03 and C-05 measured on the wire.
  keyCaseRow: 'this idempotency key already carries a ',                 // cases:815, 1073, 1157, 1277, 1424, terminal:246
  keyCaseRowTail: ' row on this case',                                   // the same six sites, after the `%`
  keyTrailAct: 'this idempotency key already carries the ',              // cases:1167, 1283, terminal:252
  keyTrailActTail: ' act on the trail',                                  // the same three sites, after the `%`
  // the vocabularies and the lifecycle, each in the file that answers a client
  category: 'unknown support category',                                  // cases:533, 905 (the queue filter)
  severity: 'unknown support severity',                                  // cases:538
  caseStatus: 'unknown support status',                                  // cases:646, 900, 1375
  limit100: 'the number of cases to read must be between 1 and 100',     // cases:652, 910
  noteKind: 'a case note is either message_host, which the requester can read', // cases:1047
  resolution: 'requires a resolution code from the six',                 // cases:1386
  resolutionUnknown: 'unknown resolution code',                          // cases:1393
  resolutionMisplaced: 'a resolution code belongs to resolved or closed', // cases:1397
  noEdge: 'no edge',                                                     // cases:278, 1436, terminal:163
  closedTerminal: 'a closed support case is terminal',                   // cases:264, terminal:9, 134
  closedReply: 'a closed support case takes no further messages',        // cases:824, terminal:6
  closedNote: 'a closed support case takes no further rows',             // cases:1081, terminal:7
  closedClaim: 'a closed support case is not rewritten, and claiming it is a rewrite', // cases:1176 — terminal.sql quotes this sentence in prose at :8 but installs no second arm
  closedRelease: 'a closed support case is not rewritten, and releasing it is a rewrite', // terminal:262
  backToOpen: 'a case may not be moved back to open',                    // cases:1415
  heldByOtherClaim: 'another operator holds this case',                   // cases:1186
  alreadyClaimed: 'this case is already claimed by the caller',           // cases:1180
  nobodyHolds: 'nobody holds this case, so there is nothing to release',  // cases:1292, terminal:267
  releaseOtherHolder: 'this case is held by another operator, and one release may not clear their claim', // cases:1298, terminal:273
  oneKeyOneAction: 'one key is one action',                               // cases:815, 1073, 1157, 1167, 1277, 1283, 1424, terminal:246, 252
  takedownReason: 'unknown takedown reason',                              // takedown:353
  noPublication: 'this wedding has no active publication to take down',   // takedown:391
  planNoPublication: 'this wedding has no publication to plan against',   // takedown:283
  window: 'an operations window is between 1 and 720 hours',              // health:111
  refundStatus: 'unknown refund status',                                  // takedown:673
  reviewLimit: 'a review queue reads between 1 and 200 rows',             // takedown:681
  reviewKind: 'unknown review note kind',                                 // takedown:780
  reviewNoteText: 'a review note is real text of at most 4000 characters', // takedown:785
  reviewNoteKey: 'a review note requires an idempotency key',              // takedown:789
  privacyKind: 'unknown privacy request kind',                            // privacy:262
  privacyStatus: 'unknown privacy status',                                // privacy:400, 473
  privacyBack: 'a privacy request may not be moved back to received',     // privacy:514
  privacyAlready: 'this privacy request is already',                      // privacy:518 — `%` after the word
  privacySatisfied: 'requires an operator note saying where the',         // privacy:205, 529
  privacyTerminal: 'privacy request is terminal',                         // privacy:184
  privacyNoEdge: 'no edge',                                               // privacy:196
  // the three bodies with no door, and the purge's own refusals
  purgeActorNull: 'a purge names the account that decided it',            // takedown:512
  purgeActorUnknown: 'the account named as the actor does not exist',     // takedown:520
  purgeActorNoGrant: 'the account named as the actor holds no live operations grant', // takedown:527
  purgeKeyNull: 'a purge requires its own idempotency key',               // takedown:531
  purgeNoRevoked: 'this wedding has no revoked publication whose objects could be purged', // takedown:552
  purgeNoTakedown: 'this publication has no recorded takedown to purge against', // takedown:563
  purgeSameKey: 'the purge requires an idempotency key distinct from the takedown', // takedown:569
  // the trail
  appendOnly: 'rows are append-only: a correction is a new row and an audit event, never a rewrite', // authority:294
  humanNamesHuman: 'an audit event whose actor_kind is',                  // authority:326
  grantUnknownScope: 'unknown operator scope',                            // authority:429, 535
  grantNoAccount: 'uuid invented at the console',                          // authority:450 — the split literal opens at 449
  // the guards on the five stores, which is what an operator with a `psql` session meets rather than what a
  // door says. Each is the first word of the guard's own sentence, in the file that installs it.
  guardCaseRefMinted: 'support_cases.case_ref is minted once and quoted forever', // cases:210, terminal:78
  guardCaseReparent: 'a support case cannot be re-parented onto another wedding', // cases:213, terminal:81
  guardCaseHands: 'a support case cannot change hands',                   // cases:232, terminal:86
  guardCaseOrigin: 'who opened this case and when are the first two facts in its history', // cases:237, 242, terminal:94, 99
  guardCaseKind: 'category and severity are the host',                    // cases:246, terminal:103
  guardCaseResolution: 'a status that did not change may not gain or lose its resolution', // cases:257, terminal:146
  guardEventSeq: 'a support case event',                                  // cases:396
  guardPrivacyRefMinted: 'privacy_requests.request_ref is minted once and quoted forever', // privacy:151
  guardPrivacyUnsupplied: 'a privacy request ref is minted by the database, never supplied', // privacy:99
  guardPrivacyActor: 'a privacy request must name the account that filed it', // privacy:130
  guardPrivacyReparent: 'a privacy request cannot be re-parented onto another wedding', // privacy:155
  guardPrivacyHands: 'a privacy request cannot change hands',             // privacy:163
  guardPrivacyKind: 'export or erasure is the request',                   // privacy:167
  guardPrivacyOrigin: 'what the host asked and when are the first two facts', // privacy:173
  guardNoteRefund: 'a commerce review note must name a refund that exists', // takedown:119
  guardNoteOrder: 'a review note',                                            // takedown:123
  guardNoteOrderTail: "'s order is its refund's order",                       // takedown:123 — the SQL bytes double both apostrophes
  guardNoteActor: 'a commerce review note must name the account that wrote it', // takedown:152
  noteAppendOnly: 'rows are append-only: a correction is a new note, never an edit', // takedown:176, 181
  guardGrantReason: 'an operator grant must say why',                     // authority:435
  guardRevokeReason: 'a revocation must say why',                         // authority:540
  guardRevokeNone: 'no active % grant for account % to revoke',            // authority:564
};

// --------------------------------------------------------------------------- SQL
/** `-q` is load-bearing, not cosmetic: measured on this stack, `psql -tA` prints a command tag line for
 *  every statement that writes or defines, and a one-row read that also got a tag would look exactly like
 *  a stray row. Both channels are asked the same question with the same flags; only the transport differs,
 *  and the URL channel carries its password in the child's environment rather than in argv. */
function sqlRows(query) {
  const flags = ['-v', 'ON_ERROR_STOP=1', '-tAq', '-F', '|', '-c', query];
  let out;
  if (TARGET.mode === 'url') {
    const u = new URL(TARGET.url);
    out = execFileSync(PSQL_BIN, [
      '-h', u.hostname, '-p', u.port || '5432', '-U', u.username, '-d', u.pathname.slice(1) || 'postgres',
      ...flags,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password), PGCLIENTENCODING: 'UTF8' },
    });
  } else {
    out = execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', ...flags],
      { encoding: 'utf8' });
  }
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

function sqlCell(query, what) {
  const rows = sqlRows(query);
  assert.equal(rows.length, 1, `${what} did not read exactly one row: ${json(rows)}`);
  return rows[0];
}
const cell = (query, what) => sqlCell(query, what);
const count = (fromWhere, what = fromWhere) => cell(`select count(*)::text ${fromWhere}`, what);

/** Why a `psql` child said no. `execFileSync` puts the server's refusal on stderr and leaves stdout at the
 *  empty string, so a bare `error.stdout` keeps the empty string and the battery reports `failed:` with
 *  nothing after it — measured in Stage 10's run r6, where the first fixture failure of a run hid its own
 *  SQLSTATE and forty downstream assertions read as one undiagnosable cascade. */
const psqlFailure = (error) => [error?.stderr, error?.stdout, error?.message]
  .map((part) => (typeof part === 'string' ? part.trim() : ''))
  .find((part) => part.length > 0) ?? String(error);

const exec = (statement, what) => {
  try {
    return sqlRows(statement);
  } catch (error) {
    throw new Error(`${what} failed: ${shown(psqlFailure(error)).slice(0, 400)}`);
  }
};

/** A jsonb answer out of the trusted channel, base64 so that a quote, a backslash or a newline in the
 *  database's own sentence cannot reach this process as structure. The `replace(..., chr(10), '')` is not
 *  decoration: measured on this stack, Postgres 17.11 writes `encode(..., 'base64')` as RFC 2045 MIME — a
 *  908-byte answer came back as 1,227 characters broken across fifteen newlines at column 76 — so a
 *  reader that wants one line has to ask Postgres for one line. `scripts/stage11-operations-cli.mjs` does
 *  the same for the same measured reason, and this suite's own A-06 runs that tool, which is what makes the
 *  two agree rather than merely look alike. */
const b64 = (expr) => `replace(encode(convert_to((${expr})::text, 'utf8'), 'base64'), chr(10), '')`;
const trusted = (functionCall, what) => {
  let answer;
  try {
    answer = Buffer.from(cell(`select ${b64(functionCall)}`, what), 'base64').toString('utf8');
  } catch (error) {
    throw new Error(`${what} could not be read: ${shown(psqlFailure(error)).slice(0, 300)}`);
  }
  try {
    return JSON.parse(answer);
  } catch {
    throw new Error(`${what} answered with something that is not the JSON it was asked to build`);
  }
};

/** A statement that must be refused, in the form the SQL battery scores it: `SQLSTATE || ' ' || SQLERRM`.
 *  The channel above cannot carry this — it re-throws `psql`'s last line, which on a plpgsql refusal is the
 *  CONTEXT line rather than the sentence — so the capture runs in a `DO` block and reads the pair itself. A
 *  statement that is accepted reports `ACCEPTED`, so every negative case also fails if the database said
 *  yes. Statements go in as plpgsql bodies (`PERFORM …`), which is what `refused()` callers pass. */
function refusalOf(statement, what) {
  return cell(`
    set client_min_messages = warning;
    drop table if exists pg_temp.s11_http_refusal;
    create temp table pg_temp.s11_http_refusal(t text);
    do $body$ begin
      ${statement};
      insert into pg_temp.s11_http_refusal values ('ACCEPTED');
    exception when others then
      insert into pg_temp.s11_http_refusal values (sqlstate || ' ' || sqlerrm);
    end $body$;
    select coalesce(max(t), 'nothing') from pg_temp.s11_http_refusal`, what);
}
const refused = (statement, expectation, what) => {
  const answer = refusalOf(statement, what);
  assert.ok(answer !== 'ACCEPTED', `${what}: the database accepted a write it was meant to refuse `
    + `(statement ${shown(statement).slice(0, 200)})`);
  assert.match(answer, new RegExp(`^${expectation.code} `),
    `${what}: refused with the wrong SQLSTATE: ${shown(answer)}`);
  for (const part of expectation.sentence) {
    assert.ok(answer.includes(part),
      `${what}: expected the sentence to carry ${JSON.stringify(part)}, got ${shown(answer)}`);
  }
  return answer;
};
const say = (code, ...sentence) => ({ code, sentence });

/** The posture a reader of §4 cares about, read from the catalog rather than asserted from a design
 *  document: RLS on, no client grant, and the two client-write guards wired. */
const STAGE11_TABLES = ['operator_grants', 'support_cases', 'support_case_events', 'privacy_requests',
  'commerce_review_notes'];
const postureOf = (table) => cell(`
  select 'rls=' || c.relrowsecurity
    || ' grants=' || coalesce((select string_agg(distinct g.grantee || ':' || g.privilege_type, ' '
                                 order by g.grantee || ':' || g.privilege_type)
        from information_schema.role_table_grants g
       where g.table_schema = 'private' and g.table_name = '${table}'
         and g.grantee in ('anon','authenticated','service_role')), 'none')
    || ' guards=' || (count(*) filter (where tg.tgname like '%client%'))::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_trigger tg on tg.tgrelid = c.oid and not tg.tgisinternal
 where n.nspname = 'private' and c.relname = '${table}'
 group by c.relrowsecurity, c.oid`, `the posture of private.${table}`);

// --------------------------------------------------------------------------- REST
const people = {};
const WHO = ['hostA', 'hostB', 'hostC', 'hostD', 'hostV', 'hostProbe', 'stranger', 'decider',
  'opSupport', 'opSupport2', 'opOps', 'opFinance', 'opPrivacy', 'opConsole'];
const tokenOf = (who) => people[who].token;
const uidOf = (who) => people[who].userId;
const weddingOf = (who) => people[who].weddingId;

let transportRetries = 0;
const SOCKET_DEATHS = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE']);
const isSocketDeath = (err) => err instanceof TypeError && SOCKET_DEATHS.has(err?.cause?.code);
/** Only DML-free reads may be sent twice. Measured across Stages 8-10 on this host: Kong sometimes closes
 *  a socket before any response while other stacks compete for it. A write keeps its single shot, because
 *  the harness cannot tell a socket that died before the request from one that died after the server
 *  applied it — and a Stage 11 write is a claim about who did what. */
const READ_RPCS = new Set([
  '/rest/v1/rpc/operator_case_queue', '/rest/v1/rpc/get_operator_case', '/rest/v1/rpc/get_my_support_cases',
  '/rest/v1/rpc/get_my_support_case', '/rest/v1/rpc/operator_privacy_queue', '/rest/v1/rpc/get_my_privacy_requests',
  '/rest/v1/rpc/operator_commerce_review_queue', '/rest/v1/rpc/operator_takedown_plan',
  '/rest/v1/rpc/operator_operations_summary', '/rest/v1/rpc/resolve_guest_invitation',
  '/rest/v1/rpc/resolve_public_invitation', '/rest/v1/rpc/get_invitation_publication_state',
]);
const isReadCall = (method, path) => method === 'GET' || method === 'HEAD'
  || (method === 'POST' && READ_RPCS.has(path.split('?')[0]));

async function withReadRetry(what, send) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (err) {
      if (!isSocketDeath(err) || attempt >= 2) throw err;
      transportRetries += 1;
      console.error(`  transport  ${what}: the socket died before any response (${err.cause.code}), `
        + `attempt ${attempt} — retrying once`);
    }
  }
}

async function callOnce(method, path, { body, bearer = anonKey, headers = {} } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: anonKey, Authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    },
    // a string body is sent verbatim rather than re-encoded as a JSON document; the Storage artefact
    // upload does not come through here at all, because a Buffer here would reach the bucket as JSON text
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text === '' ? null : JSON.parse(text); } catch { parsed = { unparsed: text.slice(0, 300) }; }
  return { status: res.status, text, body: parsed };
}

async function call(method, path, opts = {}) {
  const send = () => callOnce(method, path, opts);
  return isReadCall(method, path) ? withReadRetry(`${method} ${path}`, send) : send();
}

async function rpc(name, args, { as = 'anon', headers = {}, profile = 'api' } = {}) {
  const bearer = as === 'anon' ? anonKey : as === 'service' ? serviceKey : tokenOf(as);
  const all = { ...headers };
  if (profile) all['Content-Profile'] = profile;
  return call('POST', `/rest/v1/rpc/${name}`, { body: args, bearer, headers: all });
}

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  const { data: fresh } = await c.auth.getSession();
  return { client: c, userId: data.user.id, token: fresh.session.access_token, email: emailFor(who) };
}

const HOST_EVENTS = (label) => ([
  { event_key: 'muhoortam', display_name: `${label} Muhoortham`, starts_at_local: '2027-02-14T09:00:00',
    ends_at_local: '2027-02-14T11:00:00', display_order: 1, enabled: true },
  { event_key: 'reception', display_name: `${label} Reception`, starts_at_local: '2027-02-14T18:00:00',
    ends_at_local: '2027-02-14T22:00:00', display_order: 2, enabled: true },
]);

/** A wedding a browser could really have made — create, draft, two events, freeze — published or not.
 *  Nothing here reaches for a privileged column: a row the product could not write would make every
 *  refusal below a statement about a shape the product never builds. */
async function buildWedding(who, label, { publish = true } = {}) {
  const w = await call('POST', '/rest/v1/weddings', {
    bearer: tokenOf(who),
    body: { owner_user_id: uidOf(who), title: `S11 HTTP ${label} ${RUN_TAG}`, primary_language: 'en' },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(w.status, 201, `${who} could not create a wedding: ${json(w.body)}`);
  const weddingId = w.body[0].id;
  allWeddings.push(weddingId);

  const d = await call('PATCH', `/rest/v1/invitation_drafts?wedding_id=eq.${weddingId}`, {
    bearer: tokenOf(who),
    body: { content: { welcome: `With the blessings of both families, join us for ${label}.`,
      family_introduction: `The families of ${label} invite you.`, event_notes: null, closing: null } },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(d.status, 200, `${who} could not write its draft: ${json(d.body)}`);
  assert.equal(d.body.length, 1, `${who}'s draft write came back with no row, so the freeze below would be `
    + `patching nothing: ${json(d.body)}`);

  for (const event of HOST_EVENTS(label)) {
    const e = await call('POST', '/rest/v1/wedding_events', {
      bearer: tokenOf(who),
      body: { ...event, wedding_id: weddingId, timezone: 'Asia/Kolkata' },
    });
    assert.equal(e.status, 201, `${who} could not create ${event.event_key}: ${json(e.body)}`);
  }
  const eventIds = sqlRows(`select id::text from public.wedding_events where wedding_id = '${weddingId}'
    order by display_order`);

  const v = await rpc('create_invitation_version', { p_wedding_id: weddingId }, { as: who });
  assert.equal(v.status, 200, `${who} could not freeze a version: ${json(v.body)}`);
  const out = { weddingId, versionId: v.body.version_id, eventIds };
  if (!publish) return out;
  const pub = await rpc('publish_invitation_version',
    { p_wedding_id: weddingId, p_version_id: out.versionId, p_expires_at: null }, { as: who });
  assert.equal(pub.status, 200, `${who} could not publish: ${json(pub.body)}`);
  return { ...out, publicPath: pub.body.path, publicationId: pub.body.publication_id };
}

/** The credential is 43 characters of the measured alphabet behind a fixed prefix, so the value never has
 *  to be printed to prove what it is: the shape is asserted here and the caller keeps only the slice. */
const credFrom = (path, prefix) => {
  if (!new RegExp(`^\\${prefix}[A-Za-z0-9_-]{43}$`).test(String(path ?? ''))) {
    throw new Error(`the minted path is not the measured shape: ${shown(path).slice(0, 8)}`);
  }
  return path.slice(prefix.length);
};

/** A guest roster, issued for real, because §6's claim that an operator takedown closes the guest door is
 *  about a door a guest was standing at. */
async function issueGuest(who, wedding) {
  const household = await call('POST', '/rest/v1/guest_households', {
    bearer: tokenOf(who),
    body: { wedding_id: wedding.weddingId, display_name: `The ${RUN_TAG} Family`,
      salutation: `${RUN_TAG} family`, expected_party_size: 3 },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(household.status, 201, `guest roster could not be built: ${json(household.body)}`);
  const householdId = household.body[0].id;
  for (const eventId of wedding.eventIds) {
    await call('POST', '/rest/v1/household_event_scopes', {
      bearer: tokenOf(who),
      body: { wedding_id: wedding.weddingId, household_id: householdId, event_id: eventId },
    });
  }
  const issue = await rpc('issue_guest_invitations', {
    p_wedding_id: wedding.weddingId, p_household_ids: [householdId], p_expires_at: null,
  }, { as: who });
  assert.equal(issue.status, 200, `guest invitations could not be issued: ${json(issue.body)}`);
  return { householdId, guestCred: credFrom(issue.body?.invitations?.[0]?.path, '/g/') };
}

// --------------------------------------------------------------------------- the artefact
/** One 1×1 PNG, the same bytes for every key. The bucket pins `allowed_mime_types` to
 *  {image/png, image/webp, application/pdf} (measured on `storage.buckets`), so a synthetic text body
 *  posted as `image/png` would be a claim about bytes this run has no business making. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const hex64Of = (seed) => createHash('sha256').update(`${RUN_TAG}-${seed}`).digest('hex');
const KEY_SHAPE = /^outputs\/[0-9a-f-]{36}\/share_image\/[0-9a-f]{4}x[0-9a-f]{4}\/[0-9a-f-]{36}$/;

/** A manifest row, born the only way the guards on that table allow: `registered`, and with no digest.
 *  Both facts are the table's own, measured here rather than assumed — `private.mint_invitation_output_key`
 *  refuses a birth in any other state and refuses a digest on a row that has not produced bytes, and the
 *  registered → ready jump is refused outright, so the walk below goes through `uploading`. */
function registerOutput(wedding, variant) {
  const key = exec(`
    insert into public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, status)
      values ('${wedding.weddingId}', '${wedding.versionId}', 'share_image', '${variant}', 'png',
        '${hex64Of('cfg')}', '${hex64Of('dto')}', 'host_private', 'registered')
    returning object_key`)[0];
  plantedKeys.push(key);
  return key;
}
const moveOutput = (key, status, digest) => exec(`
  update public.invitation_outputs set status = '${status}'
     ${digest ? `, content_digest = '${digest}'` : ''}
   where object_key = '${key}'
   returning status || ' digest=' || (content_digest is not null)::text
     || ' ready_at=' || (ready_at is not null)::text`)[0];
const outputRow = (key) => cell(`
  select 'status=' || status || ' reason=' || coalesce(invalidation_reason, '-')
    || ' digest=' || coalesce(left(content_digest, 8), '-')
  from public.invitation_outputs where object_key = '${key}'`, `the manifest row for the planted key`);

async function uploadObject(key) {
  // The write is a raw fetch rather than `callOnce`, because that helper serialises a body with
  // `JSON.stringify` — which sends a Buffer as `{"type":"Buffer","data":[…]}` and would store that text in
  // the bucket. The bytes below are the digest's subject, so they go up exactly as `PNG` holds them, in
  // the spelling the trusted publisher itself uses (`makeStorageChannel`).
  const put = await fetch(`${url}/storage/v1/object/${OUTPUT_BUCKET}/${key}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'image/png' },
    body: PNG,
  });
  const putText = await put.text();
  assert.equal(put.status, 200, `the object upload answered ${put.status}: ${shown(putText).slice(0, 160)}`);
  const back = await fetch(`${url}/storage/v1/object/${OUTPUT_BUCKET}/${key}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${serviceKey}` },
  });
  assert.equal(back.status, 200, `the object read-back answered ${back.status} with `
    + `${back.headers.get('content-type')} and ${back.headers.get('content-length')} bytes, so the digest `
    + 'below would be a claim about a file this run did not see');
  const bytes = Buffer.from(await back.arrayBuffer());
  assert.equal(bytes.equals(PNG), true, `the ${bytes.length} bytes read back are not the ${PNG.length} `
    + 'uploaded, so the digest below would be a claim about a file this run did not see');
  return createHash('sha256').update(bytes).digest('hex');
}
/** A signed URL for a key, fetched, and the answer described only by its shape. The URL itself is never
 *  printed and never put into an assertion message: it carries the token in its query string. */
async function signedFetch(key) {
  const sign = await callOnce('POST', `/storage/v1/object/sign/${OUTPUT_BUCKET}/${key}`, {
    bearer: serviceKey, body: { expiresIn: 600 },
  });
  assert.equal(sign.status, 200, `signing the object answered ${sign.status}`);
  const href = String(sign.body?.signedURL ?? '');
  assert.ok(href.length > 0, 'the sign answer carries no URL');
  const res = await fetch(href.startsWith('http') ? href : `${url}${href}`);
  const body = await res.text();
  return { status: res.status, bytes: body.length };
}
async function readAsRole(key, who) {
  const r = await fetch(`${url}/storage/v1/object/authenticated/${OUTPUT_BUCKET}/${key}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${tokenOf(who)}` },
  });
  return r.status;
}
async function removeObject(key) {
  const r = await callOnce('DELETE', `/storage/v1/object/${OUTPUT_BUCKET}`, {
    bearer: serviceKey, body: { prefixes: [key] },
  });
  assert.ok(r.status === 200 || r.status === 204, `the object removal answered ${r.status}`);
  return r.status;
}

// --------------------------------------------------------------------------- the cast's fixtures
const plantedKeys = [];
/** Every wedding this run built, recorded by the one function that builds them rather than by each caller
 *  remembering to. `after()` deletes from this list, so a case that builds a wedding for itself cannot
 *  leave it behind by forgetting to register it, and a wedding whose id a case overwrote on an account
 *  still gets removed. */
const allWeddings = [];
const auditIds = new Set();
const caseRefs = [];
const requestRefs = [];
const moneyFixtures = [];
/** The two ledger rows group H plants to give the window something to discriminate, registered here rather
 *  than inside `describe('S11 H …')` because `after()` owns the sweep that gives them back: an
 *  `event_id`-prefixed delete is the same predicate Stage 10's own teardown uses
 *  (`stage10_commerce_http.test.mjs:847`), and a row this run leaves behind would fail *that* suite's
 *  residue cell on the next `run.sh` pass rather than this one's. */
const healthEvents = [];

/** A support case opened by its own host, as §5 says it is opened. */
async function openCase(who, weddingId, { category = 'invitation_access', severity = 'normal',
  summary = `The guest cannot open the invitation (${RUN_TAG})` } = {}) {
  const r = await rpc('open_support_case', {
    p_wedding_id: weddingId, p_category: category, p_severity: severity, p_summary: summary,
    p_idempotency_key: randomUUID(),
  }, { as: who });
  assert.equal(r.status, 200, `open_support_case answered ${json(r.status === 200 ? null : r.body)}`);
  assert.match(r.body.case_ref, CASE_REF, `the minted case ref is not the measured shape: ${json(r.body)}`);
  caseRefs.push(r.body.case_ref);
  return r.body.case_ref;
}
async function filePrivacy(who, weddingId, { kind = 'export', note = `Please send our photos (${RUN_TAG})` } = {}) {
  const r = await rpc('create_privacy_request',
    { p_wedding_id: weddingId, p_kind: kind, p_note: note }, { as: who });
  assert.equal(r.status, 200, `create_privacy_request answered ${json(r.body)}`);
  assert.match(r.body.request_ref, REQUEST_REF, `the minted request ref is not the measured shape`);
  requestRefs.push(r.body.request_ref);
  return r.body.request_ref;
}
/** One captured HTTP answer, described by the six things a reader of these logs needs — and nothing else,
 *  so an assertion failure cannot leak a token or a body the design chose to keep out. */
const shape = (r) => ({ status: r.status, code: r.body?.code ?? null, message: r.body?.message ?? null });
/** A door read as a body rather than only as a status: "the door closed" and "the door still serves the
 *  wedding's content" are both 200, and §6's before/after halves are only comparable if the difference is
 *  in what the case asserts. */
const door = (r) => ({ status: r.status, code: r.body?.code ?? null, message: r.body?.message ?? null,
  available: r.body?.available ?? null,
  serves: r.body?.invitation ? keysOf(r.body.invitation) : null, keys: keysOf(r.body) });
const keysOf = (value) => Object.keys(value ?? {}).sort().join(',');
/** A key set written the only way `keysOf` can compare it: sorted, then joined. Typed by hand, one of them
 *  is always out of order, and the failure reads like a projection bug rather than a typo. */
const keySet = (...names) => [...names].sort().join(',');

/** The money this stage reads and never moves: one captured order and one succeeded refund, planted the
 *  way Stage 10's own ledger rows are planted. `private.commerce_packages` is not needed — the note door
 *  walks refund → order, and both rows carry their own price columns. */
async function plantMoney(who, weddingId, label) {
  const orderId = randomUUID();
  exec(`insert into private.commerce_orders (id, wedding_id, owner_user_id, merchant_reference, package_code,
      price_version, amount_minor, currency, status, quote_expires_at, captured_at)
    values ('${orderId}', '${weddingId}', '${uidOf(who)}', '${RUN_TAG}-ord-${label}', 'classic', 1, 150000,
      'INR', 'captured', now() + interval '1 day', now() - interval '2 days')`,
  `the ${label} order row`);
  const refundId = randomUUID();
  exec(`insert into private.commerce_refunds (id, order_id, kind, status, amount_minor, currency,
      provider_refund_ref, recorded_at, completed_at)
    values ('${refundId}', '${orderId}', 'refund', 'succeeded', 50000, 'INR', '${RUN_TAG}-rf-${label}',
      now() - interval '2 hours', now() - interval '1 hour')`,
  `the ${label} refund row`);
  moneyFixtures.push({ orderId, refundId, weddingId, label });
  return { orderId, refundId, weddingId, label };
}
/** The ledger read as one line: every column an oversight note could be accused of moving. The refund's
 *  amount is `coalesce`d because the recorded chargeback this file plants carries it genuinely NULL
 *  (`3649-3652`), and `||` with a NULL swallows the whole line rather than showing the absent column — the
 *  literal `null` keeps the two shapes distinguishable, which is all the line is for. */
const moneyLine = (fixture) => cell(`
  select 'order=' || o.status || '/' || o.amount_minor::text || '/' || o.currency
    || ' refund=' || r.status || '/' || coalesce(r.amount_minor::text, 'null') || '/' || coalesce(r.provider_refund_ref, '-')
    || ' attempts=' || (select count(*)::text from private.commerce_payment_attempts a where a.order_id = o.id)
    || ' events=' || (select count(*)::text from private.commerce_payment_events e where e.order_id = o.id)
    || ' entitlements=' || (select count(*)::text from public.entitlements e where e.wedding_id = o.wedding_id)
    || ' notes=' || (select count(*)::text from private.commerce_review_notes n where n.refund_id = r.id)
  from private.commerce_orders o join private.commerce_refunds r on r.order_id = o.id
  where o.id = '${fixture.orderId}'`, `the ledger line for ${fixture.label}`);

const policyLine = () => cell(`
  select publish_gate || '|' || coalesce(nullif(array_to_string(publish_required_package_codes, ','), ''), '-')
    || '|' || live_capture_enabled::text || '|' || refund_revocation_mode
  from private.commerce_policy where id = 1`, 'the policy singleton');

// --------------------------------------------------------------------------- the census
/** Mirrors `leak_census()` in `supabase/tests/api/run.sh`, store for store, including the nine
 *  (action, subject_type) pairs behind `stage11_audit_rows`. The filter is on the pair and not on the
 *  action because Stage 10 also writes an action named `revoked`, and a count that mixes them would let
 *  this suite's own leak hide inside somebody else's ledger row. */
const censusQuery = `select 'weddings='||count(*) from public.weddings
  union all select 'auth.users='||count(*) from auth.users
  union all select 'invitation_drafts='||count(*) from public.invitation_drafts
  union all select 'wedding_assets='||count(*) from public.wedding_assets
  union all select 'storage.objects(wedding-assets)='||count(*) from storage.objects where bucket_id = 'wedding-assets'
  union all select 'approval_requests='||count(*) from public.approval_requests
  union all select 'approval_feedback='||count(*) from public.approval_feedback
  union all select 'access_tokens='||count(*) from private.access_tokens
  union all select 'guest_invitation_tokens='||count(*) from private.access_tokens where token_kind = 'guest_invitation'
  union all select 'publications='||count(*) from public.publications
  union all select 'invitation_versions='||count(*) from public.invitation_versions
  union all select 'guest_households='||count(*) from public.guest_households
  union all select 'household_event_scopes='||count(*) from public.household_event_scopes
  union all select 'rsvp_responses='||count(*) from public.rsvp_responses
  union all select 'invitation_outputs='||count(*) from public.invitation_outputs
  union all select 'storage.objects(invitation-outputs)='||count(*) from storage.objects where bucket_id = 'invitation-outputs'
  union all select 'storage.objects(invitation-previews)='||count(*) from storage.objects where bucket_id = 'invitation-previews'
  union all select 'commerce_packages='||count(*) from private.commerce_packages
  union all select 'commerce_orders='||count(*) from private.commerce_orders
  union all select 'commerce_payment_attempts='||count(*) from private.commerce_payment_attempts
  union all select 'commerce_payment_events='||count(*) from private.commerce_payment_events
  union all select 'commerce_refunds='||count(*) from private.commerce_refunds
  union all select 'commerce_policy='||count(*) from private.commerce_policy
  union all select 'entitlements='||count(*) from public.entitlements
  union all select 'operator_grants='||count(*) from private.operator_grants
  union all select 'support_cases='||count(*) from private.support_cases
  union all select 'support_case_events='||count(*) from private.support_case_events
  union all select 'privacy_requests='||count(*) from private.privacy_requests
  union all select 'commerce_review_notes='||count(*) from private.commerce_review_notes
  union all select 'stage11_audit_rows='||count(*) from private.audit_events where
    (action, subject_type) in (('granted','operator_grant'), ('revoked','operator_grant'),
      ('case_claimed','support_case'), ('case_released','support_case'), ('status_changed','support_case'),
      ('privacy_status_changed','privacy_request'), ('publication_takedown','publication'),
      ('publication_objects_purge_planned','publication'), ('commerce_review_note_added','commerce_refund'))`;
const census = () => Object.fromEntries(sqlRows(censusQuery).map((r) => r.split('=')));

// --------------------------------------------------------------------------- authority
/** The grant, minted the only way it can be minted: the two bodies that write authority hold no EXECUTE
 *  grant for any role a request can arrive as, so this goes through the trusted channel. `postgres` is the
 *  granter here because the predicate reads `auth.uid()` and a session-less channel answers false — which
 *  is the recorded reason §3 gives for why granting authority cannot itself require authority. */
const grants = {};
function grant(userId, scope, actorUserId) {
  const answer = trusted(
    `internal_api.grant_operator_role('${userId}', '${scope}', '${RUN_TAG} grant for the HTTP battery', `
    + `'${actorUserId}', null)`, `the ${scope} grant`);
  assert.equal(answer.status, 'active', `the grant did not come back active: ${json(answer)}`);
  grants[answer.scope] = answer;
  auditIds.add(answer.audit_id);
  return answer;
}
function revoke(userId, scope, actorUserId) {
  const answer = trusted(
    `internal_api.revoke_operator_role('${userId}', '${scope}', '${RUN_TAG} revocation by the HTTP battery', `
    + `'${actorUserId}')`, `the ${scope} revocation`);
  auditIds.add(answer.audit_id);
  return answer;
}

// The nineteen doors this stage exposed, each with the scope that opens it, the sentence the predicate
// answers when the caller does not hold it, and the arguments each arm below sends. `scope: null` marks
// the six intake doors, which authorise against ownership of the wedding rather than against a grant, so
// the wall they meet is a different wall and is asserted separately.
const DOORS = [
  // The `args` a non-entitled caller sends and the `ok` arm the entitled caller sends are deliberately
  // different rows of the fixture table: A-04 opens every door for real, and a door that opens by writing
  // would otherwise consume the ticket, the request, the refund or the publication that C, T, R and V are
  // going to read. The probe wedding exists so that A-04's takedown can be a takedown.
  ['open_support_case', { scope: null, refuse: SAY.caseOpenNo, control: 'C-01',
    args: () => ({ p_wedding_id: weddingOf('hostA'), p_category: 'invitation_access', p_severity: 'normal',
      p_summary: `door probe, not my wedding (${RUN_TAG})`, p_idempotency_key: randomUUID() }),
    ok: { as: 'hostProbe', args: () => ({ p_wedding_id: fixtures.probeWedding, p_category: 'invitation_access',
      p_severity: 'normal', p_summary: `door probe, opened by its own host (${RUN_TAG})`,
      p_idempotency_key: randomUUID() }) } }],
  ['get_my_support_cases', { scope: null, refuse: null, control: 'C-01',
    args: () => ({ p_status: null, p_limit: null }),
    ok: { as: 'hostProbe', args: () => ({ p_status: null, p_limit: null }) } }],
  ['get_my_support_case', { scope: null, refuse: SAY.caseNo, control: 'C-01',
    args: () => ({ p_case_ref: fixtures.caseA }),
    ok: { as: 'hostProbe', args: () => ({ p_case_ref: fixtures.caseProbe }) } }],
  ['reply_to_support_case', { scope: null, refuse: SAY.replyNo, control: 'C-03',
    args: () => ({ p_case_ref: fixtures.caseA, p_body: `not my ticket (${RUN_TAG})`,
      p_idempotency_key: randomUUID() }),
    ok: { as: 'hostProbe', args: () => ({ p_case_ref: fixtures.caseProbe,
      p_body: `a reply from its own host (${RUN_TAG})`, p_idempotency_key: randomUUID() }) } }],
  ['create_privacy_request', { scope: null, refuse: SAY.privacyOpenNo, control: 'V-01',
    args: () => ({ p_wedding_id: weddingOf('hostA'), p_kind: 'export', p_note: `door probe (${RUN_TAG})` }),
    // The intake's duplicate anchor is the caller's own live (wedding, kind) request, not a key (privacy
    // migration :275-286), and `before()` already filed the probe wedding's `export` request as
    // fixtures.privacyProbe. The door probe therefore files the other kind, so `replayed=false` below is a
    // statement about a fresh intake rather than a measurement of this file's own fixture order.
    ok: { as: 'hostProbe', args: () => ({ p_wedding_id: fixtures.probeWedding, p_kind: 'erasure',
      p_note: `door probe, filed by its own host (${RUN_TAG})` }) } }],
  ['get_my_privacy_requests', { scope: null, refuse: null, control: 'V-02',
    args: () => ({}), ok: { as: 'hostProbe', args: () => ({}) } }],
  ['operator_case_queue', { scope: 'support', refuse: SAY.queueNo, control: 'C-02',
    args: () => ({ p_status: null, p_category: null, p_limit: null }),
    ok: { as: 'opSupport', args: () => ({ p_status: null, p_category: null, p_limit: null }) } }],
  ['get_operator_case', { scope: 'support', refuse: SAY.caseNo, control: 'C-02',
    args: () => ({ p_case_ref: fixtures.caseA }),
    ok: { as: 'opSupport', args: () => ({ p_case_ref: fixtures.caseProbe }) } }],
  ['operator_claim_case', { scope: 'support', refuse: SAY.claimNo, control: 'C-05',
    args: () => ({ p_case_ref: fixtures.caseProbe, p_idempotency_key: randomUUID() }),
    ok: { as: 'opSupport', args: () => ({ p_case_ref: fixtures.caseProbe, p_idempotency_key: randomUUID() }) } }],
  // The release follows the claim in this table's own order, so the door opens on a case the caller really
  // holds; C-05 then meets the two contention refusals on the cast's own fixture, not on this probe.
  ['operator_release_case', { scope: 'support', refuse: SAY.releaseNo, control: 'C-05',
    args: () => ({ p_case_ref: fixtures.caseProbe, p_idempotency_key: randomUUID() }),
    ok: { as: 'opSupport', args: () => ({ p_case_ref: fixtures.caseProbe, p_idempotency_key: randomUUID() }) } }],
  ['operator_transition_case', { scope: 'support', refuse: SAY.transitionNo, control: 'C-05',
    args: () => ({ p_case_ref: fixtures.caseProbe, p_to_status: 'triaged', p_resolution_code: null,
      p_body: `triaged by the door probe (${RUN_TAG})`, p_idempotency_key: randomUUID() }),
    ok: { as: 'opSupport', args: () => ({ p_case_ref: fixtures.caseProbe, p_to_status: 'triaged',
      p_resolution_code: null, p_body: `triaged by its own desk (${RUN_TAG})`,
      p_idempotency_key: randomUUID() }) } }],
  ['operator_add_case_note', { scope: 'support', refuse: SAY.noteNo, control: 'C-03',
    args: () => ({ p_case_ref: fixtures.caseProbe, p_kind: 'message_operator',
      p_body: `an internal note on somebody else's ticket (${RUN_TAG})`, p_idempotency_key: randomUUID() }),
    ok: { as: 'opSupport', args: () => ({ p_case_ref: fixtures.caseNote, p_kind: 'message_operator',
      p_body: `an internal note (${RUN_TAG})`, p_idempotency_key: randomUUID() }) } }],
  ['operator_privacy_queue', { scope: 'privacy', refuse: SAY.privacyQueueNo, control: 'V-02',
    args: () => ({ p_status: null }), ok: { as: 'opPrivacy', args: () => ({ p_status: null }) } }],
  ['operator_advance_privacy_request', { scope: 'privacy', refuse: SAY.privacyChangeNo, control: 'V-03',
    args: () => ({ p_request_ref: fixtures.privacyA, p_status: 'identity_verification_requested',
      p_note: `advanced by the wrong desk (${RUN_TAG})`, p_idempotency_key: randomUUID() }),
    ok: { as: 'opPrivacy', args: () => ({ p_request_ref: fixtures.privacyProbe,
      p_status: 'identity_verification_requested', p_note: `advanced by the door probe (${RUN_TAG})`,
      p_idempotency_key: randomUUID() }) } }],
  ['operator_commerce_review_queue', { scope: 'finance_review', refuse: SAY.commerceQueueNo, control: 'R-01',
    args: () => ({ p_status: null, p_limit: null }),
    ok: { as: 'opFinance', args: () => ({ p_status: null, p_limit: null }) } }],
  // R-03 is this door's own act (one note, one thread row, one trail row); R-05 answers a call of exactly
  // this shape with the `refuse` sentence below, which is why the two arms are named together here.
  ['operator_add_commerce_review_note', { scope: 'finance_review', refuse: SAY.refundNo, control: 'R-03',
    args: () => ({ p_refund_id: moneyA.refundId, p_case_ref: fixtures.caseMoney, p_kind: 'in_review',
      p_note: `annotated by the wrong desk's own ticket (${RUN_TAG})`, p_idempotency_key: randomUUID() }),
    ok: { as: 'opFinance', args: () => ({ p_refund_id: moneyProbe.refundId, p_case_ref: fixtures.caseProbeMoney,
      p_kind: 'in_review', p_note: `annotated by the door probe (${RUN_TAG})`,
      p_idempotency_key: randomUUID() }) } }],
  ['operator_takedown_plan', { scope: 'operations', refuse: SAY.planNo, control: 'T-01',
    args: () => ({ p_wedding_id: weddingOf('hostC') }),
    ok: { as: 'opOps', args: () => ({ p_wedding_id: fixtures.probeWedding }) } }],
  // The takedown's non-entitled argument names Delta — the cast's own published wedding — because the
  // refusal that matters here is the one a finance operator meets while looking at a real publication. The
  // entitled arm takes the probe wedding down instead, so T-02 still has a live publication to walk.
  ['operator_takedown_publication', { scope: 'operations', refuse: SAY.takedownNo, control: 'A-03',
    args: () => ({ p_wedding_id: weddingOf('hostD'), p_case_ref: fixtures.caseD, p_reason: 'safety',
      p_idempotency_key: randomUUID() }),
    ok: { as: 'opOps', args: () => ({ p_wedding_id: fixtures.probeWedding, p_case_ref: fixtures.caseTakedown,
      p_reason: 'safety', p_idempotency_key: randomUUID() }) } }],
  ['operator_operations_summary', { scope: 'operations', refuse: SAY.healthNo, control: 'H-01',
    args: () => ({ p_window_hours: 24 }), ok: { as: 'opOps', args: () => ({ p_window_hours: 24 }) } }],
];
const OPERATOR_DOORS = DOORS.filter((d) => d[1].scope);
const INTAKE_DOORS = DOORS.filter((d) => !d[1].scope);
/** The three bodies §3 gave no door, in the two postures that differ: the grant pair is SECURITY INVOKER
 *  with zero grants, the purge plan is SECURITY DEFINER with zero grants. Both answers are the same to a
 *  client and different to a reader of the catalog, so A-04 asserts both halves. */
const DOORLESS = ['grant_operator_role', 'revoke_operator_role', 'operator_purge_publication_objects'];
/** A well-formed call for each doorless body, in its own real signature (authority migration :409-415 and
 *  :521-526, takedown migration :493-497). A-05 sends these so that the only reason a client can be
 *  refused is the schema: an empty body would be refused for its arity, which says nothing about reach. */
const doorlessArgs = (name) => name === 'operator_purge_publication_objects'
  ? { p_case_ref: fixtures.caseTakedown ?? NOT_A_CASE_REF,
    p_actor_user_id: uidOf('opOps') ?? NOT_A_WEDDING, p_idempotency_key: randomUUID() }
  : { p_user_id: uidOf('opConsole') ?? NOT_A_WEDDING, p_scope: 'support',
    p_reason: `${RUN_TAG} attempted through the exposed schema`,
    p_actor_user_id: uidOf('decider') ?? NOT_A_WEDDING,
    ...(name === 'grant_operator_role' ? { p_expires_at: null } : {}) };

const fixtures = {};
let moneyA = null;
let moneyB = null;
let moneyProbe = null;

// --------------------------------------------------------------------------- the gate
let baseline = null;

before(async () => {
  // Pinned before anything else can throw, because the head is not the whole answer: this file is not in that
  // head's tree, so a capture that named only the head would still leave the tested bytes unknown. A digest
  // is not a secret, and neither is a SHA — both are what the closing report has to quote.
  const head = (() => {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
    catch { return 'unknown'; }
  })();
  console.log(`  tested head=${head}`);
  console.log(`  this file sha256=${createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')}`);
  console.log(`  sql channel=${TARGET.mode}`
    + (TARGET.mode === 'docker' ? ` container=${TARGET.container}`
      : ` psql=${PSQL_BIN} host=${new URL(TARGET.url).hostname}:${new URL(TARGET.url).port}`)
    + ` (REST target=${url})`);
  assert.equal(String(sqlRows('show standard_conforming_strings')[0]), 'on',
    'refusing to run: standard_conforming_strings is not exactly `on`, so a backslash in a value could eat '
    + 'a quote and every literal this file interpolates would be a measurement of something else');
  baseline = census();

  // The surface first, from the catalog rather than from this file's constants: a stack one migration
  // behind has none of these names, and every case below would then answer 404 — which reads exactly like
  // the refusals this file asserts. The names are the migration's own, and the count is checked as a set
  // of nineteen so a renamed door cannot pass a length check.
  const exposed = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname in (${DOORS.map((d) => `'${d[0]}'`).join(',')}) order by 1`);
  assert.deepEqual(exposed, [...DOORS].map((d) => d[0]).sort(),
    `the Stage 11 doors are not all deployed: ${JSON.stringify(exposed)}`);
  const doorless = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal_api' and p.proname in ('${DOORLESS.join("','")}') order by 1`);
  assert.deepEqual(doorless, [...DOORLESS].sort(),
    `the three doorless bodies are not where §3 puts them: ${JSON.stringify(doorless)}`);
  const exposedDoorless = sqlRows(`select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname in ('${DOORLESS.join("','")}')`);
  assert.deepEqual(exposedDoorless, [],
    `a doorless body grew an HTTP door: ${JSON.stringify(exposedDoorless)}`);
  // The predicate every one of the thirteen operator doors calls, and the two guards the trail depends on.
  const guards = sqlRows(`select n.nspname||'.'||p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('actor_is_operator','reject_audit_update_except_referential_null',
      'reject_audit_human_row_without_actor','operator_authorising_case') order by 1`);
  assert.deepEqual(guards, ['private.actor_is_operator', 'private.operator_authorising_case',
    'private.reject_audit_human_row_without_actor', 'private.reject_audit_update_except_referential_null'],
    `the Stage 11 predicate and guards are not where the migration puts them: ${JSON.stringify(guards)}`);

  // The four-layer posture on the five stores, read from the catalog: RLS on, no client grant, and both
  // client guards wired. A-05 asks the same question over the wire; this is what makes that answer mean
  // something on a stack that was supposedly already hardened.
  for (const table of STAGE11_TABLES) {
    assert.equal(postureOf(table), 'rls=true grants=none guards=2',
      `private.${table} is not in the shipped posture, so A-05 would be measuring a different table`);
  }
  // No client role may EXECUTE the three doorless bodies, and `authenticated` may EXECUTE every one of the
  // nineteen doors — an operator door whose body held no such grant would be a 42501 at every attempt
  // rather than a refusal the design wrote.
  const doorlessGrants = sqlRows(`select e.rolname || '/' || p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'),('authenticated'),('service_role')) e(rolname)
    where n.nspname = 'internal_api' and p.proname in ('${DOORLESS.join("','")}')
      and has_function_privilege(e.rolname, p.oid, 'EXECUTE')`);
  assert.deepEqual(doorlessGrants, [],
    `a doorless body is executable by a request role: ${JSON.stringify(doorlessGrants)}`);
  const doorGrants = sqlRows(`select distinct p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal_api' and p.proname in (${DOORS.map((d) => `'${d[0]}'`).join(',')})
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  assert.deepEqual(doorGrants, [],
    `an operator door's body is not executable by authenticated, so every 403 below would be a 42501 from `
    + `the grant rather than the predicate: ${JSON.stringify(doorGrants)}`);

  // The stores this suite is about to write into must be empty, and the trail must hold no Stage 11 row:
  // after() promises to give every count back, and a row that arrived from somebody else cannot be given
  // back by a run that did not write it.
  for (const store of ['operator_grants', 'support_cases', 'support_case_events', 'privacy_requests',
    'commerce_review_notes']) {
    assert.equal(count(`from private.${store}`), '0',
      `private.${store} is not empty at the start of the run, so after() cannot attribute its rows to this run`);
  }
  assert.equal(cell(`select count(*)::text from private.audit_events where (action, subject_type) in
      (('granted','operator_grant'), ('revoked','operator_grant'), ('case_claimed','support_case'),
       ('case_released','support_case'), ('status_changed','support_case'),
       ('privacy_status_changed','privacy_request'), ('publication_takedown','publication'),
       ('publication_objects_purge_planned','publication'), ('commerce_review_note_added','commerce_refund'))`,
  'the Stage 11 audit rows'), '0',
  'the trail already holds Stage 11 rows, so this run cannot promise to leave none');

  for (const who of WHO) Object.assign(people[who] ??= {}, await signUp(who));

  // The decider mints every grant and holds none — §3's shape, and the reason the trail names a human for
  // the grant without the grantee having to be anybody yet.
  grant(uidOf('opSupport'), 'support', uidOf('decider'));
  grant(uidOf('opSupport2'), 'support', uidOf('decider'));
  grant(uidOf('opOps'), 'operations', uidOf('decider'));
  grant(uidOf('opFinance'), 'finance_review', uidOf('decider'));
  grant(uidOf('opPrivacy'), 'privacy', uidOf('decider'));

  const a = await buildWedding('hostA', 'Alpha');
  people.hostA.weddingId = a.weddingId;
  people.hostA.versionId = a.versionId;
  people.hostA.publicPath = a.publicPath;
  const b = await buildWedding('hostB', 'Beta');
  people.hostB.weddingId = b.weddingId;
  const c = await buildWedding('hostC', 'Gamma');
  people.hostC.weddingId = c.weddingId;
  const d = await buildWedding('hostD', 'Delta');
  people.hostD.weddingId = d.weddingId;
  const v = await buildWedding('hostV', 'Echo', { publish: false });
  people.hostV.weddingId = v.weddingId;

  // The cast's own fixtures, in the order §13 reads them: a ticket its host can see, a ticket an operator
  // claims, a privacy request the desk has not touched, and one refund per host so the note door can be
  // refused by a finance operator who is looking at somebody else's money.
  fixtures.caseA = await openCase('hostA', weddingOf('hostA'), { summary: `${SENTINEL} the guest door 404s` });
  fixtures.caseClaim = await openCase('hostA', weddingOf('hostA'), { category: 'guest_rsvp',
    summary: `A ticket the desk will claim (${RUN_TAG})` });
  fixtures.caseB = await openCase('hostB', weddingOf('hostB'), { summary: `Beta's own ticket (${RUN_TAG})` });
  fixtures.caseD = await openCase('hostD', weddingOf('hostD'), { category: 'publication_delivery',
    summary: `A ticket that authorises the A-03 takedown control (${RUN_TAG})` });
  fixtures.privacyA = await filePrivacy('hostA', weddingOf('hostA'));
  fixtures.privacyB = await filePrivacy('hostB', weddingOf('hostB'));
  fixtures.privacyV = await filePrivacy('hostV', weddingOf('hostV'));
  moneyA = await plantMoney('hostA', weddingOf('hostA'), 'A');
  moneyB = await plantMoney('hostB', weddingOf('hostB'), 'B');
  fixtures.caseMoney = await openCase('hostA', weddingOf('hostA'), { category: 'billing_refund_inquiry',
    severity: 'high', summary: `A refund the owner says never landed (${RUN_TAG})` });

  // A-04's controls open every door by doing the thing the door is for, and doing it writes: a claim takes
  // the holder off C-05's fixture, an advance leaves V-06's request no longer `received`, a takedown
  // removes T-02's live publication, a review note uses up R-04's "no note yet". So the door-opening half
  // of the battery gets a wedding and a cast of records of its own, all owned by `hostProbe`, who holds no
  // grant and appears nowhere else.
  const probe = await buildWedding('hostProbe', 'Foxtrot');
  people.hostProbe.weddingId = probe.weddingId;
  fixtures.probeWedding = probe.weddingId;
  fixtures.caseProbe = await openCase('hostProbe', probe.weddingId, {
    summary: `A ticket the door probe claims and takes down (${RUN_TAG})` });
  fixtures.caseNote = await openCase('hostProbe', probe.weddingId, { category: 'guest_rsvp',
    summary: `A ticket the door probe notes on (${RUN_TAG})` });
  fixtures.caseTakedown = await openCase('hostProbe', probe.weddingId, { category: 'publication_delivery',
    severity: 'high', summary: `A ticket that authorises the door probe's own takedown (${RUN_TAG})` });
  fixtures.privacyProbe = await filePrivacy('hostProbe', probe.weddingId);
  moneyProbe = await plantMoney('hostProbe', probe.weddingId, 'probe');
  fixtures.caseProbeMoney = await openCase('hostProbe', probe.weddingId, {
    category: 'billing_refund_inquiry', summary: `The probe's own refund enquiry (${RUN_TAG})` });

  // The artefact group needs a real file behind a real manifest row on a wedding that is still published,
  // so it gets its own: hostA's Alpha carries the guest roster and both planted outputs.
  const guest = await issueGuest('hostA', a);
  fixtures.guestCred = guest.guestCred;
  fixtures.householdId = guest.householdId;
  fixtures.eventId = a.eventIds[0];
  fixtures.readyKey = registerOutput(a, '1080x1350');
  fixtures.registeredKey = registerOutput(a, '1080x1620');
  fixtures.readyDigest = await uploadObject(fixtures.readyKey);
  moveOutput(fixtures.readyKey, 'uploading', null);
  moveOutput(fixtures.readyKey, 'ready', fixtures.readyDigest);
  await uploadObject(fixtures.registeredKey);

  // The two channels proved to be one database rather than assumed to be: everything above went in over
  // REST, so reading the newest grant back through this SQL channel turns every count, posture and trail
  // row asserted below into a statement about the stack the product talks to.
  const roundTrip = sqlRows(`select id::text from public.weddings where id in ('${a.weddingId}', '${b.weddingId}')`);
  assert.deepEqual([...roundTrip].sort(), [a.weddingId, b.weddingId].sort(),
    `the SQL channel (${TARGET.mode}) does not see the weddings REST just wrote, so it is not this `
    + 'stack\'s database');
  assert.equal(cell('select current_database()', 'the SQL channel database name'), 'postgres',
    "the SQL channel is not connected to the stack's own `postgres` database");
});

after(async () => {
  const owned = Object.values(people).map((p) => p.weddingId).filter(Boolean);
  const weddings = [...new Set([...owned, ...allWeddings])];
  // The objects go before the rows that name them and before the census reads them: a manifest row whose
  // bytes are still in the bucket would leave `storage.objects(invitation-outputs)` above the baseline for
  // a reason this file caused.
  if (plantedKeys.length > 0) {
    await callOnce('DELETE', `/storage/v1/object/${OUTPUT_BUCKET}`, {
      bearer: serviceKey, body: { prefixes: plantedKeys },
    });
  }
  // A run that died in `before()` registers no weddings, and an empty `in ()` is a syntax error that would
  // report a teardown crash instead of the failure that caused it. The nil uuid matches nothing, so the
  // sweep stays valid SQL and a dead run still tears down and reads its own census.
  const ids = weddings.map((w) => `'${w}'::uuid`).join(',')
    || "'00000000-0000-0000-0000-000000000000'::uuid";
  // Child before parent, read off the migrations' own FK clauses: notes hang off refunds, refunds off
  // orders; case events hang off cases; privacy requests name a wedding NO ACTION, so they go while it is
  // still there; tokens, outputs, publications and versions all name either the wedding or the version.
  //
  // The two support-case sweeps share ONE predicate rather than each stating its own, and that is the whole
  // repair of the crash the first executed run measured: `delete from private.support_cases` refused with
  // `support_case_events_case_id_fkey` on the wedding-less ticket C-01 opens, because §5 lets a case be
  // about an account (`wedding_id IS NULL`), so the child sweep's wedding-only filter left that thread in
  // place while the parent sweep still matched the row by ref. Two predicates that differ by one arm is
  // enough to break the order the list is supposed to guarantee.
  const caseMatch = `wedding_id in (${ids}) or case_ref in ('${caseRefs.join("','")}')`;
  for (const stmt of [
    // Group H's two ledger rows, by this run's own tag and nothing broader: the table is append-only for
    // every role including `postgres` on UPDATE, but its delete guard admits the trusted channel
    // (`20260925120000_stage2_privilege_baseline.sql:170-177`), which is how Stage 10's teardown already
    // removes its own deliveries. First in the list because `order_id` is SET NULL onto a row the sweep
    // below deletes.
    `delete from private.commerce_payment_events where event_id in ('${healthEvents.join("','")}')`,
    // `commerce_review_notes.case_ref` is a real FK onto `support_cases(case_ref)` with `ON DELETE NO
    // ACTION` (file 5:74), so it takes the same predicate the parent sweep uses, for the same reason.
    `delete from private.commerce_review_notes where case_ref in (select case_ref from private.support_cases
       where ${caseMatch}) or refund_id in (select id from private.commerce_refunds
       where order_id in (select id from private.commerce_orders where wedding_id in (${ids})))`,
    `delete from private.commerce_refunds where order_id in (select id from private.commerce_orders
       where wedding_id in (${ids}))`,
    `delete from private.commerce_orders where wedding_id in (${ids})`,
    `delete from public.rsvp_responses where wedding_id in (${ids})`,
    `delete from public.household_event_scopes where wedding_id in (${ids})`,
    `delete from private.support_case_events where case_id in (select id from private.support_cases
       where ${caseMatch})`,
    // by wedding and by the refs this run's own answers named: `wedding_id` is NO ACTION onto a row the
    // sweep below deletes, so a request on a wedding this file never registered — a probe fixture, a run
    // that died before recording one — would otherwise outlive the run and fail the residue cell.
    `delete from private.privacy_requests where wedding_id in (${ids}) or request_ref in `
      + `('${requestRefs.join("','")}')`,
    `delete from private.support_cases where ${caseMatch}`,
    `delete from private.access_tokens where wedding_id in (${ids})
       or publication_id in (select id from public.publications where wedding_id in (${ids}))`,
    // Two states own something, and the delete guard refuses them both (`guard_invitation_output_delete`,
    // stage9 migration :400-410). They are walked out through the lifecycle the guard itself allows, in the
    // same spelling the Stage 9 battery's own teardown uses: `ready` may only be invalidated, and
    // `uploading` has no edge to `invalidated` so it becomes a recorded failure and then an absent artefact.
    // Asking for the refusal anyway would make this run's cleanup the thing that fails.
    `update public.invitation_outputs set status = 'invalidated', invalidation_reason = 'asset_deleted'
       where wedding_id in (${ids}) and status = 'ready'`,
    `update public.invitation_outputs set status = 'failed', attempt_count = attempt_count + 1,
                last_error = 'teardown ended a run that was still uploading'
       where wedding_id in (${ids}) and status = 'uploading'`,
    `delete from public.invitation_outputs where wedding_id in (${ids})`,
    `delete from public.publications where wedding_id in (${ids})`,
    // The trail goes before the weddings and before the accounts, by the ids this run's own answers named
    // first: `wedding_id` is SET NULL, so a row that outlives this sweep would be unattributable. The
    // reason and actor predicates catch a row this file forgot, and each of the three would have been the
    // one that mattered on the night an earlier run died.
    `delete from private.audit_events where id in (${[...auditIds].join(',') || '0'})
       or wedding_id in (${ids}) or reason like '%${RUN_TAG}%'
       or actor_user_id in (select id from auth.users where email like '%${RUN_TAG}%')
       or subject_key in (select id from private.operator_grants where reason like '%${RUN_TAG}%')`,
    `delete from public.guest_households where wedding_id in (${ids})`,
    `delete from public.invitation_versions where wedding_id in (${ids})`,
    `delete from public.wedding_events where wedding_id in (${ids})`,
    `delete from public.invitation_drafts where wedding_id in (${ids})`,
    `delete from public.weddings where id in (${ids})`,
    `delete from private.operator_grants where reason like '%${RUN_TAG}%'`,
  ]) exec(stmt, `teardown of ${stmt.slice(0, 62)}`);

  // No case here deletes an account, but the accounts are GoTrue's and a run that died mid-teardown may
  // have removed some already, so ask the database which of this run's ids still exist: the loop skips
  // whatever is genuinely absent rather than taking a 404 as a teardown crash that hides the failure which
  // caused it. `auth.users` still returns to the count this run started on, because the residue cell reads
  // it either way.
  const uids = WHO.map((who) => uidOf(who)).filter(Boolean).map((id) => `'${id}'`).join(',');
  const stillThere = new Set(uids ? sqlRows(`select id::text from auth.users where id in (${uids})`) : []);
  for (const who of WHO) {
    const id = uidOf(who);
    if (!id || !stillThere.has(id)) continue;
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }

  const now = census();
  // The residue claim is a comparison, so it needs the other half. If `before()` died before taking a
  // baseline this run cannot say it left the stack as it found it, and says that out loud instead of
  // comparing the census to nothing — the cancelled cases already fail the file, so this only records.
  if (!baseline) {
    console.log('  RESIDUE EQUALITY NOT PROVED: before() died before taking a baseline census, so the '
      + 'numbers printed below are this run\'s ending state with nothing to compare them against.');
  } else {
    const moved = Object.keys(baseline).filter((k) => baseline[k] !== now[k]);
    assert.deepEqual(moved, [],
      `teardown did not give everything back: ${shown(moved.map((k) => `${k} ${baseline[k]}->${now[k]}`).join(', '))}`);
    for (const store of STAGE11_TABLES) {
      assert.equal(count(`from private.${store}`), baseline[store],
        `private.${store} did not come back to the count this run started on`);
    }
  }
  assert.equal(count(`from private.audit_events where id in (${[...auditIds].join(',') || '0'})`), '0',
    'a trail row this run recorded outlived the run');
  assert.equal(count(`from public.invitation_outputs where object_key in ('${plantedKeys.join("','")}')`), '0',
    'a manifest row this run planted outlived the run');
  assert.equal(count(`from storage.objects where bucket_id = '${OUTPUT_BUCKET}' and name in ('${plantedKeys.join("','")}')`), '0',
    'an object this run uploaded outlived the run');
  console.log(`  transport_retries=${transportRetries} (reads whose socket died before any response, and `
    + 'were sent a second time; 0 means no contention was met, not that the path is untested)');
  console.log('  residue census after the Stage 11 HTTP teardown (whole database):');
  for (const line of sqlRows(censusQuery)) console.log(shown(`    ${line}`));
});

// The console instrument, run as the shipped script against this stack. `spawnSync` rather than
// `execFileSync` because a refusal is a result: exit 2 is the database saying no, and catching it would
// throw away the measurement. Credentials reach it only through named environment variables, and both
// values are masked out of everything it prints, because the tool's own claim is that its output is safe
// to paste into an incident channel and that claim is what A-06 is testing.
const CLI = resolve(ROOT, 'scripts/stage11-operations-cli.mjs');
function runCli(label, argv, { account = null, secret = null } = {}) {
  const childEnv = { ...process.env };
  delete childEnv.S11_TEST_ACCOUNT;
  delete childEnv.S11_TEST_SECRET;
  if (account) {
    childEnv.S11_TEST_ACCOUNT = account;
    childEnv.S11_TEST_SECRET = secret;
  }
  const res = spawnSync(process.execPath, [CLI, ...argv], { cwd: ROOT, encoding: 'utf8', env: childEnv });
  // The raw bytes are kept as well as the masked view, because the claim under test is the tool's own: that
  // nothing it prints carries a secret. A masked copy cannot prove that — a run whose output *did* leak the
  // password would read back as `[REDACTED-CRED]`, and the assertion would be scoring the harness's own
  // scrubbing rather than the tool's. So the absence is checked against `rawStdout`/`rawStderr`, and only
  // the masked text is ever printed or put in a message.
  const rawStdout = String(res.stdout ?? '');
  const rawStderr = String(res.stderr ?? '');
  const mask = (text) => [account, secret].filter(Boolean)
    .reduce((t, value) => t.split(String(value)).join('[REDACTED-CRED]'), shown(text));
  const out = rawStdout.trim().split(/\r?\n/).filter((l) => l.length > 0).map(mask);
  const err = rawStderr.trim().split(/\r?\n/).filter((l) => l.length > 0).map(mask);
  return { exit: res.status, out, err, stdout: out.join('\n'), stderr: err.join('\n'), rawStdout, rawStderr };
}
/** The one JSON line a CLI answer hides in: the tool prints `<verb>: {…}` and then a run record. */
const cliJson = (run) => {
  const line = run.out.find((l) => /: \{/.test(l));
  assert.ok(line, `the console answer carried no JSON: ${json(run.out).slice(0, 300)}`);
  return JSON.parse(line.slice(line.indexOf(': {') + 2));
};
/** Whether this machine's `docker` can open a console at all. The console channel of §3's three bodies is
 *  the only channel they answer to, so if it is missing the case says so on the record rather than passing
 *  an arm it never reached. */
const dockerOk = () => spawnSync('docker', ['version'], { encoding: 'utf8' }).status === 0;

/** Who holds which of the four scopes, as `before()` minted them. A-03 needs an operator who holds a grant
 *  that is not the one the door asks for, and there is exactly one such shape per door. */
const SCOPE_HOLDERS = [['opSupport', 'support'], ['opSupport2', 'support'], ['opOps', 'operations'],
  ['opFinance', 'finance_review'], ['opPrivacy', 'privacy']];
const wrongScopeFor = (scope) => SCOPE_HOLDERS.find(([, s]) => s !== scope)[0];

/** Every trail row an answer names is recorded as this run's, because `after()` deletes the trail by id
 *  first and by every other predicate only as a backstop. */
function harvest(body) {
  if (body && typeof body.audit_id === 'number') auditIds.add(body.audit_id);
  return body;
}

/** What each door's `api` projection is built from, read off the `jsonb_build_object` in the migration body
 *  rather than from this file's wish — and now measured rather than remembered: the sweep at
 *  `q11-logs/s11-projection-derivation-sweep.cjs` (capture `s11-projection-derivation-7.txt`) finds all
 *  nineteen lists below inside the door's own body. Seventeen are one `RETURN jsonb_build_object(…)`; two —
 *  `operator_takedown_publication` and `operator_add_commerce_review_note` — are a join,
 *  `RETURN v_payload || jsonb_build_object('audit_id', …, 'replayed', …)`, with `v_payload` assigned the
 *  ten-key object earlier in the same body. The `api` wrapper builds nothing itself: all nineteen are
 *  `LANGUAGE sql SECURITY INVOKER` around one delegation, so the derivation follows that delegation into the
 *  `internal_api` body. A replayed delivery answers the same key set by a different route — its arm returns
 *  `v_seen.payload`, the audit row's stored copy of the object the first delivery built — which is why the
 *  replay arm below can be checked against this same list. A door that gains a column without this list
 *  gaining it fails here, which is the point: the surface these doors present is the contract §13 documents. */
const EXPECT_KEYS = {
  open_support_case: keySet('case_ref', 'wedding_id', 'category', 'severity', 'status', 'opened_at', 'replayed'),
  get_my_support_cases: keySet('cases', 'status_filter', 'limit'),
  get_my_support_case: keySet('case_ref', 'wedding_id', 'category', 'severity', 'status', 'resolution_code',
    'host_summary', 'opened_at', 'updated_at', 'resolved_at', 'reply_allowed', 'resume_expected', 'events'),
  reply_to_support_case: keySet('case_ref', 'status', 'seq', 'replayed'),
  create_privacy_request: keySet('request_ref', 'wedding_id', 'kind', 'status', 'requested_at', 'replayed'),
  get_my_privacy_requests: keySet('requests', 'count'),
  operator_case_queue: keySet('cases', 'status_filter', 'category_filter', 'limit'),
  get_operator_case: keySet('case_ref', 'wedding_id', 'category', 'severity', 'status', 'resolution_code',
    'host_summary', 'opened_at', 'updated_at', 'resolved_at', 'requester_user_id', 'opened_by_user_id',
    'assigned_operator_user_id', 'events'),
  operator_claim_case: keySet('case_ref', 'assigned_operator_user_id', 'seq', 'audit_id', 'replayed'),
  operator_release_case: keySet('case_ref', 'assigned_operator_user_id', 'seq', 'audit_id', 'replayed'),
  operator_transition_case: keySet('case_ref', 'from_status', 'to_status', 'seq', 'audit_id', 'replayed'),
  operator_add_case_note: keySet('case_ref', 'kind', 'seq', 'replayed'),
  operator_privacy_queue: keySet('requests', 'status_filter', 'count'),
  operator_advance_privacy_request: keySet('request_ref', 'from_status', 'to_status', 'audit_id', 'replayed'),
  operator_commerce_review_queue: keySet('refunds', 'count', 'status_filter', 'moves_money',
    'changes_entitlements'),
  operator_add_commerce_review_note: keySet('note_id', 'refund_id', 'order_id', 'wedding_id', 'case_ref',
    'kind', 'note_only', 'money_moved', 'entitlement_changed', 'refund_row_changed', 'audit_id', 'replayed'),
  operator_takedown_plan: keySet('wedding_id', 'publication_id', 'publication_status', 'version_id',
    'object_keys', 'count', 'deletes_anything'),
  operator_takedown_publication: keySet('wedding_id', 'case_ref', 'reason_category', 'publication_id',
    'version_id', 'credentials_revoked', 'outputs_invalidated',
    'file_links_still_valid_until_object_purge', 'objects_deleted_by_this_call', 'purge_function',
    'audit_id', 'replayed'),
  operator_operations_summary: keySet('as_of', 'from_inclusive', 'window_hours', 'blocks', 'block_count',
    'blocks_not_measured', 'writes_anything', 'identifiers_included'),
};

// --------------------------------------------------------------------------- the shared wire half
/** A wire expectation for the four groups after C. Group C carries its own local `wire` and was green
 *  before this existed, so it was left where it is rather than pulled out and re-measured. The mapping is
 *  the one C-09 re-confirmed on this stack: 23514 → 400 with the raw RAISE text, 42501 → 403, 23505 → 409. */
const httpWire = (status, code, ...sentence) => ({ status, code, sentence });

/** A door's answer checked against the key set transcribed from its own `jsonb_build_object`, which is the
 *  direction that catches a projection that grew a column without this file noticing. */
const projection = (name, body, what) => {
  assert.equal(keysOf(body), EXPECT_KEYS[name],
    `${what}: ${name}'s projection is not the key set its body builds: got ${json(keysOf(body))}, `
    + `expected ${JSON.stringify(EXPECT_KEYS[name])}`);
};

/** A refusal at one of the doors group C does not speak to, measured against the stores *that* door writes.
 *  `reads` arrives from the caller rather than living here because the four families move four different
 *  stores — a takedown a publication, a note a note row, an advance a request — and a helper that guessed
 *  which ones to count would quietly stop checking the ones it guessed wrong. A door that says no and
 *  writes anyway still answers 400 with the right sentence, so only these probes make a refusal a refusal. */
async function refusedDoor(name, args, as, want, what, reads = []) {
  const before = [];
  for (const probe of reads) before.push(await probe.get());
  const r = await rpc(name, args, { as });
  assert.equal(r.status, want.status, `${what} answered ${json(shape(r))}, not HTTP ${want.status}`);
  assert.equal(r.body?.code, want.code, `${what} answered code ${r.body?.code}, not ${want.code}: `
    + `${json(shape(r))}`);
  const message = String(r.body?.message ?? '');
  for (const part of want.sentence) {
    assert.ok(message.includes(part), `${what}: expected ${JSON.stringify(part)} in `
      + `${shown(message).slice(0, 240)}`);
  }
  for (const [i, probe] of reads.entries()) {
    assert.equal(String(await probe.get()), String(before[i]),
      `${what} was refused at ${name} and still moved ${probe.what}`);
  }
  return r;
}

describe('S11 A the authority matrix as the wire presents it', () => {
  // The five names §10 left on `api` for anonymous callers, read from the catalog in A-01's own control.
  const ANON_DOORS = ['resolve_family_review', 'resolve_guest_invitation', 'resolve_public_invitation',
    'submit_family_review', 'submit_guest_rsvp'];
  /** The two doors with no wall answer with a list rather than a refusal, and the two bodies name their
   *  array differently. One reader for both arms, so A-02 and A-03 cannot count different things. */
  const rowsOfList = (body) => (Array.isArray(body?.cases) ? body.cases
    : (Array.isArray(body?.requests) ? body.requests : []));

  test('A-01: none of the nineteen operational doors answers to the anonymous key, and the five that do answer', async () => {
    for (const [name, spec] of DOORS) {
      const r = await rpc(name, spec.args(), { as: 'anon' });
      assert.equal(r.status, 401, `anon on ${name} answered ${json(shape(r))}`);
      assert.equal(r.body?.code, '42501', `${name} as anon answered code ${r.body?.code}`);
      assert.match(String(r.body?.message ?? ''), new RegExp(`permission denied for function ${name}`),
        `${name} as anon answered with a message that does not name the function: ${shown(r.text).slice(0, 200)}`);
    }
    // The control that makes nineteen 401s a measurement rather than a tautology: the same request shape,
    // the same key, sent to a function the anonymous role *does* hold. A client whose call was malformed,
    // a stack whose schema cache was cold or a Kong that was refusing everything would answer 401 to all
    // twenty-four of the requests above, and only an arm that can produce a non-401 tells those apart.
    // The path below is syntactically real and belongs to no wedding, so the body runs and says "not
    // found" — which is the body speaking, not the gate.
    const control = await rpc('resolve_public_invitation', { p_path: '/i/0000000000000000000000000000000000000000000' }, { as: 'anon' });
    assert.notEqual(control.status, 401, `the anonymous control door answered 401, so nothing above is `
      + `evidence about grants: ${json(shape(control))}`);
    const anonHeld = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`);
    assert.deepEqual(anonHeld, ANON_DOORS,
      `the anonymous surface is not the five header-credential doors §10 states: ${json(anonHeld)}`);
    console.log(`  A-01  19 doors refused to anon, each ${json({ status: 401, code: '42501' })}; `
      + `the anonymous control answered ${json(shape(control))} and the catalog names `
      + `${anonHeld.length} anon-executable functions in api`);
  });

  test('A-02: a signed-in account with no grant meets each door\'s own sentence, and the two list doors simply have nothing to show', async () => {
    for (const [name, spec] of DOORS) {
      const r = await rpc(name, spec.args(), { as: 'stranger' });
      if (spec.refuse === null) {
        // `get_my_support_cases` and `get_my_privacy_requests` hold no wall: they read the caller's own
        // rows, and a caller with nothing of their own gets an empty list at 200. The claim worth making is
        // that the list is empty and that this run's SENTINEL never crosses into it — an authorisation that
        // leaks shows up as a row, not as a status code.
        assert.equal(r.status, 200, `${name} as a signed-in non-operator answered ${json(shape(r))}`);
        const text = JSON.stringify(r.body);
        assert.equal(text.includes(SENTINEL), false, `${name} carried the sentinel text belonging to `
          + 'another host\'s ticket');
        const rows = rowsOfList(r.body);
        assert.equal(rows.length, 0, `${name} showed a signed-in account with no wedding ${rows.length} `
          + `rows: ${shown(text).slice(0, 200)}`);
        console.log(`  A-02  ${name}: 200, zero rows, no sentinel`);
        continue;
      }
      assert.equal(r.status, 403, `${name} as a signed-in non-operator answered ${json(shape(r))}`);
      assert.equal(r.body?.code, '42501', `${name} answered code ${r.body?.code}, not the privilege state`);
      assert.ok(String(r.body?.message ?? '').includes(spec.refuse),
        `${name} answered ${shown(r.body?.message).slice(0, 200)}, which is not the door's own sentence `
        + `${JSON.stringify(spec.refuse)}`);
      console.log(`  A-02  ${name}: 403 42501 ${JSON.stringify(spec.refuse)}`);
    }
  });

  test('A-03: an operator holding a different scope meets the identical wall, and the two wall-less doors stay empty for them too', async () => {
    const sameSentence = [];
    const ownRowsOnly = [];
    for (const [name, spec] of DOORS) {
      const as = spec.scope ? wrongScopeFor(spec.scope) : 'opSupport';
      if (spec.refuse === null) {
        // The other half of the same question. These two doors have no wall, so a *granted* caller can walk
        // straight in — and the only thing that keeps another host's ticket out of the answer is the body's
        // own `WHERE requester = auth.uid()`-shaped predicate. A 403 here would be a different design; what
        // this asserts is that an operator reaches the door and is handed their own nothing.
        const r = await rpc(name, spec.args(), { as });
        assert.equal(r.status, 200, `${name} as the wrong-scope ${as} answered ${json(shape(r))}, and this `
          + 'door was written to answer, not to refuse');
        const text = JSON.stringify(r.body);
        assert.equal(rowsOfList(r.body).length, 0, `${name} showed the ${as} operator `
          + `${rowsOfList(r.body).length} row(s) that are not theirs: ${shown(text).slice(0, 200)}`);
        assert.equal(text.includes(SENTINEL), false, `${name} carried the sentinel text belonging to `
          + `another host's ticket to ${as}`);
        ownRowsOnly.push(name);
        continue;
      }
      const r = await rpc(name, spec.args(), { as });
      assert.equal(r.status, 403, `${name} for the wrong-scope ${as} answered ${json(shape(r))}`);
      assert.equal(r.body?.code, '42501', `${name} for ${as} answered code ${r.body?.code}`);
      // The byte-for-byte claim: the same caller type with a *different* grant answer than the caller with
      // no grant at all, or the message tells a probe which door exists.
      const noGrant = await rpc(name, spec.args(), { as: 'stranger' });
      assert.equal(String(r.body?.message), String(noGrant.body?.message),
        `${name}: the wrong-scope refusal is worded differently from the no-grant refusal, so the two are `
        + `distinguishable to a probe: ${shown(r.body?.message).slice(0, 160)} vs `
        + `${shown(noGrant.body?.message).slice(0, 160)}`);
      sameSentence.push(name);
    }
    assert.equal(sameSentence.length, 17, `only ${sameSentence.length} doors were compared for wording; `
      + 'the matrix has 17 doors with a wall (19 less the two list doors)');
    assert.deepEqual(ownRowsOnly.sort(), ['get_my_privacy_requests', 'get_my_support_cases'],
      `the wall-less arm ran over ${ownRowsOnly.length} door(s), not the two the matrix says have no wall: `
      + `${json(ownRowsOnly)}`);
    // And the shape that must never happen: an operator of another scope reading this run's own row.
    const otherScope = await rpc('operator_case_queue', { p_status: null, p_category: null, p_limit: null }, { as: 'opFinance' });
    assert.equal(otherScope.status, 403, `a finance operator read the case queue: ${json(shape(otherScope))}`);
    console.log(`  A-03  ${sameSentence.length} doors answered the wrong-scope caller with the byte-identical `
      + `sentence the no-grant caller got, and the ${ownRowsOnly.length} doors with no wall answered `
      + `${ownRowsOnly.map((n) => `${n}=200/0 rows`).join(' and ')}`);
  });

  test('A-04: each door opens for exactly the caller it is meant for, and the projection is the one the body builds', async () => {
    for (const [name, spec] of DOORS) {
      const r = await rpc(name, spec.ok.args(), { as: spec.ok.as });
      assert.equal(r.status, 200, `${name} for ${spec.ok.as} answered ${json(shape(r))}`);
      harvest(r.body);
      assert.equal(keysOf(r.body), EXPECT_KEYS[name], `${name}'s projection is not the key set the body `
        + `builds: got ${json(keysOf(r.body))}, expected ${JSON.stringify(EXPECT_KEYS[name])}`);
      if (typeof r.body?.replayed === 'boolean') {
        assert.equal(r.body.replayed, false, `${name} reported a replay for an idempotency key this run `
          + 'had never used');
      }
      console.log(`  A-04  ${name} → 200 for ${spec.ok.as}`
        + (typeof r.body?.replayed === 'boolean' ? ` (replayed=${r.body.replayed})` : ''));
    }
    // The four rows the queues must now contain, one per scope: a queue that opens but shows nothing is a
    // door that answers 200 over a broken filter, and the key-set check above cannot tell.
    const caseQueue = await rpc('operator_case_queue', { p_status: null, p_category: null, p_limit: 100 }, { as: 'opSupport' });
    assert.ok(caseQueue.body.cases.some((c) => c.case_ref === fixtures.caseProbe),
      'the case queue did not contain the ticket this run just claimed, released and triaged');
    assert.equal(keysOf(caseQueue.body.cases[0]), keySet('case_ref', 'wedding_id', 'requester_user_id',
      'category', 'severity', 'status', 'assigned_operator_user_id', 'host_summary', 'opened_at', 'updated_at'),
      `the queue's row projection is not the operator's own: ${json(keysOf(caseQueue.body.cases[0]))}`);
    const privacyQueue = await rpc('operator_privacy_queue', { p_status: null }, { as: 'opPrivacy' });
    assert.ok(privacyQueue.body.requests.some((q) => q.request_ref === fixtures.privacyProbe),
      'the privacy queue did not contain the request this run just advanced');
    assert.equal(keysOf(privacyQueue.body.requests[0]), keySet('request_ref', 'wedding_id', 'requester_user_id',
      'kind', 'status', 'host_note', 'operator_note', 'requested_at', 'updated_at'),
      `the privacy queue's row projection is not the desk's own: ${json(keysOf(privacyQueue.body.requests[0]))}`);
    const moneyQueue = await rpc('operator_commerce_review_queue', { p_status: null, p_limit: null }, { as: 'opFinance' });
    assert.ok(moneyQueue.body.refunds.some((f) => f.refund_id === moneyProbe.refundId),
      'the review queue did not contain the refund this run just annotated');
    assert.equal(keysOf(moneyQueue.body.refunds[0]), keySet('refund_id', 'kind', 'status', 'amount_minor',
      'currency', 'provider_refund_ref', 'recorded_at', 'completed_at', 'wedding_id', 'order', 'notes'),
      `the review queue's row projection is not the reviewer's own: ${json(keysOf(moneyQueue.body.refunds[0]))}`);
    const detail = await rpc('get_operator_case', { p_case_ref: fixtures.caseProbe }, { as: 'opSupport' });
    assert.ok(Array.isArray(detail.body.events) && detail.body.events.length > 0,
      `the operator's case read returned no thread for a case that has been claimed, released and triaged: `
      + `${json(detail.body)}`);
    console.log(`  A-04  queues: ${caseQueue.body.cases.length} cases, ${privacyQueue.body.requests.length} `
      + `privacy requests, ${moneyQueue.body.refunds.length} refunds; the probe's thread has `
      + `${detail.body.events.length} rows`);
  });

  test('A-05: the three bodies with no door stay unreachable in every spelling a client can try', async () => {
    for (const name of DOORLESS) {
      // Spelling 1 — the schema a client is allowed to ask for. The body is not in `api`, so PostgREST
      // cannot find it: the refusal is the router's, and it is the same answer for every credential shape.
      for (const as of ['anon', 'opOps', 'service']) {
        const r = await rpc(name, doorlessArgs(name), { as, profile: 'api' });
        assert.equal(r.status, 404, `${name} over the api profile as ${as} answered ${json(shape(r))}`);
        assert.equal(r.body?.code, 'PGRST202', `${name} over api as ${as} answered ${r.body?.code}, not `
          + 'the "not in this schema" code');
        assert.ok(String(r.body?.message ?? '').includes(`api.${name}`),
          `${name} over api as ${as} did not name the exposed schema it was looked up in: ${json(shape(r))}`);
      }
      // Spellings 2 to 5 — pointing the router at the unexposed schema directly. Measured on this stack
      // (PostgREST 16.4, read off its own root document; q11-logs/s11-probe-a05-profile.txt, re-measured by
      // the first run of this case), and the two headers do not behave alike. `Content-Profile` chooses the
      // schema, and an unexposed one is refused *before any function lookup happens*: the answer is exactly
      // `Invalid schema: <word>` and never contains the function name, which is why the same shape comes
      // back for `internal_api` and for an invented `nosuchschema` — the refusal says nothing about whether
      // the body exists. `Accept: …; profile=` is ignored for the RPC lookup, so the call is resolved in the
      // default schema and answered 404 PGRST202 naming `public.<name>` — there the name does appear,
      // because a lookup genuinely ran and did not find it.
      // `profile: null` because `rpc()` otherwise writes Content-Profile itself and would silently
      // overwrite the header under test — the first run of this case measured exactly that substitution.
      const profileArms = [
        { label: 'Content-Profile: internal_api', headers: { 'Content-Profile': 'internal_api' },
          status: 406, code: 'PGRST106', schema: 'internal_api', lookedUp: false },
        { label: 'Content-Profile: nosuchschema (control)', headers: { 'Content-Profile': 'nosuchschema' },
          status: 406, code: 'PGRST106', schema: 'nosuchschema', lookedUp: false },
        { label: 'Accept profile=internal_api', headers: { Accept: 'application/json; profile=internal_api' },
          status: 404, code: 'PGRST202', schema: 'public', lookedUp: true },
        { label: 'Accept profile=nosuchschema (control)',
          headers: { Accept: 'application/json; profile=nosuchschema' },
          status: 404, code: 'PGRST202', schema: 'public', lookedUp: true },
      ];
      const schemaRefusals = [];
      for (const arm of profileArms) {
        const r = await rpc(name, doorlessArgs(name), { as: 'opOps', headers: arm.headers, profile: null });
        assert.equal(r.status, arm.status, `${name} with ${arm.label} answered ${json(shape(r))}`);
        assert.equal(r.body?.code, arm.code, `${name} with ${arm.label} answered ${r.body?.code}, `
          + `not ${arm.code}`);
        const message = String(r.body?.message ?? '');
        if (arm.lookedUp) {
          assert.ok(message.includes(`${arm.schema}.${name}`),
            `${name} with ${arm.label} answered ${json(shape(r))} instead of naming ${arm.schema}.${name}, `
            + 'so the lookup did not go where this case claims it went');
        } else {
          assert.equal(message, `Invalid schema: ${arm.schema}`,
            `${name} with ${arm.label} answered ${json(shape(r))}, which is not the schema refusal this `
            + 'stack was measured giving an unexposed schema');
          // The existence claim, stated as the negative it is: a message that named the body would tell an
          // caller which doorless names are real, and this arm is the one that proves it does not.
          assert.equal(message.includes(name), false,
            `${name} with ${arm.label} named the body in its refusal, so the router answered the lookup and `
            + `not the schema: ${json(shape(r))}`);
          schemaRefusals.push(message.replace(arm.schema, '<schema>'));
        }
        // A refusal that only says "wrong number of arguments" would not be a reachability answer at all.
        assert.equal(message.includes('without parameters'), false,
          `${name} with ${arm.label} was refused for its arity, not its schema: ${json(shape(r))}`);
      }
      assert.equal(new Set(schemaRefusals).size, 1,
        `the unexposed schema and the invented one were refused in different words, so the answer does carry `
        + `information about which schema this build hides: ${json(schemaRefusals)}`);
    }
    // The catalog half of the same claim, which no HTTP answer can make: the bodies have no EXECUTE for any
    // role a request may arrive as, so even a router pointed at the schema would meet Postgres first.
    // `has_function_privilege` rather than `aclexplode(p.proacl)`, because a function with the default ACL
    // has a NULL `proacl` and an empty `aclexplode` — the shape that *grants* to PUBLIC would read as the
    // shape that grants to nobody, and this assertion's whole job is to tell those two apart.
    const held = sqlRows(`select p.proname || ' ' || r.rolname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
      where n.nspname = 'internal_api' and p.proname in ('${DOORLESS.join("','")}')
        and has_function_privilege(r.rolname, p.oid, 'EXECUTE') order by 1`);
    assert.deepEqual(held, [], `a role a request can arrive as holds EXECUTE on a doorless body: ${json(held)}`);
    console.log(`  A-05  each of the ${DOORLESS.length} doorless bodies: 3 credentials over the api profile `
      + 'answered 404 PGRST202 naming api.<name>; both Content-Profile arms answered 406 PGRST106 "Invalid '
      + 'schema: <word>" without naming the body (real and invented schema word alike); both Accept-profile '
      + 'arms were ignored and answered 404 PGRST202 naming public.<name>; the catalog gives them '
      + `${held.length} client-facing EXECUTE grants`);
  });

  test('A-06: the five stores no client may read are unreachable in every credential shape, and the instrument can say reachable', async () => {
    for (const store of STAGE11_TABLES) {
      for (const as of ['anon', 'stranger', 'service']) {
        const r = await call('GET', `/rest/v1/${store}?select=*&limit=1`,
          { bearer: as === 'anon' ? anonKey : as === 'service' ? serviceKey : tokenOf(as) });
        assert.equal(r.status, 404, `GET /${store} as ${as} answered ${json(shape(r))}`);
        assert.equal(r.body?.code, 'PGRST205', `GET /${store} as ${as} answered ${r.body?.code}, not the `
          + '"relation is not in the schema cache" code');
      }
      // The same read against a store the router *does* expose, from the same client, in the same shape:
      // without it, five 404s would be indistinguishable from a router that 404s everything.
      const reachable = await call('GET', `/rest/v1/weddings?select=id&limit=1`,
        { bearer: tokenOf('hostProbe') });
      assert.equal(reachable.status, 200, `the presence control could not read an exposed table: `
        + `${json(shape(reachable))}`);
    }
    // And the rows are not reachable *through* anything else either: the doors are the only path, and the
    // grant posture was already proved in `before()` from the catalog.
    const grantRows = sqlRows(`select table_name || ' ' || grantee || ':' || privilege_type
      from information_schema.role_table_grants where table_schema = 'private'
        and table_name in ('${STAGE11_TABLES.join("','")}')
        and grantee in ('anon','authenticated','service_role') order by 1`);
    assert.deepEqual(grantRows, [], `a client role holds a table grant on a Stage 11 store: ${json(grantRows)}`);
    console.log(`  A-06  ${STAGE11_TABLES.length} stores × 3 credentials refused with PGRST205 while the `
      + 'exposed table answered 200 for the same client; 0 client table grants exist on them');
  });

  test('A-07: the shipped console instrument runs against this stack on both of its channels, and its output carries no credential', async () => {
    // The operator channel: the tool signs in as a human and calls the doors over REST, which is the whole
    // reason §3's doors exist. Read-only verbs, so this arm proves the wiring without writing.
    const creds = { account: emailFor('opOps'), secret: PASSWORD };
    const health = runCli('health over the operator channel',
      ['health', '--window', '24', '--account-env', 'S11_TEST_ACCOUNT', '--secret-env', 'S11_TEST_SECRET'], creds);
    assert.equal(health.exit, 0, `the instrument's health verb exited ${health.exit}: ${json(health.err)}`);
    const healthBody = cliJson(health);
    assert.equal(keysOf(healthBody), EXPECT_KEYS.operator_operations_summary,
      `the instrument's health output is not the door's projection: ${json(keysOf(healthBody))}`);
    const caseQueue = runCli('case-queue over the operator channel',
      ['case-queue', '--limit', '5', '--account-env', 'S11_TEST_ACCOUNT', '--secret-env', 'S11_TEST_SECRET'],
      { account: emailFor('opSupport'), secret: PASSWORD });
    assert.equal(caseQueue.exit, 0, `the instrument's case-queue verb exited ${caseQueue.exit}: `
      + `${json(caseQueue.err)}`);
    for (const run of [health, caseQueue]) {
      assert.equal(run.rawStdout.includes(PASSWORD), false, 'the instrument printed the account password on '
        + 'stdout, which contradicts the claim its header makes about pasting its output anywhere');
      assert.equal(run.rawStderr.includes(PASSWORD), false, 'the instrument printed the account password on '
        + 'stderr');
      assert.equal(run.rawStdout.includes(serviceKey), false, 'the instrument printed the service key');
      assert.equal(run.rawStderr.includes(serviceKey), false, 'the instrument printed the service key');
      assert.equal(run.rawStdout.includes(emailFor('opOps')), false, 'the instrument printed the account '
        + 'address it signed in with');
    }
    if (!dockerOk()) {
      console.log('  A-07  CONSOLE CHANNEL NOT REACHED: this machine has no usable `docker`, so the two '
        + 'arms below did not run and the console half of §3 is unproved by this run');
    } else {
      // The console channel, which is the only channel the doorless bodies answer to. A plan, not a write:
      // the probe wedding was taken down by A-04, so this is a purge plan with real keys behind it, and
      // `--dry-run` means the bytes are still in the bucket when the case finishes. The claim is measured,
      // not read off the flag: the two counts are taken on either side of the run and must not move.
      const objectsBefore = count(`from storage.objects where bucket_id = '${OUTPUT_BUCKET}'`);
      const manifestBefore = count(`from public.invitation_outputs `
        + `where wedding_id = '${fixtures.probeWedding}'::uuid`);
      const plan = runCli('purge plan over the console channel',
        ['purge', '--case', fixtures.caseTakedown, '--actor', uidOf('opOps'),
          '--via-docker', DB_CONTAINER, '--dry-run']);
      assert.equal(plan.exit, 0, `the console purge plan exited ${plan.exit}: ${json(plan.err)}`);
      // The tool's own record line (cli.mjs:1035-1049): `{verb, channel, mutating, executed, exit}`. There
      // is no `deletes_anything` key to read, so the proof is `executed:false` plus the plan-only heading
      // plus the two counts below — the flag is not evidence, the state is.
      const record = cliJson(plan);
      assert.deepEqual(keysOf(record), keySet('verb', 'channel', 'mutating', 'executed', 'exit'),
        `the console run record is not the shape the tool prints: ${json(keysOf(record))}`);
      assert.equal(record.verb, 'purge', `the run record names ${record.verb}`);
      assert.equal(record.channel, 'psql', `the purge plan ran on the ${record.channel} channel`);
      assert.equal(record.executed, false, `a --dry-run purge plan executed something: ${json(record)}`);
      assert.equal(record.exit, 0, `the plan's own record reported exit ${record.exit}: ${json(plan.out)}`);
      assert.ok(plan.out.some((line) => line.startsWith('purge: plan only')),
        `the plan arm printed no plan-only heading: ${json(plan.out).slice(0, 300)}`);
      assert.equal(count(`from storage.objects where bucket_id = '${OUTPUT_BUCKET}'`), objectsBefore,
        'a --dry-run purge plan removed bytes from the bucket');
      assert.equal(count(`from public.invitation_outputs where wedding_id = '${fixtures.probeWedding}'::uuid`),
        manifestBefore, 'a --dry-run purge plan removed manifest rows');
      // Two refusals on the console channel, and they come from different layers, so they are asserted
      // apart. The first is the tool's own input check: `stage11-operations-cli.mjs:792-800` stops an
      // unknown scope word while it is still building the plan, so nothing is sent and the database never
      // speaks. The a4 run asserted the *body's* sentence here and measured the tool's instead — which is is
      // also how the tool's old claim that "the body would answer the same sentence" was found to be false
      // (authority:429 says `unknown operator scope %: the four duties are …`, in different words), so the
      // tool now claims only its own check and this arm asserts that shape.
      const badGrant = runCli('grant with an unknown scope over the console channel',
        ['grant', '--user', uidOf('opConsole'), '--scope', 'nosuchscope', '--reason',
          `${RUN_TAG} A-07 local scope check`, '--actor', uidOf('decider'), '--yes',
          '--via-docker', DB_CONTAINER]);
      assert.equal(badGrant.exit, 2, `the console grant with an unknown scope exited ${badGrant.exit}: `
        + `${json(badGrant.err)}`);
      const localRefusal = [...badGrant.out, ...badGrant.err].join('\n');
      assert.ok(localRefusal.includes('is not one of the 4 operatorScope words'),
        `the unknown-scope refusal did not carry the tool's own sentence: ${shown(localRefusal).slice(0, 300)}`);
      assert.equal(localRefusal.includes('the database refused this'), false,
        'the unknown-scope refusal was reported as the database\'s answer, so this arm did reach the server '
        + `and does not measure the pre-call check it claims: ${shown(localRefusal).slice(0, 300)}`);
      // And the divergence itself, pinned: the body's own words for the same input are `unknown operator
      // scope …` (authority:429, 535). If a later edit makes the two sentences identical this arm stops
      // passing, which is the moment to re-read which layer answered — that question is what the a4 run
      // spent a failed case on.
      assert.equal(localRefusal.includes(SAY.grantUnknownScope), false,
        'the tool\'s pre-call check now quotes the body\'s sentence, so this arm can no longer tell the two '
        + 'layers apart');
      assert.equal(count(`from private.operator_grants where reason like '%${RUN_TAG} A-07 local scope `
        + `check%'`), '0', 'the refused grant still wrote a row');

      // The second refusal is one only the database can make: every input is well-formed, and the verdict
      // turns on whether the named account exists. `--yes` is present because a refusal that never reached
      // the server would prove nothing about the channel; this is the arm that proves the channel opens a
      // session, calls the body, and carries its SQLSTATE and its sentence back.
      const NIL_UUID = '00000000-0000-0000-0000-000000000000';
      assert.equal(count(`from auth.users where id = '${NIL_UUID}'::uuid`), '0',
        'the nil uuid names a real account on this stack, so the refusal below would not be about a missing '
        + 'account');
      const ghostGrant = runCli('grant to an account that does not exist, over the console channel',
        ['grant', '--user', NIL_UUID, '--scope', 'support', '--reason',
          `${RUN_TAG} A-07 database refusal arm`, '--actor', uidOf('decider'), '--yes',
          '--via-docker', DB_CONTAINER]);
      assert.equal(ghostGrant.exit, 2, `the console grant to the nil uuid exited ${ghostGrant.exit}: `
        + `${json(ghostGrant.err)}`);
      const dbRefusal = [...ghostGrant.out, ...ghostGrant.err].join('\n');
      assert.ok(dbRefusal.includes('the database refused this grant (SQLSTATE P0001)'),
        `the console channel did not report the body's refusal with its SQLSTATE: `
        + `${shown(dbRefusal).slice(0, 300)}`);
      assert.ok(dbRefusal.includes(SAY.grantNoAccount),
        `the console refusal did not carry the database's own sentence: ${shown(dbRefusal).slice(0, 300)}`);
      assert.equal(count(`from private.operator_grants where reason like '%${RUN_TAG} A-07 database `
        + `refusal arm%'`), '0', 'the refused grant still wrote a row');
      console.log(`  A-07  operator channel: health+case-queue exit 0, no credential in either stream; `
        + `console channel: purge plan record ${json(record)} with the bucket holding ${objectsBefore} `
        + `objects before and after it; local scope check exit ${badGrant.exit}; database refusal exit `
        + `${ghostGrant.exit} carrying P0001 and the body's sentence`);
    }
  });
});

// =========================================================================== C
// A ticket is one row and two screens. §5's privacy claim is not "the host cannot see the internal arm" as
// a policy note — it is a WHERE clause in `get_my_support_case` (`:729`, `kind IN ('message_host','status')`)
// and the absence of a column from a projection, and both are only true on the wire, because the SQL tier
// has no caller whose identity could be filtered on. Group C therefore reads the same ticket twice, from
// both sides, and asserts what each side is shown. The lifecycle refusals are asserted through the door
// rather than as hand-written UPDATEs because a stale operator tab is the failure the design was written
// against, and only the door has one.
//
// What the keys do is C-09's subject and it is the case that was least predictable: the bodies pre-read the
// key *within one case*, so the same key spent on a second case is not caught by the body at all, and the
// only thing standing between that call and two decisions recorded under one key is slice 1's unique index.
// This group measures both halves — the refusal, and that the transaction it aborted left nothing behind.
describe('S11 C a support ticket as two parties read it', () => {
  /** Every idempotency key this group spends, kept by name so a later case can reuse one on purpose. */
  const spent = {};
  /** The two needles: one written on the arm a host may read, one on the arm they may not. Neither belongs
   *  in the audit trail, and the one that the trail must never carry is the one the thread must show. */
  const NEEDLE_HOST = `host-visible-${RUN_TAG}`;
  const NEEDLE_INTERNAL = `internal-only-${RUN_TAG}`;

  /** A refusal as the wire presents it: PostgREST's status for the SQLSTATE, its code verbatim, and the
   *  body's own sentence. Measured on this stack in group A and in Stage 7's suite — a `check_violation`
   *  arrives as 400 with code `23514` and the raw RAISE text, and `insufficient_privilege` as 403 with
   *  `42501`; nothing here is a guess about the mapping. */
  const wire = (status, code, ...sentence) => ({ status, code, sentence });
  async function refusedRpc(name, args, as, want, what) {
    const before = count('from private.support_cases', 'the case count');
    const eventsBefore = count('from private.support_case_events', 'the thread count');
    const r = await rpc(name, args, { as });
    assert.equal(r.status, want.status, `${what} answered ${json(shape(r))}, not HTTP ${want.status}`);
    assert.equal(r.body?.code, want.code, `${what} answered code ${r.body?.code}, not ${want.code}: `
      + `${json(shape(r))}`);
    const message = String(r.body?.message ?? '');
    for (const part of want.sentence) {
      assert.ok(message.includes(part), `${what}: expected ${JSON.stringify(part)} in `
        + `${shown(message).slice(0, 240)}`);
    }
    // The half that makes a refusal a refusal: nothing was written. A door that says no and appends anyway
    // would still answer 400 here, and only these two counts notice.
    assert.equal(count('from private.support_cases', 'the case count after ' + what), before,
      `${what} was refused and still opened a ticket`);
    assert.equal(count('from private.support_case_events', 'the thread count after ' + what), eventsBefore,
      `${what} was refused and still appended to a thread`);
    return r;
  }
  const caseIdOf = (ref) => cell(`select id::text from private.support_cases where case_ref = '${ref}'`,
    `the row id for ${ref}`);
  /** The case's row, as the table holds it — for the claims a projection cannot make because it is the
   *  projection that is under test. */
  const caseState = (ref) => cell(`
    select 'status=' || status || ' assignee=' || coalesce(assigned_operator_user_id::text, '-')
      || ' resolution=' || coalesce(resolution_code, '-') || ' resolved_at=' || (resolved_at is not null)::text
      || ' summary_len=' || length(host_summary)::text || ' opened=' || opened_at::text
    from private.support_cases where case_ref = '${ref}'`, `the row state for ${ref}`);
  /** The thread as the table holds it, including the column neither read surface shows. */
  const threadRows = (ref) => sqlRows(`
    select e.seq::text || ' ' || e.kind || ' ' || e.actor_kind || ' key=' || (e.idempotency_key is not null)::text
      || ' ' || coalesce(e.from_status, '-') || '>' || coalesce(e.to_status, '-')
      || ' body=' || coalesce(left(e.body, 40), '-')
    from private.support_case_events e
    join private.support_cases c on c.id = e.case_id
    where c.case_ref = '${ref}' order by e.seq`).map((line) => line.replace(/body=.*/, ''));
  const trailFor = (ref) => sqlRows(`
    select a.id::text || ' ' || a.action || ' ' || a.actor_kind || ' '
      || coalesce(a.actor_user_id::text, '-') || ' wedding=' || coalesce(a.wedding_id::text, '-')
    from private.audit_events a
    join private.support_cases c on c.id::text = a.subject_key::text
    where c.case_ref = '${ref}' and a.subject_type = 'support_case' order by a.id`);
  /** One column of the case's row, as the table holds it. A NULL reads back as `<null>` because `-tA`
   *  prints an empty line for it and `sqlRows` drops empty lines, which would otherwise look like a
   *  missing row rather than a null column. */
  const col = (ref, expr) => cell(`select coalesce((${expr})::text, '<null>') from private.support_cases `
    + `where case_ref = '${ref}'`, `the ${expr} of ${ref}`);
  /** One arm of one thread, counted. */
  const armCount = (ref, kind) => cell(`
    select count(*)::text from private.support_case_events e
    join private.support_cases c on c.id = e.case_id
    where c.case_ref = '${ref}' and e.kind = '${kind}'`, `the ${kind} rows on ${ref}`);
  /** How many rows of one thread carry a key — the "one call, one primary row" half of §4's decision 4. */
  const keyedCount = (ref) => cell(`
    select count(*)::text from private.support_case_events e
    join private.support_cases c on c.id = e.case_id
    where c.case_ref = '${ref}' and e.idempotency_key is not null`, `the keyed rows on ${ref}`);
  /** One whole trail row's JSON, read as text so a needle test can run against every column at once. */
  const trailText = (ref) => cell(`
    select coalesce(string_agg(a.action || ' ' || coalesce(a.reason, '') || ' '
      || coalesce(a.payload::text, '') || ' ' || coalesce(a.before_state::text, '')
      || ' ' || coalesce(a.after_state::text, ''), ' | '), '<none>')
    from private.audit_events a
    join private.support_cases c on c.id::text = a.subject_key::text
    where c.case_ref = '${ref}' and a.subject_type = 'support_case'`, `the trail text of ${ref}`);
  /** A ticket this group needs for itself, opened by its own host and registered for the teardown. */
  const newCase = (label, who = 'hostA') => openCase(who, weddingOf(who),
    { category: 'other', summary: `${label} (${RUN_TAG})` });
  /** An operator's transition, asserted as accepted. Every legal edge in this group is walked through the
   *  door rather than by hand, because the door is what a stale operator tab reaches and the hand-written
   *  UPDATE is what the guard is for — and both are tested, this one here and the guard's in the SQL tier. */
  async function toStatus(ref, to, { code = null, body = null, as = 'opSupport',
    key = randomUUID() } = {}) {
    const r = await rpc('operator_transition_case', { p_case_ref: ref, p_to_status: to,
      p_resolution_code: code, p_body: body, p_idempotency_key: key }, { as });
    assert.equal(r.status, 200, `the walk to ${to} on ${ref} answered ${json(shape(r))}`);
    assert.equal(r.body.replayed, false, `the first delivery of a fresh key to ${to} called itself a replay`);
    assert.equal(r.body.to_status, to, `the walk to ${to} on ${ref} answered ${r.body.to_status}`);
    harvest(r.body);
    return r.body;
  }

  test('C-01: a host opens a ticket, a double click opens one ticket, and a key belongs to the account that sent it', async () => {
    const key = randomUUID();
    const first = await rpc('open_support_case', { p_wedding_id: weddingOf('hostA'), p_category: 'other',
      p_severity: 'normal', p_summary: `C-01's own ticket (${RUN_TAG})`, p_idempotency_key: key },
    { as: 'hostA' });
    assert.equal(first.status, 200, `C-01 open answered ${json(shape(first))}`);
    caseRefs.push(first.body.case_ref);
    fixtures.c01Open = first.body.case_ref;
    assert.equal(first.body.replayed, false, 'the first delivery of a fresh key called itself a replay');
    assert.equal(keysOf(first.body), EXPECT_KEYS.open_support_case,
      `the intake projection is not the body's: ${json(keysOf(first.body))}`);
    spent.openOnA = key;

    // The double click: same account, same key, same body — the ticket it made the first time, and the
    // `opened_at` it was born with, not a new timestamp pretending to be the same answer.
    const again = await rpc('open_support_case', { p_wedding_id: weddingOf('hostA'), p_category: 'other',
      p_severity: 'normal', p_summary: `C-01's own ticket (${RUN_TAG})`, p_idempotency_key: key },
    { as: 'hostA' });
    assert.equal(again.status, 200, `the replay answered ${json(shape(again))}`);
    assert.equal(again.body.replayed, true, 'a resubmitted key was answered as a new ticket');
    assert.equal(again.body.case_ref, first.body.case_ref, 'the replay returned a different ticket');
    assert.equal(again.body.opened_at, first.body.opened_at, 'the replay returned a fresh opened_at, so '
      + 'it described a row that does not exist');

    // The hostile half, which is the one that was a bug: the *same key* sent by a different account must
    // open that account's own ticket rather than handing back somebody else's. The `requester_user_id` term
    // in the replay probe (cases:569) is what this arm exists to keep in the body.
    const other = await rpc('open_support_case', { p_wedding_id: weddingOf('hostB'), p_category: 'other',
      p_severity: 'low', p_summary: `C-01's second host (${RUN_TAG})`, p_idempotency_key: key },
    { as: 'hostB' });
    assert.equal(other.status, 200, `a second host reusing a key answered ${json(shape(other))}`);
    caseRefs.push(other.body.case_ref);
    assert.equal(other.body.replayed, false, 'another account was answered with somebody else\'s ticket');
    assert.notEqual(other.body.case_ref, first.body.case_ref, 'two accounts share a ticket ref');
    assert.equal(other.body.wedding_id, weddingOf('hostB'),
      `the second host's answer names ${other.body.wedding_id}, not its own wedding`);

    // A ticket about an account rather than a wedding — the only way `wedding_id` is NULL, and the shape a
    // teardown must not lose track of, because no wedding sweep reaches it.
    const accountOnly = await rpc('open_support_case', { p_wedding_id: null, p_category: 'other',
      p_severity: 'normal', p_summary: `C-01's wedding-less ticket (${RUN_TAG})`,
      p_idempotency_key: randomUUID() }, { as: 'hostA' });
    assert.equal(accountOnly.status, 200, `a wedding-less ticket was refused: ${json(shape(accountOnly))}`);
    caseRefs.push(accountOnly.body.case_ref);
    assert.equal(accountOnly.body.wedding_id, null, 'the nullable column came back non-null');
    fixtures.accountOnlyCase = accountOnly.body.case_ref;

    // The input rules, each in the door's own words, and each with the two counts above it unchanged.
    const base = { p_wedding_id: weddingOf('hostA'), p_category: 'other', p_severity: 'normal',
      p_summary: `C-01 rules (${RUN_TAG})` };
    await refusedRpc('open_support_case', { ...base, p_idempotency_key: null }, 'hostA',
      wire(400, '23514', SAY.openKey), 'C-01 with no idempotency key');
    await refusedRpc('open_support_case', { ...base, p_category: 'urgent_sounding',
      p_idempotency_key: randomUUID() }, 'hostA',
      wire(400, '23514', SAY.category, 'the seven are'), 'C-01 with an unknown category');
    await refusedRpc('open_support_case', { ...base, p_severity: 'urgent',
      p_idempotency_key: randomUUID() }, 'hostA',
      wire(400, '23514', SAY.severity, 'the four are low'), 'C-01 with an unknown severity');
    await refusedRpc('open_support_case', { ...base, p_summary: '   ', p_idempotency_key: randomUUID() },
      'hostA', wire(400, '23514', SAY.summaryNeeded), 'C-01 with a blank summary');
    await refusedRpc('open_support_case', { ...base, p_summary: 'x'.repeat(2001),
      p_idempotency_key: randomUUID() }, 'hostA',
      wire(400, '23514', SAY.summaryBound, 'got 2001'), 'C-01 with a summary one character too long');
    // The bound itself is inclusive: 2000 is a summary the table can hold.
    const atBound = await rpc('open_support_case', { ...base, p_summary: 'y'.repeat(2000),
      p_idempotency_key: randomUUID() }, { as: 'hostA' });
    assert.equal(atBound.status, 200, `a 2000-character summary was refused: ${json(shape(atBound))}`);
    caseRefs.push(atBound.body.case_ref);
    assert.equal(cell(`select length(host_summary)::text from private.support_cases where case_ref `
      + `= '${atBound.body.case_ref}'`, 'the stored summary length'), '2000',
      'the accepted summary was not stored whole');

    console.log(`  C-01  one key opened ${first.body.case_ref} for hostA and answered itself with the same `
      + `ref and opened_at on replay; hostB's copy of that key opened its own ${other.body.case_ref} on its `
      + `own wedding; a wedding-less ticket opened ${accountOnly.body.case_ref}; ${5} input rules refused `
      + 'with 23514 and wrote nothing; a 2000-character summary was stored whole');
  });

  test('C-02: the operator queue and the host list are different surfaces, and the filters are refused rather than answered empty', async () => {
    const queue = await rpc('operator_case_queue', { p_status: null, p_category: null, p_limit: 100 },
      { as: 'opSupport' });
    assert.equal(queue.status, 200, `the queue answered ${json(shape(queue))}`);
    assert.ok(queue.body.cases.length >= 6, `the queue holds ${queue.body.cases.length} rows after this run `
      + 'opened at least six tickets, so the read is filtered by something nobody asked for');
    // Oldest first (queue) against newest first (host list) — the two orders are stated in the bodies and
    // are what an operator and a host each mean by "my list".
    const opened = queue.body.cases.map((c) => Date.parse(c.opened_at));
    assert.deepEqual(opened, [...opened].sort((x, y) => x - y),
      'the operator queue is not oldest first, so a neglected ticket is not at the top of it');
    const mine = await rpc('get_my_support_cases', { p_status: null, p_limit: 100 }, { as: 'hostA' });
    assert.equal(mine.status, 200, `the host list answered ${json(shape(mine))}`);
    const mineTimes = mine.body.cases.map((c) => Date.parse(c.opened_at));
    assert.deepEqual(mineTimes, [...mineTimes].sort((x, y) => y - x),
      "the host's own list is not newest first");
    assert.ok(mineTimes.length >= 2, `hostA has ${mineTimes.length} tickets after C-01 opened four of them`);

    // The privacy boundary stated as a projection: the queue names the requester and the assignee, the
    // host's list has no such column to leak, and the host's thread read has no actor column either (C-03).
    assert.equal(keysOf(queue.body.cases[0]), keySet('case_ref', 'wedding_id', 'requester_user_id',
      'category', 'severity', 'status', 'assigned_operator_user_id', 'host_summary', 'opened_at', 'updated_at'),
      `the queue row is not the operator's projection: ${json(keysOf(queue.body.cases[0]))}`);
    assert.equal(keysOf(mine.body.cases[0]), keySet('case_ref', 'wedding_id', 'category', 'severity',
      'status', 'resolution_code', 'host_summary', 'opened_at', 'updated_at', 'resolved_at'),
      `the host row is not the host's projection: ${json(keysOf(mine.body.cases[0]))}`);
    const mineRefs = mine.body.cases.map((c) => c.case_ref);
    assert.ok(mineRefs.includes(fixtures.caseA), "the host's list does not contain their own ticket");
    assert.equal(mineRefs.includes(fixtures.caseB), false,
      "the host's list contains another host's ticket");
    // The pair that makes the absence a measurement: this run planted its SENTINEL inside hostA's summary,
    // an operator reading the whole queue is entitled to see it, and hostB reading their own list must not.
    assert.ok(queue.body.cases.some((c) => c.case_ref === fixtures.caseA
      && String(c.host_summary).includes(SENTINEL)),
      'the operator queue did not carry the sentinel summary, so C-02 has nothing to compare against');
    const bList = await rpc('get_my_support_cases', { p_status: null, p_limit: 100 }, { as: 'hostB' });
    assert.equal(JSON.stringify(bList.body).includes(SENTINEL), false,
      "another host's list carried hostA's summary text");
    // Every row on a host's own list is theirs — the filter is `requester_user_id`, so a null-wedding
    // ticket still belongs to the account that filed it.
    const ownerOf = new Set(mine.body.cases.map((c) => c.case_ref));
    assert.equal([...ownerOf].some((ref) => !caseRefs.includes(ref) && ref !== fixtures.accountOnlyCase), false,
      `hostA's list named a ref this run did not open: ${json([...ownerOf])}`);

    // The filters. An unknown word must be refused, not answered as an empty list — the body says why: an
    // empty list looks exactly like a queue with nothing in it.
    await refusedRpc('operator_case_queue', { p_status: 'pending', p_category: null, p_limit: 25 },
      'opSupport', wire(400, '23514', SAY.caseStatus), 'C-02 with an unknown status word');
    await refusedRpc('operator_case_queue', { p_status: null, p_category: 'delivery', p_limit: 25 },
      'opSupport', wire(400, '23514', SAY.category), 'C-02 with an unknown category word');
    for (const bad of [0, 101]) {
      const r = await rpc('operator_case_queue', { p_status: null, p_category: null, p_limit: bad },
        { as: 'opSupport' });
      assert.equal(r.status, 400, `limit ${bad} answered ${json(shape(r))}`);
      assert.equal(r.body?.code, '23514', `limit ${bad} answered ${r.body?.code}`);
      assert.ok(String(r.body?.message).includes(SAY.limit100),
        `limit ${bad} answered ${shown(r.body?.message).slice(0, 160)}`);
    }
    // A legal filter filters: every row it answers has both words on it, and the coalesced limit is the
    // body's default rather than this file's guess.
    const filtered = await rpc('operator_case_queue', { p_status: 'open', p_category: 'other',
      p_limit: null }, { as: 'opSupport' });
    assert.equal(filtered.status, 200, `the filtered queue answered ${json(shape(filtered))}`);
    assert.equal(filtered.body.limit, 25, `the default limit is not the body's 25: ${filtered.body.limit}`);
    assert.ok(filtered.body.cases.length >= 3, `the filter on open+other answered ${filtered.body.cases.length} `
      + 'rows although C-01 opened four of them');
    for (const row of filtered.body.cases) {
      assert.equal(row.status, 'open', `the status filter answered a ${row.status} row`);
      assert.equal(row.category, 'other', `the category filter answered a ${row.category} row`);
    }
    const hostFilter = await rpc('get_my_support_cases', { p_status: 'no_such_status', p_limit: null },
      { as: 'hostA' });
    assert.equal(hostFilter.status, 400, `the host's status filter answered ${json(shape(hostFilter))}`);
    assert.equal(hostFilter.body?.code, '23514', 'the host filter refused with a different state');
    assert.ok(String(hostFilter.body?.message).includes(SAY.caseStatus),
      `the host filter answered ${shown(hostFilter.body?.message).slice(0, 160)}`);

    console.log(`  C-02  queue=${queue.body.cases.length} rows oldest-first with requester+assignee, `
      + `host list=${mine.body.cases.length} rows newest-first with neither; the sentinel summary reaches `
      + 'the operator and not the other host; 2 unknown filter words and 2 out-of-range limits refused '
      + `with 23514 and wrote nothing; the coalesced default limit answered ${filtered.body.limit}`);
  });

  test('C-03: an operator writes two arms on one thread and only one of them reaches the host', async () => {
    const ref = fixtures.c01Open;
    const hostArmKey = randomUUID();
    const internalArmKey = randomUUID();
    const trailAll = count('from private.audit_events', 'the whole trail before C-03');

    const shownNote = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_host',
      p_body: `${NEEDLE_HOST} the desk has the guest door again`, p_idempotency_key: hostArmKey },
    { as: 'opSupport' });
    assert.equal(shownNote.status, 200, `C-03's host-arm note answered ${json(shape(shownNote))}`);
    assert.equal(keysOf(shownNote.body), EXPECT_KEYS.operator_add_case_note,
      `the note projection is not the body's: ${json(keysOf(shownNote.body))}`);
    assert.equal(shownNote.body.replayed, false, 'the first delivery of a note called itself a replay');
    assert.equal(shownNote.body.kind, 'message_host', 'the visible arm answered with another kind');
    const hiddenNote = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_operator',
      p_body: `${NEEDLE_INTERNAL} waiting on the render team before we answer the host`,
      p_idempotency_key: internalArmKey }, { as: 'opSupport' });
    assert.equal(hiddenNote.status, 200, `C-03's internal note answered ${json(shape(hiddenNote))}`);
    assert.equal(hiddenNote.body.kind, 'message_operator', 'the internal arm answered with another kind');

    // The table holds both arms, and the trail holds nothing: §4's payload discipline in the one direction
    // that matters here — a note's content *is* the record, so copying it into `audit_events.reason` would
    // put caller text into the column §9's health block aggregates.
    assert.equal(armCount(ref, 'message_host'), '1', 'the visible arm did not land as exactly one row');
    assert.equal(armCount(ref, 'message_operator'), '1', 'the internal arm did not land as exactly one row');
    assert.deepEqual(trailFor(ref), [],
      `a case note wrote a trail row: ${json(trailFor(ref))}`);

    // The host's read of the same thread: the arm they are owed, in the 7-key projection that has no
    // column with which to name who wrote it.
    const hostView = await rpc('get_my_support_case', { p_case_ref: ref }, { as: 'hostA' });
    assert.equal(hostView.status, 200, `the host's single-case read answered ${json(shape(hostView))}`);
    assert.equal(keysOf(hostView.body), EXPECT_KEYS.get_my_support_case,
      `the host's case projection is not the body's: ${json(keysOf(hostView.body))}`);
    assert.equal(keysOf(hostView.body.events[0]), keySet('seq', 'kind', 'actor_kind', 'from_status',
      'to_status', 'body', 'created_at'),
      `the host's event projection carries a column it should not: ${json(keysOf(hostView.body.events[0]))}`);
    assert.equal(JSON.stringify(hostView.body).includes(NEEDLE_HOST), true,
      'the host read lost the note that was written for the host');
    assert.equal(JSON.stringify(hostView.body).includes(NEEDLE_INTERNAL), false,
      'the host read carried the internal arm');
    assert.equal([...new Set(hostView.body.events.map((e) => e.kind))].sort().join(','), 'message_host,status',
      `the host's thread is not the two arms the WHERE clause allows: ${json(hostView.body.events.map((e) => e.kind))}`);
    assert.equal(hostView.body.reply_allowed, true, 'an open ticket told its host not to reply');
    assert.equal(hostView.body.resume_expected, false, 'an open ticket is not waiting on its host');

    // The paired presence control, and the one that makes the absence above a measurement rather than a
    // typo: the same operator, the same case, both arms, and the column the host's read does not have.
    const opView = await rpc('get_operator_case', { p_case_ref: ref }, { as: 'opSupport' });
    assert.equal(opView.status, 200, `the operator's single-case read answered ${json(shape(opView))}`);
    assert.equal(keysOf(opView.body), EXPECT_KEYS.get_operator_case,
      `the operator's case projection is not the body's: ${json(keysOf(opView.body))}`);
    assert.equal(keysOf(opView.body.events[0]), keySet('seq', 'kind', 'actor_kind', 'actor_user_id',
      'from_status', 'to_status', 'body', 'created_at'),
      `the operator's event projection is not the body's: ${json(keysOf(opView.body.events[0]))}`);
    assert.equal(JSON.stringify(opView.body).includes(NEEDLE_INTERNAL), true,
      'the operator read did not carry the internal arm either, so C-03 measures nothing');
    const internalRow = opView.body.events.find((e) => e.kind === 'message_operator');
    assert.equal(internalRow.actor_user_id, uidOf('opSupport'),
      `the internal arm names ${internalRow.actor_user_id} rather than the operator who wrote it`);
    assert.equal(internalRow.body.includes(NEEDLE_INTERNAL), true, 'the internal arm arrived rewritten');
    assert.deepEqual(opView.body.events.map((e) => e.seq), [1, 2, 3],
      `the operator's thread is not the whole thread in order: ${json(opView.body.events.map((e) => [e.seq, e.kind]))}`);

    // A resubmitted form is one paragraph, not two.
    const replay = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_host',
      p_body: `${NEEDLE_HOST} the desk has the guest door again`, p_idempotency_key: hostArmKey },
    { as: 'opSupport' });
    assert.equal(replay.status, 200, `the replayed note answered ${json(shape(replay))}`);
    assert.equal(replay.body.replayed, true, 'a resubmitted note appended a second paragraph');
    assert.equal(replay.body.seq, shownNote.body.seq, 'the replayed note reported a different row');
    assert.equal(armCount(ref, 'message_host'), '1', 'the replayed note wrote a row anyway');

    // One key is one action *inside* a case, and the arm is what the read surface filters on, so the key
    // that bought the visible arm cannot be re-presented as the invisible one.
    const wrongArm = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_operator',
      p_body: `${NEEDLE_INTERNAL} reusing the visible arm's key`, p_idempotency_key: hostArmKey },
    { as: 'opSupport' });
    assert.equal(wrongArm.status, 400, `a note reusing another arm's key answered ${json(shape(wrongArm))}`);
    assert.equal(wrongArm.body?.code, '23514', 'the arm collision refused with a different state');
    assert.ok(String(wrongArm.body?.message).includes(SAY.keyCaseRow)
      && String(wrongArm.body?.message).includes('message_host')
      && String(wrongArm.body?.message).includes(SAY.keyCaseRowTail),
      `the arm collision answered ${shown(wrongArm.body?.message).slice(0, 200)}`);
    assert.equal(armCount(ref, 'message_operator'), '1', 'the refused arm switch wrote a row');

    // The note's own input rules, in the door's own order, each with the whole thread's count unchanged.
    const threadBefore = count('from private.support_case_events', 'the thread count');
    for (const [args, parts, label] of [
      [{ p_kind: 'internal_note', p_body: `${NEEDLE_INTERNAL} an arm that does not exist`,
        p_idempotency_key: randomUUID() }, [SAY.noteKind], 'an unknown arm'],
      [{ p_kind: 'message_host', p_body: '   ', p_idempotency_key: randomUUID() },
        [SAY.noteBody], 'a blank note'],
      [{ p_kind: 'message_host', p_body: 'x'.repeat(4001), p_idempotency_key: randomUUID() },
        [SAY.noteBound, 'got 4001'], 'a note one character too long'],
      [{ p_kind: 'message_host', p_body: `${NEEDLE_INTERNAL} a note with no key`, p_idempotency_key: null },
        [SAY.noteKey], 'a note with no idempotency key'],
    ]) {
      const r = await rpc('operator_add_case_note', { p_case_ref: ref, ...args }, { as: 'opSupport' });
      assert.equal(r.status, 400, `${label} answered ${json(shape(r))}`);
      assert.equal(r.body?.code, '23514', `${label} refused with ${r.body?.code}`);
      for (const part of parts) {
        assert.ok(String(r.body?.message).includes(part),
          `${label}: expected ${JSON.stringify(part)} in ${shown(r.body?.message).slice(0, 200)}`);
      }
    }
    assert.equal(count('from private.support_case_events', 'the thread count after the four refusals'),
      threadBefore, 'a refused note still appended to the thread');
    assert.equal(count('from private.audit_events', 'the whole trail after the four refusals'),
      trailAll, 'a refused note still wrote the trail');

    // The host has no note door: `message_host` is the arm the requester *reads*, not the arm they write.
    const hostNote = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_host',
      p_body: `${NEEDLE_HOST} written by the host`, p_idempotency_key: randomUUID() }, { as: 'hostA' });
    assert.equal(hostNote.status, 403, `a host calling the note door answered ${json(shape(hostNote))}`);
    assert.equal(hostNote.body?.code, '42501', 'the host reached a different refusal than the predicate');
    assert.ok(String(hostNote.body?.message).includes(SAY.noteNo),
      `the host's note attempt answered ${shown(hostNote.body?.message).slice(0, 200)}`);
    assert.equal(count('from private.support_case_events', 'the thread count after the host attempt'),
      threadBefore, 'a host with no grant still wrote on the thread');

    console.log(`  C-03  two arms landed on ${ref} as seqs 2 and 3 with one trail row written by neither; `
      + `the host's read is ${(hostView.body.events ?? []).length} rows over ${keysOf(hostView.body.events[0])} `
      + `and carries ${NEEDLE_HOST} but not ${NEEDLE_INTERNAL}, while the operator's read is `
      + `${opView.body.events.length} rows over ${keysOf(opView.body.events[0])} and carries both; the `
      + 'replay returned the same seq, the arm switch and 4 note rules refused with 23514, and a host at the '
      + `note door heard ${hostNote.body?.code}`);
  });

  test('C-04: a reply carries no status argument, and the one edge it walks is the resume', async () => {
    // The structural half of "a host cannot forge a status", read from the catalog rather than from this
    // file's memory of the signature: three named parameters, and no word that could be a status among
    // them, in both the exposed wrapper and the body behind it.
    for (const schema of ['api', 'internal_api']) {
      const signature = cell(`select pg_get_function_arguments(p.oid) from pg_proc p `
        + `join pg_namespace n on n.oid = p.pronamespace where n.nspname = '${schema}' `
        + `and p.proname = 'reply_to_support_case'`, `the ${schema} reply signature`);
      assert.equal(signature.replace(/\s+/g, ' ').trim(),
        'p_case_ref text, p_body text, p_idempotency_key uuid',
        `the ${schema} reply door's parameter list is not the three arguments §5 states: ${shown(signature)}`);
      assert.equal(/status/i.test(signature), false,
        `the host's reply door in ${schema} takes a status after all: ${shown(signature)}`);
    }

    const ref = fixtures.c01Open;
    /** One call, one primary row: the decision carries the key and a companion row never does. */
    const oneKeyedRow = (prev) => {
      const now = Number(keyedCount(ref));
      assert.equal(now, prev + 1, `the call left ${now - prev} keyed rows on ${ref}, and one call is `
        + 'one primary row');
      return now;
    };

    // A reply on a ticket nobody has triaged is a message and nothing else: no edge exists out of `open`
    // for the requester, and the body takes none.
    let keyed = Number(keyedCount(ref));
    const replyKey = randomUUID();
    const plain = await rpc('reply_to_support_case', { p_case_ref: ref, p_body: `${NEEDLE_HOST} the door `
      + 'still 404s for the Sharma side', p_idempotency_key: replyKey }, { as: 'hostA' });
    assert.equal(plain.status, 200, `a reply on an open ticket answered ${json(shape(plain))}`);
    assert.equal(keysOf(plain.body), EXPECT_KEYS.reply_to_support_case,
      `the reply projection is not the body's: ${json(keysOf(plain.body))}`);
    assert.equal(plain.body.replayed, false, 'the first delivery of a reply called itself a replay');
    assert.equal(plain.body.status, 'open', `a reply moved an open ticket to ${plain.body.status}`);
    assert.equal(col(ref, 'status'), 'open', 'the row disagrees with the answer about its own status');
    keyed = oneKeyedRow(keyed);

    // Now the one state a host's answer can leave, reached the way a ticket reaches it: by the desk.
    await toStatus(ref, 'triaged');
    keyed = oneKeyedRow(keyed);
    await toStatus(ref, 'awaiting_information',
      { body: `${NEEDLE_HOST} could you send the guest's own phone number?` });
    keyed = oneKeyedRow(keyed);
    const waiting = await rpc('get_my_support_case', { p_case_ref: ref }, { as: 'hostA' });
    assert.equal(waiting.body.status, 'awaiting_information', 'the walk did not reach the waiting state');
    assert.equal(waiting.body.resume_expected, true, 'a case waiting on its host did not say it was');
    assert.equal(waiting.body.reply_allowed, true, 'a case awaiting information refused a reply');
    const rowsBefore = threadRows(ref).length;

    // The resume: two rows for one call, the message keyed and the edge keyless.
    const resumeKey = randomUUID();
    const resume = await rpc('reply_to_support_case', { p_case_ref: ref, p_body: `${NEEDLE_HOST} here it is`,
      p_idempotency_key: resumeKey }, { as: 'hostA' });
    assert.equal(resume.status, 200, `the resume reply answered ${json(shape(resume))}`);
    assert.equal(resume.body.status, 'in_progress', `the host's answer left the case at ${resume.body.status}`);
    assert.equal(col(ref, 'status'), 'in_progress', 'the row did not take the edge the answer reports');
    assert.equal(threadRows(ref).length, rowsBefore + 2, 'the resume wrote other than its two rows');
    assert.equal(keyedCount(ref), String(keyed + 1), 'both rows of the resume claimed the key, or neither did');
    keyed = Number(keyedCount(ref));
    const edgeRow = threadRows(ref).find((line) => line.includes('awaiting_information>in_progress'));
    assert.ok(edgeRow, `the reply took the edge without recording it: ${json(threadRows(ref))}`);
    assert.equal(/ status host key=false awaiting_information>in_progress/.test(edgeRow), true,
      `the resume row is not the host's own keyless edge: ${edgeRow}`);

    // A resubmitted form is one paragraph, and — the half a replay can get wrong — it is not a second
    // walk of the edge either: the row it returns is the one the first delivery wrote.
    const replay = await rpc('reply_to_support_case', { p_case_ref: ref, p_body: `${NEEDLE_HOST} here it is`,
      p_idempotency_key: resumeKey }, { as: 'hostA' });
    assert.equal(replay.status, 200, `the replayed reply answered ${json(shape(replay))}`);
    assert.equal(replay.body.replayed, true, 'a resubmitted reply appended a second paragraph');
    assert.equal(replay.body.seq, resume.body.seq, 'the replay reported a different row than the first call');
    assert.equal(replay.body.status, 'in_progress', 'the replay moved the case a second time');
    assert.equal(threadRows(ref).length, rowsBefore + 2, 'the replayed reply appended to the thread');
    assert.equal(col(ref, 'status'), 'in_progress', 'the replay re-walked an edge with no edge left');

    // A reply where no resume is owed writes one row: the door cannot invent an edge.
    const statusRows = armCount(ref, 'status');
    const threadRowsNow = threadRows(ref).length;
    const second = await rpc('reply_to_support_case', { p_case_ref: ref, p_body: `${NEEDLE_HOST} and the `
      + 'auntie cannot open the PDF either', p_idempotency_key: randomUUID() }, { as: 'hostA' });
    assert.equal(second.status, 200, `a second reply answered ${json(shape(second))}`);
    assert.equal(second.body.status, 'in_progress', `a reply on a live ticket moved it to ${second.body.status}`);
    assert.equal(armCount(ref, 'status'), statusRows, 'a reply invented a status row');
    assert.equal(threadRows(ref).length, threadRowsNow + 1, 'a reply wrote other than its own row');
    assert.equal(Number(keyedCount(ref)), threadRows(ref).filter((l) => l.includes('key=true')).length,
      'the keyed count and the keyed rows the thread shows are not the same number');

    // The host's own read of the thread this run built: their messages, the status history, the note the
    // desk meant for them — and not the internal arm.
    const hostFinal = await rpc('get_my_support_case', { p_case_ref: ref }, { as: 'hostA' });
    assert.equal(JSON.stringify(hostFinal.body).includes(NEEDLE_INTERNAL), false,
      'the internal arm reached the host read after a long thread');
    assert.equal([...new Set(hostFinal.body.events.map((e) => e.kind))].sort().join(','), 'message_host,status',
      `the host's thread gained an arm: ${json(hostFinal.body.events.map((e) => e.kind))}`);
    assert.equal(hostFinal.body.events.filter((e) => e.kind === 'status').length, 4,
      'the status history is not the birth plus the three edges this run walked');
    assert.equal(hostFinal.body.resume_expected, false, 'a resumed case still says it waits on the host');
    // And the seqs are the thread's own, not a renumbering: `mint_support_case_seq` writes
    // `coalesce(max(seq), 0) + 1` per case (migration file 1:402), so the table's numbering is contiguous
    // and the read's numbering must be that contiguous list with exactly the internal arms cut out of it.
    // Asserting `1..n` here would have scored the *correct* projection as a failure — the first executed
    // run measured the host read as seqs [1,2,4,5,6,7,8,9,10] because the desk's arm at seq 3 is a
    // `message_operator` row the host must not see.
    const hostSeqs = hostFinal.body.events.map((e) => e.seq);
    const kindOf = (line) => line.split(' ')[1];
    const seqOf = (line) => Number(line.split(' ')[0]);
    const allSeqs = threadRows(ref).map(seqOf);
    const internalSeqs = threadRows(ref).filter((line) => kindOf(line) === 'message_operator')
      .map(seqOf);
    assert.ok(internalSeqs.length > 0,
      `this thread carries no internal arm, so the read has nothing to hide and the order claim below `
      + `proves nothing: ${json(threadRows(ref))}`);
    assert.deepEqual(allSeqs, allSeqs.map((s, i) => i + 1),
      `the thread is not minted contiguously from 1, so the read cannot be the thread with holes cut in it: `
      + `${json(allSeqs)}`);
    assert.deepEqual(hostSeqs, allSeqs.filter((s) => !internalSeqs.includes(s)),
      `the host read is not the thread in minted order minus its ${internalSeqs.length} internal arm(s): `
      + `${json({ hostSeqs, allSeqs, internalSeqs })}`);

    // The reply's input rules. They run before the case is read, so the counts they leave behind are the
    // same counts a successful call would have moved.
    const replyBase = { p_case_ref: ref, p_body: `${NEEDLE_HOST} a rule test` };
    await refusedRpc('reply_to_support_case', { ...replyBase, p_body: '   ', p_idempotency_key: randomUUID() },
      'hostA', wire(400, '23514', SAY.replyBody), 'C-04 with a blank reply');
    await refusedRpc('reply_to_support_case', { ...replyBase, p_body: 'x'.repeat(4001),
      p_idempotency_key: randomUUID() }, 'hostA',
    wire(400, '23514', SAY.replyBound, 'got 4001'), 'C-04 with a reply one character too long');
    await refusedRpc('reply_to_support_case', { ...replyBase, p_idempotency_key: null }, 'hostA',
      wire(400, '23514', SAY.replyKey), 'C-04 with no idempotency key');
    // The cross-account probe, aimed in the direction that is actually an attack. The first executed run of
    // this line sent `reply_to_support_case` for `fixtures.caseB` *as hostB*, and hostB is the account that
    // filed caseB (line 1043), so the door answered 200 — which is the body's own rule, `AND
    // c.requester_user_id = v_caller` at migration file 1:804, working as written. The instrument had aimed
    // the refusal at its own golden path. Now the caller is a foreign host and the paired control proves the
    // ticket is not refusing everyone.
    await refusedRpc('reply_to_support_case', { p_case_ref: fixtures.caseB, p_body: `${NEEDLE_HOST} on `
      + 'somebody else\'s ticket', p_idempotency_key: randomUUID() }, 'hostA',
    wire(403, '42501', SAY.replyNo), 'C-04 from an account that did not file the ticket');
    const ownReply = await rpc('reply_to_support_case', { p_case_ref: fixtures.caseB,
      p_body: `${NEEDLE_HOST} from its own host`, p_idempotency_key: randomUUID() }, { as: 'hostB' });
    assert.equal(ownReply.status, 200,
      `the same door refused the account that filed ${fixtures.caseB}: ${json(shape(ownReply))}`);
    assert.equal(ownReply.body.replayed, false, 'the control reply reported itself as a replay');
    assert.equal(armCount(fixtures.caseB, 'message_host'), '1',
      'the control reply wrote other than one host row on its own thread');
    await refusedRpc('reply_to_support_case', { p_case_ref: 'SC-NOPE-NOPE', p_body: `${NEEDLE_HOST} on a `
      + 'ticket that does not exist', p_idempotency_key: randomUUID() }, 'hostA',
    wire(403, '42501', SAY.replyNo), 'C-04 against a ref that is not a ticket');

    console.log(`  C-04  both reply signatures read as p_case_ref/p_body/p_idempotency_key with no status `
      + 'word in them; a reply on an open ticket wrote 1 row and moved nothing; on '
      + `${ref}, waiting, one reply wrote 2 rows for 1 key and took the awaiting_information -> in_progress `
      + `edge as the host's own keyless status row; its replay returned seq ${resume.body.seq} and touched `
      + 'neither the thread nor the status; 5 refusals answered with their own sentences and left both '
      + `counts alone, and the not-yours one is aimed at ${fixtures.caseB} from an account that did not `
      + 'file it, with the filing account\'s own accepted reply as its control');
  });

  test('C-05: a ticket is held by one operator, and moving it onto a second is two acts', async () => {
    const ref = fixtures.caseClaim;
    const claimKey = randomUUID();
    const releaseKey = randomUUID();
    spent.claimOnClaim = claimKey;
    spent.releaseOnClaim = releaseKey;
    assert.equal(col(ref, 'assigned_operator_user_id'), '<null>',
      'the desk\'s fixture arrived already held');

    // The claim takes the calling account out of the session and out of no argument: the door has no
    // operator parameter, so the only name a caller can put on a ticket is their own.
    const claim = await rpc('operator_claim_case', { p_case_ref: ref, p_idempotency_key: claimKey },
      { as: 'opSupport' });
    assert.equal(claim.status, 200, `a claim answered ${json(shape(claim))}`);
    assert.equal(keysOf(claim.body), EXPECT_KEYS.operator_claim_case,
      `the claim projection is not the body's: ${json(keysOf(claim.body))}`);
    assert.equal(claim.body.assigned_operator_user_id, uidOf('opSupport'),
      `the claim named ${claim.body.assigned_operator_user_id} rather than the caller`);
    assert.equal(claim.body.replayed, false, 'the first claim called itself a replay');
    harvest(claim.body);
    assert.equal(col(ref, 'assigned_operator_user_id'), uidOf('opSupport'),
      'the answer claims a holder the row does not have');
    assert.equal(col(ref, 'status'), 'open', 'a claim moved the status, which is not a claim');
    assert.equal(armCount(ref, 'assignment'), '1', 'the claim wrote no assignment row on the thread');
    assert.equal(armCount(ref, 'status'), '1', 'a claim invented a status edge');
    const claimed = trailFor(ref);
    assert.equal(claimed.length, 1, `the claim wrote ${claimed.length} trail rows: ${json(claimed)}`);
    assert.equal(claimed[0], `${claim.body.audit_id} case_claimed operator ${uidOf('opSupport')} `
      + `wedding=${weddingOf('hostA')}`, `the claim's trail row is not the act the door took: ${claimed[0]}`);
    assert.equal(cell(`select coalesce(before_state->>'assigned_operator_user_id', '<null>')::text `
      + `from private.audit_events where id = ${claim.body.audit_id}`, 'the claim before_state'), '<null>',
      'the claim recorded a holder before itself');
    assert.equal(cell(`select after_state->>'assigned_operator_user_id' from private.audit_events `
      + `where id = ${claim.body.audit_id}`, 'the claim after_state'), uidOf('opSupport'),
      'the claim did not record the holder it took');

    // The two refusals that are the reason there are two verbs: a second operator may not take a held
    // ticket, and may not clear a hold that is not theirs.
    const otherClaim = await refusedRpc('operator_claim_case', { p_case_ref: ref,
      p_idempotency_key: randomUUID() }, 'opSupport2',
    wire(400, '23514', SAY.heldByOtherClaim), 'C-05 as a second operator claiming a held case');
    assert.equal(otherClaim.body?.message.includes(uidOf('opSupport2')), false,
      'the refusal quotes an identity the caller never sent');
    assert.equal(col(ref, 'assigned_operator_user_id'), uidOf('opSupport'),
      'the refused claim still moved the holder');
    const otherRelease = await rpc('operator_release_case', { p_case_ref: ref,
      p_idempotency_key: randomUUID() }, { as: 'opSupport2' });
    assert.equal(otherRelease.status, 403, `a second operator releasing a held case answered `
      + `${json(shape(otherRelease))}`);
    assert.equal(otherRelease.body?.code, '42501', 'clearing another operator\'s hold is not a check '
      + 'violation: it is an escalation on their work, and the door says so as insufficient_privilege');
    assert.ok(String(otherRelease.body?.message).includes(SAY.releaseOtherHolder),
      `the other-holder release answered ${shown(otherRelease.body?.message).slice(0, 200)}`);
    assert.equal(col(ref, 'assigned_operator_user_id'), uidOf('opSupport'),
      'the refused release cleared the holder');
    const selfReclaim = await rpc('operator_claim_case', { p_case_ref: ref,
      p_idempotency_key: randomUUID() }, { as: 'opSupport' });
    assert.equal(selfReclaim.status, 400, `the holder claiming their own case again answered `
      + `${json(shape(selfReclaim))}`);
    assert.ok(String(selfReclaim.body?.message).includes(SAY.alreadyClaimed),
      `the self re-claim answered ${shown(selfReclaim.body?.message).slice(0, 200)}`);

    // A resubmitted claim is answered with the claim, and the claim's own trail row: the thread cannot
    // tell a claim from a release (one kind serves both), so the replay reads the act off the trail.
    const replay = await rpc('operator_claim_case', { p_case_ref: ref, p_idempotency_key: claimKey },
      { as: 'opSupport' });
    assert.equal(replay.status, 200, `the replayed claim answered ${json(shape(replay))}`);
    assert.equal(replay.body.replayed, true, 'a resubmitted claim claimed again');
    assert.equal(replay.body.seq, claim.body.seq, 'the replay reported a different thread row');
    assert.equal(replay.body.audit_id, claim.body.audit_id, 'the replay reported a different trail row');
    assert.equal(armCount(ref, 'assignment'), '1', 'the replayed claim appended to the thread');
    assert.equal(trailFor(ref).length, 1, 'the replayed claim wrote a second trail row');

    // The release, and the refusal that follows an empty hand.
    const release = await rpc('operator_release_case', { p_case_ref: ref, p_idempotency_key: releaseKey },
      { as: 'opSupport' });
    assert.equal(release.status, 200, `a release answered ${json(shape(release))}`);
    assert.equal(release.body.assigned_operator_user_id, null, 'the release left a holder in its answer');
    harvest(release.body);
    assert.equal(col(ref, 'assigned_operator_user_id'), '<null>',
      'the row kept a holder the release removed');
    assert.equal(armCount(ref, 'assignment'), '2', 'the release wrote no second assignment row');
    assert.equal(trailFor(ref).length, 2, `the release left ${trailFor(ref).length} trail rows`);
    const released = trailFor(ref)[1];
    assert.equal(released, `${release.body.audit_id} case_released operator ${uidOf('opSupport')} `
      + `wedding=${weddingOf('hostA')}`, `the release's trail row is not the act: ${released}`);
    const reRelease = await rpc('operator_release_case', { p_case_ref: ref,
      p_idempotency_key: randomUUID() }, { as: 'opSupport' });
    assert.equal(reRelease.status, 400, `releasing an unheld case answered ${json(shape(reRelease))}`);
    assert.ok(String(reRelease.body?.message).includes(SAY.nobodyHolds),
      `the empty-hand release answered ${shown(reRelease.body?.message).slice(0, 200)}`);

    // One key is one action, and the thread cannot say which of the two verbs a key bought — so the door
    // asks the trail, and refuses. This is the arm that would otherwise answer a claim with a release.
    const crossed = await refusedRpc('operator_claim_case', { p_case_ref: ref, p_idempotency_key: releaseKey },
      'opSupport', wire(400, '23514', SAY.keyTrailAct, 'case_released', SAY.keyTrailActTail,
        SAY.oneKeyOneAction),
      'C-05 claiming with the key that bought this case\'s release');
    assert.equal(crossed.body?.message.includes(SAY.keyCaseRowTail), false,
      'the wrong half of the key rule spoke: the row probe was satisfied, the trail probe is what refused');
    assert.equal(col(ref, 'assigned_operator_user_id'), '<null>', 'the crossed claim took the case anyway');

    // The handover the design prescribes: release, then the second operator claims for themselves.
    const handed = await rpc('operator_claim_case', { p_case_ref: ref, p_idempotency_key: randomUUID() },
      { as: 'opSupport2' });
    assert.equal(handed.status, 200, `the second operator's claim after a release answered `
      + `${json(shape(handed))}`);
    assert.equal(handed.body.assigned_operator_user_id, uidOf('opSupport2'), 'the handover held the wrong name');
    harvest(handed.body);
    assert.equal(col(ref, 'assigned_operator_user_id'), uidOf('opSupport2'),
      'the row did not follow the second claim');
    const handedBack = await rpc('operator_release_case', { p_case_ref: ref, p_idempotency_key: randomUUID() },
      { as: 'opSupport2' });
    assert.equal(handedBack.status, 200, `the second operator's own release answered ${json(shape(handedBack))}`);
    harvest(handedBack.body);

    // The doors a host and a wrong-scope operator cannot open, and the two refusals that share a sentence
    // so that neither read is an oracle over a ref: no grant, and a ref that is not a ticket.
    const hostClaim = await rpc('operator_claim_case', { p_case_ref: ref, p_idempotency_key: randomUUID() },
      { as: 'hostA' });
    assert.equal(hostClaim.status, 403, `a host claiming their own ticket answered ${json(shape(hostClaim))}`);
    assert.ok(String(hostClaim.body?.message).includes(SAY.claimNo),
      `the host at the claim door answered ${shown(hostClaim.body?.message).slice(0, 200)}`);
    const wrongScope = await rpc('operator_claim_case', { p_case_ref: ref, p_idempotency_key: randomUUID() },
      { as: 'opOps' });
    assert.equal(wrongScope.status, 403, `an operations operator claiming answered ${json(shape(wrongScope))}`);
    const ghostClaim = await rpc('operator_claim_case', { p_case_ref: 'SC-NOPE-NOPE',
      p_idempotency_key: randomUUID() }, { as: 'opSupport' });
    assert.equal(ghostClaim.status, 403, `claiming a ref that is not a case answered ${json(shape(ghostClaim))}`);
    assert.equal(ghostClaim.body?.message, wrongScope.body?.message,
      'a missing case and a scopeless operator answer differently, which makes the door an oracle over '
      + 'case refs');
    assert.equal(col(ref, 'assigned_operator_user_id'), '<null>', 'a refused claim left the case held');

    console.log(`  C-05  ${ref} was claimed by opSupport (trail ${claim.body.audit_id}), refused to a `
      + `second operator as 23514 and to a second release as ${otherRelease.body?.code}, replayed to its `
      + `own key with the same seq and audit id, released, refused empty-handed, and refused again as a `
      + `claim carrying the release's key (${crossed.body?.code} naming case_released); the handover then `
      + 'completed as release-then-claim, and a host, a wrong-scope operator and a ref that does not exist '
      + `all heard one sentence: ${shown(ghostClaim.body?.message).slice(0, 80)}`);
  });

  test('C-06: the lifecycle is a table of edges, and every one of them is reachable through the door', async () => {
    // The paths that mint each resting state, written out rather than derived, because the point of the
    // case is that the *listed* edges are the only way to any of them.
    const PATHS = { open: [], triaged: ['triaged'], awaiting_information: ['triaged', 'awaiting_information'],
      in_progress: ['triaged', 'awaiting_information', 'in_progress'],
      resolved: ['triaged', 'awaiting_information', 'in_progress', 'resolved'], closed: ['closed'] };
    const ENDINGS = { resolved: 'resolved_by_operator', closed: 'resolved_by_operator' };
    async function parkedAt(status, label) {
      const ref = await newCase(label);
      for (const step of PATHS[status]) await toStatus(ref, step, { code: ENDINGS[step] ?? null });
      assert.equal(col(ref, 'status'), status, `parking ${label} at ${status} did not land there`);
      return ref;
    }

    // The long path: open, triaged, waiting, working, resolved, reopened, closed. Six edges and the two
    // halves of the reopen, all on one thread so the ordinals below have something to count.
    const long = await newCase('C-06 the long path');
    fixtures.longPath = long;
    const first = await toStatus(long, 'triaged', { body: `${NEEDLE_HOST} the desk has it` });
    assert.equal(keysOf(first), EXPECT_KEYS.operator_transition_case,
      `the transition projection is not the body's: ${json(keysOf(first))}`);
    assert.equal(first.from_status, 'open', `the first edge reported ${first.from_status}`);
    assert.equal(armCount(long, 'message_host'), '1', 'a transition message did not reach the host arm');
    assert.equal(threadRows(long).length, 3, 'one transition with a message wrote other than three rows '
      + 'counting the ticket\'s own birth');
    assert.equal(keyedCount(long), '1', 'both rows of the two-row call claimed the key, or neither did');
    await toStatus(long, 'awaiting_information');
    await toStatus(long, 'in_progress');
    const resolved = await toStatus(long, 'resolved', { code: 'resolved_by_operator' });
    assert.equal(resolved.to_status, 'resolved', 'the walk did not reach the resting state');
    assert.equal(col(long, 'resolution_code'), 'resolved_by_operator', 'the code the caller sent was not stored');
    assert.notEqual(col(long, 'resolved_at'), '<null>',
      'entering a resting state did not stamp the instant the database owns');
    const reopened = await toStatus(long, 'in_progress');
    assert.equal(reopened.from_status, 'resolved', `the reopen came from ${reopened.from_status}`);
    assert.equal(col(long, 'resolution_code'), '<null>', 'the reopen left a resolution on a live ticket');
    assert.equal(col(long, 'resolved_at'), '<null>', 'the reopen left a resolved instant on a live ticket');
    assert.equal(armCount(long, 'status'), '6',
      'the thread does not hold the birth and the five edges this ticket has now walked');
    assert.equal(trailFor(long).filter((line) => line.includes(' status_changed ')).length, 5,
      'the trail does not hold one row per decision the door took');
    await toStatus(long, 'closed', { code: 'resolved_by_operator' });
    assert.equal(col(long, 'status'), 'closed', 'the last listed edge did not land');
    assert.equal(col(long, 'resolved_at') === '<null>', false, 'closing stamped no instant');

    // The four edges the long path does not pass through, each on its own ticket: `open -> closed` is the
    // one that ends a ticket nobody triaged, and `in_progress -> awaiting_information` is the second ask.
    for (const [label, steps, final] of [
      ['C-06 closed from the queue', PATHS.closed, 'closed'],
      ['C-06 triaged then closed', ['triaged', 'closed'], 'closed'],
      ['C-06 asked twice', ['triaged', 'awaiting_information', 'in_progress', 'awaiting_information'],
        'awaiting_information'],
      ['C-06 waiting then closed', ['triaged', 'awaiting_information', 'closed'], 'closed'],
    ]) {
      const ref = await newCase(label);
      for (const step of steps) await toStatus(ref, step, { code: ENDINGS[step] ?? null });
      assert.equal(col(ref, 'status'), final, `${label} did not end at ${final}`);
      assert.equal(Number(threadRows(ref).length), steps.length + 1,
        `${label} holds ${threadRows(ref).length} rows for ${steps.length} edges plus its birth`);
    }

    // The pairs that are not on the list. Each is attempted on a ticket parked at the state a stale
    // operator tab would be sitting on, and each answers with the pair rather than with a state.
    const parked = {
      open: await parkedAt('open', 'C-06 parked open'),
      triaged: await parkedAt('triaged', 'C-06 parked triaged'),
      in_progress: await parkedAt('in_progress', 'C-06 parked working'),
      resolved: await parkedAt('resolved', 'C-06 parked resolved'),
    };
    for (const [from, to, parts] of [
      ['open', 'resolved', [SAY.noEdge, 'open → resolved']],
      ['open', 'in_progress', [SAY.noEdge, 'open → in_progress']],
      ['open', 'awaiting_information', [SAY.noEdge, 'open → awaiting_information']],
      ['triaged', 'resolved', [SAY.noEdge, 'triaged → resolved']],
      ['resolved', 'triaged', [SAY.noEdge, 'resolved → triaged']],
      ['resolved', 'awaiting_information', [SAY.noEdge, 'resolved → awaiting_information']],
    ]) {
      const ref = parked[from];
      const fingerprint = caseState(ref);
      await refusedRpc('operator_transition_case', { p_case_ref: ref, p_to_status: to,
        p_resolution_code: ENDINGS[to] ?? null, p_body: null, p_idempotency_key: randomUUID() },
      'opSupport', wire(400, '23514', ...parts), `C-06's ${from} → ${to}`);
      assert.equal(caseState(ref), fingerprint, `the refused ${from} → ${to} moved the row`);
    }

    // The two sentences the door states itself, before the trigger ever sees the write: the same-status
    // double click, and the one status no argument may name.
    const sameStatus = await rpc('operator_transition_case', { p_case_ref: parked.triaged,
      p_to_status: 'triaged', p_resolution_code: null, p_body: null, p_idempotency_key: randomUUID() },
    { as: 'opSupport' });
    assert.equal(sameStatus.status, 400, `a stale tab re-sending triaged answered ${json(shape(sameStatus))}`);
    assert.ok(String(sameStatus.body?.message).includes(SAY.alreadyStatus)
      && String(sameStatus.body?.message).includes('triaged'),
      `the same-status refusal answered ${shown(sameStatus.body?.message).slice(0, 200)}`);
    for (const from of ['open', 'in_progress', 'resolved']) {
      const back = await refusedRpc('operator_transition_case', { p_case_ref: parked[from],
        p_to_status: 'open', p_resolution_code: null, p_body: null, p_idempotency_key: randomUUID() },
      'opSupport', wire(400, '23514', SAY.backToOpen), `C-06's ${from} → open`);
      assert.equal(String(back.body?.message).includes(SAY.noEdge), false,
        'the body let the intent reach the trigger, so the operator hears a pair rather than a rule');
    }
    const unknownWord = await refusedRpc('operator_transition_case', { p_case_ref: parked.open,
      p_to_status: 'pending', p_resolution_code: null, p_body: null, p_idempotency_key: randomUUID() },
    'opSupport', wire(400, '23514', SAY.caseStatus), 'C-06 with a status word the lifecycle does not have');
    assert.equal(unknownWord.body?.message.includes('pending'), true,
      'the unknown status refusal did not quote the word it refused');

    console.log(`  C-06  ${long} walked open→triaged→awaiting_information→in_progress→resolved→`
      + 'in_progress→closed as 7 thread rows and 5 trail rows before the last edge, with the reopen '
      + 'clearing both resolution columns while the thread kept the ending it cleared; 4 more tickets took '
      + 'the edges the long path misses; 6 unlisted pairs refused as `no edge X → Y`, 1 same-status tab '
      + 'refused as its own sentence, 3 returns to open refused by the door rather than the trigger, and 1 '
      + 'unknown word refused before the row was read — none of them moved a row');
  });

  test("C-07: a resolution code is the caller's claim, and the six words are the table's", async () => {
    const eventsBefore = count('from private.support_case_events', 'the thread count before C-07');
    // The vocabulary read from the column's own constraint rather than transcribed from the door, so the
    // two are checked against each other. `order by 1` makes the row set stable across runs.
    const checks = sqlRows(`select pg_get_constraintdef(oid) from pg_constraint `
      + `where conrelid = 'private.support_cases'::regclass and contype = 'c' `
      + `and pg_get_constraintdef(oid) like '%resolution_code%' order by 1`);
    assert.equal(checks.length >= 1, true, 'the table declares no CHECK over `resolution_code` at all');
    const SIX = ['resolved_by_operator', 'host_withdrew', 'no_action_needed', 'duplicate', 'out_of_scope',
      'event_cancelled'];
    for (const word of SIX) {
      assert.ok(checks.join(' ').includes(word),
        `the table's CHECK does not carry ${word}: ${shown(checks.join(' ')).slice(0, 300)}`);
    }
    assert.equal(SIX.some((word) => /money|refund|price|payment/i.test(word)), false,
      'a resolution word claims money moved, which §6 says nothing here can do');

    // The three resolution rules, and the ordering that makes them rules: each is stated before the case
    // is looked up, so an invented ref hears the resolution sentence rather than the not-yours one.
    const base = { p_case_ref: 'SC-NOPE-NOPE', p_body: null, p_idempotency_key: randomUUID() };
    for (const [to, code, parts, label] of [
      ['closed', null, [SAY.resolution, 'none of them says money moved'], 'a close with no code'],
      ['resolved', null, [SAY.resolution], 'a resolve with no code'],
      ['resolved', 'fixed_it', [SAY.resolutionUnknown, 'fixed_it'], 'an invented resolution word'],
      ['triaged', 'duplicate', [SAY.resolutionMisplaced], 'a code on a ticket that is not ending'],
      ['in_progress', 'duplicate', [SAY.resolutionMisplaced], 'a code on a ticket that is still work'],
    ]) {
      const r = await rpc('operator_transition_case', { ...base, p_to_status: to, p_resolution_code: code,
        p_idempotency_key: randomUUID() }, { as: 'opSupport' });
      assert.equal(r.status, 400, `${label} answered ${json(shape(r))}`);
      assert.equal(r.body?.code, '23514', `${label} refused with ${r.body?.code}`);
      for (const part of parts) {
        assert.ok(String(r.body?.message).includes(part),
          `${label}: expected ${JSON.stringify(part)} in ${shown(r.body?.message).slice(0, 220)}`);
      }
      assert.equal(String(r.body?.message).includes(SAY.transitionNo), false,
        `${label} reached the case lookup, so the input rules are not first in this door`);
    }
    assert.equal(count('from private.support_case_events', 'the thread count after the five refusals'),
      eventsBefore, 'a refused resolution rule still appended');

    // All six words are the table's, so all six land: one ticket resolved and reopened six times, which
    // also measures that the reopen takes the code away every time rather than once.
    //
    // The ticket is first walked to `in_progress`, because that is the state the resolve edge leaves from:
    // the wall's table (file 3:edges, and the same rows in file 1's guard) has `open -> triaged | closed`
    // and `in_progress -> resolved`, and no `open -> resolved`. The first executed run measured this and
    // the door said so on the wire: `no edge open → resolved exists in the support case lifecycle`.
    const ref = await newCase('C-07 the six endings');
    await toStatus(ref, 'triaged');
    await toStatus(ref, 'in_progress');
    // Birth plus the two edges that make the ticket resolvable.
    let statusRows = 3;
    for (const word of SIX) {
      const up = await toStatus(ref, 'resolved', { code: word });
      assert.equal(col(ref, 'resolution_code'), word, `${word} did not reach the row`);
      assert.equal(col(ref, 'resolved_at') === '<null>', false, `${word} rested without an instant`);
      assert.equal(up.to_status, 'resolved', `${word} answered ${up.to_status}`);
      statusRows += 1;
      const trail = trailFor(ref);
      assert.ok(trail[trail.length - 1].includes('status_changed'),
        `the ${word} decision wrote no trail row: ${json(trail.slice(-2))}`);
      assert.equal(cell(`select reason from private.audit_events where id = ${up.audit_id}`,
        `the ${word} reason`).includes(` as ${word}`), true,
        `the trail reason for ${word} does not name the code the caller chose`);
      await toStatus(ref, 'in_progress');
      statusRows += 1;
      assert.equal(col(ref, 'resolution_code'), '<null>', `${word} survived the reopen on the row`);
      assert.equal(armCount(ref, 'status'), String(statusRows), 'the resolve/reopen pair wrote other than two rows');
    }
    // The code is the host's own answer to "how did my ticket end", so it must cross the read surface.
    await toStatus(ref, 'resolved', { code: 'event_cancelled' });
    const hostView = await rpc('get_my_support_case', { p_case_ref: ref }, { as: 'hostA' });
    assert.equal(hostView.body.resolution_code, 'event_cancelled',
      'the host read lost the code that ended their ticket');
    assert.notEqual(hostView.body.resolved_at, null, 'the host read lost the instant it ended');
    assert.equal(hostView.body.reply_allowed, true, 'a resolved ticket is not closed, so a reply is allowed');

    console.log(`  C-07  the six words read out of the column's own CHECK (${SIX.length}) all landed on `
      + `${ref} through 6 resolve/reopen pairs of ${statusRows + 1} thread rows, each reason naming its `
      + 'code on the trail and each reopen taking the code and the instant back; 5 rule refusals (2 no-code, '
      + '1 invented word, 2 code-on-a-live-ticket) answered 23514 against a ref that does not exist, so the '
      + 'rules are before the lookup, and nothing was written; the last ending crossed to the host read');
  });

  test('C-08: a closed ticket refuses every door that speaks to it, and still answers both reads', async () => {
    const ref = await newCase('C-08 the ticket that ended');
    // Both arms written *before* the ending, so the closed reads have one thing to show and one to hide.
    const noteHostKey = randomUUID();
    const noteHost = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_host',
      p_body: `${NEEDLE_HOST} before the ending`, p_idempotency_key: noteHostKey }, { as: 'opSupport' });
    assert.equal(noteHost.status, 200, `a note on a live ticket answered ${json(shape(noteHost))}`);
    const noteOp = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_operator',
      p_body: `${NEEDLE_INTERNAL} before the ending`, p_idempotency_key: randomUUID() },
    { as: 'opSupport' });
    assert.equal(noteOp.status, 200, `the internal arm on a live ticket answered ${json(shape(noteOp))}`);
    await toStatus(ref, 'triaged');
    const closeKey = randomUUID();
    const closed = await toStatus(ref, 'closed', { code: 'host_withdrew', key: closeKey });
    assert.equal(col(ref, 'status'), 'closed', 'the walk to closed did not land');
    assert.equal(col(ref, 'assigned_operator_user_id'), '<null>',
      'C-08 needs a finished ticket nobody holds: the release refusal only scores the closure check if the '
      + 'empty-hand sentence is the next one that body would otherwise have said');
    const row = caseState(ref);
    // This ticket's own thread, not the table's row count. The first executed run measured the global count
    // as `65 !== 64` after the two replays: the paired control ticket opened below had bumped it by its own
    // keyless birth row, which is a legal append to a *different* thread and said nothing about this one.
    const thread = threadRows(ref).length;
    const trail = count('from private.audit_events', 'the whole trail at the closure');

    // The five doors that speak to one ticket, in the sentences each one states. Three of them were slice
    // 2's; the release is the one slice 2 left as prose and migration file 3 had to make a rule — and the
    // claim arm is the one whose absence was an escalation rather than a tidiness problem, because an
    // unassigned closed ticket passes every other branch in that body and would have been rewritten.
    await refusedRpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_operator',
      p_body: `${NEEDLE_INTERNAL} after the ending`, p_idempotency_key: randomUUID() },
    'opSupport', wire(400, '23514', SAY.closedNote), 'C-08 as a note on a finished ticket');
    await refusedRpc('operator_claim_case', { p_case_ref: ref, p_idempotency_key: randomUUID() },
      'opSupport', wire(400, '23514', SAY.closedClaim), 'C-08 as a claim on a finished ticket');
    await refusedRpc('reply_to_support_case', { p_case_ref: ref, p_body: `${NEEDLE_HOST} after the ending`,
      p_idempotency_key: randomUUID() }, 'hostA', wire(400, '23514', SAY.closedReply),
    'C-08 as a host reply on a finished ticket');
    await refusedRpc('operator_release_case', { p_case_ref: ref, p_idempotency_key: randomUUID() },
      'opSupport', wire(400, '23514', SAY.closedRelease), 'C-08 as a release of a finished ticket');
    // The transition door computes no closure check at all: it lets the row-level wall have the sentence, so
    // the door and the hand-written UPDATE a support tool could never issue meet the same words.
    await refusedRpc('operator_transition_case', { p_case_ref: ref, p_to_status: 'in_progress',
      p_resolution_code: null, p_body: null, p_idempotency_key: randomUUID() },
    'opSupport', wire(400, '23514', SAY.closedTerminal), 'C-08 as a reopen of a finished ticket');
    assert.equal(row, caseState(ref), 'a refused write on the finished ticket moved its row');
    assert.equal(threadRows(ref).length, thread,
      'a refused write on the finished ticket appended anyway');
    assert.equal(count('from private.audit_events', 'the trail count after the five refusals'), trail,
      'a refused write on the finished ticket recorded an act anyway');

    // The paired control that makes the release arm mean what it says: the same call, on a live ticket that
    // is equally unassigned, hears the empty-hand sentence instead. Without this the two refusals are
    // indistinguishable and closure was never actually measured.
    const live = await newCase('C-08 the ticket still open');
    await refusedRpc('operator_release_case', { p_case_ref: live, p_idempotency_key: randomUUID() },
      'opSupport', wire(400, '23514', SAY.nobodyHolds), 'C-08 as a release of a live unassigned ticket');

    // A double-clicked close that arrives after the first one landed is answered about the caller's stale
    // tab, not by the wall — the same-status branch sits above the UPDATE the wall guards.
    const again = await refusedRpc('operator_transition_case', { p_case_ref: ref, p_to_status: 'closed',
      p_resolution_code: 'host_withdrew', p_body: null, p_idempotency_key: randomUUID() },
    'opSupport', wire(400, '23514', SAY.alreadyStatus), 'C-08 as a second delivery of the same closing edge');
    assert.equal(String(again.body?.message).includes('closed'), true,
      `the already-status refusal did not name the status it refused: ${shown(again.body?.message).slice(0, 200)}`);

    // The half that has to stay true: closure refuses *new* acts and must not refuse the replay of an act it
    // already accepted. Each of these bodies pre-reads the key above its closure check, so a resubmitted
    // form after the ending is answered with the row it already bought rather than turned away with a
    // refusal that would push a desk into retrying a ticket that is finished.
    const noteReplay = await rpc('operator_add_case_note', { p_case_ref: ref, p_kind: 'message_host',
      p_body: `${NEEDLE_HOST} before the ending`, p_idempotency_key: noteHostKey }, { as: 'opSupport' });
    assert.equal(noteReplay.status, 200, `the replay of a pre-closure note answered ${json(shape(noteReplay))}`);
    assert.equal(noteReplay.body.replayed, true, 'a resubmitted note key on a closed ticket called itself new');
    assert.equal(noteReplay.body.seq, noteHost.body.seq, 'the replay of the note returned a different seq');
    const edgeReplay = await rpc('operator_transition_case', { p_case_ref: ref, p_to_status: 'closed',
      p_resolution_code: 'host_withdrew', p_body: null, p_idempotency_key: closeKey }, { as: 'opSupport' });
    assert.equal(edgeReplay.status, 200, `the replay of the closing edge answered ${json(shape(edgeReplay))}`);
    assert.equal(edgeReplay.body.replayed, true, 'a resubmitted closing edge called itself new');
    assert.equal(edgeReplay.body.audit_id, closed.audit_id,
      'the replay of the closing edge named a different trail row than the edge itself bought');
    assert.equal(threadRows(ref).length, thread,
      'a replay on a closed ticket appended anyway');
    assert.equal(count('from private.audit_events', 'the trail count after the two replays'), trail,
      'a replay on a closed ticket recorded a second act anyway');
    assert.equal(caseState(ref), row, 'a replay on a closed ticket moved its row');

    // Reads are not acts. The terminal rule ends what may be decided about a ticket, not what either party
    // may still see of it — and the read surfaces are the only place a host learns how their ticket ended.
    const hostView = await rpc('get_my_support_case', { p_case_ref: ref }, { as: 'hostA' });
    assert.equal(hostView.status, 200, `the host read of a closed ticket answered ${json(shape(hostView))}`);
    assert.equal(keysOf(hostView.body), EXPECT_KEYS.get_my_support_case,
      `the closed host read is not the projection the body builds: ${json(keysOf(hostView.body))}`);
    assert.equal(hostView.body.status, 'closed', 'the host read did not say the ticket ended');
    assert.equal(hostView.body.resolution_code, 'host_withdrew', 'the host read lost the code that ended it');
    assert.equal(hostView.body.reply_allowed, false, 'a closed ticket told its host a reply was allowed');
    assert.equal(hostView.body.resume_expected, false, 'a closed ticket told its host a reply would resume it');
    const hostEvents = JSON.stringify(hostView.body.events);
    assert.equal(hostEvents.includes(NEEDLE_HOST), true, 'the host read of a closed ticket lost the arm it owns');
    assert.equal(hostEvents.includes(NEEDLE_INTERNAL), false,
      'the internal arm of a closed ticket reached the host: closure does not relax §5, and it does not grant it');
    const opView = await rpc('get_operator_case', { p_case_ref: ref }, { as: 'opSupport' });
    assert.equal(opView.status, 200, `the operator read of a closed ticket answered ${json(shape(opView))}`);
    assert.equal(keysOf(opView.body), EXPECT_KEYS.get_operator_case,
      `the closed operator read is not the projection the body builds: ${json(keysOf(opView.body))}`);
    assert.equal(JSON.stringify(opView.body.events).includes(NEEDLE_INTERNAL), true,
      'the desk read of a closed ticket lost the arm the desk wrote');

    // And §4's payload discipline holds on the way in as well: neither needle reached the trail, in any column.
    const text = trailText(ref);
    for (const needle of [NEEDLE_HOST, NEEDLE_INTERNAL]) {
      assert.equal(text.includes(needle), false,
        `a caller's own text rode into the trail of ${ref}: ${shown(text).slice(0, 240)}`);
    }

    console.log(`  C-08  ${ref} closed through two legal edges, then refused all five doors that speak to a `
      + 'ticket — note, claim, reply, release, transition — each in its own sentence, each leaving the row '
      + `identical and the thread at ${thread} rows and the whole trail at ${trail}; the release refusal is `
      + 'paired with the same call on a live unassigned ticket, which answers the empty-hand sentence '
      + 'instead, and a second delivery of the closing edge is answered as already-status rather than by the '
      + 'wall; the note key and the closing key both replayed through the closure with the same seq and the '
      + 'same audit_id and wrote nothing; both read surfaces still answered 200 with their own key sets, the '
      + 'host side still blind to the internal arm and told reply_allowed=false');
  });

  test('C-09: one key is one act where the trail can see it, and one act per ticket where it cannot', async () => {
    // Three indexes state the rule, in three different scopes, and each body probes in exactly the scope its
    // own index covers:
    //   cases:152     support_cases_open_key_uniq          (requester_user_id, open_idempotency_key)
    //   cases:384     support_case_events_one_row_per_key  (case_id, idempotency_key)
    //   authority:246 audit_events_one_row_per_idempotency_key  (idempotency_key, whole table)
    // The first two are per-something; the third is global. So a door that writes a trail row is protected
    // across every ticket by the index alone, even though its body only looks inside one case, and a door
    // that writes no trail row is protected only within its own case. That seam — not the double click
    // C-01 already measured — is what this case is about.
    const trail0 = count('from private.audit_events', 'the whole trail before C-09');
    const a = await newCase('C-09 the ticket the key was spent on');
    const b = await newCase('C-09 the ticket the key was reused on');
    const key = randomUUID();
    const claimedA = await rpc('operator_claim_case', { p_case_ref: a, p_idempotency_key: key },
    { as: 'opSupport' });
    assert.equal(claimedA.status, 200, `the first delivery of C-09's claim key answered ${json(shape(claimedA))}`);
    harvest(claimedA.body);
    // The baseline for "nothing else was written" is taken *after* the call that was allowed to write, not
    // before it. The first executed run measured `70 !== 69` here, and the extra row was this accepted
    // claim's own `case_claimed` trail row — a legal append that the pre-claim baseline scored as a leak.
    const trailClaimed = count('from private.audit_events', 'the whole trail after the accepted claim');
    assert.equal(Number(trailClaimed), Number(trail0) + 1,
      `the accepted claim wrote ${Number(trailClaimed) - Number(trail0)} trail rows, and one act is one `
      + 'row here');
    const aRow = caseState(a);
    const bRow = caseState(b);
    const bThread = threadRows(b).length;

    // The reuse. The body's probe cannot see it — it filters on `case_id` — so the only thing standing
    // between this call and two decisions recorded under one key is the trail's own unique index. That
    // makes the answer an unhandled 23505 rather than a written sentence, and 23505's HTTP status is
    // something this repo has never measured, so the status is printed rather than asserted.
    const reused = await rpc('operator_claim_case', { p_case_ref: b, p_idempotency_key: key },
    { as: 'opSupport' });
    assert.notEqual(reused.status, 200,
      `a key the trail already recorded was accepted a second time on ${b}: ${json(shape(reused))}`);
    assert.equal(reused.body?.code, '23505',
      `the cross-case key reuse refused as ${reused.body?.code}, not as a unique violation: ${json(shape(reused))}`);
    assert.ok(String(reused.body?.message).includes('audit_events_one_row_per_idempotency_key'),
      `the refusal did not name the index that stopped it: ${shown(reused.body?.message).slice(0, 240)}`);
    // The half that makes it a rollback and not a partial write: the assignee update and the thread row the
    // body had already issued are both gone, and the first ticket's claim still stands exactly as it landed.
    assert.equal(caseState(b), bRow, 'the refused cross-case claim still moved the row of the second ticket');
    assert.equal(threadRows(b).length, bThread, 'the refused cross-case claim still appended to the second thread');
    assert.equal(caseState(a), aRow, 'the trail abort reached back and undid the claim that was accepted first');
    assert.equal(count('from private.audit_events', 'the whole trail after the refused claim'), trailClaimed,
      'the refused cross-case claim left a trail row behind anyway');

    // The same seam at the other door that records an act: a transition key spent on one ticket cannot buy
    // an edge on another, for the same reason and with the same footprint.
    const c = await newCase('C-09 the ticket that was triaged');
    const d = await newCase('C-09 the ticket the edge was reused on');
    const edgeKey = randomUUID();
    await toStatus(c, 'triaged', { key: edgeKey });
    const dRow = caseState(d);
    const reusedEdge = await rpc('operator_transition_case', { p_case_ref: d, p_to_status: 'triaged',
      p_resolution_code: null, p_body: null, p_idempotency_key: edgeKey }, { as: 'opSupport' });
    assert.notEqual(reusedEdge.status, 200,
      `a key that already bought an edge was accepted on ${d}: ${json(shape(reusedEdge))}`);
    assert.equal(reusedEdge.body?.code, '23505',
      `the reused edge refused as ${reusedEdge.body?.code}, not as a unique violation`);
    assert.equal(caseState(d), dRow, 'the refused edge still moved the second ticket to triaged');
    assert.equal(col(c, 'status'), 'triaged', 'the refused edge undid the ticket that legitimately triaged');

    // Now the doors that write no trail row at all — the note (cases:1085 states the silence is deliberate)
    // and the host's reply. Their only key index is the one per thread, so the same key on two tickets is
    // two accepted rows, and the trail count does not move because neither door speaks to the trail. This is
    // the honest limit of §4's rule, measured rather than described.
    const e = await newCase('C-09 the first note ticket');
    const f = await newCase('C-09 the second note ticket');
    // One baseline for the whole back half of this case — two notes, two replies, one replay each and one
    // intake — because all six of those calls are the doors that write no trail row. Leaving the count at
    // this number across all of them is the claim being measured; it is stronger than a per-block baseline,
    // which would let a stray trail row in an earlier block hide in the next one's comparison.
    const trailAtNotes = count('from private.audit_events', 'the whole trail before the no-trail doors');
    const noteKey = randomUUID();
    const note1 = await rpc('operator_add_case_note', { p_case_ref: e, p_kind: 'message_operator',
      p_body: `${NEEDLE_INTERNAL} first ticket`, p_idempotency_key: noteKey }, { as: 'opSupport' });
    const note2 = await rpc('operator_add_case_note', { p_case_ref: f, p_kind: 'message_operator',
      p_body: `${NEEDLE_INTERNAL} second ticket`, p_idempotency_key: noteKey }, { as: 'opSupport' });
    assert.equal(note1.status, 200, `the first note answered ${json(shape(note1))}`);
    assert.equal(note2.status, 200, `a note key reused on another ticket was refused: ${json(shape(note2))}`);
    assert.equal(note1.body.replayed, false, 'the first note called itself a replay');
    assert.equal(note2.body.replayed, false,
      'the second ticket treated the reused key as its own replay, which would describe a row it does not have');
    assert.equal(note2.body.seq, note1.body.seq,
      `the two threads numbered their second row differently (${note1.body.seq} and ${note2.body.seq}), so `
      + 'the minted ordinal is not per case as the sequence definition says');
    assert.equal(armCount(e, 'message_operator'), '1', 'the reused key bought more than one row on the first thread');
    assert.equal(armCount(f, 'message_operator'), '1', 'the reused key bought more than one row on the second');
    assert.equal(keyedCount(e), '1', 'the first thread holds a keyed row its own index does not account for');
    assert.equal(keyedCount(f), '1', 'the second thread holds a keyed row its own index does not account for');
    assert.equal(col(e, 'status'), 'open', 'the note moved a status it has no argument for');
    assert.equal(count('from private.audit_events', 'the whole trail after the two notes'), trailAtNotes,
      'a note wrote the trail this stage deliberately keeps notes out of');
    // Same key, same second ticket, same kind — and only now is it a replay, because that is the scope the
    // events index actually covers.
    const fThread = threadRows(f).length;
    const noteAgain = await rpc('operator_add_case_note', { p_case_ref: f, p_kind: 'message_operator',
      p_body: `${NEEDLE_INTERNAL} second ticket`, p_idempotency_key: noteKey }, { as: 'opSupport' });
    assert.equal(noteAgain.body.replayed, true, 'a third delivery inside the same ticket was not a replay');
    assert.equal(noteAgain.body.seq, note2.body.seq, 'the replay returned a different seq');
    assert.equal(threadRows(f).length, fThread, 'the replay appended a second row to the thread');

    // The host's reply door has the same shape — one keyed event row and no trail row — so one key answers
    // twice across that host's own two tickets and is a replay only inside one of them.
    const g = await newCase('C-09 the first reply ticket');
    const h = await newCase('C-09 the second reply ticket');
    const replyKey = randomUUID();
    const reply1 = await rpc('reply_to_support_case', { p_case_ref: g, p_body: `${NEEDLE_HOST} first`,
      p_idempotency_key: replyKey }, { as: 'hostA' });
    const reply2 = await rpc('reply_to_support_case', { p_case_ref: h, p_body: `${NEEDLE_HOST} second`,
      p_idempotency_key: replyKey }, { as: 'hostA' });
    assert.equal(reply1.status, 200, `the first reply answered ${json(shape(reply1))}`);
    assert.equal(reply2.status, 200,
      `a reply key reused on the same host's second ticket was refused: ${json(shape(reply2))}`);
    assert.equal(reply2.body.replayed, false, 'the second ticket claimed a reply it had not made as its own');
    assert.equal(armCount(h, 'message_host'), '1', 'the reused reply key appended twice to one thread');
    assert.equal(count('from private.audit_events', 'the whole trail after the two replies'), trailAtNotes,
      'a host reply wrote a trail row, which the reply body does not insert');
    const replyAgain = await rpc('reply_to_support_case', { p_case_ref: h, p_body: `${NEEDLE_HOST} second`,
      p_idempotency_key: replyKey }, { as: 'hostA' });
    assert.equal(replyAgain.body.replayed, true, 'a third delivery of one reply inside one ticket was not a replay');
    assert.equal(replyAgain.body.seq, reply2.body.seq, 'the reply replay returned a different seq');
    assert.equal(armCount(h, 'message_host'), '1', 'the reply replay appended the same paragraph twice');

    // And the intake door, which the trail cannot reach from either direction: a key already recorded for an
    // operator's act still opens a ticket, because opening is recorded by the case row it mints rather than
    // by a trail row. Asserting this as accepted is what keeps the three above from reading like a rule with
    // no boundary.
    const openedAfter = await rpc('open_support_case', { p_wedding_id: weddingOf('hostB'),
      p_category: 'other', p_severity: 'normal', p_summary: `C-09 reuses an act key (${RUN_TAG})`,
      p_idempotency_key: key }, { as: 'hostB' });
    assert.equal(openedAfter.status, 200,
      `the intake door refused a key the trail already holds: ${json(shape(openedAfter))}`);
    assert.equal(openedAfter.body.replayed, false, 'the intake door claimed a replay of a ticket it did not make');
    caseRefs.push(openedAfter.body.case_ref);
    assert.equal(count('from private.audit_events', 'the whole trail after the intake arm'), trailAtNotes,
      'opening a ticket wrote the trail, which slice 2 says it does not');

    console.log(`  C-09  one key bought a claim on ${a} and was refused on ${b} as 23505 naming `
      + `audit_events_one_row_per_idempotency_key at HTTP ${reused.status}, taking the assignee update and `
      + 'the thread row back with it while the first claim stayed exactly as it landed; the same seam stopped '
      + `a reused edge at HTTP ${reusedEdge.status} on ${d} and left ${c} triaged; the two doors that write no `
      + 'trail row accepted the same key on two tickets as two real rows and never touched the trail, then '
      + 'answered the third delivery inside one ticket as the replay its per-thread index actually covers; '
      + 'and the intake door, which the trail index cannot see in either direction, still opened a ticket on '
      + 'that spent key — the boundary of the rule, measured');
  });
});

// =========================================================================== T
// §6's two acts, over the wire. The SQL tier proved the guards exist; what only this tier can prove is the
// claim the design makes to a couple holding a printed card — that a takedown closes the two doors a reader
// knocks on, and does *not* close the file link that was handed out before it, because no statement in that
// call touches the bucket. So every case here reads a door or a byte store on both sides of the act, and a
// refusal is only a refusal when the same reads say nothing moved.
//
// A-04's door-opening arms consume the cast's fixtures — it takes the probe wedding down — so this group
// builds two weddings of its own on hostC. `Hotel` is published and carries one `ready` artefact with real
// bytes plus one `registered` artefact whose bytes exist but which never earned a digest, so the plan's
// exclusion is measured against a file that is genuinely in the bucket. `India` is retired by its *host*
// through `revoke_invitation_publication`, the one route that produces a revoked publication with no
// `publication_takedown` trail row, which is the only way to reach the purge body's ordering refusal.
describe('S11 T a published invitation taken down, and the files that outlive it', () => {
  const fx = {};
  /** One publication row as the table holds it: the projection cannot be asked whether it was revoked. */
  const pubState = (weddingId, label) => cell(`
    select 'status=' || status || ' revoked_at=' || (revoked_at is not null)::text
      || ' version=' || version_id
    from public.publications where wedding_id = '${weddingId}'`, `the publication of ${label}`);
  const pubIdOf = (weddingId, label) => cell(`select id::text from public.publications
    where wedding_id = '${weddingId}'`, `the publication id of ${label}`);
  /** The two kinds §6 step 1 revokes, kept apart from the kinds it deliberately leaves alone. */
  const tokenState = (weddingId, label) => cell(`
    select 'live_public=' || count(*) filter (where token_kind = 'public_invitation'
                                                 and revoked_at is null)::text
      || ' live_guest=' || count(*) filter (where token_kind = 'guest_invitation'
                                             and revoked_at is null)::text
      || ' live_other=' || count(*) filter (where token_kind not in ('public_invitation','guest_invitation')
                                             and revoked_at is null)::text
      || ' total=' || count(*)::text
    from private.access_tokens where wedding_id = '${weddingId}'`, `the credentials of ${label}`);
  const bucketCount = () => count(`from storage.objects where bucket_id = '${OUTPUT_BUCKET}'`,
    'the objects in the output bucket');
  const linkRows = (ref) => count(`from private.support_case_events e
      join private.support_cases c on c.id = e.case_id
     where c.case_ref = '${ref}' and e.kind = 'operation_link'`, `the operation_link rows on ${ref}`);
  const trailRows = (weddingId, action) => sqlRows(`
    select 'kind=' || actor_kind || ' actor=' || coalesce(actor_user_id::text, '-')
      || ' subject=' || coalesce(subject_type, '-') || '/' || coalesce(subject_key::text, '-')
      || ' key=' || coalesce(idempotency_key, '-')
    from private.audit_events where wedding_id = '${weddingId}' and action = '${action}' order by id`);
  const trailReason = (weddingId, action) => cell(`
    select coalesce(left(reason, 240), '<null>') from private.audit_events
     where wedding_id = '${weddingId}' and action = '${action}' order by id limit 1`,
    `the reason on the ${action} trail row`);
  const invalidAt = (key) => cell(`select coalesce(left(invalidated_at::text, 4), '<null>')
    from public.invitation_outputs where object_key = '${key}'`, `the invalidation stamp of ${key.slice(-8)}`);
  /** The two doors a reader actually knocks on. Both are argument-less and take the credential from a
   *  request header, which is the only spelling that reaches a digest. */
  const openPublicDoor = (cred) => rpc('resolve_public_invitation', {},
    { headers: { 'x-invitation-token': cred } });
  const openGuestDoor = (cred) => rpc('resolve_guest_invitation', {},
    { headers: { 'x-guest-token': cred } });
  /** The stores the takedown family could move, as thunks `refusedDoor` can re-read. */
  const takedownProbes = (ref) => [
    { what: 'the output bucket', get: bucketCount },
    { what: 'the manifest', get: () => count('from public.invitation_outputs', 'the manifest') },
    { what: 'the whole trail', get: () => count('from private.audit_events', 'the whole trail') },
    { what: `the operation_link rows on ${ref}`, get: () => linkRows(ref) },
  ];

  before(async () => {
    fx.live = await buildWedding('hostC', 'Hotel');
    fx.case = await openCase('hostC', fx.live.weddingId, { category: 'publication_delivery',
      severity: 'high', summary: `A ticket that authorises the takedown battery (${RUN_TAG})` });
    fx.guestCred = (await issueGuest('hostC', fx.live)).guestCred;
    fx.publicCred = credFrom(fx.live.publicPath, '/i/');
    fx.registeredKey = registerOutput(fx.live, '1080x1620');
    fx.readyKey = registerOutput(fx.live, '1080x1350');
    const digest = await uploadObject(fx.readyKey);
    moveOutput(fx.readyKey, 'uploading', null);
    moveOutput(fx.readyKey, 'ready', digest);
    // Bytes for a row that never earned a digest, planted on purpose: the plan's rule is about the manifest
    // column, and a bucket with nothing in it would let a plan that listed *files* pass the same assert.
    await uploadObject(fx.registeredKey);
    assert.equal(outputRow(fx.registeredKey), 'status=registered reason=- digest=-',
      'the registered artefact arrived with a digest, so the plan below would not be excluding anything');

    // A second wedding, retired the host's own way. This is the shape the purge's ordering refusal needs:
    // a revoked publication that no operator ever took down.
    fx.retired = await buildWedding('hostC', 'India');
    fx.retiredCase = await openCase('hostC', fx.retired.weddingId, { category: 'publication_delivery',
      severity: 'normal', summary: `A ticket about a publication its host already retired (${RUN_TAG})` });
    const hostRevoke = await rpc('revoke_invitation_publication',
      { p_wedding_id: fx.retired.weddingId }, { as: 'hostC' });
    assert.equal(hostRevoke.status, 200, `the host's own revocation answered ${json(shape(hostRevoke))}`);
    assert.equal(pubState(fx.retired.weddingId, 'India'),
      `status=revoked revoked_at=true version=${fx.retired.versionId}`,
      `the host route did not leave India revoked, so the ordering refusal below would be about the wrong `
      + 'fact and not about a missing takedown record');
    assert.deepEqual(trailRows(fx.retired.weddingId, 'publication_takedown'), [],
      'the host route wrote a publication_takedown row, so purgeNoTakedown below would not be refusing a '
      + 'missing record');

    // A case this group closes, for the arm that proves the authorising case is checked before the
    // "is it still live" question — which only matters now that Hotel is about to stop being live.
    fx.closedCase = await openCase('hostC', fx.live.weddingId, { category: 'other',
      severity: 'low', summary: `A ticket this group closes and then misuses (${RUN_TAG})` });
    const closed = await rpc('operator_transition_case', { p_case_ref: fx.closedCase,
      p_to_status: 'closed', p_resolution_code: 'no_action_needed', p_body: null,
      p_idempotency_key: randomUUID() }, { as: 'opSupport' });
    assert.equal(closed.status, 200, `the walk to closed on ${fx.closedCase} answered ${json(shape(closed))}`);
    harvest(closed.body);
    assert.equal(cell(`select status from private.support_cases where case_ref = '${fx.closedCase}'`,
      'the status of the ticket this group closes'), 'closed',
      'the case that is supposed to be terminal is not, so the refusal that cites it would prove nothing');

    // Two more published weddings, kept apart on purpose. `Jasmine` is never taken down: the purge's
    // "retire it first" refusal needs a wedding whose publication is still active, and the takedown's
    // cross-wedding key refusal needs a live case about a wedding the spent key does not name. `Marigold`
    // is taken down inside T-03, which is the group's only accepted takedown after Hotel has stopped being
    // live — and its recorded takedown key is what makes the purge's distinct-key check measurable against a
    // *second* publication rather than only against the one it was minted on.
    fx.planner = await buildWedding('hostD', 'Jasmine');
    fx.plannerCase = await openCase('hostD', fx.planner.weddingId, { category: 'publication_delivery',
      severity: 'normal', summary: `A ticket about a publication that stays live (${RUN_TAG})` });
    fx.spare = await buildWedding('hostD', 'Marigold');
    fx.spareCase = await openCase('hostD', fx.spare.weddingId, { category: 'publication_delivery',
      severity: 'high', summary: `A ticket this group takes down for real (${RUN_TAG})` });
  });

  test('T-01: the plan names the artefacts that earned bytes, lists no file that did not, and touches nothing', async () => {
    const before = {
      bucket: await bucketCount(),
      manifest: count('from public.invitation_outputs', 'the manifest'),
      trail: count('from private.audit_events', 'the whole trail'),
      links: linkRows(fx.case),
      ready: outputRow(fx.readyKey),
      registered: outputRow(fx.registeredKey),
      publication: pubState(fx.live.weddingId, 'Hotel'),
      readyBytes: await signedFetch(fx.readyKey),
      registeredBytes: await signedFetch(fx.registeredKey),
    };
    const r = await rpc('operator_takedown_plan', { p_wedding_id: fx.live.weddingId }, { as: 'opOps' });
    assert.equal(r.status, 200, `the Hotel plan answered ${json(shape(r))}`);
    projection('operator_takedown_plan', r.body, 'the Hotel plan');
    assert.equal(String(r.body.publication_id), pubIdOf(fx.live.weddingId, 'Hotel'),
      'the plan named a publication that is not the wedding\'s row');
    assert.equal(r.body.publication_status, 'active', 'the plan called a live publication anything else');
    assert.equal(String(r.body.version_id), fx.live.versionId, 'the plan planned against another version');
    assert.deepEqual(r.body.object_keys, [fx.readyKey],
      `the plan's list is not the one row that earned a digest: ${json(r.body.object_keys)}`);
    assert.equal(String(r.body.count), '1', `the plan counted ${json(r.body.count)} rows, not the one `
      + 'digest-bearing row the SQL read finds');
    assert.equal(r.body.deletes_anything, false, 'a read surface claimed it deletes');

    const after = {
      bucket: await bucketCount(),
      manifest: count('from public.invitation_outputs', 'the manifest'),
      trail: count('from private.audit_events', 'the whole trail'),
      links: linkRows(fx.case),
      ready: outputRow(fx.readyKey),
      registered: outputRow(fx.registeredKey),
      publication: pubState(fx.live.weddingId, 'Hotel'),
      readyBytes: await signedFetch(fx.readyKey),
      registeredBytes: await signedFetch(fx.registeredKey),
    };
    assert.deepEqual(after, before, 'the plan moved something it was only meant to describe');

    // The two `check_violation` refusals, each with the stores re-read, and the presence control that shows
    // the door answers for a published wedding rather than refusing everything it is handed.
    await refusedDoor('operator_takedown_plan', { p_wedding_id: null }, 'opOps',
      httpWire(400, '23514', SAY.planNeedsWedding), 'a plan with no wedding', takedownProbes(fx.case));
    await refusedDoor('operator_takedown_plan', { p_wedding_id: weddingOf('hostV') }, 'opOps',
      httpWire(400, '23514', SAY.planNoPublication), 'a plan against a wedding that never published',
      takedownProbes(fx.case));
    await refusedDoor('operator_takedown_plan', { p_wedding_id: fx.live.weddingId }, 'opFinance',
      httpWire(403, '42501', SAY.planNo), 'a plan from the finance desk', takedownProbes(fx.case));
    await refusedDoor('operator_takedown_plan', { p_wedding_id: fx.live.weddingId }, 'hostC',
      httpWire(403, '42501', SAY.planNo), 'a plan from the host of the wedding itself',
      takedownProbes(fx.case));

    const control = await rpc('operator_takedown_plan', { p_wedding_id: weddingOf('hostA') },
      { as: 'opOps' });
    assert.equal(control.status, 200, `the published-wedding control answered ${json(shape(control))}, so `
      + 'the two refusals above could be a cold schema cache rather than the database speaking');
    assert.equal(control.body.publication_status, 'active',
      `the control did not find Alpha live: ${json(control.body)}`);

    console.log(`  T-01  the Hotel plan named publication ${json(String(r.body.publication_id).slice(0, 8))}…`
      + ' as active and listed exactly the one digest-bearing key while the bucket held '
      + `${json(String(before.bucket))} objects and a second artefact had bytes without a digest; four `
      + 'refusals (no wedding, never-published, finance desk, the host itself) each left the bucket, the '
      + 'manifest, the trail and the ticket link where they were, and the same door answered 200 for a '
      + 'published wedding');
  });

  test('T-02: one recorded takedown closes both doors, invalidates the ready artefact, and leaves the bytes exactly where they are', async () => {
    const tokensBefore = tokenState(fx.live.weddingId, 'Hotel');
    const liveBefore = Number(tokensBefore.match(/live_public=(\d+)/)[1])
      + Number(tokensBefore.match(/live_guest=(\d+)/)[1]);
    const readyCountBefore = count(`from public.invitation_outputs where version_id = '${fx.live.versionId}'
      and status = 'ready'`, 'the ready rows of Hotel');
    const bucketBefore = await bucketCount();
    const readyBytesBefore = await signedFetch(fx.readyKey);
    const registeredBytesBefore = await signedFetch(fx.registeredKey);
    const trailBefore = count('from private.audit_events', 'the whole trail');
    const pubDoorBefore = door(await openPublicDoor(fx.publicCred));
    const guestDoorBefore = door(await openGuestDoor(fx.guestCred));
    assert.equal(pubDoorBefore.available, true, `the public door did not serve before the takedown: `
      + `${json(pubDoorBefore)}`);
    assert.equal(guestDoorBefore.available, true, `the guest door did not serve before the takedown: `
      + `${json(guestDoorBefore)}`);
    assert.notEqual(pubDoorBefore.serves, '', 'the live public door served an empty invitation');

    fx.takedownKey = randomUUID();
    const args = { p_wedding_id: fx.live.weddingId, p_case_ref: fx.case, p_reason: 'safety',
      p_idempotency_key: fx.takedownKey };
    const r = await rpc('operator_takedown_publication', args, { as: 'opOps' });
    assert.equal(r.status, 200, `the takedown answered ${json(shape(r))}`);
    harvest(r.body);
    projection('operator_takedown_publication', r.body, 'the Hotel takedown');
    fx.answer = r.body;
    assert.equal(r.body.replayed, false, 'the first delivery of a fresh key called itself a replay');
    assert.equal(r.body.case_ref, fx.case, 'the answer named a ticket other than the one that authorised it');
    assert.equal(r.body.reason_category, 'safety', 'the answer lost the reason it was given');
    assert.equal(String(r.body.publication_id), pubIdOf(fx.live.weddingId, 'Hotel'),
      'the answer named a publication other than the wedding\'s row');
    assert.equal(String(r.body.credentials_revoked), String(liveBefore),
      `the answer revoked ${json(r.body.credentials_revoked)} credentials while ${liveBefore} public and `
      + `guest tokens were live beforehand: ${tokensBefore}`);
    assert.equal(String(r.body.outputs_invalidated), readyCountBefore,
      `the answer invalidated ${json(r.body.outputs_invalidated)} artefacts while ${readyCountBefore} were `
      + 'ready beforehand');
    assert.equal(r.body.file_links_still_valid_until_object_purge, true,
      'the answer denied that a file link still works, which is the claim §6 makes to a couple holding a card');
    assert.equal(r.body.objects_deleted_by_this_call, false, 'the answer claimed it deleted an object');
    assert.equal(r.body.purge_function, 'internal_api.operator_purge_publication_objects',
      'the answer named a purge function other than the one with no door');

    // Both doors, after. The dead-credential answer is the body's own constant: one key, false.
    const pubDoor = door(await openPublicDoor(fx.publicCred));
    const guestDoor = door(await openGuestDoor(fx.guestCred));
    assert.equal(pubDoor.status, 200, `the closed public door answered HTTP ${json(pubDoor.status)}`);
    assert.equal(pubDoor.available, false, `the public door still serves after a takedown: ${json(pubDoor)}`);
    assert.equal(pubDoor.keys, 'available', `the closed public door carried more than its one key: `
      + `${json(pubDoor.keys)}`);
    assert.equal(guestDoor.available, false, `the guest door still serves after a takedown: `
      + `${json(guestDoor)}`);
    assert.equal(guestDoor.keys, 'available', `the closed guest door carried more than its one key: `
      + `${json(guestDoor.keys)}`);

    assert.equal(pubState(fx.live.weddingId, 'Hotel'),
      `status=revoked revoked_at=true version=${fx.live.versionId}`, 'the publication row is not revoked');
    assert.equal(tokenState(fx.live.weddingId, 'Hotel'),
      `live_public=0 live_guest=0 live_other=${tokensBefore.match(/live_other=(\d+)/)[1]}`
      + ` total=${tokensBefore.match(/total=(\d+)/)[1]}`,
      `the credential row changed shape rather than being marked: was ${tokensBefore}`);
    const readyNow = outputRow(fx.readyKey);
    assert.ok(readyNow.startsWith('status=invalidated reason=publication_revoked digest='),
      `the ready artefact did not become invalidated for the stated reason: ${json(readyNow)}`);
    assert.notEqual(invalidAt(fx.readyKey), '<null>', 'the lifecycle stamp was left for the reader to infer');
    assert.equal(outputRow(fx.registeredKey), 'status=registered reason=- digest=-',
      'the takedown touched an artefact that was never ready, which §6\'s Decision 5 refuses');

    assert.equal(await bucketCount(), bucketBefore,
      `the bucket went from ${json(bucketBefore)} objects to ${json(await bucketCount())}, so the takedown `
      + 'deleted bytes it says it did not delete');
    assert.deepEqual(await signedFetch(fx.readyKey), readyBytesBefore,
      'the invalidated artefact\'s own file link stopped working, which is the opposite of the answer\'s claim');
    assert.deepEqual(await signedFetch(fx.registeredKey), registeredBytesBefore,
      'the untouched artefact\'s file link moved');

    assert.equal(linkRows(fx.case), '1', `the takedown wrote ${json(linkRows(fx.case))} operation_link rows`);
    const rows = trailRows(fx.live.weddingId, 'publication_takedown');
    assert.equal(rows.length, 1, `the act wrote ${rows.length} trail rows: ${json(rows)}`);
    assert.equal(count('from private.audit_events', 'the whole trail after the takedown'),
      String(Number(trailBefore) + 1), 'the takedown wrote a trail row nobody asked for as well');
    assert.equal(rows[0], `kind=operator actor=${uidOf('opOps')} subject=publication/`
      + `${pubIdOf(fx.live.weddingId, 'Hotel')} key=${fx.takedownKey}`,
      `the trail row is not the one §4 describes: ${json(rows[0])}`);
    const reason = trailReason(fx.live.weddingId, 'publication_takedown');
    assert.ok(reason.includes(`citing case ${fx.case} as safety`),
      `the trail reason does not name the ticket and the reason together: ${shown(reason)}`);
    assert.ok(reason.includes('no object deleted'),
      `the trail reason does not carry the limit the answer carries: ${shown(reason)}`);

    console.log('  T-02  one call closed both doors to exactly ' + json({ available: false })
      + ` (${liveBefore} credentials revoked, ${readyCountBefore} artefact invalidated), stamped the `
      + 'manifest row `publication_revoked`, left the bucket at the same count with the same bytes behind '
      + 'the same link, and wrote one operation_link row and one operator trail row whose reason cites the '
      + 'ticket as safety');
  });

  test('T-03: the takedown\'s guards answer in the migration\'s order and only the last one asks whether the publication is still live', async () => {
    // Each arm below is the first argument that is wrong while every earlier one is right, and all of them
    // are aimed at Hotel — the wedding T-02 has already taken down. That is what turns seven refusals into
    // one measurement of the *order*: if the "is it still live" question came before the ticket question,
    // every arm here would answer `no active publication`, and a stranger guessing a ref would be told the
    // state of a wedding it cannot reach.
    const probes = takedownProbes(fx.case);
    const args = (reason, key, ref = fx.case) => ({ p_wedding_id: fx.live.weddingId, p_case_ref: ref,
      p_reason: reason, p_idempotency_key: key });

    await refusedDoor('operator_takedown_publication', args('shrug', randomUUID()), 'opOps',
      httpWire(400, '23514', SAY.takedownReason, "'shrug'"),
      'a takedown citing a reason outside the five', probes);
    await refusedDoor('operator_takedown_publication', args(null, randomUUID()), 'opOps',
      httpWire(400, '23514', SAY.takedownReason, 'NULL: the five are'),
      'a takedown citing no reason at all', probes);
    await refusedDoor('operator_takedown_publication', args('safety', null), 'opOps',
      httpWire(400, '23514', SAY.takedownKey), 'a takedown with no idempotency key', probes);
    await refusedDoor('operator_takedown_publication', args('safety', randomUUID(), fx.closedCase), 'opOps',
      httpWire(403, '42501', SAY.takedownNo), 'a takedown authorised by a ticket this run closed',
      takedownProbes(fx.closedCase));
    await refusedDoor('operator_takedown_publication', args('safety', randomUUID(), fx.retiredCase), 'opOps',
      httpWire(403, '42501', SAY.takedownNo), 'a live ticket about a different wedding than the one ordered',
      takedownProbes(fx.retiredCase));
    await refusedDoor('operator_takedown_publication', args('safety', randomUUID(), NOT_A_CASE_REF), 'opOps',
      httpWire(403, '42501', SAY.takedownNo), 'a takedown authorised by a ticket that was never minted',
      probes);
    await refusedDoor('operator_takedown_publication', args('safety', randomUUID()), 'opSupport',
      httpWire(403, '42501', SAY.takedownNo), 'a takedown ordered by the support desk', probes);
    await refusedDoor('operator_takedown_publication', args('safety', randomUUID()), 'hostC',
      httpWire(403, '42501', SAY.takedownNo), 'a takedown ordered by the wedding\'s own host', probes);

    // The same wedding, the same reason, the same fresh key — and now the sentence is about the publication,
    // because the ticket is live. This is the arm the seven above are only worth having for.
    await refusedDoor('operator_takedown_publication', args('safety', randomUUID()), 'opOps',
      httpWire(400, '23514', SAY.noPublication), 'the open ticket on a publication T-02 already retired',
      probes);

    // And the door does answer for a wedding that is still live. Hotel cannot be taken down again, so the
    // accepted path is measured on Marigold, whose own ticket is open.
    assert.equal(pubState(fx.spare.weddingId, 'Marigold'),
      `status=active revoked_at=false version=${fx.spare.versionId}`,
      'Marigold is not live before the control takedown, so the accepted answer below would be about nothing');
    assert.equal(count(`from public.invitation_outputs where wedding_id = '${fx.spare.weddingId}'`,
      'Marigold\'s manifest rows'), '0', 'Marigold carries artefacts, so the zero below would not be a '
      + 'measurement of a wedding with nothing to invalidate');
    const spareTokens = tokenState(fx.spare.weddingId, 'Marigold');
    const spareLive = Number(spareTokens.match(/live_public=(\d+)/)[1])
      + Number(spareTokens.match(/live_guest=(\d+)/)[1]);
    assert.ok(spareLive >= 1, `a published wedding with no live credential to revoke: ${spareTokens}`);
    fx.spareKey = randomUUID();
    const t = await rpc('operator_takedown_publication',
      { p_wedding_id: fx.spare.weddingId, p_case_ref: fx.spareCase, p_reason: 'legal',
        p_idempotency_key: fx.spareKey }, { as: 'opOps' });
    assert.equal(t.status, 200, `the Marigold control takedown answered ${json(shape(t))}`);
    projection('operator_takedown_publication', t.body, 'the Marigold control takedown');
    assert.equal(t.body.replayed, false, 'the control takedown of a fresh key called itself a replay');
    assert.equal(t.body.reason_category, 'legal', 'the control did not carry the reason it was given, so '
      + 'the vocabulary arm above would be untested rather than tested');
    assert.equal(String(t.body.credentials_revoked), String(spareLive),
      `the control revoked ${json(t.body.credentials_revoked)} of ${spareLive} credentials`);
    assert.equal(String(t.body.outputs_invalidated), '0',
      'a wedding with no artefacts reported that it invalidated one, which would make Hotel\'s count of one '
      + 'a coincidence rather than a measurement');
    assert.equal(pubState(fx.spare.weddingId, 'Marigold'),
      `status=revoked revoked_at=true version=${fx.spare.versionId}`,
      'the control takedown did not retire the publication it named');
    assert.equal(linkRows(fx.spareCase), '1', `the control wrote ${json(linkRows(fx.spareCase))} ticket `
      + 'links on Marigold\'s ticket');
    assert.deepEqual(trailRows(fx.spare.weddingId, 'publication_takedown'),
      [`kind=operator actor=${uidOf('opOps')} subject=publication/`
        + `${pubIdOf(fx.spare.weddingId, 'Marigold')} key=${fx.spareKey}`],
      'the control takedown is not on the trail in the shape the migration inserts');

    console.log(`  T-03  eight refusals on the retired Hotel, each the first wrong argument with every `
      + `earlier one right, answered in the migration's own order — reason vocabulary (with 'shrug' and with `
      + `NULL), then the missing key, then the closed ticket, the other wedding's ticket and the `
      + `never-minted ref as the same 403 sentence, then the support desk and the host — and only the open `
      + `ticket on the dead publication reached 'no active publication' at 400; Marigold then went down for `
      + 'real and invalidated nothing while Hotel invalidated one');
  });

  test('T-04: the spent key answers with the first delivery\'s own fields, and one key cannot buy a second act', async () => {
    // The ordering proof in one line: T-03's last arm refuses this wedding with 400 and this call answers
    // 200, and the only thing that differs between them is the key. The replay is read before the live
    // question because "there is no active publication" is the *consequence* of the first delivery.
    const bucketBefore = await bucketCount();
    const manifestBefore = count('from public.invitation_outputs', 'the manifest');
    const trailBefore = count('from private.audit_events', 'the whole trail');
    const linksBefore = linkRows(fx.case);
    const rowsBefore = trailRows(fx.live.weddingId, 'publication_takedown').length;
    const pubBefore = pubState(fx.live.weddingId, 'Hotel');
    const readyBefore = outputRow(fx.readyKey);

    const r = await rpc('operator_takedown_publication', { p_wedding_id: fx.live.weddingId,
      p_case_ref: fx.case, p_reason: 'safety', p_idempotency_key: fx.takedownKey }, { as: 'opOps' });
    assert.equal(r.status, 200, `the spent key answered ${json(shape(r))} where T-03's fresh key on the `
      + 'same wedding and ticket answered 400, so the replay is not being read after the live question');
    projection('operator_takedown_publication', r.body, 'the Hotel takedown replay');
    assert.deepEqual(r.body, { ...fx.answer, replayed: true },
      'the replay answered with a paraphrase instead of the first delivery\'s own stored payload');
    harvest(r.body);

    assert.equal(await bucketCount(), bucketBefore, 'the replay touched the bucket');
    assert.equal(count('from public.invitation_outputs', 'the manifest'), manifestBefore,
      'the replay touched the manifest');
    assert.equal(count('from private.audit_events', 'the whole trail'), trailBefore,
      'the replay wrote a second trail row');
    assert.equal(linkRows(fx.case), linksBefore, 'the replay linked the ticket a second time');
    assert.equal(trailRows(fx.live.weddingId, 'publication_takedown').length, rowsBefore,
      'the replay added a row to this wedding\'s takedown history');
    assert.equal(pubState(fx.live.weddingId, 'Hotel'), pubBefore, 'the replay moved the publication row');
    assert.equal(outputRow(fx.readyKey), readyBefore, 'the replay re-stamped the invalidated artefact');
    const pubDoor = door(await openPublicDoor(fx.publicCred));
    const guestDoor = door(await openGuestDoor(fx.guestCred));
    assert.equal(pubDoor.available, false, 'the replay re-opened the public door');
    assert.equal(guestDoor.available, false, 'the replay re-opened the guest door');

    // One uuid, one action. The key that took Hotel down is handed to the same door for a live wedding with
    // its own live ticket, so every guard before the replay passes and the subject comparison is what speaks.
    assert.equal(pubState(fx.planner.weddingId, 'Jasmine'),
      `status=active revoked_at=false version=${fx.planner.versionId}`,
      'Jasmine is not live, so the refusal below could be the live question rather than the key');
    await refusedDoor('operator_takedown_publication', { p_wedding_id: fx.planner.weddingId,
      p_case_ref: fx.plannerCase, p_reason: 'safety', p_idempotency_key: fx.takedownKey }, 'opOps',
      httpWire(400, '23514', SAY.keyOtherAct), 'Hotel\'s takedown key spent on Jasmine\'s live publication',
      takedownProbes(fx.plannerCase));
    assert.equal(pubState(fx.planner.weddingId, 'Jasmine'),
      `status=active revoked_at=false version=${fx.planner.versionId}`,
      'the refused cross-wedding key still took Jasmine down');

    console.log('  T-04  the spent key answered 200 with the first delivery\'s payload byte-for-byte and only '
      + `replayed flipped (${json(String(r.body.audit_id))} both times, ${linksBefore} link row, `
      + `${rowsBefore} trail row, ${json(String(bucketBefore))} objects in the bucket and both doors still `
      + `available=false), while the same uuid at a live wedding's own ticket answered 400 'one key is one `
      + 'action');
  });

  test('T-05: the body with no door walks its guards on the trusted channel, plans the file the takedown left behind, and deletes nothing', async () => {
    // A-05 already proved a client cannot reach this function — no `api` wrapper, zero EXECUTE grants, and a
    // well-formed POST to the exposed schema refused. What only the trusted channel can show is the ladder
    // itself, in order: the named actor before the key, the key before the ticket, the ticket before the
    // retirement, the retirement before the recorded takedown, and that record before the distinct-key rule
    // that keeps one click from being both the decision and its own confirmation.
    const actor = uidOf('opOps');
    const call = (ref, who, key) => 'internal_api.operator_purge_publication_objects('
      + `'${ref}', ${who === null ? 'NULL' : `'${who}'`}, ${key === null ? 'NULL' : `'${key}'`})`;
    const snapshot = (ref, weddingId) => [
      count('from public.invitation_outputs', 'the whole manifest'),
      count('from private.audit_events', 'the whole trail'),
      linkRows(ref),
      cell(`select coalesce(string_agg(status || '/' || coalesce(invalidation_reason, '-'), ',' `
        + `order by object_key), '-') from public.invitation_outputs where wedding_id = '${weddingId}'`,
        'this wedding\'s artefact states'),
    ].join(' | ');
    const refusedOnChannel = (fnCall, want, what, ref, weddingId) => {
      const before = snapshot(ref, weddingId);
      refused(`PERFORM ${fnCall}`, want, what);
      assert.equal(snapshot(ref, weddingId), before,
        `${what} was refused on the trusted channel and still moved one of the four stores`);
    };

    refusedOnChannel(call(fx.case, null, randomUUID()), say('23514', SAY.purgeActorNull),
      'a purge that names no account', fx.case, fx.live.weddingId);
    refusedOnChannel(call(fx.case, randomUUID(), randomUUID()), say('23514', SAY.purgeActorUnknown),
      'a purge naming an account that does not exist', fx.case, fx.live.weddingId);
    refusedOnChannel(call(fx.case, uidOf('opFinance'), randomUUID()), say('42501', SAY.purgeActorNoGrant),
      'a purge naming the finance desk as its actor', fx.case, fx.live.weddingId);
    refusedOnChannel(call(fx.case, actor, null), say('23514', SAY.purgeKeyNull),
      'a purge with no idempotency key', fx.case, fx.live.weddingId);
    refusedOnChannel(call(fx.closedCase, actor, randomUUID()), say('42501', SAY.purgePlanNo),
      'a purge authorised by a ticket this run closed', fx.closedCase, fx.live.weddingId);
    refusedOnChannel(call(NOT_A_CASE_REF, actor, randomUUID()), say('42501', SAY.purgePlanNo),
      'a purge authorised by a ticket that was never minted', fx.case, fx.live.weddingId);
    refusedOnChannel(call(fx.plannerCase, actor, randomUUID()), say('23514', SAY.purgeNoRevoked),
      'a purge aimed at a publication that is still live', fx.plannerCase, fx.planner.weddingId);
    refusedOnChannel(call(fx.retiredCase, actor, randomUUID()), say('23514', SAY.purgeNoTakedown),
      'a purge aimed at a publication its host retired with no takedown on the trail',
      fx.retiredCase, fx.retired.weddingId);
    refusedOnChannel(call(fx.case, actor, fx.takedownKey), say('23514', SAY.purgeSameKey),
      'a purge that tried to pay for itself with the takedown\'s own key', fx.case, fx.live.weddingId);

    // The accepted plan. Hotel is the wedding with one digest-bearing artefact and one artefact that has
    // bytes without a digest, which is the pair the rule is about: a bucket full of files would let a plan
    // that listed by file rather than by manifest column answer the same count.
    const bucketBefore = await bucketCount();
    const readyBytesBefore = await signedFetch(fx.readyKey);
    const registeredBytesBefore = await signedFetch(fx.registeredKey);
    fx.purgeKey = randomUUID();
    const planned = trusted(call(fx.case, actor, fx.purgeKey), 'the accepted purge plan');
    assert.equal(keysOf(planned), keySet('wedding_id', 'case_ref', 'publication_id', 'version_id',
      'objects_planned', 'actor_named_by_argument', 'objects_deleted_by_this_call', 'delete_channel',
      'object_keys', 'count', 'audit_id', 'replayed'),
      `the purge answer is not the twelve fields its body builds: ${json(Object.keys(planned))}`);
    assert.equal(String(planned.wedding_id), fx.live.weddingId, 'the plan named another wedding');
    assert.equal(planned.case_ref, fx.case, 'the plan named another ticket');
    assert.equal(String(planned.publication_id), pubIdOf(fx.live.weddingId, 'Hotel'),
      'the plan named another publication');
    assert.equal(String(planned.version_id), fx.live.versionId, 'the plan named another version');
    assert.equal(String(planned.objects_planned), '1', 'the plan counted something other than the one '
      + 'digest-bearing row');
    assert.equal(String(planned.count), '1', 'the plan\'s answer count and its own objects_planned disagree');
    assert.deepEqual(planned.object_keys, [fx.readyKey], 'the plan\'s list is not the one row that earned bytes');
    assert.equal(String(planned.actor_named_by_argument), actor, 'the row does not name the human the '
      + 'argument named, which is the half that answers who decided');
    assert.equal(planned.objects_deleted_by_this_call, false, 'a plan claimed it deleted');
    assert.equal(planned.delete_channel, 'Storage API delete driven by scripts/stage11-operations-cli.mjs',
      'the plan named a removal channel other than the tool §11 documents');
    assert.equal(planned.replayed, false, 'the first delivery of a fresh purge key called itself a replay');
    assert.equal(typeof planned.audit_id, 'number', 'the plan answered without the trail row it just wrote');
    harvest(planned);

    // The two halves of §6's promise, measured against each other rather than against this file's guess: the
    // surface a browser could reach and the body no browser can reach list the same files.
    // The baseline is taken here rather than above the accepted plan because the plan's own two writes are
    // designed (`20261020190400…:598` links the ticket, `:616` puts the plan on the trail) and are pinned as
    // exactly two by the assertions below. What this comparison is about is the door: a STABLE read that
    // reached the same stores would move them from here.
    const storesBeforeDoor = snapshot(fx.case, fx.live.weddingId);
    const doorPlan = await rpc('operator_takedown_plan', { p_wedding_id: fx.live.weddingId },
      { as: 'opOps' });
    assert.equal(doorPlan.status, 200, `the Hotel plan after the takedown answered ${json(shape(doorPlan))}`);
    assert.equal(doorPlan.body.publication_status, 'revoked', 'the plan door still calls a retired '
      + 'publication active, so the two answers below would not be about the same row');
    assert.deepEqual(doorPlan.body.object_keys, planned.object_keys,
      'the door and the doorless body disagree about which files a purge would name');

    assert.equal(snapshot(fx.case, fx.live.weddingId), storesBeforeDoor,
      'the plan door moved the manifest, the trail or the ticket link, so it was not the read §6 says it is');
    assert.equal(await bucketCount(), bucketBefore,
      `the plan went from ${json(String(bucketBefore))} objects in the bucket to `
      + `${json(String(await bucketCount()))}, so "deletes nothing" is a claim and not a measurement`);
    assert.deepEqual(await signedFetch(fx.readyKey), readyBytesBefore,
      'the planned file stopped serving, which is what an actual delete would have done');
    assert.deepEqual(await signedFetch(fx.registeredKey), registeredBytesBefore,
      'the file the plan refused to list moved anyway');

    assert.deepEqual(trailRows(fx.live.weddingId, 'publication_objects_purge_planned'),
      [`kind=maintenance actor=${actor} subject=publication/${pubIdOf(fx.live.weddingId, 'Hotel')}`
        + ` key=${fx.purgeKey}`],
      'the plan is not on the trail as §4 describes it — `maintenance` for the kind, and the named human in '
      + 'the actor column');
    const purgeReason = trailReason(fx.live.weddingId, 'publication_objects_purge_planned');
    assert.ok(purgeReason.includes(`citing case ${fx.case}`),
      `the plan's trail reason lost the ticket: ${shown(purgeReason)}`);
    assert.ok(purgeReason.includes('deletes nothing'),
      `the plan's trail reason does not carry its own limit: ${shown(purgeReason)}`);
    assert.equal(linkRows(fx.case), '2', 'the takedown and the plan did not leave two links on one ticket');

    // The replay, and the reason the two ordering checks sit *before* it: a re-asked plan still has to pass
    // the retirement, the record and the distinct key, and then answers with the list as of now.
    const afterPlan = snapshot(fx.case, fx.live.weddingId);
    const replay = trusted(call(fx.case, actor, fx.purgeKey), 'the replayed purge plan');
    assert.deepEqual(replay, { ...planned, replayed: true },
      'the replayed plan answered with anything other than the first plan\'s own fields');
    assert.equal(snapshot(fx.case, fx.live.weddingId), afterPlan, 'the replay wrote a second row somewhere');
    assert.equal(count(`from private.audit_events where action = 'publication_objects_purge_planned'`,
      'the purge-plan trail rows'), '1', 'the replay added a plan nobody asked for');

    // And the arm the replay path refuses: a key that already bought one publication's plan cannot buy
    // another's. Marigold was taken down in T-03 with its own key, so every check before the replay passes
    // for it and only the subject comparison can speak.
    const spareBefore = snapshot(fx.spareCase, fx.spare.weddingId);
    refused(`PERFORM ${call(fx.spareCase, actor, fx.takedownKey)}`, say('23514', SAY.keyOtherAct),
      'Hotel\'s takedown key spent as Marigold\'s purge plan');
    assert.equal(snapshot(fx.spareCase, fx.spare.weddingId), spareBefore,
      'the refused cross-publication key still planned Marigold\'s files');
    assert.equal(linkRows(fx.spareCase), '1', 'the refused plan linked Marigold\'s ticket a second time');
    assert.equal(count(`from private.audit_events where action = 'publication_objects_purge_planned'`,
      'the purge-plan trail rows'), '1', 'the refused plan wrote a plan row for Marigold');

    console.log(`  T-05  nine refusals walked the trusted channel's own ladder — no account, an account that `
      + `is not one, an account with no operations grant (42501), no key, a closed ticket and a minted-free `
      + `ref (42501), a live publication, a retirement with no takedown record, and the takedown's own key — `
      + `each leaving the manifest, the trail, the ticket link and this wedding's artefact states where they `
      + `were; the accepted plan then listed ${json(planned.object_keys)} as one object while the bucket held `
      + `${json(String(bucketBefore))} files and both links still served the same bytes, wrote one `
      + 'maintenance row and a second ticket link, and replayed without writing — while the same list read '
      + 'through the browser-reachable door moved none of the four stores the trusted plan had just written '
      + 'two of');
  });
});

// ===========================================================================
// Group R — refund oversight that cannot move money (§7, slice 4)
//
// `92_takedown_and_oversight.sql` already walks the whole note machinery on a throwaway Postgres: the four
// note kinds, the four refund statuses, the 1..200 window and its NULL default, both authorising-case
// refusals, the cross-act idempotency poison, the derived `order_id` trigger, the append-only guard, the
// account-deletion nulling of `author_user_id`, and the grant table. None of that is restated here. What a
// second Postgres cannot supply is the transport, so this group asks five questions of it: that the queue's
// jsonb arrives field for field with its numbers as numbers and its absent columns as JSON nulls rather
// than missing keys; that the delivered row order is the order the body asked for and the delivered `count`
// is the array it came with; that an operator's act crosses the wire as one body whose `money_moved` half
// is a real boolean and whose replay is the *same delivered bytes*; that the prose a reviewer types reaches
// the queue and never reaches the trail; and that a stranger's ticket, a dead ticket and a refund this
// database never issued are answered with one indistinguishable sentence, because three different words
// there is an enumeration channel.
// ===========================================================================
describe('S11 R a refund reviewed, annotated and left exactly where it was', () => {
  const fx = {};
  /** The three sentences this group types. Each carries the run tag so it is findable in the store the
   *  queue reads — which is what makes its absence from the trail a measurement rather than a guess. No
   *  apostrophes: these go into SQL literals. */
  const NOTE_ONE = `provider record ${RUN_TAG} shows this settling on the provider side`;
  const NOTE_TWO = `escalated to the owner for the same ${RUN_TAG} money`;
  const NOTE_THREE = `documented outcome for ${RUN_TAG}: the provider agrees the refund landed`;

  const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  /** A delivered timestamp, or the JSON null that stands in for a column the row does not have yet. */
  const stampOrNull = (value, what) => {
    assert.ok(value === null || ISO_STAMP.test(String(value)),
      `${what} did not arrive as an ISO instant or a JSON null: ${shown(value).slice(0, 80)}`);
    return value;
  };

  /** The three field lists, each transcribed from the `jsonb_build_object` that builds it
   *  (takedown:693-714) rather than from what this file would like to read. */
  const REFUND_KEYS = keySet('refund_id', 'kind', 'status', 'amount_minor', 'currency',
    'provider_refund_ref', 'recorded_at', 'completed_at', 'wedding_id', 'order', 'notes');
  const ORDER_KEYS = keySet('order_id', 'package_code', 'price_version', 'merchant_reference', 'status',
    'captured_at');
  const NOTE_KEYS = keySet('note_id', 'kind', 'note', 'case_ref', 'case_status', 'author_user_id',
    'created_at');

  const findRow = (body, refundId) => (body?.refunds ?? [])
    .find((row) => String(row.refund_id) === refundId);
  const queueRow = (body, refundId, what) => {
    const row = findRow(body, refundId);
    assert.ok(row, `${what}: refund ${String(refundId).slice(0, 8)}… is not in the delivered queue, which `
      + `answered ${json(body?.refunds?.map((r) => String(r.refund_id).slice(0, 8)))}`);
    return row;
  };
  /** The note row as the table holds it, including the two columns the projection is accused of forging:
   *  the denormalised `order_id` the trigger fills, and the key the caller sent. */
  const noteRow = (id) => cell(`
    select 'refund=' || refund_id::text || ' order=' || order_id::text || ' case=' || case_ref
      || ' author=' || coalesce(author_user_id::text, '-') || ' kind=' || kind
      || ' key=' || idempotency_key::text || ' stamped=' || (created_at is not null)::text
      || ' note=' || note
    from private.commerce_review_notes where id = '${id}'`, `the note row ${String(id).slice(0, 8)}…`);
  const noteCount = (refundId) => count(`from private.commerce_review_notes
    where refund_id = '${refundId}'`, `the notes on ${String(refundId).slice(0, 8)}…`);
  /** The thread arm the note door appends, and nothing else on the case. */
  const linkRow = (ref) => cell(`
    select coalesce(string_agg('kind=' || e.kind || ' actor_kind=' || e.actor_kind
      || ' actor=' || coalesce(e.actor_user_id::text, '-') || ' keyed='
      || (e.idempotency_key is not null)::text || ' seq=' || e.seq::text, ' | ' order by e.seq), '<none>')
    from private.support_case_events e
    join private.support_cases c on c.id = e.case_id
    where c.case_ref = '${ref}' and e.kind = 'operation_link'`, `the operation_link arm of ${ref}`);
  const linkCount = (ref) => count(`from private.support_case_events e
    join private.support_cases c on c.id = e.case_id
    where c.case_ref = '${ref}' and e.kind = 'operation_link'`, `the ticket links on ${ref}`);
  const caseStatus = (ref) => cell(`select status from private.support_cases where case_ref = '${ref}'`,
    `the status of ${ref}`);
  /** Every prose-bearing column of one trail row, in one string, so the absence below is a sweep and not a
   *  reading of the one column the design happened to point at. */
  const trailText = (auditId) => cell(`
    select coalesce(reason, '<null-reason>') || ' [' || coalesce(payload::text, '<null>') || '] ['
      || coalesce(before_state::text, '<null>') || '->' || coalesce(after_state::text, '<null>') || ']'
    from private.audit_events where id = ${Number(auditId)}`, `the prose of trail row ${auditId}`);
  const trailRow = (auditId) => cell(`
    select 'subj=' || subject_type || '/' || coalesce(subject_key::text, '-') || ' action=' || action
      || ' actor_kind=' || actor_kind || ' actor=' || coalesce(actor_user_id::text, '-')
      || ' wedding=' || coalesce(wedding_id::text, '-') || ' key=' || coalesce(idempotency_key, '-')
    from private.audit_events where id = ${Number(auditId)}`, `the shape of trail row ${auditId}`);
  /** The ledger line without the one field a review note is *allowed* to move. `moneyLine` counts the notes
   *  sitting on its own refund, so after an accepted note that number has grown and the line differs — by
   *  the note, not by the money. The money claim is the other eight fields, so those are what the
   *  before/after halves of R-03 and R-04 compare. */
  const moneyOnly = (line) => line.replace(/ notes=\d+$/, '');
  /** The seq the next thread row on this ticket will be minted with. `mint_support_case_seq` takes
   *  `max(seq) + 1` per case (cases:402-404) and `open_support_case` already appended the seq-1 status row
   *  (cases:586-589), so the note door's `operation_link` arm is 2 on this run's ticket and the assertion
   *  below says so from the store rather than from a number this file guessed. */
  const nextSeq = (ref) => Number(cell(`select coalesce(max(e.seq), 0) + 1
    from private.support_case_events e join private.support_cases c on c.id = e.case_id
    where c.case_ref = '${ref}'`, `the next thread seq on ${ref}`));
  /** The stores the review family could move, as thunks `refusedDoor` re-read around every refusal. */
  const moneyProbes = () => [
    { what: 'the note store', get: () => count('from private.commerce_review_notes', 'the note store') },
    { what: 'the whole trail', get: () => count('from private.audit_events', 'the whole trail') },
    { what: 'the thread store', get: () => count('from private.support_case_events', 'the thread store') },
    { what: 'the refund and order rows', get: () => moneyLine(fx.money) },
    { what: 'the policy singleton', get: policyLine },
  ];

  before(async () => {
    fx.money = await plantMoney('hostC', weddingOf('hostC'), 'R');
    // A second order carrying the one refund shape `plantMoney` never makes: `recorded`, with its
    // completion pair, amount and provider reference all genuinely NULL on disk. The pair check
    // (`20261017120000_stage10_commerce_foundations.sql:400-401`) is why this is the shape worth
    // planting — a `succeeded` row with no instant cannot exist, so only a not-yet-settled row can show
    // a client what an absent column looks like.
    fx.pending = await plantMoney('hostC', weddingOf('hostC'), 'R-pending');
    exec(`update private.commerce_refunds set status = 'recorded', completed_at = null,
                amount_minor = null, currency = null, provider_refund_ref = null, kind = 'chargeback'
           where id = '${fx.pending.refundId}'`, "the recorded chargeback this group reviews");
    // The nine fields of `moneyLine` this fixture has to control: the order's frozen triple, the refund's
    // own triple (where the NULLs live), and the two per-order counters. `entitlements` and `notes` are
    // deliberately not in the compared span — the first belongs to the wedding rather than to this refund
    // and another case could legitimately move it, and the second is this group's own output.
    assert.ok(moneyLine(fx.pending).startsWith(
      'order=captured/150000/INR refund=recorded/null/- attempts=0 events=0'),
      `the planted chargeback is not the NULL-bearing shape the queue has to report: ${shown(moneyLine(fx.pending))}`);
    fx.case = await openCase('hostC', weddingOf('hostC'), { category: 'billing_refund_inquiry',
      severity: 'high', summary: `A refund the owner says never landed (${RUN_TAG})` });
    fx.deadCase = await openCase('hostC', weddingOf('hostC'), { category: 'billing_refund_inquiry',
      summary: `A ticket this group closes and then cites for money (${RUN_TAG})` });
    fx.otherCase = await openCase('hostB', weddingOf('hostB'), { category: 'billing_refund_inquiry',
      summary: `A live ticket about a different family's money (${RUN_TAG})` });
    assert.ok(moneyLine(fx.money).includes('order=captured/150000/INR refund=succeeded/50000/'),
      `the annotated refund is not the settled shape the door reads back: ${shown(moneyLine(fx.money))}`);
    assert.equal(caseStatus(fx.case), 'open', 'the authorising ticket is not live at the start of the run');
  });

  test('R-01: the queue arrives field for field, ordered as its body asked, with NULLs that stayed in the body', async () => {
    const before = {
      notes: count('from private.commerce_review_notes', 'the note store'),
      trail: count('from private.audit_events', 'the whole trail'),
      threads: count('from private.support_case_events', 'the thread store'),
      ledger: moneyLine(fx.money), policy: policyLine(),
    };
    const r = await rpc('operator_commerce_review_queue', { p_status: null, p_limit: 200 },
      { as: 'opFinance' });
    assert.equal(r.status, 200, `the finance desk's queue read answered ${json(shape(r))}`);
    projection('operator_commerce_review_queue', r.body, "the queue's own projection");
    assert.equal(typeof r.body.moves_money, 'boolean',
      `moves_money arrived as ${typeof r.body.moves_money}, so a console would be reading a string`);
    assert.equal(r.body.moves_money, false, 'the review queue claims it moves money');
    assert.equal(r.body.changes_entitlements, false, 'the review queue claims it changes entitlements');
    assert.ok(Object.prototype.hasOwnProperty.call(r.body, 'status_filter'),
      'a NULL filter came back as an absent key rather than a JSON null');
    assert.equal(r.body.status_filter, null, `the unfiltered read echoed ${json(r.body.status_filter)}`);
    assert.equal(typeof r.body.count, 'number', 'the count arrived as something other than a number');
    assert.equal(r.body.count, r.body.refunds.length,
      `the body counted ${r.body.count} rows and delivered ${r.body.refunds.length}`);

    for (const row of r.body.refunds) {
      assert.equal(keysOf(row), REFUND_KEYS, `a queue row is not §7's field list: ${json(keysOf(row))}`);
      assert.equal(keysOf(row.order), ORDER_KEYS, `the frozen order block is not the body's: ${json(keysOf(row.order))}`);
      assert.ok(Array.isArray(row.notes), `notes arrived as ${typeof row.notes}, not an array`);
      // A bigint is a number or the JSON null of a refund that has no amount yet — which is exactly the
      // row this run plants. A string in either place is the wire's mistake, not the schema's.
      assert.ok(row.amount_minor === null || typeof row.amount_minor === 'number',
        `amount_minor arrived as ${json(row.amount_minor)} — a bigint serialised as a string would make the `
        + 'console add up text');
      assert.equal(typeof row.order.price_version, 'number', 'price_version is not a number');
      assert.equal(row.order.status, 'captured', `a review queue row names an order in ${row.order.status}`);
      stampOrNull(row.recorded_at, 'a recorded_at');
      stampOrNull(row.completed_at, 'a completed_at');
      stampOrNull(row.order.captured_at, 'an order captured_at');
      for (const note of row.notes) {
        assert.equal(keysOf(note), NOTE_KEYS, `a nested note is not the seven fields: ${json(keysOf(note))}`);
        stampOrNull(note.created_at, 'a note created_at');
      }
    }

    // The order the body asked for (`recorded_at DESC, refund_id` at takedown:690/719), delivered — and
    // the LIMIT the caller sent, honoured rather than ignored. Read from the same join the body walks.
    const expected = sqlRows(`select r.id::text from private.commerce_refunds r
      join private.commerce_orders o on o.id = r.order_id
      order by r.recorded_at desc, r.id limit 200`);
    assert.deepEqual(r.body.refunds.map((row) => String(row.refund_id)), expected,
      'the delivered queue is not in the order the body asked for');
    const one = await rpc('operator_commerce_review_queue', { p_status: null, p_limit: 1 },
      { as: 'opFinance' });
    assert.equal(one.body.count, 1, `a queue asked for one row delivered ${one.body.count}`);
    assert.equal(String(one.body.refunds[0].refund_id), expected[0],
      'the one row delivered is not the newest the store holds');

    // The NULL-bearing half, and the filter that selects the row it belongs to.
    const pendingRow = queueRow(r.body, fx.pending.refundId, 'the unfiltered queue');
    for (const key of ['completed_at', 'amount_minor', 'currency', 'provider_refund_ref']) {
      assert.ok(Object.prototype.hasOwnProperty.call(pendingRow, key),
        `${key} is absent from the delivered row, so a console cannot tell "not yet" from "not modelled"`);
      assert.equal(pendingRow[key], null, `${key} came back as ${json(pendingRow[key])} on a recorded row`);
    }
    assert.equal(pendingRow.kind, 'chargeback', 'the planted dispute arrived as a refund');
    assert.equal(pendingRow.notes.length, 0, 'a refund nobody reviewed arrived with a note');
    const settled = await rpc('operator_commerce_review_queue', { p_status: 'succeeded', p_limit: 200 },
      { as: 'opFinance' });
    assert.equal(settled.body.status_filter, 'succeeded', 'the filter did not echo what was sent');
    assert.ok(findRow(settled.body, fx.money.refundId), 'the settled refund is missing from the settled filter');
    assert.equal(findRow(settled.body, fx.pending.refundId), undefined,
      'a recorded row came back on a succeeded filter');
    assert.ok(settled.body.refunds.every((row) => row.status === 'succeeded'),
      'the filter delivered a row of another status');

    const after = {
      notes: count('from private.commerce_review_notes', 'the note store'),
      trail: count('from private.audit_events', 'the whole trail'),
      threads: count('from private.support_case_events', 'the thread store'),
      ledger: moneyLine(fx.money), policy: policyLine(),
    };
    assert.deepEqual(after, before, 'reading the review queue moved something it was only meant to report');
    console.log(`  R-01  ${r.body.count} refunds delivered in the order the body asked for across three `
      + `reads (200 / 1 / a succeeded filter), the recorded dispute carried all four of its NULL columns as `
      + `JSON nulls rather than absent keys, and the note store, the trail, the threads, this run's ledger `
      + 'line and the policy singleton were identical either side of it');
  });

  test('R-02: both review doors state their own input rules at the wire, naming the value that broke them', async () => {
    const queueArgs = (extra) => ({ p_status: null, p_limit: 200, ...extra });
    await refusedDoor('operator_commerce_review_queue', queueArgs({ p_status: 'pending' }), 'opFinance',
      httpWire(400, '23514', SAY.refundStatus, "'pending'",
        'the four are recorded, succeeded, failed and reversed'),
      'a queue filter this schema holds no row for', moneyProbes());
    for (const bad of [0, 201, -5]) {
      await refusedDoor('operator_commerce_review_queue', queueArgs({ p_limit: bad }), 'opFinance',
        httpWire(400, '23514', SAY.reviewLimit, `not ${bad}`),
        `a queue asked for ${bad} rows`, moneyProbes());
    }
    const noteArgs = (extra) => ({ p_refund_id: fx.money.refundId, p_case_ref: fx.case,
      p_kind: 'in_review', p_note: NOTE_ONE, p_idempotency_key: randomUUID(), ...extra });
    await refusedDoor('operator_add_commerce_review_note', noteArgs({ p_kind: 'money_moved' }), 'opFinance',
      httpWire(400, '23514', SAY.reviewKind, "'money_moved'", 'the four are evidence_requested'),
      'a note kind that would name an act on the money', moneyProbes());
    await refusedDoor('operator_add_commerce_review_note', noteArgs({ p_note: '   ' }), 'opFinance',
      httpWire(400, '23514', SAY.reviewNoteText, 'and 3 is neither'),
      'a note of three spaces', moneyProbes());
    await refusedDoor('operator_add_commerce_review_note', noteArgs({ p_note: 'x'.repeat(4001) }), 'opFinance',
      httpWire(400, '23514', SAY.reviewNoteText, 'and 4001 is neither'),
      'a note one character past the bound', moneyProbes());
    await refusedDoor('operator_add_commerce_review_note', noteArgs({ p_note: null }), 'opFinance',
      httpWire(400, '23514', SAY.reviewNoteText, 'and a missing note is neither'),
      'a note that was never typed', moneyProbes());
    await refusedDoor('operator_add_commerce_review_note', noteArgs({ p_idempotency_key: null }), 'opFinance',
      httpWire(400, '23514', SAY.reviewNoteKey, 'two clicks must produce one note'),
      'a note sent twice with no key to tie the two together', moneyProbes());

    // The presence control for the queue: the same door, one instant later, on the same arguments minus the
    // broken one. Without it the four queue refusals above would be a cold schema cache or a disabled stack.
    // The note door's positive half is deliberately not taken here — R-03's first delivery asserts that
    // door's whole 200 body, its three written rows and its replay, and a control note written *here* would
    // spend the ticket's second thread seq before the case that reads it.
    const ok = await rpc('operator_commerce_review_queue', { p_status: 'succeeded', p_limit: 2 },
      { as: 'opFinance' });
    assert.equal(ok.status, 200, `the queue control answered ${json(shape(ok))}, so the refusals above `
      + 'measured nothing');
    assert.equal(ok.body.count, 2, `the honoured limit delivered ${ok.body.count} rows`);
    console.log('  R-02  nine refusals at the two review doors (a fifth refund status, three out-of-range '
      + 'limits, a fifth note kind, three note text shapes and a missing key) each arrived as 400/23514 '
      + 'carrying the caller\'s own value in place of the `%` and left the note store, the trail, the '
      + 'threads, this run\'s ledger line and the policy singleton where they were; the queue then answered '
      + '200 with a honoured limit of 2, and R-03 is that note door\'s own accepted call');
  });

  test('R-03: one act writes one note, one thread row and one trail row, and the note text never reaches the trail', async () => {
    const key = randomUUID();
    const args = { p_refund_id: fx.money.refundId, p_case_ref: fx.case, p_kind: 'evidence_requested',
      p_note: NOTE_ONE, p_idempotency_key: key };
    const before = { ledger: moneyLine(fx.money), policy: policyLine(),
      seq: nextSeq(fx.case),
      notes: Number(count('from private.commerce_review_notes', 'the note store')),
      trail: Number(count('from private.audit_events', 'the whole trail')),
      links: Number(linkCount(fx.case)), entitlements: count('from public.entitlements',
        'the entitlement store'), status: cell(`select status from private.commerce_refunds
        where id = '${fx.money.refundId}'`, 'the reviewed refund') };

    const r = await rpc('operator_add_commerce_review_note', args, { as: 'opFinance' });
    assert.equal(r.status, 200, `a review note from the desk that holds the scope answered ${json(shape(r))}`);
    projection('operator_add_commerce_review_note', r.body, "the note door's answer");
    assert.equal(r.body.replayed, false, 'the first delivery of a fresh key called itself a replay');
    assert.equal(r.body.money_moved, false, 'the answer says money moved');
    assert.equal(r.body.entitlement_changed, false, 'the answer says an entitlement changed');
    assert.equal(r.body.refund_row_changed, false, 'the answer says the refund row changed');
    assert.equal(r.body.note_only, true, 'the answer does not claim the note is the only thing written');
    for (const flag of ['money_moved', 'entitlement_changed', 'refund_row_changed', 'note_only', 'replayed']) {
      assert.equal(typeof r.body[flag], 'boolean',
        `${flag} arrived as ${typeof r.body[flag]}, so a console would be testing a string for truth`);
    }
    assert.equal(String(r.body.refund_id), fx.money.refundId, 'the answer names a different refund');
    assert.equal(String(r.body.order_id), fx.money.orderId,
      'the answer names an order that is not this refund\'s own');
    assert.equal(String(r.body.wedding_id), weddingOf('hostC'), 'the answer names a different wedding');
    assert.equal(r.body.case_ref, fx.case, 'the answer cites a different ticket');
    assert.equal(r.body.kind, 'evidence_requested', 'the answer reports a different kind than was sent');
    assert.equal(typeof r.body.audit_id, 'number', `the answer's trail id is ${typeof r.body.audit_id}`);
    harvest(r.body);
    // R-04 reads this note back out of the queue, so the two ids the door returned are handed to it here
    // rather than re-looked-up from the store by a second read that would prove nothing about the answer.
    fx.noteOne = String(r.body.note_id);
    fx.auditOne = r.body.audit_id;

    // The three rows the one call owes, each read from the store rather than from the answer.
    assert.equal(noteRow(r.body.note_id),
      `refund=${fx.money.refundId} order=${fx.money.orderId} case=${fx.case} `
      + `author=${uidOf('opFinance')} kind=evidence_requested key=${key} stamped=true note=${NOTE_ONE}`,
      'the note row is not the one row this call was meant to write');
    assert.equal(linkRow(fx.case),
      `kind=operation_link actor_kind=operator actor=${uidOf('opFinance')} keyed=true seq=${before.seq}`,
      'the ticket did not gain exactly one keyed operation_link arm at the seq its thread was about to mint');
    assert.equal(trailRow(r.body.audit_id),
      `subj=commerce_refund/${fx.money.refundId} action=commerce_review_note_added actor_kind=operator `
      + `actor=${uidOf('opFinance')} wedding=${weddingOf('hostC')} key=${key}`,
      'the trail row does not name the human, the refund and the key that wrote it');
    const prose = trailText(r.body.audit_id);
    assert.ok(!prose.includes(NOTE_ONE),
      `the trail carried the note's own words, which §4 puts in the note row and nowhere else: ${shown(prose).slice(0, 300)}`);
    for (const part of ['evidence_requested', fx.money.refundId, fx.case, 'no money or entitlement moved']) {
      assert.ok(prose.includes(part), `the trail row omits ${JSON.stringify(part)}: ${shown(prose).slice(0, 300)}`);
    }
    assert.equal(JSON.parse(prose.slice(prose.indexOf('[') + 1, prose.indexOf(']'))).money_moved, false,
      'the stored payload disagrees with the delivered one about money');

    const mid = { ledger: moneyLine(fx.money), policy: policyLine(),
      notes: Number(count('from private.commerce_review_notes', 'the note store')),
      trail: Number(count('from private.audit_events', 'the whole trail')),
      links: Number(linkCount(fx.case)), entitlements: count('from public.entitlements',
        'the entitlement store'), status: cell(`select status from private.commerce_refunds
        where id = '${fx.money.refundId}'`, 'the reviewed refund') };
    assert.equal(mid.notes, before.notes + 1, 'the act wrote more than one note row');
    assert.equal(mid.trail, before.trail + 1, 'the act wrote more than one trail row');
    assert.equal(mid.links, before.links + 1, 'the act wrote more than one thread row');
    assert.equal(moneyOnly(mid.ledger), moneyOnly(before.ledger),
      'annotating a refund moved the money it describes');
    assert.equal(mid.policy, before.policy, 'annotating a refund touched the payment policy');
    assert.equal(mid.entitlements, before.entitlements, 'annotating a refund changed an entitlement');
    assert.equal(mid.status, before.status, 'the reviewed refund changed status because somebody commented');

    // The replay: the same key, the same body, and the same *delivered bytes* back.
    const again = await rpc('operator_add_commerce_review_note', args, { as: 'opFinance' });
    assert.equal(again.status, 200, `the replay answered ${json(shape(again))}`);
    assert.equal(again.body.replayed, true, 'a resubmitted key was answered as a second note');
    assert.equal(String(again.body.note_id), String(r.body.note_id),
      'the replay delivered a different note id than the note it says it replayed');
    assert.equal(again.body.audit_id, r.body.audit_id, 'the replay points at a different trail row');
    assert.equal(keysOf(again.body), keysOf(r.body), 'the replay delivered a different field list');
    const firstStripped = { ...r.body };
    delete firstStripped.replayed;
    const againStripped = { ...again.body };
    delete againStripped.replayed;
    assert.deepEqual(againStripped, firstStripped,
      `the replay is not the first answer with one flag changed: ${json(againStripped)} vs ${json(firstStripped)}`);
    assert.equal(count('from private.commerce_review_notes', 'the note store'), String(mid.notes),
      'the replay wrote a second note row');
    assert.equal(count('from private.audit_events', 'the whole trail'), String(mid.trail),
      'the replay wrote a second trail row');
    assert.equal(moneyLine(fx.money), mid.ledger, 'the replay moved the money the first act left alone');
    console.log(`  R-03  one call wrote one note row (with ${fx.money.orderId.slice(0, 8)}… derived into it `
      + `by the trigger), one keyed operation_link arm at the thread's own next seq (${before.seq}) and one `
      + `trail row naming ${uidOf('opFinance').slice(0, 8)}…; `
      + 'the note\'s words reached the note row and not the trail; the refund, its order, the entitlements '
      + 'and the policy were byte-identical either side; and the resubmitted key returned the first answer '
      + 'verbatim with only `replayed` flipped');
  });

  test('R-04: the note a reviewer typed reaches the queue in the order it was written, and the trail still holds none of it', async () => {
    const ledgerBefore = moneyLine(fx.money);
    const first = await rpc('operator_commerce_review_queue', { p_status: 'succeeded', p_limit: 200 },
      { as: 'opFinance' });
    assert.equal(first.status, 200, `the queue re-read answered ${json(shape(first))}`);
    const row = queueRow(first.body, fx.money.refundId, 'the succeeded filter after one note');
    assert.equal(row.notes.length, 1, `the queue shows ${row.notes.length} notes on a refund with one`);
    assert.equal(String(row.notes[0].note_id), String(fx.noteOne),
      'the queue note is not the row the door returned');
    assert.equal(row.notes[0].note, NOTE_ONE, 'the note text did not survive the trip into the queue');
    assert.equal(row.notes[0].case_status, caseStatus(fx.case),
      'the queue reports a case status the ticket does not hold');
    assert.equal(String(row.notes[0].author_user_id), uidOf('opFinance'),
      'the queue attributes the note to somebody other than the account that sent it');

    const second = await rpc('operator_add_commerce_review_note',
      { p_refund_id: fx.money.refundId, p_case_ref: fx.case, p_kind: 'escalated_to_owner',
        p_note: NOTE_TWO, p_idempotency_key: randomUUID() }, { as: 'opFinance' });
    assert.equal(second.status, 200, `the second note answered ${json(shape(second))}`);
    harvest(second.body);

    const again = await rpc('operator_commerce_review_queue', { p_status: 'succeeded', p_limit: 200 },
      { as: 'opFinance' });
    const row2 = queueRow(again.body, fx.money.refundId, 'the succeeded filter after two notes');
    assert.equal(row2.notes.length, 2, `the queue shows ${row2.notes.length} notes on a refund with two`);
    // Delivered in the body's own order (`created_at, id` at takedown:711) and nothing about the refund
    // itself altered by having been commented on twice.
    const store = sqlRows(`select n.id::text || '@' || n.kind || '@' || n.note
      from private.commerce_review_notes n where n.refund_id = '${fx.money.refundId}'
      order by n.created_at, n.id`);
    assert.deepEqual(row2.notes.map((n) => `${n.note_id}@${n.kind}@${n.note}`), store,
      'the delivered note thread is not the store\'s own, in the order the body asks for');
    assert.equal(row2.status, 'succeeded', 'the refund stopped being what it was because it was reviewed');
    assert.equal(String(row2.amount_minor), '50000', 'the reviewed amount changed under the notes');
    assert.equal(moneyOnly(moneyLine(fx.money)), moneyOnly(ledgerBefore),
      'a second note moved the money the first note left alone');
    for (const id of [fx.auditOne, second.body.audit_id]) {
      const prose = trailText(id);
      for (const text of [NOTE_ONE, NOTE_TWO]) {
        assert.ok(!prose.includes(text),
          `trail row ${id} carries note prose: ${shown(prose).slice(0, 300)}`);
      }
    }
    console.log(`  R-04  both notes arrived in the queue body in the store's own order — kinds, texts, `
      + `authors and case status equal to ${store.length} rows read straight back — while the refund stayed `
      + 'succeeded at its planted amount and neither trail row carried a word of either note');
  });

  test('R-05: a dead ticket, another family\'s ticket and a refund that never existed are one indistinguishable refusal', async () => {
    const closed = await rpc('operator_transition_case', { p_case_ref: fx.deadCase,
      p_to_status: 'closed', p_resolution_code: 'no_action_needed', p_body: null,
      p_idempotency_key: randomUUID() }, { as: 'opSupport' });
    assert.equal(closed.status, 200, `the walk to closed answered ${json(shape(closed))}`);
    harvest(closed.body);
    assert.equal(caseStatus(fx.deadCase), 'closed',
      'the ticket that is supposed to be terminal is not, so the refusal below is about the wrong fact');
    assert.equal(caseStatus(fx.otherCase), 'open',
      "the other family's ticket is not live, so the cross-wedding refusal below proves nothing");

    const notesBefore = count('from private.commerce_review_notes', 'the note store');
    const trailBefore = count('from private.audit_events', 'the whole trail');
    const onMoneyBefore = Number(noteCount(fx.money.refundId));
    const arms = [
      ['a ticket this run closed and then cited', { p_refund_id: fx.money.refundId, p_case_ref: fx.deadCase }],
      ['a live ticket about a different wedding', { p_refund_id: fx.money.refundId, p_case_ref: fx.otherCase }],
      ['a refund this database never issued', { p_refund_id: NOT_A_REFUND, p_case_ref: fx.case }],
    ];
    const messages = [];
    for (const [what, only] of arms) {
      const r = await refusedDoor('operator_add_commerce_review_note',
        { p_refund_id: fx.money.refundId, p_case_ref: fx.case, p_kind: 'documented_outcome',
          p_note: NOTE_THREE, p_idempotency_key: randomUUID(), ...only },
        'opFinance', httpWire(403, '42501', SAY.refundNo), what, moneyProbes());
      messages.push(String(r.body.message));
    }
    assert.equal(new Set(messages).size, 1,
      `the door answered three different problems with ${new Set(messages).size} different sentences, `
      + `which is a way to enumerate refunds and tickets: ${shown(messages).slice(0, 300)}`);
    assert.equal(count('from private.commerce_review_notes', 'the note store'), notesBefore,
      'a refused note still wrote a row');
    assert.equal(count('from private.audit_events', 'the whole trail'), trailBefore,
      'a refused note still wrote a trail row');
    assert.equal(linkCount(fx.deadCase), '0', 'a refusal that cited a closed ticket still linked it');

    // The positive half, aimed at the one thing the three arms above did not have: a ticket that is live and
    // belongs to the wedding this refund's order was frozen against. Same door, same account, same kind and
    // text, same fresh key — so if this answers 200, the three refusals measured their arguments.
    const ok = await rpc('operator_add_commerce_review_note',
      { p_refund_id: fx.money.refundId, p_case_ref: fx.case, p_kind: 'documented_outcome',
        p_note: NOTE_THREE, p_idempotency_key: randomUUID() }, { as: 'opFinance' });
    assert.equal(ok.status, 200, `the same door on the live ticket of this refund's own wedding answered `
      + `${json(shape(ok))}, so the three refusals above may be a door that refuses everything`);
    harvest(ok.body);
    assert.equal(Number(noteCount(fx.money.refundId)), onMoneyBefore + 1,
      'the accepted note did not land on the refund the three refusals were aimed at');
    assert.equal(count('from private.audit_events', 'the whole trail'), String(Number(trailBefore) + 1),
      'the accepted note wrote more than its one trail row');
    assert.equal(cell(`select status from private.commerce_refunds where id = '${fx.money.refundId}'`,
      'the reviewed refund'), 'succeeded', 'the accepted note changed the refund it described');
    console.log(`  R-05  three refusals — a closed ticket, a live ticket about another wedding, and a refund `
      + `id that names nothing — each arrived as 403/42501 with byte-identical wording (${shown(messages[0]).slice(0, 60)}…) `
      + 'and nothing written, then the same door took the live ticket of the wedding this refund belongs to '
      + 'and wrote exactly one note and one trail row');
  });
});

// ===========================================================================
// Group V — privacy intake as the two parties are served it (§8, slice 3)
//
// `90_privacy_intake.sql` owns this slice in-database: the privilege layer role by role (P), the two grants
// (G), the host's doors and note bounds (H), the queue's filters and projections (Q), the legal walk with
// its refusals and its trail row (A), the whole status matrix as every ordered pair (M), replay (R), the
// cross-household no-oracle sentence (X), revocation and expiry (V) and the no-delete posture (D). A second
// Postgres adds nothing to those. What it cannot supply is the two clients this door serves from two
// different projections, or the fact that a caller's own word comes back out of a RAISE across the wire —
// so four cases ask that: that the intake anchors a double click by (account, wedding, kind) rather than by
// a key and files no trail row at all; that the host's list and the desk's queue are different field sets on
// the same row, with the desk's annotation visible only to the desk; that the advance door's seven refusal
// shapes name the value the caller sent and move nothing; and that a replay reads its answer out of the
// trail, so a request that has moved twice still returns the first move.
// ===========================================================================
describe('S11 V a privacy request as its host and its desk each see it', () => {
  const fx = {};
  /** Transcribed from the two `jsonb_build_object`s at privacy:348-351 and privacy:408-412. The desk's row is
   *  the host's row plus two fields, and between them is the claim this case measures: `requester_user_id`
   *  and `operator_note` exist on one row and on exactly one of the two surfaces. */
  const HOST_KEYS = keySet('request_ref', 'wedding_id', 'kind', 'status', 'host_note', 'requested_at',
    'updated_at');
  const QUEUE_KEYS = keySet('request_ref', 'wedding_id', 'requester_user_id', 'kind', 'status', 'host_note',
    'operator_note', 'requested_at', 'updated_at');
  const PRIV_NOTE = `please send every photo of our families (${RUN_TAG})`;
  const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  const stamp = (value, what) => {
    assert.ok(ISO_STAMP.test(String(value)), `${what} did not arrive as an ISO instant: ${shown(value).slice(0, 80)}`);
    return value;
  };
  const findReq = (body, ref, what) => {
    const row = (body?.requests ?? []).find((r) => r.request_ref === ref);
    assert.ok(row, `${what}: ${ref} is not in the delivered list, which answered `
      + `${json(body?.requests?.map((r) => r.request_ref))}`);
    return row;
  };
  const requestLine = (ref) => cell(`
    select 'status=' || status || ' kind=' || kind || ' wedding=' || wedding_id::text
      || ' requester=' || coalesce(requester_user_id::text, '-')
      || ' host=' || coalesce(host_note, '-') || ' operator=' || coalesce(operator_note, '-')
      || ' updated=' || (updated_at > requested_at)::text
    from private.privacy_requests where request_ref = '${ref}'`, `the ${ref} row`);
  /** Scoped to this group's own host, because the store is not this group's: the shared fixtures and the
   *  door probe file requests as other accounts, and a whole-table count would make every number below a
   *  measurement of whichever group ran before it. The total is a second probe, not a replacement: a filing
   *  that landed on some *other* account is exactly what the ownership refusal must not allow. */
  const privCount = () => count(`from private.privacy_requests
    where requester_user_id = '${uidOf('hostC')}'`, "this group's host privacy rows");
  const privTotal = () => count('from private.privacy_requests', 'the whole privacy store');
  const trailCount = () => count('from private.audit_events', 'the whole trail');
  /** Four reads over the two stores a privacy refusal could disturb — this host's rows, every row, the row it
   *  was aimed at, and the trail. The row-level read is the one that matters: a door that answers 400 after
   *  writing a second request would leave the store count alone only if a sibling row were also deleted,
   *  which the ref-line read would catch. */
  const privacyProbes = (ref) => [
    { what: "this host's privacy rows", get: privCount },
    { what: 'every privacy row', get: privTotal },
    { what: `the ${ref} row`, get: () => requestLine(ref) },
    { what: 'the whole trail', get: trailCount },
  ];

  before(async () => {
    // hostD files nothing here: V-01 uses it as the stranger who tries to file on somebody else's wedding.
    fx.hostCWedding = weddingOf('hostC');
  });

  test('V-01: the intake anchors a double click by who filed it, files the sibling kind as its own row, and writes no trail row at all', async () => {
    const trailBefore = trailCount();
    const file = (extra) => rpc('create_privacy_request', { p_wedding_id: fx.hostCWedding,
      p_kind: 'export', p_note: PRIV_NOTE, ...extra }, { as: 'hostC' });
    const first = await file();
    assert.equal(first.status, 200, `a host filing an export request answered ${json(shape(first))}`);
    projection('create_privacy_request', first.body, 'the intake answer');
    assert.match(first.body.request_ref, REQUEST_REF, `the minted ref is not the shipped shape: ${json(first.body)}`);
    requestRefs.push(first.body.request_ref);
    assert.equal(first.body.status, 'received', 'a freshly filed request did not arrive as received');
    assert.equal(first.body.replayed, false, 'the first filing called itself a replay');
    assert.equal(typeof first.body.replayed, 'boolean', 'replayed arrived as something other than a boolean');
    assert.equal(String(first.body.wedding_id), fx.hostCWedding, 'the answer names a different wedding');
    stamp(first.body.requested_at, 'the filed request\'s requested_at');

    // The same click twice again: the anchor is (account, wedding, kind), so the second delivery must answer
    // with the first row's own ref and instant, byte for byte, and no new row.
    const again = await file();
    assert.equal(again.status, 200, `the second filing answered ${json(shape(again))}`);
    assert.equal(again.body.replayed, true, 'a second filing of the same (account, wedding, kind) opened a '
      + 'second live request, so the duplicate anchor is not what §8 says it is');
    const restamped = { ...again.body };
    const restampedFirst = { ...first.body };
    assert.equal(restamped.request_ref, restampedFirst.request_ref, 'the replay names a different request');
    assert.equal(restamped.requested_at, restampedFirst.requested_at,
      'the replay carries a different instant than the row it says already existed');
    delete restamped.replayed;
    delete restampedFirst.replayed;
    assert.deepEqual(restamped, restampedFirst, `the replay is not the first answer with one flag changed: `
      + `${json(restamped)} vs ${json(restampedFirst)}`);
    assert.equal(privCount(), '1', 'the second filing wrote a second row after all');

    // The sibling kind is its own live request, because the anchor is a triple and not a pair.
    const erasure = await file({ p_kind: 'erasure', p_note: `and please delete what you have (${RUN_TAG})` });
    assert.equal(erasure.status, 200, `filing the sibling kind answered ${json(shape(erasure))}`);
    assert.equal(erasure.body.replayed, false, 'the other kind on the same wedding was absorbed into the export row');
    requestRefs.push(erasure.body.request_ref);
    assert.notEqual(erasure.body.request_ref, first.body.request_ref, 'two kinds share one ref');
    assert.equal(privCount(), '2', 'the two kinds did not become the two rows the anchor promises');

    // The input rules, each naming the caller's own word, and a stranger's wedding refused before anything
    // is read. `create_privacy_request` takes no idempotency key at all, so the poison arms the other doors
    // have do not exist here and are not invented.
    await refusedDoor('create_privacy_request', { p_wedding_id: fx.hostCWedding, p_kind: 'delete_everything',
      p_note: PRIV_NOTE }, 'hostC',
      httpWire(400, '23514', SAY.privacyKind, "'delete_everything'", 'the two are export and erasure'),
      'a request kind that would name an act on the data', privacyProbes(first.body.request_ref));
    for (const [bad, label] of [['   ', 3], ['x'.repeat(2001), 2001]]) {
      await refusedDoor('create_privacy_request', { p_wedding_id: fx.hostCWedding, p_kind: 'export',
        p_note: bad }, 'hostC',
        httpWire(400, '23514', SAY.privacyNoteBound, `and ${label} characters is neither`),
        `a host note of ${bad.length} characters`, privacyProbes(first.body.request_ref));
    }
    // The wall §8 draws is ownership of the wedding named in the call, so the stranger arm sends a wedding
    // that is *not* its own: hostD filing about its own Delta would be accepted, and the 403 below would
    // then be a measurement of nothing.
    await refusedDoor('create_privacy_request', { p_wedding_id: fx.hostCWedding, p_kind: 'export',
      p_note: `a request about a wedding this caller does not own (${RUN_TAG})` }, 'hostD',
      httpWire(403, '42501', SAY.privacyOpenNo), 'a filing aimed at another family\'s wedding',
      privacyProbes(first.body.request_ref));

    // The presence control, in the same instant: the door that refused the two note shapes still answers this
    // caller 200, so the refusals above are about their arguments. It arrives as the anchor's replay — the
    // sibling kind is still live, and the replay branch (privacy:284-288) answers the existing row's six keys
    // without storing the new text, which is why the count below must not move and why the note the host
    // typed is read back in V-02 from the filing that really wrote it.
    const ok = await file({ p_kind: 'erasure', p_note: `a real note (${RUN_TAG})` });
    assert.equal(ok.status, 200, `the intake control answered ${json(shape(ok))}, so the refusals above `
      + 'measured nothing');
    assert.equal(ok.body.request_ref, erasure.body.request_ref, 'the control filed a third row');
    assert.equal(privCount(), '2', 'a refused filing still wrote a row');
    // And the half of §8 this file can only measure here: the host's own act is not an operator act, so the
    // trail never sees it — while every operator act below does.
    assert.equal(trailCount(), trailBefore,
      `filing a privacy request wrote ${Number(trailCount()) - Number(trailBefore)} trail row(s); §8 says `
      + 'the request row is the history and the trail is for accountable acts');
    fx.request = first.body.request_ref;
    fx.erasureRequest = erasure.body.request_ref;
    console.log(`  V-01  ${first.body.request_ref} arrived as received/replayed=false, its second delivery `
      + 'answered the same ref and the same instant with only `replayed` flipped, the sibling kind filed '
      + `its own row (${erasure.body.request_ref}), 1 invented kind, 2 note shapes and 1 wedding that is not `
      + 'the caller\'s refused with 400/403 naming the caller\'s own value, the store stayed at 2 rows and '
      + 'the trail did not move at all across the four accepted filings');
  });

  test('V-02: the host list and the desk queue are two field sets over one row, and only the desk sees its annotation', async () => {
    const mine = await rpc('get_my_privacy_requests', {}, { as: 'hostC' });
    assert.equal(mine.status, 200, `the host's own privacy list answered ${json(shape(mine))}`);
    projection('get_my_privacy_requests', mine.body, 'the host list');
    assert.equal(typeof mine.body.count, 'number', 'the host list counted in something other than a number');
    assert.equal(mine.body.count, mine.body.requests.length,
      `the host list counted ${mine.body.count} and delivered ${mine.body.requests.length}`);
    for (const row of mine.body.requests) {
      assert.equal(keysOf(row), HOST_KEYS, `a host privacy row is not §8's seven fields: ${json(keysOf(row))}`);
      assert.ok(!Object.prototype.hasOwnProperty.call(row, 'operator_note'),
        'the host\'s own read carries the desk\'s working annotation');
      stamp(row.requested_at, 'a host list requested_at');
      stamp(row.updated_at, 'a host list updated_at');
    }
    const mineRow = findReq(mine.body, fx.request, 'the host list');
    assert.equal(mineRow.host_note, PRIV_NOTE, 'the note the host typed did not survive into their own read');
    assert.equal(mineRow.status, 'received', 'the host read reports a status the row does not hold');

    const desk = await rpc('operator_privacy_queue', { p_status: null }, { as: 'opPrivacy' });
    assert.equal(desk.status, 200, `the desk's queue answered ${json(shape(desk))}`);
    projection('operator_privacy_queue', desk.body, 'the queue');
    assert.ok(Object.prototype.hasOwnProperty.call(desk.body, 'status_filter'),
      'an unfiltered queue came back without the filter it was answered with');
    assert.equal(desk.body.status_filter, null, `the unfiltered queue echoed ${json(desk.body.status_filter)}`);
    assert.equal(desk.body.count, desk.body.requests.length,
      `the queue counted ${desk.body.count} and delivered ${desk.body.requests.length}`);
    for (const row of desk.body.requests) {
      assert.equal(keysOf(row), QUEUE_KEYS, `a queue privacy row is not §8's nine fields: ${json(keysOf(row))}`);
      assert.ok(UUID_RE.test(String(row.requester_user_id)),
        `the desk's read carries a requester that is not an account id: ${json(row.requester_user_id)}`);
    }
    const deskRow = findReq(desk.body, fx.request, 'the desk queue');
    assert.equal(String(deskRow.requester_user_id), uidOf('hostC'),
      'the desk attributes the request to somebody other than the account that filed it');
    assert.equal(deskRow.host_note, PRIV_NOTE, 'the desk does not see the note the host typed');
    assert.equal(deskRow.operator_note, null,
      'a request nobody annotated came back as a missing key rather than a JSON null');

    // The projection difference, on one row that *does* carry an annotation: privacyProbe was advanced by the
    // door probe in `before()`, so its operator note exists and its host cannot see it.
    const probe = findReq(desk.body, fixtures.privacyProbe, 'the desk queue');
    assert.equal(typeof probe.operator_note, 'string',
      'the desk\'s read of the annotated request carries no annotation, so the difference below proves nothing');
    assert.match(probe.operator_note, /door probe/, `the annotated row carries ${json(probe.operator_note)}`);
    const hostOfProbe = await rpc('get_my_privacy_requests', {}, { as: 'hostProbe' });
    const sameRef = findReq(hostOfProbe.body, fixtures.privacyProbe, 'that host\'s own list');
    assert.equal(sameRef.host_note, probe.host_note, 'the two surfaces disagree about the host\'s own note');
    assert.equal(sameRef.status, probe.status, 'the two surfaces disagree about the status');
    assert.ok(!Object.prototype.hasOwnProperty.call(sameRef, 'operator_note'),
      'the host read of an annotated request carries the desk\'s annotation');

    // The two bodies order the same store in opposite directions — the host's newest first (privacy:353),
    // the desk's oldest first (privacy:415) — and each delivered ordering is compared against the database's
    // own answer for that predicate, so a body that quietly flipped its ORDER BY cannot pass here.
    const expected = sqlRows(`select request_ref from private.privacy_requests
      order by requested_at asc, request_ref`);
    assert.deepEqual(desk.body.requests.map((row) => row.request_ref), expected,
      'the queue is not delivered oldest-first as its body asks');
    const expectedForHost = sqlRows(`select request_ref from private.privacy_requests
      where requester_user_id = '${uidOf('hostC')}'
      order by requested_at desc, request_ref`);
    assert.deepEqual(mine.body.requests.map((row) => row.request_ref), expectedForHost,
      'the host list is not delivered newest-first as its body asks');
    const one = await rpc('operator_privacy_queue', { p_status: 'received' }, { as: 'opPrivacy' });
    assert.equal(one.body.status_filter, 'received', 'the filter did not echo what was sent');
    assert.ok(one.body.requests.every((row) => row.status === 'received'),
      'a filtered queue delivered a row of another status');
    assert.ok(one.body.requests.some((row) => row.request_ref === fx.request),
      'the filter missed the received row this run just filed');
    await refusedDoor('operator_privacy_queue', { p_status: 'pending' }, 'opPrivacy',
      httpWire(400, '23514', SAY.privacyStatus, "'pending'", 'would answer with an empty queue'),
      'a queue filter word this lifecycle does not have', privacyProbes(fx.request));
    console.log(`  V-02  the host's own read is ${HOST_KEYS.split(',').length} fields over `
      + `${mine.body.count} rows, newest-first, and never carries operator_note; the desk's read is `
      + `${QUEUE_KEYS.split(',').length} fields over the ${desk.body.requests.length} rows in the whole store, `
      + `oldest-first, and does — the annotated probe kept that note from its own host and gave it to the desk, `
      + 'the received filter echoed itself and delivered only received rows, and a status word outside the '
      + 'five was refused rather than answered with an empty queue');
  });

  test('V-03: the advance door states its seven refusal shapes at the wire, naming the value that broke them, and moves nothing', async () => {
    const adv = (extra) => ({ p_request_ref: fx.request, p_status: 'identity_verification_requested',
      p_note: `asked the host to confirm the family (${RUN_TAG})`, p_idempotency_key: randomUUID(), ...extra });
    const rowBefore = requestLine(fx.request);
    await refusedDoor('operator_advance_privacy_request', adv({ p_status: 'fulfilled' }), 'opPrivacy',
      httpWire(400, '23514', SAY.privacyStatus, "'fulfilled'", 'the five are received'),
      'a status word this lifecycle does not have', privacyProbes(fx.request));
    await refusedDoor('operator_advance_privacy_request', adv({ p_idempotency_key: null }), 'opPrivacy',
      httpWire(400, '23514', SAY.privacyKey, 'advancing a privacy request requires an idempotency key'),
      'an advance with no key to make it one act', privacyProbes(fx.request));
    await refusedDoor('operator_advance_privacy_request', adv({ p_status: 'received' }), 'opPrivacy',
      httpWire(400, '23514', SAY.privacyBack, 'the desk saw it the moment it arrived'),
      'an advance back to received', privacyProbes(fx.request));
    // `p_note: null` here is load-bearing rather than tidy: the effective annotation is
    // `coalesce(btrim(p_note), v_row.operator_note)` (privacy:526), so this arm sent with the default real
    // note would *satisfy* `fx.request` and write a trail row, and V-04's first move would then start from a
    // status the row is no longer at. Refused for want of a name, it leaves the row exactly where V-04 needs
    // it.
    await refusedDoor('operator_advance_privacy_request',
      adv({ p_status: 'satisfied_outside_this_build', p_note: null }), 'opPrivacy',
      httpWire(400, '23514', SAY.privacySatisfied, 'a completion nobody can name is not evidence'),
      'a satisfied move that names nowhere the work was done', privacyProbes(fx.request));
    for (const [bad, label] of [['   ', 3], ['x'.repeat(4001), 4001]]) {
      await refusedDoor('operator_advance_privacy_request', adv({ p_note: bad }), 'opPrivacy',
        httpWire(400, '23514', SAY.privacyAdvNoteBound, `and ${label} characters is neither`),
        `an operator note of ${bad.length} characters`, privacyProbes(fx.request));
    }
    await refusedDoor('operator_advance_privacy_request',
      { p_request_ref: NOT_A_REQUEST_REF, p_status: 'identity_verification_requested', p_note: null,
        p_idempotency_key: randomUUID() }, 'opPrivacy',
      httpWire(403, '42501', SAY.privacyChangeNo), 'a ref that names no request',
      privacyProbes(fx.request));

    // The satisfied-with-a-note arm that the refusal above refuses, and nothing else: this is the presence
    // control for the whole seven, and it also proves the rule is about the *absence* of the annotation.
    // The row is walked to `queued_for_stage13` first because that is the only status the shipped lifecycle
    // offers `satisfied_outside_this_build` from (`20261020190300…:194`, and the HINT at `:198-200` names the
    // same edge); from `received` the trigger's edge rule answers instead of the annotation rule, and the
    // control would prove nothing about the arm it is meant to isolate.
    const queued = await rpc('operator_advance_privacy_request',
      { p_request_ref: fx.erasureRequest, p_status: 'queued_for_stage13', p_note: null,
        p_idempotency_key: randomUUID() }, { as: 'opPrivacy' });
    assert.equal(queued.status, 200, `the walk to the status that offers the satisfied edge answered `
      + `${json(shape(queued))}`);
    harvest(queued.body);
    assert.match(requestLine(fx.erasureRequest), /status=queued_for_stage13/,
      'the walk did not move the row that the presence control stands on');
    const named = await rpc('operator_advance_privacy_request',
      { p_request_ref: fx.erasureRequest, p_status: 'satisfied_outside_this_build',
        p_note: `hand-delivered to the family on paper (${RUN_TAG})`, p_idempotency_key: randomUUID() },
      { as: 'opPrivacy' });
    assert.equal(named.status, 200, `a satisfied move that names where it was satisfied answered `
      + `${json(shape(named))}, so the seven refusals above may be the door refusing everything`);
    harvest(named.body);
    assert.equal(named.body.to_status, 'satisfied_outside_this_build', 'the accepted advance reported otherwise');
    assert.match(requestLine(fx.erasureRequest), /status=satisfied_outside_this_build/,
      'the accepted advance did not move the row it answered for');
    assert.equal(requestLine(fx.request), rowBefore,
      'the refusals above moved the request they were only aimed at');
    console.log('  V-03  seven refusals at the advance door (a sixth status word, a missing key, a return to '
      + 'received, a satisfied move naming nowhere, two operator-note shapes and a ref that exists in '
      + 'nobody\'s store) each arrived as 400/23514 or 403/42501 carrying the caller\'s own value where the '
      + '`%` is, left the store, the row and the trail exactly as they were, and the same door then walked '
      + 'the control row to `queued_for_stage13` and accepted the satisfied move from there as soon as it '
      + 'named where the work was done');
  });

  test('V-04: a replay reads its answer off the trail, so a twice-moved request still returns its first move', async () => {
    const key = randomUUID();
    const first = await rpc('operator_advance_privacy_request',
      { p_request_ref: fx.request, p_status: 'identity_verification_requested',
        p_note: `asked the host to confirm the family (${RUN_TAG})`, p_idempotency_key: key },
      { as: 'opPrivacy' });
    assert.equal(first.status, 200, `the first advance answered ${json(shape(first))}`);
    projection('operator_advance_privacy_request', first.body, 'the advance answer');
    assert.equal(first.body.replayed, false, 'a fresh key called itself a replay');
    assert.equal(first.body.from_status, 'received', 'the advance reported a start the row was not at');
    assert.equal(first.body.to_status, 'identity_verification_requested',
      'the advance reported the move it did not make');
    assert.equal(typeof first.body.audit_id, 'number', `the advance's trail id is ${typeof first.body.audit_id}`);
    harvest(first.body);

    // A second, genuinely different act on the same row, with its own key.
    const second = await rpc('operator_advance_privacy_request',
      { p_request_ref: fx.request, p_status: 'queued_for_stage13', p_note: null,
        p_idempotency_key: randomUUID() }, { as: 'opPrivacy' });
    assert.equal(second.status, 200, `the second advance answered ${json(shape(second))}`);
    harvest(second.body);
    assert.equal(second.body.from_status, 'identity_verification_requested',
      'the second advance did not start where the first left the row');
    assert.match(requestLine(fx.request), /status=queued_for_stage13/,
      'the row did not move as the two accepted advances said it did');
    // The annotation rule the body states at privacy:526, observed as delivered bytes: a note-less second
    // advance keeps the first annotation rather than clearing it.
    assert.match(requestLine(fx.request), /operator=asked the host to confirm the family/,
      'the note-less second advance cleared the annotation the first one wrote');

    // What the replay must not do, read off the store on the bytes immediately before the replayed call:
    // the trail's row count, this host's request count, and the whole text of the row it is replaying. A
    // "replay" that quietly wrote its own audit row, filed a third request, or moved the row again would
    // move one of these three, and the assertions after the call would then be measuring the answer rather
    // than the absence.
    const trailBefore = trailCount();
    const rowsBefore = privCount();
    const lineBefore = requestLine(fx.request);

    const replay = await rpc('operator_advance_privacy_request',
      { p_request_ref: fx.request, p_status: 'identity_verification_requested', p_note: null,
        p_idempotency_key: key }, { as: 'opPrivacy' });
    assert.equal(replay.status, 200, `the replay of the first key answered ${json(shape(replay))}`);
    assert.equal(replay.body.replayed, true, 'a spent key was answered as a third act');
    assert.equal(replay.body.audit_id, first.body.audit_id,
      'the replay points at a trail row other than the one the first act wrote');
    // The sharp half: the row now stands at `queued_for_stage13`, and the replay still says the first move
    // in both directions, because it reads the audit row's before/after states rather than the request.
    assert.equal(replay.body.from_status, 'received',
      'the replay reported the current status as the start, so it is reading the row and not the trail');
    assert.equal(replay.body.to_status, 'identity_verification_requested',
      'the replay reports the move the request has since moved past');
    assert.notEqual(replay.body.to_status, second.body.to_status,
      'the two answers describe the same move, which means one of them is not what happened');
    const replayed = { ...replay.body };
    const original = { ...first.body };
    delete replayed.replayed;
    delete original.replayed;
    assert.deepEqual(replayed, original, `the replay is not the first answer with one flag changed: `
      + `${json(replayed)} vs ${json(original)}`);
    assert.equal(trailCount(), trailBefore, `the replay wrote ${Number(trailCount()) - Number(trailBefore)} `
      + 'trail row(s) instead of reading the one the first act wrote');
    assert.equal(privCount(), rowsBefore, `the replay filed ${Number(privCount()) - Number(rowsBefore)} `
      + 'extra request row(s) for this host');
    assert.equal(requestLine(fx.request), lineBefore,
      'the replay moved the request it was only answering for a second time');
    console.log(`  V-04  ${first.body.request_ref} walked received → identity_verification_requested → `
      + `queued_for_stage13 as two rows (trail ${first.body.audit_id}, ${second.body.audit_id}) and kept the `
      + 'first annotation through the note-less second move; the first key, re-sent after the row had moved '
      + 'again, returned that first move from the trail rather than the status the row now holds, and wrote '
      + 'nothing');
  });
});

// ===========================================================================
// Group AI — the trail as it looks from outside the doors (slice 1's store, §4)
//
// `80_operator_authority.sql` owns the trail in-database: its guards, its append-only rules, its grant table,
// its one-row-per-key index and the reason column's shape. None of that is restated. Three claims survive
// only on a running stack, and all three are about what a client can and cannot do to the store from here:
// that the relation has no route through the API at all, in any credential shape and any verb, so the
// 404s are the router's and not the role's; that none of the credentials this run actually used appear in
// any trail row this run wrote, while a value this run really did store appears from the same query shape;
// and that every trail row *of this stage* the run wrote is inside the nine (action, subject_type) pairs
// `run.sh`'s census filters on, with a `subject_key` that resolves in the store that pair names — because a
// door that wrote a tenth action would be invisible to the residue cell that is supposed to catch it. The
// third claim is scoped to Stage 11 rows, and AI-03 both says so and tests the scoping: the run publishes
// invitations while it sets its cast up, and those Stage 10 ledger rows are not this census's business.
// ===========================================================================
describe('S11 AI the trail from outside: no surface, no credential, no uncounted row', () => {
  /** The nine pairs `leak_census()` filters `stage11_audit_rows` on, read off `supabase/tests/api/run.sh`
   *  rather than typed here a second time, so that the two lists cannot drift apart unnoticed. */
  const censusPairs = () => {
    const script = readFileSync(resolve(ROOT, 'supabase/tests/api/run.sh'), 'utf8');
    const m = /\(action, subject_type\) in \(((?:\([^)]*\),?\s*)+)\)/.exec(script);
    assert.ok(m, 'the census in run.sh no longer filters on an (action, subject_type) pair list, so this '
      + 'instrument\'s other half is pointing at nothing');
    return [...m[1].matchAll(/\('([^']+)', ?'([^']+)'\)/g)]
      .map(([, action, subject]) => `${action}/${subject}`)
      .sort();
  };
  /** The stores each subject_type names, so a pointer sweep can ask the database whether the row it points
   *  at exists rather than assume it. */
  const SUBJECT_STORE = { support_case: 'private.support_cases', privacy_request: 'private.privacy_requests',
    commerce_refund: 'private.commerce_refunds', publication: 'public.publications',
    operator_grant: 'private.operator_grants' };
  /** Everything this run could have written, by five predicates rather than one: the ids its own answers
   *  named, its own weddings, its own reasons, its own accounts and the grants its own reasons name. A scan
   *  over a superset is how an absence claim earns the right to be one. */
  const runRows = () => {
    const ids = [...auditIds].join(',') || '0';
    const weddings = allWeddings.length ? allWeddings.map((w) => `'${w}'::uuid`).join(',')
      : "'00000000-0000-0000-0000-000000000000'::uuid";
    return `id in (${ids}) or wedding_id in (${weddings}) or reason like '%${RUN_TAG}%' `
      + `or actor_user_id in (select id from auth.users where email like '%${RUN_TAG}%') `
      + `or subject_key in (select id from private.operator_grants where reason like '%${RUN_TAG}%')`;
  };
  /** The Stage 11 half of that superset. `actor_kind` and `idempotency_key` are both columns this stage
   *  added (authority :190 and :192), and every audit insert in the five stage-11 bodies stamps the kind as
   *  'operator' or 'maintenance' — so the predicate is this stage's acts and only theirs, because a
   *  pre-stage writer leaves the kind at its 'system' default and the key null. `run.sh`'s census counts
   *  this stage's acts, so it is this set rather than the whole superset that has to fall inside its filter;
   *  the run also publishes invitations, and those machine rows belong to Stage 10's ledger, not here. */
  const stage11Rows = () => `(${runRows()}) and (actor_kind in ('operator', 'maintenance')
    or idempotency_key is not null)`;
  /** A value goes into a SQL literal only if it is the shape this file mints; anything else is a bug in the
   *  needle list and is refused rather than quoted and hoped for. */
  const literal = (value, what) => {
    assert.match(String(value), /^[\w.\-]+$/, `${what} is not a safe needle to put in a query`);
    return `'${String(value).replace(/'/g, "''")}'`;
  };

  test('AI-01: the trail has no route through the API, in any verb and for any credential, while an exposed table answers the same client', async () => {
    const shapes = [
      ['GET', '/rest/v1/audit_events?select=*&limit=1', undefined],
      ['POST', '/rest/v1/audit_events', { action: 'forged', subject_type: 'support_case' }],
      ['PATCH', '/rest/v1/audit_events?id=eq.1', { reason: 'rewritten by a client' }],
      ['DELETE', '/rest/v1/audit_events?id=eq.1', undefined],
    ];
    let probes = 0;
    for (const [method, path, body] of shapes) {
      for (const as of ['anon', 'hostA', 'opOps', 'service']) {
        const r = await call(method, path, { body, bearer: as === 'anon' ? anonKey
          : as === 'service' ? serviceKey : tokenOf(as) });
        probes += 1;
        assert.equal(r.status, 404, `${method} ${path} as ${as} answered ${json(shape(r))}, not 404`);
        assert.equal(r.body?.code, 'PGRST205', `${method} ${path} as ${as} answered ${r.body?.code}, not the `
          + `"the relation is not in the schema cache" code: ${json(shape(r))}`);
      }
    }
    // Two shapes — one read, one write — against a relation the router does know, from a session credential
    // like the sixteen above: without this half, sixteen 404s would be indistinguishable from a router that
    // 404s everything it is asked for.
    const reachable = await call('GET', '/rest/v1/weddings?select=id&limit=1',
      { bearer: tokenOf('hostProbe') });
    assert.equal(reachable.status, 200, `the presence control could not read an exposed table: `
      + `${json(shape(reachable))}`);
    // A row-count probe on either side of the write arm, because this control must be able to say it wrote
    // nothing as well as it says the router knows the relation.
    const weddingsBefore = count('from public.weddings', 'the whole wedding table');
    // The write shape, sent as a PATCH whose filter names a wedding id that exists in nobody's store and
    // whose Prefer header asks for no body: the router still has to route it, so the answer is about
    // routing, while zero matched rows means no insert and no rewritten column. A POST would have created a
    // wedding this file never registered, and the teardown and the residue cell would both be reading a row
    // the instrument made up.
    const writeShape = await call('PATCH', `/rest/v1/weddings?id=eq.${NOT_A_WEDDING}`,
      { body: { name: 'a write shape probe' }, bearer: tokenOf('hostProbe'),
        headers: { Prefer: 'return=minimal' } });
    assert.equal(count('from public.weddings', 'the whole wedding table'), weddingsBefore,
      `the write-shape control moved the wedding count from ${weddingsBefore}, so it was not the zero-match `
      + 'PATCH this case claims to send');
    assert.notEqual(writeShape.status, 404, `PATCH /weddings?id=eq.<absent> answered 404 to a relation the `
      + `router must know: ${json(shape(writeShape))}`);
    assert.notEqual(writeShape.body?.code, 'PGRST205',
      `PATCH /weddings answered the schema-cache code too, so the router's answer carries no information: `
      + `${json(shape(writeShape))}`);
    // The grant census, stated as the shipped design states it rather than as a tidier number. Stage 2
    // opened `SELECT, INSERT, UPDATE, DELETE` on the trail to `service_role`
    // (`20260925120400_stage2_assets_entitlements_secrets.sql:197`) and slice 1 revoked the rewrite half
    // (`20261020190000_stage11_operator_authority.sql:254`), so the live posture is the append-only pair.
    // What must be empty is the *session* credential set — the roles a browser token can ever be — and what
    // must be absent from the key's set is any grant that lets it rewrite or erase a row. That the remaining
    // pair is not a route is the claim of the HTTP half above: the sixteen shapes include ones sent with the
    // service_role key itself, and each answered PGRST205.
    const sessionGrants = sqlRows(`select grantee || ':' || privilege_type
      from information_schema.role_table_grants
      where table_schema = 'private' and table_name = 'audit_events'
        and grantee in ('anon','authenticated') order by 1`);
    assert.deepEqual(sessionGrants, [], `a session role holds a table grant on private.audit_events: `
      + `${json(sessionGrants)}`);
    const keyGrants = sqlRows(`select grantee || ':' || privilege_type
      from information_schema.role_table_grants
      where table_schema = 'private' and table_name = 'audit_events'
        and grantee = 'service_role' order by 1`);
    assert.deepEqual(keyGrants, ['service_role:INSERT', 'service_role:SELECT'],
      `the server key's grants on the trail are not the append-only pair slice 1 left them as: ${json(keyGrants)}`);
    const exposed = cell(`select coalesce(string_agg(c.relname, ',' order by c.relname), '<none>')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'api' and c.relname = 'audit_events'`, 'the api relation census');
    assert.equal(exposed, '<none>', 'the api schema exposes a relation named audit_events, so the router has '
      + 'a route to the trail after all');
    console.log(`  AI-01  ${probes} request shapes (4 verbs × anon, a host, an operator and service_role) `
      + 'against /rest/v1/audit_events each answered 404 PGRST205, while the same kind of client reads an '
      + 'exposed table in 200 and gets a non-404, non-schema-cache answer to a PATCH that matched no row and '
      + 'left the wedding count where it was; ' + `${sessionGrants.length} grants reach the trail from a `
      + 'session role, the server key holds exactly ' + `${json(keyGrants)} — the append-only pair slice 1 `
      + 'left it with, no UPDATE or DELETE grant survives on the table for any of the three roles, and no '
      + 'api relation of that name exists');
  });

  test('AI-02: no credential this run used reaches any trail row this run wrote, and the same scan finds the value this run did store', async () => {
    // `people[who]?.token` rather than `tokenOf(who)`: an account this run never created has to arrive as a
    // missing needle that the count below reports, not as a TypeError thrown before any assertion runs.
    const needles = [['the run password', PASSWORD], ['the anon key', anonKey],
      ['the service role key', serviceKey],
      ...WHO.map((who) => [`the bearer token of ${who}`, people[who]?.token])]
      .filter(([, value]) => typeof value === 'string' && value.length > 0);
    assert.equal(needles.length, WHO.length + 3, 'a credential this run holds was empty, so the scan below '
      + `saw ${needles.length} of ${WHO.length + 3} needles`);
    const where = runRows();
    const scanned = count(`from private.audit_events where ${where}`, 'the rows this run wrote');
    assert.ok(Number(scanned) > 0, 'this run wrote no trail rows, so an absence claim over them proves nothing');
    const hits = [];
    for (const [label, value] of needles) {
      const needle = literal(value, label);
      const n = count(`from private.audit_events where (${where}) and (
          payload::text like '%' || ${needle} || '%'
          or coalesce(reason, '') like '%' || ${needle} || '%'
          or before_state::text like '%' || ${needle} || '%'
          or after_state::text like '%' || ${needle} || '%'
          or coalesce(idempotency_key, '') like '%' || ${needle} || '%')`,
        `trail rows carrying ${label}`);
      if (Number(n) > 0) hits.push(`${label} in ${n} row(s)`);
    }
    assert.deepEqual(hits, [], `credentials this run actually used are sitting in the trail: ${json(hits)}`);
    // The wired control, in the identical query shape against the store that is allowed to carry it: the
    // sentinel this run typed into a host's own summary must be found, or the scan above would also "find"
    // nothing in a store full of it.
    const found = count(`from private.support_cases where host_summary like '%${SENTINEL}%'`,
      'the case rows carrying the sentinel');
    assert.ok(Number(found) > 0, 'the presence control found no case row carrying the sentinel, so the scan '
      + 'above cannot tell a clean store from a broken one');
    console.log(`  AI-02  ${scanned} trail rows this run wrote carry none of ${needles.length} credentials `
      + `(the run password, both API keys and every cast account's bearer token) in payload, reason, either `
      + 'state column or the key, while the same query shape finds the sentinel in '
      + `${found} case row(s) it belongs in`);
  });

  test('AI-03: every Stage 11 act in the trail is inside the census\'s own filter, and its subject pointer resolves', async () => {
    const pairs = censusPairs();
    assert.equal(pairs.length, 9, `run.sh's census filter now holds ${pairs.length} pairs, not the nine this `
      + `instrument transcribes: ${json(pairs)}`);
    // The filter this case checks against is spelled out of the transcription above rather than typed a
    // second time here, where a tenth pair added to run.sh would leave a stale copy behind and the case
    // would keep passing over the list this file invented.
    const pairList = pairs.map((p) => {
      const [action, subject] = p.split('/');
      return `('${action}', '${subject}')`;
    }).join(', ');
    const broad = runRows();
    const where = stage11Rows();
    const total = Number(count(`from private.audit_events where ${where}`, 'the Stage 11 rows this run wrote'));
    assert.ok(total > 0, 'this run wrote no Stage 11 trail rows, so the sweep below measures an empty set');
    const totalBroad = Number(count(`from private.audit_events where ${broad}`, 'every trail row this run touched'));
    assert.ok(totalBroad >= total, `the ${total} Stage 11 rows are not inside the ${totalBroad} rows this run `
      + 'touched, so one of the two predicates here is not what its text says');
    // (a) every Stage 11 row's (action, subject_type) is one the census counts. A tenth pair would be a door
    // whose act `leak_census` cannot see, and the residue equality would still pass. `action` and
    // `subject_type` are both NOT NULL from the stage-2 table (20260925120400:92,94), so a row cannot hide
    // from `NOT IN` by being NULL.
    const outside = sqlRows(`select action || '/' || subject_type from private.audit_events
      where (${where}) and (action, subject_type) not in (${pairList})
      group by 1 order by 1`);
    assert.deepEqual(outside, [], `Stage 11 trail rows this run wrote carry an (action, subject_type) the `
      + `census does not filter on, so leak_census would report 0 for them: ${json(outside)}`);
    // (b) the scope in (a) is this case's own claim, so it is tested rather than trusted: no row the census
    // DOES count may fall outside it. A stage act stamped with some other actor kind and no key would sit in
    // the broad set, inside the filter, and be invisible to the sweep above — which is how a door escapes
    // the residue cell a second time, through this file rather than through run.sh.
    const escaped = count(`from private.audit_events where (${broad})
      and (action, subject_type) in (${pairList})
      and actor_kind not in ('operator', 'maintenance') and idempotency_key is null`,
      'census-counted rows the scope predicate above lets fall outside Stage 11');
    assert.equal(escaped, '0', `${escaped} trail row(s) this run wrote carry one of the census's own pairs but `
      + 'no Stage 11 actor kind and no idempotency key, so the scope above is dropping counted acts');
    // (c) the pointer: every row's subject_key exists in the store its subject_type names.
    const dangling = [];
    for (const [subject, store] of Object.entries(SUBJECT_STORE)) {
      const n = count(`from private.audit_events where (${where}) and subject_type = '${subject}'
        and subject_key is not null
        and not exists (select 1 from ${store} t where t.id = private.audit_events.subject_key)`,
        `rows naming a ${subject} that does not exist`);
      if (Number(n) > 0) dangling.push(`${subject} in ${n} row(s)`);
    }
    assert.deepEqual(dangling, [], `the trail points at rows that are not in the stores it names: ${json(dangling)}`);
    // The control for (c), in the same shape: the resolver must answer "dangling" for a pointer that really
    // is one, or the five zeroes above are a lookup that cannot fail.
    const control = count(`from (select '00000000-0000-4000-8000-000000000000'::uuid as subject_key,
        'support_case' as subject_type) fake
      where not exists (select 1 from private.support_cases t
        where t.id = fake.subject_key)`, 'a deliberately dangling pointer');
    assert.equal(control, '1', 'the pointer lookup answered 0 for a uuid that exists in no store, so the '
      + 'sweep above cannot report a dangling row at all');
    const present = sqlRows(`select subject_type from private.audit_events where (${where})
      and subject_key is not null group by 1 order by 1`);
    assert.ok(present.length > 1, `only ${json(present)} of the run's rows carry a resolvable subject, so `
      + 'the sweep and its control are both looking at almost nothing');
    console.log(`  AI-03  ${total} of the ${totalBroad} trail rows this run touched are Stage 11 acts; all `
      + `${total} fall inside the ${pairs.length} (action, subject_type) pairs run.sh filters on, none carries `
      + 'a pair outside them, no counted row escapes that scope, every subject_key resolves in the store its '
      + `own subject_type names across ${present.length} of those families, and the same lookup calls a `
      + 'planted uuid dangling');
  });
});

// ===========================================================================
// Group H — the health projection as the HTTP body delivers it (§9, slice 5)
//
// The database tier of this slice already proves the projection against itself: `95_operations_health.sql`
// walks the ten blocks' field lists, the four refusals, the window's bounds and default, the credential
// partition, the five lifecycle vocabularies, the one-instant `now()`, the derived `blocks_not_measured`,
// both `migrations` branches (by installing a fixture at that name), the attempt ceiling read out of
// `pg_get_constraintdef`, and non-writability three ways with eighteen table digests. None of that is
// restated here: a second copy of a proof is a second thing to rot. What only this tier can say is about
// the transport — that PostgREST serialises the jsonb without turning a bigint into a string or a SQL NULL
// into an absent key, that the *delivered* numbers equal a fresh re-aggregation of the live stores at the
// instant the call itself stamped, that the window refusal reaches a client as 400 naming the value that
// broke it, and that the delivered body text carries no identifier of any kind. Five cases, in that order.
//
// Two rows are planted for the group to read, in `before()` below rather than inside a case, because H-03
// compares a delivered number against the store and one of the numbers it compares is a windowed count
// that needs an old row to discriminate at all.
// ===========================================================================
describe('S11 H the health projection as the body delivers it', () => {
  /** Every timestamp this file puts back into SQL as a literal passes through here first, so an answer that
   *  arrived as prose or as a quoted-empty-string cannot become a statement. */
  const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  const stamp = (value, what) => {
    assert.match(String(value), ISO_STAMP,
      `${what} did not arrive as an ISO instant: ${shown(value).slice(0, 80)}`);
    return String(value);
  };

  /** The ten names the body assembles, in the order it assembles them (the answer's own key order is
   *  jsonb's, so only the set is asserted; `block_count` is asserted against this list's length). */
  const BLOCK_NAMES = ['migrations', 'publication', 'credentials', 'delivery', 'commerce', 'audit',
    'queue', 'auth_failures', 'rate_limits', 'token_abuse'];

  /** Each block's field list, transcribed from the `jsonb_build_object` that builds it — `:136-341` — and
   *  here used against the *parsed body*, which is where a serialiser could drop or rename a key. */
  const BLOCK_KEYS = {
    publication: keySet('status', 'as_of', 'window_hours', 'newest_at', 'total', 'active_total',
      'revoked_total', 'weddings_with_active_publication', 'published_in_window', 'revoked_in_window'),
    credentials: keySet('status', 'as_of', 'window_hours', 'newest_at', 'total', 'live', 'expired', 'revoked',
      'never_used', 'used_in_window', 'last_used_at', 'live_by_kind'),
    delivery: keySet('status', 'as_of', 'window_hours', 'newest_at', 'total', 'registered', 'uploading',
      'ready', 'failed', 'invalidated', 'failed_at_attempt_ceiling', 'invalidated_by_publication_revoked'),
    commerce: keySet('status', 'as_of', 'window_hours', 'newest_at', 'events_total', 'applied', 'duplicate',
      'rejected_signature', 'held_for_reconciliation', 'stale', 'events_in_window', 'held_by_reason',
      'orders', 'refunds'),
    audit: keySet('status', 'as_of', 'window_hours', 'newest_at', 'total', 'rows_in_window', 'with_reason',
      'by_actor_kind', 'by_action_prefix', 'operator_rows_without_case_link'),
    queue: keySet('status', 'as_of', 'window_hours', 'cases', 'privacy_requests'),
    absence: keySet('status', 'as_of', 'reason'),
    migrationsMeasured: keySet('status', 'as_of', 'applied_count', 'highest_version'),
    migrationsNotMeasured: keySet('status', 'as_of', 'reason', 'note'),
  };
  const SUB_KEYS = {
    'commerce.orders': keySet('total', 'open', 'payment_pending', 'captured', 'cancelled', 'expired',
      'newest_at'),
    'commerce.refunds': keySet('total', 'recorded', 'succeeded', 'failed', 'reversed', 'without_review_note',
      'newest_at'),
    'queue.cases': keySet('open', 'triaged', 'in_progress', 'awaiting_information', 'resolved', 'closed',
      'live_total', 'unclaimed_live', 'aged_outside_window', 'resolved_in_window', 'newest_at', 'total'),
    'queue.privacy_requests': keySet('received', 'identity_verification_requested', 'queued_for_stage13',
      'satisfied_outside_this_build', 'declined', 'unresolved_total', 'unresolved_outside_window', 'newest_at',
      'total'),
    'audit.operator_rows_without_case_link': keySet('count'),
  };

  const at = (value, path) => path.split('.')
    .reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), value);

  /** One scalar leaf of the answer next to the query that re-aggregates it from the store it came from.
   *  `@AS@` and `@FROM@` are the call's own two instants, substituted after `stamp()` has proved their
   *  shape: pinning them is what makes the comparison mean "the answer counted the same instant the count
   *  reads", instead of "two queries happened to agree". Every expression below mirrors one `FILTER`
   *  clause of the body, clause for clause, which is also why the `without_review_note` tile repeats the
   *  body's `NOT EXISTS` rather than joining the note table. */
  const TILES = [
    { path: 'publication.newest_at', sql: `(select coalesce(max(p.updated_at)::text, 'null')
        from public.publications p)` },
    { path: 'publication.total', sql: `(select count(*) from public.publications p)` },
    { path: 'publication.active_total', sql: `(select count(*) filter (where p.status = 'active')
        from public.publications p)` },
    { path: 'publication.revoked_total', sql: `(select count(*) filter (where p.status = 'revoked')
        from public.publications p)` },
    { path: 'publication.weddings_with_active_publication',
      sql: `(select count(distinct p.wedding_id) filter (where p.status = 'active')
        from public.publications p)` },
    { path: 'publication.published_in_window',
      sql: `(select count(*) filter (where p.published_at >= @FROM@) from public.publications p)` },
    { path: 'publication.revoked_in_window',
      sql: `(select count(*) filter (where p.revoked_at is not null and p.revoked_at >= @FROM@)
        from public.publications p)` },
    { path: 'credentials.newest_at', sql: `(select coalesce(max(t.created_at)::text, 'null')
        from private.access_tokens t)` },
    { path: 'credentials.total', sql: `(select count(*) from private.access_tokens t)` },
    { path: 'credentials.live', sql: `(select count(*) filter (where t.revoked_at is null
        and (t.expires_at is null or t.expires_at >= @AS@)) from private.access_tokens t)` },
    { path: 'credentials.expired', sql: `(select count(*) filter (where t.revoked_at is null
        and t.expires_at is not null and t.expires_at < @AS@) from private.access_tokens t)` },
    { path: 'credentials.revoked', sql: `(select count(*) filter (where t.revoked_at is not null)
        from private.access_tokens t)` },
    { path: 'credentials.never_used', sql: `(select count(*) filter (where t.last_used_at is null)
        from private.access_tokens t)` },
    { path: 'credentials.used_in_window', sql: `(select count(*) filter (where t.last_used_at >= @FROM@)
        from private.access_tokens t)` },
    { path: 'credentials.last_used_at', sql: `(select coalesce(max(t.last_used_at)::text, 'null')
        from private.access_tokens t)` },
    { path: 'delivery.newest_at', sql: `(select coalesce(max(o.updated_at)::text, 'null')
        from public.invitation_outputs o)` },
    { path: 'delivery.total', sql: `(select count(*) from public.invitation_outputs o)` },
    { path: 'delivery.registered', sql: `(select count(*) filter (where o.status = 'registered')
        from public.invitation_outputs o)` },
    { path: 'delivery.uploading', sql: `(select count(*) filter (where o.status = 'uploading')
        from public.invitation_outputs o)` },
    { path: 'delivery.ready', sql: `(select count(*) filter (where o.status = 'ready')
        from public.invitation_outputs o)` },
    { path: 'delivery.failed', sql: `(select count(*) filter (where o.status = 'failed')
        from public.invitation_outputs o)` },
    { path: 'delivery.invalidated', sql: `(select count(*) filter (where o.status = 'invalidated')
        from public.invitation_outputs o)` },
    // The ceiling literal at `:191`. `95_operations_health.sql` compares it to the CHECK constraint's own
    // text; repeating that here would prove nothing new, so this tile only checks that the number the
    // operator is served was counted with the same predicate the constraint allows.
    { path: 'delivery.failed_at_attempt_ceiling', sql: `(select count(*) filter (where o.status = 'failed'
        and o.attempt_count >= 5) from public.invitation_outputs o)` },
    { path: 'delivery.invalidated_by_publication_revoked',
      sql: `(select count(*) filter (where o.invalidation_reason = 'publication_revoked')
        from public.invitation_outputs o)` },
    { path: 'commerce.newest_at', sql: `(select coalesce(max(e.received_at)::text, 'null')
        from private.commerce_payment_events e)` },
    { path: 'commerce.events_total', sql: `(select count(*) from private.commerce_payment_events e)` },
    { path: 'commerce.applied', sql: `(select count(*) filter (where e.processing_status = 'applied')
        from private.commerce_payment_events e)` },
    { path: 'commerce.duplicate', sql: `(select count(*) filter (where e.processing_status = 'duplicate')
        from private.commerce_payment_events e)` },
    { path: 'commerce.rejected_signature',
      sql: `(select count(*) filter (where e.processing_status = 'rejected_signature')
        from private.commerce_payment_events e)` },
    { path: 'commerce.held_for_reconciliation',
      sql: `(select count(*) filter (where e.processing_status = 'held_for_reconciliation')
        from private.commerce_payment_events e)` },
    { path: 'commerce.stale', sql: `(select count(*) filter (where e.processing_status = 'stale')
        from private.commerce_payment_events e)` },
    { path: 'commerce.events_in_window', sql: `(select count(*) filter (where e.received_at >= @FROM@)
        from private.commerce_payment_events e)` },
    { path: 'commerce.orders.total', sql: `(select count(*) from private.commerce_orders o)` },
    { path: 'commerce.orders.open', sql: `(select count(*) filter (where o.status = 'open')
        from private.commerce_orders o)` },
    { path: 'commerce.orders.payment_pending', sql: `(select count(*) filter (where o.status = 'payment_pending')
        from private.commerce_orders o)` },
    { path: 'commerce.orders.captured', sql: `(select count(*) filter (where o.status = 'captured')
        from private.commerce_orders o)` },
    { path: 'commerce.orders.cancelled', sql: `(select count(*) filter (where o.status = 'cancelled')
        from private.commerce_orders o)` },
    { path: 'commerce.orders.expired', sql: `(select count(*) filter (where o.status = 'expired')
        from private.commerce_orders o)` },
    { path: 'commerce.orders.newest_at', sql: `(select coalesce(max(o.updated_at)::text, 'null')
        from private.commerce_orders o)` },
    { path: 'commerce.refunds.total', sql: `(select count(*) from private.commerce_refunds r)` },
    { path: 'commerce.refunds.recorded', sql: `(select count(*) filter (where r.status = 'recorded')
        from private.commerce_refunds r)` },
    { path: 'commerce.refunds.succeeded', sql: `(select count(*) filter (where r.status = 'succeeded')
        from private.commerce_refunds r)` },
    { path: 'commerce.refunds.failed', sql: `(select count(*) filter (where r.status = 'failed')
        from private.commerce_refunds r)` },
    { path: 'commerce.refunds.reversed', sql: `(select count(*) filter (where r.status = 'reversed')
        from private.commerce_refunds r)` },
    { path: 'commerce.refunds.without_review_note',
      sql: `(select count(*) filter (where not exists (select 1 from private.commerce_review_notes n
               where n.refund_id = r.id)) from private.commerce_refunds r)` },
    { path: 'commerce.refunds.newest_at', sql: `(select coalesce(max(r.recorded_at)::text, 'null')
        from private.commerce_refunds r)` },
    { path: 'audit.newest_at', sql: `(select coalesce(max(a.created_at)::text, 'null')
        from private.audit_events a)` },
    { path: 'audit.total', sql: `(select count(*) from private.audit_events a)` },
    { path: 'audit.rows_in_window', sql: `(select count(*) filter (where a.created_at >= @FROM@)
        from private.audit_events a)` },
    { path: 'audit.with_reason', sql: `(select count(*) filter (where a.reason is not null)
        from private.audit_events a)` },
    // The case link matched by widening the *event* column, exactly as `:272` does it. The cast is the
    // defect this shape avoids: `audit_events.idempotency_key` is bounded text that need not be a uuid, so
    // casting the other direction would raise 22P02 inside a read-only screen.
    { path: 'audit.operator_rows_without_case_link.count',
      sql: `(select count(*) from private.audit_events a where a.actor_kind = 'operator'
        and not exists (select 1 from private.support_case_events e
                         where e.idempotency_key::text = a.idempotency_key))` },
    { path: 'queue.cases.open', sql: `(select count(*) filter (where c.status = 'open')
        from private.support_cases c)` },
    { path: 'queue.cases.triaged', sql: `(select count(*) filter (where c.status = 'triaged')
        from private.support_cases c)` },
    { path: 'queue.cases.in_progress', sql: `(select count(*) filter (where c.status = 'in_progress')
        from private.support_cases c)` },
    { path: 'queue.cases.awaiting_information',
      sql: `(select count(*) filter (where c.status = 'awaiting_information') from private.support_cases c)` },
    { path: 'queue.cases.resolved', sql: `(select count(*) filter (where c.status = 'resolved')
        from private.support_cases c)` },
    { path: 'queue.cases.closed', sql: `(select count(*) filter (where c.status = 'closed')
        from private.support_cases c)` },
    { path: 'queue.cases.live_total', sql: `(select count(*) filter (where c.status in ('open', 'triaged',
        'in_progress', 'awaiting_information')) from private.support_cases c)` },
    { path: 'queue.cases.unclaimed_live', sql: `(select count(*) filter (where c.status in ('open', 'triaged',
        'in_progress', 'awaiting_information') and c.assigned_operator_user_id is null)
        from private.support_cases c)` },
    { path: 'queue.cases.aged_outside_window', sql: `(select count(*) filter (where c.status in ('open',
        'triaged', 'in_progress', 'awaiting_information') and c.opened_at < @FROM@)
        from private.support_cases c)` },
    { path: 'queue.cases.resolved_in_window', sql: `(select count(*) filter (where c.status in ('resolved',
        'closed') and c.resolved_at >= @FROM@) from private.support_cases c)` },
    { path: 'queue.cases.newest_at', sql: `(select coalesce(max(c.updated_at)::text, 'null')
        from private.support_cases c)` },
    { path: 'queue.cases.total', sql: `(select count(*) from private.support_cases c)` },
    { path: 'queue.privacy_requests.received', sql: `(select count(*) filter (where r.status = 'received')
        from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.identity_verification_requested',
      sql: `(select count(*) filter (where r.status = 'identity_verification_requested')
        from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.queued_for_stage13',
      sql: `(select count(*) filter (where r.status = 'queued_for_stage13') from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.satisfied_outside_this_build',
      sql: `(select count(*) filter (where r.status = 'satisfied_outside_this_build')
        from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.declined', sql: `(select count(*) filter (where r.status = 'declined')
        from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.unresolved_total', sql: `(select count(*) filter (where r.status in
        ('received', 'identity_verification_requested', 'queued_for_stage13'))
        from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.unresolved_outside_window', sql: `(select count(*) filter (where
        r.status in ('received', 'identity_verification_requested', 'queued_for_stage13')
        and r.requested_at < @FROM@) from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.newest_at', sql: `(select coalesce(max(r.updated_at)::text, 'null')
        from private.privacy_requests r)` },
    { path: 'queue.privacy_requests.total', sql: `(select count(*) from private.privacy_requests r)` },
    // The four grouped counters: `key:count` pairs, sorted under `"C"` so the database's ordering and
    // JavaScript's default string ordering are the same ordering. Without that collate clause an `en_US`
    // collation sorts `_` inside the alphabet and every comparison below would hinge on the locale.
    { path: 'credentials.live_by_kind', grouped: true,
      sql: `(select coalesce(string_agg(k || ':' || n::text, ',' order by k collate "C"), '') from
        (select t.token_kind as k, count(*) filter (where t.revoked_at is null
           and (t.expires_at is null or t.expires_at >= @AS@)) as n
           from private.access_tokens t group by t.token_kind) y)` },
    { path: 'commerce.held_by_reason', grouped: true,
      sql: `(select coalesce(string_agg(k || ':' || n::text, ',' order by k collate "C"), '') from
        (select e.hold_reason as k, count(*) as n from private.commerce_payment_events e
          where e.processing_status = 'held_for_reconciliation' group by e.hold_reason) y)` },
    { path: 'audit.by_actor_kind', grouped: true,
      sql: `(select coalesce(string_agg(k || ':' || n::text, ',' order by k collate "C"), '') from
        (select a.actor_kind as k, count(*) as n from private.audit_events a group by a.actor_kind) y)` },
    { path: 'audit.by_action_prefix', grouped: true,
      sql: `(select coalesce(string_agg(k || ':' || n::text, ',' order by k collate "C"), '') from
        (select split_part(a.action, '_', 1) as k, count(*) as n from private.audit_events a
          group by 1) y)` },
    // The `migrations` block is presence-gated, and on this stack the tool's own table is there, so the
    // measured pair is what the wire carries. The absent branch is proven in the SQL tier by a fixture at
    // that name; dropping the real table here would be a destructive reset of a stack this stage does not
    // own, so `not_measured` is asserted-against-to_regclass at H-01 and never re-enacted.
    { path: 'migrations.applied_count', migrationsBranch: 'measured',
      sql: `(select count(*) from supabase_migrations.schema_migrations)` },
    { path: 'migrations.highest_version', migrationsBranch: 'measured', text: true,
      sql: `(select coalesce(max(version)::text, 'null') from supabase_migrations.schema_migrations)` },
  ];

  const pinned = (sql, a) => sql
    .replaceAll('@AS@', `'${stamp(a.as_of, 'the top-level as_of')}'::timestamptz`)
    .replaceAll('@FROM@', `'${stamp(a.from_inclusive, 'the top-level from_inclusive')}'::timestamptz`);

  /** All the tiles in one round trip: eighty-odd `psql` children would take longer than the case they
   *  serve and would each read the stores at a different instant, which is precisely the thing the tiles
   *  exist to compare. The index travels in the line so the row order is never trusted. */
  /** psql writes a `timestamptz` as `2026-10-29 13:53:28.359711+00` while the delivered body carries the same
   *  instant as `2026-10-29T13:53:28.359711+00:00`. A stamp tile is compared only after the store's own text
   *  has been put into the delivered form: every digit survives, so an instant that genuinely differs — by a
   *  microsecond, by a zone, or by being absent — still fails, while a difference of rendering alone no longer
   *  reads as a disagreement between the body and the store. */
  const wireStamp = (text) => {
    const iso = text.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
    assert.ok(ISO_STAMP.test(iso), `the store's stamp ${shown(text).slice(0, 80)} is not a form this `
      + 'instrument can put beside the delivered one');
    return iso;
  };

  const readTiles = (a) => {
    const live = TILES.filter((t) => !t.migrationsBranch
      || t.migrationsBranch === String(at(a.blocks, 'migrations.status')));
    const query = live.map((t, i) => `select '${i}|' || (${pinned(t.sql, a)})::text`).join(' union all ');
    const rows = sqlRows(query);
    assert.equal(rows.length, live.length,
      `the tile read answered ${rows.length} rows for ${live.length} tiles`);
    const out = {};
    for (const line of rows) {
      const bar = line.indexOf('|');
      assert.ok(bar > 0, `a tile row arrived without its index: ${shown(line).slice(0, 120)}`);
      const tile = live[Number(line.slice(0, bar))];
      out[tile.path] = tile.path.endsWith('_at')
        ? wireStamp(line.slice(bar + 1)) : line.slice(bar + 1);
    }
    assert.equal(Object.keys(out).length, live.length, 'two tiles answered the same path');
    return out;
  };

  const groupedText = (value) => Object.entries(value ?? {}).map(([k, v]) => `${k}:${v}`).sort().join(',');

  /** The blocks tree flattened to dotted leaf paths, with the two stamps left in: H-05 strips them by name. */
  const leaf = (blocks) => {
    const out = {};
    const walk = (value, prefix) => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) walk(v, prefix ? `${prefix}.${k}` : k);
      } else out[prefix] = value;
    };
    walk(blocks, '');
    return out;
  };
  /** The eight fields whose `FILTER` names `v_from` (`:144-145, :164, :213, :255, :291, :293, :310`). These
   *  are the only leaves a different window is allowed to move, which is what turns H-05's diff into a claim
   *  about the projection rather than a listing of whatever happened to differ. */
  const WINDOW_GATED = ['publication.published_in_window', 'publication.revoked_in_window',
    'credentials.used_in_window', 'commerce.events_in_window', 'audit.rows_in_window',
    'queue.cases.aged_outside_window', 'queue.cases.resolved_in_window',
    'queue.privacy_requests.unresolved_outside_window'];

  const summary = async (windowHours, what) => {
    const r = await rpc('operator_operations_summary', { p_window_hours: windowHours }, { as: 'opOps' });
    assert.equal(r.status, 200, `${what} answered ${json(shape(r))}, not HTTP 200`);
    assert.ok(r.body && typeof r.body === 'object' && r.body.blocks,
      `${what} arrived without a blocks object: ${shown(json(r.body)).slice(0, 200)}`);
    return r.body;
  };

  // --------------------------------------------------------------------------- the two planted rows
  const health = {};
  before(async () => {
    health.heldEventId = `${RUN_TAG}_health_held`;
    health.staleEventId = `${RUN_TAG}_health_stale`;
    healthEvents.push(health.heldEventId, health.staleEventId);

    // A held row minted by the only body that mints held rows. The environment is `synthetic`, not `live`,
    // and that is load-bearing: `:247-251` holds a `live` delivery as `live_capture_disabled` *before* it
    // ever looks up the order, so a `live` plant would describe the policy singleton's current value rather
    // than the reconciliation category this block reports. `synthetic` falls through to the order lookup at
    // `:253`, and a merchant reference this product never issued mints `unknown_order` (`:264-268`) — a
    // branch no ambient configuration can move.
    const held = trusted(`internal_api.record_commerce_event('razorpay'::text, '${health.heldEventId}'::text,
        'payment.captured'::text, 'payment_captured'::text, 'synthetic'::text,
        '${hex64Of('health-held-delivery')}'::text, true, NULL::text,
        '${RUN_TAG}-no-such-order'::text, NULL::bigint, NULL::text, NULL::text, NULL::text,
        NULL::timestamptz, '${uidOf('hostA')}'::uuid)`, 'the recorder-minted held delivery');
    assert.equal(String(held.disposition), 'recorded',
      `the held delivery was not merely recorded: ${json(held)}`);
    assert.equal(String(held.processing_status), 'held_for_reconciliation',
      `the plant did not hold: ${json(held)}`);
    assert.equal(String(held.hold_reason), 'unknown_order',
      `the plant held for a reason other than the category this block reports: ${json(held)}`);
    assert.equal(String(held.state_changed), 'false',
      `a held delivery changed state, which §4.2 rule 3 forbids: ${json(held)}`);
    health.heldRowId = held.event_row_id;

    // One row older than any window the door accepts, so the windowed count has something to exclude. It is
    // written on the trusted channel because `received_at` is a `DEFAULT now()` column the recorder always
    // stamps itself, and the ledger's only other door — UPDATE — is refused for every role including the
    // owner (`commerce_events_append_only_no_update`, foundations:351-353). `stale` is chosen over `applied`
    // because the pairing CHECKs at foundations:321-332 leave a `stale` row with no effect, no hold reason
    // and no order link, so nothing here can move a money count another group reads.
    exec(`insert into private.commerce_payment_events (provider, event_id, event_type, kind, environment,
        merchant_reference, raw_body_sha256, signature_valid, processing_status, occurred_at, received_at)
      values ('cashfree', '${health.staleEventId}', 'chargeback.closed', 'chargeback_opened', 'synthetic',
        '${RUN_TAG}-ord-staleplant', '${hex64Of('health-stale-delivery')}', true, 'stale',
        now() - interval '10 days', now() - interval '10 days')`, 'the back-dated stale ledger row');
    assert.equal(count(`from private.commerce_payment_events e where e.event_id = '${health.staleEventId}'
      and e.received_at < now() - interval '9 days'`, 'the back-dated row'), '1',
      'the stale plant did not arrive ten days old');
  });

  // --------------------------------------------------------------------------- H-01 the body as it arrives
  test('H-01: the delivered JSON keeps every field, type and NULL the projection built', async () => {
    const a = await summary(24, 'H-01');
    const migrationsLive = cell(`select (to_regclass('supabase_migrations.schema_migrations') is not null)::text`,
      'whether the tool\'s migration table is present');

    // The two flags the projection asserts about itself, read as booleans rather than as words: a transport
    // that stringified them would still pass `String(...) === 'false'`, which is why `typeof` is the check.
    assert.equal(typeof a.writes_anything, 'boolean',
      `writes_anything arrived as ${typeof a.writes_anything}`);
    assert.equal(String(a.writes_anything), 'false', 'the summary claimed to write');
    assert.equal(typeof a.identifiers_included, 'boolean',
      `identifiers_included arrived as ${typeof a.identifiers_included}`);
    assert.equal(String(a.identifiers_included), 'false', 'the summary claimed to carry identifiers');

    assert.equal(typeof a.block_count, 'number', `block_count arrived as ${typeof a.block_count}`);
    assert.equal(String(a.block_count), String(BLOCK_NAMES.length),
      `the body carried ${a.block_count} blocks, not ${BLOCK_NAMES.length}`);
    assert.equal(keysOf(a.blocks), BLOCK_NAMES.slice().sort().join(','),
      `the delivered blocks are not the ten the body assembles: ${json(keysOf(a.blocks))}`);

    // One instant, as delivered: every block stamps the same string this call stamped at the top, so no two
    // blocks can be describing two different reads. The SQL tier proves the assignment; this proves the
    // serialiser did not re-render one of them at another precision on the way out.
    const asOf = stamp(a.as_of, 'the top-level as_of');
    for (const name of BLOCK_NAMES) {
      assert.equal(String(at(a.blocks, `${name}.as_of`)), asOf,
        `block ${name} stamped a different instant from the answer: ${at(a.blocks, `${name}.as_of`)}`);
    }

    for (const name of BLOCK_NAMES) {
      const block = at(a.blocks, name);
      const status = String(block?.status);
      assert.ok(status === 'measured' || status === 'not_measured',
        `block ${name} answered status ${json(block?.status)}, outside the two-value vocabulary`);
      const expected = name === 'migrations'
        ? (migrationsLive === 'true' ? BLOCK_KEYS.migrationsMeasured : BLOCK_KEYS.migrationsNotMeasured)
        : (BLOCK_KEYS[name] ?? BLOCK_KEYS.absence);
      assert.equal(keysOf(block), expected,
        `${name}'s delivered field list is not the one its builder writes: got ${json(keysOf(block))}, `
        + `expected ${JSON.stringify(expected)}`);
      for (const [sub, subKeys] of Object.entries(SUB_KEYS)) {
        if (!sub.startsWith(`${name}.`)) continue;
        const path = sub.slice(name.length + 1);
        assert.equal(keysOf(block[path]), subKeys,
          `${sub}'s delivered field list is not the one its builder writes: `
          + `got ${json(keysOf(block[path]))}`);
      }
      if (status === 'measured') {
        assert.ok(name === 'migrations' || 'window_hours' in block,
          `the measured block ${name} arrived without its window stamp`);
      } else {
        assert.ok(String(block.reason).length > 0, `the not_measured block ${name} gave no reason`);
      }
    }

    // The migrations branch, as the live stack actually answers it, and no further: `measured` here is the
    // fact that this database has the tool's table, which the design note's §16 cannot say of a plain
    // PostgreSQL chain, and which is why the expected absence set is derived rather than written out.
    assert.equal(String(at(a.blocks, 'migrations.status')), migrationsLive === 'true'
      ? 'measured' : 'not_measured',
      `the migrations block answered a branch that does not match to_regclass (${migrationsLive})`);

    // Types, driven by the transcription rather than by a list that could rot against it: every count this
    // file claims to know about must arrive as an integer, every `*_at` as an ISO instant or as JSON null,
    // and the tiles marked `text` as a non-empty JSON string — never as the string 'null', never as an
    // absent key. `migrations.highest_version` is `text` because the tool's own column is: measured on this
    // stack, `information_schema.columns` gives `supabase_migrations.schema_migrations.version` the type
    // `text`, so `max(version)` is text and the body's `jsonb_build_object` renders a JSON string. Treating
    // it as a count was this instrument claiming a type the store never had.
    const tiles = readTiles(a);
    let numeric = 0;
    let stamped = 0;
    let nulls = 0;
    let texted = 0;
    for (const t of TILES) {
      if (t.migrationsBranch
        && t.migrationsBranch !== String(at(a.blocks, 'migrations.status'))) continue;
      const value = at(a.blocks, t.path);
      if (t.grouped) {
        assert.equal(typeof value, 'object',
          `${t.path} arrived as ${typeof value}, not as the object a grouped count is`);
      } else if (t.path.endsWith('_at')) {
        if (value === null) nulls += 1; else { stamp(value, t.path); stamped += 1; }
        assert.notEqual(String(value), 'null', `${t.path} arrived as the string 'null'`);
      } else if (t.text) {
        assert.equal(typeof value, 'string',
          `${t.path} arrived as ${typeof value} (${json(value)}), not as the string the store's text column `
          + 'makes it');
        assert.notEqual(value, 'null', `${t.path} arrived as the string 'null'`);
        assert.ok(value.length > 0, `${t.path} arrived as an empty string`);
        texted += 1;
      } else {
        assert.equal(typeof value, 'number',
          `${t.path} arrived as ${typeof value} (${json(value)}), not as the number a count is`);
        assert.ok(Number.isInteger(value) && value >= 0, `${t.path} arrived as ${json(value)}`);
        numeric += 1;
      }
      // The same normalization H-03 already applies: a grouped count is an object on the wire and a
      // `k:n` list in the store read, so comparing them needs `groupedText`. `String(value)` here scored
      // every grouped tile as `[object Object]` against a real list — four cells failing on a rendering
      // the object and the text agree on.
      const asText = t.grouped ? groupedText(value) : String(value);
      assert.equal(asText, tiles[t.path], `the ${t.path} read disagrees with the delivered body`);
    }

    // `blocks_not_measured` recomputed from the delivered blocks, with the expected set derived from the
    // same `to_regclass` the body asked — so this case is true on a chain with or without the tool's table.
    assert.equal(Array.isArray(a.blocks_not_measured), true,
      `blocks_not_measured arrived as ${json(a.blocks_not_measured)}`);
    const derived = BLOCK_NAMES.filter((n) => String(at(a.blocks, `${n}.status`)) === 'not_measured').sort();
    assert.equal(a.blocks_not_measured.slice().sort().join(','), derived.join(','),
      `the answer's own absences are ${json(a.blocks_not_measured)} but its blocks say ${json(derived)}`);
    const expectedAbsences = ['auth_failures', 'rate_limits', 'token_abuse',
      ...(migrationsLive === 'true' ? [] : ['migrations'])].sort().join(',');
    assert.equal(derived.join(','), expectedAbsences,
      `the not_measured set is not the one this stack should carry: ${json(derived)}`);
    for (const name of ['auth_failures', 'rate_limits', 'token_abuse']) {
      assert.equal(String(at(a.blocks, `${name}.reason`)), 'no such store exists in this schema',
        `the ${name} absence changed its sentence`);
    }

    console.log(`  H-01  the body delivered ${BLOCK_NAMES.length} blocks on one instant (${asOf}), `
      + `${numeric} counts arrived as JSON numbers, ${stamped} timestamps as ISO instants and ${nulls} as `
      + `JSON null, ${texted} text-column scalar(s) as JSON strings, `
      + `${Object.keys(tiles).length} tiles agreed with a fresh read of the stores, the `
      + `migrations branch answered '${at(a.blocks, 'migrations.status')}' against to_regclass=`
      + `${migrationsLive} and the derived absences were ${json(derived)}`);
  });

  // --------------------------------------------------------------------------- H-02 the window at the wire
  test('H-02: the window is refused outside 1..720 naming the value that broke it, and the bounds round-trip',
    async () => {
      const refusals = [];
      for (const h of [0, 721, -5]) {
        const r = await rpc('operator_operations_summary', { p_window_hours: h }, { as: 'opOps' });
        const message = String(r.body?.message ?? '');
        assert.equal(r.status, 400, `window ${h} answered ${json(shape(r))}, not HTTP 400`);
        assert.equal(r.body?.code, '23514',
          `window ${h} answered code ${r.body?.code}, not 23514: ${json(shape(r))}`);
        assert.ok(message.includes(SAY.window),
          `window ${h} refused without the bounds sentence: ${shown(message).slice(0, 200)}`);
        // The abnormal value, exactly. A body that reported the bound instead of the argument — or reported
        // a neighbour of it — would leave the operator guessing which number they had typed.
        assert.ok(message.includes(`, not ${h}`),
          `window ${h} refused without naming ${h}: ${shown(message).slice(0, 200)}`);
        refusals.push(h);
      }

      const accepted = [];
      for (const arm of [{ send: 1, want: '1' }, { send: 720, want: '720' }, { send: null, want: '24' }]) {
        const a = await summary(arm.send, `H-02 window ${json(arm.send)}`);
        assert.equal(String(a.window_hours), arm.want,
          `sending ${json(arm.send)} set window_hours to ${json(a.window_hours)}, not ${arm.want}`);
        const span = cell(`select extract(epoch from ('${stamp(a.as_of, 'as_of')}'::timestamptz `
          + `- '${stamp(a.from_inclusive, 'from_inclusive')}'::timestamptz))::text`,
        `the delivered span for ${arm.want}h`);
        // Round-tripping the two delivered strings through the same `make_interval` the body used proves
        // both the arithmetic and that the wire kept the instants to the microsecond the subtraction needs.
        assert.equal(Number(span), Number(arm.want) * 3600,
          `the delivered from_inclusive sits ${span} seconds before as_of, not ${Number(arm.want) * 3600}`);
        for (const name of ['publication', 'credentials', 'delivery', 'commerce', 'audit', 'queue']) {
          assert.equal(String(at(a.blocks, `${name}.window_hours`)), arm.want,
            `block ${name} carried window_hours ${json(at(a.blocks, `${name}.window_hours`))}, `
            + `not ${arm.want}`);
        }
        accepted.push(arm.want);
      }

      console.log(`  H-02  ${refusals.join(', ')} refused at 400/23514 each naming its own value, while `
        + `${accepted.join(', ')} were accepted (a sent null becoming 24) and every delivered as_of minus `
        + 'its own from_inclusive measured exactly the window that was sent');
    });

  // --------------------------------------------------------------------------- H-03 delivered = stored
  test('H-03: every number in the body equals a fresh aggregation of the store it names', async () => {
    const before = census();
    const seen = [];
    for (const h of [1, 24, 720]) {
      const a = await summary(h, `H-03 window ${h}`);
      const tiles = readTiles(a);
      const bad = [];
      for (const t of TILES) {
        if (t.migrationsBranch
          && t.migrationsBranch !== String(at(a.blocks, 'migrations.status'))) continue;
        const got = t.grouped ? groupedText(at(a.blocks, t.path)) : String(at(a.blocks, t.path));
        if (got !== tiles[t.path]) {
          bad.push(`${t.path}: body ${shown(got).slice(0, 60)} vs store ${shown(tiles[t.path]).slice(0, 60)}`);
        }
      }
      assert.deepEqual(bad, [], `at a ${h}h window the body disagreed with the stores in `
        + `${bad.length} of ${Object.keys(tiles).length} tiles:\n    ${bad.join('\n    ')}`);
      seen.push(`${Object.keys(tiles).length} at ${h}h`);
    }
    assert.deepEqual(census(), before,
      `three reads of a STABLE projection moved the census: ${json(census())}`);

    console.log(`  H-03  ${seen.join(', ')} tiles — every delivered count, grouped category and timestamp `
      + 'equalled a fresh aggregation taken at the answer\'s own instant, and the census across the three '
      + 'calls did not move');
  });

  // --------------------------------------------------------------------------- H-04 cluster-wide, no identifiers
  test('H-04: the read spans the cluster on purpose and its body carries no identifier', async () => {
    const a = await summary(24, 'H-04');

    // Cluster-wide by design, measured rather than asserted: the operator holding `operations` owns no
    // wedding at all, and the totals it is served still count the publications of weddings it has no part
    // in. The privacy boundary that makes that safe is the field list, not a filter, and this is the half
    // of the claim that says the list is not also a filter.
    assert.equal(count(`from public.weddings w where w.owner_user_id = '${uidOf('opOps')}'::uuid`,
    'the operator\'s own weddings'), '0',
      'the operations operator owns a wedding, so H-04 no longer proves the read is cluster-wide');
    const published = cell(`select count(distinct p.wedding_id)::text || '|' || count(*)::text
      from public.publications p where p.status = 'active'`, 'the active publications in the cluster');
    const activeWeddings = Number(published.split('|')[0]);
    assert.ok(activeWeddings > 0, `the cluster has no active publication at all (${published})`);
    assert.equal(Number(at(a.blocks, 'publication.weddings_with_active_publication')), activeWeddings,
      `the publication block did not count the whole cluster: body `
      + `${at(a.blocks, 'publication.weddings_with_active_publication')}, store ${published}`);

    // The needles are this run's own identifiers, read out of the stores that hold them, so the sweep hunts
    // for values that exist now rather than for strings this file remembers.
    const needles = [];
    const add = (label, value) => {
      const text = String(value ?? '');
      if (text.length > 0) needles.push({ label, value: text });
    };
    add('sentinel summary', SENTINEL);
    for (const ref of caseRefs) add('case ref', ref);
    for (const ref of requestRefs) add('request ref', ref);
    for (const key of plantedKeys) add('object key', key);
    for (const id of allWeddings) add('wedding id', id);
    for (const f of moneyFixtures) { add('order id', f.orderId); add('refund id', f.refundId); }
    for (const id of healthEvents) add('event id', id);
    for (const p of Object.values(people)) { add('account id', p.userId); add('session token', p.token); }
    const fromStore = (label, query) => {
      for (const line of sqlRows(query)) {
        const bar = line.indexOf('|');
        add(label, bar > 0 ? line.slice(bar + 1) : line);
      }
    };
    fromStore('audit reason', `select 'x|' || reason from private.audit_events
      where reason like '%${RUN_TAG}%' limit 5`);
    fromStore('host summary', `select 'x|' || host_summary from private.support_cases
      where host_summary like '%${RUN_TAG}%' limit 5`);
    fromStore('thread body', `select 'x|' || body from private.support_case_events
      where body is not null and body like '%${RUN_TAG}%' limit 5`);
    fromStore('privacy note', `select 'x|' || coalesce(host_note, operator_note, '')
      from private.privacy_requests
      where coalesce(host_note, operator_note, '') like '%${RUN_TAG}%' limit 5`);
    fromStore('review note', `select 'x|' || note from private.commerce_review_notes
      where note like '%${RUN_TAG}%' limit 5`);
    fromStore('merchant ref', `select 'x|' || merchant_reference from private.commerce_orders
      where merchant_reference like '${RUN_TAG}%' limit 5`);
    fromStore('provider refund ref', `select 'x|' || provider_refund_ref from private.commerce_refunds
      where provider_refund_ref like '${RUN_TAG}%' limit 5`);
    assert.ok(needles.length >= 24,
      `the sweep collected only ${needles.length} needles, so it is measuring a fixture that was never built`);
    const kinds = new Set(needles.map((n) => n.label));
    for (const kind of ['sentinel summary', 'case ref', 'object key', 'wedding id', 'account id',
      'session token', 'order id', 'refund id', 'merchant ref']) {
      assert.ok(kinds.has(kind), `the sweep never looked for a ${kind}, so it cannot report its absence`);
    }

    const body = JSON.stringify(a);
    const leaked = needles.filter((n) => body.includes(n.value)).map((n) => n.label);
    assert.deepEqual(leaked, [], `the delivered body carried ${leaked.length} identifier(s): `
      + `${json(leaked)} — no id, ref, key, token or note text may cross this projection`);

    // The control that makes the paragraph above a measurement: the same needles, through the same
    // `includes`, against a document that is entitled to carry them. The operator's own case queue is that
    // document — C-02 proved hostA's sentinel reaches it — so the scan is shown to be able to find what it
    // is looking for before its silence is read as safety.
    // `opSupport`, because `support` is the scope this door is granted to (`operator_case_queue` in the
    // DOORS table above, and C-02 read it with the same holder). Asking an `operations` account was the
    // instrument contradicting the design, not the design failing: it answered 42501.
    // 100 is this door's own ceiling — `operator_case_queue` refuses anything outside 1..100 at
    // `20261020190100_stage11_support_cases.sql:908-912`, and C-02 walks that refusal at the wire — so
    // asking for 100 is asking for the whole queue. Asking for 200 asked for more rows than the rule lets
    // exist and was answered 400/23514: the product enforcing a limit that A-04 and C-02 both obey at the
    // same door. Whether 100 really is the whole queue here is measured below, not assumed.
    const caseRowsLive = count('from private.support_cases', 'the case rows in flight at the control read');
    const queue = await rpc('operator_case_queue',
      { p_status: null, p_category: null, p_limit: 100 }, { as: 'opSupport' });
    assert.equal(queue.status, 200, `the control read failed: ${json(shape(queue))}`);
    assert.ok(Number(caseRowsLive) <= 100,
      `the store holds ${caseRowsLive} case rows, above this door's 100-row ceiling, so the control `
      + 'document is a slice of the queue and not the queue');
    assert.equal(String(queue.body?.cases?.length), caseRowsLive,
      `the control queue delivered ${json(queue.body?.cases?.length)} of ${caseRowsLive} case rows, so `
      + 'a needle could be absent from it simply by not being in the slice');
    const control = JSON.stringify(queue.body);
    const found = needles.filter((n) => control.includes(n.value)).map((n) => n.label);
    assert.ok(found.includes('sentinel summary'),
      'the operator queue no longer carries the sentinel summary, so the control proves nothing');
    assert.ok(found.length >= 2,
      `the control document surfaced only ${json(found)}; a scan that hits one needle proves one thing`);

    // And the body is not empty prose either: the one string the projection is allowed to carry is the
    // reconciliation category `record_commerce_event` minted in `before()`, delivered verbatim.
    const held = at(a.blocks, 'commerce.held_by_reason');
    assert.ok(Object.keys(held ?? {}).includes('unknown_order'),
      `the held categories are ${json(held)}; the planted row's own category did not reach the body`);

    console.log(`  H-04  ${needles.length} live identifiers across ${kinds.size} kinds were planted this run `
      + `and none appears in the ${body.length}-byte body; the same scan found ${found.length} of them `
      + `(the sentinel summary among them) in the operator queue, which was read at the door's own ${queue.body.limit} `
      + `ceiling and delivered all ${caseRowsLive} case rows in flight — so its silence is a slice of nothing; `
      + `held_by_reason still delivered the minted categories ${json(Object.keys(held))} and the read `
      + `counted ${activeWeddings} weddings' publications for an operator that owns no wedding`);
  });

  // --------------------------------------------------------------------------- H-05 the window moves a number
  test('H-05: the window excludes the row it should and nothing else in the body moves', async () => {
    const one = await summary(1, 'H-05 1h');
    const seven = await summary(720, 'H-05 720h');
    const fromOne = stamp(one.from_inclusive, 'the 1h from_inclusive');
    const fromSeven = stamp(seven.from_inclusive, 'the 720h from_inclusive');

    // The planted row, read from the store, sits outside the short window and inside the long one. Without
    // this the comparison below would be two numbers that happen to match.
    assert.equal(count(`from private.commerce_payment_events e where e.event_id = '${health.staleEventId}'
      and e.received_at >= '${fromOne}'::timestamptz`, 'the stale row inside 1h'), '0',
      'the back-dated row fell inside the one-hour window, so the window has nothing to exclude');
    assert.equal(count(`from private.commerce_payment_events e where e.event_id = '${health.staleEventId}'
      and e.received_at >= '${fromSeven}'::timestamptz`, 'the stale row inside 720h'), '1',
      'the back-dated row fell outside even the thirty-day window');
    const between = count(`from private.commerce_payment_events e
      where e.received_at >= '${fromSeven}'::timestamptz and e.received_at < '${fromOne}'::timestamptz`,
    'the rows the long window counts and the short one does not');
    assert.equal(Number(at(seven.blocks, 'commerce.events_in_window'))
      - Number(at(one.blocks, 'commerce.events_in_window')), Number(between),
      `the delivered difference is not the store's: `
      + `${at(seven.blocks, 'commerce.events_in_window')} - ${at(one.blocks, 'commerce.events_in_window')} `
      + `vs ${between} row(s) between the two instants`);

    const l1 = leaf(one.blocks);
    const l7 = leaf(seven.blocks);
    assert.equal(keysOf(l1), keysOf(l7), 'the two windows delivered different field lists');
    const stripped = Object.keys(l1).filter((p) => !/(^|\.)(as_of|window_hours)$/.test(p));
    const differing = stripped.filter((p) => JSON.stringify(l1[p]) !== JSON.stringify(l7[p]));
    const strays = differing.filter((p) => !WINDOW_GATED.includes(p));
    assert.deepEqual(strays, [],
      `changing only the window moved ${strays.length} field(s) the body does not gate on v_from: `
      + `${json(strays)}`);
    assert.ok(differing.includes('commerce.events_in_window'),
      `the window moved nothing at all: ${json(differing)}`);

    console.log(`  H-05  1h vs 720h over ${stripped.length} non-stamp leaves moved `
      + `${differing.length === 1 ? 'one field' : `${differing.length} fields`} (${json(differing)}), all of `
      + `them gated on the window, and the delivered `
      + `${at(one.blocks, 'commerce.events_in_window')} vs `
      + `${at(seven.blocks, 'commerce.events_in_window')} difference equals the ${between} row(s) lying `
      + 'between the two instants, including the planted ten-day-old stale delivery');
  });
});


