#!/usr/bin/env node
// VIVAAHVARNAM — the launch checklist, measured from outside both origins.
//
// Why this file exists. Issue #1's P0-5 comment lists five things engineering can do without an owner
// decision; four are built (`src/host/pages-worker.ts` + `scripts/host-response-contract.mjs` for the
// initial-response header contract, the support/privacy request screens, `scripts/deploy-pages.mjs` for the
// free-only hosting configuration). The fifth — "a deterministic externally verifiable launch checklist" —
// had no artefact at all: the launch gate lived in prose, so every re-check re-derived it by hand and two
// re-derivations disagreed. This is that artefact. Every row is a real HTTP request to a real origin, every
// verdict is one of PASS / FAIL / BLOCKED with the observed bytes behind it, and the exit code is never 0
// while a row is still BLOCKED, so "the checklist ran" cannot be read as "the launch is ready".
//
// What it refuses to do, and why each refusal is load-bearing:
//   * **No remote write to the database.** Every Supabase probe is a GET. The exposed-schema question is
//     answered by *selecting a profile* (`Accept-Profile`), never by POSTing an RPC to see whether it
//     resolves — a POST probe against a schema that should be dark would execute a privileged body if the
//     configuration were wrong, which is the one outcome a privacy check must never cause. The single POST
//     in this file is P8, a method-refusal probe to a Pages door: `handleRequest` in
//     `src/host/pages-worker.ts` answers 405 for a token-bearing path before it reads the shell or calls the
//     resolver, so that request cannot reach Supabase at all.
//   * **No credential in argv or output.** The publishable key is read from the environment only and is
//     reported by length and shape. A checklist that prints its own key turns a launch artefact into a leak.
//   * **No vacuous PASS.** S3 is a negative control: a 27-character bogus project ref must *fail* to resolve.
//     If it ever answers, then S1 and S2 were measuring a wildcard rather than this project, and the run is
//     reported as FAIL instead of green. The self-test proves each classifier can emit FAIL as well as PASS.
//   * **No invented expectation.** The migration-state row reports which of three shapes it saw (unapplied /
//     applied-and-empty / applied-with-rows) and only calls it PASS against the phase it was asked about,
//     because "the table is missing" is the correct answer before an apply and a defect after one.
//
// Two PostgREST facts this file is built on, both read from the vendor's own documentation rather than
// assumed, because guessing either one produces a checklist that lies in a different direction:
//   * A relation that is not in the schema cache is **404 `PGRST205`** ("Could not find the table
//     'public.itemsxx' in the schema cache"); `PGRST202` is the *function* code. The repo has measured the
//     table shape too — `docs/audits/stage-3-public-invitation.md` §5.5 records `PGRST205` for six relations
//     that are not addressable REST objects. Expecting `PGRST202` here would score a correct pre-apply
//     origin as FAIL.
//   * The root OpenAPI document describes **only the selected profile's schema**, and by default only the
//     endpoints the requesting role has privileges on (PostgREST, "OpenAPI": the output "depends on the
//     permissions of the role that is contained in the JWT role claim"). So a deny-list read off the root
//     document with a browser key is vacuous: `internal_api`'s privileged bodies are granted to
//     `service_role`, so they would be absent from an anon document even if the schema were exposed. The
//     honest measurement is the profile refusal itself — switching to a schema outside `db-schemas` is
//     **406 `PGRST106`**, and its message enumerates the configured list ("The schema must be one of the
//     following: tenant1, tenant2", PostgREST "Schemas → Restricted schemas"). That refusal is about
//     configuration, not about grants, which is exactly the question S7/S8 ask.
//
// Usage:
//   node scripts/launch-checklist.mjs                          # Supabase rows only; Pages rows BLOCKED
//   node scripts/launch-checklist.mjs --origin https://<project>.pages.dev
//   node scripts/launch-checklist.mjs --phase pre-apply        # expect the chain NOT to be applied yet
//   node scripts/launch-checklist.mjs --self-test              # classifiers only, no network
//   node scripts/launch-checklist.mjs --json                   # machine-readable rows on stdout
//
// Env: VITE_SUPABASE_PUBLISHABLE_KEY (browser-safe; absence makes S4-S8 BLOCKED, never PASS),
//      LAUNCH_SUPABASE_ORIGIN (default https://bohtowyresjgroaeashi.supabase.co),
//      LAUNCH_EVIDENCE_DIR (default ../p1-logs).
// Exit: 0 every row PASS · 1 any FAIL · 2 any BLOCKED and no FAIL · 3 harness failure.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = resolve(process.env.LAUNCH_EVIDENCE_DIR ?? join(ROOT, '..', 'p1-logs'));
const DEFAULT_SUPABASE = 'https://bohtowyresjgroaeashi.supabase.co';
// A ref that cannot exist: 27 characters, outside Supabase's 20-character project-ref shape.
const BOGUS_REF_ORIGIN = `https://${'z'.repeat(27)}.supabase.co`;
const TIMEOUT_MS = 20000;
// The reviewed target for the hosted API setting, not a guess: `supabase/config.toml:32` is
// `schemas = ["public", "api"]`, and README's hosted-apply preflight says to read the hosted list back and
// "set it to exactly `public, api`". No migration in the chain sets it, so on a hosted project this is an
// operator step. S8 measures it in every phase: a platform default that still lists `graphql_public` or
// `storage` is a real deviation from the reviewed configuration and is reported as one, with the observed
// list printed beside the expected one.
const EXPECTED_EXPOSED = ['public', 'api'];
// A schema that must never be selectable as a profile. `internal_api` grants USAGE to anon and
// authenticated on purpose (the "Load-bearing" grant in Stage 3), so exposure — not grants — is the control.
const DARK_PROFILE = 'internal_api';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
const arg = (name, argv) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};

