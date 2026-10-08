// Stage 6, app tier: what the tab decides before it asks the stack anything.
//
// Audit §6 assigns two attack cases a half at this tier — A8 ("HTTP + app-level unit") and A9
// ("app unit + SQL + HTTP") — and §5.3 makes the call sequence a product rule rather than an
// implementation detail. This file measures those two things and nothing else: the refusals the
// adapter reaches for on its own, the payload it sends, and the order of the calls it makes.
//
// Boundary, stated because a passing suite here proves less than it looks like it does. There is
// no network, no PostgREST, no Storage service and no Postgres in this file. `fileRefusal`'s and
// `contentRefusal`'s verdicts are checked as *decisions*, not as bytes: the file object stands for
// the three facts the adapter reads off a `File` (`size`, `type` and the head it slices) and passes
// through untouched, so nothing here can show that a browser reads a real file's size, type or
// first bytes correctly. Whether the bucket actually refuses a 5 MiB + 1 upload, whether
// `allowed_mime_types` is enforced at the edge, whether the minting trigger refuses a presented key
// and whether the confirmation edge compares claims to objects — those are the SQL tier
// (`supabase/tests/stage6/`) and the HTTP tier
// (`supabase/tests/api/stage6_storage.test.mjs`), and no assertion below may be read as them.
//
// What a refusal must mean here is specific: the adapter's own rule is that nothing is asked of the
// stack at all. So every pre-flight case asserts both the sentence and that zero steps were
// recorded — a gate that returns the right words after already writing a row would be a gate that
// leaves the orphan it claims to avoid.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeResponse = { data: unknown; error: unknown };
type Step = { ns: "db" | "storage"; method: string; args: unknown[] };

const fake = vi.hoisted(() => {
  const state: { steps: Step[]; db: FakeResponse[]; storage: Record<string, FakeResponse> } = {
    steps: [],
    db: [],
    storage: {},
  };

  const answer = (operation: string): Promise<FakeResponse> => {
    const planned = state.storage[operation];
    if (planned === undefined) {
      // Same rule `src/test/fakeSupabase.ts` records: an unplanned call is not a silent success.
      return Promise.reject(new Error(`no planned storage response for "${operation}"`));
    }
    return Promise.resolve(planned);
  };

  class Chain {
    constructor(private readonly table: string) {}

    private record(method: string, ...args: unknown[]): this {
      state.steps.push({ ns: "db", method, args });
      return this;
    }

    from(table: string): this {
      return this.record("from", table);
    }
    select(columns: string): this {
      return this.record("select", columns);
    }
    insert(values: unknown): this {
      return this.record("insert", values);
    }
    update(values: unknown): this {
      return this.record("update", values);
    }
    delete(): this {
      return this.record("delete");
    }
    eq(column: string, value: unknown): this {
      return this.record("eq", column, value);
    }
    order(column: string, options?: unknown): this {
      return this.record("order", column, options);
    }

    then<TResult>(onfulfilled: (value: FakeResponse) => TResult, onrejected?: (reason: unknown) => TResult) {
      return Promise.resolve()
        .then(() => {
          const next = state.db.shift();
          if (next === undefined) throw new Error(`no planned response for table "${this.table}"`);
          return next;
        })
        .then(onfulfilled, onrejected);
    }
  }

  const client = {
    from(table: string): Chain {
      return new Chain(table).from(table);
    },
    storage: {
      from(bucket: string) {
        return {
          upload(key: unknown, file: unknown, options: unknown): Promise<FakeResponse> {
            state.steps.push({ ns: "storage", method: "upload", args: [bucket, key, file, options] });
            return answer("upload");
          },
          remove(keys: unknown): Promise<FakeResponse> {
            state.steps.push({ ns: "storage", method: "remove", args: [bucket, keys] });
            return answer("remove");
          },
          createSignedUrl(key: unknown, expiresIn: unknown): Promise<FakeResponse> {
            state.steps.push({ ns: "storage", method: "createSignedUrl", args: [bucket, key, expiresIn] });
            return answer("createSignedUrl");
          },
        };
      },
    },
  };

  return {
    client,
    /** Queue the answers the registry table should hand back, in call order. */
    planDb(...responses: FakeResponse[]): void {
      state.db = [...responses];
      state.storage = {};
      state.steps = [];
    },
    /** Declare which Storage calls this scenario answers; an undeclared call rejects. */
    planStorage(responses: Record<string, FakeResponse>): void {
      state.storage = { ...responses };
    },
    steps(): Step[] {
      return state.steps.map((step) => ({ ...step }));
    },
    /** The calls themselves, in order. A chain's builder steps (`from`, `eq`, `order`, `select`)
     *  are part of one call rather than separate requests, and the sequences §5.3 names are
     *  sequences of calls — so a sequence assertion that counted builders would be measuring the
     *  client library's chaining style instead of the adapter's ordering. */
    ops(): string[] {
      const callVerbs = new Set(["insert", "update", "delete", "upload", "remove", "createSignedUrl"]);
      return state.steps.filter((s) => callVerbs.has(s.method)).map((s) => `${s.ns}:${s.method}`);
    },
    /** Responses still sitting in the queue when a test ends. Checked after every test, because a
     *  plan that queues more answers than the adapter consumes is the mirror image of an unplanned
     *  call: both let a scenario pass while describing a sequence that did not happen. */
    dbRemaining(): number {
      return state.db.length;
    },
    payload(method: string): Record<string, unknown> {
      const step = state.steps.find((s) => s.ns === "db" && s.method === method);
      const value = step?.args[0];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`no ${method}() payload was sent`);
      }
      return value as Record<string, unknown>;
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: fake.client }));

