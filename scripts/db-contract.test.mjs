import { describe, expect, it } from "vitest";
import {
  extractDataLayerQueries,
  parseGeneratedTypes,
  parseMigrations,
  runChecks,
  selfTest,
  splitStatements,
} from "./check-db-contract.mjs";

describe("database contract checker", () => {
  it("passes its own fixture assertions", () => {
    expect(selfTest()).toEqual([]);
  });

  it("treats a comment as a comment, even one holding a semicolon", () => {
    const statements = splitStatements(
      `-- not a statement; at all\nCREATE TABLE public.a (id uuid);\nSELECT 1;`,
    );
    expect(statements.map((s) => s.trim().replace(/\s+/g, " "))).toEqual([
      "CREATE TABLE public.a (id uuid)",
      "SELECT 1",
    ]);
  });

  it("folds forward-only migrations into the end state", () => {
    const { tables, unparsed } = parseMigrations({
      "1.sql": "CREATE TABLE public.projects (id uuid, paid_status text);\nCREATE TABLE public.weddings (id uuid);",
      "2.sql": "ALTER TABLE public.projects SET SCHEMA legacy;",
    });
    expect(unparsed).toEqual([]);
    expect([...tables.keys()].sort()).toEqual(["legacy.projects", "public.weddings"]);
  });

  it("reads only Row keys out of the generated types", () => {
    const tables = parseGeneratedTypes(
      ["      weddings: {", "        Row: {", "          id: string;", "        };",
       "        Insert: {", "          only_in_insert?: string;", "        };", "      };"].join("\n"),
    );
    expect([...tables.get("weddings")]).toEqual(["id"]);
  });

  it("inlines a shared column list instead of reading its variable name", () => {
    const queries = extractDataLayerQueries(
      ["const WEDDING_COLUMNS =", "  'id, title';", "supabase.from('weddings').select(`${WEDDING_COLUMNS}, created_at`).eq('owner_user_id', u);"].join("\n"),
    );
    expect(queries).toEqual([{ table: "weddings", columns: ["id", "title", "created_at", "owner_user_id"] }]);
  });

  it("agrees with the repository as it stands", () => {
    const { findings, stats } = runChecks();
    expect(findings).toEqual([]);
    // Non-zero on purpose: an empty inventory would make the run above trivially true.
    expect(stats.publicTables).toBeGreaterThan(0);
    expect(stats.clientTypeTables).toBe(stats.publicTables);
    expect(stats.dataLayerQueries).toBeGreaterThan(0);
    expect(stats.nonClientTables).toBeGreaterThan(0);
  });
});
