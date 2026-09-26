/**
 * Database contract checker — keeps the client's view of the schema honest.
 *
 * `src/integrations/supabase/types.ts` is generated from a real Postgres, and
 * `src/integrations/supabase/*.ts` is the only place that names tables. Both can drift:
 * a migration adds a column nobody regenerates, or a query reaches back for a scaffold
 * table. This script compares the three artifacts with no network, no database and no
 * inference, so CI can prove the client is not pointing at a schema that does not exist.
 *
 * Run with `node <path>` (see the npm scripts); there is deliberately no `#!` line, for the
 * same reason as scripts/check-product-contract.mjs.
 *
 *   node scripts/check-db-contract.mjs              report, exit 1 on findings
 *   node scripts/check-db-contract.mjs --json       machine-readable report
 *   node scripts/check-db-contract.mjs --self-test  verify the parsers themselves
 *
 * What it proves:
 *   1. the tables the migrations leave in `public` are exactly the tables in the types file,
 *      column for column;
 *   2. every column the data layer selects or filters on exists on that table;
 *   3. `private` and `legacy` have no surface in client types;
 *   4. no scaffold column (paid_status, selected_features, …) came back as canonical.
 *
 * Anything the SQL reader cannot classify is reported, never skipped: a silently ignored
 * statement would leave this check green after it had stopped looking.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function resolveRepoRoot() {
  try {
    return dirname(fileURLToPath(new URL(".", import.meta.url)));
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = resolveRepoRoot();
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

const MIGRATIONS_DIR = "supabase/migrations";
const TYPES_FILE = "src/integrations/supabase/types.ts";
const DATA_LAYER_DIR = "src/integrations/supabase";

/** Schemas a browser must never be able to name. */
const NON_CLIENT_SCHEMAS = ["private", "legacy"];

/**
 * Scaffold columns Stage 2 refused to carry forward. Each was either a billing claim
 * (`paid_status`), a bag of unvalidated editor state (`selected_features`), an estimate
 * wearing a fact's clothes (`guest_count`) or money in a column no flow owns. If one
 * reappears on a canonical table, the domain was re-opened without reading
 * `legacy.migration_findings`.
 */
const FORBIDDEN_CANONICAL_COLUMNS = [
  "selected_features",
  "paid_status",
  "base_paid",
  "guest_count",
  "guests",
  "price_platform_paise",
  "template_id",
  "printer_id",
  "printer_endpoint",
  "language",
];

/** Table-level clauses: they describe the table, not a column of it. */
const CONSTRAINT_KEYWORDS = new Set([
  "CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "EXCLUDE", "LIKE",
]);

/**
 * Split SQL into statements, honouring the quoting forms that hide a `;` or a paren:
 * `--` and block comments, `'…'` with `''` escapes, and dollar quoting. Comments become
 * whitespace so line structure stops mattering to the reader.
 */
export function splitStatements(text) {
  const statements = [];
  let current = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (two === "--") {
      while (i < n && text[i] !== "\n") i += 1;
      current += " ";
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      current += " ";
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= n) break;
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") break;
        j += 1;
      }
      current += text.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$([A-Za-z_0-9]*)\$/.exec(text.slice(i));
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length);
        const end = close < 0 ? n : close + tag[0].length;
        // Dollar-quoted bodies are function source, not DDL; keep a marker so the
        // statement still terminates at its own trailing semicolon.
        current += " ";
        i = end;
        continue;
      }
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim().length > 0) statements.push(current);
  return statements;
}

/** The body between the first `(` and the `)` that closes it, or null when unbalanced. */
function parenBody(sql) {
  const open = sql.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return null;
}

/** Split on commas that are not inside parentheses (quotes are already collapsed). */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let chunk = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(chunk);
      chunk = "";
      continue;
    }
    chunk += ch;
  }
  parts.push(chunk);
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 0);
}

const CREATE_TABLE = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\.([a-z_]+)/i;
const SET_SCHEMA = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_]+)\.([a-z_]+)\s+SET\s+SCHEMA\s+([a-z_]+)/i;
/** Column inventory changes this reader cannot fold in. Constraint edits are excluded
 *  deliberately: they change what a column accepts, not which columns exist, and this
 *  check is about the inventory the client types claim. */
