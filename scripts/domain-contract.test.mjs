import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDomain } from "./check-db-contract.mjs";

// Stage 2 domain contract, tested with no database.
//
// `supabase/tests/stage2/` proves these properties against a live Postgres catalogue, which is the
// stronger claim — but it needs Docker, and CI has no Postgres job. This file is the same rules
// read out of the migration text and the generated types, so a schema change that violates them
// fails an ordinary `npm test` on any machine. Where a rule appears in both places the catalog
// assertion is named, because a disagreement between the two is the thing worth catching.
//
// Every matcher here is paired with a hostile name it must match. A guard that cannot fire is not
// a guard.

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
    expect(publicKeys.length).toBe(18);
    expect(privateKeys.sort()).toEqual(["private.access_tokens", "private.audit_events"]);
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
    // `section_key` and `tradition_pack_id` are the near misses that must stay legal: the first is
    // a document region, the second is ADR 0003's host-selected behaviour pack.
    for (const allowed of [
      "public.approval_feedback.section_key",
      "public.weddings.tradition_pack_id",
      "public.tradition_packs.pack_key",
      "public.wedding_people.group_label",
    ]) {
      expect(allowed).not.toMatch(IDENTITY_VOCABULARY);
    }
  });

  it("attaches heritage only to the wedding, never to a person or a guest", () => {
    expect(namesOf("public.weddings")).toContain("tradition_pack_id");
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

  it("has no money column in the live domain", () => {
    const MONEY = /(^|[^a-z0-9])(paise|rupees|amount|price|cost|gst|tax|charge|fee)([^a-z0-9]|$)/i;
    for (const key of [...publicKeys, ...privateKeys]) {
      for (const column of namesOf(key)) {
        expect(`${key}.${column}`).not.toMatch(MONEY);
      }
    }
    expect("legacy.payments.amount_paise").toMatch(MONEY);
    expect("public.weddings.fee").toMatch(MONEY);
    expect("public.weddings.preference_level").not.toMatch(MONEY);
  });

  it("archives the money history instead of deleting it", () => {
    // The archive-not-delete half of phase 67: no live table may hold a amount, and no migration
    // may drop the ones the scaffold already had.
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
