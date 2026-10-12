// Stage 8 §S8-5 — guest household links, the household door and the household answer, qualified over
// the transport the product uses.
//
// `supabase/tests/stage8/80_guest_invitation_links.sql` and `90_guest_rsvp.sql` prove the workflow with
// `SET ROLE` inside psql, on a cluster built from zero, and they do the deeper half: the kind-shape arm
// of `access_tokens_kind_shape` refusing a household credential that points into an approval version,
// the digest arithmetic, the one-live-per-household index firing as a `unique_violation` rather than as
// a second secret, and the refusal *order* inside each body measured one statement at a time. What those
// two files cannot see is the transport. They never had Kong deciding that a custom header survives to
// `request.headers`, never had PostgREST resolving a call by signature before any grant is consulted,
// never had the answer to "what does an HTTP caller actually receive from `raise_exception`", and never
// had a stranger's JWT aimed at a household that belongs to somebody else.
//
// So this file is the transport. Its expectations come from three different kinds of evidence, and the
// difference between them is stated here rather than left to be inferred later:
//
//   (1) MEASURED, and re-read from the bytes that carry them — the refusal sentences, the returned key
//       sets and the ordering rules are transcribed from
//       `supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql` at the lines quoted in
//       `SAY` and beside each shape constant below. A sentence this file expects is a sentence the
//       migration raises, with its line number in the comment.
//   (2) MEASURED, by this repository's own suites, at a head where they passed — every HTTP *number*
//       used below (401/42501 for a grant-less caller, 403/42501 for an ownership refusal raised in the
//       body, 400/23514 for a `check_violation`, 404/PGRST202 for a profileless or mis-signatured call,
//       406/PGRST106 for `internal_api`, 200 with one indistinguishable JSON object for a bad credential
//       at an anonymous door, 400/PGRST100 whose message contains a credential put in a query string,
//       and the case-folding of a custom header name) was taken from `stage3_publication.test.mjs` §6.6
//       and from `stage7_family_approval.test.mjs` T-01…T-05, G-01…G-03, D-03…D-07 — files that ran green
//       against this project's own stack. Those numbers are properties of the router, not of the verb,
//       so reusing them is evidence rather than analogy.
//   (3) PREDICTED, and labelled at the case that relies on it — six of them:
//         * `Content-Profile: api` reaches the six Stage 8 wrappers (T-01).
//         * the two doors are reachable with `apikey` and no `Authorization` (T-04), because §8 grants
//           `api.resolve_guest_invitation()` and `api.submit_guest_rsvp(jsonb)` to `anon`
//           (`…sql:1207`, `:1211`). Read from the migration rather than from a live `pg_proc`, which is
//           the weakness S-01 exists to close.
//         * Kong forwards `x-guest-token` the way it forwards `x-review-token` and
//           `x-invitation-token` (T-05); both of those are measured.
//         * the HTTP status for the two rotate refusals raised with `ERRCODE = 'raise_exception'`
//           (`…sql:425`, `:443`). SQLSTATE `P0001` has NO precedent measurement anywhere in this
//           repository, so L-04, L-05 and L-06 assert the code and the sentence and deliberately assert
//           only that the status is not 200. The first run at this head must record the number; until
//           then this file does not claim to know it.
//         * the HTTP status for a policy WITH CHECK refusal on a *table PATCH* (R-02). The code and the
//           sentence are measured for an INSERT (`stage3_security.test.mjs:727-734`), and DELETE and
//           SELECT refusals are measured elsewhere in this repository, but no earlier suite PATCHed a
//           PostgREST table through an RLS policy that denies the new row, so R-02 asserts 42501 and the
//           sentence and only that the status is at least 400, then prints what it was.
//         * PostgREST resolving an RPC whose *defaulted* parameter is absent from the request JSON
//           (H-02). Both `issue_guest_invitations` and `publish_invitation_version` declare
//           `p_expires_at timestamptz DEFAULT NULL`, and every earlier call in this repository states the
//           argument (`stage3_publication.test.mjs:593-595`, `:822-824`), so the short spelling — the one
//           the host screen will send when the host asks for links with no deadline — had never crossed
//           the transport. H-02 measures it against the explicit null on two already-live households, so
//           neither call mints and the two answers are comparable bytes.
//
// WHAT THIS FILE HAS NOT DONE. It was authored on a machine that could not run it. Re-measured on 2026-10-10
// at head `07e1907`: `df -k /c` reports 7,028,056 KiB free — it has fallen from 8,193,060 KiB to 7,191,316 to
// this across the authoring of these groups, roughly 0.15 GB an hour, by processes outside this repository —
// and `docker version` answers exit 1: the shared engine is down, and starting it is a human action, not one
// this suite may take. Either reading alone blocks the HTTP tier, so every case below is *authored*, and the
// only verification it has had is `node --check`. No tier, suite or gate described here may be called green
// until `bash supabase/tests/api/run.sh` has actually executed this file against `localvivaahvarnam`, and
// that run either confirms these expectations or, as Stage 7's first run did, corrects them.
//
// The nine groups are TRANSPORT, CALLER MATRIX, SURFACE AND PRIVILEGES, ISSUE, LINK LIFE, THE DOOR, THE
// HOUSEHOLD ANSWER, PUBLICATION COUPLING and RESIDUE, in that order, because the last two consume the
// publication and the live links that the earlier ones assert on. `supabase/tests/api/run.sh` already carries
// this stage's census widening (`guest_invitation_tokens=`) and discovers suites by glob, so no runner change
// is outstanding: the file runs the moment the engine is up.
//
// Not part of `npm test`; run it with `bash supabase/tests/api/run.sh`, which refuses a stack that is not
// this repository's own, requires the migration ledger to match `supabase/migrations`, runs each suite
// serially against the shared database, and fails the run if a row count moves. Its own `after()` gives
// everything back in the order the foreign keys demand — replies, then scopes, then credentials, then the
// households those credentials freeze in place — and prints the census. That order is
// `docs/architecture/guest-rsvp-security.md` §12's, and it is the reason this file can delete a household
// at all: an unrevoked credential holds its household row against a delete by `NO ACTION`
// (`20260925120400...:169`), so credentials always go first.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

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
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}

const RUN_TAG = process.env.STAGE8_HTTP_RUN_TAG
  ?? `s8http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// Interpolated into trusted cleanup statements and into SQL reads, so an inherited value is accepted
// only in the shape this file generates.
if (!/^[a-z0-9_-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE8_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
}

/** A minted household credential: 32 random bytes, base64url, no padding. Same generator as the wedding
 *  link and the review link (`…sql:273`, `:453`), so the same 43 characters. */
const CRED = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Well-formed, and belonging to nothing in this database. The household verbs answer a stranger's real
 *  id and this invented id with the same bytes, which is the only way to prove there is no oracle over
 *  which households exist. */
const NOT_A_HOUSEHOLD = '33333333-3333-4333-8333-333333333333';
const NOT_A_WEDDING = '00000000-0000-4000-8000-000000000000';
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;

/** Anything this file prints or puts in an assertion message goes through here first. The rule is the one
 *  the runners use: mask the capture, never relax the check. A household link is a permanent address for
 *  a named family, so an un-masked failure line would put a guest's invitation into a run log that lives
 *  outside the repository. */
const shown = (value) => String(value).replace(/[A-Za-z0-9_-]{43}/g, '[REDACTED-43]');

// ---------------------------------------------------------------------------
// The expected shapes, each one read out of the migration at the quoted line.
// ---------------------------------------------------------------------------
// `issue_guest_invitations` returns six keys (`…sql:298-304`) and four per item (`:254-257`, `:290-293`).
const SEND_KEYS = ['already_live', 'expires_at', 'invitations', 'issued', 'publication_id', 'wedding_id'];
const SEND_ITEM_KEYS = ['display_name', 'household_id', 'path', 'status'];
// `revoke_guest_invitation` returns four (`:352-356`); `rotate_guest_invitation` five (`:466-472`).
const REVOKE_KEYS = ['credentials_revoked', 'household_id', 'revoked', 'revoked_at'];
const ROTATE_KEYS = ['expires_at', 'household_id', 'path', 'previous_revoked_at', 'publication_id'];
// The host panel: `row_to_json` over the ten columns of §3.4's subselect (`:505-522`).
const PANEL_KEYS = ['attending_count', 'display_name', 'expected_party_size', 'household_id',
  'link_expires_at', 'link_last_used_at', 'link_state', 'reply_count', 'salutation',
  'scoped_event_count'];
// The door: three keys (`:684-697`), eight in `guest`, eight per event card (`:650-659`).
const DOOR_KEYS = ['available', 'guest', 'invitation'];
const GUEST_KEYS = ['can_respond', 'display_name', 'events', 'expected_party_size', 'greeting',
  'household_id', 'responds_until', 'version_number'];
const EVENT_KEYS = ['attending', 'display_name', 'ends_at_local', 'event_id', 'party_size',
  'responded_at', 'starts_at_local', 'timezone'];
// The answer: four keys on success (`:930-935`) and two on refusal (`:727-729`).
const ANSWER_KEYS = ['events_recorded', 'household_id', 'recorded', 'responded_at'];
// `private.public_invitation_dto` is Stage 3's projection, unchanged by §4 (`:688`), so the twelve keys
// are the list `stage7_family_approval.test.mjs` measured out of a live response.
const INVITATION_KEYS = ['closing', 'design_template', 'event_notes', 'events', 'family_introduction',
  'language', 'people', 'sections', 'style', 'title', 'tradition_pack', 'welcome'];
// §6 re-declared the two publication verbs without changing what a caller sees. `publish_invitation_version`
// already took `p_expires_at` and already returned these five keys, with `expires_at` being the argument
// (`20260926150000_stage3_privileged_bodies_behind_wrappers.sql:566-575`, body return at `:288-297`), so what
// Stage 8 adds is a write no response field describes (`…sql:1041-1048`) — which is exactly why N-01 reads the
// credential store rather than trusting the answer. `revoke_invitation_publication` keeps its three keys and
// one of their values (`:1102-1106`). Stage 3's wedding-link rotator is untouched by this stage and still
// returns five (`20260926150000_stage3_privileged_bodies_behind_wrappers.sql:412-418`) — the last being the
// case N-03 runs, because a verb that retargets the wedding link must not reach a household's secret.
const PUBLISH_KEYS = ['expires_at', 'link_reused', 'path', 'publication_id', 'version_id'];
const ROTATE_WEDDING_KEYS = ['expires_at', 'path', 'previous_revoked_at', 'publication_id', 'version_id'];
const TAKEDOWN_KEYS = ['publication_id', 'revoked', 'tokens_revoked'];
const UNAVAILABLE = { available: false };
const NOT_RECORDED = { recorded: false, reason: 'unavailable' };
const TOO_LARGE = { recorded: false, reason: 'party_size_too_large' };
const NOT_ASKED = { recorded: false, reason: 'answers_not_accepted' };

/** The bytes a `jsonb` refusal object reaches the client as, read from the database's own renderer.
 *  PostgREST returns a `jsonb` scalar in `jsonb_out`'s spelling — a space after every colon, and keys in
 *  jsonb's own order (shorter key first, then collation) — which is not what `JSON.stringify` of the same
 *  object produces. Measured on this stack 2026-10-12: an unknown-but-well-formed household credential
 *  answered `{"reason": "unavailable", "recorded": false}` at the write door and `{"available": false}` at
 *  the read door, byte-identical to the two `::text` renders below. So a byte claim about a refusal body
 *  is a claim about *this verb's body and nothing else in it*, which is what the parsed `deepEqual` at each
 *  call site cannot say; comparing it to a client-side serialisation would have been a claim about two
 *  different serializers, and it fails on every stack rather than on a defect. */
const wireUnavailable = () => cell(
  `select jsonb_build_object('available', false)::text`, 'the read door\'s declared refusal bytes');
const wireNotRecorded = () => cell(`select jsonb_build_object('recorded', false, 'reason', 'unavailable')::text`,
  'the write door\'s declared refusal bytes');

/** Every sentence the Stage 8 bodies raise, with the line that raises it. Transcribed from the migration
 *  rather than from a probe log, because no probe log exists for this head yet — which is exactly the
 *  weakness the first run is here to test. */
const SAY = {
  notSend: 'the caller may not send invitations for this wedding',                 // :178
  emptyList: 'choose the households you are inviting',                             // :183
  tooManyHouseholds: 'two hundred households is the most one request may carry',   // :190
  listNotMine: 'a household in this list is not a household of this wedding',      // :205
  pastExpiry: 'a household link must be given a time in the future',               // :210
  unpublished: 'publish the invitation before sending household links',            // :224
  nameWithdraw: 'name the household whose link you are withdrawing',               // :328
  notWithdraw: 'the caller may not withdraw this household\'s link',               // :342
  nameRotate: 'name the household whose link you are replacing',                   // :390
  notRotate: 'the caller may not rotate this household\'s link',                   // :402
  noPublication: 'there is no published invitation to rotate',                     // :411
  noLiveLink: 'this household has no live link to rotate',                         // :425
  alreadyExpired: 'this household\'s link has already expired; withdraw it and send a new one', // :443
  notReadPanel: 'the caller may not read this wedding',                            // :495
  badShape: 'the answers submitted are not in the shape this invitation records',  // :730, raised at :751 and eleven more sites
  tooManyAnswers: 'too many answers in one submission',                            // :768
  answeredTwice: 'the same event was answered twice',                              // :832
};

function sqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query],
  { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

/** A one-row read. Values here are database facts, so a census that cannot be read fails with its own
 *  name rather than carrying on with `undefined`. */
function sqlCell(query, what) {
  const rows = sqlRows(query);
  assert.equal(rows.length, 1, `${what} did not read exactly one row: ${shown(JSON.stringify(rows))}`);
  return rows[0];
}

const cell = (query, what) => sqlCell(query, what);

const people = {};
const tokenOf = (who) => people[who].token;
const uidOf = (who) => people[who].userId;
const weddingOf = (who) => people[who].weddingId;
const versionOf = (who) => people[who].versionId;
const eventOf = (who, key) => people[who].eventIds[key];
const WHO = ['hostA', 'hostB'];

/** `slug -> uuid` for the eight households of host A's published wedding, host B's one household and
 *  the one household of the wedding that is never published. Named lookups rather than positional reads
 *  of a panel, because the panel is ordered by display name and the fixtures are not written in it. */
const HH = {};
/** `slug -> raw credential`, for every link this run mints through the product verb. */
const credentials = {};
/** Every credential this run mints, for the census cases that have to see all of them. */
const issued = [];
/** Every secret this run was *handed*, in either of the two address forms. `credFromPath` and
 *  `credFromPublicPath` are the only places a minted secret enters this file, so the set they fill is a
 *  complete inventory of what this run may account for — which is what makes `Z-01` a claim about the
 *  store rather than a restatement of the `token_hash UNIQUE` constraint. It holds digests' originals,
 *  never the digests, and nothing is ever added to it from a database read. */
const heldSecrets = new Set();

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  const { data: fresh } = await c.auth.getSession();
  return { client: c, userId: data.user.id, token: fresh.session.access_token };
}

async function call(method, path, { body, bearer = anonKey, headers = {} } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: anonKey, Authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text === '' ? null : JSON.parse(text); } catch { parsed = { unparsed: text.slice(0, 300) }; }
  // `text` is kept beside `body` so a case can claim two refusals are byte-identical rather than merely
  // equal after parsing — the claim Stage 7 measured at the review door, and the reason an unauthenticated
  // probe cannot learn which kind of failure it hit.
  return { status: res.status, text, body: parsed };
}

/** An RPC the way the product's client sends one: `api` profile, POST, JSON. `profile: null` drops the
 *  header, which is the case `T-01` measures rather than the case any test should accidentally be. */
async function rpc(name, args, { as = 'anon', headers = {}, profile = 'api' } = {}) {
  const bearer = as === 'anon' ? anonKey : as === 'service' ? serviceKey : tokenOf(as);
  const all = { ...headers };
  if (profile) all['Content-Profile'] = profile;
  return call('POST', `/rest/v1/rpc/${name}`, { body: args, bearer, headers: all });
}

const hh = (slug) => {
  assert.ok(HH[slug], `refusing to run: no fixture household named ${slug}`);
  return HH[slug];
};

/** The household link, for a household this run minted one for. */
const credOf = (slug) => {
  assert.ok(credentials[slug], `refusing to run: ${slug} has no credential this file minted`);
  return credentials[slug];
};

const gopen = (credential, opts = {}) => rpc('resolve_guest_invitation', {}, {
  ...opts, headers: credential === undefined ? opts.headers ?? {}
    : { 'x-guest-token': credential, ...opts.headers ?? {} } });

const grsvp = (credential, answers, opts = {}) => rpc('submit_guest_rsvp', { p_answers: answers }, {
  headers: { 'x-guest-token': credential, ...opts.headers ?? {} }, ...opts });

/** The household address is `/g/` plus the credential — three characters of prefix, spelled at
 *  `…sql:292`. Asserted as a shape rather than split blindly, so a route change fails here instead of
 *  silently shortening every secret. */
const credFromPath = (path) => {
  assert.match(path, /^\/g\/[A-Za-z0-9_-]{43}$/,
    `the minted path is not the measured shape: ${shown(path)}`);
  const raw = path.slice('/g/'.length);
  heldSecrets.add(raw);
  return raw;
};
/** The wedding's own `/i/` form, spelled beside it so a prefix change at either door fails here. */
const credFromPublicPath = (path) => {
  assert.match(path, /^\/i\/[A-Za-z0-9_-]{43}$/,
    `the wedding path is not the measured shape: ${shown(path)}`);
  const raw = path.slice('/i/'.length);
  heldSecrets.add(raw);
  return raw;
};

/** One host sending links to some of its own households. Every household credential this file makes goes
 *  through here, so `Z-01` counts links the product issued rather than links a fixture wrote with a
 *  trusted role. */
async function sendLinks(who, slugs, { expiresAt, expectStatus = 200 } = {}) {
  // The third argument is always stated, null included. Whether PostgREST resolves an RPC whose
  // *defaulted* parameter is omitted has no precedent measurement in this repository — Stage 3's own
  // publish calls spell the default out (`stage3_publication.test.mjs:593-595`, `:822-824`) — so every
  // send here uses the one spelling this file knows reaches the verb, and H-02 is the single case that
  // measures the other.
  const args = {
    p_wedding_id: weddingOf(who), p_household_ids: slugs.map(hh), p_expires_at: expiresAt ?? null,
  };
  const res = await rpc('issue_guest_invitations', args, { as: who });
  assert.equal(res.status, expectStatus,
    `issue for [${slugs}] answered ${res.status}: ${shown(JSON.stringify(res.body))}`);
  if (res.status !== 200) return res;
  for (const item of res.body.invitations) {
    if (item.status !== 'issued') continue;
    const cred = credFromPath(item.path);
    const slug = slugs.find((s) => hh(s) === item.household_id);
    assert.ok(slug, `a credential was minted for ${item.household_id}, which is not a fixture`);
    credentials[slug] = cred;
    issued.push({ slug, householdId: item.household_id, token: cred, as: who });
  }
  return res;
}

/** The token rows for one household as one comparable string. Every clause is a fact that §1's kind-shape
 *  arm or the one-live index is supposed to guarantee, so a single read scores the whole contract instead
 *  of trusting the migration paragraph that describes it. */
const tokenFacts = (householdId) => cell(`
  select 'total=' || count(*)::text
    || ' live=' || coalesce(sum(case when revoked_at is null then 1 else 0 end), 0)::text
    || ' kind=' || coalesce(string_agg(distinct token_kind, '+'), '-')
    || ' guestid=' || coalesce(sum(case when token_kind = 'guest_invitation'
              and household_id is not null and publication_id is not null
              and approval_request_id is null and approval_version_id is null
            then 1 else 0 end), 0)::text
    || ' nullver=' || coalesce(sum(case when approval_version_id is null then 1 else 0 end), 0)::text
  from private.access_tokens where household_id = '${householdId}'::uuid`,
  `the credential facts for ${householdId}`);

/** One column of every credential row of one household, oldest first. */
const tokenCell = (householdId, columns) => cell(`
  select coalesce(string_agg(${columns}, ';' order by created_at), '-')
    from private.access_tokens
   where household_id = '${householdId}'::uuid and token_kind = 'guest_invitation'`,
  `the ${columns} of ${householdId}'s credentials`);

/** The census helpers live at module scope because two suites read the same store: §6's coupling cases and
 *  `Z-03`, whose claim is that host A's publication work left host B's credential rows exactly where they
 *  were. (`Z-03` first ran against a `storeFacts` that was defined inside the other suite's `describe`,
 *  and a `ReferenceError` is not a measurement.) */
const kindGuarded = (kind) => {
  assert.ok(['guest_invitation', 'public_invitation'].includes(kind),
    `refusing to interpolate ${shown(kind)} into a credential census`);
  return kind;
};

/** Every credential row of one kind that one wedding owns, as one comparable string. Compared before and
 *  after each verb: the claim is about not moving, so the arithmetic is the run's own. */
const storeFacts = (kind, wedding = weddingOf('hostA')) => cell(`
    select 'total=' || count(*)::text
      || ' live=' || coalesce(sum(case when revoked_at is null then 1 else 0 end), 0)::text
      from private.access_tokens
     where wedding_id = '${wedding}'::uuid and token_kind = '${kindGuarded(kind)}'`,
  `the ${kind} credential store`);

/** A checksum over the digests of those rows, so "no secret changed" is one comparison instead of a
 *  dump of hashes. Ordered by the digest itself, which makes the string independent of insertion order.
 *  Nothing raw reaches SQL here: the column is already a hex digest, and its md5 is what is printed. */
const storeDigest = (kind, wedding = weddingOf('hostA')) => cell(`
    select md5(coalesce(string_agg(token_hash, ';' order by token_hash), '-'))
      from private.access_tokens
     where wedding_id = '${wedding}'::uuid and token_kind = '${kindGuarded(kind)}'`,
  `the ${kind} digest checksum`);

