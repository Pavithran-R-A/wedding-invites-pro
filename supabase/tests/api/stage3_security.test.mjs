// Stage 3 §5 — API-level security qualification against the real local Supabase stack.
//
// Why this file exists at all: every Stage 2 refusal was executed inside psql with
// `SET ROLE`, which proves grants, policies and triggers, but it never had PostgREST
// translating an HTTP request into a role, never had GoTrue issuing a JWT, and never
// had `auth.uid()` read a real claim. Stage 2 said so itself (its §25 limitation 1).
// This closes that gap by driving the same schema through `@supabase/supabase-js`
// against a stack running on this machine.
//
// It is deliberately NOT part of `npm test`: the vitest suite must stay runnable in
// CI, where no Postgres is listening. Run it with `bash supabase/tests/api/run.sh`.
//
// Safety interlock, in code rather than in a comment: the base URL must be a loopback
// host. A hosted project's URL cannot reach this file even by a mistaken environment
// file, because the very first thing it does is refuse.
//
// Every refusal below is paired either with the legal version of the same write
// performed by the row's own owner, or with the same write succeeding on the trusted
// path. A refusal that would fail anyway — because a required column was left out, or
// because the table is not addressable at all — is not evidence, so the control half is
// what makes the refusal half mean something.
//
// The error codes asserted here are *measured*, from a probe run against this stack
// (PostgREST v16.3, GoTrue v2.197.0, PostgreSQL 17.6):
//   RLS WITH CHECK failure ......... 42501 "new row violates row-level security policy"
//   missing table privilege ........ 42501 "permission denied for table"
//   CHECK constraint ............... 23514 "violates check constraint"
//   unique index ................... 23505
//   relation not in the exposed
//   schema ........................ PGRST205 "Could not find the table 'public.x'"
//   malformed uuid in a filter ..... 22P02 (typed rejection, not a crash)
// Note that a *policy* WITH CHECK refusal and a *grant* refusal both surface as 42501
// and are distinguished only by their message; both halves are asserted below, because
// which layer refused is itself part of the finding.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const RUN_TAG = `stage3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function localEnv() {
  // The gitignored `.env.local` is the only file this suite reads for configuration,
  // and it is written to point at the local stack. `.env` (which still carries the
  // historical hosted project's defaults) is never read.
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

const env = localEnv();
const url = env.SUPABASE_LOCAL_URL;
const anonKey = env.SUPABASE_LOCAL_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

if (!url) throw new Error('SUPABASE_LOCAL_URL is missing from .env.local');
const targetHost = new URL(url).hostname;
if (!LOOPBACK.has(targetHost)) {
  throw new Error(`refusing to run: ${url} is not a loopback Supabase target`);
}
if (!anonKey || !serviceKey) throw new Error('local keys are missing from .env.local');

// Synthetic identities only: `example.test` is reserved for documentation, so no
// address here can belong to anyone, and the password is random per run and never
// reused for any other purpose.
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}-${RUN_TAG}`;

const RESERVED_UUID = '00000000-0000-0000-0000-000000000000';

const authed = {};

const admin = () =>
  createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

async function signUp(who) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  // Email confirmations are switched off for this local stack (supabase/config.toml),
  // so a signup returns a usable session rather than a "check your inbox" half-state.
  assert.ok(data.session, 'expected a session immediately');
  assert.ok(data.user, 'expected a user');
  // `persistSession: false` clients keep no reliable session for `getSession()`, but the
  // signup response itself carries the token GoTrue just issued, which is what the
  // tampering test below needs.
  return { client, userId: data.user.id, accessToken: data.session.access_token };
}

// The complete-row builders. §22's rule — a refusal is only evidence if the same row
// is legal for the right actor — needs every NOT NULL column filled by the happy path
// first, so fixtures are written through the API by their owner, not by a trusted role.
async function createWedding(who, title, language) {
  const { data, error } = await authed[who].client
    .from('weddings')
    .insert({ owner_user_id: authed[who].userId, title, primary_language: language })
    .select()
    .single();
  assert.equal(error, null, `${who} could not create its own wedding: ${error?.message}`);
  return data;
}

async function adoptWedding(who, title, language) {
  const row = await createWedding(who, title, language);
  authed[who].wedding = row;
  return row;
}

before(async () => {
  authed.hostA = await signUp('host-a');
  authed.hostB = await signUp('host-b');
  await adoptWedding('hostA', 'Asha weds Bala', 'en');
  await adoptWedding('hostB', 'Bala weds Divya', 'ta');

  // A venue and an event on host A's wedding, so the cross-account mutation tests have
  // real child rows to reach for, and a person row.
  const { data: venue, error: ve } = await authed.hostA.client
    .from('venues')
    .insert({ wedding_id: authed.hostA.wedding.id, name: 'Kalyana Mantapa', address_text: 'Madurai' })
    .select('id')
    .single();
  assert.equal(ve, null, 'the control venue could not be written');
  authed.hostA.venue = venue;

  const { data: event, error: ee } = await authed.hostA.client
    .from('wedding_events')
    .insert({
      wedding_id: authed.hostA.wedding.id,
      event_key: 'muurtham',
      display_name: 'Muurtham',
      starts_at_local: '2026-11-14T07:30:00',
    })
    .select('id')
    .single();
  assert.equal(ee, null, 'the control event could not be written');
  authed.hostA.event = event;

  const { data: person, error: pe } = await authed.hostA.client
    .from('wedding_people')
    .insert({ wedding_id: authed.hostA.wedding.id, display_name: 'Maran', role_key: 'father' })
    .select('id')
    .single();
  assert.equal(pe, null, 'the control person could not be written');
  authed.hostA.person = person;

  const { data: version, error: verErr } = await admin()
    .from('invitation_versions')
    .insert({
      wedding_id: authed.hostA.wedding.id,
      version_number: 1,
      snapshot: { heading: 'Asha weds Bala' },
      created_by: authed.hostA.userId,
    })
    .select('id')
    .single();
  assert.equal(verErr, null, 'the trusted path could not write the control version');
  authed.hostA.version = version;
});

// Child-before-parent, because the frozen-history tables deliberately refuse a cascade
// (Stage 2 file 3). Every wedding the run touched is cleared by owner, not just the two
// fixtures, because several tests legitimately create extra ones. Anything left behind
// fails the assertions below rather than quietly persisting in the local database.
async function teardown() {
  const owners = Object.values(authed).map((h) => h.userId);
  const svc = admin();
  const { data: weddings, error: wErr } = await svc.from('weddings').select('id').in('owner_user_id', owners);
  assert.equal(wErr, null, `teardown could not enumerate this run's weddings: ${wErr?.message}`);
  const ids = (weddings ?? []).map((w) => w.id);
  assert.ok(ids.length >= 2, `teardown expected at least the two fixture weddings, found ${ids.length}`);

  const steps = [
    ['publications', () => svc.from('publications').delete().in('wedding_id', ids).select('id')],
    ['entitlements', () => svc.from('entitlements').delete().in('wedding_id', ids).select('id')],
    ['invitation_versions', () => svc.from('invitation_versions').delete().in('wedding_id', ids).select('id')],
    ['weddings', () => svc.from('weddings').delete().in('id', ids).select('id')],
  ];
  for (const [name, run] of steps) {
    const { error } = await run();
    assert.equal(error, null, `teardown could not clear ${name}: ${error?.message}`);
  }
  const { data: left } = await svc.from('weddings').select('id').in('owner_user_id', owners);
  assert.deepEqual(left, [], 'teardown left a wedding behind');

  for (const id of owners) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }
}