import {
  listAssets,
  previewAsset,
  removeAsset,
  replaceAsset,
  uploadAsset,
  type AssetDraft,
  type AssetEntry,
} from "@/integrations/supabase/weddingAssets";

const WEDDING = "33333333-3333-4333-8333-333333333333";
const OTHER_WEDDING = "44444444-4444-4444-8444-444444444444";
const ROW = "55555555-5555-4555-8555-555555555555";
const PREVIOUS_ROW = "66666666-6666-4666-8666-666666666666";

/** The ceiling the Stage 6 migration writes into `storage.buckets.file_size_limit`, spelled here on
 *  purpose: if the adapter's constant and the bucket's ever disagree, the boundary cases below are
 *  the tripwire, in the direction where a client that got looser would start sending bytes the
 *  bucket would refuse. */
const CEILING = 5242880;

/** Deliberately NOT the grammar the minter produces for `WEDDING`. A key built from a template on
 *  this side would still look well-formed, so a read-back key that cannot be derived from anything
 *  in this file is the only shape that can tell "used the row's key" from "rebuilt the key". */
const READ_BACK_KEY = "weddings/00000000-0000-4000-8000-000000000000/photo/99999999-9999-4999-8999-999999999999";
const PREVIOUS_KEY = "weddings/00000000-0000-4000-8000-000000000000/photo/88888888-8888-4888-8888-888888888888";

// A `File` is read for three facts and then passed through, so the stand-in carries exactly those
// three. Producing a real 5 MiB buffer would measure the browser, not this adapter.
const ascii = (run: string): Uint8Array => new Uint8Array([...run].map((char) => char.charCodeAt(0)));

/** One head per accepted type, long enough for the longest marker the adapter looks for (WebP's
 *  second half sits at byte 8). These are the same markers `matchesSignature` names, so a case that
 *  sends one is asserting the adapter's *decision*, not the existence of the format. */
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);
const WEBP_HEAD = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), 0x56, 0x4c]);
const MP3_HEAD = new Uint8Array([...ascii("ID3"), 3, 0, 0, 0, 0, 0]);
/** Markup, sent behind a declaration the bucket accepts — the exact shape the Stage 6 HTTP battery
 *  measured as stored-and-confirmed, and the reason this gate exists at all. */