const DRIFT = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_]+)\.([a-z_]+)\s+(ADD|DROP|ALTER)\s+COLUMN\b/i;
const RENAME = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_]+)\.([a-z_]+)\s+RENAME/i;
const BARE_CREATE_TABLE = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9]*)\s*\(/i;

/**
 * Migrations are forward-only and ordered, so the schema is their fold: create, then move.
 * Returns `{ tables: Map<'schema.name', string[]>, unparsed: string[] }`.
 */
export function parseMigrations(sources) {
  const tables = new Map();
  const unparsed = [];
  for (const fileName of Object.keys(sources).sort()) {
    for (const statement of splitStatements(sources[fileName])) {
      const created = CREATE_TABLE.exec(statement);
      if (created) {
        const [, schema, table] = created;
        const body = parenBody(statement.slice(created.index + created[0].length));
        if (body === null) {
          unparsed.push(`${fileName}: cannot read the column list of ${schema}.${table}`);
          continue;
        }
        const columns = [];
        for (const chunk of splitTopLevel(body)) {
          const first = chunk.split(" ")[0];
          if (CONSTRAINT_KEYWORDS.has(first)) continue;
          if (!/^[a-z_]+$/.test(first)) {
            unparsed.push(`${fileName}: unparsed clause on ${schema}.${table}: ${first}`);
            continue;
          }
          columns.push(first);
        }
        tables.set(`${schema}.${table}`, columns);
        continue;
      }
      if (BARE_CREATE_TABLE.test(statement)) {
        unparsed.push(`${fileName}: a CREATE TABLE without a schema prefix — qualify it so this check can see it`);
        continue;
      }
      const moved = SET_SCHEMA.exec(statement);
      if (moved) {
        const [, schema, table, target] = moved;
        const key = `${schema}.${table}`;
        if (!tables.has(key)) {
          unparsed.push(`${fileName}: moves ${key} to ${target}, but no earlier statement created it`);
          continue;
        }
        tables.set(`${target}.${table}`, tables.get(key));
        tables.delete(key);
        continue;
      }
      const drift = DRIFT.exec(statement);
      const renamed = drift ? null : RENAME.exec(statement);
      const hit = drift || renamed;
      if (hit) {
        const op = drift ? `${drift[3].toUpperCase()} COLUMN` : "RENAME";
        const key = `${hit[1]}.${hit[2]}`;
        // Only a `public` table's inventory reaches the client types; an edit inside
        // `private` or `legacy` changes nothing this check compares.
        if (hit[1] === "public" && tables.has(key)) {
          unparsed.push(`${fileName}: ${op} on ${key} changes the inventory this check cannot fold — regenerate the types and extend the reader`);
        }
      }
    }
  }
  return { tables, unparsed };
}

/**
 * The generated types file declares each public table as `name: { Row: { col: type } }`.
 * Nullability is irrelevant here; only the names are compared.
 */
export function parseGeneratedTypes(text) {
  const tables = new Map();
  const lines = text.split(/\r?\n/);
  const tableLine = /^ {6}([a-z_]+): \{$/;
  for (let i = 0; i < lines.length; i += 1) {
    const table = tableLine.exec(lines[i]);
    if (!table) continue;
    if (lines[i + 1]?.trim() !== "Row: {") continue;
    const columns = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === "};") {
        tables.set(table[1], columns);
        i = j;
        break;
      }
      const column = /^ {10}([a-z_]+)\??:/.exec(line);
      if (column) columns.push(column[1]);
    }
  }
  return tables;
}

const CALL =
  /\.from\(\s*['"`]([a-z_]+)['"`]\s*\)|\.select\(\s*(['"`])([^'"`]*)\2\s*\)|\.(?:eq|neq|in|gte|lte|order)\(\s*['"`]([a-z_]+)['"`]/g;

/**
 * Every table and column the data layer names, in call order. `select()` arguments are
 * built from a shared constant, so constants are inlined first — otherwise the checker
 * would be reading `WEDDING_COLUMNS` instead of what it stands for.
 */
export function extractDataLayerQueries(text) {
  const constants = {};
  // Matched loosely (`=\s*'…'`) because a long column list is wrapped onto its own line
  // in the data layer; requiring both on one line would silently drop it.
  for (const match of text.matchAll(/const ([A-Z0-9_]+) =\s*'([^']*)'/g)) {
    constants[match[1]] = match[2];
  }
  const inline = (raw) =>
    raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => (name in constants ? constants[name] : `${name}?`));

  const queries = [];
  let current = null;
  for (const match of text.matchAll(CALL)) {
    if (match[1]) {
      current = { table: match[1], columns: [] };
      queries.push(current);
      continue;
    }
    if (!current) continue;
    if (match[3] !== undefined) {
      current.columns.push(...inline(match[3]).split(",").map((c) => c.trim()));
    } else if (match[4]) {
      current.columns.push(match[4]);
    }
  }
  return queries;
}