after(teardown);

const client = (who) => authed[who].client;

// ---------------------------------------------------------------------------
// The two mechanisms Stage 2 could not exercise: a real token, and a real
// HTTP-to-role translation.
// ---------------------------------------------------------------------------
describe('§5.1 the JWT is what carries identity', () => {
  test('auth.uid() reads a GoTrue-issued claim, not a client-supplied column', async () => {
    const { data, error } = await client('hostA').from('weddings').select('id,title').eq('id', authed.hostA.wedding.id);
    assert.equal(error, null);
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Asha weds Bala');
  });

  test('signing up authored the account rows through the real trigger path', async () => {
    // `private.handle_new_user` is the one SECURITY DEFINER function in the schema and
    // until now it had only ever been fired by an INSERT into auth.users from psql.
    // Here GoTrue wrote the auth.users row, so the profile and the default role are
    // evidence about the deployed trigger, not a hand-made one.
    const { data: profiles, error: e1 } = await client('hostA').from('profiles').select('user_id').eq('user_id', authed.hostA.userId);
    assert.equal(e1, null);
    assert.equal(profiles.length, 1, 'signup did not author a profile');

    const { data: roles, error: e2 } = await client('hostA').from('user_roles').select('role').eq('user_id', authed.hostA.userId);
    assert.equal(e2, null);
    assert.deepEqual(roles.map((r) => r.role), ['user'], 'signup did not author exactly the default role');
  });

  test('a request without a session is the anon role, not the authenticated one', async () => {
    // Losing the token must lose the data. This is the JWT half of the boundary: the
    // owner's own row becomes unreadable the moment its credential does.
    const c = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await c.auth.signInWithPassword({ email: emailFor('host-a'), password: PASSWORD });
    assert.equal(error, null, 'a synthetic host could not sign in again');
    assert.equal(data.user.id, authed.hostA.userId, 'signing in produced a different identity');
    const before = await c.from('weddings').select('id').eq('id', authed.hostA.wedding.id);
    assert.equal(before.error, null);
    assert.equal(before.data.length, 1, 'a signed-in client could not read its own wedding');

    // `local` scope: this must clear only this throwaway client's session, not revoke
    // the refresh tokens the fixture clients are still signing requests with.
    const { error: outErr } = await c.auth.signOut({ scope: 'local' });
    assert.equal(outErr, null);
    const after = await c.from('weddings').select('id').eq('id', authed.hostA.wedding.id);
    assert.notEqual(after.error, null, 'a signed-out client still read owner data');
    assert.equal(after.error.code, '42501');
    assert.equal(after.data, null);
  });

  test('a tampered token cannot claim a role or a subject it was not issued for', async () => {
    // The classic self-declared-identity attack, at the layer where it must fail: the
    // signature. The payload is rewritten to name host B while the original signature is
    // kept, so PostgREST must reject it rather than trust the claim.
    // `persistSession: false` clients expose their issued session through the signup
    // and sign-in responses rather than a later getSession() call, so that is where the
    // token to tamper with comes from.
    const token = authed.hostB.accessToken;
    assert.ok(token, 'host B has no access token to tamper with');
    const [header, payloadB64, signature] = token.split('.');
    const claim = {
      ...JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')),
      sub: authed.hostA.userId,
      role: 'service_role',
    };
    const forged = `${header}.${Buffer.from(JSON.stringify(claim)).toString('base64url')}.${signature}`;
    assert.notEqual(forged, token, 'tampering produced the original token');
    const res = await fetch(`${url}/rest/v1/weddings?select=title&id=eq.${authed.hostB.wedding.id}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${forged}` },
    });
    assert.equal(res.status, 401, `a forged JWT was accepted (HTTP ${res.status})`);
    const body = await res.text();
    assert.ok(!body.includes('Bala weds Divya'), 'a forged JWT read the row it claimed to own');
    // Measured rejection: PostgREST v16 answers PGRST301 — the signature no longer
    // matches any configured key — rather than falling back to the apikey's own role.
    const parsed = JSON.parse(body);
    assert.equal(parsed.code, 'PGRST301', `unexpected rejection shape: ${body}`);

    // A token that is not a token at all must fail the same way, not reach the database.
    const garbage = await fetch(`${url}/rest/v1/weddings?select=title`, {
      headers: { apikey: anonKey, Authorization: 'Bearer not.a.jwt' },
    });
    assert.equal(garbage.status, 401);
    assert.equal((await garbage.json()).code, 'PGRST301');
  });
});