/** The "has this family read the invitation" stamp, for the one row `one_live_guest_token_per_household`
 *  (`…sql:103-107`) guarantees is live. `tokenCell` cannot be used for this: it aggregates the household's
 *  whole history, so a rotated household answers `'-;2027-…'` and a `'-` comparison fails for a reason
 *  that has nothing to do with the claim under test. */
const liveStamp = (slug) => cell(`select coalesce(last_used_at::text,'-')
    from private.access_tokens where household_id = '${hh(slug)}'::uuid
      and token_kind = 'guest_invitation' and revoked_at is null`, `${slug}'s live stamp`);

const panelRow = async (who, householdId) => {
  const res = await rpc('get_guest_invitation_state', { p_wedding_id: weddingOf(who) }, { as: who });
  assert.equal(res.status, 200, `the panel could not be read: ${shown(JSON.stringify(res.body))}`);
  const row = res.body.find((r) => r.household_id === householdId);
  assert.ok(row, `the panel has no row for ${householdId}`);
  return row;
};

/** The panel for a wedding that is not the one `people[who].weddingId` names — which is what makes the
 *  host's *other* aggregate readable, so `H-06` can say a panel is scoped per wedding rather than per
 *  owner, and `L-01` can read the published one through the same door. Same refusal path, same shape. */
const panelFor = async (who, weddingId) => {
  const res = await rpc('get_guest_invitation_state', { p_wedding_id: weddingId }, { as: who });
  assert.equal(res.status, 200, `the panel for ${weddingId} could not be read: `
    + `${shown(JSON.stringify(res.body))}`);
  return res.body;
};

const replyCount = (householdId) => cell(`select count(*)::text from public.rsvp_responses
    where household_id = '${householdId}'::uuid`, 'the reply count');

/** Refuse a body a browser could never produce, or accept one it could. `jsonb`'s text rendering pads an
 *  object with one space per key, so the octet count of `{a: 'x'.repeat(n)}` is n+9; the two values this
 *  is used with are 100 octets clear of the bound on either side, because the exact edge is the SQL
 *  battery's case and the rendering is not measured at this head. */
const answersOfOctets = (n) => ({ a: 'x'.repeat(Math.max(0, n - 9)) });

// ---------------------------------------------------------------------------
// The substrate: which columns this file writes through a browser role. Stage 2's tables are not new at
// this head, so a missing column here is a deployed-schema fact rather than a prediction, and pinning
// presence rather than a full ordered list avoids quoting a column order nobody has measured.
// ---------------------------------------------------------------------------
const REQUIRED_COLUMNS = [
  ['public', 'guest_households', ['id', 'wedding_id', 'display_name', 'salutation',
    'expected_party_size', 'host_notes']],
  ['public', 'household_event_scopes', ['wedding_id', 'household_id', 'event_id']],
  ['public', 'rsvp_responses', ['wedding_id', 'household_id', 'event_id', 'attending', 'party_size',
    'response_source', 'responded_at', 'answers']],
  ['public', 'wedding_events', ['id', 'wedding_id', 'event_key', 'display_name', 'starts_at_local',
    'ends_at_local', 'timezone', 'display_order', 'enabled']],
];

let BASELINE = null;
const censusQuery = `select 'weddings='||count(*) from public.weddings
  union all select 'wedding_events='||count(*) from public.wedding_events
  union all select 'invitation_drafts='||count(*) from public.invitation_drafts
  union all select 'invitation_versions='||count(*) from public.invitation_versions
  union all select 'publications='||count(*) from public.publications
  union all select 'guest_households='||count(*) from public.guest_households
  union all select 'household_event_scopes='||count(*) from public.household_event_scopes
  union all select 'rsvp_responses='||count(*) from public.rsvp_responses
  union all select 'approval_requests='||count(*) from public.approval_requests
  union all select 'access_tokens='||count(*) from private.access_tokens
  union all select 'audit_events='||count(*) from private.audit_events
  union all select 'auth.users='||count(*) from auth.users`;
const census = () => Object.fromEntries(sqlRows(censusQuery).map((r) => r.split('=')));