const HTML_HEAD = ascii("<html><body><img src=x onerror=alert(1)>");
const SVG_HEAD = ascii('<svg xmlns="http://www.w3.org/2000/svg" onload=alert(1)>');

const HEAD_BY_TYPE: Record<string, Uint8Array> = {
  "image/png": PNG_HEAD,
  "image/jpeg": JPEG_HEAD,
  "image/webp": WEBP_HEAD,
  "audio/mpeg": MP3_HEAD,
};

const file = (size: number, type: string, head?: Uint8Array): File => {
  const bytes = head ?? HEAD_BY_TYPE[type] ?? PNG_HEAD;
  return {
    size,
    type,
    name: "upload",
    // `contentRefusal` takes the head through the same two calls a browser would: `slice` then
    // `arrayBuffer`. Handing it a Blob stand-in keeps this file off the browser's byte reading.
    slice: () => ({ arrayBuffer: () => Promise.resolve(bytes.slice().buffer) }),
  } as unknown as File;
};

/** The same stand-in, with the head read counted. `contentRefusal` is a pure function of
 *  `draft.mimeType` and the file's first `SIGNATURE_BYTES`, so a second call with the same two
 *  arguments cannot answer differently — it can only read the host's bytes again. This is what makes
 *  a duplicated gate visible to the suite instead of merely invisible in review. */
const headCountingFile = (type: string, reads: { count: number }): File => {
  const bytes = HEAD_BY_TYPE[type] ?? PNG_HEAD;
  return {
    size: 1024,
    type,
    name: "upload",
    slice: () => {
      reads.count += 1;
      return { arrayBuffer: () => Promise.resolve(bytes.slice().buffer) };
    },
  } as unknown as File;
};

const draft = (overrides: Partial<AssetDraft> = {}): AssetDraft => ({
  assetKind: "photo",
  label: "Hall entrance",
  mimeType: "image/png",
  sizeBytes: 1024,
  ...overrides,
});

const rowFor = (id: string, key: string, status: AssetEntry["uploadStatus"]): Record<string, unknown> => ({
  id,
  wedding_id: WEDDING,
  asset_kind: "photo",
  label: "Hall entrance",
  object_key: key,
  mime_type: "image/png",
  size_bytes: 1024,
  upload_status: status,
});

const okRow = (id: string, key: string, status: AssetEntry["uploadStatus"] = "staged"): FakeResponse => ({
  data: [rowFor(id, key, status)],
  error: null,
});

const okInsert = okRow(ROW, READ_BACK_KEY);

const refusedWith = (message: string, code: string): FakeResponse => ({
  data: null,
  error: { message, details: "", hint: "", code },
});

const noBytes = (): FakeResponse => ({ data: null, error: null });

const entry = (id: string, key: string, uploadStatus: AssetEntry["uploadStatus"]): AssetEntry => ({
  id,
  weddingId: WEDDING,
  assetKind: "photo",
  label: "Hall entrance",
  objectKey: key,
  mimeType: "image/png",
  sizeBytes: 1024,
  uploadStatus,
});

beforeEach(() => {
  fake.planDb();
});

afterEach(() => {
  expect(fake.dbRemaining()).toBe(0);
});