/** One request, never throwing: a network failure is a measurement, not a harness crash. */
async function probe(url, { method = 'GET', headers = {}, body } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      bytes,
      text: bytes.toString('utf8'),
      ms: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, error: String(error?.cause?.code ?? error?.name ?? error), ms: Date.now() - started };
  }
}

const jsonOf = (res) => {
  try {
    return JSON.parse(res.text);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Classifiers. Pure functions over an observed response, so the self-test can
// feed them the FAIL shape as well as the PASS shape. A classifier that cannot
// emit FAIL proves nothing about the origin it is pointed at.
// ---------------------------------------------------------------------------

/** S2: the gateway answered about *keys*, which a wildcard 404 page would not do. */
export const classifyGateway = (res) =>
  res.ok && res.status === 401 && res.text.includes('No API key found in request')
    ? { verdict: 'PASS', detail: `401 + "No API key found in request" (${res.ms} ms)` }
    : {
        verdict: 'FAIL',
        detail: res.ok ? `status ${res.status}, body ${res.text.slice(0, 80)}` : `network ${res.error}`,
      };

/** S3: the control. A bogus ref must NOT resolve; if it does, S1/S2 measured nothing. */
export const classifyBogusControl = (res) =>
  !res.ok
    ? { verdict: 'PASS', detail: `bogus 27-char ref failed at the network layer (${res.error})` }
    : { verdict: 'FAIL', detail: `bogus ref answered ${res.status} — S1/S2 are not project-specific` };

/** S5: three shapes, one phase. `unapplied` is correct before an apply and a defect after one. */
export const classifyMigrationState = (res, phase) => {
  if (!res.ok) return { verdict: 'FAIL', detail: `network ${res.error}` };
  const body = jsonOf(res);
  const code = body && typeof body === 'object' ? body.code : undefined;
  let shape;
  // PGRST205 is the missing-*table* code. PGRST202 (missing function) is deliberately not accepted here:
  // a table probe that came back with a function's error code is not the measurement this row claims.
  if (res.status === 404 && code === 'PGRST205') shape = 'unapplied';
  else if (res.status === 200 && Array.isArray(body) && body.length === 0) shape = 'applied-empty';
  else if (res.status === 200 && Array.isArray(body)) shape = `applied-with-rows(${body.length})`;
  else return { verdict: 'FAIL', detail: `status ${res.status}, code ${code ?? 'none'}, body ${res.text.slice(0, 80)}` };
  const wanted = phase === 'pre-apply' ? 'unapplied' : 'applied-empty';
  return {
    verdict: shape === wanted ? 'PASS' : 'FAIL',
    detail: `shape=${shape} phase=${phase} expected=${wanted}`,
  };
};

/** S6: the api profile's own OpenAPI document must list the public wrapper door. */
export const classifyExposedSet = (paths, { want, deny }) => {
  if (!Array.isArray(paths)) return { verdict: 'FAIL', detail: 'no OpenAPI paths array' };
  const missing = want.filter((p) => !paths.includes(p));
  const leaked = deny.filter((p) => paths.includes(p));
  if (missing.length > 0) return { verdict: 'FAIL', detail: `not exposed: ${missing.join(', ')}` };
  if (leaked.length > 0) return { verdict: 'FAIL', detail: `DARK SCHEMA IS REACHABLE: ${leaked.join(', ')}` };
  return { verdict: 'PASS', detail: `${want.length} expected path(s) present, ${deny.length} denied path(s) absent, ${paths.length} paths total` };
};

/** Read the configured list out of a PGRST106 message. Returns null when it cannot be read. */
export const parseExposedList = (message) => {
  const match = /schema must be one of the following:\s*([^\n]+)/i.exec(message ?? '');
  if (match === null) return null;
  const names = match[1].split(',').map((s) => s.trim().replace(/[."']+$/, '')).filter((s) => s.length > 0);
  return names.length > 0 ? names : null;
};

/**
 * S7: the dark schema must not be selectable as a profile. The verdict is about the *code*, not merely a
 * 4xx: 406/PGRST107 is an invalid Accept media type, which would say nothing about db-schemas, and a 200
 * means the privileged schema answered a browser-key request. Nothing is executed either way.
 */
export const classifyDarkProfile = (res, profile) => {
  if (!res.ok) return { verdict: 'FAIL', detail: `network ${res.error}` };
  const body = jsonOf(res);
  const code = body && typeof body === 'object' ? body.code : undefined;
  if (res.status === 406 && code === 'PGRST106') {
    const list = parseExposedList(body.message);
    return { verdict: 'PASS', detail: `406 PGRST106 for Accept-Profile: ${profile}${list === null ? ' (message did not enumerate the list)' : `; db-schemas = ${list.join(', ')}`}` };
  }
  if (res.status === 200) {
    const paths = body && typeof body === 'object' ? Object.keys(body.paths ?? {}) : [];
    return { verdict: 'FAIL', detail: `DARK SCHEMA IS REACHABLE: Accept-Profile: ${profile} answered 200 with ${paths.length} path(s)${paths.length > 0 ? `, e.g. ${paths.slice(0, 3).join(', ')}` : ''}` };
  }
  return { verdict: 'FAIL', detail: `status ${res.status}, code ${code ?? 'none'} — not the PGRST106 profile refusal, so this row measured nothing; body ${res.text.slice(0, 80)}` };
};

/** S8: the enumerated list must be exactly the reviewed pair. An unreadable list is a FAIL, never a PASS. */
export const classifyExposedEquals = (list, expected) => {
  if (!Array.isArray(list)) return { verdict: 'FAIL', detail: 'the profile refusal did not enumerate db-schemas, so the exposed set is unmeasured' };
  const got = [...list].sort();
  const want = [...expected].sort();
  const same = got.length === want.length && got.every((name, i) => name === want[i]);
  const dark = list.filter((name) => name === DARK_PROFILE || name === 'private');
  return same
    ? { verdict: 'PASS', detail: `db-schemas = ${list.join(', ')} (exactly the reviewed set)` }
    : { verdict: 'FAIL', detail: `db-schemas = ${list.join(', ')}; reviewed set = ${expected.join(', ')}${dark.length > 0 ? `; PRIVILEGED SCHEMA EXPOSED: ${dark.join(', ')}` : ''}` };
};

/** P2-P4: the robots posture must be on the initial response, not in a hydrated DOM. */
export const classifyRobots = (res) => {
  if (!res.ok) return { verdict: 'FAIL', detail: `network ${res.error}` };
  const tag = res.headers['x-robots-tag'] ?? '';
  const has = (word) => new RegExp(`\\b${word}\\b`, 'i').test(tag);
  return res.status === 200 && has('noindex') && has('nofollow')
    ? { verdict: 'PASS', detail: `status 200, x-robots-tag: ${tag}` }
    : { verdict: 'FAIL', detail: `status ${res.status}, x-robots-tag: ${tag || '<absent>'}` };
};

/** P6: two unknown credentials must be indistinguishable, or probing enumerates addresses. */
export const classifyIndifference = (a, b) => {
  if (!a.ok || !b.ok) return { verdict: 'FAIL', detail: `network ${a.error ?? b.error}` };
  const ha = sha(a.bytes);
  const hb = sha(b.bytes);
  return ha === hb
    ? { verdict: 'PASS', detail: `${ha} vs ${hb} (status ${a.status}/${b.status})` }
    : { verdict: 'FAIL', detail: `${ha} vs ${hb} — refusals differ, so probing learns something` };
};

/** P9: no privileged value may be served to a browser, whatever the build environment held. */
export const classifyServedSecrets = (texts) => {
  const hits = [];
  for (const [name, text] of texts) {
    if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(text)) hits.push(`${name}: sb_secret_`);
    if (/postgres(?:ql)?:\/\/[^"'\s]*:[^"'\s]*@/.test(text)) hits.push(`${name}: connection string`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push(`${name}: PEM private key`);
    for (const jwt of text.match(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) ?? []) {
      try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (payload?.role === 'service_role') hits.push(`${name}: service_role JWT`);
      } catch {
        /* not a JWT payload; nothing to report */
      }
    }
  }
  return hits.length === 0
    ? { verdict: 'PASS', detail: `${texts.length} served file(s) scanned, 0 privileged value(s)` }
    : { verdict: 'FAIL', detail: hits.join('; ') };
};

// ---------------------------------------------------------------------------
// The rows.
// ---------------------------------------------------------------------------

async function supabaseRows(origin, key, phase) {
  const rows = [];
  const add = (id, title, result) => rows.push({ id, title, ...result });
  const authHeaders = key ? { apikey: key, authorization: `Bearer ${key}` } : {};

  const health = await probe(`${origin}/auth/v1/health`);
  add(
    'S1',
    'project origin resolves and terminates TLS',
    health.ok
      ? { verdict: 'PASS', detail: `status ${health.status}, server=${health.headers.server ?? '?'}, ${health.ms} ms` }
      : { verdict: 'FAIL', detail: `network ${health.error} after ${health.ms} ms` },
  );

  add('S2', 'the API gateway answers about keys, not a wildcard', classifyGateway(await probe(`${origin}/rest/v1/`)));
  add('S3', 'negative control: a bogus project ref does not resolve', classifyBogusControl(await probe(`${BOGUS_REF_ORIGIN}/auth/v1/health`)));

  if (!key) {
    for (const [id, title] of [
      ['S4', 'the publishable key is accepted and the OpenAPI document is readable'],
      ['S5', 'migration state over REST'],
      ['S6', 'the api profile is exposed and lists the public wrapper door'],
      ['S7', 'internal_api cannot be selected as a profile'],
      ['S8', 'the exposed schema list is exactly the reviewed set'],
    ]) {
      add(id, title, { verdict: 'BLOCKED', detail: 'VITE_SUPABASE_PUBLISHABLE_KEY is not set in this environment' });
    }
    return rows;
  }

  const spec = await probe(`${origin}/rest/v1/`, { headers: { ...authHeaders, accept: 'application/openapi+json' } });
  const doc = spec.ok ? jsonOf(spec) : null;
  const paths = doc && typeof doc === 'object' ? Object.keys(doc.paths ?? {}) : null;
  add(
    'S4',
    'the publishable key is accepted and the OpenAPI document is readable',
    spec.ok && spec.status === 200 && paths !== null
      ? { verdict: 'PASS', detail: `200, ${paths.length} paths in the default profile, key length=${key.length} shape=${key.startsWith('sb_publishable_') ? 'publishable' : 'anon-jwt'}` }
      : { verdict: 'FAIL', detail: spec.ok ? `status ${spec.status}, body ${spec.text.slice(0, 80)}` : `network ${spec.error}` },
  );

  add('S5', 'migration state over REST', classifyMigrationState(await probe(`${origin}/rest/v1/weddings?select=id&limit=1`, { headers: authHeaders }), phase));

  // The api profile's own document. Without `Accept-Profile` the router selects the first configured
  // schema (`public`), where no wrapper is declared, so the door would be absent from a correctly
  // configured project — a false red. With it, a 406/PGRST106 means `api` is not exposed at all, which is
  // the README's "the product fails at its first RPC while the schema looks perfect" case.
  const apiSpec = await probe(`${origin}/rest/v1/`, { headers: { ...authHeaders, accept: 'application/openapi+json', 'accept-profile': 'api' } });
  const apiDoc = apiSpec.ok ? jsonOf(apiSpec) : null;
  const apiPaths = apiDoc && typeof apiDoc === 'object' ? Object.keys(apiDoc.paths ?? {}) : null;
  add(
    'S6',
    'the api profile is exposed and lists the public wrapper door',
    !apiSpec.ok
      ? { verdict: 'FAIL', detail: `network ${apiSpec.error}` }
      : apiSpec.status !== 200
        ? { verdict: 'FAIL', detail: `Accept-Profile: api answered ${apiSpec.status}, code ${apiDoc?.code ?? 'none'} — ${apiSpec.text.slice(0, 120)}` }
        : classifyExposedSet(apiPaths, { want: ['/rpc/resolve_public_invitation'], deny: [] }),
  );

  // One read-only request answers both remaining questions: whether the privileged schema is selectable,
  // and what the configured list actually is. `commerce_reconcile` and `expire_commerce_order` live only in
  // internal_api (measured: zero `FUNCTION api.<name>` definitions for them in supabase/migrations/), so a
  // 200 here would mean those bodies are addressable by a browser key. Nothing is executed to find out.
  const dark = await probe(`${origin}/rest/v1/`, { headers: { ...authHeaders, accept: 'application/openapi+json', 'accept-profile': DARK_PROFILE } });
  add('S7', `${DARK_PROFILE} cannot be selected as a profile`, classifyDarkProfile(dark, DARK_PROFILE));
  const darkBody = dark.ok ? jsonOf(dark) : null;
  add(
    'S8',
    'the exposed schema list is exactly the reviewed set',
    dark.ok && dark.status === 200
      ? { verdict: 'FAIL', detail: `Accept-Profile: ${DARK_PROFILE} answered 200, so there is no refusal to read the configured list from — the privileged schema is exposed (see S7)` }
      : classifyExposedEquals(dark.ok && dark.status === 406 ? parseExposedList(darkBody?.message) : null, EXPECTED_EXPOSED),
  );
  return rows;
}

async function pagesRows(origin, distDir) {
  const blocked = (id, title) => ({ id, title, verdict: 'BLOCKED', detail: 'no deployed origin supplied (--origin)' });
  if (!origin) {
    return [
      ['P1', 'the site answers documents'],
      ['P2', '/i/ carries noindex,nofollow on the initial response'],
      ['P3', '/r/ carries noindex,nofollow on the initial response'],
      ['P4', '/g/ carries noindex,nofollow on the initial response'],
      ['P5', 'robots.txt disallows the three doors'],
      ['P6', 'two unknown credentials are byte-identical refusals'],
      ['P7', 'HEAD matches GET and carries no body'],
      ['P8', 'a door refuses non-document methods'],
      ['P9', 'no privileged value is served to a browser'],
    ].map(([id, title]) => blocked(id, title));
  }

  const rows = [];
  const add = (id, title, result) => rows.push({ id, title, ...result });
  const tokenA = 'launch-checklist-unknown-a-000000000000';
  const tokenB = 'launch-checklist-unknown-b-111111111111';

  const home = await probe(`${origin}/`);
  add('P1', 'the site answers documents', home.ok && home.status === 200 && /<html/i.test(home.text)
    ? { verdict: 'PASS', detail: `200, ${home.bytes.length} bytes, sha ${sha(home.bytes)}` }
    : { verdict: 'FAIL', detail: home.ok ? `status ${home.status}` : `network ${home.error}` });

  for (const [id, door] of [['P2', 'i'], ['P3', 'r'], ['P4', 'g']]) {
    add(id, `/${door}/ carries noindex,nofollow on the initial response`, classifyRobots(await probe(`${origin}/${door}/${tokenA}`)));
  }

  const robots = await probe(`${origin}/robots.txt`);
  const disallows = ['/i/', '/r/', '/g/'].filter((p) => robots.ok && new RegExp(`Disallow:\\s*${p.replace(/\//g, '\\/')}`, 'i').test(robots.text));
  add('P5', 'robots.txt disallows the three doors', robots.ok && robots.status === 200 && disallows.length === 3
    ? { verdict: 'PASS', detail: `200, Disallow for ${disallows.join(' ')}` }
    : { verdict: 'FAIL', detail: robots.ok ? `status ${robots.status}, found ${disallows.length}/3` : `network ${robots.error}` });

  const a = await probe(`${origin}/i/${tokenA}`);
  const b = await probe(`${origin}/i/${tokenB}`);
  add('P6', 'two unknown credentials are byte-identical refusals', classifyIndifference(a, b));

  const head = await probe(`${origin}/i/${tokenA}`, { method: 'HEAD' });
  add('P7', 'HEAD matches GET and carries no body', head.ok && head.status === a.status && head.bytes.length === 0 && (head.headers['x-robots-tag'] ?? '') === (a.headers['x-robots-tag'] ?? '')
    ? { verdict: 'PASS', detail: `status ${head.status}, 0 body bytes, same x-robots-tag` }
    : { verdict: 'FAIL', detail: head.ok ? `status ${head.status}, ${head.bytes.length} body bytes` : `network ${head.error}` });

  const post = await probe(`${origin}/i/${tokenA}`, { method: 'POST' });
  add('P8', 'a door refuses non-document methods', post.ok && post.status === 405 && /GET/i.test(post.headers.allow ?? '') && /HEAD/i.test(post.headers.allow ?? '')
    ? { verdict: 'PASS', detail: `405, allow: ${post.headers.allow}` }
    : { verdict: 'FAIL', detail: post.ok ? `status ${post.status}, allow ${post.headers.allow ?? '<absent>'}` : `network ${post.error}` });

  // Scan what a browser would actually be served: every script the two HTML entries reference.
  const served = [];
  for (const entry of ['/', '/render.html']) {
    const html = await probe(`${origin}${entry}`);
    if (!html.ok) continue;
    for (const src of html.text.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/g) ?? []) {
      const path = src.slice(src.indexOf('"') + 1, -1);
      if (served.some(([name]) => name === path)) continue;
      const file = await probe(`${origin}${path}`);
      if (file.ok) served.push([path, file.text]);
    }
  }
  add('P9', 'no privileged value is served to a browser', served.length === 0
    ? { verdict: 'FAIL', detail: 'no served script could be read, so the scan would be vacuous' }
    : classifyServedSecrets(served));

  // Byte parity against the local build, when one exists: a deployed origin serving different bytes than
  // the tree that was certified is its own defect, and it is cheap to see.
  if (distDir && existsSync(distDir) && a.ok) {
    const local = join(distDir, 'index.html');
    if (existsSync(local)) {
      const same = sha(readFileSync(local)) === sha(home.bytes);
      rows.push({
        id: 'P10',
        title: 'the deployed entry document is the built entry document',
        verdict: same ? 'PASS' : 'FAIL',
        detail: `local ${sha(readFileSync(local))} vs served ${sha(home.bytes)}${same ? '' : ' — rebuild and redeploy before trusting any other row'}`,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Self-test: every classifier must be able to emit FAIL, not only PASS.
// ---------------------------------------------------------------------------

function selfTest() {
  const ok = (res, status, text, headers = {}) => ({ ok: true, status, text, bytes: Buffer.from(text), headers, ms: 1 });
  const net = (error) => ({ ok: false, error, ms: 1 });
  const cases = [
    ['gateway PASS', classifyGateway(ok(null, 401, '{"message":"No API key found in request"}')).verdict, 'PASS'],
    ['gateway FAIL on 200', classifyGateway(ok(null, 200, '{}')).verdict, 'FAIL'],
    ['gateway FAIL on network', classifyGateway(net('ENOTFOUND')).verdict, 'FAIL'],
    ['control PASS', classifyBogusControl(net('ENOTFOUND')).verdict, 'PASS'],
    ['control FAIL when the wildcard answers', classifyBogusControl(ok(null, 401, 'x')).verdict, 'FAIL'],
    ['state pre-apply PASS', classifyMigrationState(ok(null, 404, '{"code":"PGRST205"}'), 'pre-apply').verdict, 'PASS'],
    ['state pre-apply FAIL once applied', classifyMigrationState(ok(null, 200, '[]'), 'pre-apply').verdict, 'FAIL'],
    ['state launch PASS', classifyMigrationState(ok(null, 200, '[]'), 'launch').verdict, 'PASS'],
    ['state launch FAIL when unapplied', classifyMigrationState(ok(null, 404, '{"code":"PGRST205"}'), 'launch').verdict, 'FAIL'],
    ['state FAIL with rows present', classifyMigrationState(ok(null, 200, '[{"id":"x"}]'), 'launch').verdict, 'FAIL'],
    ['state FAIL on the function code, not the table code', classifyMigrationState(ok(null, 404, '{"code":"PGRST202"}'), 'pre-apply').verdict, 'FAIL'],
    ['exposed PASS', classifyExposedSet(['/rpc/resolve_public_invitation'], { want: ['/rpc/resolve_public_invitation'], deny: [] }).verdict, 'PASS'],
    ['exposed FAIL when the door is missing', classifyExposedSet([], { want: ['/rpc/resolve_public_invitation'], deny: [] }).verdict, 'FAIL'],
    ['exposed FAIL when a denied path is present', classifyExposedSet(['/rpc/commerce_reconcile'], { want: [], deny: ['/rpc/commerce_reconcile'] }).verdict, 'FAIL'],
    ['list parsed from the documented refusal', JSON.stringify(parseExposedList('The schema must be one of the following: public, api')), JSON.stringify(['public', 'api'])],
    ['list null when the message does not enumerate', String(parseExposedList('Invalid profile')), 'null'],
    ['dark profile PASS on 406 PGRST106', classifyDarkProfile(ok(null, 406, '{"code":"PGRST106","message":"The schema must be one of the following: public, api"}'), 'internal_api').verdict, 'PASS'],
    ['dark profile FAIL when it answers 200', classifyDarkProfile(ok(null, 200, '{"paths":{"/rpc/commerce_reconcile":{}}}'), 'internal_api').verdict, 'FAIL'],
    ['dark profile FAIL on a different 406', classifyDarkProfile(ok(null, 406, '{"code":"PGRST107"}'), 'internal_api').verdict, 'FAIL'],
    ['dark profile FAIL on network', classifyDarkProfile(net('ENOTFOUND'), 'internal_api').verdict, 'FAIL'],
    ['exposed set PASS on the reviewed pair', classifyExposedEquals(['api', 'public'], EXPECTED_EXPOSED).verdict, 'PASS'],
    ['exposed set FAIL on a platform default', classifyExposedEquals(['public', 'graphql_public', 'storage'], EXPECTED_EXPOSED).verdict, 'FAIL'],
    ['exposed set FAIL when the dark schema is listed', classifyExposedEquals(['public', 'api', 'internal_api'], EXPECTED_EXPOSED).verdict, 'FAIL'],
    ['exposed set FAIL when the list is unreadable', classifyExposedEquals(null, EXPECTED_EXPOSED).verdict, 'FAIL'],
    ['robots PASS', classifyRobots(ok(null, 200, '<html>', { 'x-robots-tag': 'noindex, nofollow' })).verdict, 'PASS'],
    ['robots FAIL when the header is absent', classifyRobots(ok(null, 200, '<html>')).verdict, 'FAIL'],
    ['robots FAIL on noindex alone', classifyRobots(ok(null, 200, '<html>', { 'x-robots-tag': 'noindex' })).verdict, 'FAIL'],
    ['indifference PASS', classifyIndifference(ok(null, 200, 'same'), ok(null, 200, 'same')).verdict, 'PASS'],
    ['indifference FAIL', classifyIndifference(ok(null, 200, 'same'), ok(null, 200, 'different')).verdict, 'FAIL'],
    ['secrets PASS', classifyServedSecrets([['a.js', 'const x = 1;']]).verdict, 'PASS'],
    ['secrets FAIL on sb_secret_', classifyServedSecrets([['a.js', 'sb_secret_abcdefgh12345678']]).verdict, 'FAIL'],
    ['secrets FAIL on a connection string', classifyServedSecrets([['a.js', 'postgres://u:p@h/db']]).verdict, 'FAIL'],
    ['secrets FAIL on a service_role JWT', classifyServedSecrets([['a.js', `${'eyJhbGciOiJIUzI1NiJ9'}.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.${'signature0123456789'}`]]).verdict, 'FAIL'],
    ['secrets PASS on an anon JWT', classifyServedSecrets([['a.js', `${'eyJhbGciOiJIUzI1NiJ9'}.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.${'signature0123456789'}`]]).verdict, 'PASS'],
  ];
  const failed = cases.filter(([, got, want]) => got !== want);
  console.log(`launch-checklist self-test: ${cases.length - failed.length} passed, ${failed.length} failed`);
  for (const [name, got, want] of failed) console.log(`  FAIL ${name}: got ${got}, want ${want}`);
  return failed.length;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    process.exitCode = selfTest() === 0 ? 0 : 1;
    return;
  }
  const origin = arg('origin', argv);
  const supabase = (process.env.LAUNCH_SUPABASE_ORIGIN ?? arg('supabase-origin', argv) ?? DEFAULT_SUPABASE).replace(/\/$/, '');
  const phase = arg('phase', argv) ?? 'launch';
  if (!['launch', 'pre-apply'].includes(phase)) {
    console.error(`unknown --phase ${phase}; expected launch or pre-apply`);
    process.exitCode = 3;
    return;
  }
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  const rows = [...(await supabaseRows(supabase, key, phase)), ...(await pagesRows(origin, join(ROOT, 'dist')))];

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const lines = [
    `launch-checklist — supabase=${supabase} pages=${origin ?? '<none>'} phase=${phase} key=${key ? `present(length=${key.length})` : 'absent'}`,
    ...rows.map((r) => `${r.verdict} ${r.id} ${r.title} — ${r.detail}`),
    `${rows.length} rows: ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('BLOCKED')} BLOCKED`,
  ];
  const text = lines.join('\n');
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ supabase, pages: origin ?? null, phase, rows, totals: { pass: count('PASS'), fail: count('FAIL'), blocked: count('BLOCKED') } }, null, 2));
  } else {
    console.log(text);
  }
  mkdirSync(EVIDENCE, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(EVIDENCE, `launch-checklist-${stamp}.txt`), `${text}\n`);
  console.log(`evidence: ${join(EVIDENCE, `launch-checklist-${stamp}.txt`)}`);
  process.exitCode = count('FAIL') > 0 ? 1 : count('BLOCKED') > 0 ? 2 : 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`harness failure: ${error?.stack ?? error}`);
    process.exitCode = 3;
  });
}