async function insertHousehold(who, weddingId, body) {
  const res = await call('POST', '/rest/v1/guest_households', {
    bearer: tokenOf(who),
    body: { ...body, wedding_id: weddingId },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(res.status, 201, `a household could not be created: ${shown(JSON.stringify(res.body))}`);
  return res.body[0];
}

async function insertScope(who, weddingId, householdId, eventId) {
  const res = await call('POST', '/rest/v1/household_event_scopes', {
    bearer: tokenOf(who),
    body: { wedding_id: weddingId, household_id: householdId, event_id: eventId },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(res.status, 201, `a scope row could not be created: ${shown(JSON.stringify(res.body))}`);
  return res.body[0];
}

before(async () => {
  BASELINE = census();

  // The surface first, from the catalog rather than from this file's constants. A stack one migration
  // behind has none of these names, and every case below would then be about functions that are not
  // there — reported as 404s that would read exactly like the refusals this file asserts.
  const names = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'api'
                            and p.proname in ('issue_guest_invitations','revoke_guest_invitation',
                                              'rotate_guest_invitation','get_guest_invitation_state',
                                              'resolve_guest_invitation','submit_guest_rsvp') order by 1`);
  assert.deepEqual(names, ['get_guest_invitation_state', 'issue_guest_invitations',
    'resolve_guest_invitation', 'revoke_guest_invitation', 'rotate_guest_invitation',
    'submit_guest_rsvp'],
    'refusing to run: the api schema does not expose all six Stage 8 doors');

  const zeroArg = cell(`select (pg_get_function_arguments(p.oid) = '')::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api' and p.proname = 'resolve_guest_invitation'`, 'the door signature');
  assert.equal(zeroArg, 'true',
    'refusing to run: resolve_guest_invitation takes an argument, so a household credential could be '
    + 'addressed in a query string and the T-03 case below measures a different product');

  for (const [schema, table, wanted] of REQUIRED_COLUMNS) {
    const have = cell(`select coalesce(string_agg(column_name, ','), '<none>')
        from information_schema.columns
       where table_schema = '${schema}' and table_name = '${table}'`, `${schema}.${table} columns`);
    for (const column of wanted) {
      assert.ok(have.split(',').includes(column),
        `refusing to run: ${schema}.${table} is ${shown(have)} and has no ${column} column`);
    }
  }

  assert.equal(cell(`select count(*)::text from pg_indexes where schemaname = 'private'
      and tablename = 'access_tokens' and indexname = 'one_live_guest_token_per_household'`,
    'the one-live-household index'), '1',
    'refusing to run: one_live_guest_token_per_household is not deployed, so H-03 and L-07 would be '
    + 'measuring a guarantee no index provides');

  assert.equal(cell(`select count(*)::text from pg_constraint
      where conname = 'access_tokens_kind_shape'
        and conrelid = 'private.access_tokens'::regclass`, 'the kind-shape constraint'), '1',
    'refusing to run: access_tokens_kind_shape is absent, so the household arm §1 tightened has no '
    + 'constraint to be about');

  assert.equal(cell(`select count(*)::text from pg_constraint
      where conname = 'rsvp_responses_answers_check'
        and conrelid = 'public.rsvp_responses'::regclass`, 'the answers bound'), '1',
    'refusing to run: rsvp_responses_answers_check is absent, so S-04 would be measuring Stage 2\'s '
    + 'unbounded slot rather than Stage 8\'s bounded one');

  const tokenColumns = cell(`select string_agg(column_name, ',' order by ordinal_position)
      from information_schema.columns where table_schema = 'private'
        and table_name = 'access_tokens'`, 'access_tokens columns');
  assert.equal(tokenColumns,
    'id,token_hash,token_kind,wedding_id,publication_id,household_id,approval_request_id,'
    + 'approval_version_id,expiry_policy,expires_at,revoked_at,last_used_at,created_by_role,created_at',
    `refusing to run: private.access_tokens has the shape ${shown(tokenColumns)}, which is not the `
    + 'hash-only store Stage 7 measured and this file censuses');

  for (const who of WHO) people[who] = await signUp(who);

  // Weddings, drafts, events, one frozen version and one publication each — through the product's own
  // path: the publishable key, the owner's JWT, no privilege. `issue_guest_invitations` refuses without
  // an active publication (`…sql:216-225`), so a host that cannot publish here would make every case
  // below about a fixture rather than about a link.
  const HOST_EVENTS = {
    hostA: [
      { event_key: 'muhurtham', display_name: 'Muhurtham', starts_at_local: '2027-03-14T09:30:00',
        ends_at_local: '2027-03-14T11:30:00', display_order: 1, enabled: true },
      { event_key: 'reception', display_name: 'Reception', starts_at_local: '2027-03-14T18:00:00',
        ends_at_local: null, display_order: 2, enabled: true },
      // Taken out of the running without being taken out of the frozen document. §4's join and §5's
      // scope loop both have to refuse it, so this is the one disabled row in the fixture set. Its name
      // shares no substring with any other fixture, which is what lets D-08 search prose.
      { event_key: 'picnic', display_name: 'Valarsad Picnic', starts_at_local: '2027-03-16T08:00:00',
        ends_at_local: null, display_order: 3, enabled: false },
    ],
    hostB: [
      { event_key: 'sangadham', display_name: 'Sangadham', starts_at_local: '2027-04-02T10:00:00',
        ends_at_local: null, display_order: 1, enabled: true },
      { event_key: 'vadhyam', display_name: 'Vadhyam', starts_at_local: '2027-04-02T19:00:00',
        ends_at_local: null, display_order: 2, enabled: true },
    ],
  };

  for (const who of WHO) {
    const w = await call('POST', '/rest/v1/weddings', {
      bearer: tokenOf(who),
      body: { owner_user_id: uidOf(who), title: `S8 HTTP ${who} ${RUN_TAG}`, primary_language: 'en' },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(w.status, 201, `${who} could not create a wedding: ${shown(JSON.stringify(w.body))}`);
    people[who].weddingId = w.body[0].id;

    const d = await call('PATCH', `/rest/v1/invitation_drafts?wedding_id=eq.${people[who].weddingId}`, {
      bearer: tokenOf(who),
      body: {
        content: {
          welcome: 'With the blessings of both families, please join us.',
          family_introduction: 'The Iyer and Raman families invite you.',
          event_notes: null,
          closing: null,
        },
      },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(d.status, 200, `${who} could not write its draft: ${shown(JSON.stringify(d.body))}`);

    people[who].eventIds = {};
    for (const event of HOST_EVENTS[who]) {
      const e = await call('POST', '/rest/v1/wedding_events', {
        bearer: tokenOf(who),
        body: { ...event, wedding_id: people[who].weddingId, timezone: 'Asia/Kolkata' },
        headers: { Prefer: 'return=representation' },
      });
      assert.equal(e.status, 201, `${who} could not create ${event.event_key}: `
        + `${shown(JSON.stringify(e.body))}`);
      people[who].eventIds[event.event_key] = e.body[0].id;
    }

    const v = await rpc('create_invitation_version', { p_wedding_id: people[who].weddingId },
      { as: who });
    assert.equal(v.status, 200, `${who} could not freeze v1: ${shown(JSON.stringify(v.body))}`);
    people[who].versionId = v.body.version_id;
    people[who].versionNumber = v.body.version_number;

    const p = await rpc('publish_invitation_version',
      { p_wedding_id: people[who].weddingId, p_version_id: v.body.version_id, p_expires_at: null }, { as: who });
    assert.equal(p.status, 200, `${who} could not publish v1: ${shown(JSON.stringify(p.body))}`);
    assert.equal(p.body.link_reused, false,
      'the wedding already had a link before this run published it, so the address below is not from this run');
    // The wedding's own credential, for the cross-kind case in D-08 and the coupling in N-02.
    people[who].publicToken = credFromPublicPath(p.body.path);
    people[who].publicationId = p.body.publication_id;
  }

  // The wedding that is never published, and the one household on it, both owned by host A. §3.1's
  // publication refusal is only reachable through a household the caller genuinely owns, so this fixture
  // exists to make that arm measurable rather than to be an empty wedding — and it doubles as the proof
  // that the panel is scoped per wedding rather than per owner (`H-06`).
  const u = await call('POST', '/rest/v1/weddings', {
    bearer: tokenOf('hostA'),
    body: { owner_user_id: uidOf('hostA'), title: `S8 HTTP unpublished ${RUN_TAG}`, primary_language: 'en' },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(u.status, 201,
    `the unpublished wedding could not be created: ${shown(JSON.stringify(u.body))}`);
  people.hostA.weddingU = u.body[0].id;
  HH.unpub = (await insertHousehold('hostA', people.hostA.weddingU, {
    display_name: 'Unpublished Wedding Guest', expected_party_size: 2,
  })).id;

  // Households, through the owner's REST insert. `owners_manage_households`
  // (`20260925120500_stage2_rls_and_grants.sql:227-231`) allows exactly this and nothing more, so the
  // fixtures are built with the privileges the product's own host screen has.
  const HOSTA_HOUSEHOLDS = [
    // The named, saluted, expected-four family, and the only one carrying a host note. That note is the
    // needle `D-08` and `H-08` hunt at the door and the panel.
    ['ramam', { display_name: 'The Raman Family', salutation: 'Mr and Mrs Raman and family',
      expected_party_size: 4, host_notes: 'They prefer a window seat; arriving from Chennai.' }],
    // Whitespace-only salutation: the greeting must fall back to the name, which is the `btrim` half of
    // `coalesce(nullif(btrim(coalesce(h.salutation,'')),''), h.display_name)` (`…sql:629`).
    ['nosal', { display_name: 'The Nair Household', salutation: '   ', expected_party_size: 2 }],
    // NULL salutation is the `coalesce` half of the same expression, so both arms have a fixture.
    ['singles', { display_name: 'One Person Aunt', salutation: null, expected_party_size: 1 }],
    ['reissue', { display_name: 'Reissued Cousin', salutation: 'Dr and Mrs Reissued',
      expected_party_size: 6 }],
    ['never', { display_name: 'Never Issued Uncle', expected_party_size: 2 }],
    ['shortfuse', { display_name: 'Brief Link Cousin', expected_party_size: 2 }],
    // No scope rows at all. Stage 2 says a household invited to nothing is representable and must be
    // surfaced rather than silently treated as invited-to-everything (`20260925120300...:41-45`).
    ['zeroscope', { display_name: 'Zero Scope Cousin', expected_party_size: 2 }],
    // The uncapped family. Without it the no-cap half of the party-size rule would have to be measured on
    // a household whose link had already been withdrawn.
    ['bigfamily', { display_name: 'The Open List Household', salutation: 'Open List household',
      expected_party_size: null }],
  ];
  for (const [slug, body] of HOSTA_HOUSEHOLDS) {
    HH[slug] = (await insertHousehold('hostA', people.hostA.weddingId, body)).id;
  }
  // Host B's only household, deliberately named exactly like one of host A's and given the same
  // salutation. A shared greeting is the case a name-keyed leak would survive, and `D-04` uses it to
  // prove the door and the panel are keyed by id and by nothing else.
  HH.foreign = (await insertHousehold('hostB', people.hostB.weddingId, {
    display_name: 'The Raman Family', salutation: 'Mr and Mrs Raman and family',
    expected_party_size: 3, host_notes: 'A different family with the same greeting.',
  })).id;

  const SCOPES = [
    ['ramam', ['muhurtham', 'reception', 'picnic']],
    ['nosal', ['muhurtham']],
    ['singles', ['muhurtham']],
    ['reissue', ['muhurtham', 'reception']],
    ['never', ['muhurtham']],
    ['shortfuse', ['muhurtham']],
    ['bigfamily', ['muhurtham']],
    ['zeroscope', []],
  ];
  for (const [slug, keys] of SCOPES) {
    for (const key of keys) {
      await insertScope('hostA', people.hostA.weddingId, HH[slug], eventOf('hostA', key));
    }
  }
  await insertScope('hostB', people.hostB.weddingId, HH.foreign, eventOf('hostB', 'sangadham'));

  // Host B sends its own family a link, through the product verb, before any test runs. `D-03`, `D-04`
  // and `R-09` need a *live, real* household credential belonging to another wedding; an invented string
  // would prove only that unknown strings are refused.
  await sendLinks('hostB', ['foreign']);
});

after(async () => {
  // Child before parent, in the order the foreign keys demand, which is `guest-rsvp-security.md` §12's
  // teardown order restated as statements. Three of these are Stage 8's own: `rsvp_responses` keys
  // itself to a scope row (`20260925120300...:93-95`), the scope rows point at households *and* events,
  // and `access_tokens` holds a household's row against a delete by `NO ACTION`
  // (`20260925120400...:169`) — so credentials go before households, and households before events.
  // `approval_requests` is in the list because Stage 7's verbs are reachable from this run, and a review
  // row left here would be inherited by the next suite as a defect.
  const weddings = [people.hostA?.weddingId, people.hostB?.weddingId, people.hostA?.weddingU]
    .filter(Boolean);
  if (weddings.length === 3) {
    const ids = weddings.map((w) => `'${w}'::uuid`).join(',');
    for (const stmt of [
      `delete from public.rsvp_responses where wedding_id in (${ids})`,
      `delete from public.household_event_scopes where wedding_id in (${ids})`,
      `delete from private.access_tokens where wedding_id in (${ids})`,
      `delete from public.approval_requests where wedding_id in (${ids})`,
      `delete from public.guest_households where wedding_id in (${ids})`,
      `delete from public.publications where wedding_id in (${ids})`,
      `delete from private.audit_events where wedding_id in (${ids})`,
      `delete from public.invitation_versions where wedding_id in (${ids})`,
      `delete from public.wedding_events where wedding_id in (${ids})`,
      `delete from public.weddings where id in (${ids})`,
    ]) sqlRows(stmt);
  }
  for (const who of WHO) {
    if (!uidOf(who)) continue;
    const res = await fetch(`${url}/auth/v1/admin/users/${uidOf(who)}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }

  const now = census();
  const moved = Object.keys(BASELINE).filter((k) => BASELINE[k] !== now[k]);
  assert.deepEqual(moved, [],
    `teardown did not give everything back: ${shown(moved.map((k) => `${k} ${BASELINE[k]}->${now[k]}`).join(', '))}`);

  console.log('  residue census after the Stage 8 HTTP teardown (whole database):');
  for (const line of sqlRows(censusQuery)) console.log(shown(`    ${line}`));
});

// ---------------------------------------------------------------------------
// T — the transport: which schema, which verb, which channel carries a household secret
// ---------------------------------------------------------------------------
describe('S8 TRANSPORT', () => {
  // Every case here works on the credential `before()` already minted for host B's own family, rather
  // than minting one of its own. A transport test that mints steals H-01's first-send claim, and this
  // file's H-group is the only place that gets to say what a first send looks like.
  const foreign = () => credOf('foreign');

  test('T-01 a Stage 8 call is reachable through the api profile and through nothing else', async () => {
    const args = { p_wedding_id: weddingOf('hostA'), p_household_ids: [hh('never')] };

    const none = await rpc('issue_guest_invitations', args, { as: 'hostA', profile: null });
    assert.equal(none.status, 404, 'a call with no profile reached the verb');
    assert.equal(none.body.code, 'PGRST202');
    assert.match(none.body.message, /public\.issue_guest_invitations/,
      'the profileless refusal names a schema other than public');

    const pub = await rpc('issue_guest_invitations', args, { as: 'hostA', profile: 'public' });
    assert.equal(pub.status, 404, 'the public profile resolved a Stage 8 verb');

    const internal = await rpc('issue_guest_invitations', args, {
      as: 'hostA', profile: 'internal_api',
    });
    assert.equal(internal.status, 406, 'the unexposed schema was addressable');
    assert.equal(internal.body.code, 'PGRST106');
    assert.equal(internal.body.hint, 'Only the following schemas are exposed: public, api',
      'the exposure list moved; this file says what the router answers, not what the design hopes');

    // The control is the read verb, so this case does not mint anything at all.
    const api = await rpc('get_guest_invitation_state', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA' });
    assert.equal(api.status, 200,
      `the api profile did not reach the verb: ${shown(JSON.stringify(api.body))}`);
    assert.ok(Array.isArray(api.body), 'the panel through the api profile was not a list');

    // The other two host verbs, at the same profile, refused the same way.
    for (const name of ['issue_guest_invitations', 'revoke_guest_invitation',
      'rotate_guest_invitation', 'get_guest_invitation_state']) {
      const away = await rpc(name, { p_wedding_id: weddingOf('hostA') }, { as: 'hostA', profile: 'internal_api' });
      assert.equal(away.status, 406, `${name} was callable in the unexposed schema`);
    }
  });

  test('T-02 the read door has no parameter, in either of the two spellings a client might try', async () => {
    const asArgument = await rpc('resolve_guest_invitation', { p_token: foreign() });
    assert.equal(asArgument.status, 404);
    assert.equal(asArgument.body.code, 'PGRST202');
    assert.match(asArgument.body.message, /api\.resolve_guest_invitation\(p_token\)/);

    const asBodyHeaderName = await rpc('resolve_guest_invitation', { 'x-guest-token': foreign() });
    assert.equal(asBodyHeaderName.status, 404);
    assert.match(asBodyHeaderName.body.message, /x-guest-token/);

    const byHeader = await gopen(foreign());
    assert.equal(byHeader.status, 200);
    assert.equal(byHeader.body.available, true,
      'the same string arrived by header and did not open the door');
  });

  test('T-03 a household credential addressed in a query string is echoed by the router — the reason there is no parameter', async () => {
    const res = await call('POST', `/rest/v1/rpc/resolve_guest_invitation?x-guest-token=${foreign()}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'PGRST100');
    // A boolean, not the message. Stage 7 measured that the router's own text is
    // `failed to parse filter (<the credential itself>)`, so the value is inside a longer string rather
    // than the whole of it; putting the message in an assertion's `actual` would reproduce the leak this
    // test is about in a run log that lives outside the repository.
    assert.equal(res.body.message.includes(foreign()), true,
      `the router's refusal did not carry the credential it was given: ${shown(res.body.message)}`);

    const get = await call('GET', '/rest/v1/rpc/resolve_guest_invitation',
      { headers: { 'x-guest-token': foreign() } });
    assert.equal(get.status, 404, 'a volatile function answered a GET');
    assert.equal(get.body.code, 'PGRST202');
  });

  test('T-04 both household doors open with nothing but the publishable key', async () => {
    // PREDICTION, read from `…sql:1207` and `:1211` and not from a live `pg_proc` — S-01 is the case that
    // closes that gap. If the grants are as written, these two requests have no session and still work.
    const noSession = await call('POST', '/rest/v1/rpc/resolve_guest_invitation', {
      body: {}, headers: { 'Content-Profile': 'api', 'x-guest-token': foreign() },
    });
    assert.equal(noSession.status, 200, 'an anonymous open did not reach the door');
    assert.equal(noSession.body.available, true, 'the publishable key could not open a live link');

    const answered = await call('POST', '/rest/v1/rpc/submit_guest_rsvp', {
      body: { p_answers: { events: [{ event_id: eventOf('hostB', 'sangadham'), attending: 'attending', party_size: 2 }] } },
      headers: { 'Content-Profile': 'api', 'x-guest-token': foreign() },
    });
    assert.equal(answered.status, 200,
      `an anonymous answer did not reach the door: ${shown(JSON.stringify(answered.body))}`);
    assert.equal(answered.body.recorded, true, 'the publishable key could not record an answer');
    assert.deepEqual(Object.keys(answered.body).sort(), ANSWER_KEYS);
    // The row it wrote, read back as database facts rather than as the verb's own report: a guest's
    // submission is `response_source = 'guest'`, which is the value §5 writes and nothing else can.
    assert.equal(cell(`select attending || '/' || party_size::text || '/' || response_source
        from public.rsvp_responses where household_id = '${hh('foreign')}'::uuid`,
      'the anonymous reply'), 'attending/2/guest',
      'the anonymous door wrote a reply that did not come from a guest');
  });

  test('T-05 the header name is case-folded by the router, and the wedding door is not this door', async () => {
    // One spelling per request, and the credential never sent twice. Measured on this stack 2026-10-12:
    // a Node `fetch` given the same header name in two casings puts **one** header on the wire whose value
    // is the two joined with `", "` (43 + 2 + 43 = 88 octets), and §4's shape gate at `…sql:586` refuses
    // any value that is not exactly 43 octets — so sending both spellings at once measures the gate, not
    // the router. Stage 7's equivalent case sends one spelling per request for the same reason
    // (`stage7_family_approval.test.mjs:495-501`), and `gopen(undefined, …)` is the spelling that does so.
    const upper = await gopen(undefined, { headers: { 'X-Guest-Token': foreign() } });
    assert.equal(upper.body.available, true, 'a capitalised header did not open a live link');
    const shout = await gopen(undefined, { headers: { 'X-GUEST-TOKEN': foreign() } });
    assert.equal(shout.body.available, true, 'an all-caps header did not open a live link');

    // Stage 3's wedding credential is a real, live secret in this run, and this door must not accept it:
    // the header *name* is part of the access model, not a convenience.
    const wrongName = await rpc('resolve_guest_invitation', {}, {
      headers: { 'x-invitation-token': people.hostA.publicToken },
    });
    assert.deepEqual(wrongName.body, UNAVAILABLE,
      'the household door read the wedding door header');
    const rightNameOtherSecret = await rpc('resolve_guest_invitation', {}, {
      headers: { 'x-guest-token': people.hostA.publicToken },
    });
    assert.deepEqual(rightNameOtherSecret.body, UNAVAILABLE,
      'a wedding credential opened a household door');
  });
});

// ---------------------------------------------------------------------------
// G — who may call what, measured at the layer that actually stops them
// ---------------------------------------------------------------------------
describe('S8 CALLER MATRIX', () => {
  const HOST_CALLS = [
    ['issue_guest_invitations', { p_wedding_id: null, p_household_ids: null, p_expires_at: null }],
    ['revoke_guest_invitation', { p_household_id: null }],
    ['rotate_guest_invitation', { p_household_id: null }],
    ['get_guest_invitation_state', { p_wedding_id: null }],
  ];

  for (const [name, args] of HOST_CALLS) {
    test(`G-01 anon is refused ${name} at the function, with 401 and the grant sentence`, async () => {
      const res = await rpc(name, args);
      assert.equal(res.status, 401, `anon reached ${name}`);
      assert.equal(res.body.code, '42501');
      assert.equal(res.body.message, `permission denied for function ${name}`);
    });
  }

  test('G-02 service_role is stopped at the schema, which is where the wrappers are not exposed', async () => {
    // All six, including the two doors: `service_role` has no grant on either (§8 revokes it at `:1205`
    // and `:1209` before granting anon and authenticated), and the schema refusal arrives first.
    for (const [name, args] of [...HOST_CALLS,
      ['resolve_guest_invitation', {}], ['submit_guest_rsvp', { p_answers: null }]]) {
      const res = await rpc(name, args, { as: 'service' });
      assert.equal(res.status, 403, `service_role reached ${name}`);
      assert.equal(res.body.code, '42501');
      assert.equal(res.body.message, 'permission denied for schema api',
        `${name} was refused at a layer other than the schema`);
    }
  });

  test('G-03 another host is refused by name, in both of its own sentences, and nothing moved', async () => {
    // Host A sends its own family a link first, so that the two attempts below have something real to
    // damage. A cross-host refusal proved only against an empty household would let a broken ownership
    // check through as a harmless no-op — and `rotate` is exactly the verb whose failure mode is *adding*
    // a row. This is the one mint outside the H-group, and H-02 therefore uses this household for its
    // already-live claim rather than pretending to be the first send.
    await sendLinks('hostA', ['ramam']);
    assert.equal(tokenFacts(hh('ramam')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
      'the fixture send did not leave one live household credential');

    const withdraw = await rpc('revoke_guest_invitation', { p_household_id: hh('ramam') }, { as: 'hostB' });
    assert.equal(withdraw.status, 403, 'host B withdrew host A');
    assert.equal(withdraw.body.code, '42501');
    assert.equal(withdraw.body.message, SAY.notWithdraw);

    const rotate = await rpc('rotate_guest_invitation', { p_household_id: hh('ramam') }, { as: 'hostB' });
    assert.equal(rotate.status, 403, 'host B rotated host A');
    assert.equal(rotate.body.message, SAY.notRotate);

    // The refusal is a refusal, not a slow accept: still one row, still live, still no `revoked_at`, and
    // no second secret that would have to be the one a broken rotate left behind.
    assert.equal(tokenFacts(hh('ramam')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
      'the attempted cross-host calls changed the credential rows');
    assert.equal(tokenCell(hh('ramam'), 'coalesce(revoked_at::text,\'-\')'), '-',
      'the attempted cross-host rotate revoked a live link');

    // One sentence for "not your household" and "no such household", byte-identical: the verb cannot be
    // used to enumerate which households exist. `auth.uid()` differs between these two calls, and the
    // response does not.
    const strangerWithRealId = withdraw.text;
    const strangerWithInventedId = await rpc('revoke_guest_invitation',
      { p_household_id: NOT_A_HOUSEHOLD }, { as: 'hostB' });
    assert.equal(strangerWithInventedId.status, 403);
    assert.equal(strangerWithInventedId.text, strangerWithRealId,
      'the withdraw verb answers differently for a household that exists');
    const ownerWithInventedId = await rpc('rotate_guest_invitation',
      { p_household_id: NOT_A_HOUSEHOLD }, { as: 'hostA' });
    assert.equal(ownerWithInventedId.status, 403);
    assert.equal(ownerWithInventedId.body.message, SAY.notRotate,
      'an invented household id gave the owner a different answer than a stranger did');

    // The NULL arm is checked before ownership in both bodies (`:327` before `:339`, `:389` before
    // `:399`), so a caller with no claim on the household still learns the shape of their own mistake.
    for (const [name, sentence] of [['revoke_guest_invitation', SAY.nameWithdraw],
      ['rotate_guest_invitation', SAY.nameRotate]]) {
      const nullRefusal = await rpc(name, { p_household_id: null }, { as: 'hostB' });
      assert.equal(nullRefusal.status, 400, `${name} answered a NULL id with ${nullRefusal.status}`);
      assert.equal(nullRefusal.body.code, '23514');
      assert.equal(nullRefusal.body.message, sentence);
    }
  });

  test('G-04 a wedding that is not yours is refused before any household is looked at', async () => {
    // Three ids that should all read the same way to a caller: another host's real wedding, a wedding
    // that was never born, and no wedding at all. All three hit §3.1's first arm (`:175-180`) and none
    // of them may reach the membership test at `:201`, which is the one that could describe host B's
    // households.
    const sends = [];
    for (const wedding of [weddingOf('hostB'), NOT_A_WEDDING, null]) {
      const res = await rpc('issue_guest_invitations',
        { p_wedding_id: wedding, p_household_ids: [hh('ramam')] }, { as: 'hostA' });
      assert.equal(res.status, 403, `issue accepted p_wedding_id=${wedding}`);
      assert.equal(res.body.code, '42501');
      assert.equal(res.body.message, SAY.notSend);
      sends.push(res.text);
    }
    assert.equal(new Set(sends).size, 1, 'the three weddings a caller cannot use answered differently');

    // The order claim: host A's *own* household id, aimed at host B's wedding, is a boundary problem and
    // must answer as one — the list-membership sentence at `:205` would be the leak.
    const crossed = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostB'), p_household_ids: [hh('ramam')] }, { as: 'hostA' });
    assert.equal(crossed.body.message, SAY.notSend,
      'a cross-wedding household was reported as a membership problem');

    const panel = await rpc('get_guest_invitation_state', { p_wedding_id: weddingOf('hostB') },
      { as: 'hostA' });
    assert.equal(panel.status, 403);
    assert.equal(panel.body.message, SAY.notReadPanel);
    const unborn = await rpc('get_guest_invitation_state', { p_wedding_id: NOT_A_WEDDING },
      { as: 'hostA' });
    assert.equal(unborn.status, 403);
    assert.equal(unborn.text, panel.text,
      'the panel distinguishes a wedding that never existed from another host');

    // And host B's family is untouched by all of it.
    assert.equal(tokenFacts(hh('foreign')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
      'a refused cross-wedding call changed the other wedding credentials');
  });

  test('G-05 a door with no secret answers one indistinguishable object', async () => {
    const missing = await gopen(undefined);
    assert.equal(missing.status, 200, 'the read door answered a missing credential with an error');
    assert.deepEqual(missing.body, UNAVAILABLE);

    const junk = await gopen(`${'x'.repeat(42)}!`);
    assert.equal(junk.status, 200);
    assert.deepEqual(junk.body, UNAVAILABLE);
    assert.equal(junk.text, missing.text,
      'a malformed credential answered with different bytes than a missing one');

    const unknown = await gopen('k'.repeat(43));
    assert.equal(unknown.text, missing.text,
      'an unknown-but-well-formed credential answered with different bytes, which is an oracle');
    assert.equal(unknown.status, 200);

    // The answer door, same posture, and the same shape on both halves of §5's access family.
    const valid = { events: [{ event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 1 }] };
    const noCred = await grsvp('z'.repeat(43), valid);
    assert.equal(noCred.status, 200, 'the answer door answered a dead credential with an error');
    assert.deepEqual(noCred.body, NOT_RECORDED);
    const shortCred = await grsvp(`${'q'.repeat(42)}.`, valid);
    assert.equal(shortCred.text, noCred.text,
      'the answer door distinguishes a malformed credential from an unknown one');
    // Nothing was written anywhere in host A's wedding, which is the only claim a refusal can be held
    // to: the body named one of its events, so a verb that resolved the credential before reading the
    // shape would have had a live household to write for.
    assert.equal(cell(`select count(*)::text from public.rsvp_responses
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'host A replies at the door-refusal stage'), '0',
      'a refusal at the answer door still wrote a reply');
  });
});

// ---------------------------------------------------------------------------
// S — the exposed surface and the privileges behind it, read from the catalog the router uses
// ---------------------------------------------------------------------------
describe('S8 SURFACE AND PRIVILEGES', () => {
  // The twelve objects that make up the Stage 8 surface: six one-line `SECURITY INVOKER` wrappers in the
  // served schema, six `SECURITY DEFINER` bodies in the unexposed one. Read as one string per object so
  // a change in either half of a pair fails with the pair's name rather than as a diff of three columns.
  //
  // `authenticated` has execute on both halves of every pair, and that is the design rather than an
  // oversight: the body grant is what lets the wrapper's one `SELECT internal_api.…` resolve, and the
  // only way a browser can reach a body is through a schema the router refuses (T-01's 406). What must
  // differ between the halves is `prosecdef`, and what must not appear anywhere is `anon` or
  // `service_role` on a host verb, or `PUBLIC` on any of the twelve.
  const POSTURE = {
    'api.get_guest_invitation_state': 'definer=false lang=sql anon=false auth=true svc=false public=false',
    'api.issue_guest_invitations': 'definer=false lang=sql anon=false auth=true svc=false public=false',
    'api.resolve_guest_invitation': 'definer=false lang=sql anon=true auth=true svc=false public=false',
    'api.revoke_guest_invitation': 'definer=false lang=sql anon=false auth=true svc=false public=false',
    'api.rotate_guest_invitation': 'definer=false lang=sql anon=false auth=true svc=false public=false',
    'api.submit_guest_rsvp': 'definer=false lang=sql anon=true auth=true svc=false public=false',
    'internal_api.get_guest_invitation_state': 'definer=true lang=plpgsql anon=false auth=true svc=false public=false',
    'internal_api.issue_guest_invitations': 'definer=true lang=plpgsql anon=false auth=true svc=false public=false',
    'internal_api.resolve_guest_invitation': 'definer=true lang=plpgsql anon=true auth=true svc=false public=false',
    'internal_api.revoke_guest_invitation': 'definer=true lang=plpgsql anon=false auth=true svc=false public=false',
    'internal_api.rotate_guest_invitation': 'definer=true lang=plpgsql anon=false auth=true svc=false public=false',
    'internal_api.submit_guest_rsvp': 'definer=true lang=plpgsql anon=true auth=true svc=false public=false',
  };

  test('S-01 the twelve Stage 8 objects have exactly the posture §7 and §8 describe', async () => {
    const rows = sqlRows(`
      select n.nspname || '.' || p.proname || ' definer=' || p.prosecdef::text
        || ' lang=' || l.lanname
        || ' anon=' || pg_catalog.has_function_privilege('anon', p.oid, 'execute')::text
        || ' auth=' || pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')::text
        || ' svc=' || pg_catalog.has_function_privilege('service_role', p.oid, 'execute')::text
        || ' public=' || coalesce((select bool_or(g.grantee is null or g.grantee = 0)
              from pg_catalog.aclexplode(p.proacl) g), false)::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_language l on l.oid = p.prolang
       where n.nspname in ('api', 'internal_api')
         and p.proname in ('issue_guest_invitations', 'revoke_guest_invitation',
                           'rotate_guest_invitation', 'get_guest_invitation_state',
                           'resolve_guest_invitation', 'submit_guest_rsvp')
       order by 1`);
    assert.equal(rows.length, 12,
      `the Stage 8 surface is ${rows.length} objects, not twelve: ${shown(rows.join(' / '))}`);
    for (const line of rows.map(shown)) {
      const key = line.slice(0, line.indexOf(' definer='));
      assert.ok(POSTURE[key], `an unexpected Stage 8 object is deployed: ${key}`);
      assert.equal(line, `${key} ${POSTURE[key]}`,
        'the deployed posture is not the one the migration declares');
    }
  });

  test('S-02 the three guest stores are invisible to the anonymous web, and one of them still has only the manual-reply policies', async () => {
    for (const rel of ['guest_households', 'household_event_scopes', 'rsvp_responses']) {
      const res = await call('GET', `/rest/v1/${rel}?select=*`);
      assert.equal(res.status, 401, `anon read ${rel}`);
      assert.equal(res.body.code, '42501');
      assert.match(res.body.message, new RegExp(`permission denied for table ${rel}`));
    }
    // The control, in the shape CAT-01 established: the same key and the same transport do reach the
    // household door, so the three refusals above are about grants and not about anon being shut out of
    // PostgREST altogether.
    const control = await gopen('j'.repeat(43));
    assert.equal(control.status, 200, 'the anonymous door stopped working, so S-02 proves nothing');
    assert.deepEqual(control.body, UNAVAILABLE);

    // The catalog behind those refusals, plus the one claim §5 depends on: Stage 8 added no policy to
    // `rsvp_responses`, so a guest's write is still only reachable through the SECURITY DEFINER body and
    // the host's own writes are still only the two manual-reply policies. The anonymous-web claim is read
    // as "no grant of any kind", which is what makes the three 401s above a posture rather than an accident.
    assert.equal(cell(`select 'noanon='||bool_and(not has_table_privilege('anon',
            'public.'||relname, 'select'))
          ||'.'||bool_and(not has_table_privilege('anon', 'public.'||relname, 'insert'))
          ||'.'||bool_and(not has_table_privilege('anon', 'public.'||relname, 'update'))
          ||'.'||bool_and(not has_table_privilege('anon', 'public.'||relname, 'delete'))
        from (values ('guest_households'), ('household_event_scopes'), ('rsvp_responses')) v(relname)`,
      'the anonymous grants on the guest stores'), 'noanon=true.true.true.true',
      'the anonymous web gained a table privilege on a guest store');

    assert.equal(cell(`select 'policies='||count(*)::text||' names='||coalesce(string_agg(policyname, '+' order by policyname), '-')
        from pg_policies where schemaname = 'public' and tablename = 'rsvp_responses'`,
      'the reply policies'),
      'policies=4 names=owners_delete_rsvps+owners_read_rsvps+owners_record_manual_rsvps+owners_update_manual_rsvps',
      'Stage 8 changed what a browser role may write into the reply table, which §5 rules out');
  });

  test('S-03 a host still cannot read the credential store, which is why the panel is a verb', async () => {
    const anon = await call('GET', '/rest/v1/access_tokens?select=*');
    assert.equal(anon.status, 404, 'private.access_tokens is in the exposed catalogue for anon');
    assert.equal(anon.body.code, 'PGRST205');

    const host = await call('GET', '/rest/v1/access_tokens?select=*', { bearer: tokenOf('hostA') });
    assert.equal(host.status, 404, 'a host could list credential rows');
    assert.equal(host.body.code, 'PGRST205');

    // The same host, the same wedding, through the verb that exists for it: four households visible and
    // no token material among the ten columns.
    const panel = await rpc('get_guest_invitation_state', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA' });
    assert.equal(panel.status, 200);
    assert.ok(panel.body.length >= 8, 'the panel lost the households it was built to report');
    assert.equal(JSON.stringify(panel.body).match(/token_hash|token|[0-9a-f]{64}/g), null,
      'the panel carries credential material');
  });

  test('S-04 the answers bound governs a host\'s own manual reply, and the host write path still works', async () => {
    // §1 re-declared `rsvp_responses_answers_check` under the name Stage 2 generated for it, with the
    // 2000-octet bound at `:140`. The bound has to govern every writer, not only the guest door, or the
    // host screen becomes the way to store a novel against a family's name. Readings 100 octets clear of
    // either side; the exact edge is the SQL battery's case.
    const write = (answers) => call('POST', '/rest/v1/rsvp_responses', {
      bearer: tokenOf('hostA'),
      body: {
        wedding_id: weddingOf('hostA'), household_id: hh('never'),
        event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 2,
        response_source: 'host_manual', answers,
      },
      headers: { Prefer: 'return=representation' },
    });

    const small = await write(answersOfOctets(1900));
    assert.equal(small.status, 201,
      `a host manual reply inside the bound was refused: ${shown(JSON.stringify(small.body))}`);
    const rowId = small.body[0].id;

    const large = await write(answersOfOctets(2100));
    assert.equal(large.status, 400, 'the 2000-octet bound did not govern a host write');
    assert.equal(large.body.code, '23514');
    assert.match(large.body.message, /rsvp_responses_answers_check/,
      'a bound this file re-declared was reported under some other constraint');

    const junk = await write(['x']);
    assert.equal(junk.status, 400);
    assert.equal(junk.body.code, '23514');

    const gone = await call('DELETE', `/rest/v1/rsvp_responses?id=eq.${rowId}`, {
      bearer: tokenOf('hostA'),
    });
    assert.equal(gone.status, 204, 'the fixture reply could not be given back');
    assert.equal(replyCount(hh('never')), '0', 'S-04 left a reply behind');
  });
});

// ---------------------------------------------------------------------------
// H — §3.1, the send: what a first send gives, what a second send withholds, what refuses
// ---------------------------------------------------------------------------
describe('S8 ISSUE', () => {
  const isoIn = (ms) => new Date(Date.now() + ms).toISOString();

  test('H-01 a first send mints one secret per household and reports the shape §3.1 returns', async () => {
    const res = await sendLinks('hostA', ['reissue', 'never']);
    assert.deepEqual(Object.keys(res.body).sort(), SEND_KEYS);
    assert.equal(res.body.wedding_id, weddingOf('hostA'));
    assert.equal(res.body.publication_id, people.hostA.publicationId,
      'the household credential was pinned to something other than the active publication');
    assert.equal(res.body.issued, 2);
    assert.equal(res.body.already_live, 0);
    assert.equal(res.body.expires_at, null, 'a send with no deadline invented one');
    // The caller's array was [reissue, never]; the response is in display-name order, which is the
    // order §3.1's loop declares (`…sql:238`) and the order the panel uses, so the two reads cannot
    // disagree about which family a link belongs to.
    assert.deepEqual(res.body.invitations.map((i) => i.display_name),
      ['Never Issued Uncle', 'Reissued Cousin']);
    const ids = res.body.invitations.map((i) => i.household_id);
    assert.equal(new Set(ids).size, 2, 'one household was reported twice');
    for (const item of res.body.invitations) {
      assert.deepEqual(Object.keys(item).sort(), SEND_ITEM_KEYS);
      assert.equal(item.status, 'issued');
      assert.match(item.household_id, UUID, 'the reported household id is not a uuid');
      assert.equal(HH['never'] === item.household_id || HH.reissue === item.household_id, true,
        `a link was minted for ${item.household_id}, which is not one of the two asked for`);
      assert.match(item.path, /^\/g\/[A-Za-z0-9_-]{43}$/);
    }
    assert.equal(res.body.invitations[0].path === res.body.invitations[1].path, false,
      'two households were given the same address');
    for (const slug of ['never', 'reissue']) {
      assert.equal(tokenFacts(hh(slug)), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
        `${slug} did not end up with exactly one live household credential`);
    }
  });

  test('H-02 a second send reports the live link and reveals nothing at all', async () => {
    // ramam's link was minted by G-03, so this is the re-send case rather than a first send. §3.1's
    // `already_live` arm (`:248-258`) is the one that must fire, and the claim worth testing is negative:
    // a raw credential is legible exactly once, so a verb that re-reported the address would turn
    // "send the links" into a way to read an old secret again.
    const before = credOf('ramam');
    const res = await sendLinks('hostA', ['ramam']);
    assert.equal(res.body.issued, 0);
    assert.equal(res.body.already_live, 1);
    assert.equal(res.body.invitations.length, 1);
    assert.deepEqual(Object.keys(res.body.invitations[0]).sort(), SEND_ITEM_KEYS);
    assert.equal(res.body.invitations[0].status, 'already_live');
    assert.equal(res.body.invitations[0].path, null, 'a re-send carried a path');
    assert.equal(res.text.includes(before), false, 'the live secret was echoed by a re-send');
    // The whole response body, searched rather than the two fields that would be convenient to check:
    // the only 43-character alphabet in this product is a credential, and nothing in a refusal-shaped
    // answer should contain one.
    assert.equal(res.text.match(/[A-Za-z0-9_-]{43}/g), null,
      `a re-send carried something 43 characters long: ${shown(res.text)}`);
    assert.equal(tokenFacts(hh('ramam')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
      'a re-send minted a second live secret for one household');

    // The omission, measured rather than assumed. `sendLinks` always states the third argument, because a
    // call that *leaves out* a defaulted parameter has no precedent measurement in this repository —
    // Stage 3's publish calls spell the null out (`stage3_publication.test.mjs:593-595`, `:822-824`) — and
    // the host screen will use the short spelling when the host asks for links with no deadline. Both
    // households here are already live, so §3.1's `already_live` arm fires and nothing is minted on either
    // spelling; that makes the two answers comparable bytes instead of two different writes. If PostgREST
    // ever stops resolving an absent defaulted parameter, this is the case that says so, with its own
    // 404/PGRST202 body, rather than an unexplained expiry somewhere later in this file.
    const family = [hh('never'), hh('reissue')];
    const omitted = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostA'), p_household_ids: family }, { as: 'hostA' });
    assert.equal(omitted.status, 200, `a call that omits the defaulted p_expires_at did not resolve: `
      + shown(JSON.stringify(omitted.body)));
    const stated = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostA'), p_household_ids: family, p_expires_at: null }, { as: 'hostA' });
    assert.equal(stated.status, 200);
    assert.equal(omitted.text, stated.text,
      'omitting the default and passing null reached different behaviour, so the default is not NULL');
    for (const slug of ['never', 'reissue']) {
      assert.equal(tokenFacts(hh(slug)), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
        `${slug}: the two spellings wrote different numbers of rows, so one of them minted`);
    }
  });

  test('H-03 a household listed twice in one request appears once', async () => {
    const fresh = await sendLinks('hostA', ['zeroscope', 'zeroscope']);
    assert.equal(fresh.body.issued, 1, 'a duplicated id minted two links');
    assert.equal(fresh.body.already_live, 0);
    assert.equal(fresh.body.invitations.length, 1, 'the response carried the caller list, not the families');
    assert.equal(tokenFacts(hh('zeroscope')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1');

    const live = await sendLinks('hostA', ['reissue', 'reissue', 'reissue']);
    assert.equal(live.body.issued, 0);
    assert.equal(live.body.already_live, 1);
    assert.equal(live.body.invitations.length, 1);
    assert.equal(live.body.invitations[0].status, 'already_live');
  });

  test('H-04 a list that is not a list of my households refuses, and mints nothing on the way out', async () => {
    const empty = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostA'), p_household_ids: [] }, { as: 'hostA' });
    assert.equal(empty.status, 400, 'an empty list was accepted as a success');
    assert.equal(empty.body.code, '23514');
    assert.equal(empty.body.message, SAY.emptyList);

    const nul = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostA'), p_household_ids: null }, { as: 'hostA' });
    assert.equal(nul.status, 400);
    assert.equal(nul.body.message, SAY.emptyList);

    // The bound is checked before the membership of any id in the list, so 201 invented ids answer as a
    // size problem rather than as a description of which ids the database does not know.
    const tooMany = await rpc('issue_guest_invitations', {
      p_wedding_id: weddingOf('hostA'),
      p_household_ids: Array.from({ length: 201 }, (_unused, i) =>
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    }, { as: 'hostA' });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.code, '23514');
    assert.equal(tooMany.body.message, SAY.tooManyHouseholds);
    assert.equal(tooMany.body.code, '23514');

    const invented = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostA'), p_household_ids: [NOT_A_HOUSEHOLD] }, { as: 'hostA' });
    assert.equal(invented.status, 403, 'an invented household id was reported as anything else');
    assert.equal(invented.body.code, '42501');
    assert.equal(invented.body.message, SAY.listNotMine);

    const nullId = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostA'), p_household_ids: [null] }, { as: 'hostA' });
    assert.equal(nullId.status, 403);
    assert.equal(nullId.body.message, SAY.listNotMine);

    // Another host's household, named by a real uuid, by its legitimate owner: the same sentence, so
    // this verb cannot be used to ask whether a household exists.
    const foreign = await rpc('issue_guest_invitations',
      { p_wedding_id: weddingOf('hostA'), p_household_ids: [hh('foreign')] }, { as: 'hostA' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.message, SAY.listNotMine);
    assert.equal(foreign.text, invented.text,
      'the send verb distinguishes a household that does not exist from one that belongs to someone else');

    // And the mixed list — one of mine, one of theirs — must mint nothing, because §3.1's whole body is
    // one transaction and the membership test is above the loop.
    const mixed = await rpc('issue_guest_invitations', {
      p_wedding_id: weddingOf('hostA'), p_household_ids: [hh('bigfamily'), hh('foreign')],
    }, { as: 'hostA' });
    assert.equal(mixed.status, 403);
    assert.equal(mixed.body.message, SAY.listNotMine);
    assert.equal(tokenFacts(hh('bigfamily')), 'total=0 live=0 kind=- guestid=0 nullver=0',
      'a refused mixed list still minted for the household it was allowed to touch');
  });

  test('H-05 a deadline in the past refuses, and it refuses before the missing publication does', async () => {
    const past = isoIn(-60_000);
    const mine = await rpc('issue_guest_invitations', {
      p_wedding_id: weddingOf('hostA'), p_household_ids: [hh('bigfamily')], p_expires_at: past,
    }, { as: 'hostA' });
    assert.equal(mine.status, 400, `a past deadline was accepted: ${shown(JSON.stringify(mine.body))}`);
    assert.equal(mine.body.code, '23514');
    assert.equal(mine.body.message, SAY.pastExpiry);
    assert.equal(tokenFacts(hh('bigfamily')), 'total=0 live=0 kind=- guestid=0 nullver=0',
      'a refused past deadline still wrote a credential row');

    // The ordering claim, across two arms that are both reachable at once on the unpublished wedding:
    // §3.1 tests the deadline at `:209` and the publication at `:219`, so the caller is told the
    // correctable fact rather than the structural one.
    const both = await rpc('issue_guest_invitations', {
      p_wedding_id: people.hostA.weddingU, p_household_ids: [hh('unpub')], p_expires_at: past,
    }, { as: 'hostA' });
    assert.equal(both.status, 400);
    assert.equal(both.body.message, SAY.pastExpiry);
  });

  test('H-06 a household on a wedding that has not been published cannot be sent a link', async () => {
    // The refusal is only worth having if it arrives for a household the caller genuinely owns — a
    // stranger's household would stop at §3.1's first arm and the publication arm would never be seen.
    const res = await rpc('issue_guest_invitations', {
      p_wedding_id: people.hostA.weddingU, p_household_ids: [hh('unpub')],
    }, { as: 'hostA' });
    assert.equal(res.status, 400, `the unpublished wedding accepted a send: ${shown(JSON.stringify(res.body))}`);
    assert.equal(res.body.code, '23514');
    assert.equal(res.body.message, SAY.unpublished);
    assert.equal(tokenFacts(hh('unpub')), 'total=0 live=0 kind=- guestid=0 nullver=0');

    // The panel still lists it, because the panel is a read of the host's own households and not a claim
    // that anything was ever sent (Ruling 3.3's other half).
    const rows = await panelFor('hostA', people.hostA.weddingU);
    assert.equal(rows.length, 1, 'the unpublished wedding listed more than its own household');
    assert.equal(rows[0].household_id, hh('unpub'));
    assert.equal(rows[0].link_state, 'never_issued');
    assert.equal(rows[0].scoped_event_count, 0);
  });

  test('H-07 a send with a deadline writes a fixed policy, and the fuse case is given a real fuse', async () => {
    const far = isoIn(3 * 86_400_000);
    const res = await sendLinks('hostA', ['bigfamily'], { expiresAt: far });
    assert.equal(res.body.issued, 1);
    // Compared as an instant rather than as a string: the verb echoes the timestamptz it was given and
    // jsonb renders it in the server's own spelling, which is not this file's business.
    assert.equal(Math.abs(Date.parse(res.body.expires_at) - Date.parse(far)) < 1000, true,
      `the reported deadline was not the one sent: ${shown(res.body.expires_at)}`);
    assert.equal(cell(`select expiry_policy || ' ' || (expires_at is not null)::text
        from private.access_tokens where household_id = '${hh('bigfamily')}'::uuid`,
      'the big family deadline'), 'fixed true', 'a deadline was reported but not stored as a fixed policy');
    assert.equal(cell(`select (expires_at = '${far}'::timestamptz)::text
        from private.access_tokens where household_id = '${hh('bigfamily')}'::uuid`,
      'the stored deadline'), 'true', 'the stored deadline differs from the one the host sent');

    // Two seconds, not three days: L-05 has to measure a link that expired while the suite was running,
    // and a fuse nobody lit is not a fuse.
    const fuse = await sendLinks('hostA', ['shortfuse'], { expiresAt: isoIn(2000) });
    assert.equal(fuse.body.issued, 1);
    assert.equal(tokenCell(hh('shortfuse'), 'expiry_policy'), 'fixed');
    const opened = await gopen(credOf('shortfuse'));
    assert.equal(opened.body.available, true, 'a two-second fuse was not live immediately');
  });

  test('H-08 what the send stored is a household credential, and the stored form is the digest', async () => {
    // The pair this file cannot get from the SQL battery: the secret that arrived over HTTP is the secret
    // the door resolves, and the row it is stored in is the *hash* of it. Recomputing SHA-256 here proves
    // the storage posture at the transport rather than trusting §3.1's comment.
    for (const slug of ['ramam', 'never', 'reissue']) {
      const raw = credOf(slug);
      const stored = cell(`select token_hash || '|' || token_kind || '|' || wedding_id::text
          || '|' || coalesce(publication_id::text,'-') || '|'
          || coalesce(approval_request_id::text,'-') || '|'
          || coalesce(approval_version_id::text,'-') || '|' || expiry_policy
          from private.access_tokens where household_id = '${hh(slug)}'::uuid`,
      `${slug} credential row`);
      const [hash, kind, wedding, publication, request, version, policy] = stored.split('|');
      assert.equal(hash, createHash('sha256').update(raw, 'utf8').digest('hex'),
        `${slug}: the stored digest is not the digest of the credential that was handed out`);
      assert.equal(hash.includes(raw), false, `${slug}: the raw credential is stored`);
      assert.equal(kind, 'guest_invitation');
      assert.equal(wedding, weddingOf('hostA'));
      assert.equal(publication, people.hostA.publicationId,
        `${slug}: the credential is pinned to another publication`);
      assert.equal(request, '-', `${slug}: a household credential carries approval material`);
      assert.equal(version, '-', `${slug}: a household credential is pinned to a frozen version directly`);
      assert.equal(policy, 'no_expiry');
    }
  });
});

// ---------------------------------------------------------------------------
// L — the life of one household link, as the host screen sees it
// ---------------------------------------------------------------------------
describe('S8 LINK LIFE', () => {
  test('L-01 the panel is one row per household, in the order §3.4 declares, with the four link states', async () => {
    const rows = await panelFor('hostA', weddingOf('hostA'));
    assert.equal(rows.length, 8, `the panel listed ${rows.length} households`);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), PANEL_KEYS,
        `the row for ${shown(row.display_name)} is not the ten columns of :505-522`);
    }
    assert.deepEqual(rows.map((r) => r.display_name), [
      'Brief Link Cousin', 'Never Issued Uncle', 'One Person Aunt', 'Reissued Cousin',
      'The Nair Household', 'The Open List Household', 'The Raman Family', 'Zero Scope Cousin',
    ], 'the panel is not ordered by display_name, which is the order §3.4 and the send response share');

    // The fuse household is deliberately not in this claim: whether it has already blown depends on how
    // long the suite took between H-07 and here, and a case that depends on suite timing is a flake, not
    // a test. L-05 is the case that measures the transition, on purpose, after waiting for it.
    const fuseRow = rows.find((r) => r.household_id === hh('shortfuse'));
    assert.ok(['live', 'expired'].includes(fuseRow.link_state),
      `the fuse household reported ${fuseRow.link_state}`);

    const states = rows.filter((r) => r.household_id !== hh('shortfuse'))
      .map((r) => `${r.display_name}=${r.link_state}`).join(', ');
    assert.equal(states, [
      'Never Issued Uncle=live', 'One Person Aunt=never_issued', 'Reissued Cousin=live',
      'The Nair Household=never_issued', 'The Open List Household=live', 'The Raman Family=live',
      'Zero Scope Cousin=live',
    ].join(', '), 'the link vocabulary moved; §3.4\'s CASE is the only place these four words come from');

    // Counts are the household's own rows: `zeroscope` is invited to nothing and must say so rather than
    // look like it was invited to everything, and `ramam` is scoped to three events although the door
    // will only ever offer it two.
    assert.equal(fuseRow.scoped_event_count, 1);
    const zero = rows.find((r) => r.household_id === hh('zeroscope'));
    assert.equal(zero.scoped_event_count, 0);
    const ramam = rows.find((r) => r.household_id === hh('ramam'));
    assert.equal(ramam.scoped_event_count, 3, 'the panel counted the disabled card as a scope row');
    assert.equal(ramam.reply_count, 0);
    assert.equal(ramam.attending_count, 0);
    assert.equal(ramam.expected_party_size, 4);
    assert.equal(ramam.salutation, 'Mr and Mrs Raman and family');
    const open = rows.find((r) => r.household_id === hh('bigfamily'));
    assert.equal(open.expected_party_size, null, 'an uncapped household was reported as capped');
    assert.equal(open.link_expires_at !== null, true, 'the panel lost the deadline this run set');
    assert.equal(zero.link_expires_at, null);
    // `last_used_at` belongs to the read door alone (`:671-677`), and so far in this run only H-07 has
    // opened a household link. A probe that failed must not move the field, and a household nobody has
    // addressed must not show a time.
    assert.equal(zero.link_last_used_at, null, 'a household nobody opened reported an open');
    assert.equal(fuseRow.link_last_used_at !== null, true,
      'the door H-07 opened did not stamp its own credential');
    assert.equal(ramam.link_last_used_at, null);

    // No credential material, in any spelling, in the whole readout.
    assert.equal(JSON.stringify(rows).match(/[A-Za-z0-9_-]{43}|\b[0-9a-f]{64}\b/g), null,
      'the panel carries a secret or a digest');
    // …and `host_notes` is not among §3.4's ten columns (`:505-522`), so the host's private note about a
    // family reaches neither screen: not the door (D-05 measures that half) and not this readout, which is
    // re-checked over the whole panel at the end of the run in Z-02.
  });

  test('L-02 withdrawing a link kills the address and leaves the family and its answers alone', async () => {
    const old = credOf('ramam');
    const res = await rpc('revoke_guest_invitation', { p_household_id: hh('ramam') }, { as: 'hostA' });
    assert.equal(res.status, 200, `the withdraw was refused: ${shown(JSON.stringify(res.body))}`);
    assert.deepEqual(Object.keys(res.body).sort(), REVOKE_KEYS);
    assert.equal(res.body.household_id, hh('ramam'));
    assert.equal(res.body.revoked, true);
    assert.equal(res.body.credentials_revoked, 1);
    assert.equal(res.body.revoked_at !== null, true, 'a real withdrawal reported no instant');

    const door = await gopen(old);
    assert.deepEqual(door.body, UNAVAILABLE, 'a withdrawn household link still opened the door');
    const row = await panelRow('hostA', hh('ramam'));
    assert.equal(row.link_state, 'revoked');
    assert.equal(tokenFacts(hh('ramam')), 'total=1 live=0 kind=guest_invitation guestid=1 nullver=1');

    // The household itself survives its own link: this is the difference between withdrawing an
    // invitation and deleting a family, and the answer table proves the family is still addressable.
    assert.equal(cell(`select display_name || '/' || coalesce(host_notes, '-')
        from public.guest_households where id = '${hh('ramam')}'::uuid`, 'the household row'),
      'The Raman Family/They prefer a window seat; arriving from Chennai.');

    // A re-send after a withdrawal mints a *different* secret, and the dead address stays dead.
    const again = await sendLinks('hostA', ['ramam']);
    assert.equal(again.body.issued, 1);
    assert.equal(again.body.already_live, 0);
    assert.equal(credOf('ramam') === old, false, 'the re-send handed back the withdrawn secret');
    assert.equal(tokenFacts(hh('ramam')), 'total=2 live=1 kind=guest_invitation guestid=2 nullver=2',
      'the withdrawn row was overwritten instead of kept as history');
    assert.deepEqual((await gopen(old)).body, UNAVAILABLE, 'the withdrawn address came back to life');
    assert.equal((await gopen(credOf('ramam'))).body.available, true,
      'the replacement address does not work');
  });

  test('L-03 withdrawing a household that has no live link reports a no-op in the same shape', async () => {
    const first = await rpc('revoke_guest_invitation', { p_household_id: hh('singles') }, { as: 'hostA' });
    assert.equal(first.status, 200);
    assert.deepEqual(Object.keys(first.body).sort(), REVOKE_KEYS);
    assert.equal(first.body.revoked, false);
    assert.equal(first.body.credentials_revoked, 0);
    // The `CASE WHEN v_count > 0` arm at `:360`: an empty withdrawal must not report an instant at which
    // nothing happened, because the host screen prints this field.
    assert.equal(first.body.revoked_at, null, 'a no-op withdrawal reported a revoked_at');

    const second = await rpc('revoke_guest_invitation', { p_household_id: hh('zeroscope') }, { as: 'hostA' });
    assert.equal(second.body.revoked, true);
    const third = await rpc('revoke_guest_invitation', { p_household_id: hh('zeroscope') }, { as: 'hostA' });
    assert.equal(third.body.revoked, false, 'a second withdraw of one link counted it twice');
    assert.equal(third.body.credentials_revoked, 0);
    assert.equal(tokenFacts(hh('zeroscope')), 'total=1 live=0 kind=guest_invitation guestid=1 nullver=1');
  });

  test('L-04 rotating replaces the secret, keeps the deadline, and leaves the old address dead', async () => {
    const old = credOf('never');
    const res = await rpc('rotate_guest_invitation', { p_household_id: hh('never') }, { as: 'hostA' });
    assert.equal(res.status, 200, `the rotate was refused: ${shown(JSON.stringify(res.body))}`);
    assert.deepEqual(Object.keys(res.body).sort(), ROTATE_KEYS);
    assert.equal(res.body.household_id, hh('never'));
    assert.equal(res.body.publication_id, people.hostA.publicationId);
    assert.match(res.body.path, /^\/g\/[A-Za-z0-9_-]{43}$/);
    const fresh = credFromPath(res.body.path);
    assert.equal(fresh === old, false, 'rotation handed back the same secret');
    assert.equal(res.body.previous_revoked_at !== null, true, 'the report gave no instant of revocation');
    assert.equal(res.body.expires_at, null, 'a no-expiry link was given a deadline by rotation');

    assert.equal(tokenFacts(hh('never')), 'total=2 live=1 kind=guest_invitation guestid=2 nullver=2',
      'rotation did not leave exactly one live credential and one historical one');
    assert.deepEqual((await gopen(old)).body, UNAVAILABLE, 'the rotated-away address still resolves');
    const opened = await gopen(fresh);
    assert.equal(opened.body.available, true, 'the new address does not resolve');
    credentials.never = fresh;

    // The deadline is carried, not re-decided: bigfamily has a three-day fuse this run set.
    // Compared as an epoch in seconds: `expires_at::text` is Postgres' own spelling of a timestamptz and
    // is not something `Date.parse` is promised to read, whereas the verb's JSON and this column are the
    // same instant to the microsecond.
    const before = Number(cell(`select floor(extract(epoch from expires_at))::bigint::text
        from private.access_tokens where household_id = '${hh('bigfamily')}'::uuid
          and revoked_at is null`, 'the big family deadline'));
    const turned = await rpc('rotate_guest_invitation', { p_household_id: hh('bigfamily') }, { as: 'hostA' });
    assert.equal(turned.status, 200, `the rotate of a deadline link failed: ${shown(JSON.stringify(turned.body))}`);
    assert.equal(Math.abs(Math.floor(Date.parse(turned.body.expires_at) / 1000) - before) <= 1, true,
      `rotation moved the deadline the host chose: stored ${before}, reported ${shown(turned.body.expires_at)}`);
    assert.equal(cell(`select expiry_policy from private.access_tokens
        where household_id = '${hh('bigfamily')}'::uuid and revoked_at is null`, 'the carried policy'),
      'fixed', 'the successor row lost the fixed policy');
    credentials.bigfamily = credFromPath(turned.body.path);
  });

  test('L-05 a link that expired while this suite ran is dead at the door and rotatable no longer', async () => {
    // A real wait, for a real transition: H-07 minted this household a two-second fuse, so by the time
    // the sleep is over the deadline has passed without anybody revoking the row.
    const fuse = credOf('shortfuse');
    await new Promise((done) => setTimeout(done, 3000));

    const door = await gopen(fuse);
    assert.deepEqual(door.body, UNAVAILABLE, 'an expired household link still opened the door');
    const answered = await grsvp(fuse, {
      events: [{ event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 1 }],
    });
    assert.deepEqual(answered.body, NOT_RECORDED, 'an expired link recorded an answer');
    const row = await panelRow('hostA', hh('shortfuse'));
    assert.equal(row.link_state, 'expired', 'the panel called an expired link something else');
    assert.equal(row.link_expires_at !== null, true);
    assert.equal(tokenFacts(hh('shortfuse')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
      'a deadline that passed was recorded as a revocation, which are different facts');

    // PREDICTION, and the reason this case exists: §3.3 raises these two refusals with
    // ERRCODE = 'raise_exception' (`:425`, `:443`), and SQLSTATE P0001 has no precedent measurement
    // anywhere in this repository, so the *status* is not claimed here. The code and the sentence are,
    // and the first run at this head has to write the number into its own log line.
    const refused = await rpc('rotate_guest_invitation', { p_household_id: hh('shortfuse') }, { as: 'hostA' });
    assert.equal(refused.status !== 200, true, `an expired link was rotated: ${shown(JSON.stringify(refused.body))}`);
    assert.equal(refused.body.code, 'P0001');
    assert.equal(refused.body.message, SAY.alreadyExpired);
    console.log(`    L-05 measure: raise_exception at a rotate refusal answered HTTP ${refused.status}`);
    assert.equal(tokenFacts(hh('shortfuse')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
      'the refused rotate of an expired link wrote a row anyway');

    // The host's answer to an expired link is the pair the refusal names: withdraw, then send again.
    const withdrawn = await rpc('revoke_guest_invitation', { p_household_id: hh('shortfuse') }, { as: 'hostA' });
    assert.equal(withdrawn.body.revoked, true);
    assert.equal((await panelRow('hostA', hh('shortfuse'))).link_state, 'revoked');
  });

  test('L-06 rotate refuses where there is nothing to rotate, in the two sentences it owns', async () => {
    // No active publication, and the household is genuinely the caller's: §3.3 tests the publication at
    // `:406-413` before it looks for a live row at `:415`, so the caller is told about the wedding.
    const unpub = await rpc('rotate_guest_invitation', { p_household_id: hh('unpub') }, { as: 'hostA' });
    assert.equal(unpub.status, 400, `rotate of the unpublished wedding answered ${unpub.status}`);
    assert.equal(unpub.body.code, '23514');
    assert.equal(unpub.body.message, SAY.noPublication);

    // A household the caller owns, on a published wedding, with no live link — which is what L-03 and
    // L-05 between them produced for `zeroscope` and `shortfuse`.
    const dead = await rpc('rotate_guest_invitation', { p_household_id: hh('zeroscope') }, { as: 'hostA' });
    assert.equal(dead.status !== 200, true, `a withdrawn link was rotated: ${shown(JSON.stringify(dead.body))}`);
    assert.equal(dead.body.code, 'P0001');
    assert.equal(dead.body.message, SAY.noLiveLink);
    console.log(`    L-06 measure: raise_exception at a no-live-link rotate answered HTTP ${dead.status}`);
    assert.equal(tokenFacts(hh('zeroscope')), 'total=1 live=0 kind=guest_invitation guestid=1 nullver=1',
      'the refused rotate minted a successor for a withdrawn link');
  });

  test('L-07 a household keeps its history, and the one-live index is what makes that safe', async () => {
    // `never` has now been minted, rotated away and rotated as a live row; `ramam` was withdrawn and
    // re-sent. Neither lost a row, and each has exactly one live link — which is the guarantee the host
    // screen depends on when it offers "withdraw" and "new link" as different buttons.
    const history = (slug) => tokenCell(hh(slug),
      `coalesce(revoked_at::text,'LIVE')`);
    for (const slug of ['never', 'ramam']) {
      const facts = tokenFacts(hh(slug));
      assert.equal(facts.endsWith('guestid=2 nullver=2'), true, `${slug}: ${shown(facts)}`);
      const lives = history(slug).split(';').filter((v) => v === 'LIVE');
      assert.equal(lives.length, 1, `${slug} has ${lives.length} live credentials: ${shown(history(slug))}`);
    }
    // The index §1 added for this: one unrevoked household credential per household, enforced by the
    // database rather than by the verb that writes it. Read as structure rather than as rendered text,
    // because `indexdef` quotes casts and parenthesises predicates in a way that belongs to the server
    // version; uniqueness, the one indexed column and "this is a partial index" are the three facts the
    // guarantee is actually made of. The battery in `supabase/tests/stage8/80_guest_invitation_links.sql`
    // is where the predicate's own clauses are fired one at a time.
    assert.equal(cell(`select 'uniq='||i.indisunique||' cols='
          || (select string_agg(a.attname, '+' order by k.ord)
                from unnest(i.indkey) with ordinality as k(num, ord)
                join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.num)
          || ' pred='||(i.indpred is not null)
        from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relname = 'one_live_guest_token_per_household'`, 'the one-live index'),
      'uniq=true cols=household_id pred=true',
      'the index that makes two live secrets impossible is not the shape §1 declares');
  });
});

// ---------------------------------------------------------------------------
// D — §4, the read door: what one family sees through its own address, and what it cannot
// ---------------------------------------------------------------------------
// The migration's argument at `:558-561` is that this verb is "the frozen document plus one hand-built
// object about one household", and that the hand-built half is where a careless projection would leak.
// Every case below therefore asks for a *possession*: another household's name, the host's private note
// about this one, a secret, a digest, a count of strangers. The door's own refusal shape is G-05's and
// T-04's, so the group concentrates on the success payload, which nothing else in this repository has
// ever drawn.
describe('S8 THE HOUSEHOLD DOOR', () => {
  test('D-01 an open gives the frozen document and this household\'s card list, in the shapes §4 returns', async () => {
    const res = await gopen(credOf('reissue'));
    assert.equal(res.status, 200, `a live household link did not open: ${shown(JSON.stringify(res.body))}`);
    assert.deepEqual(Object.keys(res.body).sort(), [...DOOR_KEYS].sort());
    assert.equal(res.body.available, true);
    assert.deepEqual(Object.keys(res.body.guest).sort(), [...GUEST_KEYS].sort());
    assert.deepEqual(Object.keys(res.body.invitation).sort(), [...INVITATION_KEYS].sort());

    assert.equal(res.body.guest.household_id, hh('reissue'));
    assert.equal(res.body.guest.display_name, 'Reissued Cousin');
    assert.equal(res.body.guest.greeting, 'Dr and Mrs Reissued',
      'the greeting is not the name when a salutation exists');
    assert.equal(res.body.guest.expected_party_size, 6);
    assert.equal(res.body.guest.version_number, people.hostA.versionNumber);
    assert.equal(res.body.guest.can_respond, true);
    // `no_expiry` is the policy §3.1 writes when the host names no deadline (`…sql:284`), and the door
    // hands the column straight through, so an absent deadline must be absent rather than a date.
    assert.equal(res.body.guest.responds_until, null);

    const cards = res.body.guest.events;
    assert.equal(cards.length, 2, `the card list is ${shown(JSON.stringify(cards))}`);
    for (const card of cards) assert.deepEqual(Object.keys(card).sort(), [...EVENT_KEYS].sort());
    // The order is the document's own (`…sql:660`, repeating `20260927120000...:1138`), so the panel under
    // an invitation cannot disagree with the invitation about the sequence of a wedding.
    assert.deepEqual(cards.map((c) => c.display_name), ['Muhurtham', 'Reception']);
    assert.equal(cards[0].event_id, eventOf('hostA', 'muhurtham'));
    // `starts_at_local` is a `timestamp` with no zone (`20260925120100_stage2_canonical_domain.sql:153`)
    // and §4 renders it with `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS')` (`…sql:653`), so the string the
    // guest reads is the wall clock the host typed — nothing on this path is shift-able by a session
    // timezone, which is why the comparison is a literal rather than an epoch.
    assert.equal(cards[0].starts_at_local, '2027-03-14T09:30:00');
    assert.equal(cards[0].ends_at_local, '2027-03-14T11:30:00');
    assert.equal(cards[1].starts_at_local, '2027-03-14T18:00:00');
    assert.equal(cards[1].ends_at_local, null, 'an open-ended event invented an end time');
    for (const card of cards) assert.equal(card.timezone, 'Asia/Kolkata');
    // Unanswered is a real third state, and it is NULL rather than 'declined' or 0.
    for (const card of cards) {
      assert.equal(card.attending, null);
      assert.equal(card.party_size, null);
      assert.equal(card.responded_at, null);
    }
    // The document half is the wedding's own projection, so the guest page and the public page draw the
    // same invitation from the same bytes (Ruling 5.1).
    assert.equal(res.body.invitation.title, `S8 HTTP hostA ${RUN_TAG}`);
    assert.deepEqual(res.body.invitation.events.map((e) => e.display_name), ['Muhurtham', 'Reception']);
  });

  test('D-02 the greeting is the salutation when there is one worth printing, and the name when there is not', async () => {
    // Two fixtures for the two arms of one expression (`…sql:628`): whitespace that prints nothing, and
    // a NULL. A family greeted as "   " is the defect the `btrim` arm exists to prevent, and a family
    // with no salutation must still be greeted.
    await sendLinks('hostA', ['nosal', 'singles']);
    const whitespace = await gopen(credOf('nosal'));
    assert.equal(whitespace.body.available, true);
    assert.equal(whitespace.body.guest.display_name, 'The Nair Household');
    assert.equal(whitespace.body.guest.greeting, 'The Nair Household',
      'a whitespace-only salutation was greeted verbatim instead of falling back to the name');
    const nullish = await gopen(credOf('singles'));
    assert.equal(nullish.body.guest.greeting, 'One Person Aunt',
      'a NULL salutation was greeted as NULL, which the page would print as a blank line');
    assert.equal(nullish.body.guest.expected_party_size, 1);
    const saluted = await gopen(credOf('ramam'));
    assert.equal(saluted.body.guest.greeting, 'Mr and Mrs Raman and family');
    assert.equal(saluted.body.guest.display_name, 'The Raman Family',
      'the two slots are the same string, so one of them stopped being itself');
  });

  test('D-03 an event the couple took out of the running is not a card, and is not named anywhere in the response', async () => {
    const res = await gopen(credOf('ramam'));
    const cards = res.body.guest.events;
    assert.deepEqual(cards.map((c) => c.display_name), ['Muhurtham', 'Reception']);
    assert.equal(cards.some((c) => c.event_id === eventOf('hostA', 'picnic')), false,
      'a disabled event was offered to a household as something to answer');
    assert.equal(JSON.stringify(res.body.guest).includes(eventOf('hostA', 'picnic')), false,
      'the disabled event\'s id survived in another slot of the household object');
    // The host's scope row still exists, and the panel still counts it: `enabled` takes an event out of
    // the running without deleting the family's invitation to it. That asymmetry is the whole reason
    // §4's join carries `AND e.enabled` (`…sql:664`) while §3.4's subselect counts scope rows plainly
    // (`:516-517`), and it is only visible if both reads are taken.
    assert.equal((await panelRow('hostA', hh('ramam'))).scoped_event_count, 3);
    assert.equal(res.text.includes('Valarsad'), false,
      'the disabled event reached the guest through the frozen document as well');
    // …because the snapshot itself filters `enabled` (`20260927120000...:1142`), so the word is not in the
    // document this run froze. Saying so explicitly is the point: the door is not what hid it.
    assert.equal(res.body.guest.can_respond, true, 'a household with two live cards was told it could not answer');
  });

  test('D-04 a household invited to nothing is invited to nothing, not to everything', async () => {
    // L-03 withdrew this household's first link, so a re-send is needed to see the state through the
    // transport. The re-send is itself the claim: one family can be withdrawn and re-invited without
    // losing its rows.
    const re = await sendLinks('hostA', ['zeroscope']);
    assert.equal(re.body.invitations[0].status, 'issued',
      `the re-send after a withdrawal reported ${shown(JSON.stringify(re.body.invitations))}`);
    assert.equal(tokenFacts(hh('zeroscope')), 'total=2 live=1 kind=guest_invitation guestid=2 nullver=2',
      'a withdrawn credential was replaced rather than kept beside its successor');

    const res = await gopen(credOf('zeroscope'));
    assert.equal(res.status, 200, `the zero-scope door answered ${res.status}`);
    assert.equal(res.body.available, true, 'a household invited to no event could not open its invitation');
    assert.deepEqual(res.body.guest.events, [], 'the empty scope became the whole event list');
    assert.equal(res.body.guest.can_respond, false,
      'a household with no scope rows was offered an answer for every event in the wedding');
    // The document is still whole, because "nobody sent you an event" is a scoping fact, not a broken
    // invitation — Stage 2's rule that a zero-event household is representable and surfaced
    // (`20260925120300...:41-45`), now visible at the transport.
    assert.deepEqual(res.body.invitation.events.map((e) => e.display_name), ['Muhurtham', 'Reception']);
    assert.equal(res.body.guest.expected_party_size, 2);
  });

  test('D-05 one family\'s address gives that family the wedding, and nothing the host wrote about anybody', async () => {
    const res = await gopen(credOf('ramam'));
    assert.equal(res.status, 200);
    // `host_notes` sits on the same row as the greeting (`20260925120300...:26`), which is why §4 hand-builds
    // its household object instead of projecting the row. The note is the needle.
    for (const needle of ['window seat', 'Chennai', 'arriving from', 'host_notes']) {
      assert.equal(res.text.includes(needle), false,
        `the door handed the host's private note ("${needle}") to the family it is about`);
    }
    // Membership itself: no other family of this wedding is named, greeted, or counted.
    for (const other of ['Reissued Cousin', 'Never Issued Uncle', 'Zero Scope Cousin',
      'The Nair Household', 'One Person Aunt', 'Brief Link Cousin', 'The Open List Household',
      'Unpublished Wedding Guest', 'Dr and Mrs Reissued', 'Open List household']) {
      assert.equal(res.text.includes(other), false, `the door named another household (${other})`);
    }
    assert.equal(res.text.includes('A different family with the same greeting.'), false,
      'the door reached across weddings for another host\'s note');
    // No secret and no digest, not even this household's own: the credential arrived by header and must
    // not come back out in a body a browser can cache, a screenshot can capture or a log can keep.
    assert.equal(/[A-Za-z0-9_-]{43}/.test(res.text), false,
      `the door echoed a 43-character string: ${shown(res.text.match(/.{0,40}[A-Za-z0-9_-]{43}.{0,20}/)?.[0])}`);
    assert.equal(/\b[0-9a-f]{64}\b/.test(res.text), false, 'the door carried a sha256 digest');
    // The eight guest keys are the whole of what is derived, so "no count of anyone else" is a property of
    // the shape rather than of this response's values.
    assert.deepEqual(Object.keys(res.body.guest).sort(), [...GUEST_KEYS].sort());
    assert.equal(res.body.guest.expected_party_size, 4, 'the household\'s own ceiling moved, which is a different bug');
  });

  test('D-06 two families with the same name and the same greeting are two households, resolved by id', async () => {
    // Host B's fixture was written to be indistinguishable from host A's `ramam` in prose
    // (`before()`, and `guest-rsvp-security.md` Ruling 5.3), so a leak keyed on a name would look correct
    // in a single-tenant test and wrong in production.
    const mine = await gopen(credOf('ramam'));
    const theirs = await gopen(credOf('foreign'));
    assert.equal(theirs.status, 200, `host B's own live link did not open its own door: ${shown(theirs.text)}`);
    assert.equal(theirs.body.guest.display_name, mine.body.guest.display_name);
    assert.equal(theirs.body.guest.greeting, mine.body.guest.greeting);
    assert.equal(theirs.body.guest.household_id, hh('foreign'));
    assert.equal(mine.body.guest.household_id, hh('ramam'));
    assert.equal(theirs.body.guest.expected_party_size, 3, 'the two households shared a headcount expectation');
    assert.equal(theirs.body.invitation.title, `S8 HTTP hostB ${RUN_TAG}`);
    assert.deepEqual(theirs.body.guest.events.map((c) => c.display_name), ['Sangadham']);

    // Neither wedding's identifiers appear in the other's response — asserted as ids, because the prose
    // fixtures deliberately collide.
    const hostAIds = [eventOf('hostA', 'muhurtham'), eventOf('hostA', 'reception'),
      eventOf('hostA', 'picnic'), weddingOf('hostA'), uidOf('hostA')];
    const hostBIds = [eventOf('hostB', 'sangadham'), eventOf('hostB', 'vadhyam'),
      weddingOf('hostB'), uidOf('hostB')];
    for (const id of hostBIds) assert.equal(mine.text.includes(id), false,
      `the Raman-family door carried host B's identifier ${shown(id)}`);
    for (const id of hostAIds) assert.equal(theirs.text.includes(id), false,
      `host B's door carried host A's identifier ${shown(id)}`);
    // `Vadhyam` is host B's other event, and host B's one household is scoped to `Sangadham` only, so it
    // must not be a card this family can answer — which is a claim about the *household object*, and is
    // measured there. It is not a claim about the whole response: the document above the cards is the
    // couple's published wedding, drawn through the guest's own renderer (Ruling 5.1), and it names every
    // enabled event of that wedding. D-04 pins the same property from the other end — a household with no
    // scope rows at all still reads `['Muhurtham', 'Reception']` in `invitation.events`
    // (`…:1740`) — while D-03 shows the arm that *is* whole-text: an event the couple took out of the
    // running is absent from the frozen document itself, so its name appears nowhere in the response.
    assert.equal(JSON.stringify(theirs.body.guest).includes('Vadhyam'), false,
      'the door listed an event of this wedding that this household was never invited to');
    assert.equal(theirs.body.guest.events.some((c) => c.event_id === eventOf('hostB', 'vadhyam')), false,
      'an unscoped event of this wedding reached this household as a card to answer');
    assert.deepEqual(theirs.body.invitation.events.map((e) => e.display_name), ['Sangadham', 'Vadhyam'],
      'the published document this family was given is no longer the whole wedding');
    assert.equal((await panelRow('hostB', hh('foreign'))).scoped_event_count, 1);
  });

  test('D-07 the door stamps "opened" only for the household that opened it', async () => {
    // `…sql:675-677` writes the column after every successful lookup and before nothing else, and the
    // comment at `:671-674` states why: a host's "has this family read the invitation" must not be
    // movable by somebody probing for live links.
    const stamp = () => liveStamp('bigfamily');
    assert.equal(stamp(), '-', 'a household this file never opened already carries an "opened" stamp');
    for (const cred of ['A'.repeat(43), 'z'.repeat(43), 'not-a-credential', 'x'.repeat(42)]) {
      const probe = await gopen(cred);
      assert.deepEqual(probe.body, UNAVAILABLE, `a probe (${shown(cred.slice(0, 4))}…) opened the door`);
      assert.equal(probe.status, 200);
      assert.equal(stamp(), '-', 'a probe for somebody else\'s live link moved this household\'s stamp');
    }
    assert.equal(cell(`select count(*)::text from public.rsvp_responses
        where household_id = '${hh('bigfamily')}'::uuid`, 'bigfamily\'s replies'), '0',
      'a refused probe wrote an answer');

    const opened = await gopen(credOf('bigfamily'));
    assert.equal(opened.body.available, true);
    const after = stamp();
    assert.equal(after === '-', false, 'a successful open left no stamp at all');
    assert.equal(cell(`select count(*)::text from private.access_tokens
        where household_id = '${hh('bigfamily')}'::uuid and last_used_at is not null`,
      'the stamped rows of bigfamily'), '1', 'one open stamped more than the row it resolved');
    assert.equal((await panelRow('hostA', hh('bigfamily'))).link_last_used_at !== null, true,
      'the stamp is not the fact the panel reports');
  });

  test('D-08 revoked, rotated-away, expired, wrong-kind, malformed and absent answer one indistinguishable body', async () => {
    // Two more dead states, produced on households this file owns so that each is a real row rather than
    // an invented string: a withdrawal and a rotation.
    const nosalLive = credOf('nosal');
    const singlesLive = credOf('singles');
    const withdrawn = await rpc('revoke_guest_invitation', { p_household_id: hh('nosal') }, { as: 'hostA' });
    assert.equal(withdrawn.status, 200, `the withdraw of a live link failed: ${shown(JSON.stringify(withdrawn.body))}`);
    const turned = await rpc('rotate_guest_invitation', { p_household_id: hh('singles') }, { as: 'hostA' });
    assert.equal(turned.status, 200, `the rotate of a live link failed: ${shown(JSON.stringify(turned.body))}`);
    credentials.singles = credFromPath(turned.body.path);

    const bodies = new Set();
    const cases = [
      ['revoked', nosalLive],
      ['rotated away', singlesLive],
      ['expired, then withdrawn', credOf('shortfuse')],
      ['the wedding\'s own kind, at the household door', people.hostA.publicToken],
      ['the wrong length', 'x'.repeat(42)],
      ['the right length with a symbol outside the alphabet', `${'A'.repeat(42)}!`],
      ['an empty header', ''],
    ];
    for (const [what, cred] of cases) {
      const res = await gopen(cred);
      assert.equal(res.status, 200, `${what}: the door answered HTTP ${res.status} instead of the refusal object`);
      assert.deepEqual(res.body, UNAVAILABLE, `${what} still opened the door`);
      bodies.add(res.text);
    }
    const noHeader = await rpc('resolve_guest_invitation', {}, { profile: 'api' });
    assert.deepEqual(noHeader.body, UNAVAILABLE, 'a header-less call opened the door');
    bodies.add(noHeader.text);
    // One set of bytes for seven kinds of failure, which is the claim `:860-862` makes for the write door
    // and `:609-611` for this one. `shown` matters here: the case list carries live-shaped secrets.
    assert.equal(bodies.size, 1, `the read door distinguishes its refusals across ${bodies.size} bodies`);
    // and none of the seven probes left a mark on the one household whose link is still live
    assert.equal(liveStamp('zeroscope') !== '-', true,
      'the earlier open of this household\'s live link was forgotten');
    const before = liveStamp('zeroscope');
    await gopen(nosalLive);
    assert.equal(liveStamp('zeroscope'), before,
      'a dead credential moved a live household\'s stamp');
  });
});

// ---------------------------------------------------------------------------
// R — §5, the write door: the two refusal families, and the one answer per household and event
// ---------------------------------------------------------------------------
// `guest-rsvp-security.md` Ruling 4.1 draws the line this group exists to measure: a problem with the
// *body* is named and actionable and is raised before the credential is read (`:749-838`), and a problem
// with *access* is one indistinguishable `{"recorded":false,"reason":"unavailable"}` (`:840-900`). Between
// them sit two correctable reasons, and the claim at `:720-721` is that no credential state can produce
// either. Everything below is that claim, over the transport, with the store read after each call.
describe('S8 THE HOUSEHOLD ANSWER', () => {
  /** This household's current answer for one event, as one comparable string, or `''` when it has none.
   *  Aggregated so a missing row is one row of SQL NULL rather than a zero-row read, which `cell` would
   *  refuse with its own name. */
  const answerCell = (slug, key) => cell(`
    select coalesce(string_agg(attending || '/' || party_size::text || '/' || response_source
      || '/' || (answers = '{}'::jsonb)::text, ''), '<none>')
      from public.rsvp_responses
     where wedding_id = '${weddingOf('hostA')}'::uuid
       and household_id = '${hh(slug)}'::uuid
       and event_id = '${eventOf('hostA', key)}'::uuid`, `${slug}/${key}'s answer`);

  const answeredOnce = (slug, key) => cell(`select count(*)::text from public.rsvp_responses
      where wedding_id = '${weddingOf('hostA')}'::uuid and household_id = '${hh(slug)}'::uuid
        and event_id = '${eventOf('hostA', key)}'::uuid`, `${slug}/${key}'s row count`);

  const respondedAt = (slug, key) => Number(cell(`select coalesce(floor(extract(epoch from responded_at)
      * 1000)::bigint::text,'-1') from public.rsvp_responses
      where wedding_id = '${weddingOf('hostA')}'::uuid and household_id = '${hh(slug)}'::uuid
        and event_id = '${eventOf('hostA', key)}'::uuid`, `${slug}/${key}'s responded_at`));

  test('R-01 a household answers its own two events in one call, and the row is the guest\'s own', async () => {
    const res = await grsvp(credOf('ramam'), {
      events: [
        { event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 3 },
        { event_id: eventOf('hostA', 'reception'), attending: 'declined', party_size: 0 },
      ],
    });
    assert.equal(res.status, 200, `a live household link could not answer: ${shown(JSON.stringify(res.body))}`);
    assert.deepEqual(Object.keys(res.body).sort(), [...ANSWER_KEYS].sort());
    assert.equal(res.body.recorded, true);
    assert.equal(res.body.household_id, hh('ramam'));
    assert.equal(res.body.events_recorded, 2);
    assert.equal(Number.isNaN(Date.parse(res.body.responded_at)), false,
      `the answer's timestamp is not a moment: ${shown(res.body.responded_at)}`);

    // `attending` with 0 is a contradiction and `declined` with 0 is not, so the two arms of one body are
    // the pair that shows the ceiling and the floor were both honoured in the same statement.
    assert.equal(answerCell('ramam', 'muhurtham'), 'attending/3/guest/true');
    assert.equal(answerCell('ramam', 'reception'), 'declined/0/guest/true');
    // One instant for the whole submission (`v_now` at `:902`, outside the loop): a family that said yes to
    // one thing and no to another said both in the same sitting.
    assert.equal(cell(`select count(distinct responded_at)::text from public.rsvp_responses
        where household_id = '${hh('ramam')}'::uuid`, 'ramam\'s answer instants'), '1',
      'the two rows of one submission carry two different timestamps');

    const row = await panelRow('hostA', hh('ramam'));
    assert.equal(row.reply_count, 2, 'the host panel did not count the household\'s two replies');
    assert.equal(row.attending_count, 1,
      'the panel counted a refusal as attendance, or the reverse (§3.4 counts rows, `…sql:520-522`)');

    // And the household can see its own position when it comes back: "what did we already say" is the
    // guest's fact, which is why §4 left-joins the answers into the cards (`…sql:666-669`).
    const again = await gopen(credOf('ramam'));
    const card = again.body.guest.events.find((c) => c.event_id === eventOf('hostA', 'muhurtham'));
    assert.equal(card.attending, 'attending');
    assert.equal(card.party_size, 3);
    assert.equal(card.responded_at !== null, true);
    const declined = again.body.guest.events.find((c) => c.event_id === eventOf('hostA', 'reception'));
    assert.equal(declined.attending, 'declined');
    assert.equal(declined.party_size, 0);
    // …and the card list still carries no `response_source`, which is the host's bookkeeping about the
    // guest rather than the guest's own fact.
    assert.deepEqual(Object.keys(card).sort(), [...EVENT_KEYS].sort());
  });

  test('R-02 revision overwrites one row, the guest outranks the host\'s note, and the honest correction route stays open', async () => {
    const muhurtham = eventOf('hostA', 'muhurtham');
    // First the host transcribes a phone call, with an answer in Stage 2's optional-question slot.
    const manual = await call('POST', '/rest/v1/rsvp_responses', {
      bearer: tokenOf('hostA'),
      headers: { Prefer: 'return=representation' },
      body: { wedding_id: weddingOf('hostA'), household_id: hh('reissue'), event_id: muhurtham,
        attending: 'attending', party_size: 5, response_source: 'host_manual',
        answers: { meal: 'vegetarian' } },
    });
    assert.equal(manual.status, 201, `a host's manual reply was refused: ${shown(JSON.stringify(manual.body))}`);
    assert.equal(answerCell('reissue', 'muhurtham'), 'attending/5/host_manual/false');

    // Then the family answers for itself, in the opposite direction, through the door.
    const res = await grsvp(credOf('reissue'), {
      events: [{ event_id: muhurtham, attending: 'declined', party_size: 0 }],
    });
    assert.equal(res.status, 200, `the household's own reply failed: ${shown(JSON.stringify(res.body))}`);
    assert.equal(res.body.events_recorded, 1);
    // `ON CONFLICT DO UPDATE` (`…sql:917-922`) over Stage 2's one-answer UNIQUE
    // (`20260925120300...:90-92`): the household's latest position, and not a history of mis-taps.
    assert.equal(answeredOnce('reissue', 'muhurtham'), '1', 'a revision added a second answer row');
    assert.equal(answerCell('reissue', 'muhurtham'), 'declined/0/guest/true',
      'the guest upsert did not take the source, the headcount or the answers slot');

    // What the inherited Stage 2 WITH CHECK (`:285-294` of that file) actually blocks, measured on this
    // stack 2026-10-12 rather than predicted: an edit whose *new row still says* `'guest'`. A PATCH of
    // `party_size` leaves `response_source` untouched, so the new row is a client-written `'guest'` row,
    // which the policy refuses with `42501`. This is the guard that keeps the column meaning something —
    // a host cannot take over the family's own submission and leave it labelled as the family's.
    const headcount = await call('PATCH', `/rest/v1/rsvp_responses?household_id=eq.${hh('reissue')}`
      + `&event_id=eq.${muhurtham}`, { bearer: tokenOf('hostA'), body: { party_size: 2 } });
    assert.equal(headcount.body.code, '42501', `the host edited a guest row: ${shown(headcount.text)}`);
    assert.match(headcount.body.message, /new row violates row-level security policy for table "rsvp_responses"/);
    assert.equal(headcount.status >= 400, true, `a WITH CHECK refusal on a table PATCH answered ${headcount.status}`);
    console.log(`    R-02 measure: an RLS WITH CHECK refusal on a table PATCH answered HTTP ${headcount.status}`);
    assert.equal(answerCell('reissue', 'muhurtham'), 'declined/0/guest/true',
      'a refused headcount edit still changed the row');

    // The other direction is *not* blocked, and this file used to claim it was. Setting
    // `response_source = 'host_manual'` is exactly what that WITH CHECK asks for, so the relabel is
    // accepted: a host can re-attribute the family's own answer as a transcription of a phone call.
    // Recorded as a measurement, not as a pass: the row keeps its content and the guest's `responded_at`
    // under the host's label, which is the state `guest-rsvp-security.md` §7 now states in those words.
    // It is not a forgery in the dangerous direction — no client can write or keep a `'guest'` row, and
    // the same final content is reachable anyway by the delete-and-re-record route below, which the host
    // screen offers in preference to a silent overwrite (`src/components/invitation/GuestRepliesPanel.tsx`,
    // and no product code path PATCHes this table: `src/integrations/supabase/guestInvitations.ts:417-483`).
    const relabel = await call('PATCH', `/rest/v1/rsvp_responses?household_id=eq.${hh('reissue')}`
      + `&event_id=eq.${muhurtham}`, { bearer: tokenOf('hostA'), body: { response_source: 'host_manual' } });
    console.log(`    R-02 measure: a host's guest -> host_manual relabel PATCH answered HTTP ${relabel.status}`);
    assert.equal(relabel.status >= 400, false,
      `the relabel was refused after all, which would make §7's correction wrong: ${shown(relabel.text)}`);
    assert.equal(answerCell('reissue', 'muhurtham'), 'declined/0/host_manual/true',
      'the relabel did not reach the state the policy permits');

    // The honest correction route is still open from that state, which is what the host screen uses.
    const removed = await call('DELETE', `/rest/v1/rsvp_responses?household_id=eq.${hh('reissue')}`
      + `&event_id=eq.${muhurtham}`, { bearer: tokenOf('hostA') });
    assert.equal(removed.status, 204, `the owner's delete of its own reply failed: ${shown(removed.text)}`);
    assert.equal(answeredOnce('reissue', 'muhurtham'), '0');
    const rerecorded = await call('POST', '/rest/v1/rsvp_responses', {
      bearer: tokenOf('hostA'),
      headers: { Prefer: 'return=representation' },
      body: { wedding_id: weddingOf('hostA'), household_id: hh('reissue'), event_id: muhurtham,
        attending: 'declined', party_size: 0, response_source: 'host_manual' },
    });
    assert.equal(rerecorded.status, 201,
      `the honest correction route is closed: ${shown(JSON.stringify(rerecorded.body))}`);
    assert.equal(answerCell('reissue', 'muhurtham'), 'declined/0/host_manual/true');

    // And a client may not write a 'guest' row at all, which is the half that keeps `response_source`
    // meaning something after this stage ships.
    const forged = await call('POST', '/rest/v1/rsvp_responses', {
      bearer: tokenOf('hostA'),
      body: { wedding_id: weddingOf('hostA'), household_id: hh('never'), event_id: muhurtham,
        attending: 'attending', party_size: 2, response_source: 'guest' },
    });
    assert.equal(forged.body.code, '42501', `a host minted a guest reply from the client: ${shown(forged.text)}`);
    assert.equal(answeredOnce('never', 'muhurtham'), '0', 'the refused forgery wrote a row anyway');
  });

  test('R-03 the cap is the host\'s expectation, applied to attendance only, and the refusal writes nothing', async () => {
    // No expectation, therefore no ceiling (`:878-880` requires `v_expected IS NOT NULL`). Four hundred is
    // also inside the shape bound at `:826`, so the two numbers are chosen to be unambiguous at either end.
    const uncapped = await grsvp(credOf('bigfamily'), {
      events: [{ event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 400 }],
    });
    assert.equal(uncapped.status, 200, `an uncapped household was refused: ${shown(uncapped.text)}`);
    assert.equal(uncapped.body.recorded, true);
    assert.equal(answerCell('bigfamily', 'muhurtham'), 'attending/400/guest/true');

    // The ceiling, named in the returned shape so the page can say "up to N" without a second round trip
    // (`:874-876`), and refused before any write — the loop at `:877-883` precedes the loop at `:903`.
    const snapshot = ['muhurtham', 'reception'].map((key) => answerCell('ramam', key));
    const breach = await grsvp(credOf('ramam'), {
      events: [
        { event_id: eventOf('hostA', 'reception'), attending: 'attending', party_size: 4 },
        { event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 5 },
      ],
    });
    assert.equal(breach.status, 200, `a party-size refusal arrived as an exception: ${shown(breach.text)}`);
    assert.deepEqual(breach.body, TOO_LARGE);
    assert.deepEqual(['muhurtham', 'reception'].map((key) => answerCell('ramam', key)), snapshot,
      'the legal row of a body that also breached the cap was written anyway');

    // A declined answer is not a headcount claim, so the cap does not apply to it. Measured rather than
    // assumed, because `:878` is the kind of line a later "simplify it" edit drops.
    const declinedLarge = await grsvp(credOf('never'), {
      events: [{ event_id: eventOf('hostA', 'muhurtham'), attending: 'declined', party_size: 999 }],
    });
    assert.equal(declinedLarge.body.recorded, true,
      `a refusal carrying a large number was capped: ${shown(JSON.stringify(declinedLarge.body))}`);
    assert.equal(answerCell('never', 'muhurtham'), 'declined/999/guest/true');
  });

  test('R-04 a body this invitation cannot record is refused by the shape sentence, with or without a credential', async () => {
    const ev = eventOf('hostA', 'muhurtham');
    const item = { event_id: ev, attending: 'attending', party_size: 1 };
    const cases = [
      ['a NULL p_answers', null],
      ['a JSON array at the top level', []],
      ['a JSON string at the top level', 'yes'],
      ['an empty object', {}],
      ['an answer with no events key', { attending: 'attending' }],
      ['events as a string', { events: 'muhurtham' }],
      ['events as an object', { events: { 0: item } }],
      ['events as an empty array', { events: [] }],
      ['an item that is a string', { events: ['muhurtham'] }],
      ['an item that is an array', { events: [[item]] }],
      ['an item with no keys at all', { events: [{}] }],
      ['an item with a key §5 does not take', { events: [{ ...item, note: 'we will bring snacks' }] }],
      ['an item missing event_id', { events: [{ attending: 'attending', party_size: 1 }] }],
      ['event_id as a number', { events: [{ ...item, event_id: 7 }] }],
      ['event_id as a JSON null', { events: [{ ...item, event_id: null }] }],
      ['event_id as the event\'s own name', { events: [{ ...item, event_id: 'muhurtham' }] }],
      // The 22P02 leak `:797-798` closes: a string of the right shape with a character outside the hex
      // alphabet is refused by the test, not by the cast.
      ['event_id one letter off a uuid', { events: [{ ...item, event_id: '00000000-0000-4000-8000-00000000000g' }] }],
      ['attending missing', { events: [{ event_id: ev, party_size: 1 }] }],
      ['attending as a boolean', { events: [{ ...item, attending: true }] }],
      ['attending as a JSON null', { events: [{ ...item, attending: null }] }],
      ['attending as a word outside the vocabulary', { events: [{ ...item, attending: 'maybe' }] }],
      ['party_size missing', { events: [{ event_id: ev, attending: 'attending' }] }],
      ['party_size as the string "3"', { events: [{ ...item, party_size: '3' }] }],
      ['party_size as a JSON null', { events: [{ ...item, party_size: null }] }],
      // …and the same leak on the number side (`:819-824`): `jsonb_typeof` says 'number' for 1.5.
      ['party_size as a fraction', { events: [{ ...item, party_size: 1.5 }] }],
      ['party_size negative', { events: [{ ...item, party_size: -1 }] }],
      ['party_size past the shape bound', { events: [{ ...item, party_size: 1001 }] }],
      ['attending with no one coming', { events: [{ ...item, attending: 'attending', party_size: 0 }] }],
    ];
    // The store as this sweep finds it, so the closing assertion compares the sweep's own two ends rather
    // than a total this file would have to re-derive from every case that ran before it.
    const storeBefore = cell(`select count(*)::text from public.rsvp_responses
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'host A\'s answers before the shape sweep');
    for (const [label, answers] of cases) {
      const withLink = await grsvp(credOf('ramam'), answers);
      assert.equal(withLink.status, 400, `${label}: the shape refusal arrived as HTTP ${withLink.status}`);
      assert.equal(withLink.body.code, '23514', `${label}: ${shown(withLink.text)}`);
      assert.equal(withLink.body.message, SAY.badShape, `${label} was refused by a different sentence`);
      // The order proof, at the byte level: the body is judged before the credential is read
      // (`:749`), so the same malformed body is refused identically by a caller holding a live link and
      // by one holding nothing. If the two ever differ, one of the two families is leaking the other.
      const noLink = await rpc('submit_guest_rsvp', { p_answers: answers });
      assert.equal(noLink.text, withLink.text, `${label}: the shape refusal changed with the credential`);
      assert.equal(answerCell('ramam', 'muhurtham'), 'attending/3/guest/true',
        `${label} wrote into the answer store on the way out`);
    }
    // Nothing in this table reached an INSERT: twenty-eight refusals, and the store holds exactly what
    // it held when the sweep started.
    assert.equal(cell(`select count(*)::text from public.rsvp_responses
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'host A\'s answers after the shape sweep'),
      storeBefore, 'a body refused for its shape still wrote a row');
  });

  test('R-05 the two sentences §5 owns besides the shape one, in the order it tests them', async () => {
    const ev = eventOf('hostA', 'muhurtham');
    const item = { event_id: ev, attending: 'attending', party_size: 1 };
    // The bound is on the *count* of items and is tested before the loop (`:767`), so a probe cannot make
    // this function do twenty-one rounds of validation work.
    const flood = await grsvp(credOf('ramam'), { events: Array.from({ length: 21 }, () => ({ ...item })) });
    assert.equal(flood.status, 400, `a twenty-one-item body arrived as ${flood.status}`);
    assert.equal(flood.body.code, '23514');
    assert.equal(flood.body.message, SAY.tooManyAnswers);
    const exactly = await grsvp(credOf('ramam'), { events: Array.from({ length: 20 }, () => ({ ...item })) });
    assert.equal(exactly.body.code, '23514', 'a twenty-item body skipped the duplicate test');
    assert.equal(exactly.body.message, SAY.answeredTwice,
      'the bound is 20 inclusive, and the same-event test fires inside the loop');

    const twice = await grsvp(credOf('ramam'), { events: [item, { ...item, party_size: 2 }] });
    assert.equal(twice.status, 400, `a duplicate event inside one body arrived as ${twice.status}`);
    assert.equal(twice.body.code, '23514');
    assert.equal(twice.body.message, SAY.answeredTwice);
    assert.equal(answerCell('ramam', 'muhurtham'), 'attending/3/guest/true',
      'the refused duplicate still revised the row');
    // Both sentences arrive without a credential too, for the same reason R-04 measured.
    for (const [label, answers] of [['a flood', { events: Array.from({ length: 21 }, () => ({ ...item })) }],
      ['a duplicate', { events: [item, item] }]]) {
      const bare = await rpc('submit_guest_rsvp', { p_answers: answers });
      assert.equal(bare.status, 400, `${label} without a link arrived as ${bare.status}`);
      assert.equal(bare.body.message, label === 'a flood' ? SAY.tooManyAnswers : SAY.answeredTwice);
    }
  });

  test('R-06 the correctable reasons belong to a live link, and the answers arm is tested before the unknown-key arm', async () => {
    const ev = eventOf('hostA', 'muhurtham');
    // `answers` is a key §5 tolerates only when it is the empty object (`:779-784`). The two arms are the
    // difference between "the couple is not asking that yet" and "your request is malformed", which the
    // comment at `:776-778` says is worth its own wording.
    const empty = await grsvp(credOf('ramam'), {
      events: [{ event_id: ev, attending: 'attending', party_size: 3, answers: {} }],
    });
    assert.equal(empty.status, 200, `an empty answers object was refused: ${shown(empty.text)}`);
    assert.equal(empty.body.recorded, true, 'the tolerated answers object did not record');
    assert.equal(answerCell('ramam', 'muhurtham'), 'attending/3/guest/true',
      'the accepted answers object wrote something other than the empty object');

    const prose = await grsvp(credOf('ramam'), {
      events: [{ event_id: ev, attending: 'attending', party_size: 3, answers: { meal: 'no onion' } }],
    });
    assert.deepEqual(prose.body, NOT_ASKED, 'a guest put an answer to an unasked question into the host\'s table');
    assert.equal(prose.status, 200, `the correctable refusal arrived as an exception: ${prose.status}`);
    const notObject = await grsvp(credOf('ramam'), {
      events: [{ event_id: ev, attending: 'attending', party_size: 3, answers: 'no onion' }],
    });
    assert.deepEqual(notObject.body, NOT_ASKED, 'a non-object answers slot was reported as junk rather than as an answer');
    // Order inside the loop: the answers test sits at `:779` and the unknown-key test at `:786`, so an item
    // that is both gains the more actionable of the two reasons.
    const both = await grsvp(credOf('ramam'), {
      events: [{ event_id: ev, attending: 'attending', party_size: 3, answers: { meal: 'x' }, extra: 1 }],
    });
    assert.deepEqual(both.body, NOT_ASKED, 'the unknown-key arm was tested first, hiding the actionable reason');

    // Nothing above moved the answer store, because a RETURN inside the validation loop aborts the
    // statement before the write loop begins.
    assert.equal(answerCell('ramam', 'muhurtham'), 'attending/3/guest/true');

    // …and the two correctable reasons divide exactly along that ordering, which is the claim §5's comment
    // at `:749` makes and the one at `:720-721` depends on. `party_size_too_large` is applied *after* the
    // credential resolves (`:877-883`) because the ceiling is a fact about the household the link belongs
    // to, so no dead or absent link can ever report one; `answers_not_accepted` is returned inside the
    // validation loop (`:779-783`), so it is a fact about the body and arrives for a stranger too. That
    // leaks nothing — it is the same sentence for every household of every wedding, and it is the honest
    // wording for a guest trying to answer a question nobody asked.
    for (const [what, cred] of [['a revoked link', credOf('nosal')],
      ['an expired and withdrawn link', credOf('shortfuse')],
      ['the wedding\'s own link, at the household door', people.hostA.publicToken]]) {
      const cap = await grsvp(cred, { events: [{ event_id: ev, attending: 'attending', party_size: 99 }] });
      assert.deepEqual(cap.body, NOT_RECORDED, `${what} reported a party-size ceiling`);
    }
    // The fourth state is a caller that sends no header at all, which cannot be expressed through `grsvp`:
    // an `undefined` header value is transmitted as the literal string "undefined", which is a different
    // probe from sending nothing.
    const bareCap = await rpc('submit_guest_rsvp', { p_answers: {
      events: [{ event_id: ev, attending: 'attending', party_size: 99 }] } });
    assert.deepEqual(bareCap.body, NOT_RECORDED, 'a caller with no credential reported a party-size ceiling');
    const bareAsked = await rpc('submit_guest_rsvp', { p_answers: {
      events: [{ event_id: ev, attending: 'attending', party_size: 1, answers: { meal: 'no onion' } }] } });
    assert.deepEqual(bareAsked.body, NOT_ASKED,
      'the unasked-question reason moved behind the credential, so the same body answers differently to a guest and to a stranger');
    assert.equal(bareAsked.text, prose.text,
      'the unasked-question refusal changes with the credential that carried it');
  });

  test('R-07 the scope row is the whole of the authority, and every out-of-scope event answers like a dead link', async () => {
    const bodies = new Set();
    const cases = [
      // An enabled event of this very wedding that this household was never invited to (`never` is scoped
      // to `muhurtham` only), so the missing arm is `household_event_scopes` at `:890-893`.
      ['an event of this wedding this household is not invited to', credOf('never'),
        eventOf('hostA', 'reception')],
      // Scoped but taken out of the running, which is the second arm at `:894-897` — the one that needs
      // `e.enabled`, since the scope row does exist for `ramam`/`picnic`.
      ['an event the couple took out of the running', credOf('ramam'), eventOf('hostA', 'picnic')],
      // Another wedding's event: the composite FKs make this pair unrepresentable in the store, so the
      // only way to attempt it is through this door.
      ['an event of another wedding', credOf('singles'), eventOf('hostB', 'sangadham')],
      // A well-formed uuid that is nobody's event, which must not be distinguishable from the three above.
      ['an event that does not exist', credOf('singles'), NOT_A_WEDDING],
      // A household invited to nothing, answering the one event the wedding runs.
      ['an answer from a household invited to nothing', credOf('zeroscope'), eventOf('hostA', 'muhurtham')],
    ];
    for (const [what, cred, eventId] of cases) {
      const before = answerCell('ramam', 'muhurtham');
      const res = await grsvp(cred, { events: [{ event_id: eventId, attending: 'attending', party_size: 1 }] });
      assert.equal(res.status, 200, `${what}: the door answered ${res.status} instead of the refusal object`);
      assert.deepEqual(res.body, NOT_RECORDED, `${what} recorded an answer`);
      bodies.add(res.text);
      assert.equal(answerCell('ramam', 'muhurtham'), before, `${what} wrote into somebody else's row`);
    }
    // One indistinguishable body across all five, and identical to the dead-credential bodies R-06 took.
    assert.equal(bodies.size, 1, `the write door distinguishes its access failures across ${bodies.size} bodies`);
    assert.equal(bodies.has(wireNotRecorded()), true,
      'the access refusal is no longer the bytes §5 declares at `:727`');

    // All-or-nothing in the other direction too: a body whose first item is legal and whose second names
    // an unscoped event must leave the household exactly where it was. The scope loop (`:889-900`) is the
    // last thing tested before `v_now`, so a half-answer is not a state this door can produce.
    const neverBefore = answerCell('never', 'muhurtham');
    const mixed = await grsvp(credOf('never'), { events: [
      { event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 1 },
      { event_id: eventOf('hostA', 'reception'), attending: 'declined', party_size: 0 },
    ] });
    assert.deepEqual(mixed.body, NOT_RECORDED);
    assert.equal(answerCell('never', 'muhurtham'), neverBefore,
      'the legal first item of a refused body was written');

    // And the household cannot point itself at another household's answer by naming that household: there
    // is no household argument on this door, which is the whole design, so the id that comes back is the
    // credential's own.
    const own = await grsvp(credOf('singles'), { events: [
      { event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 1 }] });
    assert.equal(own.status, 200, `the household's own event was refused: ${shown(own.text)}`);
    assert.equal(own.body.household_id, hh('singles'));
    assert.equal(answerCell('singles', 'muhurtham'), 'attending/1/guest/true');
    assert.equal(answeredOnce('singles', 'muhurtham'), '1');

    // A second, opposite submission from the same family corrects the first in place, at or after the
    // first instant (`v_now` is the transaction timestamp, so two statements cannot share one).
    const firstAt = respondedAt('singles', 'muhurtham');
    const revised = await grsvp(credOf('singles'), { events: [
      { event_id: eventOf('hostA', 'muhurtham'), attending: 'declined', party_size: 0 }] });
    assert.equal(revised.body.events_recorded, 1);
    assert.equal(answeredOnce('singles', 'muhurtham'), '1', 'a mis-tap became two answers');
    assert.equal(answerCell('singles', 'muhurtham'), 'declined/0/guest/true');
    assert.equal(respondedAt('singles', 'muhurtham') >= firstAt, true,
      'the revision kept the older timestamp, so the host would read the stale answer as the current one');
  });

  test('R-08 the answer never stamps "opened", which is the read door\'s fact alone', async () => {
    // The stamp is taken by this case rather than inherited from somebody else's open, so the claim is
    // measured against a value this case can see held still. `never` is scoped to `muhurtham` and one
    // person is inside its ceiling, so its answer is a legal write; `zeroscope` could not be used here,
    // because a household invited to nothing is refused by R-07's arm.
    const opened = await gopen(credOf('never'));
    assert.equal(opened.body.available, true, `this case's fixture link does not open: ${shown(opened.text)}`);
    const before = liveStamp('never');
    assert.equal(before === '-', false, 'a successful read left no stamp for this case to hold still');

    const ev = eventOf('hostA', 'muhurtham');
    const answered = await grsvp(credOf('never'), {
      events: [{ event_id: ev, attending: 'attending', party_size: 1 }] });
    assert.equal(answered.status === 200 && answered.body.recorded === true, true,
      `the answer this case pays for was refused: ${shown(answered.text)}`);
    assert.equal(liveStamp('never'), before,
      'an answer arrived without a read and moved the host\'s "has this family opened the invitation"');
    // `:927-929` states the reason, and it is the probe-resistance of D-07's claim seen from the other
    // door: a household that answered without opening is a household that got the address from somewhere.
    assert.equal(answerCell('never', 'muhurtham'), 'attending/1/guest/true',
      'the answer this case paid for was not recorded');
  });

  test('R-09 the host reads its own answers, and a stranger reads nothing at all', async () => {
    // The owner's own session, not `call()`'s default bearer: the default is the publishable key, and the
    // anon role holds no table grant on `rsvp_responses` at all, so a read sent without a token answers
    // 401 `permission denied` — which is the *bottom* half of this case, taken deliberately at `anon`
    // below. Measured on this stack 2026-10-12: `has_table_privilege('anon','public.rsvp_responses',
    // 'select')` is false and the SELECT policy is `TO authenticated`.
    const mine = await call('GET', `/rest/v1/rsvp_responses?wedding_id=eq.${weddingOf('hostA')}`
      + '&household_id=eq.' + hh('ramam') + '&select=attending,party_size,response_source,answers',
    { bearer: tokenOf('hostA') });
    assert.equal(mine.status, 200, `the owner could not read its own household's answers: ${shown(mine.text)}`);
    assert.equal(mine.body.length, 2, `the panel's source of truth is ${shown(JSON.stringify(mine.body))}`);
    assert.deepEqual(mine.body.map((r) => r.response_source).sort(), ['guest', 'guest'],
      'the guest rows arrived under some other label, which is the fact the column exists to carry');
    assert.deepEqual(mine.body.map((r) => r.answers), [{}, {}],
      'a guest row carried an answer to a question this invitation never asked');

    // Cross-tenant: the same filter, aimed at another wedding's household, answers the empty list rather
    // than an error or somebody else's rows — the same measured shape as `stage7_family_approval.test.mjs`
    // :609 for that stage's queue.
    const stranger = await call('GET', `/rest/v1/rsvp_responses?household_id=eq.${hh('ramam')}`,
      { bearer: tokenOf('hostB') });
    assert.equal(stranger.status, 200, `a stranger's read answered ${stranger.status}`);
    assert.deepEqual(stranger.body, [], 'host B read host A\'s household\'s answers');
    const anon = await call('GET', `/rest/v1/rsvp_responses?household_id=eq.${hh('ramam')}`);
    assert.equal(anon.status, 401, `an anonymous read answered ${anon.status}`);
    assert.equal(anon.body.code, '42501');
    assert.equal(anon.body.message, 'permission denied for table rsvp_responses');

    // host B's own reply, recorded at T-04 through its own door, is visible to host B and to nobody else.
    const theirs = await call('GET', `/rest/v1/rsvp_responses?wedding_id=eq.${weddingOf('hostB')}`,
      { bearer: tokenOf('hostB') });
    assert.equal(theirs.status, 200);
    assert.equal(theirs.body.length, 1, `host B's answers are ${shown(JSON.stringify(theirs.body))}`);
    assert.equal(theirs.body[0].response_source, 'guest');
    assert.equal(`${theirs.body[0].attending}/${theirs.body[0].party_size}`, 'attending/2');
  });
});

// ---------------------------------------------------------------------------
// N — §6: the two publication verbs, which Stage 8 re-declared so that household links move with them
// ---------------------------------------------------------------------------
// This is the group that tests the *only behavioural change* §6 makes, and it is the reason Stage 8
// touches Stage 3's verbs at all. `guest-rsvp-security.md` Ruling 8.1 states the defect it repairs: a host
// publishing a corrected version used to leave every household credential pinned to the publication it
// revoked, so forty families' saved addresses would answer `available: false` while the wedding's own link
// worked. The repair is a retarget, not a re-mint (`…sql:1034-1048`), and a retarget is exactly the kind
// of fix that can be made wrongly in two opposite directions — too little (the pin is not moved) or too
// much (the secret is moved, or a dead one is revived, or the wedding link's rotator starts reaching
// household secrets). N-01…N-04 measure all four, and every claim is a store read plus the door it has to
// agree with.
//
// The group runs last among the write-behaving cases, because it consumes the publication: after N-04 the
// wedding has no active publication and nothing else in this file can mint or answer.
// ---------------------------------------------------------------------------
describe('S8 PUBLICATION COUPLING', () => {
  const CLOSING = 'Please travel safely; we will keep a seat for you.';
  const WEDDING = () => weddingOf('hostA');
  /** The publication N-01 creates. `null` until it exists, so a case that reads it early fails with a name
   *  instead of silently comparing against `people.hostA.publicationId`'s older value. */
  let current = null;
  let deadlineBefore = null;
  let ramamDeadlineBefore = null;
  let doorDeadlineBefore = null;

  /** Stage 3's wedding door, one header name away from this stage's, reached the same way. */
  const ropen = (cred) => rpc('resolve_public_invitation', {}, {
    headers: { 'x-invitation-token': cred } });

  /** The same two facts for the rows pinned to one publication. §6's whole claim lives in this read: a
   *  retarget moves `publication_id` and nothing else. */
  const pinFacts = (publicationId, kind) => cell(`
    select 'total=' || count(*)::text
      || ' live=' || coalesce(sum(case when revoked_at is null then 1 else 0 end), 0)::text
      from private.access_tokens
     where publication_id = '${publicationId}'::uuid and token_kind = '${kindGuarded(kind)}'`,
    `the ${kind} rows pinned to ${publicationId}`);

  const pubState = (publicationId) => cell(`
    select status || '/' || coalesce(revoked_at::text, '-') from public.publications
     where id = '${publicationId}'::uuid`, `the state of ${publicationId}`);

  const activePublications = (wedding = WEDDING()) => cell(`select count(*)::text from public.publications
      where wedding_id = '${wedding}'::uuid and status = 'active'`, 'the active publications');

  /** The live credential's own deadline and policy, for the one row the partial index guarantees. */
  const liveDeadline = (slug) => cell(`
    select coalesce(expires_at::text, '-') || '/' || expiry_policy from private.access_tokens
     where household_id = '${hh(slug)}'::uuid and token_kind = 'guest_invitation'
       and revoked_at is null`, `${slug}'s live deadline`);

  // Looked up at call time, never snapshotted: a `describe` body runs during collection, while `HH` is
  // filled by the root `before()` that runs after every body has been collected. Measured on this stack
  // 2026-10-12 — an `Object.fromEntries(Object.entries(HH))` taken here saw an empty map and so refused
  // the run on the first live credential it met, naming a household that *was* a fixture.
  const slugOf = (id) => Object.entries(HH).find(([, uuid]) => uuid === id)?.[0];
  /** The households whose link is live *and in date* right now, as fixtures rather than as a hardcoded
   *  list. The liveness test is §4's own (`:605-606`), so a case that opens "every live family" opens the
   *  set the door would agree with, and the set the panel and the store both describe. */
  const liveGuestSlugs = () => sqlRows(`
    select distinct household_id::text from private.access_tokens
     where wedding_id = '${WEDDING()}'::uuid and token_kind = 'guest_invitation'
       and revoked_at is null and (expires_at is null or expires_at > now()) order by 1`)
    .map((id) => {
      const slug = slugOf(id);
      assert.ok(slug, `refusing to run: a live credential belongs to ${id}, which is not a fixture`);
      return slug;
    });

  const repliesFor = (wedding = WEDDING()) => cell(`select count(*)::text from public.rsvp_responses
      where wedding_id = '${wedding}'::uuid`, 'the reply count');
  const householdsFor = (wedding = WEDDING()) => cell(`select count(*)::text from public.guest_households
      where wedding_id = '${wedding}'::uuid`, 'the household count');

  test('N-01 publishing a second version retargets every live household link without re-minting one', async () => {
    // The inventory this run has built, stated as the number rather than assumed. Thirteen household
    // credentials for this wedding: `ramam` 2 (G-03 mint, L-02 withdraw + re-send), `never` 2 (H-01, L-04),
    // `reissue` 1 (H-01), `zeroscope` 2 (H-03, L-03 withdraw + D-04 re-send), `bigfamily` 2 (H-07, L-04),
    // `shortfuse` 1 (H-07, expired then withdrawn in L-05), `nosal` 1 (D-02, withdrawn in D-08),
    // `singles` 2 (D-02, D-08 rotate) — and six of those thirteen unrevoked.
    const before = {
      guestTotal: storeFacts('guest_invitation'),
      guestDigest: storeDigest('guest_invitation'),
      publicTotal: storeFacts('public_invitation'),
      publicDigest: storeDigest('public_invitation'),
      pinnedOld: pinFacts(people.hostA.publicationId, 'guest_invitation'),
      replies: repliesFor(),
      households: householdsFor(),
    };
    assert.equal(before.guestTotal, 'total=13 live=6', `the pre-publish store is ${shown(before.guestTotal)}`);
    assert.equal(before.publicTotal, 'total=1 live=1');
    assert.equal(before.pinnedOld, 'total=13 live=6',
      'a household credential was minted against something other than the live publication');
    assert.equal(before.replies, '6');
    assert.equal(before.households, '8');

    // The deadline, twice, before anything moves: the column's own rendering and the door's. The two are
    // never compared against each other — `expires_at::text` and a jsonb timestamptz are the same instant
    // in two different spellings, and a byte claim across that difference would be about Postgres' format
    // rather than about §6's `COALESCE`.
    deadlineBefore = liveDeadline('bigfamily');
    ramamDeadlineBefore = liveDeadline('ramam');
    const cappedBefore = await gopen(credOf('bigfamily'));
    assert.equal(cappedBefore.body.available, true,
      `the deadline household was already closed at the entry to N: ${shown(cappedBefore.text)}`);
    doorDeadlineBefore = JSON.stringify(cappedBefore.body.guest.responds_until);

    // The frozen document has to change, or "the retarget works" would be measured against a revision
    // nobody could see. Read the draft rather than replace it, so this case adds one sentence and cannot
    // silently drop a key another case wrote.
    const draft = await call('GET', `/rest/v1/invitation_drafts?wedding_id=eq.${WEDDING()}&select=content`,
      { bearer: tokenOf('hostA') });
    assert.equal(draft.status, 200, `the host could not read its own draft: ${shown(draft.text)}`);
    assert.equal(draft.body.length, 1,
      `the wedding draft row the fixture wrote is not there to read, so the revision below would be `
      + `patching nothing: ${shown(draft.text)}`);
    const written = await call('PATCH', `/rest/v1/invitation_drafts?wedding_id=eq.${WEDDING()}`, {
      bearer: tokenOf('hostA'),
      body: { content: { ...draft.body[0].content, closing: CLOSING } },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(written.status, 200, `the revision could not be written: ${shown(written.text)}`);

    const v = await rpc('create_invitation_version', { p_wedding_id: WEDDING() }, { as: 'hostA' });
    assert.equal(v.status, 200, `the second freeze failed: ${shown(v.text)}`);
    assert.equal(v.body.version_number, people.hostA.versionNumber + 1,
      'a second freeze did not advance the version number');
    assert.notEqual(v.body.version_id, people.hostA.versionId, 'the second freeze returned the same version row');

    // The explicit null is the whole point of the call's shape: §6's retarget keeps each household's own
    // deadline only when the argument is NULL (`COALESCE(p_expires_at, expires_at)` and the
    // `expiry_policy` CASE at `…sql:1041-1048`), and an explicit null is the one spelling this repository
    // has measured over the transport (`stage3_publication.test.mjs:593-595`, `:822-824`). H-02 is where
    // the omitted-argument spelling is measured deliberately, instead of being assumed here.
    const p = await rpc('publish_invitation_version',
      { p_wedding_id: WEDDING(), p_version_id: v.body.version_id, p_expires_at: null }, { as: 'hostA' });
    assert.equal(p.status, 200, `the revision could not be published: ${shown(p.text)}`);
    assert.deepEqual(Object.keys(p.body).sort(), PUBLISH_KEYS);
    assert.equal(p.body.link_reused, true,
      'the publish minted a new wedding secret instead of retargeting the live one (`…sql:1022-1029`)');
    assert.equal(p.body.path, null, 'a reused link reported an address, which is the Stage 3 API30 arm');
    // `:1055` returns the *argument*, not the effective deadline. With an explicit null that is JSON null,
    // and a reader who expects the credential's own expiry here would be misled by the verb.
    assert.equal(p.body.expires_at, null, 'the publish reported a deadline it was never given');
    assert.equal(p.body.version_id, v.body.version_id);
    current = p.body.publication_id;
    assert.notEqual(current, people.hostA.publicationId, 'the publish re-used the publication row');

    assert.equal(pubState(people.hostA.publicationId).startsWith('revoked/'), true,
      'the publication the revision replaced is still active');
    assert.equal(pubState(current), 'active/-');
    assert.equal(activePublications(), '1', 'two publications of one wedding are live at once');

    // The claim of the whole stage, in four reads: the secrets did not move, the rows did not multiply,
    // and the pin did.
    assert.equal(storeFacts('guest_invitation'), before.guestTotal,
      'publishing a revision minted or revoked household credentials');
    assert.equal(storeDigest('guest_invitation'), before.guestDigest,
      'publishing a revision changed a household secret — a family saved an address that no longer works');
    assert.equal(pinFacts(people.hostA.publicationId, 'guest_invitation'), 'total=7 live=0',
      'the historical rows followed their publication off the pin, which would rewrite history');
    assert.equal(pinFacts(current, 'guest_invitation'), 'total=6 live=6',
      'a live household credential was left pinned to the revoked publication (§6 repairs exactly this)');
    assert.equal(storeFacts('public_invitation'), before.publicTotal);
    assert.equal(storeDigest('public_invitation'), before.publicDigest,
      'the wedding link was re-minted by a publish that reported a reuse');
    assert.equal(pinFacts(current, 'public_invitation'), 'total=1 live=1');
    assert.equal(pinFacts(people.hostA.publicationId, 'public_invitation'), 'total=0 live=0');

    // A retarget that overwrites the deadline would be a silent expiry change, so the two arms of the
    // `COALESCE` at `:1043` each need a fixture: `bigfamily` carries a real three-day fuse, `ramam` none.
    assert.equal(liveDeadline('bigfamily'), deadlineBefore,
      'publishing with no deadline moved the deadline the host set for this family');
    assert.equal(liveDeadline('ramam'), ramamDeadlineBefore);
    assert.equal(liveDeadline('ramam'), '-/no_expiry');

    // The revision is a content change, not a data wipe: no answer and no family went with the old
    // publication.
    assert.equal(repliesFor(), before.replies, 'publishing a revision deleted RSVP answers');
    assert.equal(householdsFor(), before.households, 'publishing a revision deleted households');

    people.hostA.versionId = v.body.version_id;
    people.hostA.versionNumber = v.body.version_number;
    people.hostA.publicationId = current;
  });

  test('N-02 every family that was retargeted reads the new version through the address it already had', async () => {
    const slugs = liveGuestSlugs();
    assert.equal(slugs.length, 6, `the live set is ${shown(JSON.stringify(slugs))}`);
    for (const slug of slugs) {
      const res = await gopen(credOf(slug));
      assert.equal(res.status, 200, `${slug}'s saved address stopped working at a publish`);
      assert.equal(res.body.available, true, `${slug}: the retargeted credential does not resolve`);
      assert.deepEqual(Object.keys(res.body).sort(), [...DOOR_KEYS].sort());
      assert.deepEqual(Object.keys(res.body.guest).sort(), [...GUEST_KEYS].sort());
      // The version number comes from the publication the credential is pinned to (`…sql:597-617`), which
      // is what makes this an end-to-end read of §6's UPDATE rather than a read of the publications row.
      assert.equal(res.body.guest.version_number, people.hostA.versionNumber,
        `${slug} is still being shown version ${res.body.guest.version_number}`);
      assert.equal(res.body.guest.invitation === undefined, true,
        'the household object grew an invitation slot, which is where a projection would leak');
      assert.equal(res.body.invitation.closing, CLOSING, `${slug} opened the old document`);
    }

    // The deadline the family was given is still the deadline it is told about, at the door as well as in
    // the column: `responds_until` is the credential's own `expires_at` (`…sql:693`), not the publication's.
    const capped = await gopen(credOf('bigfamily'));
    assert.equal(JSON.stringify(capped.body.guest.responds_until), doorDeadlineBefore,
      `the door reported ${shown(capped.body.guest.responds_until)} after the publish, against ${shown(doorDeadlineBefore)} before it`);
    const uncapped = await gopen(credOf('ramam'));
    assert.equal(uncapped.body.guest.responds_until, null,
      'a family with no deadline was given one by the revision');

    // An answer is a fact about the household, not about a version, so a revision must not clear it — and
    // the guest sees the host's transcription too, which is why R-02's delete-and-re-record route matters.
    const ramamCard = uncapped.body.guest.events
      .find((c) => c.event_id === eventOf('hostA', 'muhurtham'));
    assert.equal(`${ramamCard.attending}/${ramamCard.party_size}`, 'attending/3',
      'the revision wiped the family\'s own answer out of its card');
    const reissue = await gopen(credOf('reissue'));
    const reissueCard = reissue.body.guest.events
      .find((c) => c.event_id === eventOf('hostA', 'muhurtham'));
    assert.equal(`${reissueCard.attending}/${reissueCard.party_size}`, 'declined/0');

    // The wedding's own address follows the same publication, so both doors now draw one document: a
    // guest page and a household page that disagree about the couple's closing line would be the defect.
    const wedding = await ropen(people.hostA.publicToken);
    assert.equal(wedding.status, 200);
    assert.equal(wedding.body.available, true, 'the reused wedding link died at a publish');
    assert.equal(wedding.body.invitation.closing, CLOSING,
      'the two doors disagree about the published content, so one of them is not reading the active publication');

    // And the opposite direction, which is the half that a broadened UPDATE could easily have broken: the
    // retarget's `revoked_at IS NULL` (`…sql:1048`) is what keeps a withdrawn family out of it. A row that
    // had been retargeted would resolve again, because its pin now names an active publication.
    const withdrawn = await gopen(credOf('nosal'));
    assert.deepEqual(withdrawn.body, UNAVAILABLE,
      'publishing a revision resurrected a link the host had withdrawn');
    const stillDead = await grsvp(credOf('nosal'), {
      events: [{ event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 1 }],
    });
    assert.deepEqual(stillDead.body, NOT_RECORDED, 'the resurrected link could answer again');
  });

  test('N-03 rotating the wedding link leaves every household secret exactly where it was', async () => {
    // Stage 8 re-declared publish and takedown but not the rotator, and §6's comment at `:1039-1040` says
    // the reason: `api.rotate_invitation_token` keeps Stage 3's `token_kind = 'public_invitation'` filter
    // (`20260926150000_stage3_privileged_bodies_behind_wrappers.sql:393-396`). If that filter were widened
    // the way §6 widened the other two, a host clicking "new link" for the wedding would start revoking
    // forty families' addresses. This case is the guard against a future edit that makes them "consistent".
    const guestBefore = { total: storeFacts('guest_invitation'), digest: storeDigest('guest_invitation') };
    const pinned = pinFacts(current, 'guest_invitation');
    const publicDigest = storeDigest('public_invitation');

    const res = await rpc('rotate_invitation_token', { p_wedding_id: WEDDING() }, { as: 'hostA' });
    assert.equal(res.status, 200, `the wedding rotate failed: ${shown(res.text)}`);
    assert.deepEqual(Object.keys(res.body).sort(), ROTATE_WEDDING_KEYS);
    assert.equal(res.body.publication_id, current,
      'the successor link was pinned to the publication the revision replaced');
    assert.equal(res.body.version_id, people.hostA.versionId);
    // The wedding row is `no_expiry`, and Stage 3's return reports the deadline only for a `fixed` policy
    // (`:417`), so this null is the two stages reading each other's vocabulary correctly.
    assert.equal(res.body.expires_at, null, 'a no-deadline wedding link was rotated into a deadline');
    assert.equal(res.body.previous_revoked_at !== null, true);
    const fresh = credFromPublicPath(res.body.path);
    assert.equal(fresh === people.hostA.publicToken, false, 'rotation handed back the same wedding secret');

    assert.equal(storeFacts('guest_invitation'), guestBefore.total,
      'rotating the wedding link revoked or minted household credentials');
    assert.equal(storeDigest('guest_invitation'), guestBefore.digest,
      'rotating the wedding link changed a family\'s secret');
    assert.equal(pinFacts(current, 'guest_invitation'), pinned);
    assert.equal(storeFacts('public_invitation'), 'total=2 live=1');
    assert.equal(storeDigest('public_invitation') === publicDigest, false,
      'the wedding kind was not rotated either');

    assert.deepEqual((await ropen(people.hostA.publicToken)).body, UNAVAILABLE,
      'the retired wedding address still resolves');
    const opened = await ropen(fresh);
    assert.equal(opened.body.available, true);
    assert.equal(opened.body.invitation.closing, CLOSING,
      'the rotated wedding link reads a different document from the households\'');
    const family = await gopen(credOf('ramam'));
    assert.equal(family.body.available, true, 'a family lost its address when the wedding link was rotated');

    people.hostA.publicToken = fresh;
  });

  test('N-04 taking the publication down withdraws every family at once, and deletes nothing', async () => {
    // §6's takedown widening is a tightening (`…sql:1083-1090`): revoking the content has to reach both
    // kinds, and `tokens_revoked` has to count them honestly. Two independent mechanisms enforce it — the
    // bulk UPDATE and §4's `p.status = 'active'` join — so the doors would answer correctly even if the
    // UPDATE had not run, which is exactly why this case reads the store as well as the doors.
    const slugs = liveGuestSlugs();
    const repliesBefore = repliesFor();
    const householdsBefore = householdsFor();
    const liveBoth = Number(cell(`select count(*)::text from private.access_tokens
        where wedding_id = '${WEDDING()}'::uuid
          and token_kind in ('public_invitation', 'guest_invitation')
          and revoked_at is null`, 'the live credentials of both kinds'));
    assert.equal(liveBoth, 7, `the pre-takedown live set is ${liveBoth}`);

    const res = await rpc('revoke_invitation_publication', { p_wedding_id: WEDDING() }, { as: 'hostA' });
    assert.equal(res.status, 200, `the takedown failed: ${shown(res.text)}`);
    assert.deepEqual(Object.keys(res.body).sort(), TAKEDOWN_KEYS);
    assert.equal(res.body.revoked, true);
    assert.equal(res.body.publication_id, current);
    assert.equal(res.body.tokens_revoked, liveBoth,
      'the takedown counted a different set of credentials than the two kinds it widens to');

    assert.equal(storeFacts('guest_invitation'), 'total=13 live=0');
    assert.equal(storeFacts('public_invitation'), 'total=2 live=0');
    assert.equal(pubState(current).startsWith('revoked/'), true);
    assert.equal(activePublications(), '0');

    // Each door gives every family the same one object, with no per-household and no per-kind wording
    // left in it — and the two doors' objects are the two facts §5 and §4 declare, not a takedown's own
    // vocabulary that would tell a caller the wedding was withdrawn rather than that the link is closed.
    const readBodies = new Set();
    const writeBodies = new Set();
    for (const slug of slugs) {
      const open = await gopen(credOf(slug));
      assert.deepEqual(open.body, UNAVAILABLE, `${slug} still opens its invitation after a takedown`);
      readBodies.add(open.text);
      const answered = await grsvp(credOf(slug), {
        events: [{ event_id: eventOf('hostA', 'muhurtham'), attending: 'attending', party_size: 1 }],
      });
      assert.deepEqual(answered.body, NOT_RECORDED, `${slug} answered after the content was withdrawn`);
      writeBodies.add(answered.text);
    }
    assert.equal(readBodies.size, 1, 'the read door distinguishes which family asked after a takedown');
    assert.equal(writeBodies.size, 1, 'the write door distinguishes which family asked after a takedown');
    assert.equal(readBodies.has(wireUnavailable()), true,
      'the read door\'s takedown body is not the bytes §4 declares');
    assert.equal(writeBodies.has(wireNotRecorded()), true,
      'the write door\'s takedown body is not the bytes §5 declares at `:727`');
    assert.deepEqual((await ropen(people.hostA.publicToken)).body, UNAVAILABLE,
      'the wedding link outlived the publication it belongs to');

    // Minimisation is not destruction. The host's own record of what its families said stays, because the
    // takedown withdraws the *document*; a host who then republishes is not starting from an empty room,
    // and a family's answer is not something a stranger's click can delete.
    assert.equal(repliesFor(), repliesBefore, 'the takedown deleted RSVP answers');
    assert.equal(householdsFor(), householdsBefore, 'the takedown deleted households');

    const rows = await panelFor('hostA', WEDDING());
    assert.equal(rows.length, 8);
    assert.deepEqual([...new Set(rows.map((r) => r.link_state))], ['revoked'],
      'the panel still offers a link that the takedown withdrew');
    assert.equal(rows.reduce((n, r) => n + r.reply_count, 0), Number(repliesBefore),
      'the panel forgot the answers that the takedown was careful not to delete');

    // The consequence of §3.1's publication arm (`:224`) reached through the transport: after a takedown
    // this host cannot send links at all, so "withdraw the invitation" is one operation, not a race
    // between a revoked publication and a freshly minted secret.
    const refused = await sendLinks('hostA', ['ramam'], { expectStatus: 400 });
    assert.equal(refused.body.code, '23514');
    assert.equal(refused.body.message, SAY.unpublished);
    assert.equal(storeFacts('guest_invitation'), 'total=13 live=0',
      'the refused send minted a credential under a dead publication');
  });
});

// ---------------------------------------------------------------------------
// Z — the residue this run is allowed to leave, stated as facts rather than as a leak census
// ---------------------------------------------------------------------------
// `run.sh` compares row counts before and after the whole suite, and this file's own `after()` deletes
// everything it made. Neither of those two instruments can see the two claims that actually matter here:
// that the store holds only secrets this run was handed (not a second, unreported one beside each), and
// that nothing this stage touched reached a kind, a table or another tenant's rows. Z-01…Z-03 read the
// final state directly, which is also the only way to check claims that span every group above.
// ---------------------------------------------------------------------------
describe('S8 RESIDUE', () => {
  // A function and not a const: a describe body runs at registration time, before `before()` has put any
  // wedding id in `people`, so a const here would interpolate three `undefined`s.
  const weddingsOfRun = () => [weddingOf('hostA'), weddingOf('hostB'), people.hostA.weddingU]
    .map((w) => `'${w}'::uuid`).join(',');

  test('Z-01 every credential row this run owns is one this run was handed, and none is an approval secret', async () => {
    const digests = [...heldSecrets].map((s) => {
      assert.match(s, CRED, 'the held inventory contains something that is not a credential');
      return createHash('sha256').update(s, 'utf8').digest('hex');
    });
    assert.equal(new Set(digests).size, heldSecrets.size, 'two secrets digested alike');
    for (const d of digests) assert.match(d, /^[0-9a-f]{64}$/);
    const list = digests.map((d) => `'${d}'`).join(', ');

    // The store, restricted to this run's three weddings, holds exactly the digests of what the verbs
    // returned. A row outside that set would be a secret minted and never handed to anybody — which is
    // what a `SECURITY DEFINER` body that generated and dropped, or minted twice, would leave behind, and
    // `token_hash UNIQUE` cannot see it.
    const unaccounted = cell(`select count(*)::text from private.access_tokens
        where wedding_id in (${weddingsOfRun()})
          and not (token_hash = any (array[${list}]::text[]))`, 'the unaccounted digests');
    assert.equal(unaccounted, '0',
      'the credential store holds a secret this run was never handed');

    // Read back as rows-to-secrets rather than secrets-to-rows: a credential handed twice (a re-send that
    // echoed a live link, or a rotate that minted without revoking) would pass the assertion above and be
    // a real defect, so the two counts have to agree with the inventory's own size.
    const totals = cell(`select count(*)::text || '/' || count(distinct token_hash)::text
        from private.access_tokens where wedding_id in (${weddingsOfRun()})`, 'the accounted rows');
    assert.equal(totals, `${heldSecrets.size}/${heldSecrets.size}`,
      `the store holds ${shown(totals)} rows and digests for ${heldSecrets.size} handed secrets`);

    // Only the two browser-facing kinds exist, which is the separation the directive requires in storage
    // rather than in prose: this run never had a family-approval credential minted, and nothing it minted
    // borrowed one's columns.
    assert.equal(cell(`select coalesce(string_agg(distinct token_kind, '+' order by token_kind), '-')
        from private.access_tokens where wedding_id in (${weddingsOfRun()})`, 'the kinds'),
      'guest_invitation+public_invitation',
      'this run wrote a credential of a kind outside the wedding link and the household link');

    assert.equal(cell(`select count(*)::text from private.access_tokens
        where wedding_id in (${weddingsOfRun()})
          and ((token_kind = 'guest_invitation'
                  and (household_id is null or publication_id is null
                       or approval_request_id is not null or approval_version_id is not null))
             or (token_kind = 'public_invitation' and household_id is not null))`,
      'the malformed kinds'), '0',
      'a household credential was stored without its household, with an approval column filled, or a '
      + 'wedding credential was stored pointing at a household');

    // No raw secret anywhere: the column may only hold a sha256 digest, which is the one property of the
    // store that `shown()` cannot vouch for, because masking governs what this file prints and not what the
    // database holds.
    assert.equal(cell(`select count(*)::text from private.access_tokens
        where wedding_id in (${weddingsOfRun()})
          and token_hash !~ '^[0-9a-f]{64}$'`, 'the non-digest rows'), '0',
      'the store holds something in a credential column that is not a sha256 digest');
  });

  test('Z-02 the answer store is one row per household and event, holds no answer text, and agrees with the panel', async () => {
    const scoped = cell(`
      select count(*)::text || '/' ||
             count(distinct (wedding_id, household_id, event_id))::text
        from public.rsvp_responses where wedding_id in (${weddingsOfRun()})`, 'the reply uniqueness');
    const [rows, keys] = scoped.split('/');
    assert.equal(rows, keys, 'a household answered the same event twice');
    assert.equal(Number(rows) > 0, true, 'the whole run recorded no answer, so the assertion above is about nothing');

    // Stage 8's write door always upserts `answers = '{}'::jsonb` (`…sql:917-922`), and the only
    // answer-bearing row this run ever had was the manual one R-02 deleted and re-recorded. So an
    // unasked-question object surviving anywhere in the table would be a projection the migration does not
    // contain.
    assert.equal(cell(`select count(*)::text from public.rsvp_responses
        where wedding_id in (${weddingsOfRun()}) and answers <> '{}'::jsonb`, 'the answer-bearing rows'), '0',
      'a guest reached a question this invitation does not ask, through a door that cannot ask it');

    // Every reply has the scope row behind it, which is the fact R-07's refusals depend on: the door
    // cannot be the only thing enforcing scope, because the table is writable by an owner.
    assert.equal(cell(`select count(*)::text from public.rsvp_responses r
        where r.wedding_id in (${weddingsOfRun()})
          and not exists (select 1 from public.household_event_scopes s
                           where s.wedding_id = r.wedding_id
                             and s.household_id = r.household_id
                             and s.event_id = r.event_id)`, 'the unscoped replies'), '0',
      'a reply exists for a household and event nobody paired');

    // `response_source` is deliberately NOT claimed uniform: R-02 legitimately leaves one `host_manual`
    // row (the family's answer, withdrawn and re-recorded by the host through the only honest route §5
    // allows), and a claim that every row is 'guest' would fail a correct store.
    assert.equal(cell(`select coalesce(string_agg(distinct response_source, '+' order by response_source), '-')
        from public.rsvp_responses where wedding_id in (${weddingsOfRun()})`, 'the sources'),
      'guest+host_manual', 'the two writers of the reply table changed their labels');

    // The panel's two counters, re-derived from the table after every group has run, and compared
    // household by household rather than by total: two wrong households cancelling out is the shape a
    // sum hides.
    const counts = new Map(sqlRows(`
      select household_id || '/' || count(*)::text || '/'
             || sum(case when attending = 'attending' then 1 else 0 end)::text
        from public.rsvp_responses where wedding_id = '${weddingOf('hostA')}'::uuid
       group by household_id`).map((line) => {
      const [id, reply, attending] = line.split('/');
      return [id, `${reply}/${attending}`];
    }));
    for (const row of await panelFor('hostA', weddingOf('hostA'))) {
      assert.equal(`${row.reply_count}/${row.attending_count}`, counts.get(row.household_id) ?? '0/0',
        `the panel disagrees with the table about ${shown(row.display_name)}`);
    }

    // The privacy needles, over the whole readout rather than one row, at the end of the run when every
    // state exists: a note, a stranger's name, a secret, a digest.
    const finalPanel = JSON.stringify(await panelFor('hostA', weddingOf('hostA')));
    for (const needle of ['window seat', 'arriving from', 'host_notes', 'A different family',
      'Valarsad', 'Chennai']) {
      assert.equal(finalPanel.includes(needle), false, `the panel carries ${needle}`);
    }
    assert.equal(finalPanel.match(/[A-Za-z0-9_-]{43}|\b[0-9a-f]{64}\b/g), null,
      'the final panel carries credential material');
    // `answers` is the only free-text slot the reply table has, so it is the only place a secret or a
    // stranger's name could hide there. The count above makes the scan nearly vacuous, and it is kept
    // anyway: it is the difference between "this build writes empty objects" and "nothing in this table
    // could be a credential", and only the second one is a privacy claim.
    const answers = cell(`select coalesce(string_agg(answers::text, ' '), '<none>')
        from public.rsvp_responses where wedding_id in (${weddingsOfRun()})`, 'the answer payloads');
    assert.equal(answers.match(/[A-Za-z0-9_-]{43}|\b[0-9a-f]{64}\b/g), null,
      `an answer row holds credential-shaped material: ${shown(answers.slice(0, 120))}`);
  });

  test('Z-03 the other wedding in this run is untouched by everything the first one did', async () => {
    // Cross-tenant residue, measured at the end instead of asserted at the start. N-01…N-04 published,
    // rotated and took down host A's wedding; host B's one household still has its original live secret,
    // its original document and its own answer, and the never-published wedding still has nothing.
    assert.equal(tokenFacts(hh('foreign')), 'total=1 live=1 kind=guest_invitation guestid=1 nullver=1',
      'host A\'s publication work moved, minted or revoked a credential on host B\'s wedding');
    assert.equal(storeFacts('public_invitation', weddingOf('hostB')), 'total=1 live=1');
    assert.equal(cell(`select count(*)::text from public.publications
        where wedding_id = '${weddingOf('hostB')}'::uuid and status = 'active'`,
      'host B\'s active publication'), '1');

    const door = await gopen(credOf('foreign'));
    assert.equal(door.body.available, true, 'host B\'s family lost its address to host A\'s takedown');
    assert.equal(door.body.guest.version_number, people.hostB.versionNumber,
      'host B\'s family is reading host A\'s revision');
    assert.equal(door.body.guest.display_name, 'The Raman Family');
    assert.equal(door.body.invitation.closing, null,
      'host A\'s closing line was written into host B\'s invitation');
    assert.equal(door.body.invitation.title, `S8 HTTP hostB ${RUN_TAG}`);

    const panel = await panelRow('hostB', hh('foreign'));
    assert.equal(panel.link_state, 'live');
    assert.equal(`${panel.reply_count}/${panel.attending_count}`, '1/1',
      'host B lost the answer T-04 recorded through its own door');
    assert.equal(replyCount(hh('foreign')), '1');

    assert.equal(tokenFacts(hh('unpub')), 'total=0 live=0 kind=- guestid=0 nullver=0',
      'the never-published wedding was minted a credential after all');
    assert.equal(cell(`select count(*)::text from public.publications
        where wedding_id = '${people.hostA.weddingU}'::uuid`, 'the never-published wedding\'s publications'), '0');
    assert.equal(cell(`select count(*)::text from public.rsvp_responses
        where wedding_id = '${people.hostA.weddingU}'::uuid`, 'its answers'), '0');
    assert.equal(cell(`select count(*)::text from public.guest_households
        where wedding_id = '${people.hostA.weddingU}'::uuid`, 'its households'), '1');
  });
});
