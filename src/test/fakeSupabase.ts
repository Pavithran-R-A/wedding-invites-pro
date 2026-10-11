// A recording stand-in for the generated Supabase client, so the data layer's queries can
// be inspected without a network, a project or a session. This is not a database: RLS lives
// in Postgres and is qualified by supabase/tests/stage2/. What this proves is the client
// half of the contract — which table is named, which columns are read, and what the adapter
// does when the response is an error or an absent row.
//
// `schema('api').rpc(...)` is recorded alongside the table steps because four of the project's
// verbs touch credentials only through an `api` function, and the thing worth asserting about
// those calls is their argument list: a bearer secret in an argument is a bearer secret in a query
// string. A planned response may be queued under a function name exactly as under a table name.

export type FakeStep = { table: string; method: string; args: readonly unknown[] };

export type FakeRpcCall = { schema: string; fn: string; args: Record<string, unknown> };

export type FakeResponse = { data: unknown; error: unknown };

type Plan = Record<string, FakeResponse[]>;

const state: { steps: FakeStep[]; rpcCalls: FakeRpcCall[]; plan: Plan } = {
  steps: [],
  rpcCalls: [],
  plan: {},
};

/** Queue the responses each table or function should hand back, in call order. */
export function planQueries(plan: Plan): void {
  state.plan = plan;
  state.steps = [];
  state.rpcCalls = [];
}

/** Every step recorded since the last `planQueries`, in call order. */
export function recordedSteps(): FakeStep[] {
  return state.steps.map((step) => ({ ...step }));
}

/** Every `rpc()` recorded since the last `planQueries`, in call order. */
export function recordedRpc(): FakeRpcCall[] {
  return state.rpcCalls.map((call) => ({ ...call }));
}

/** The arguments one function was called with, refusing to answer for a call that never happened. */
export function rpcArgsOf(fn: string): Record<string, unknown> {
  const call = state.rpcCalls.find((item) => item.fn === fn);
  if (!call) throw new Error(`api.${fn}() was not called`);
  return call.args;
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

/** Drain one name's queue. A table read and an `api` function call are planned the same way because
 *  both are one named thing the adapter asked about. */
function settleFor(key: string, described: string): FakeResponse {
  const queue = state.plan[key] ?? [];
  const next = queue.shift();
  if (next) return next;
  // An unplanned read is not a silent success: returning `[]` would let a test pass by
  // proving nothing about the response the adapter was written to handle.
  throw new Error(`no planned response for ${described}`);
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
    return settleFor(this.table, `table "${this.table}"`);
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

/** `schema(name)` answers with something that can call a function, which is the only way this
 *  project's credential-touching verbs reach the database. */
class FakeApi {
  constructor(private readonly schemaName: string) {}

  rpc(fn: string, args: Record<string, unknown> = {}): Promise<FakeResponse> {
    state.rpcCalls.push({ schema: this.schemaName, fn, args });
    // Deferred for the same reason as a table read, and unplanned for the same consequence.
    return Promise.resolve().then(() => settleFor(fn, `function "${fn}"`));
  }
}

export const fakeSupabase = {
  from(table: string): FakeChain {
    return new FakeChain(table).from(table);
  },

  schema(name: string): FakeApi {
    return new FakeApi(name);
  },
};

export const databaseError = (message: string, code = "42501"): FakeResponse => ({
  data: null,
  error: { message, details: "", hint: "", code },
});

export const rowReturned = (row: unknown): FakeResponse => ({ data: row, error: null });

export const emptyResult = (): FakeResponse => ({ data: null, error: null });
