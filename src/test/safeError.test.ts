// What a failure may be turned into, and what it may never become.
//
// PostgREST answers a refused RPC with Postgres prose that names tables, constraints and
// policies. Those names are facts about this deployment, and the browser that receives
// them belongs to a visitor — possibly a guest following a shared link. The app's rule is
// that a page shows the phrase its adapter chose, and the only thing carried forward is
// the error's own code.

import { describe, expect, it } from "vitest";
import { classify, codeOf, describe as describeFailure } from "@/lib/safeError";

const databaseError = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "weddings_owner_title_key"',
  details: 'Detail (owner_user_id)=(9c4a1e9c-0000-4000-8000-000000000000) already exists.',
  hint: 'Breaks the exclusion constraint on the weddings table.',
};

describe("classifying a failure", () => {
  it("tells a permission refusal from a data refusal", () => {
    expect(classify({ code: '42501' })).toBe('forbidden');
    expect(classify({ code: 'PGRST106' })).toBe('forbidden');
    expect(classify({ code: 'PGRST202' })).toBe('forbidden');
    expect(classify({ code: 'PGRST205' })).toBe('forbidden');
    expect(classify({ code: '23505' })).toBe('rejected');
    expect(classify({ code: '22P02' })).toBe('rejected');
    expect(classify({ code: '23503' })).toBe('rejected');
  });

  it("tells a transport that never arrived from a server that answered", () => {
    expect(classify(new TypeError('Failed to fetch'))).toBe('unreachable');
    expect(classify({ name: 'AbortError' })).toBe('unreachable');
    expect(classify(new Error('boom'))).toBe('unexpected');
    expect(classify(null)).toBe('unexpected');
    expect(classify('42501')).toBe('unexpected');
    expect(classify(undefined)).toBe('unexpected');
  });

  it("keeps only a printable code", () => {
    expect(codeOf({ code: '42501' })).toBe('42501');
    expect(codeOf({ code: 'PGRST202' })).toBe('PGRST202');
    expect(codeOf({ code: 'not a code, it is a sentence' })).toBe('none');
    expect(codeOf({ code: '42' })).toBe('none');
    expect(codeOf({ code: 'a'.repeat(400) })).toBe('none');
    expect(codeOf({})).toBe('none');
    expect(codeOf(null)).toBe('none');
  });
});

describe("the one log line a failure becomes", () => {
  it("carries the caller's phrase, the kind and the code", () => {
    expect(describeFailure('publication', 'the link could not be published', databaseError)).toBe(
      '[publication] the link could not be published (rejected, code 23505)',
    );
  });

  it("never repeats what the database said", () => {
    const line = describeFailure('weddings', 'this invitation could not be opened', databaseError);
    for (const leaked of [
      'duplicate key',
      'weddings_owner_title_key',
      'exclusion constraint',
      '9c4a1e9c',
      'Breaks',
    ]) {
      expect(line).not.toContain(leaked);
    }
  });

  it("survives a failure that is not an object", () => {
    expect(describeFailure('publication', 'the link could not be published', undefined)).toBe(
      '[publication] the link could not be published (unexpected, code none)',
    );
  });
});
