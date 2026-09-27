// A recording stand-in for the generated Supabase client, so the data layer's queries can
// be inspected without a network, a project or a session. This is not a database: RLS lives
// in Postgres and is qualified by supabase/tests/stage2/. What this proves is the client
// half of the contract — which table is named, which columns are read, and what the adapter
// does when the response is an error or an absent row.

export type FakeStep = { table: string; method: string; args: readonly unknown[] };

export type FakeResponse = { data: unknown; error: unknown };

type Plan = Record<string, FakeResponse[]>;

const state: { steps: FakeStep[]; plan: Plan } = {
  steps: [],
  plan: {},
};

/** Queue the responses each table should hand back, in call order. */
export function planQueries(plan: Plan): void {
  state.plan = plan;
  state.steps = [];
}

/** Every step recorded since the last `planQueries`, in call order. */
export function recordedSteps(): FakeStep[] {
  return state.steps.map((step) => ({ ...step }));
}

/** Steps against one table, in call order. */
export function stepsFor(table: string): FakeStep[] {
  return recordedSteps().filter((step) => step.table === table);
}

/** The tables named by `from()`, in call order. */
export function queriedTables(): string[] {
  return state.steps.filter((s) => s.method === "from").map((s) => s.table);
}

/** The object a write was sent with — asserted rather than cast by each test. */
export function payloadOf(table: string, method: string): Record<string, unknown> {
  const step = state.steps.find((s) => s.table === table && s.method === method);
  const value = step?.args[0];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${table}.${method}() was not called with an object payload`);
  }
  return value as Record<string, unknown>;
}

class FakeChain {
  constructor(private readonly table: string) {}

  private record(method: string, ...args: unknown[]): this {
    state.steps.push({ table: this.table, method, args });
    return this;
  }

  from(table: string): this {
    return this.record("from", table);
  }

  select(columns: string): this {
    return this.record("select", columns);
  }

  insert(values: Record<string, unknown>): this {
    return this.record("insert", values);
  }

  update(values: Record<string, unknown>): this {
    return this.record("update", values);
  }

  delete(): this {
    return this.record("delete");
  }

  eq(column: string, value: unknown): this {
    return this.record("eq", column, value);
  }

  in(column: string, values: readonly unknown[]): this {
    return this.record("in", column, values);
  }

  order(column: string, options?: Record<string, unknown>): this {
    return this.record("order", column, options);
  }

  single(): this {
    return this.record("single");
  }

  maybeSingle(): this {
    return this.record("maybeSingle");
  }

  private settle(): FakeResponse {
    const queue = state.plan[this.table] ?? [];
    const next = queue.shift();
    if (next) return next;
    // An unplanned read is not a silent success: returning `[]` would let a test pass by
    // proving nothing about the response the adapter was written to handle.
    throw new Error(`no planned response for table "${this.table}"`);
  }

  then<TResult1 = FakeResponse, TResult2 = never>(
    onfulfilled?: ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    // Deferred so an unplanned read rejects the await instead of throwing out of the
    // caller's synchronous path, which is how a real client would surface it.
    return Promise.resolve()
      .then(() => this.settle())
      .then(onfulfilled, onrejected);
  }
}

export const fakeSupabase = {
  from(table: string): FakeChain {
    return new FakeChain(table).from(table);
  },
};

export const databaseError = (message: string, code = "42501"): FakeResponse => ({
  data: null,
  error: { message, details: "", hint: "", code },
});

export const rowReturned = (row: unknown): FakeResponse => ({ data: row, error: null });

export const emptyResult = (): FakeResponse => ({ data: null, error: null });