// ---------------------------------------------------------------------------
// §3's guarantee, proved where it was never proved: inside an HTTP request.
// ---------------------------------------------------------------------------
describe('§5.2 the draft invariant holds through the API', () => {
  test('a wedding created over REST arrives paired with its draft, unwritten by the caller', async () => {
    const fresh = await createWedding('hostA', 'Chitra weds Deepa', 'ta');
    const { data, error } = await client('hostA').from('invitation_drafts').select('wedding_id,content,created_at,updated_at').eq('wedding_id', fresh.id);
    assert.equal(error, null);
    assert.equal(data.length, 1, 'the trigger did not fire for a REST-created wedding');
    assert.deepEqual(data[0].content, {}, 'the trigger authored content');
    assert.equal(new Date(data[0].updated_at).getTime(), new Date(data[0].created_at).getTime(),
      'the paired draft was written twice');
  });

  // Stage 3 closed the draft invariant by taking the INSERT right away entirely, so
  // over REST this is no longer a test of the unique index — it is a test that the
  // only way a draft row comes into existence is the trigger. `20_draft_invariant.sql`
  // is where the index itself is proven, because that suite writes as a role that is
  // allowed to, which is the only role for which a duplicate can even be attempted.
  // Both inserts below carry every required column: a refusal that was really about a
  // missing field would prove nothing about the grant.
  test('a customer cannot insert a draft row at all, for their own wedding or anyone else’s', async () => {
    for (const [who, wedding] of [['hostA', authed.hostA.wedding.id], ['hostB', authed.hostB.wedding.id]]) {
      const { error } = await client(who).from('invitation_drafts')
        .insert({ wedding_id: wedding, content: { welcome: 'written by hand' } });
      assert.notEqual(error, null, `${who} inserted a draft row over REST`);
      assert.equal(error.code, '42501');
      assert.match(error.message, /permission denied for table invitation_drafts/);
    }

    // Positive control: the same two accounts can still read the draft the trigger
    // made for them, so the refusal above is about INSERT and not about the row.
    for (const who of ['hostA', 'hostB']) {
      const { data, error } = await client(who).from('invitation_drafts')
        .select('wedding_id').eq('wedding_id', authed[who].wedding.id);
      assert.equal(error, null);
      assert.equal(data.length, 1, `${who} lost read of its own draft, so the control failed`);
    }
  });

  test('the paired draft is editable by its owner, which is the point of it existing', async () => {
    const { data, error } = await client('hostA')
      .from('invitation_drafts')
      .update({ content: { welcome: 'with the blessings of our families' } })
      .eq('wedding_id', authed.hostA.wedding.id)
      .select('content');
    assert.equal(error, null);
    assert.equal(data.length, 1);
    assert.equal(data[0].content.welcome, 'with the blessings of our families');
  });
});