/** A select token is `column` or `column:alias`; the alias never reaches the schema. */
const bareColumn = (token) => token.split(":")[0].trim();

export function checkContract({ schemaTables, typeTables, queries }) {
  const findings = [];

  const publicTables = [...schemaTables.keys()]
    .filter((key) => key.startsWith("public."))
    .map((key) => key.slice("public.".length))
    .sort();
  const inTypes = [...typeTables.keys()].sort();

  for (const table of publicTables) {
    if (!typeTables.has(table)) {
      findings.push(`public.${table} exists in the schema but is missing from ${TYPES_FILE}`);
    }
  }
  for (const table of inTypes) {
    if (!publicTables.includes(table)) {
      findings.push(`${table} is in ${TYPES_FILE} but no migration leaves it in public`);
    }
  }
  for (const table of inTypes) {
    if (!publicTables.includes(table)) continue;
    const fromSchema = schemaTables.get(`public.${table}`);
    for (const column of fromSchema) {
      if (!typeTables.get(table).includes(column)) {
        findings.push(`column public.${table}.${column} is missing from the generated Row type`);
      }
    }
    for (const column of typeTables.get(table)) {
      if (!fromSchema.includes(column)) {
        findings.push(`column ${table}.${column} is in the generated Row type but not in public.${table}`);
      }
    }
  }

  for (const key of schemaTables.keys()) {
    const [schema, table] = key.split(".");
    if (!NON_CLIENT_SCHEMAS.includes(schema)) continue;
    if (typeTables.has(table)) {
      findings.push(`${key} is a ${schema}-schema table and must not appear in client types`);
    }
  }

  for (const query of queries) {
    if (!typeTables.has(query.table)) {
      findings.push(`${DATA_LAYER_DIR} queries "${query.table}", which the generated types do not describe`);
      continue;
    }
    for (const token of query.columns) {
      const column = bareColumn(token);
      if (!column || column === "*" || column.endsWith("?")) {
        findings.push(`${query.table}: "${token || "(empty)"}" is not a resolvable column — name columns, and keep them literal`);
        continue;
      }
      if (!typeTables.get(query.table).includes(column)) {
        findings.push(`${query.table}.${column} is named by the data layer but is not a column of public.${query.table}`);
      }
    }
  }

  for (const [table, columns] of typeTables) {
    for (const column of columns) {
      if (FORBIDDEN_CANONICAL_COLUMNS.includes(column)) {
        findings.push(`public.${table}.${column} is a scaffold column Stage 2 refused; it is not canonical`);
      }
    }
  }

  return findings;
}

function readDataLayerFiles(root) {
  return readdirSync(join(root, DATA_LAYER_DIR))
    .filter((name) => name.endsWith(".ts") && name !== "types.ts")
    .sort()
    .map((name) => [name, readFileSync(join(root, DATA_LAYER_DIR, name), "utf8")]);
}

