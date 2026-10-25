import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDomain } from "./check-db-contract.mjs";

// Stage 2 domain contract, tested with no database, and widened by the stages that moved the census.
//
// `supabase/tests/stage2/` proves these properties against a live Postgres catalogue, which is the
// stronger claim — but it needs Docker, and CI has no Postgres job. This file is the same rules
// read out of the migration text and the generated types, so a schema change that violates them
// fails an ordinary `npm test` on any machine. Where a rule appears in both places the catalog
// assertion is named, because a disagreement between the two is the thing worth catching.
//
// Every matcher here is paired with a hostile name it must match. A guard that cannot fire is not
// a guard.
//
// Stage 10 changed one premise. This file was written when the product's money columns were all
// scaffold fiction, so "no live table holds an amount" was the safe rule; Stage 10 built a real
// purchase ledger, and a ledger is made of amounts. The rule that survives is the one the fiction
// actually violated: no amount may live where a client can read or write it. Money is therefore
// allowed in the private commerce tables and nowhere else, and the exposure guard that
// `private.access_tokens` already carries is extended over the whole ledger set, because a price
// the browser can see is a price the browser can change.

const { sources, tables, unparsed, typeTables } = readDomain();

const namesOf = (key) => tables.get(key) ?? [];
const publicKeys = [...tables.keys()].filter((k) => k.startsWith("public."));
const privateKeys = [...tables.keys()].filter((k) => k.startsWith("private."));
const legacyKeys = [...tables.keys()].filter((k) => k.startsWith("legacy."));
const stage2Sql = Object.entries(sources)
  .filter(([name]) => name.includes("_stage2_"))
  .map(([, text]) => text)
  .join("\n");

/**
 * SQL with its prose removed, so a type rule can look at type positions without hunting for
 * English words. This project's migrations explain themselves at length, and the explanations
 * contain words like `money` and `real` that are not types. Per line, so an apostrophe in a
 * comment cannot join two unrelated lines.
 */
const codeOnly = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, "").replace(/'[^']*'/g, "''"))
    .join("\n");