// ---------------------------------------------------------------------------
// §5: "Host A cannot mutate Host B: wedding / draft / style / people / event / venue"
// ---------------------------------------------------------------------------
describe('§5.3 cross-account isolation over the API', () => {
  test('neither host can read the other’s wedding', async () => {
    for (const [reader, other] of [['hostA', 'hostB'], ['hostB', 'hostA']]) {
      const { data, error } = await client(reader).from('weddings').select('*').eq('id', authed[other].wedding.id);
      assert.equal(error, null, `${reader} got an error rather than silence — an enumeration signal`);
      assert.deepEqual(data, [], `${reader} read ${other}'s wedding`);
    }
  });

  // Each case carries both halves: the patch aimed at the victim's row, and the same
  // patch aimed at the attacker's own row. Without the second one, an empty result
  // could just as well mean "the write is broken for everyone".
  const foreignMutations = [
    {
      label: 'wedding title', attacker: 'hostA', victim: 'hostB',
      foreign: { title: 'rewritten by someone else' }, own: { title: 'Asha weds Bala, again' },
    },
    {
      label: 'style settings', attacker: 'hostA', victim: 'hostB',
      foreign: { style_settings: { palette: 'stolen' } }, own: { style_settings: { palette: 'maroon' } },
    },
    {
      label: 'language choice', attacker: 'hostA', victim: 'hostB',
      foreign: { primary_language: 'te' }, own: { primary_language: 'ta' },
    },
    {
      label: 'lifecycle status', attacker: 'hostB', victim: 'hostA',
      foreign: { lifecycle_status: 'archived' }, own: { lifecycle_status: 'draft' },
    },
  ];
  for (const { label, attacker, victim, foreign, own } of foreignMutations) {
    test(`an update to another account's ${label} changes no rows`, async () => {
      const { data, error } = await client(attacker)
        .from('weddings')
        .update(foreign)
        .eq('id', authed[victim].wedding.id)
        .select();
      assert.equal(error, null);
      assert.deepEqual(data, [], `${attacker} mutated ${victim}'s ${label}`);

      const control = await client(attacker)
        .from('weddings')
        .update(own)
        .eq('id', authed[attacker].wedding.id)
        .select();
      assert.equal(control.error, null, `control write of ${label} failed: ${control.error?.message}`);
      assert.equal(control.data.length, 1, 'the control write changed no row, so the refusal above proved nothing');
    });
  }

  test('another account’s draft cannot be read or edited — and deleting drafts is over the API’s reach for everyone', async () => {
    const attacker = client('hostA');
    const victimDraftOf = 'hostB';

    const read = await attacker.from('invitation_drafts').select('*').eq('wedding_id', authed[victimDraftOf].wedding.id);
    assert.equal(read.error, null);
    assert.deepEqual(read.data, [], 'a foreign draft was readable');

    const edit = await attacker.from('invitation_drafts')
      .update({ content: { welcome: 'not mine to write' } })
      .eq('wedding_id', authed[victimDraftOf].wedding.id)
      .select();
    assert.equal(edit.error, null);
    assert.deepEqual(edit.data, [], 'a foreign draft was editable');

    // The foreign DELETE never reaches a policy: PostgREST asks the grant layer first
    // and Stage 3 revoked DELETE from `authenticated` outright, so the answer is the
    // same for the attacker as for the owner. That is the point — a draft is a
    // lifecycle record, and dropping one is not something a browser may ask for.
    const foreignDelete = await attacker.from('invitation_drafts').delete()
      .eq('wedding_id', authed[victimDraftOf].wedding.id).select();
    assert.equal(foreignDelete.error?.code, '42501', 'a foreign draft was deletable');
    assert.match(foreignDelete.error.message, /permission denied for table invitation_drafts/);

    const ownDelete = await client('hostB').from('invitation_drafts').delete()
      .eq('wedding_id', authed.hostB.wedding.id).select();
    assert.equal(ownDelete.error?.code, '42501', 'the owner deleted its own draft over REST');
    assert.match(ownDelete.error.message, /permission denied for table invitation_drafts/);

    // Positive control, and it has to be the *owner's* write: without it the two
    // refusals above could just mean the table is unreadable or frozen.
    const control = await client('hostB').from('invitation_drafts').select('wedding_id').eq('wedding_id', authed.hostB.wedding.id);
    assert.equal(control.error, null);
    assert.equal(control.data.length, 1, 'the row the refusals above protected does not exist');

    const ownEdit = await client('hostB').from('invitation_drafts')
      .update({ content: { welcome: 'written by its owner' } })
      .eq('wedding_id', authed.hostB.wedding.id)
      .select('content');
    assert.equal(ownEdit.error, null, `the owner lost UPDATE: ${ownEdit.error?.message}`);
    assert.equal(ownEdit.data.length, 1, 'the owner’s UPDATE changed no row');
    assert.equal(ownEdit.data[0].content.welcome, 'written by its owner');
  });

  // `n` distinguishes the refused attempt from the control row wherever a column is
  // unique, so a control can never "pass" by colliding with the probe above it.
  const childTables = [
    ['wedding_people', (id, n) => ({ wedding_id: id, display_name: `Someone else’s brother ${n}`, role_key: 'brother' })],
    ['venues', (id, n) => ({ wedding_id: id, name: `A hall I do not own ${n}` })],
    ['wedding_events', (id, n) => ({ wedding_id: id, event_key: `probe-${n}`, display_name: `Probe ${n}`, starts_at_local: '2026-11-14T07:30:00' })],
    ['guest_households', (id, n) => ({ wedding_id: id, display_name: `A household I did not invite ${n}` })],
    // No object_key here: Stage 6 mints it in a BEFORE INSERT trigger that runs ahead of the RLS
    // WITH CHECK, so a supplied key is answered by the mint refusal and this claim stops being
    // about row-level security. stage6_storage.test.mjs MINT-02 covers the supplied-key case.
    ['wedding_assets', (id) => ({ wedding_id: id, asset_kind: 'photo' })],
  ];
  for (const [table, build] of childTables) {
    test(`a child row cannot be attached to another account's wedding via ${table}`, async () => {
      const { error } = await client('hostA').from(table).insert(build(authed.hostB.wedding.id, 'foreign'));
      assert.notEqual(error, null, `a forged ${table} row was accepted`);
      assert.equal(error.code, '42501');
      assert.match(error.message, /row-level security policy/);

      const control = await client('hostA').from(table).insert(build(authed.hostA.wedding.id, 'own')).select();
      assert.equal(control.error, null, `control ${table} insert failed, so the refusal above proved nothing: ${control.error?.message}`);
      assert.equal(control.data.length, 1);
    });
  }

  test('a row I own cannot be re-parented onto someone else’s wedding', async () => {
    const { error } = await client('hostA')
      .from('venues')
      .update({ wedding_id: authed.hostB.wedding.id })
      .eq('id', authed.hostA.venue.id)
      .select();
    assert.notEqual(error, null, 'a venue was re-parented onto a wedding its owner does not own');
    assert.equal(error.code, '42501');

    // Control: the same UPDATE moving it to a wedding host A does own.
    const own = await client('hostA')
      .from('venues')
      .update({ wedding_id: authed.hostA.wedding.id })
      .eq('id', authed.hostA.venue.id)
      .select();
    assert.equal(own.error, null);
    assert.equal(own.data.length, 1, 'the control re-parent failed, so the refusal above proved nothing');
  });

  test('another account’s people, event and venue rows are invisible and untouchable', async () => {
    const probes = [
      ['wedding_people', authed.hostA.person.id, { display_name: 'Renamed by a stranger' }],
      ['wedding_events', authed.hostA.event.id, { display_name: 'Renamed by a stranger' }],
      ['venues', authed.hostA.venue.id, { name: 'Renamed by a stranger' }],
    ];
    for (const [table, id, patch] of probes) {
      const read = await client('hostB').from(table).select('*').eq('id', id);
      assert.equal(read.error, null);
      assert.deepEqual(read.data, [], `host B read host A's ${table} row`);

      const edit = await client('hostB').from(table).update(patch).eq('id', id).select();
      assert.equal(edit.error, null, `host B got an error rather than silence on ${table}`);
      assert.deepEqual(edit.data, [], `host B edited host A's ${table} row`);

      const control = await client('hostA').from(table).update(patch).eq('id', id).select();
      assert.equal(control.error, null);
      assert.equal(control.data.length, 1, `the owner could not edit its own ${table} row, so the refusal above proved nothing`);

      const remove = await client('hostB').from(table).delete().eq('id', id).select();
      assert.equal(remove.error, null);
      assert.deepEqual(remove.data, [], `host B deleted host A's ${table} row`);

      const surviving = await client('hostA').from(table).select('id').eq('id', id);
      assert.equal(surviving.data.length, 1, `the ${table} row vanished despite the reported refusal`);
    }
  });
});