export function readMigrationSources(root) {
  const sources = {};
  for (const name of readdirSync(join(root, MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort()) {
    sources[name] = readFileSync(join(root, MIGRATIONS_DIR, name), "utf8");
  }
  return sources;
}

/**
 * The end-state inventory on its own, for tests and reports that want the domain rather
 * than a verdict: `tables` is `schema.table -> columns` after every forward migration has
 * been folded, `typeTables` is what the client is told exists.
 */
export function readDomain(root = REPO_ROOT) {
  const sources = readMigrationSources(root);
  const { tables, unparsed } = parseMigrations(sources);
  return { sources, tables, unparsed, typeTables: parseGeneratedTypes(readFileSync(join(root, TYPES_FILE), "utf8")) };
}

export function runChecks(root = REPO_ROOT) {
  const sources = readMigrationSources(root);  const { tables, unparsed } = parseMigrations(sources);
  const typeTables = parseGeneratedTypes(readFileSync(join(root, TYPES_FILE), "utf8"));
  const queries = readDataLayerFiles(root).flatMap(([, text]) => extractDataLayerQueries(text));
  const findings = [...unparsed, ...checkContract({ schemaTables: tables, typeTables, queries })];
  const publicCount = [...tables.keys()].filter((k) => k.startsWith("public.")).length;
  return {
    findings,
    stats: {
      migrationFiles: Object.keys(sources).length,
      publicTables: publicCount,
      nonClientTables: tables.size - publicCount,
      clientTypeTables: typeTables.size,
      dataLayerQueries: queries.length,
    },
  };
}

/** Runnable without a test runner, so the parsers cannot rot silently. */
export function selfTest() {
  const failures = [];

  const migrations = {
    "0001_a.sql": [
      "CREATE TABLE public.projects (",
      "  id uuid PRIMARY KEY,",
      "  title text NOT NULL,",
      "  selected_features jsonb",
      ");",
      "CREATE TABLE public.guests (",
      "  id uuid,",
      "  CONSTRAINT guests_pkey PRIMARY KEY (id)",
      ");",
      "CREATE TABLE private.access_tokens (",
      "  token_hash text NOT NULL,",
      "  raw text",
      ");",
    ].join("\n"),
    "0002_b.sql": [
      "-- A comment with an unbalanced paren ) and a semicolon; inside it.",
      "CREATE TABLE IF NOT EXISTS public.weddings (",
      "  id uuid,",
      "  title text,",
      "  -- the wedding's own venue must belong to the wedding",
      "  venue_ok boolean GENERATED ALWAYS AS (true) STORED,",
      "  style_settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(style_settings) = 'object'),",
      "  FOREIGN KEY (design_template_id, id) REFERENCES public.design_templates (id, wedding_scope)",
      "    ON DELETE NO ACTION,",
      "  updated_at timestamptz",
      ");",
      "ALTER TABLE public.projects SET SCHEMA legacy;",
      "ALTER TABLE public.guests SET SCHEMA legacy;",
      "CREATE OR REPLACE FUNCTION public.touch() RETURNS trigger AS $$",
      "BEGIN",
      "  NEW.updated_at := now(); -- a ; and a ( in a function body",
      "  RETURN NEW;",
      "END;",
      "$$ LANGUAGE plpgsql;",
    ].join("\n"),
  };
  const { tables, unparsed } = parseMigrations(migrations);
  if (unparsed.length > 0) failures.push(`parser rejected valid DDL: ${unparsed[0]}`);
  const keyList = [...tables.keys()].sort().join(",");
  if (keyList !== "legacy.guests,legacy.projects,private.access_tokens,public.weddings") {
    failures.push(`migration fold wrong: ${keyList}`);
  }
  const weddingColumns = (tables.get("public.weddings") || []).join(",");
  if (weddingColumns !== "id,title,venue_ok,style_settings,updated_at") {
    failures.push(`column capture wrong: ${weddingColumns}`);
  }

  // A constraint edit leaves the inventory alone; a column edit does not. The reader must
  // stay silent about the first and loud about the second, or it either nags forever or
  // goes quietly blind.
  const edits = parseMigrations({
    "0003_c.sql": [
      "CREATE TABLE public.roles_probe (id uuid, role_key text);",
      "ALTER TABLE public.roles_probe ADD CONSTRAINT role_key_shape CHECK (role_key ~ '^[a-z]+$');",
    ].join("\n"),
  });
  if (edits.unparsed.length > 0) {
    failures.push(`ADD CONSTRAINT was reported as inventory drift: ${edits.unparsed[0]}`);
  }
  const drifted = parseMigrations({
    "0004_d.sql": [
      "CREATE TABLE public.weddings (id uuid);",
      "ALTER TABLE public.weddings ADD COLUMN paid_status text;",
      "ALTER TABLE public.weddings RENAME TO nuptials;",
      "CREATE TABLE legacy.payments (id uuid);",
      "ALTER TABLE legacy.payments ADD COLUMN refund_paise bigint;",
    ].join("\n"),
  });
  const driftReport = drifted.unparsed.join("\n");
  if (!driftReport.includes("ADD COLUMN on public.weddings")) {
    failures.push("negative control not caught: ADD COLUMN on a client-visible table");
  }
  if (!driftReport.includes("RENAME on public.weddings")) {
    failures.push("negative control not caught: RENAME of a client-visible table");
  }
  if (driftReport.includes("legacy.payments")) {
    failures.push("a non-client table's column edit was reported as drift");
  }

  const typesText = [
    "    Tables: {",
    "      weddings: {",
    "        Row: {",
    "          id: string;",
    "          style_settings: NonNullable<Json>;",
    "          title: string;",
    "          updated_at: string;",
    "          venue_ok: boolean;",
    "        };",
    "        Insert: {",
    "          id?: string;",
    "          not_a_row_column?: string;",
    "        };",
    "        Relationships: [];",
    "      };",
    "    },",
  ].join("\n");
  const goodTypes = parseGeneratedTypes(typesText);
  if ((goodTypes.get("weddings") || []).join(",") !== "id,style_settings,title,updated_at,venue_ok") {
    failures.push("types parser read Insert keys as Row keys, or missed a column");
  }
  if (checkContract({ schemaTables: tables, typeTables: goodTypes, queries: [] }).length !== 0) {
    failures.push("negative control failed: a matching schema and types file reported findings");
  }

  const adapterText = [
    "const WEDDING_COLUMNS = 'id, title, primary_language, estimated_guest_count';",
    "  await supabase",
    "    .from('weddings')",
    "    .select(`${WEDDING_COLUMNS}, style_settings`)",
    "    .eq('owner_user_id', userId)",
    "    .order('created_at', { ascending: false });",
    "  await supabase.from('design_templates').select('preview_svg').in('status', visible);",
  ].join("\n");
  const queries = extractDataLayerQueries(adapterText);
  if (queries.length !== 2) failures.push(`query capture expected 2 chains, got ${queries.length}`);
  if (queries[0]?.columns.join(",") !== "id,title,primary_language,estimated_guest_count,style_settings,owner_user_id,created_at") {
    failures.push(`constant inlining failed: ${queries[0]?.columns.join(",") ?? "none"}`);
  }
  if (queries[1]?.columns.join(",") !== "preview_svg,status") {
    failures.push(`filter columns not captured: ${queries[1]?.columns.join(",") ?? "none"}`);
  }

  // Negative controls: every class of drift this check exists to catch has to be catchable.
  const broken = checkContract({
    schemaTables: tables,
    typeTables: new Map([
      ["weddings", ["id", "title", "updated_at", "paid_status"]],
      ["access_tokens", ["token_hash"]],
    ]),
    queries: [
      { table: "ghosts", columns: ["id"] },
      { table: "weddings", columns: ["*", "made_up_column"] },
    ],
  });
  for (const [needle, label] of [
    ["ghosts", "a table the types do not describe"],
    ["paid_status", "a refused scaffold column"],
    ["private-schema table", "a private table leaking into client types"],
    ["is missing from the generated Row type", "a schema column absent from the types"],
    ["not in public", "a types column the schema does not have"],
    ["not a resolvable column", "a select(*) or unresolved constant"],
    ["made_up_column", "a column the data layer invented"],
  ]) {
    if (!broken.some((f) => f.includes(needle))) failures.push(`negative control not caught: ${label}`);
  }

  return failures;
}

function formatReport(stats, findings) {
  if (findings.length === 0) {
    return [
      `Database contract OK — ${stats.migrationFiles} migration file(s).`,
      `  schema: ${stats.publicTables} public + ${stats.nonClientTables} non-client table(s)`,
      `  client types: ${stats.clientTypeTables} table(s); data layer: ${stats.dataLayerQueries} query column group(s) reconciled, 0 finding(s).`,
    ].join("\n");
  }
  return [
    `Database contract FAILED — ${findings.length} finding(s):`,
    ...findings.map((f) => `  - ${f}`),
  ].join("\n");
}

const args = process.argv.slice(2);

if (isMain) {
  if (args.includes("--self-test")) {
    const failures = selfTest();
    if (failures.length === 0) {
      console.log("Database contract self-test OK — SQL reader, types reader, query reader and negative controls verified.");
      process.exit(0);
    }
    console.error("Database contract self-test FAILED:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  const { findings, stats } = runChecks();
  console.log(args.includes("--json") ? JSON.stringify({ stats, findings }, null, 2) : formatReport(stats, findings));
  process.exit(findings.length === 0 ? 0 : 1);
}
