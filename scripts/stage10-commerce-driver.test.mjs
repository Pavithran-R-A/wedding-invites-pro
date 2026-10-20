// S10-3: the trusted commerce instrument, proved with no database, no container and no provider.
//
// `scripts/stage10-commerce-driver.mjs` sits on the only path that can move money in this build: it is
// the process that holds a webhook secret, holds a `postgres` session that can call the six service-only
// bodies, and turns a provider's bytes into a ledger row. Nothing in the product calls it. So the cases
// below are not about whether it is convenient — they are about the four ways a tool like this turns a
// bug into a paid wedding:
//
//   1. **it lets the delivery say things about itself** — an amount, an order reference, a kind, an
//      environment, or its own digest — instead of deriving every one of those from bytes it verified
//      and from facts the operator declared. CD-20, CD-21, CD-23, CD-24.
//   2. **it quotes an attacker's identity into the ledger's idempotency key.** A refusal is ledgered only
//      under an identity the *transport* named in a header, and the instrument refuses to invent one
//      otherwise: CD-26, CD-27 and CD-28 pin that, including the case where no statement is sent at all.
//      The rule was written when it could do real damage — `record_commerce_event` used to answer a repeat
//      of `(provider, event_id)` from the row it already held, *before* looking at the new delivery's
//      verdict, so a forged delivery naming the id a later genuine one would carry made that genuine
//      capture read `already_recorded` and never grant (§14's finding 4; the RED is on file at
//      `q10-logs/s10r-P-red-2.txt`). `20261020120000_stage10_event_redelivery.sql` widened that key to
//      `(provider, event_id, raw_body_sha256, signature_valid)`, which is what stops an attacker's claim
//      burning an identity, and group P's P24..P35 measure the flap it closes: the same bytes arriving
//      refused and then verified are two rows, and the second one pays. The header-only rule stays for the
//      reason that has nothing to do with the key — an unverified body is not evidence of its own identity,
//      and a ledger row whose id came from the bytes being filed would be quoting the forgery.
//   3. **it bends a statement.** Every value is one standard literal with its quotes doubled, or a cast
//      NULL, and every document leaves base64-encoded; the encoding gate that makes the literals safe is
//      asserted before a statement is sent. CD-01..CD-03, CD-14, CD-34.
//   4. **it prints or transmits the secret it was handed.** The key arrives only through an environment
//      variable named by an option, argv is refused for it, and the output path checks the literal
//      secret before a line escapes. CD-17, CD-35, CD-36, CD-37.
//
// Where a case checks a digest or a statement it re-derives the expected value inside the test — with its
// own `createHmac`, or by reading the migration file. A signer that agrees with itself proves nothing, and
// a parameter list transcribed from SQL by eye proves even less, so CD-08 parses the ledger function's own
// declaration out of the migration and compares.

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENTS,
  MAX_EVENT_ID_LENGTH,
  RECORD_EVENT_ARGS,
  assertSecretFree,
  cashfreeDelivery,
  claimedRefusalIdentity,
  decodeLine,
  ensureSafeEncoding,
  expireOrderSql,
  grantEntitlementSql,
  observeOrderSql,
  parseArgs,
  quoteOrderSql,
  razorpayDelivery,
  readOptions,
  recordEventSql,
  reconcileOrderSql,
  refusedEventArgs,
  resolveTarget,
  revocationSql,
  runDelivery,
  sha256Of,
  sqlBigInt,
  sqlBool,
  sqlLiteral,
  sqlText,
  sqlTimestamp,
  sqlUuid,
  verifiedEventArgs,
} from './stage10-commerce-driver.mjs';
import {
  CASHFREE_SIGNATURE_HEADER,
  CASHFREE_TIMESTAMP_HEADER,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  sha256Hex,
  verifyProviderWebhook,
} from './stage10-webhook-core.mjs';

const SECRET = 'synthetic-commerce-fixture-key-0001';
const ACTOR = '3f2a1b6c-0000-4000-8000-000000000001';
const WEDDING = '7c9d0e1f-2222-4333-8444-555566667777';
const ORDER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW = Date.parse('2026-10-18T09:00:00.000Z');
const TS = '1760000000';
// What the core makes of `created_at: 1760000000` (8h 53m 20s into 2025-10-09), spelled out rather than
// recomputed so a change in the core's epoch handling has to be noticed here.
const OCCURRED = '2025-10-09T08:53:20.000Z';

/** The migration is the only source of truth about the ledger's shape, so the test reads it.
 *  Resolved from the working directory rather than `import.meta.url`: under this project's jsdom test
 *  environment a `file:` base handed to `new URL` comes back as an `http://localhost` URL, and the
 *  migration is on disk, not on the dev server — the same ruling `src/test/traditionPackDraftCandidate.test.ts:33-40`
 *  records, applied here so the read cannot silently point at nothing. */
const MIGRATION_RELATIVE = 'supabase/migrations/20261017120000_stage10_commerce_foundations.sql';
const MIGRATION_PATH = resolve(process.cwd(), MIGRATION_RELATIVE);
if (isAbsolute(MIGRATION_RELATIVE) || !existsSync(MIGRATION_PATH)) {
  throw new Error(`${MIGRATION_RELATIVE} was not found from ${process.cwd()}; this test runs from the repository root`);
}
const migration = readFileSync(MIGRATION_PATH, 'utf8');

/** Every migration that (re)declares or revokes the ledger function, in deployment order.
 *
 *  The instrument calls `internal_api.record_commerce_event` with `RECORD_EVENT_ARGS`, and for the first
 *  nine months of this stage that meant one declaration, in `MIGRATION_RELATIVE`. The idempotency repair
 *  (finding 4) added a second one — `20261020120000_stage10_event_redelivery.sql` replaces the body with a
 *  `CREATE OR REPLACE` — so "the migration declares fifteen arguments" no longer constrains the schema the
 *  driver will actually face: a head that widened the list would still satisfy a check that reads only the
 *  foundations file, and the failure would surface as a statement Postgres refuses to parse, against a real
 *  provider, at the only moment money moves. So this scans the whole migrations directory by filename,
 *  which is exactly the order `supabase/tests/stage10/run.sh` applies it in. */
const LEDGER_FUNCTION = /internal_api\.record_commerce_event\s*\(/g;
const ledgerMigrations = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    relative: `supabase/migrations/${name}`,
    text: readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8'),
  }))
  .filter((file) => {
    LEDGER_FUNCTION.lastIndex = 0;
    return LEDGER_FUNCTION.test(file.text);
  });