// ---------------------------------------------------------------------------
// §5: "Anonymous cannot enumerate … / cannot create, update or delete"
// ---------------------------------------------------------------------------
describe('§5.4 the anonymous surface is empty', () => {
  // Every base table in the schema PostgREST is configured to expose.
  const allTables = [
    'weddings', 'invitation_drafts', 'wedding_people', 'venues', 'wedding_events',
    'invitation_versions', 'publications', 'guest_households', 'household_event_scopes',
    'rsvp_responses', 'approval_requests', 'approval_feedback', 'wedding_assets',
    'entitlements', 'design_templates', 'tradition_packs', 'profiles', 'user_roles',
  ];

  for (const table of allTables) {
    test(`anonymous cannot read ${table}`, async () => {
      const { data, error } = await anon().from(table).select('*');
      assert.notEqual(error, null, `anonymous enumerated ${table}`);
      assert.equal(error.code, '42501');
      assert.equal(data, null);
    });
  }

  test('anonymous cannot count rows, which is the enumeration primitive', async () => {
    // Measured: PostgREST v16 answers an insufficient-privilege request with HTTP 401,
    // not a zero-row 200. A count would have been the cheapest way to learn how many
    // families are on this system.
    const res = await fetch(`${url}/rest/v1/weddings?select=*`, {
      headers: { apikey: anonKey, Prefer: 'count=exact' },
    });
    assert.equal(res.status, 401, 'anonymous counted weddings');
    const body = await res.json();
    assert.equal(body.code, '42501');
    assert.equal(res.headers.get('content-range'), null, 'a Content-Range header leaked the row count');

    // The same request through the client library, in both count shapes. A `head: true`
    // count is the one a dashboard would use for a row total, and its measured answer
    // is an error object with an *empty message* and no code — the refusal is real (no
    // count comes back) but a UI that keys off `error.code` would show nothing at all.
    const headCount = await anon().from('weddings').select('*', { count: 'exact', head: true });
    assert.notEqual(headCount.error, null, 'an anonymous HEAD count succeeded');
    assert.equal(headCount.count, null, 'a row count reached an anonymous caller');
    assert.equal(headCount.data, null);

    const fullCount = await anon().from('weddings').select('*', { count: 'exact' });
    assert.equal(fullCount.error?.code, '42501');
    assert.equal(fullCount.count, null);
  });

  test('FINDING: a privilege refusal carries a repair hint, so the product must never render hints', async () => {
    // PostgREST v16 adds a `hint` to privilege errors telling the caller which GRANT
    // would fix it. Measured text for an anonymous request:
    //   "Grant the required privileges to the current role with:
    //    GRANT SELECT ON public.weddings TO anon;"
    // That names a schema object and a database role to an unauthenticated caller. It
    // is not a credential and it discloses no row, so it is not a data breach — but it
    // is internal vocabulary, and §5 asks whether errors expose internal information
    // *through the product UI*. This test pins the shape of the answer so the rule the
    // UI has to follow is a measured one rather than an assumed one.
    const res = await fetch(`${url}/rest/v1/weddings?select=*`, { headers: { apikey: anonKey } });
    const body = await res.json();
    assert.equal(body.code, '42501');
    assert.match(String(body.hint ?? ''), /GRANT SELECT ON public\.weddings TO anon/,
      'the hint shape changed — re-read what this finding is claiming');
    for (const needle of ['service_role', 'token', 'password', env.SUPABASE_LOCAL_SECRET_KEY ?? '\u0000']) {
      assert.ok(!JSON.stringify(body).includes(needle), `the refusal leaked ${needle}`);
    }
  });

  test('anonymous cannot write canonical data', async () => {
    const writes = [
      ['weddings', { owner_user_id: authed.hostA.userId, title: 'anon made this' }],
      ['invitation_drafts', { wedding_id: authed.hostA.wedding.id, content: {} }],
      ['entitlements', { wedding_id: authed.hostA.wedding.id, package_code: 'x', source: 'service' }],
      ['user_roles', { user_id: authed.hostA.userId, role: 'admin' }],
      ['profiles', { user_id: authed.hostA.userId, name: 'anon' }],
    ];
    for (const [table, payload] of writes) {
      const { error } = await anon().from(table).insert(payload);
      assert.notEqual(error, null, `anonymous wrote to ${table}`);
      assert.equal(error.code, '42501');
      assert.match(error.message, /permission denied/,
        `${table}: refused by a policy rather than the grant layer — a later migration must not make this reachable`);
    }
  });

  test('anonymous cannot delete canonical data', async () => {
    const { error } = await anon().from('weddings').delete().eq('id', authed.hostA.wedding.id).select();
    assert.notEqual(error, null, 'anonymous deleted a wedding');
    assert.equal(error.code, '42501');
    const still = await client('hostA').from('weddings').select('id').eq('id', authed.hostA.wedding.id);
    assert.equal(still.data.length, 1, 'the wedding vanished anyway');
  });
});