describe("the pre-flight gate: a refusal that asks for nothing", () => {
  it("sends a legal file at the ceiling, so every refusal below is measured against a working control", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    const out = await uploadAsset(WEDDING, draft({ sizeBytes: CEILING }), file(CEILING, "image/png"));
    expect(out.error).toBe(null);
    expect(fake.ops()).toEqual(["db:insert", "storage:upload", "db:update"]);
  });

  it("refuses an SVG by name and asks the stack for nothing at all", async () => {
    const out = await uploadAsset(WEDDING, draft({ mimeType: "image/svg+xml" }), file(1024, "image/svg+xml"));
    expect(out.error).toMatch(/accepted types/);
    expect(fake.steps()).toEqual([]);
  });

  it("refuses HTML, the shape that would otherwise reach a renderer", async () => {
    const out = await uploadAsset(WEDDING, draft({ mimeType: "text/html" }), file(1024, "text/html"));
    expect(out.error).toMatch(/accepted types/);
    expect(fake.steps()).toEqual([]);
  });

  it("refuses a file with no declared type, which is what a download with no type arrives as", async () => {
    const out = await uploadAsset(WEDDING, draft({ mimeType: "application/octet-stream" }), file(1024, "application/octet-stream"));
    expect(out.error).toMatch(/accepted types/);
    expect(fake.steps()).toEqual([]);
  });

  it("refuses one byte over the ceiling, and not the ceiling itself", async () => {
    const out = await uploadAsset(WEDDING, draft({ sizeBytes: CEILING + 1 }), file(CEILING + 1, "image/png"));
    expect(out.error).toMatch(/larger than/);
    expect(fake.steps()).toEqual([]);
  });

  it("refuses a file with no bytes rather than registering a row that could never be confirmed", async () => {
    const out = await uploadAsset(WEDDING, draft({ sizeBytes: 0 }), file(0, "image/png"));
    expect(out.error).toMatch(/no bytes/);
    expect(fake.steps()).toEqual([]);
  });

  it("refuses an asset whose kind the host has not chosen, before any file fact is consulted", async () => {
    const out = await uploadAsset(WEDDING, draft({ assetKind: "   " }), file(1024, "image/png"));
    expect(out.error).toMatch(/kind of asset/);
    expect(fake.steps()).toEqual([]);
  });

  it("does not refuse a kind it has never heard of: the table's CHECK owns that answer, and no second vocabulary lives here", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    const out = await uploadAsset(WEDDING, draft({ assetKind: "generated_output" }), file(1024, "image/png"));
    expect(out.error).toBe(null);
    expect(fake.payload("insert")).toMatchObject({ asset_kind: "generated_output" });
  });
});