describe("domain contract", () => {
  it("reads the whole migration history without leaving anything unclassified", () => {
    // The inventory below is only as trustworthy as this line: an unparsed statement would mean
    // the assertions are looking at a schema with holes in it.
    expect(unparsed).toEqual([]);
    // 20 since Stage 9 added `public.invitation_outputs`, the render manifest; 19 before that, from
    // Stage 4's `tradition_pack_releases`. The count is the tripwire that makes the inventory
    // assertions below worth reading, and it is not the only one: the line after it names the new
    // table, and `declares to the client exactly the public canonical tables` compares this whole set
    // against the generated client types — so a table that arrived from nowhere cannot pass by only
    // moving the number.
    expect(publicKeys.length).toBe(20);
    expect(publicKeys).toContain("public.invitation_outputs");
    // Eight since Stage 10 added the commerce ledger; two before that. Nothing here reached `public`,
    // which is why the count of public tables did not move with it, and the client-type comparison below
    // is what turns "private" from a name into a claim. Stage 11 moved this list, and the move is the
    // finding: five tables — `operator_grants`, `support_cases`, `support_case_events`,
    // `privacy_requests`, `commerce_review_notes` — arrived in the six `202610201900*`–`202610201905*`
    // migrations and this inventory was never widened, so the tripwire fired instead of the change going
    // unrecorded. All five stay out of the generated types for the reason the ledger does: Stage 11's
    // surface is function doors over this substrate, never a table a browser reads.
    expect(privateKeys.sort()).toEqual([
      "private.access_tokens",
      "private.audit_events",
      "private.commerce_orders",
      "private.commerce_packages",
      "private.commerce_payment_attempts",
      "private.commerce_payment_events",
      "private.commerce_policy",
      "private.commerce_refunds",
      "private.commerce_review_notes",
      "private.operator_grants",
      "private.privacy_requests",
      "private.support_case_events",
      "private.support_cases",
    ]);
    expect(legacyKeys.length).toBe(8);
  });

  // Phase 66 / catalog C43, C44: tradition is something a host selects, never something the
  // database assumes about a person. `varna` is in the list because this product's own name
  // contains it, and a schema column that encoded a hierarchy would most plausibly use that word.
  // A name is matched only when the word stands alone between separators, so `section_key` cannot
  // be caught by the substring `sect` — the near miss that a naive matcher fails on.
  const IDENTITY_VOCABULARY =
    /(^|[^a-z0-9])(caste|subcaste|jati|gotra|varna|community|religion|faith|sect|creed|denomination|ethnic|ethnicity|sampradaya|mother_tongue|blood_group)([^a-z0-9]|$)|inferred/i;

  it("has no column or table that encodes an inherited identity", () => {
    for (const [key, columns] of tables) {
      for (const column of columns) {
        expect(`${key}.${column}`).not.toMatch(IDENTITY_VOCABULARY);
      }
      expect(key).not.toMatch(IDENTITY_VOCABULARY);
    }
  });

  it("refuses the identity vocabulary it claims to refuse", () => {
    for (const hostile of [
      "public.wedding_people.caste",
      "public.weddings.inferred_religion",
      "public.guest_households.community",
      "public.wedding_people.gotra",
      "public.profiles.mother_tongue",
      "public.weddings.varna",
    ]) {
      expect(hostile).toMatch(IDENTITY_VOCABULARY);
    }
    // `section_key` and the pack selection columns are the near misses that must stay legal: the
    // first is a document region, the others are ADR 0003's host-selected behaviour pack, which
    // Stage 4 pointed at a release rather than at a concept.
    for (const allowed of [
      "public.approval_feedback.section_key",
      "public.weddings.tradition_pack_release_id",
      "public.invitation_versions.tradition_pack_release_id",
      "public.tradition_pack_releases.definition",
      "public.tradition_packs.pack_key",
      "public.wedding_people.group_label",
    ]) {
      expect(allowed).not.toMatch(IDENTITY_VOCABULARY);
    }
  });

  it("attaches heritage only to the wedding, never to a person or a guest", () => {
    expect(namesOf("public.weddings")).toContain("tradition_pack_release_id");
    expect(namesOf("public.weddings")).not.toContain("tradition_pack_id");
    for (const key of [
      "public.wedding_people",
      "public.guest_households",
      "public.rsvp_responses",
      "public.profiles",
    ]) {
      for (const column of namesOf(key)) {
        expect(`${key}.${column}`).not.toMatch(/pack|tradition|culture|faith/);
      }
    }
  });

  // Phase 77 / catalog C08, C41: the scaffold's guessed commerce fields must not come back as
  // canonical vocabulary. These are exact names, because `design_template_id` and
  // `estimated_guest_count` are canonical and share their stems with retired columns.
  const RETIRED_EXACT = [
    "paid_status",
    "base_paid",
    "fully_paid",
    "selected_features",
    "guest_count",
    "price_platform_paise",
    "cost_printer_paise",
    "amount_paise",
    "printer_id",
    "api_endpoint",
    "project_id",
    "template_id",
    "language",
  ];

  it("keeps every retired scaffold field out of the client-visible schema", () => {
    for (const key of [...publicKeys, ...privateKeys]) {
      for (const column of namesOf(key)) {
        expect(RETIRED_EXACT, `${key}.${column}`).not.toContain(column);
      }
    }
    expect(namesOf("public.weddings")).toContain("estimated_guest_count");
    expect(namesOf("public.weddings")).toContain("primary_language");
  });

  const MONEY = /(^|[^a-z0-9])(paise|rupees|amount|price|cost|gst|tax|charge|fee)([^a-z0-9]|$)/i;

  /**
   * The private tables Stage 10's ledger put money in, with the money columns each one holds. Listed
   * column by column rather than table by table, so a sixth amount cannot arrive under this comment;
   * the case below also proves the list has no table in it that stopped carrying money.
   */
  const LEDGER_MONEY = new Map([
    ["private.commerce_orders", ["amount_minor", "price_version"]],
    ["private.commerce_packages", ["amount_minor", "price_version"]],
    ["private.commerce_payment_events", ["amount_minor"]],
    ["private.commerce_refunds", ["amount_minor"]],
  ]);

  it("keeps every amount out of the client-visible domain and inside the ledger that owns it", () => {
    for (const key of publicKeys) {
      for (const column of namesOf(key)) {
        expect(`${key}.${column}`).not.toMatch(MONEY);
      }
    }
    const moneyTables = [];
    for (const key of privateKeys) {
      const money = namesOf(key).filter((column) => `${key}.${column}`.match(MONEY));
      if (money.length === 0) continue;
      moneyTables.push(key);
      expect([...LEDGER_MONEY.keys()], `${key} is not a table this rule was written for`).toContain(key);
      expect(money.sort(), `${key} carries money columns this census does not name`).toEqual(LEDGER_MONEY.get(key));
    }
    expect(moneyTables.sort()).toEqual([...LEDGER_MONEY.keys()].sort());
    // The ledger is only a ledger if the client cannot read it: a price a browser can see is a price a
    // browser can quote itself, so none of these tables may reach the generated types.
    for (const key of LEDGER_MONEY.keys()) {
      expect([...typeTables.keys()], key).not.toContain(key.slice("private.".length));
    }
    expect("legacy.payments.amount_paise").toMatch(MONEY);
    expect("public.weddings.fee").toMatch(MONEY);
    expect("public.weddings.preference_level").not.toMatch(MONEY);
    expect("private.commerce_orders.price_version").toMatch(MONEY);
    expect("private.commerce_payment_attempts.confirmed_at").not.toMatch(MONEY);
  });

  it("archives the money history instead of deleting it", () => {
    // The archive-not-delete half of phase 67: no client-visible table may hold an amount, and no
    // migration may drop the ones the scaffold already had.
    expect(namesOf("legacy.payments")).toContain("amount_paise");
    expect(namesOf("legacy.orders")).toContain("price_platform_paise");
    expect(namesOf("legacy.orders")).toContain("cost_printer_paise");
    expect(namesOf("legacy.projects")).toContain("paid_status");
    expect(namesOf("legacy.printers")).toContain("payment_terms");
  });

  it("uses no floating-point type, and numeric only for a coordinate", () => {
    const FLOAT_TYPE = /\b(double precision|float4|float8|real|money)\b/i;
    expect(codeOnly("  latitude double precision,")).toMatch(FLOAT_TYPE);
    expect(codeOnly("-- an account deletion must erase money")).not.toMatch(FLOAT_TYPE);
    expect(codeOnly("  msg text := 'Archived money is real history';")).not.toMatch(FLOAT_TYPE);
    const declarations = codeOnly(stage2Sql);
    expect(declarations).not.toMatch(FLOAT_TYPE);
    const numericLines = declarations
      .split(/\r?\n/)
      .filter((line) => /\bnumeric\b/i.test(line));
    expect(numericLines.length).toBeGreaterThan(0);
    for (const line of numericLines) {
      expect(line.trim().split(" ")[0]).toMatch(/^(latitude|longitude)$/);
    }
  });

  // Phase 68 / catalog C45, C45b, C45c: a credential is stored as a digest, and the digest is a
  // unique key rather than the primary key so a rotation can replace a row's value.
  it("stores credentials as digests and never exposes them to a browser role", () => {
    const tokenColumns = namesOf("private.access_tokens").filter((c) => /token/.test(c));
    expect(tokenColumns.sort()).toEqual(["token_hash", "token_kind"]);
    expect(namesOf("private.access_tokens")).not.toContain("token");
    for (const required of ["expiry_policy", "expires_at", "revoked_at", "wedding_id"]) {
      expect(namesOf("private.access_tokens")).toContain(required);
    }
    for (const serverTable of ["access_tokens", "audit_events"]) {
      expect([...typeTables.keys()], serverTable).not.toContain(serverTable);
    }
  });

  it("declares to the client exactly the public canonical tables", () => {
    expect([...typeTables.keys()].sort()).toEqual(
      publicKeys.map((k) => k.slice("public.".length)).sort(),
    );
    for (const retired of ["projects", "templates", "guests", "orders", "payments", "printers"]) {
      expect([...typeTables.keys()]).not.toContain(retired);
    }
  });

  it("still reads the real files rather than a fixture", () => {
    // If the migration directory moved, `readDomain()` would return an empty inventory and most
    // assertions above would pass vacuously. This one would not.
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(13);
    expect(readFileSync("src/integrations/supabase/weddings.ts", "utf8")).toContain(".from(");
  });
});