/** The fifteen names/types of one `CREATE [OR REPLACE] FUNCTION` declaration, comments dropped. */
function declaredArguments(text) {
  const declared = /CREATE (?:OR REPLACE )?FUNCTION internal_api\.record_commerce_event\(\s([\s\S]*?)\)\sRETURNS jsonb/.exec(text);
  if (!declared) return null;
  return declared[1]
    .split('\n')
    .map((line) => line.replace(/--[\s\S]*/, '').trim().replace(/,$/, ''))
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
}

// Read from the module namespace rather than a hand-typed list, so the inventory CD-37 asserts against
// cannot drift away from the file it describes.
const surface = Object.keys(await import('./stage10-commerce-driver.mjs')).sort();

/** A capture as a host's route would have received it. Written here, not imported from the driver, so
 *  the driver's signers are not the only thing that can produce a delivery. The event id is a parameter
 *  because the verifier cross-checks the body's against the header's, and a fixture that wants the two to
 *  agree has to be able to name one value in both places. */
const captureBody = (reference = 'vv1_orderreference', eventId = 'evt_genuine_0001') => JSON.stringify({
  event: 'payment.captured',
  event_id: eventId,
  created_at: 1760000000,
  payload: {
    payment: {
      entity: {
        id: 'pay_MOCK1', order_id: 'order_MOCK1', status: 'captured', currency: 'INR',
        amount: 499900, amount_paid: 499900, notes: { merchant_reference: reference },
      },
    },
    order: { entity: { id: 'order_MOCK1', notes: { merchant_reference: reference } } },
  },
});

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

/** The argument lines of one built call, exactly as the statement will send them. The two-space indent is
 *  part of the frame this helper agrees to, so a builder that changed it would fail the capture. */
function argumentLines(statement, functionName) {
  const body = new RegExp(`${functionName}\\(\\n  ([\\s\\S]*?)\\n\\)`).exec(statement);
  if (!body) throw new Error(`no indented multi-line call to ${functionName} in that statement`);
  return body[1].split(',\n  ');
}

/** The columns one ledger table really has, read out of the `CREATE TABLE` that made it.
 *
 *  This exists because the observation once named `commerce_orders.provider` and
 *  `commerce_payment_attempts.provider_attempt_ref`, neither of which was ever in the schema, and no case
 *  in this file could notice: the instrument's statements are strings here, and the first tier that
 *  actually ran one was the Stage 10 HTTP battery. A provider is a fact about an attempt or a delivery,
 *  never about a frozen quote — so the field list is now checked against the DDL at the level where a name
 *  can be wrong.
 *
 *  The block is split on commas at paren depth zero rather than line by line, because a column definition
 *  wraps (`CHECK (kind IN ('payment_initiated', …))` runs over three lines) and a line-based reader either
 *  keeps a continuation as a column — which measured 22 names for the events table's 19 columns, an
 *  inventory wide enough to pass an unknown one — or drops it and can drop a real column too. An entry
 *  this parser cannot classify is a refusal, not a skip. */