describe("the byte gate: a type claim that has to mean the file's own head", () => {
  // The shape the Stage 6 HTTP battery (`UPL-07`, capture `s6-api-run-03.log`) measured reaching a
  // running stack: markup bytes behind a declaration the bucket accepts. The server answered that the
  // object was stored as declared, so this gate is the only place in the product that compares the
  // claim to the bytes.
  it("refuses markup bytes declared as an accepted image type, and asks the stack for nothing", async () => {
    const html = await uploadAsset(WEDDING, draft(), file(HTML_HEAD.length, "image/png", HTML_HEAD));
    expect(html.error).toMatch(/does not hold the bytes/);
    expect(fake.steps()).toEqual([]);

    const svg = await uploadAsset(WEDDING, draft(), file(SVG_HEAD.length, "image/png", SVG_HEAD));
    expect(svg.error).toMatch(/does not hold the bytes/);
    expect(fake.steps()).toEqual([]);
  });

  it("refuses a real signature that belongs to another accepted type, so the gate is per-type and not a hunt for any magic", async () => {
    const out = await uploadAsset(WEDDING, draft({ mimeType: "image/webp" }), file(1024, "image/webp", PNG_HEAD));
    expect(out.error).toMatch(/does not hold the bytes/);
    expect(fake.steps()).toEqual([]);
  });

  it("refuses a file too short to carry the signature it claims", async () => {
    const out = await uploadAsset(WEDDING, draft(), file(2, "image/png", new Uint8Array([0x89, 0x50])));
    expect(out.error).toMatch(/does not hold the bytes/);
    expect(fake.steps()).toEqual([]);
  });

  it("sends each accepted type whose own signature is present, so no class is refused by the gate", async () => {
    const cases: Array<[string, string, Uint8Array]> = [
      ["photo", "image/png", PNG_HEAD],
      ["photo", "image/jpeg", JPEG_HEAD],
      ["photo", "image/webp", WEBP_HEAD],
      ["audio", "audio/mpeg", MP3_HEAD],
    ];
    for (const [assetKind, mimeType, head] of cases) {
      fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
      fake.planStorage({ upload: noBytes() });
      const out = await uploadAsset(WEDDING, draft({ assetKind, mimeType }), file(1024, mimeType, head));
      expect(`${assetKind}/${mimeType}: ${out.error}`).toBe(`${assetKind}/${mimeType}: null`);
      expect(fake.ops()).toEqual(["db:insert", "storage:upload", "db:update"]);
    }
  });

  it("reads the head from the file rather than from the declaration, so a re-declared file cannot talk its way past", async () => {
    // Same bytes, two claims: the JPEG signature is what decides, not the string in the draft.
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    const honest = await uploadAsset(WEDDING, draft({ mimeType: "image/jpeg" }), file(1024, "image/jpeg", JPEG_HEAD));
    expect(honest.error).toBe(null);
    fake.planDb();

    const relabelled = await uploadAsset(WEDDING, draft(), file(1024, "image/png", JPEG_HEAD));
    expect(relabelled.error).toMatch(/does not hold the bytes/);
    expect(fake.steps()).toEqual([]);
  });

  it("reaches for the file's head once per upload, so the gate is a check and not a re-read", async () => {
    // A gate is a decision point; the same decision computed twice adds nothing to it and costs the
    // host a second read of their own bytes. Stage 7 found `uploadAsset` awaiting `contentRefusal`
    // twice with the same two arguments; the Stage 7 audit records the finding and its repair.
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    const reads = { count: 0 };
    const out = await uploadAsset(WEDDING, draft(), headCountingFile("image/png", reads));
    expect(out.error).toBe(null);
    expect(reads.count).toBe(1);
  });
});

describe("what crosses the wire on the register step", () => {
  it("sends no object_key in any shape — the key is the database's to mint", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    const payload = fake.payload("insert");
    expect(Object.keys(payload).sort()).toEqual(["asset_kind", "label", "mime_type", "size_bytes", "wedding_id"]);
    expect(payload).not.toHaveProperty("object_key");
  });

  it("writes the bytes at the key the inserted row reported, not at one rebuilt from a template", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    const upload = fake.steps().find((s) => s.method === "upload");
    expect(upload?.args[0]).toBe("wedding-assets");
    expect(upload?.args[1]).toBe(READ_BACK_KEY);
  });

  it("asks for no overwrite: the option is sent as false, and the only storage verbs used are the three it may use", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    const upload = fake.steps().find((s) => s.method === "upload");
    expect((upload?.args[3] as { upsert?: unknown }).upsert).toBe(false);
    const used = new Set(fake.steps().filter((s) => s.ns === "storage").map((s) => s.method));
    expect([...used].sort()).toEqual(["upload"]);
  });

  it("reads the object type from the draft, so the claim it registers is the claim it confirms", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    await uploadAsset(WEDDING, draft({ mimeType: "audio/mpeg", assetKind: "audio" }), file(1024, "audio/mpeg"));
    expect(fake.payload("insert")).toMatchObject({ mime_type: "audio/mpeg", size_bytes: 1024 });
    expect(fake.payload("update")).toMatchObject({ mime_type: "audio/mpeg", size_bytes: 1024, upload_status: "ready" });
  });
});