// ---------------------------------------------------------------------------
// §5: "Authenticated clients cannot mint entitlement / modify frozen version /
//      forge another user's ownership / self-grant admin / read the token store /
//      read the legacy archive"
// ---------------------------------------------------------------------------
describe('§5.5 what an authenticated customer may never do', () => {
  test('an entitlement cannot be minted by the customer, and the trusted path proves the row is legal', async () => {
    const { error } = await client('hostA')
      .from('entitlements')
      .insert({ wedding_id: authed.hostA.wedding.id, package_code: 'print-plus', status: 'active', source: 'service' });
    assert.notEqual(error, null, 'a customer granted itself a paid capability');
    assert.equal(error.code, '42501');
    assert.match(error.message, /permission denied/, 'expected the grant layer, not a policy, to be the first gate');

    const trusted = await admin()
      .from('entitlements')
      .insert({ wedding_id: authed.hostA.wedding.id, package_code: 'print-plus', status: 'active', source: 'service' })
      .select();
    assert.equal(trusted.error, null, `the trusted path could not write the control row: ${trusted.error?.message}`);
    assert.equal(trusted.data.length, 1);
  });

  test('a frozen version cannot be inserted, edited or deleted by a customer', async () => {
    const insert = await client('hostA').from('invitation_versions').insert({
      wedding_id: authed.hostA.wedding.id, version_number: 2,
      snapshot: { heading: 'self-frozen' }, created_by: authed.hostA.userId,
    });
    assert.equal(insert.error?.code, '42501', 'a customer froze its own version over REST');

    const update = await client('hostA').from('invitation_versions')
      .update({ snapshot: { heading: 'rewritten after publication' } })
      .eq('id', authed.hostA.version.id).select();
    assert.equal(update.error?.code, '42501', 'a customer edited a frozen row');
    assert.equal(update.data, null);

    const remove = await client('hostA').from('invitation_versions').delete().eq('id', authed.hostA.version.id).select();
    assert.equal(remove.error?.code, '42501', 'a customer deleted a frozen row');

    // Control: the same version row is readable by its owner, and the trusted path can
    // still write history — so the refusals above are the grant layer, not a broken
    // payload and not a table nobody can reach.
    const read = await client('hostA').from('invitation_versions').select('version_number,snapshot').eq('id', authed.hostA.version.id);
    assert.equal(read.error, null);
    assert.equal(read.data.length, 1);
    const trusted = await admin().from('invitation_versions').insert({
      wedding_id: authed.hostA.wedding.id, version_number: 2,
      snapshot: { heading: 'trusted control' }, created_by: authed.hostA.userId,
    }).select();
    assert.equal(trusted.error, null, `control version write failed: ${trusted.error?.message}`);
  });

  test('publishing is not a customer operation', async () => {
    const { error } = await client('hostA').from('publications')
      .insert({ wedding_id: authed.hostA.wedding.id, version_id: authed.hostA.version.id, status: 'active' });
    assert.equal(error?.code, '42501', 'a customer published its own version');

    const trusted = await admin().from('publications')
      .insert({ wedding_id: authed.hostA.wedding.id, version_id: authed.hostA.version.id, status: 'active' })
      .select();
    assert.equal(trusted.error, null, `the trusted publication write failed: ${trusted.error?.message}`);
    assert.equal(trusted.data.length, 1);
  });

  test('ownership cannot be forged into a new wedding', async () => {
    const { error } = await client('hostA')
      .from('weddings')
      .insert({ owner_user_id: authed.hostB.userId, title: 'Not mine', primary_language: 'en' });
    assert.notEqual(error, null, 'a wedding was created on another account');
    assert.equal(error.code, '42501');
    assert.match(error.message, /row-level security policy/);

    const control = await client('hostA')
      .from('weddings')
      .insert({ owner_user_id: authed.hostA.userId, title: 'Second invitation of mine', primary_language: 'en' })
      .select();
    assert.equal(control.error, null, 'control create for the real owner failed');
    assert.equal(control.data.length, 1);
  });

  test('an account cannot promote itself, and can only see its own roles', async () => {
    const selfGrant = await client('hostA').from('user_roles').insert({ user_id: authed.hostA.userId, role: 'admin' });
    assert.equal(selfGrant.error?.code, '42501', 'an account promoted itself to admin');

    const otherGrant = await client('hostA').from('user_roles').insert({ user_id: authed.hostB.userId, role: 'admin' });
    assert.equal(otherGrant.error?.code, '42501', 'an account promoted another one');

    const { data, error } = await client('hostA').from('user_roles').select('user_id,role');
    assert.equal(error, null);
    assert.deepEqual([...new Set(data.map((r) => r.user_id))], [authed.hostA.userId],
      'role rows belonging to other accounts were readable');
  });

  test('the token store, the audit trail and the legacy archive are not addressable as API objects', async () => {
    // PostgREST publishes only the schema named in supabase/config.toml (`public`), so
    // these are not "rows hidden by a policy" — they are not reachable objects at all.
    // `run.sh` asserts separately, in SQL, that each of these tables really exists;
    // without that precondition a "not found" answer would be worthless.
    const notExposed = [
      ['private.access_tokens', 'access_tokens'],
      ['private.audit_events', 'audit_events'],
      ['legacy.projects', 'projects'],
      ['legacy.guests', 'guests'],
      ['legacy.payments', 'payments'],
      ['legacy.templates', 'templates'],
    ];
    for (const [qualified, short] of notExposed) {
      for (const [name, c] of [['service_role', admin()], ['authenticated', client('hostA')], ['anon', anon()]]) {
        const { error } = await c.from(short).select('*');
        assert.notEqual(error, null, `${qualified} is reachable through the REST surface as ${name}`);
        assert.equal(error.code, 'PGRST205', `${qualified} as ${name}: unexpected failure shape ${error.message}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §5: "Test WITH CHECK behavior through the API, not only SQL."
// ---------------------------------------------------------------------------
describe('§5.6 row and column constraints survive the HTTP translation', () => {
  test('the policy WITH CHECK refuses a row whose owner claim is not the caller', async () => {
    // This is a *policy* WITH CHECK failure, distinct from the table CHECK below: the
    // column is legal, the relationship is not.
    const { error } = await client('hostA').from('wedding_people')
      .insert({ wedding_id: authed.hostB.wedding.id, display_name: 'Legal name, wrong wedding', role_key: 'uncle' });
    assert.equal(error.code, '42501');
    assert.match(error.message, /new row violates row-level security policy for table "wedding_people"/);
  });

  test('a blank title is refused by the CHECK constraint, not by a crash', async () => {
    const { error } = await client('hostA').from('weddings').insert({ owner_user_id: authed.hostA.userId, title: '   ' });
    assert.notEqual(error, null, 'a blank title was accepted');
    assert.equal(error.code, '23514');
    assert.match(error.message, /weddings_title_check/);

    const control = await client('hostA').from('weddings')
      .insert({ owner_user_id: authed.hostA.userId, title: 'Blank-probe control', primary_language: 'en' }).select();
    assert.equal(control.error, null, `control title insert failed: ${control.error?.message}`);
  });

  test('a value the CHECK forbids is refused with the constraint it violates', async () => {
    const cases = [
      ['negative guest count', { owner_user_id: authed.hostA.userId, title: 'Negative guests', estimated_guest_count: -5 }, 'weddings_estimated_guest_count_check'],
      ['invented language code', { owner_user_id: authed.hostA.userId, title: 'No such language', primary_language: 'hi' }, 'weddings_primary_language_check'],
      ['non-object style settings', { owner_user_id: authed.hostA.userId, title: 'Array style', style_settings: [] }, 'weddings_style_settings_check'],
    ];
    for (const [label, payload, constraint] of cases) {
      const { error } = await client('hostA').from('weddings').insert(payload);
      assert.notEqual(error, null, `${label} was accepted`);
      assert.equal(error.code, '23514');
      assert.match(error.message, new RegExp(constraint));
    }
  });

  test('an unknown column is rejected by the API layer, never silently stored', async () => {
    const { error } = await client('hostA').from('weddings')
      .insert({ owner_user_id: authed.hostA.userId, title: 'Extra field', is_paid: true });
    assert.notEqual(error, null, 'an invented column was accepted');
    assert.match(String(error.code), /^PGRST/);

    const control = await client('hostA').from('weddings')
      .insert({ owner_user_id: authed.hostA.userId, title: 'Known-column control' }).select();
    assert.equal(control.error, null, 'the same insert without the invented column failed, so the probe above proved nothing');
  });
});

// ---------------------------------------------------------------------------
// §5: "Verify returned API errors do not expose inappropriate internal information."
// ---------------------------------------------------------------------------
describe('§5.7 what the API is allowed to say back', () => {
  const secretMaterial = [
    'service_role', // the role name in a customer-facing message means a credential echoed back
    'token_hash', 'digest', 'sha256', '00000000-0000-0000', 'x5t#ServiceRole',
  ];

  test('a refusal names a constraint or a privilege, never credential material', async () => {
    const probes = [
      await client('hostA').from('invitation_versions').update({ snapshot: {} }).eq('id', authed.hostA.version.id),
      await client('hostA').from('entitlements').insert({ wedding_id: authed.hostA.wedding.id }),
      await client('hostA').from('wedding_people').insert({ wedding_id: authed.hostB.wedding.id, display_name: 'x', role_key: 'y' }),
      await client('hostA').from('access_tokens').select('*'),
      await client('hostA').from('audit_events').select('*'),
      await client('hostA').from('weddings').insert({ owner_user_id: authed.hostB.userId, title: 'mine now' }),
      await client('hostA').from('weddings').select('id').eq('id', 'not-a-uuid'),
    ];
    for (const { error } of probes) {
      assert.notEqual(error, null, 'a probe that was supposed to be refused succeeded');
      const text = `${error.message} ${error.details ?? ''} ${error.hint ?? ''}`;
      for (const needle of secretMaterial) {
        assert.ok(!text.includes(needle), `an API error surfaced internal material (${needle}): ${text}`);
      }
    }
  });

  test('no answer the API gives a customer contains key material or the run password', async () => {
    // The shapes a browser can actually see: a privilege refusal, an anonymous refusal,
    // an unreadable-table refusal, and a normal owner read. If any of them ever echoes
    // credential material the product would be showing it, because these are the objects
    // the UI is handed.
    const seen = [];
    seen.push(await client('hostA').from('entitlements').insert({ wedding_id: authed.hostA.wedding.id }).select());
    seen.push(await client('hostA').from('access_tokens').select('*'));
    seen.push(await client('hostA').from('weddings').select('id').eq('id', authed.hostA.wedding.id));
    seen.push(await anon().from('weddings').select('*').eq('id', authed.hostA.wedding.id));
    const rawAnon = await fetch(`${url}/rest/v1/weddings?select=*`, { headers: { apikey: anonKey } });
    const rawBody = await rawAnon.text();

    for (const item of seen) {
      const text = JSON.stringify({ data: item.data, error: item.error });
      assert.ok(!text.includes(serviceKey), 'a service-role key reached a customer response');
      assert.ok(!text.includes(PASSWORD), 'a password reached a customer response');
      assert.ok(!text.includes(env.SUPABASE_LOCAL_SECRET_KEY ?? '\u0000'), 'the secret key reached a customer response');
    }
    assert.ok(!rawBody.includes(authed.hostB.wedding.title), 'an anonymous read returned another family’s data');
    assert.equal(rawAnon.status, 401);
  });

  test('a hidden foreign row is indistinguishable from a row that never existed', async () => {
    const exists = await client('hostA').from('weddings').select('id').eq('id', authed.hostB.wedding.id);
    const missing = await client('hostA').from('weddings').select('id').eq('id', RESERVED_UUID);
    assert.equal(exists.error, null);
    assert.equal(missing.error, null);
    assert.deepEqual(exists.data, missing.data, 'an existence oracle survives');

    // Same shape on the draft, which is the row a guessing attacker would want.
    const fd = await client('hostA').from('invitation_drafts').select('*').eq('wedding_id', authed.hostB.wedding.id);
    const md = await client('hostA').from('invitation_drafts').select('*').eq('wedding_id', RESERVED_UUID);
    assert.deepEqual(fd.data, md.data, 'the draft table answers differently for real and absent weddings');
  });

  test('a typed-input mistake is a typed error, not a stack trace', async () => {
    const { error } = await client('hostA').from('weddings').select('id').eq('id', 'not-a-uuid');
    assert.equal(error.code, '22P02');
    assert.ok(!String(error.details ?? '').includes('at '), `unexpected internal detail: ${error.details}`);
    assert.ok(!String(error.hint ?? '').includes('/'), `unexpected internal hint: ${error.hint}`);
  });
});