function tableColumns(table, schema = 'private') {
  const block = new RegExp(`CREATE TABLE ${schema}\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(migration);
  if (!block) throw new Error(`${schema}.${table} is not created by ${MIGRATION_RELATIVE}`);
  const entries = [];
  let depth = 0;
  let current = '';
  for (const character of block[1].replace(/--[^\n]*/g, ' ')) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) entries.push(current);

  const names = [];
  for (const entry of entries) {
    const words = entry.trim().split(/\s+/).filter(Boolean);
    const [first, second] = words;
    if (!first) continue;
    if (/^(?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)$/i.test(first)) continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(first) || !second) {
      throw new Error(`the column parser cannot classify ${JSON.stringify(entry.trim())} in ${schema}.${table}`);
    }
    if (names.includes(first)) throw new Error(`${schema}.${table} names ${first} twice`);
    names.push(first);
  }
  return names;
}

/** The relations the observation reads, keyed by the alias it gives each one. The four ledger tables are
 *  checked against their own `CREATE TABLE` above; `entitlements` is Stage 2's table, so its columns are
 *  the inventory `pg_attribute` reported for it on the deployed stack. */
const OBSERVED = {
  o: tableColumns('commerce_orders'),
  e: tableColumns('commerce_payment_events'),
  a: tableColumns('commerce_payment_attempts'),
  r: tableColumns('commerce_refunds'),
  en: ['id', 'wedding_id', 'package_code', 'status', 'source', 'granted_at', 'revoked_at',
    'metadata', 'created_at', 'updated_at'],
};

/** Every `alias.column` the statement names.
 *
 *  The column class carries digits: `raw_body_sha256` is the one ledger column named for a hash length,
 *  and `[a-z_]+` stops at its first digit and then fails the trailing boundary — which read as a clean
 *  18-reference sweep of a 19-field event object, the digest being the field that went unseen. */
const namedColumns = (statement) =>
  [...statement.matchAll(/\b([a-z]{1,2})\.([a-z_][a-z0-9_]*)\b/g)].map(([, alias, column]) => ({ alias, column }));

/** The fields one alias projects, spelled the way `json_build_object` spells them: `'key', alias.column`.
 *  Read from the projection rather than swept from the text, so a field the sweep cannot see — which is
 *  exactly how the digest slipped — cannot slip here too. */
function projectedFields(statement, alias) {
  const pattern = new RegExp(`'([a-z0-9_]+)', ${alias}\\.([a-z0-9_]+)`, 'g');
  return [...statement.matchAll(pattern)].map(([, key, column]) => ({ key, column }));
}

/** A channel that records what it was asked to run and answers with one ledger-shaped row. */
function recordingChannel(answer = { disposition: 'applied' }) {
  const calls = [];
  return { calls, sql: (statement) => { calls.push(statement); return b64(answer); } };
}

// ------------------------------------------------------------------ the literal renderers

describe('the literal renderers', () => {
  it('CD-01: doubles every quote a value carries, and answers NULL only for null and undefined', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral("a''b")).toBe("'a''''b'");
    expect(sqlLiteral('')).toBe("''");
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(undefined)).toBe('NULL');
  });

  it('CD-02: keeps an injection-shaped value inside one literal instead of letting it escape', () => {
    expect(sqlLiteral("x'); DROP TABLE private.commerce_orders;--"))
      .toBe("'x''); DROP TABLE private.commerce_orders;--'");
    // A backslash is ordinary text under `standard_conforming_strings = on`, which CD-34 asserts before
    // any of these is sent: it cannot eat the closing quote.
    expect(sqlLiteral('a\\b')).toBe("'a\\b'");
  });

  it('CD-03: refuses a NUL byte rather than letting the driver send a truncated statement', () => {
    expect(() => sqlLiteral('a\u0000b')).toThrow(/NUL/);
  });

  it('CD-04: casts every position, so a NULL never depends on the parser guessing a type', () => {
    expect(sqlText('other')).toBe("'other'::text");
    expect(sqlText(null)).toBe('NULL::text');
    expect(sqlBigInt(499900)).toBe('499900');
    expect(sqlBigInt(null)).toBe('NULL::bigint');
    expect(sqlBool(true)).toBe('true');
    expect(sqlBool(false)).toBe('false');
    expect(sqlTimestamp(null)).toBe('NULL::timestamptz');
    expect(sqlTimestamp(OCCURRED)).toBe(`'${OCCURRED}'::timestamptz`);
    expect(sqlUuid(ORDER, 'order')).toBe(`'${ORDER}'::uuid`);
  });

  it('CD-05: takes an integer only, and still records a claim the ledger itself would accept', () => {
    // `amount_minor` on the ledger carries no CHECK on purpose (migration:289-298): a provider's wrong
    // amount is evidence, not a price this product is selling. So 0 and a negative survive the renderer.
    // What is refused here is a value that cannot be an integer at all, because that would be the driver
    // doing the rounding the verifier explicitly refuses to do.
    expect(sqlBigInt(0)).toBe('0');
    expect(sqlBigInt(-1)).toBe('-1');
    for (const bad of [1.5, '499900', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => sqlBigInt(bad)).toThrow(/integer/);
    }
  });

  it('CD-06: refuses a boolean or a timestamp that is not what it claims to be', () => {
    expect(() => sqlBool(null)).toThrow(/boolean/);
    expect(() => sqlBool('true')).toThrow(/boolean/);
    expect(() => sqlTimestamp('yesterday')).toThrow(/ISO 8601/);
    expect(() => sqlTimestamp(1760000000)).toThrow(/ISO 8601/);
  });

  it('CD-07: refuses a non-uuid instead of passing text into a uuid position', () => {
    expect(sqlUuid(ORDER.toUpperCase(), 'order')).toBe(`'${ORDER}'::uuid`);
    for (const bad of [null, '', 'order-1', 'x'.repeat(36), `${ORDER} OR true`]) {
      expect(() => sqlUuid(bad, 'wedding')).toThrow(/wedding/);
    }
  });
});

// ------------------------------------------------------------------ the statement builders

describe('the statement builders', () => {
  it('CD-08: names the ledger\u2019s fifteen arguments exactly as every migration declares them', () => {
    expect(ledgerMigrations.map((file) => file.relative), 'the scan reaches the migration this instrument ' +
      'was written against, not only a directory it cannot read')
      .toContain(MIGRATION_RELATIVE);

    const types = RECORD_EVENT_ARGS.map(([, type]) => type);
    let declarations = 0;
    for (const file of ledgerMigrations) {
      const params = declaredArguments(file.text);
      if (!params) continue;
      declarations += 1;
      expect(params.map(([name, type]) => [name.replace(/^p_/, ''), type]),
        `${file.relative} declares the ledger function with arguments this driver would not send`)
        .toEqual(RECORD_EVENT_ARGS);

      // The same file must revoke the signature it just made. `CREATE OR REPLACE` keeps an existing
      // function's grants, so a body change alone cannot re-expose the writer — but a *changed argument
      // list* is a different function, and a new pg_proc row arrives with the default EXECUTE grant to
      // PUBLIC and to the three client roles. A migration that widens this signature without revoking it
      // would therefore hand a token-holder a direct call into the money path, and the driver's own
      // statement list would still look correct.
      const revoked = [...file.text.matchAll(
        /REVOKE ALL ON FUNCTION internal_api\.record_commerce_event\(([\s\S]*?)\)/g)]
        .map((match) => match[1].split(',').map((type) => type.trim()).filter(Boolean).join(','));
      expect(revoked, `${file.relative} declares the ledger function but never revokes that signature`).toContain(types.join(','));
    }
    expect(declarations, 'at least one migration declares the function this instrument calls').toBeGreaterThan(0);
  });

  it('CD-09: renders one base64-wrapped SELECT of exactly fifteen casts, in the declared order', () => {
    const args = verifiedEventArgs(
      {
        ok: true, provider: 'razorpay', eventId: 'evt_1', eventType: 'payment.captured',
        kind: 'payment_captured', environment: 'synthetic', rawBodySha256: sha256Hex('x'),
        occurredAt: OCCURRED,
        facts: {
          merchantReference: 'vv1_ref', amountMinor: 499900, currency: 'INR',
          providerOrderRef: 'order_1', providerPaymentRef: 'pay_1',
        },
      },
      { environment: 'synthetic', actorUserId: ACTOR },
    );
    expect(args).toHaveLength(15);
    const statement = recordEventSql(args);
    expect(statement).toContain('SELECT encode(convert_to((internal_api.record_commerce_event(');
    expect(statement.trim().endsWith("))::text, 'utf8'), 'base64');")).toBe(true);
    // Ordered, not merely present: the call is positional, so one swapped pair puts a true fact in a
    // column that nothing later re-checks.
    expect(argumentLines(statement, 'record_commerce_event')).toEqual([
      "'razorpay'::text", "'evt_1'::text", "'payment.captured'::text", "'payment_captured'::text",
      "'synthetic'::text", `'${sha256Hex('x')}'::text`, 'true', 'NULL::text', "'vv1_ref'::text",
      '499900', "'INR'::text", "'order_1'::text", "'pay_1'::text",
      `'${OCCURRED}'::timestamptz`, `'${ACTOR}'::uuid`,
    ]);
  });

  it('CD-10: refuses a statement built with the wrong number or the wrong kind of argument', () => {
    expect(() => recordEventSql(['a'])).toThrow(/fifteen/);
    expect(() => recordEventSql(Array.from({ length: 15 }, () => "'x'::text"))).toThrow(/position 7/);
    // One well-formed argument per position up to the last, so the sentence about position 15 is about the
    // actor and not about something the fixture got wrong on the way there.
    const wellFormed = ['text', 'text', 'text', 'text', 'text', 'text', 'boolean', 'text', 'text',
      'bigint', 'text', 'text', 'text', 'timestamptz'];
    const one = { text: "'x'::text", boolean: 'true', bigint: '0', timestamptz: `'${OCCURRED}'::timestamptz` };
    expect(() => recordEventSql([...wellFormed.map((type) => one[type]), 'NULL::uuid'])).toThrow(/position 15/);
  });

  it('CD-11: asks for a price the server computed and never carries one from the caller', () => {
    const statement = quoteOrderSql({ weddingId: WEDDING, packageCode: 'varnam_plus', actorUserId: ACTOR });
    expect(statement).toContain('internal_api.create_commerce_order(');
    expect(statement).toContain(`'${WEDDING}'::uuid`);
    expect(statement).toContain("'varnam_plus'::text");
    expect(statement).toContain(`'${ACTOR}'::uuid`);
    expect((statement.match(/::uuid/g) ?? [])).toHaveLength(2);
    // Three arguments, so an amount cannot be supplied even by a caller that wanted a different price.
    expect(statement).not.toMatch(/amount|currency|bigint|razorpay|cashfree|provider/i);
  });

  it('CD-12: builds the other four money steps with the arguments each one declares', () => {
    const twoUuids = (statement) => expect((statement.match(/::uuid/g) ?? [])).toHaveLength(2);
    const grant = grantEntitlementSql({ orderId: ORDER, actorUserId: ACTOR });
    const expire = expireOrderSql({ orderId: ORDER, actorUserId: ACTOR });
    const sweep = reconcileOrderSql({ orderId: ORDER, actorUserId: ACTOR });
    expect(grant).toContain('internal_api.grant_commerce_entitlement(');
    expect(expire).toContain('internal_api.expire_commerce_order(');
    expect(sweep).toContain('internal_api.commerce_reconcile(');
    [grant, expire, sweep].forEach(twoUuids);
    const revoke = revocationSql({ orderId: ORDER, actorUserId: ACTOR, reason: 'refund_succeeded' });
    expect(revoke).toContain('internal_api.revoke_commerce_entitlement(');
    expect(revoke).toContain("'refund_succeeded'::text");
    expect((revoke.match(/::uuid/g) ?? [])).toHaveLength(2);
    expect(() => revocationSql({ orderId: ORDER, actorUserId: ACTOR, reason: '   ' })).toThrow(/reason/);
    expect(() => revocationSql({ orderId: ORDER, actorUserId: ACTOR })).toThrow(/reason/);
  });

  it('CD-13: reads a purchase back in full without reading a raw body, which is never stored', () => {
    const statement = observeOrderSql({ orderId: ORDER });
    for (const relation of ['private.commerce_orders', 'private.commerce_payment_events',
      'private.commerce_payment_attempts', 'private.commerce_refunds', 'public.entitlements']) {
      expect(statement, `the observation reads ${relation}`).toContain(relation);
    }
    // The one body-derived column on the ledger is the digest, and the digest is what proves later that
    // the bytes acted on were the bytes signed. Anything wider moves provider internals into a terminal.
    expect(statement).not.toMatch(/raw_body(?!_sha256)/);
    expect(statement.match(/raw_body_sha256/g)?.length ?? 0).toBeGreaterThan(0);
    expect(() => observeOrderSql({ orderId: 'not-a-uuid' })).toThrow(/order/);
  });

  it('CD-13b: names only columns the schema has, and reads the provider from the attempt, not the quote', () => {
    const statement = observeOrderSql({ orderId: ORDER });

    // The projection is the contract, so each group is read out of the `json_build_object` calls and
    // checked name by name against the DDL. The counts are pinned too: a field the sweep cannot see is
    // invisible to the containment loop, and that is precisely how a `raw_body_sha256` slips past a
    // column class that stops at its first digit.
    const GROUPS = { o: 13, e: 19, a: 9, r: 9, en: 5 };
    for (const [alias, fields] of Object.entries(GROUPS)) {
      const projected = projectedFields(statement, alias);
      expect(projected, `the ${alias} object projects no fields`).not.toHaveLength(0);
      expect(projected.map(({ key }) => key), `the ${alias} object renames a field as it reports it`)
        .toEqual(projected.map(({ column }) => column));
      expect(new Set(projected.map(({ column }) => column)).size,
        `the ${alias} object projects ${fields} distinct fields`)
        .toBe(fields);
      for (const { column } of projected) {
        expect(OBSERVED[alias], `${alias}.${column} is not a column of the relation that alias stands for`)
          .toContain(column);
      }
    }

    // Anything the statement reaches for outside a projection — the `WHERE` and the `ORDER BY` — is held
    // to the same inventory, so no qualified reference is unchecked.
    for (const { alias, column } of namedColumns(statement)) {
      expect(OBSERVED[alias], `${alias} is an alias this observation does not declare`).toBeDefined();
      expect(OBSERVED[alias], `${alias}.${column} is not a column of the relation that alias stands for`)
        .toContain(column);
    }

    // The four price fields the quote froze, and the state the machine moved it to, are all reportable;
    // `provider` is not one of them. It belongs to the attempt the provider named and to the delivery
    // that arrived, so a provider column on the order would be a second, unsynchronised answer to
    // "who was paid", which is the divergence §2 of the design exists to prevent.
    const orderFields = projectedFields(statement, 'o').map(({ column }) => column);
    for (const column of ['price_version', 'amount_minor', 'currency', 'status', 'merchant_reference',
      'quote_expires_at', 'entitlement_id']) {
      expect(orderFields, `the order object reports the frozen ${column}`).toContain(column);
    }
    expect(orderFields).not.toContain('provider');
    // An attempt is where a provider reference lives, and both of the names it can carry are read, with
    // the two timestamps that separate initiation from confirmation.
    const attemptFields = projectedFields(statement, 'a').map(({ column }) => column);
    expect(attemptFields).toEqual(expect.arrayContaining(['provider', 'environment',
      'provider_order_ref', 'provider_payment_ref', 'initiated_at', 'confirmed_at', 'failed_at']));
    // A refund's kind is what separates money back from a dispute, and §9 treats them differently.
    const refundFields = projectedFields(statement, 'r').map(({ column }) => column);
    expect(refundFields).toEqual(expect.arrayContaining(['kind', 'status', 'amount_minor', 'event_id']));
    // The digest is the field that proves the bytes acted on were the bytes signed; it is projected, and
    // nothing beside it is.
    expect(projectedFields(statement, 'e').map(({ column }) => column)).toContain('raw_body_sha256');
  });

  it('CD-14: bends nothing, so a value that carries a quote still makes exactly one statement', () => {
    const statement = quoteOrderSql({
      weddingId: WEDDING, packageCode: "p'); DROP TABLE private.commerce_orders;--", actorUserId: ACTOR,
    });
    expect(statement).toContain("'p''); DROP TABLE private.commerce_orders;--'::text");
    expect((statement.match(/convert_to/g) ?? [])).toHaveLength(1);
    expect((statement.match(/internal_api\.create_commerce_order/g) ?? [])).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ the synthetic signers

describe('the synthetic delivery signers', () => {
  it('CD-15: signs each provider\u2019s real scheme, checked against an independent HMAC in this file', () => {
    const body = captureBody();
    const signed = razorpayDelivery({ body, secret: SECRET, eventId: 'evt_genuine_0001' });
    expect(signed.provider).toBe('razorpay');
    expect(signed.rawBody).toBe(body);
    expect(signed.headers[RAZORPAY_SIGNATURE_HEADER])
      .toBe(createHmac('sha256', SECRET).update(Buffer.from(body, 'utf8')).digest('hex'));
    expect(signed.headers[RAZORPAY_EVENT_ID_HEADER]).toBe('evt_genuine_0001');

    const other = cashfreeDelivery({ body, secret: SECRET, timestamp: TS });
    expect(other.headers[CASHFREE_SIGNATURE_HEADER])
      .toBe(createHmac('sha256', SECRET).update(Buffer.from(`${TS}.${body}`, 'utf8')).digest('base64'));
    expect(other.headers[CASHFREE_TIMESTAMP_HEADER]).toBe(TS);
  });

  it('CD-16: signs bytes and not a document, so a re-serialised body carries a different digest', () => {
    const a = razorpayDelivery({ body: '{"b":2,"a":1}', secret: SECRET, eventId: 'e1' });
    const b = razorpayDelivery({ body: '{"a":1,"b":2}', secret: SECRET, eventId: 'e1' });
    expect(a.headers[RAZORPAY_SIGNATURE_HEADER]).not.toBe(b.headers[RAZORPAY_SIGNATURE_HEADER]);
    expect(sha256Of(a.rawBody)).toBe(sha256Hex('{"b":2,"a":1}'));
  });

  it('CD-17: refuses to sign without a key, and never carries the key in what it returns', () => {
    expect(() => razorpayDelivery({ body: '{}', secret: '', eventId: 'e1' })).toThrow(/secret/);
    expect(() => razorpayDelivery({ body: '{}', secret: SECRET })).toThrow(/event/i);
    expect(() => cashfreeDelivery({ body: '{}', secret: SECRET, timestamp: '0' })).toThrow(/timestamp/);
    expect(() => cashfreeDelivery({ body: '{}', secret: SECRET, timestamp: '1760000000.5' })).toThrow(/timestamp/);
    for (const delivery of [
      razorpayDelivery({ body: '{}', secret: SECRET, eventId: 'e1' }),
      cashfreeDelivery({ body: '{}', secret: SECRET, timestamp: TS }),
    ]) {
      expect(JSON.stringify(delivery)).not.toContain(SECRET);
    }
  });

  it('CD-18: a delivery the signer built is accepted by the verifier it is meant to feed', () => {
    const body = captureBody();
    const delivery = razorpayDelivery({ body, secret: SECRET, eventId: 'evt_genuine_0001' });
    const verdict = verifyProviderWebhook({
      provider: 'razorpay', rawBody: delivery.rawBody, headers: delivery.headers,
      secret: SECRET, environment: 'synthetic',
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.kind).toBe('payment_captured');
    expect(verdict.facts.merchantReference).toBe('vv1_orderreference');
    expect(verdict.rawBodySha256).toBe(sha256Of(body));
  });
});

// ------------------------------------------------------------------ verdict to fifteen values

describe('turning a verdict into the ledger\u2019s fifteen values', () => {
  it('CD-19: a verified capture fills every fact position and marks the delivery verified', () => {
    const verdict = verifyProviderWebhook({
      provider: 'razorpay',
      ...razorpayDelivery({ body: captureBody(), secret: SECRET, eventId: 'evt_genuine_0001' }),
      secret: SECRET, environment: 'synthetic',
    });
    expect(verdict.ok, 'the fixture this case turns into fifteen values is a delivery the verifier accepts').toBe(true);
    const args = verifiedEventArgs(verdict, { environment: 'synthetic', actorUserId: ACTOR });
    expect(args[1]).toBe("'evt_genuine_0001'::text");
    expect(args[6]).toBe('true');
    expect(args[7]).toBe('NULL::text');
    expect(args[8]).toBe("'vv1_orderreference'::text");
    expect(args[9]).toBe('499900');
    expect(args[10]).toBe("'INR'::text");
    expect(args[11]).toBe("'order_MOCK1'::text");
    expect(args[12]).toBe("'pay_MOCK1'::text");
    expect(args[13]).toBe(`'${OCCURRED}'::timestamptz`);
    expect(args[14]).toBe(`'${ACTOR}'::uuid`);
  });

  it('CD-20: a verified event this build does not act on is recorded with no facts invented for it', () => {
    const args = verifiedEventArgs(
      {
        ok: true, provider: 'razorpay', eventId: 'evt_x', eventType: 'something.new', kind: 'other',
        environment: 'synthetic', rawBodySha256: sha256Hex('{}'), occurredAt: null,
      },
      { environment: 'synthetic', actorUserId: ACTOR },
    );
    expect(args[2]).toBe("'something.new'::text");
    expect(args[3]).toBe("'other'::text");
    expect(args[6]).toBe('true');
    expect(args.slice(7, 14)).toEqual(['NULL::text', 'NULL::text', 'NULL::bigint', 'NULL::text',
      'NULL::text', 'NULL::text', 'NULL::timestamptz']);
  });

  it('CD-21: refuses a non-verdict, and one whose environment is not the one declared', () => {
    expect(() => verifiedEventArgs({ ok: false, reason: 'signature_mismatch' },
      { environment: 'synthetic', actorUserId: ACTOR })).toThrow(/not a verified/);
    const verdict = {
      ok: true, provider: 'razorpay', eventId: 'e', eventType: 'x', kind: 'other',
      environment: 'live', rawBodySha256: sha256Hex('{}'), occurredAt: null,
    };
    expect(() => verifiedEventArgs(verdict, { environment: 'synthetic', actorUserId: ACTOR }))
      .toThrow(/environment/);
  });

  it('CD-22: a refusal keeps the verifier\u2019s reason verbatim and nothing else from the bytes', () => {
    const args = refusedEventArgs({
      provider: 'razorpay', eventId: 'evt_forged', rawBodySha256: sha256Hex('{}'),
      reason: 'signature_mismatch', environment: 'synthetic', actorUserId: ACTOR,
    });
    expect(args).toEqual([
      "'razorpay'::text", "'evt_forged'::text", 'NULL::text', "'other'::text", "'synthetic'::text",
      `'${sha256Hex('{}')}'::text`, 'false', "'signature_mismatch'::text", 'NULL::text', 'NULL::bigint',
      'NULL::text', 'NULL::text', 'NULL::text', 'NULL::timestamptz', `'${ACTOR}'::uuid`,
    ]);
  });

  it('CD-23: a forged capture cannot reach the ledger even when its body copies a real one exactly', () => {
    const body = captureBody('vv1_THE_PRICE_OF_A_WEDDING');
    const delivery = razorpayDelivery({ body, secret: 'a-different-key', eventId: 'evt_genuine_0001' });
    const { calls, sql } = recordingChannel({ disposition: 'recorded', processing_status: 'rejected_signature' });
    const outcome = runDelivery({
      sql, delivery, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW,
    });
    expect(calls).toHaveLength(1);
    const sent = calls[0];
    expect(sent).toContain("'signature_mismatch'::text");
    expect(sent).toContain("'other'::text");
    expect(sent).toContain('false');
    expect(sent).not.toContain('vv1_THE_PRICE_OF_A_WEDDING');
    expect(sent).not.toContain('499900');
    expect(sent).not.toContain('payment_captured');
    expect(sent).toContain("'synthetic'::text");
    expect(sent).not.toContain("'live'::text");
    expect(outcome.verified).toBe(false);
    expect(outcome.reason).toBe('signature_mismatch');
  });

  it('CD-24: the digest recorded is the one computed from these bytes, not the one the delivery claimed', () => {
    const body = captureBody();
    const delivery = razorpayDelivery({ body, secret: SECRET, eventId: 'evt_1' });
    delivery.raw_body_sha256 = 'deadbeef'.repeat(8);
    const { calls, sql } = recordingChannel();
    runDelivery({ sql, delivery, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW });
    expect(calls[0]).toContain(`'${sha256Hex(body)}'::text`);
    expect(calls[0]).not.toContain('deadbeef');
  });
});

// ------------------------------------------------------------------ the identity of a refusal

describe('what a refused delivery may be recorded as being', () => {
  it('CD-25: takes a Razorpay identity from the header, because that is the transport\u2019s own claim', () => {
    expect(claimedRefusalIdentity({
      provider: 'razorpay', headers: { [RAZORPAY_EVENT_ID_HEADER]: ' evt_1 ' },
    })).toBe('evt_1');
    expect(claimedRefusalIdentity({
      provider: 'razorpay', headers: { 'X-Razorpay-Event-Id': 'evt_2' },
    })).toBe('evt_2');
  });

  it('CD-26: refuses a blank, oversized, odd-charactered or absent identity instead of quoting it in', () => {
    for (const value of ['', '   ', 'a'.repeat(MAX_EVENT_ID_LENGTH + 1), 'evt\u00071', "evt'1", 'evt 1']) {
      expect(claimedRefusalIdentity({ provider: 'razorpay', headers: { [RAZORPAY_EVENT_ID_HEADER]: value } }))
        .toBe(null);
    }
    expect(claimedRefusalIdentity({ provider: 'razorpay', headers: {} })).toBe(null);
    // Cashfree names no event identity in a header at all: its id is inside the body, and an
    // unauthenticated body has no readable name. So a refused Cashfree delivery is not ledgerable.
    expect(claimedRefusalIdentity({
      provider: 'cashfree', headers: { [CASHFREE_SIGNATURE_HEADER]: 'x', [CASHFREE_TIMESTAMP_HEADER]: TS },
      rawBody: JSON.stringify({ notification_id: 'notif_from_an_unverified_body' }),
    })).toBe(null);
  });

  it('CD-27: sends no statement when a refusal has no trustworthy identity to name', () => {
    const forged = {
      provider: 'cashfree',
      rawBody: JSON.stringify({ notification_id: 'notif_stolen', notification_type: 'PAYMENT_STATE_CHANGED' }),
      headers: { [CASHFREE_SIGNATURE_HEADER]: 'A'.repeat(43) + '=', [CASHFREE_TIMESTAMP_HEADER]: TS },
    };
    const { calls, sql } = recordingChannel();
    const outcome = runDelivery({ sql, delivery: forged, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW });
    expect(calls).toEqual([]);
    expect(outcome.recorded).toBe(false);
    expect(outcome.refusal).toBe('no_trusted_event_identity');
    expect(outcome.reason).toBe('signature_mismatch');
    expect(outcome.statement).toBe(null);
  });

  it('CD-28: a forged delivery and the genuine delivery of the same bytes are two statements, and only the second carries facts', () => {
    // Two deliveries, one body. The forged one carries the identity the genuine one will arrive under,
    // because that is what the transport claims. What this pins is the pair the ledger's repaired
    // idempotency key needs in order to tell them apart: the same digest arriving twice, once with
    // `signature_valid = false` and once with `true`, and the facts present in exactly one of the two.
    // The pre-repair key was the identity alone, so the first of these two statements chose the answer to
    // the second — the poisoning `20261020120000_stage10_event_redelivery.sql` removes, measured red as
    // P04 in `q10-logs/s10r-P-red-2.txt` and green as P24..P27 of the ledger battery.
    const body = captureBody('vv1_orderreference', 'evt_shared');
    const genuine = razorpayDelivery({ body, secret: SECRET, eventId: 'evt_shared' });
    const forged = razorpayDelivery({ body, secret: 'a-different-key', eventId: 'evt_shared' });
    const { calls, sql } = recordingChannel();
    const first = runDelivery({ sql, delivery: forged, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW });
    expect(first.verified).toBe(false);
    expect(first.recorded).toBe(true);
    expect(calls[0]).toContain("'signature_mismatch'::text");
    const forgedDigest = sha256Of(forged.rawBody);
    expect(calls[0]).toContain(`'${forgedDigest}'::text`);
    expect(calls[0]).toContain('false');
    runDelivery({ sql, delivery: genuine, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW });
    // This instrument records both deliveries under the identity the transport claimed, which is the
    // ledger's own design. What it must never do is let the *unverified* one supply a fact: the forged
    // row carries no merchant reference and no amount, so the order it names is untouched either way.
    expect(calls[0]).not.toContain('vv1_orderreference');
    expect(calls[1]).toContain('vv1_orderreference');
    // The one thing this case is really about: the two statements describe the same bytes, so the only
    // difference the ledger can key on is the verification it was told about.
    expect(sha256Of(genuine.rawBody)).toBe(forgedDigest);
    expect(calls[1]).toContain(`'${forgedDigest}'::text`);
    expect(calls[1]).toContain('true');
  });
});

// ------------------------------------------------------------------ runDelivery

describe('one delivery through the trusted channel', () => {
  it('CD-29: verifies the bytes, records once, and returns the ledger\u2019s own answer', () => {
    const answer = { disposition: 'applied', order_status: 'captured', state_changed: true };
    const { calls, sql } = recordingChannel(answer);
    const outcome = runDelivery({
      sql,
      delivery: razorpayDelivery({ body: captureBody(), secret: SECRET, eventId: 'evt_genuine_0001' }),
      secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('internal_api.record_commerce_event(');
    expect(outcome).toMatchObject({ verified: true, reason: null, recorded: true, result: answer });
  });

  it('CD-30: a replay sends the same statement again, because the ledger is the only idempotency authority', () => {
    const { calls, sql } = recordingChannel({ disposition: 'already_recorded' });
    const delivery = razorpayDelivery({ body: captureBody(), secret: SECRET, eventId: 'evt_genuine_0001' });
    runDelivery({ sql, delivery, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW });
    const second = runDelivery({ sql, delivery, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect(second.result.disposition).toBe('already_recorded');
  });

  it('CD-31: a signed but stale delivery is a refusal, and this instrument has no identity to ledger it under', () => {
    const stale = cashfreeDelivery({ body: '{}', secret: SECRET, timestamp: '1700000000' });
    const { calls, sql } = recordingChannel();
    const outcome = runDelivery({ sql, delivery: stale, secret: SECRET, environment: 'synthetic', actorUserId: ACTOR, now: NOW });
    expect(outcome.reason).toBe('timestamp_stale');
    expect(outcome.refusal).toBe('no_trusted_event_identity');
    expect(calls).toEqual([]);
  });

  it('CD-32: refuses to verify anything without a key, an environment or an actor, before a byte is read', () => {
    const delivery = razorpayDelivery({ body: captureBody(), secret: SECRET, eventId: 'evt_1' });
    const { sql } = recordingChannel();
    expect(() => runDelivery({ sql, delivery, secret: '', environment: 'synthetic', actorUserId: ACTOR }))
      .toThrow(/secret/);
    expect(() => runDelivery({ sql, delivery, secret: SECRET, environment: 'production', actorUserId: ACTOR }))
      .toThrow(/environment/);
    expect(() => runDelivery({ sql, delivery, secret: SECRET, environment: 'synthetic', actorUserId: 'nope' }))
      .toThrow(/actor/);
    expect(() => runDelivery({
      sql, delivery: { provider: 'paypal', rawBody: '{}', headers: {} },
      secret: SECRET, environment: 'synthetic', actorUserId: ACTOR,
    })).toThrow(/provider/);
  });

  it('CD-33: the declared environments are exactly the four the ledger accepts, and case is not a knob', () => {
    expect(ENVIRONMENTS).toEqual(['synthetic', 'sandbox', 'test', 'live']);
    expect(() => runDelivery({
      sql: () => 'e30=', delivery: { provider: 'razorpay', rawBody: '{}', headers: {} },
      secret: SECRET, environment: 'SYNTHETIC', actorUserId: ACTOR,
    })).toThrow(/environment/);
  });
});

// ------------------------------------------------------------------ the channels and the output

describe('the channels and what may be printed', () => {
  it('CD-34: decodes exactly one base64 line, and a line that is not one ends the run', () => {
    expect(decodeLine(b64({ a: 1 }))).toEqual({ a: 1 });
    expect(decodeLine(`  ${b64({ a: 2 })}  `)).toEqual({ a: 2 });
    expect(() => decodeLine('not base64 json')).toThrow(/cannot trust/);
  });

  it('CD-35: asserts standard_conforming_strings before a literal can be sent', () => {
    const seen = [];
    expect(ensureSafeEncoding((statement) => { seen.push(statement); return 'on'; })).toBe('on');
    expect(seen[0]).toMatch(/standard_conforming_strings/i);
    for (const answer of ['off', 'ON', '', 'on extra']) {
      expect(() => ensureSafeEncoding(() => answer)).toThrow(/standard_conforming_strings/);
    }
  });

  it('CD-36: a line that contains the secret it was handed is never printed', () => {
    expect(() => assertSecretFree(`order granted, key=${SECRET}`, SECRET)).toThrow(/secret/);
    expect(() => assertSecretFree('order granted', SECRET)).not.toThrow();
    expect(() => assertSecretFree('order granted', '')).toThrow(/secret/);
  });

  it('CD-37: exports exactly the surface this battery reads, and no DELETE builder', () => {
    // A trusted instrument grows worst by acquiring a new verb nobody reviewed. The list is the review.
    expect(surface).toEqual([
      'ENVIRONMENTS', 'MAX_EVENT_ID_LENGTH', 'RECORD_EVENT_ARGS',
      'assertSecretFree', 'cashfreeDelivery', 'claimedRefusalIdentity', 'decodeLine',
      'ensureSafeEncoding', 'expireOrderSql', 'grantEntitlementSql', 'observeOrderSql', 'parseArgs',
      'quoteOrderSql', 'razorpayDelivery', 'readOptions', 'reconcileOrderSql', 'recordEventSql',
      'refusedEventArgs', 'resolveTarget', 'revocationSql', 'runDelivery', 'runPsql', 'sha256Of',
      'sqlBigInt', 'sqlBool', 'sqlLiteral', 'sqlText', 'sqlTimestamp', 'sqlUuid', 'verifiedEventArgs',
    ]);
    // Nothing in this tool deletes: the migration's own rule (§9) is that an entitlement is revoked by a
    // UPDATE and no order, event or ledger row is ever removed.
    expect(surface.filter((name) => /delete|remove|truncate|drop/i.test(name))).toEqual([]);
  });
});

// ------------------------------------------------------------------ the command line

describe('the target and secret gates on the command line', () => {
  const MAINT_URL = 'postgresql://postgres:pw@127.0.0.1:55441/postgres';

  it('CD-38: takes a container or a loopback URL named by an environment variable, and nothing else', () => {
    expect(resolveTarget({ 'via-docker': 'supabase_db_localvivaahvarnam' }))
      .toEqual({ mode: 'docker', container: 'supabase_db_localvivaahvarnam' });
    expect(resolveTarget({ 'db-url-env': true }, { VIVAAHVARNAM_MAINT_DB_URL: MAINT_URL }))
      .toEqual({ mode: 'url', url: MAINT_URL });
    expect(() => resolveTarget({})).toThrow(/no maintenance target/);
    expect(() => resolveTarget({ 'via-docker': 'postgres' })).toThrow(/container/);
    expect(() => resolveTarget({ 'via-docker': 'supabase_db_x.supabase.co' })).toThrow(/refused/);
    expect(() => resolveTarget({ 'db-url-env': true }, {})).toThrow(/VIVAAHVARNAM_MAINT_DB_URL/);
    expect(() => resolveTarget({ 'db-url-env': true }, { VIVAAHVARNAM_MAINT_DB_URL: 'postgresql://postgres:pw@db.supabase.co:5432/postgres' }))
      .toThrow(/hosted/);
    expect(() => resolveTarget({ 'db-url-env': true }, { VIVAAHVARNAM_MAINT_DB_URL: 'postgresql://postgres:pw@10.1.2.3:5432/postgres' }))
      .toThrow(/loopback/);
    expect(() => resolveTarget({ 'db-url-env': true }, { VIVAAHVARNAM_MAINT_DB_URL: 'not a url' })).toThrow(/parse/);
  });

  it('CD-39: a secret or a connection string on argv is refused, not read', () => {
    const base = ['deliver', '--via-docker', 'supabase_db_localvivaahvarnam',
      '--delivery-file', 'd.json', '--secret-env', 'S10_KEY', '--actor', ACTOR];
    expect(readOptions(parseArgs(base), { S10_KEY: SECRET }).secret).toBe(SECRET);
    for (const flag of ['--secret', '--db-url', '--service-key', '--apikey', '--password', '--webhook-key']) {
      expect(() => readOptions(parseArgs([...base, flag, 'value']), { S10_KEY: SECRET }))
        .toThrow(/environment variable/);
    }
    expect(() => readOptions(parseArgs(base), {})).toThrow(/S10_KEY/);
    expect(() => readOptions(parseArgs(base), { S10_KEY: '   ' })).toThrow(/S10_KEY/);
  });

  it('CD-40: every money command names its own actor, and no command takes an amount', () => {
    const key = { S10_KEY: SECRET };
    const target = ['--via-docker', 'supabase_db_localvivaahvarnam'];
    expect(readOptions(parseArgs(['quote', ...target, '--wedding', WEDDING, '--package', 'varnam_plus',
      '--actor', ACTOR]), key))
      .toMatchObject({ command: 'quote', weddingId: WEDDING, packageCode: 'varnam_plus', actorUserId: ACTOR });
    expect(readOptions(parseArgs(['revoke', ...target, '--order', ORDER, '--actor', ACTOR,
      '--reason', 'refund_succeeded']), key).reason).toBe('refund_succeeded');
    expect(() => readOptions(parseArgs(['revoke', ...target, '--order', ORDER, '--actor', ACTOR]), key))
      .toThrow(/reason/);
    expect(() => readOptions(parseArgs(['quote', ...target, '--wedding', WEDDING, '--package', 'x',
      '--actor', ACTOR, '--amount', '1']), key)).toThrow(/amount/);
    expect(() => readOptions(parseArgs(['quote', ...target, '--wedding', 'not-a-uuid', '--package', 'x',
      '--actor', ACTOR]), key)).toThrow(/wedding/);
    expect(() => readOptions(parseArgs(['observe', ...target]), key)).toThrow(/order/);
  });

  it('CD-41: sign needs no database, every other command needs one, and an unknown command is refused', () => {
    const signed = readOptions(parseArgs(['sign', '--provider', 'razorpay', '--body-file', 'b.json',
      '--secret-env', 'S10_KEY', '--event-id', 'evt_1']), { S10_KEY: SECRET });
    expect(signed.command).toBe('sign');
    expect(signed.target).toBe(null);
    expect(() => readOptions(parseArgs(['sign', '--provider', 'razorpay', '--body-file', 'b.json',
      '--secret-env', 'S10_KEY']), { S10_KEY: SECRET })).toThrow(/event/);
    expect(() => readOptions(parseArgs(['deliver', '--delivery-file', 'd.json', '--secret-env', 'S10_KEY',
      '--actor', ACTOR]), { S10_KEY: SECRET })).toThrow(/no maintenance target/);
    expect(() => readOptions(parseArgs(['teleport', '--via-docker', 'supabase_db_localvivaahvarnam'])))
      .toThrow(/unknown command/);
    expect(() => readOptions(parseArgs([]))).toThrow(/usage/);
  });

  it('CD-42: a local instrument never declares a live environment', () => {
    const target = ['--via-docker', 'supabase_db_localvivaahvarnam'];
    const base = ['deliver', ...target, '--delivery-file', 'd.json', '--secret-env', 'S10_KEY', '--actor', ACTOR];
    expect(readOptions(parseArgs([...base, '--environment', 'sandbox']), { S10_KEY: SECRET }).environment)
      .toBe('sandbox');
    expect(readOptions(parseArgs(base), { S10_KEY: SECRET }).environment).toBe('synthetic');
    expect(() => readOptions(parseArgs([...base, '--environment', 'live']), { S10_KEY: SECRET }))
      .toThrow(/live/);
    expect(() => readOptions(parseArgs([...base, '--environment', 'test2']), { S10_KEY: SECRET }))
      .toThrow(/environment/);
  });
});