describe("the sequence, and the two rollbacks", () => {
  it("happy path is register, then bytes, then confirm, once each, in that order", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY, "ready"));
    fake.planStorage({ upload: noBytes() });
    const out = await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    expect(fake.ops()).toEqual(["db:insert", "storage:upload", "db:update"]);
    expect(out.error).toBe(null);
    expect(out.data?.uploadStatus).toBe("ready");
  });

  it("bytes refused: the staged row is removed and no confirmation is attempted", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY));
    fake.planStorage({ upload: refusedWith("Stored object size is above the configured limit", "400") });
    const out = await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    expect(out.error).toMatch(/could not be stored/);
    expect(fake.ops()).toEqual(["db:insert", "storage:upload", "db:delete"]);
  });

  it("a failed upload removes the row the same call created, addressed by its own id and wedding", async () => {
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY));
    fake.planStorage({ upload: refusedWith("the service is unreachable", "TypeError") });
    await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    const eqPairs = fake.steps().filter((s) => s.method === "eq").map((s) => [s.args[0], s.args[1]]);
    expect(eqPairs).toEqual([
      ["id", ROW],
      ["wedding_id", WEDDING],
    ]);
  });

  it("confirmation refused for a claim that does not match the object: the pair is retired tombstone, collect, delete", async () => {
    fake.planDb(
      okInsert,
      refusedWith("the object is stored as image/png, but this row claims image/jpeg", "42501"),
      okRow(ROW, READ_BACK_KEY, "tombstoned"),
      okRow(ROW, READ_BACK_KEY, "tombstoned"),
    );
    fake.planStorage({ upload: noBytes(), remove: { data: [READ_BACK_KEY], error: null } });
    const out = await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    expect(fake.ops()).toEqual([
      "db:insert",
      "storage:upload",
      "db:update",
      "db:update",
      "storage:remove",
      "db:delete",
    ]);
    expect(out.error).toMatch(/did not match/);
    // The database's own sentence names columns, constraints and policies. The host is told the
    // adapter's phrase instead — that boundary is `src/lib/safeError.ts`, and this is the one
    // place in Stage 6 where a refusal's prose would otherwise reach a family member's screen.
    expect(out.error).not.toContain("image/png");
  });

  it("the mismatch sentence is the 42501 answer alone: another code is not reported as a claim disagreement", async () => {
    fake.planDb(
      okInsert,
      refusedWith("new row violates row-level security policy", "23505"),
      okRow(ROW, READ_BACK_KEY, "tombstoned"),
      okRow(ROW, READ_BACK_KEY, "tombstoned"),
    );
    fake.planStorage({ upload: noBytes(), remove: { data: [READ_BACK_KEY], error: null } });
    const out = await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    expect(out.error).not.toMatch(/did not match/);
    expect(out.error).toBeTruthy();
  });

  it("an update that matches no row is a failure, not an empty success: that is how an RLS no-op stays visible", async () => {
    fake.planDb(
      okInsert,
      { data: [], error: null },
      okRow(ROW, READ_BACK_KEY, "tombstoned"),
      okRow(ROW, READ_BACK_KEY, "tombstoned"),
    );
    fake.planStorage({ upload: noBytes(), remove: { data: [READ_BACK_KEY], error: null } });
    const out = await uploadAsset(WEDDING, draft(), file(1024, "image/png"));
    expect(out.data).toBeNull();
    expect(out.error).toBeTruthy();
    expect(fake.ops()).toContain("storage:remove");
  });

  it("removing a tombstoned row finishes the two steps that remain rather than re-tombstoning a terminal state", async () => {
    fake.planDb(okRow(ROW, READ_BACK_KEY));
    fake.planStorage({ remove: { data: [READ_BACK_KEY], error: null } });
    const out = await removeAsset(entry(ROW, READ_BACK_KEY, "tombstoned"));
    expect(fake.ops()).toEqual(["storage:remove", "db:delete"]);
    expect(out.error).toBe(null);
  });

  it("removing a live asset goes tombstone, collect, delete — the only order the two guards accept", async () => {
    fake.planDb(okRow(ROW, READ_BACK_KEY, "tombstoned"), okRow(ROW, READ_BACK_KEY, "tombstoned"));
    fake.planStorage({ remove: { data: [READ_BACK_KEY], error: null } });
    const out = await removeAsset(entry(ROW, READ_BACK_KEY, "ready"));
    expect(fake.ops()).toEqual(["db:update", "storage:remove", "db:delete"]);
    expect(fake.payload("update")).toEqual({ upload_status: "tombstoned" });
    expect(out.error).toBe(null);
  });

  it("bytes that cannot be collected stop the sequence before the row is deleted, so no pointer is lost", async () => {
    fake.planDb(okRow(ROW, READ_BACK_KEY, "tombstoned"));
    fake.planStorage({ remove: refusedWith("the service is unreachable", "TypeError") });
    const out = await removeAsset(entry(ROW, READ_BACK_KEY, "ready"));
    expect(fake.ops()).toEqual(["db:update", "storage:remove"]);
    expect(out.error).toMatch(/still listed/);
  });

  it("a replacement that fails leaves the previous asset completely untouched", async () => {
    // Two answers: the new row is registered, and the failed upload takes it back out. The
    // previous asset is the one that must not appear in either.
    fake.planDb(okInsert, okRow(ROW, READ_BACK_KEY));
    fake.planStorage({ upload: refusedWith("the service is unreachable", "TypeError") });
    const out = await replaceAsset(WEDDING, entry(PREVIOUS_ROW, PREVIOUS_KEY, "ready"), draft(), file(1024, "image/png"));
    expect(out.error).toBeTruthy();
    const touched = JSON.stringify(fake.steps());
    expect(touched).not.toContain(PREVIOUS_ROW);
    expect(touched).not.toContain(PREVIOUS_KEY);
    expect(fake.ops().filter((m) => m === "storage:remove")).toEqual([]);
  });
});

