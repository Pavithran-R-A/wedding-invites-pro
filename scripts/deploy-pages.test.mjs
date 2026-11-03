// The deployment gate's guards, enrolled in `npm test` rather than left behind a flag.
//
// `scripts/deploy-pages.mjs` carries its own `--self-test`, because the person standing in front of a
// deploy box should be able to ask "do the guards on this machine work" without a test runner. This
// file is the other half: the same battery, run by vitest (`vitest.config.ts` includes
// `scripts/**/*.test.mjs`), plus the four properties a one-number summary cannot show.
//
//   * **The battery has a size.** `25 passed` means nothing on a machine where the file lost its cases,
//     so the count is asserted before the failures are.
//   * **A refusal the tool prints is the QR door's refusal, not a paraphrase.** The header of
//     `src/render/qrTarget.ts` is explicit that one rule cannot have two spellings; the only way that
//     stays true is if something checks the sentence a deployer reads against the vocabulary the printer
//     publishes.
//   * **Nothing that looks like a value survives the print path or the transcript path.** Tested with a
//     privileged-shaped string in both seats, because the mistake this guards against is a diagnostic
//     added later by somebody who meant well.
//   * **A URL with credentials in it is described by its host alone** — the case where `new URL(x).host`
//     and `new URL(x).href` differ, which is exactly where a password would leak into a log.
//
// What is *not* tested here, because nothing here can test it: that any of this has ever talked to
// Cloudflare. The `--apply` path is unexecuted; see the header of the tool.

import { describe, expect, it } from 'vitest';

import { QR_TARGET_REFUSALS, originRefusal } from '../src/render/qrTarget.ts';
import {
  deploymentUrls,
  describeBinding,
  keyKind,
  planCommands,
  preflight,
  privilegedFindings,
  projectListContains,
  redact,
  selfTestGuards,
} from './deploy-pages.mjs';

const SERVICE_ROLE_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
  '{"role":"service_role","iss":"supabase"}',
).toString('base64url')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

const PUBLISHABLE_URL = 'https://bohtowyresjgroaeashi.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAA';
const CLEAN_BUNDLE = [{ path: 'assets/index.js', text: `${PUBLISHABLE_URL} ${PUBLISHABLE_KEY}` }];
const cleanPreflight = (overrides = {}) =>
  preflight({
    url: PUBLISHABLE_URL,
    key: PUBLISHABLE_KEY,
    builtFiles: CLEAN_BUNDLE,
    missingArtefacts: [],
    existingProject: false,
    allowExistingProject: false,
    ...overrides,
  });

describe('the deploy tool\'s own guard battery', () => {
  const battery = selfTestGuards();

  it('still has its cases in it', () => {
    expect(battery.passed).toBeGreaterThanOrEqual(25);
  });

  it('reports no failing guard', () => {
    expect(battery.failed).toEqual([]);
  });
});

describe('the refusal vocabulary the operator reads', () => {
  it('names a loopback deployment with the printed-address rule, not its own invention', () => {
    const problems = cleanPreflight({ url: 'http://127.0.0.1:54321', key: PUBLISHABLE_KEY });
    const named = problems.find((p) => p.includes('printed-address rule'));
    expect(named).toBeDefined();
    const reason = named.match(/: (target-[a-z-]+)\./)[1];
    expect(QR_TARGET_REFUSALS).toContain(reason);
    expect(originRefusal('http://127.0.0.1:54321')).toBe(reason);
  });

  it('accepts the hosted origin shape the same rule would accept for a printed plate', () => {
    expect(originRefusal(PUBLISHABLE_URL)).toBeNull();
    expect(cleanPreflight().length).toBe(0);
  });
});

describe('nothing privileged-shaped survives a description or a transcript', () => {
  it('describes a secret-shaped key by its length and class only', () => {
    const line = describeBinding('VITE_SUPABASE_PUBLISHABLE_KEY', SERVICE_ROLE_JWT);
    expect(line).not.toContain(SERVICE_ROLE_JWT);
    expect(line).not.toContain('eyJ');
    expect(line).toContain('PRIVILEGED(service-role-jwt)');
  });

  it('describes a URL by its host even when the URL carries credentials', () => {
    const line = describeBinding('VITE_SUPABASE_URL', 'https://postgres:supersecret@db.internal.example:5432');
    expect(line).not.toContain('supersecret');
    expect(line).toContain('host=db.internal.example:5432');
  });

  it('masks a privileged value in captured output, and masks the handed bindings too', () => {
    const masked = redact(`wrangler said: ${SERVICE_ROLE_JWT} accepted`, [SERVICE_ROLE_JWT]);
    expect(masked).not.toContain(SERVICE_ROLE_JWT);
    expect(masked).toContain('masked');
    expect(redact(`binding https://x.supabase.co set`, ['https://x.supabase.co'])).not.toContain(
      'https://x.supabase.co',
    );
  });

  it('keeps the plan free of values, so the printed dry run is safe to paste into an issue', () => {
    const planned = planCommands({
      project: 'pilot',
      branch: 'pilot-staging',
      productionBranch: 'main',
      distDir: '/tmp/dist',
      createProject: true,
      commit: { sha: 'a'.repeat(40), dirty: false, message: 'from a real head' },
    })
      .map((step) => step.argv.join(' '))
      .join('\n');
    expect(planned).not.toContain(PUBLISHABLE_KEY);
    expect(planned).not.toContain(PUBLISHABLE_URL);
    expect(planned).toContain('secret put VITE_SUPABASE_PUBLISHABLE_KEY');
  });

  it('names a browser-safe key by what it is, and refuses to name what it is not', () => {
    expect(keyKind(PUBLISHABLE_KEY)).toBe('supabase-publishable-key');
    expect(keyKind('hunter2')).toBe('unrecognised-key-shape');
    expect(privilegedFindings(PUBLISHABLE_KEY)).toEqual([]);
  });

  it('reads a project name as a table cell, so a domain prefix is not a collision', () => {
    const table = '│ sonamark-web │ sonamark-web.pages.dev │ No │ 1 month ago │';
    expect(projectListContains(table, 'sonamark-web')).toBe(true);
    expect(projectListContains(table, 'sonamark')).toBe(false);
    expect(deploymentUrls('https://abc.pilot.pages.dev and https://pilot.pages.dev')).toHaveLength(2);
  });
});