describe("the two reads a host is entitled to", () => {
  it("asks the owning bucket for a short-lived URL and refuses an answer that carries none", async () => {
    fake.planStorage({ createSignedUrl: { data: { signedUrl: "http://127.0.0.1:54400/object/sign/…" }, error: null } });
    const out = await previewAsset(READ_BACK_KEY);
    expect(out.data).toBe("http://127.0.0.1:54400/object/sign/…");
    const call = fake.steps().find((s) => s.method === "createSignedUrl");
    expect(call?.args[0]).toBe("wedding-assets");
    expect(call?.args[1]).toBe(READ_BACK_KEY);
    expect(typeof call?.args[2]).toBe("number");
    expect((call?.args[2] as number) > 0 && (call?.args[2] as number) <= 60).toBe(true);
  });

  it("a signed-URL answer with no URL in it is a failure, not an empty preview", async () => {
    fake.planStorage({ createSignedUrl: { data: null, error: null } });
    const out = await previewAsset(READ_BACK_KEY);
    expect(out.data).toBeNull();
    expect(out.error).toMatch(/previewed/);
  });

  it("lists every state the wedding's row can be in, with no status filter hiding a half-finished upload", async () => {
    fake.planDb({ data: [rowFor(ROW, READ_BACK_KEY, "staged"), rowFor(PREVIOUS_ROW, PREVIOUS_KEY, "tombstoned")], error: null });
    const out = await listAssets(WEDDING);
    expect(out.data?.map((a) => a.uploadStatus)).toEqual(["staged", "tombstoned"]);
    const eqColumns = fake.steps().filter((s) => s.method === "eq").map((s) => s.args[0]);
    expect(eqColumns).toEqual(["wedding_id"]);
    expect(fake.steps().filter((s) => s.method === "order").map((s) => s.args[0])).toEqual(["created_at", "id"]);
  });

  it("a registry read that errors is reported, and an unplanned read never passes quietly", async () => {
    fake.planDb(refusedWith("permission denied for table wedding_assets", "42501"));
    const out = await listAssets(OTHER_WEDDING);
    expect(out.data).toBeNull();
    expect(out.error).toMatch(/could not be loaded/);
  });
});
