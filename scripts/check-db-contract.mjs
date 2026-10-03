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
 *   5. the generated file ends the way the write step leaves it — one newline, not the
 *      blank line the generator itself prints;
 *   6. the section vocabulary the Stage 4 release guard accepts is the section vocabulary
 *      `src/lib/traditionPackContract.ts` renders against, name for name.
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

/**
 * The clause list of one `ALTER TABLE`, cut on commas that are inside neither parentheses
 * nor quotes. `splitTopLevel` cannot serve here: a Stage 4 constraint body is
 * `CHECK (pack_key ~ '^[a-z][a-z0-9]*(_[a-z0-9]*)*$')`, whose parentheses live inside a
 * string literal, and counting them would leave the splitter inside a paren for the rest
 * of the statement — every following clause, including `ADD COLUMN scope_statement`, would
 * then be swallowed and the inventory would silently keep a column the migration dropped.
 */
function splitClauses(text) {
  const parts = [];
  let depth = 0;
  let chunk = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const close = skipString(text, i);
      chunk += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(chunk);
      chunk = "";
      i += 1;
      continue;
    }
    chunk += ch;
    i += 1;
  }
  parts.push(chunk);
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 0);
}

const CREATE_TABLE = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\.([a-z_]+)/i;
const SET_SCHEMA = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_]+)\.([a-z_]+)\s+SET\s+SCHEMA\s+([a-z_]+)/i;
/**
 * Column inventory changes this reader folds rather than reports. It used to report them:
 * the Stage 4 migration retires seven columns from `public.tradition_packs` and renames a
 * selection column on two tables, and a reader that only *nags* about an edit ends up
 * nagging forever, which trains everyone to ignore a gate that is actually useful. Folding
 * is what makes the checker able to tell whether the types file caught up.
 */
const ALTER_TABLE = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_]+)\.([a-z_]+)\s+(.+)$/is;
const TABLE_RENAME = /^\s*RENAME\s+TO\s+([a-z_]+)\b/i;
const ADD_COLUMN = /^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\b/i;
const DROP_COLUMN = /^\s*DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?([a-z_]+)\b/i;
const RENAME_COLUMN = /^\s*RENAME\s+(?:COLUMN\s+)?([a-z_]+)\s+TO\s+([a-z_]+)\b/i;
/**
 * Clauses that change what a column accepts, who owns the table, or which rows the database
 * will let through — not which columns exist. This check compares an inventory, so these are
 * correctly silent. `ALTER COLUMN … TYPE`, `ADD CONSTRAINT …`, `ENABLE ROW LEVEL SECURITY`
 * and `SET NOT NULL` all belong here; the Stage 2/3/4 migrations use each of them.
 */
const INVENTORY_NEUTRAL =
  /^\s*(?:ADD|DROP)\s+CONSTRAINT\b|^\s*(?:ADD|DROP)\s+(?:PRIMARY|FOREIGN|UNIQUE|EXCLUDE|CHECK|SPACE)\b|^\s*ALTER\s+COLUMN\b|^\s*(?:ENABLE|DISABLE|FORCE)\s+(?:ROW\s+SECURITY|ROW\s+LEVEL\s+SECURITY|REPLICA\s+IDENTITY|TRIGGER|RULE)\b|^\s*(?:OWNER|SET|RESET|VALIDATE|ATTACH|DETACH|INHERIT|NO|OF|NOT|CLUSTER|REPLICA|LOGGED|UNLOGGED)\b/i;
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
      const altered = ALTER_TABLE.exec(statement);
      if (altered) {
        const [, schema, table, clauses] = altered;
        const key = `${schema}.${table}`;
        const moved = TABLE_RENAME.exec(clauses);
        if (moved) {
          // A table rename keeps its columns; only the qualified name changes. If the
          // reader skipped this, the old name would linger as a table the client types are
          // told to describe and the new one would appear as missing.
          if (!tables.has(key)) {
            unparsed.push(`${fileName}: renames ${key} to ${schema}.${moved[1]}, but no earlier statement created it`);
            continue;
          }
          tables.set(`${schema}.${moved[1]}`, tables.get(key));
          tables.delete(key);
          continue;
        }
        const columns = tables.has(key) ? tables.get(key) : null;
        for (const clause of splitClauses(clauses)) {
          if (INVENTORY_NEUTRAL.test(clause)) continue;
          const edit = RENAME_COLUMN.exec(clause) ?? ADD_COLUMN.exec(clause) ?? DROP_COLUMN.exec(clause);
          if (!edit) {
            unparsed.push(
              `${fileName}: cannot classify an ALTER TABLE ${key} clause: ${clause.slice(0, 80)} — extend the reader rather than trust the inventory`,
            );
            continue;
          }
          // An inventory edit on a table this fold never saw is worth reporting even when
          // the table is not `public`: it means the migration edits something the repo did
          // not create, which is exactly how a hand-edited schema stays invisible here.
          if (columns === null) {
            unparsed.push(`${fileName}: changes the columns of ${key}, but no earlier statement created it`);
            break;
          }
          if (edit[2] !== undefined) {
            const at = columns.indexOf(edit[1]);
            if (at < 0) {
              unparsed.push(`${fileName}: renames ${key}.${edit[1]}, which no earlier statement gave it`);
              break;
            }
            columns[at] = edit[2];
          } else if (/^\s*ADD\b/i.test(clause)) {
            if (!columns.includes(edit[1])) columns.push(edit[1]);
          } else {
            const at = columns.indexOf(edit[1]);
            if (at >= 0) columns.splice(at, 1);
          }
        }
        continue;
      }
    }
  }
  return { tables, unparsed };
}

/**
 * The generated types file declares each public table as `name: { Row: { col: type } }`.
 * Nullability is irrelevant here; only the names are compared.
 *
 * This walks braces rather than matching a fixed indent, because the previous version
 * matched `^ {6}name: {` and `^ {10}col:`, which only held while the generated file was
 * being piped through prettier. Regenerating Stage 3's types straight from
 * `supabase gen types` produced the same tables at a different indentation and without
 * semicolons, and every table then read as "missing from the types" — a checker that
 * goes blind when its input is reformatted is worse than no checker, because it reports
 * with confidence. Layout is now irrelevant; only the object structure is read.
 */
export function parseGeneratedTypes(text) {
  const tables = new Map();
  for (const block of objectMembers(text, "Tables")) {
    for (const table of block.members) {
      const row = (findMember(table.members, "Row")?.members ?? []).map((c) => c.key);
      if (table.key && /^[a-z_]+$/.test(table.key)) tables.set(table.key, row);
    }
  }
  return tables;
}

/**
 * Every `key: { ... }` object at one level below each occurrence of `key:` at the top
 * level of the file — in practice the `Tables:` block of each schema.
 */
function objectMembers(text, key) {
  const out = [];
  const pattern = new RegExp(`\\b${key}:\\s*\\{`, "g");
  for (const match of text.matchAll(pattern)) {
    const open = text.indexOf("{", match.index);
    const close = matchingBrace(text, open);
    if (close < 0) continue;
    out.push({ members: membersOf(text, open + 1, close) });
  }
  return out;
}

function findMember(members, key) {
  return members.find((m) => m.key === key);
}

/** The index of the `}` that closes the `{` at `open`, skipping quoted text. */
function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") i = skipString(text, i);
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === quote) return i;
  }
  return text.length;
}

/**
 * The immediate members of the object literal whose braced content runs from `start`
 * to `end`: each member's key and the members nested one level inside its value.
 * Anything that is not `key: {` — a leaf type, an array literal, a mapped-type
 * placeholder — contributes a key with no members.
 *
 * Members are cut at `,`, `;` *or* a newline when at brace depth zero, because the
 * generated file's separators depend on how it was printed: `supabase gen types` emits
 * `Row: {` blocks whose columns are separated by nothing but a line break, and a
 * one-line object with `;`. Requiring commas read the whole `Row` as a single member
 * and reported every other column as missing.
 */
function membersOf(text, start, end) {
  const members = [];
  let depth = 0;
  let chunkStart = start;
  const flush = (stop) => {
    const chunk = text.slice(chunkStart, stop);
    // A generated file may name a member `Row:` or `"Row":` — the current CLI quotes every
    // identifier it emits, so a reader that only knew the unquoted form would report each
    // table of a freshly generated file as missing and each column of it as absent.
    const key = /^\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([A-Za-z_$][A-Za-z0-9_$]*))\??\s*:/.exec(chunk);
    if (key) {
      const name = key[1] ?? key[2] ?? key[3] ?? key[4];
      const after = chunkStart + key[0].length;
      const open = text.indexOf("{", after);
      const nested = open > 0 && open < stop ? (() => {
        const close = matchingBrace(text, open);
        return close < 0 ? [] : membersOf(text, open + 1, close);
      })() : [];
      members.push({ key: name, members: nested });
    }
    chunkStart = stop + 1;
  };
  for (let i = start; i < end; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(text, i); continue; }
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (depth === 0 && (ch === "," || ch === ";" || ch === "\n")) flush(i);
  }
  if (chunkStart < end) flush(end);
  return members;
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

/**
 * The bytes at the end of the generated file, not its types.
 *
 * `supabase gen types typescript` prints a blank line after its closing `} as const`
 * (measured on CLI 2.118.0: stdout ends `} as const\n\n`). Left in place, that blank line
 * made every later write to the end of the file a `git diff --check` whitespace error, so
 * it is stripped by the step that writes the file — and checked here, because the only
 * thing that puts it back is the regeneration this rule exists to police.
 *
 * Line endings are not checked: `core.autocrlf` on this machine means the working copy is
 * CRLF and the stored blob is LF, and neither is a defect.
 */
export function checkGeneratedTypesEof(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const trailingNewlines = normalized.length - normalized.replace(/\n+$/, "").length;
  if (trailingNewlines === 1) return [];
  return [
    `${TYPES_FILE} must end with exactly one newline; it ends with ${trailingNewlines}. The generator prints a blank line after "} as const" — drop it when writing the file.`,
  ];
}

/**
 * The section vocabulary `private.guard_tradition_pack_release()` accepts, read out of the
 * migration and compared with the lists `src/lib/traditionPackContract.ts` gives the client.
 *
 * This is the rule that makes that file's header comment true rather than aspirational. The
 * guard is the gate that decides what may be stored; the client lists decide what the app has a
 * renderer for. If the two differ in the permissive direction, a candidate definition validates
 * in the browser and is refused on write, which is the worst possible time to discover a rule;
 * if they differ in the strict direction, the editor refuses a release the database would have
 * accepted, and someone will "fix" it by weakening the client. Either way the fix is a
 * conversation about the vocabulary, so the checker is what starts that conversation early.
 *
 * Every site is located by an anchor that has to be present. A site that cannot be found is a
 * finding, never a skip: a checker that silently stopped looking would report parity forever.
 */
const CONTRACT_FILE = "src/lib/traditionPackContract.ts";
/**
 * The guard's own name, matched in either form, because a forward stage re-declares a trigger
 * with `CREATE OR REPLACE FUNCTION` and the first version of this reader looked only for the
 * bare `CREATE FUNCTION`. The consequence was not a crash but something worse: the checker kept
 * reading the Stage 4 body — the one that does not know `override_rule` — and reported perfect
 * vocabulary parity against a client file that had fallen behind the guard actually running. A
 * gate that reads the superseded definition of a function is a gate that certifies the past.
 *
 * So: every migration that defines it is a candidate, the last one in filename order is the
 * end state (migrations are forward-only and ordered, which is the same fold
 * `parseMigrations` relies on), and the ones before it are reported as the history they are.
 */
const GUARD_ANCHORS = [
  "CREATE FUNCTION private.guard_tradition_pack_release()",
  "CREATE OR REPLACE FUNCTION private.guard_tradition_pack_release()",
];

const VOCABULARY_SITES = [
  { name: "definition keys", clientConst: "PACK_DEFINITION_KEYS", anchor: "FROM jsonb_object_keys(NEW.definition) k" },
  { name: "section field keys", clientConst: "PACK_SECTION_FIELD_KEYS", anchor: "FROM jsonb_object_keys(v_section) k" },
  { name: "section slots", clientConst: "PACK_SECTION_KEYS", anchor: "(v_section ->> 'section_key') NOT IN" },
  { name: "section kinds", clientConst: "PACK_SECTION_KINDS", anchor: "v_kind IS NULL OR v_kind NOT IN" },
  { name: "host fields", clientConst: "PACK_HOST_FIELDS", anchor: "v_bad NOT IN" },
  // Stage 5's `override_rule` vocabulary: the guard refuses anything else, and the client list
  // is what an authoring surface would offer. Left out of this table, the three rules would be
  // the first vocabulary in this file with no parity rule at all.
  { name: "override rules", clientConst: "PACK_OVERRIDE_RULES", anchor: "v_rule NOT IN" },
  { name: "event vocabulary entry keys", clientConst: "PACK_EVENT_ENTRY_KEYS", anchor: "jsonb_object_keys(ev) k" },
  { name: "design guidance keys", clientConst: "PACK_DESIGN_GUIDANCE_KEYS", anchor: "FROM jsonb_object_keys(NEW.definition -> 'design_guidance') k" },
];

/** The migrations that define `anchors`, in filename order, and the last one's text. */
function latestDefiner(sources, anchors, what) {
  const files = Object.keys(sources)
    .sort()
    .filter((name) => anchors.some((a) => sources[name].includes(a)));
  if (files.length === 0) {
    return { file: null, text: null, findings: [`no migration defines ${what}`] };
  }
  const file = files[files.length - 1];
  return { file, text: sources[file], earlier: files.slice(0, -1), findings: [] };
}

/** Quoted names inside the first balanced paren group after `from`, or null if there is none. */
function quotedGroup(sql, from, within) {
  const open = sql.indexOf("(", from);
  if (open < 0 || (within !== undefined && open - from > within)) return null;
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return [...sql.slice(open, i).matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }
  }
  return null;
}

export function extractGuardVocabulary(sources) {
  const { file, text, findings, earlier } = latestDefiner(sources, GUARD_ANCHORS, "the release guard");
  if (!text) return { findings, lists: {} };
  const body = text.slice(text.indexOf(GUARD_ANCHORS.find((a) => text.includes(a))));
  const out = [];
  const lists = {};
  for (const site of VOCABULARY_SITES) {
    const at = body.indexOf(site.anchor);
    if (at < 0) {
      out.push(`${file}: could not locate the guard's ${site.name} list (anchor "${site.anchor}" is gone)`);
      continue;
    }
    const fromNotIn = body.indexOf("NOT IN", at + site.anchor.length - "NOT IN".length);
    const found = fromNotIn >= 0 ? quotedGroup(body, fromNotIn + "NOT IN".length, 40) : null;
    if (!found || found.length === 0) {
      out.push(`${file}: the guard's ${site.name} list could not be read after anchor "${site.anchor}"`);
      continue;
    }
    lists[site.clientConst] = found;
  }
  return { findings: out, lists };
}

/** `export const NAME = ['a', 'b'] as const` — the shape every list in the contract file uses. */
export function extractClientVocabulary(text) {
  const findings = [];
  const lists = {};
  for (const site of VOCABULARY_SITES) {
    const match = new RegExp(`export const ${site.clientConst} = \\[([^\\]]*)\\] as const`).exec(text);
    if (!match) {
      findings.push(`${CONTRACT_FILE}: ${site.clientConst} is not an \`as const\` array of quoted names`);
      continue;
    }
    // Comments are stripped before the names are read. Without this, a line comment inside the
    // brackets contributes every quoted phrase it contains, so a file that documented its own
    // vocabulary would report itself as drift — which is exactly what it did on the first run
    // after Stage 5 added two names. The lists are still compared name for name; only prose
    // stops counting.
    const body = match[1].split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
    const names = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (names.length === 0) {
      findings.push(`${CONTRACT_FILE}: ${site.clientConst} is empty`);
      continue;
    }
    lists[site.clientConst] = names;
  }
  return { findings, lists };
}

export function checkTraditionPackVocabulary({ guard, client }) {
  const findings = [...guard.findings, ...client.findings];
  for (const site of VOCABULARY_SITES) {
    const a = guard.lists[site.clientConst];
    const b = client.lists[site.clientConst];
    if (!a || !b) continue; // already reported by whichever side could not read it
    const missing = a.filter((name) => !b.includes(name));
    const extra = b.filter((name) => !a.includes(name));
    if (missing.length === 0 && extra.length === 0) continue;
    findings.push(
      `${CONTRACT_FILE} ${site.clientConst} is not the guard's ${site.name} list: ` +
        `client is missing [${missing.join(", ")}], client names what the guard does not [${extra.join(", ")}]`,
    );
  }
  return findings;
}

/**
 * `private.default_invitation_definition()` versus `NO_PACK_SECTIONS`, field by field.
 *
 * The client copy is what lets a document with no section list (a version frozen before
 * Stage 4, which the projection still serves) go through the same renderer loop as one with
 * a pack. A copy is only honest while it matches, and the two live in different languages in
 * different directories, so nothing but this check keeps them the same list: a section added
 * to the database's default that the client does not know drops off every legacy page in
 * silence, and a section the client invented renders on a legacy page that the database would
 * never produce for a new one.
 *
 * Read as data, not as text: the SQL side is parsed as the JSON literal it is, so a reflow of
 * the migration's formatting cannot make the check lie in either direction.
 */
const SECTIONS_FILE = "src/lib/invitationSections.ts";
const DEFAULT_DEFINITION_ANCHOR = "CREATE FUNCTION private.default_invitation_definition()";

export function extractDefaultDefinition(sources) {
  const { file, text, findings } = latestDefiner(
    sources,
    [DEFAULT_DEFINITION_ANCHOR, `CREATE OR REPLACE ${DEFAULT_DEFINITION_ANCHOR}`],
    "the default invitation definition",
  );
  if (!text) return { findings, rows: [] };
  const body = text.slice(text.indexOf(DEFAULT_DEFINITION_ANCHOR));
  const open = body.indexOf("'{");
  const close = body.indexOf("'::jsonb");
  if (open < 0 || close < 0 || close < open) {
    return { findings: [`${file}: the default invitation definition is not a single quoted JSON literal`], rows: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(body.slice(open + 1, close));
  } catch (error) {
    return { findings: [`${file}: the default invitation definition is not valid JSON (${error.message})`], rows: [] };
  }
  const sections = Array.isArray(parsed.sections) ? parsed.sections : null;
  if (sections === null) {
    return { findings: [`${file}: the default invitation definition declares no sections array`], rows: [] };
  }
  const rows = sections.map((section, index) => {
    const keys = Object.keys(section.heading ?? {});
    return {
      position: section.position,
      key: section.section_key,
      kind: section.kind,
      hostField: section.host_field ?? null,
      headingLanguages: keys,
      headingEnglish: keys.length === 1 && keys[0] === "en" ? section.heading.en : null,
      path: `${file} default_invitation_definition sections[${index}]`,
    };
  });
  return { findings: [], rows };
}

const CLIENT_SECTION_ENTRY =
  /\{\s*key:\s*'([^']+)',\s*position:\s*(\d+),\s*kind:\s*'([^']+)',\s*hostField:\s*(null|'[^']*'),\s*headingEnglish:\s*(null|'[^']*')\s*\}/g;

export function extractClientDefaultSections(text) {
  const block = /export const NO_PACK_SECTIONS[^=]*=([\s\S]*?)\n\];/.exec(text);
  if (!block) {
    return { findings: [`${SECTIONS_FILE}: NO_PACK_SECTIONS is not an exported array literal`], rows: [] };
  }
  const rows = [...block[1].matchAll(CLIENT_SECTION_ENTRY)].map((m) => ({
    position: Number(m[2]),
    key: m[1],
    kind: m[3],
    hostField: m[4] === "null" ? null : m[4].slice(1, -1),
    headingEnglish: m[5] === "null" ? null : m[5].slice(1, -1),
    path: `${SECTIONS_FILE} ${m[1]}`,
  }));
  const declared = (block[1].match(/\{\s*key:/g) ?? []).length;
  if (rows.length !== declared) {
    return {
      findings: [
        `${SECTIONS_FILE}: NO_PACK_SECTIONS has ${declared} entries but only ${rows.length} match the documented field shape (key, position, kind, hostField, headingEnglish)`,
      ],
      rows,
    };
  }
  if (rows.length === 0) {
    return { findings: [`${SECTIONS_FILE}: NO_PACK_SECTIONS declares no sections`], rows };
  }
  return { findings: [], rows };
}

export function checkDefaultDefinitionMirror({ sql, client }) {
  const findings = [...sql.findings, ...client.findings];
  if (sql.findings.length || client.findings.length) return findings;
  const label = (row) => `${row.position}|${row.key}|${row.kind}|${row.hostField ?? "-"}|${row.headingEnglish ?? "-"}`;
  const a = sql.rows.map(label);
  const b = client.rows.map(label);
  if (a.join(",") === b.join(",")) return findings;
  findings.push(
    `${SECTIONS_FILE} NO_PACK_SECTIONS is not the database's default invitation definition. ` +
      `database: [${a.join(", ")}]  client: [${b.join(", ")}]. ` +
      `Both lists decide what a wedding with no tradition pack is drawn from — the SQL one for a ` +
      `document frozen from today, the client one for a legacy document that carries no section list ` +
      `— so they must be the same order, the same slots, the same kinds and the same host fields. ` +
      `Change both, or change neither; do not make the client copy the SQL one's behaviour by adding ` +
      `a branch to the renderer.`,
  );
  return findings;
}

function readDataLayerFiles(root) {
  return readdirSync(join(root, DATA_LAYER_DIR))
    .filter((name) => name.endsWith(".ts") && name !== "types.ts")
    .sort()
    .map((name) => [name, readFileSync(join(root, DATA_LAYER_DIR, name), "utf8")]);
}

/**
 * §G's scattering rule, as a gate rather than a convention.
 *
 * `src/integrations/supabase` is the only place a table or an RPC may be named, and every rule
 * this checker enforces about columns and vocabularies is only as wide as that assumption. A
 * single `supabase.from('tradition_pack_releases').select('*')` typed into a page would put the
 * governance record — review labels, digests, machine-assistance notes — one keystroke from a
 * screen, and nothing above would notice, because the column checks read only the data layer.
 *
 * Measured on this repository: zero occurrences in `src/pages` and `src/components` today, which
 * is why the rule can be absolute rather than a growing allowlist.
 */
const CONTAINED_DIRS = ["src/pages", "src/components"];
const SURFACE_CALL = /\.from\(|\.rpc\(/;

export function checkSurfaceContainment(files) {
  const findings = [];
  for (const [name, text] of Object.entries(files).sort()) {
    text.split("\n").forEach((line, index) => {
      if (!SURFACE_CALL.test(line) || line.trimStart().startsWith("//")) return;
      findings.push(
        `${name}:${index + 1} names a table or RPC directly — data access belongs in ` +
          `${DATA_LAYER_DIR}, where the columns, the vocabularies and the review-sensitive fields ` +
          `this file checks are actually visible`,
      );
    });
  }
  return findings;
}

function readSurfaceFiles(root) {
  const out = {};
  for (const dir of CONTAINED_DIRS) {
    const walk = (rel) => {
      for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) { walk(child); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        out[child] = readFileSync(join(root, child), "utf8");
      }
    };
    walk(dir);
  }
  return out;
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
  const sources = readMigrationSources(root);
  const { tables, unparsed } = parseMigrations(sources);
  const typesText = readFileSync(join(root, TYPES_FILE), "utf8");
  const typeTables = parseGeneratedTypes(typesText);
  const queries = readDataLayerFiles(root).flatMap(([, text]) => extractDataLayerQueries(text));
  const guard = extractGuardVocabulary(sources);
  let contractText = "";
  let contractMissing = null;
  try {
    contractText = readFileSync(join(root, CONTRACT_FILE), "utf8");
  } catch {
    contractMissing = [`${CONTRACT_FILE} does not exist, so the guard's section vocabulary has no client counterpart to compare with`];
  }
  const client = extractClientVocabulary(contractText);
  const defaultSql = extractDefaultDefinition(sources);
  let sectionsText = "";
  let sectionsMissing = null;
  try {
    sectionsText = readFileSync(join(root, SECTIONS_FILE), "utf8");
  } catch {
    sectionsMissing = [`${SECTIONS_FILE} does not exist, so the database's default invitation definition has no client counterpart to compare with`];
  }
  const defaultClient = extractClientDefaultSections(sectionsText);
  const findings = [
    ...unparsed,
    ...checkContract({ schemaTables: tables, typeTables, queries }),
    ...checkGeneratedTypesEof(typesText),
    ...(contractMissing ?? []),
    ...(sectionsMissing ?? []),
    ...checkTraditionPackVocabulary({ guard, client }),
    ...checkDefaultDefinitionMirror({ sql: defaultSql, client: defaultClient }),
    ...checkSurfaceContainment(readSurfaceFiles(root)),
  ];
  const publicCount = [...tables.keys()].filter((k) => k.startsWith("public.")).length;
  return {
    findings,
    stats: {
      migrationFiles: Object.keys(sources).length,
      publicTables: publicCount,
      nonClientTables: tables.size - publicCount,
      clientTypeTables: typeTables.size,
      dataLayerQueries: queries.length,
      surfaceFiles: Object.keys(readSurfaceFiles(root)).length,
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
      "CREATE TABLE public.weddings (id uuid, tradition_pack_id uuid);",
      "ALTER TABLE public.weddings ADD COLUMN paid_status text;",
      "ALTER TABLE public.weddings ADD COLUMN note text NOT NULL, ADD CONSTRAINT note_shape CHECK (length(note) > 0), DROP COLUMN tradition_pack_id;",
      "ALTER TABLE public.weddings RENAME COLUMN note TO remark;",
      "ALTER TABLE public.weddings RENAME TO nuptials;",
      "CREATE TABLE public.untouched (id uuid);",
      "ALTER TABLE public.untouched ENABLE ROW LEVEL SECURITY;",
      "ALTER TABLE public.untouched ALTER COLUMN id SET NOT NULL;",
      "ALTER TABLE public.untouched OWNER TO postgres;",
      "CREATE TABLE legacy.payments (id uuid);",
      "ALTER TABLE legacy.payments ADD COLUMN refund_paise bigint;",
    ].join("\n"),
  });
  const driftReport = drifted.unparsed.join("\n");
  // Every one of those edits is folded, so the inventory has to read as the database would:
  // `paid_status` and `remark` present, `tradition_pack_id` and `note` gone, the table under
  // its new name. A fold that got this wrong would report a types file as drifting when the
  // schema and the types agree, which is how a gate like this gets disabled.
  if (drifted.tables.get("public.nuptials")?.join(",") !== "id,paid_status,remark") {
    failures.push(`ALTER fold wrong: ${drifted.tables.get("public.nuptials")?.join(",") ?? "(no public.nuptials)"}`);
  }
  if (drifted.tables.has("public.weddings")) {
    failures.push("a RENAME TO left the old table name in the inventory");
  }
  for (const absent of ["tradition_pack_id", "note"]) {
    if (drifted.tables.get("public.nuptials")?.includes(absent)) {
      failures.push(`ALTER fold kept ${absent} after it was dropped or renamed`);
    }
  }
  if (drifted.tables.get("public.untouched")?.join(",") !== "id") {
    failures.push(`an inventory-neutral ALTER changed columns: ${drifted.tables.get("public.untouched")?.join(",")}`);
  }
  // The controls that keep the fold honest: an edit the classifier does not know has to be
  // loud, and an edit of a table the fold never saw must not be silently applied to nothing.
  const unclassified = parseMigrations({
    "0005_e.sql": [
      "CREATE TABLE public.weddings (id uuid);",
      "ALTER TABLE public.weddings ADD COLUMN paid_status text;",
    ].join("\n"),
  });
  if (unclassified.unparsed.length !== 0) {
    failures.push(`ADD COLUMN was still reported as unfodable drift: ${unclassified.unparsed[0]}`);
  }
  const nonsense = parseMigrations({
    "0006_f.sql": [
      "CREATE TABLE public.weddings (id uuid);",
      "ALTER TABLE public.weddings SECRETS OF THE REALM id;",
    ].join("\n"),
  });
  if (!nonsense.unparsed.some((f) => f.includes("cannot classify an ALTER TABLE public.weddings"))) {
    failures.push("negative control not caught: an ALTER clause the reader cannot classify");
  }
  const orphan = parseMigrations({
    "0007_g.sql": ["ALTER TABLE public.phantoms ADD COLUMN paid_status text;"].join("\n"),
  });
  if (!orphan.unparsed.some((f) => f.includes("no earlier statement created it"))) {
    failures.push("negative control not caught: an inventory edit of a table the fold never saw");
  }
  if (driftReport.includes("legacy.payments")) {
    failures.push("a non-client table's column edit was reported as drift");
  }
  // Renaming a column the table does not have must not quietly succeed: the fold would be
  // describing a schema that does not exist, and the types file would then be blamed.
  const badRename = parseMigrations({
    "0008_h.sql": [
      "CREATE TABLE public.weddings (id uuid);",
      "ALTER TABLE public.weddings RENAME COLUMN tradition_pack_id TO tradition_pack_release_id;",
    ].join("\n"),
  });
  if (!badRename.unparsed.some((f) => f.includes("renames public.weddings.tradition_pack_id"))) {
    failures.push("negative control not caught: a rename of a column the table never had");
  }
  if (badRename.tables.get("public.weddings")?.join(",") !== "id") {
    failures.push("a refused rename still changed the inventory");
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

  // The same inventory as `supabase gen types` actually emits: no semicolons, one
  // `key: { ... }` collapsed onto a line, and an empty `Tables` block for the second
  // schema. The old line-matching reader produced zero tables from this, which is the
  // bug the paragraph above describes; a checker that reports "every table is missing"
  // because of formatting has to be caught by a fixture, not by an outage.
  const generatedStyle = [
    "export type Database = {",
    "  api: {",
    "    Tables: {",
    "      [_ in never]: never",
    "    }",
    "    Functions: {",
    "      resolve_public_invitation: { Args: never; Returns: Json }",
    "      publish_invitation_version: {",
    "        Args: {",
    "          p_expires_at?: string",
    "          p_wedding_id: string",
    "        }",
    "        Returns: Json",
    "      }",
    "    }",
    "    Enums: {",
    "      [_ in never]: never",
    "    }",
    "  }",
    "  public: {",
    "    Tables: {",
    "      weddings: {",
    "        Row: {",
    "          id: string",
    "          style_settings: Json",
    "          title: string",
    "          updated_at: string",
    "          venue_ok: boolean",
    "        }",
    "        Insert: {",
    "          id?: string",
    "          not_a_row_column?: string",
    "        }",
    "        Update: {",
    "          id?: string",
    "        }",
    "        Relationships: [",
    "          {",
    "            foreignKeyName: 'weddings_design_template_id_fkey'",
    "            columns: ['design_template_id']",
    "            referencedRelation: 'design_templates'",
    "          }",
    "        ]",
    "      }",
    "      venues: {",
    "        Row: { id: string, wedding_id: string }",
    "        Insert: { id?: string }",
    "      }",
    "    }",
    "    Views: { [_ in never]: never }",
    "    Enums: { app_role: ['admin', 'user', 'planner'] }",
    "  }",
    "}",
  ].join("\n");
  const regenerated = parseGeneratedTypes(generatedStyle);
  if ((regenerated.get("weddings") || []).join(",") !== "id,style_settings,title,updated_at,venue_ok") {
    failures.push(`brace reader missed tables in the generated layout: ${JSON.stringify([...regenerated.keys()])}`);
  }
  if ((regenerated.get("venues") || []).join(",") !== "id,wedding_id") {
    failures.push("brace reader could not read a one-line Row");
  }
  if (regenerated.has("resolve_public_invitation") || regenerated.has("app_role")) {
    failures.push("brace reader treated a function or an enum as a table");
  }

  // CLI 2.118.0 quotes every identifier it emits and separates a collapsed Row's columns
  // with commas on one line: `"weddings": {` / `"id": string,"title": string`. That layout
  // is the one a regeneration actually produces, and the reader used to see none of it —
  // every table of a freshly generated file read as missing, which is a blind spot of the
  // worst kind because the report is confident and wrong.
  const quotedStyle = [
    "export type Database = {",
    '  "api": {',
    "          Tables: {",
    "            [_ in never]: never",
    "          }",
    "          Functions: {",
    '            "resolve_public_invitation":',
    '{ Args: Record<PropertyKey, never>; Returns: Json',
    "                           }",
    "          }",
    '        },"public": {',
    "          Tables: {",
    '            "weddings": {',
    "                  Row: {",
    '                    "id": string,"title": string | null,"venue_ok": boolean',
    "                  }",
    "                  Insert: {",
    '                    "id"?: string,"not_a_row_column"?: string',
    "                  }",
    "                  Relationships: [",
    "                    {",
    '      foreignKeyName: "weddings_design_template_id_fkey"',
    '      columns: ["design_template_id"]',
    "    }",
    "                  ]",
    '                },"venues": {',
    "                  Row: {",
    '                    "id": string,"wedding_id": string',
    "                  }",
    "                }",
    "          }",
    "          Enums: {",
    '            "app_role": ("admin" | "user")',
    "          }",
    "        }",
    "}",
  ].join("\n");
  const quoted = parseGeneratedTypes(quotedStyle);
  if ((quoted.get("weddings") || []).join(",") !== "id,title,venue_ok") {
    failures.push(`quoted-key reader missed columns: ${JSON.stringify(quoted.get("weddings") ?? null)}`);
  }
  if ((quoted.get("venues") || []).join(",") !== "id,wedding_id") {
    failures.push("quoted-key reader could not read a quoted one-line Row");
  }
  if (quoted.has("resolve_public_invitation") || quoted.has("app_role") || quoted.has("not_a_row_column")) {
    failures.push("quoted-key reader treated a function, an enum or an Insert key as a table or column");
  }
  if (JSON.stringify([...goodTypes.keys()]) !== '["weddings"]') {
    failures.push(`old-layout fixture parsed as ${JSON.stringify([...goodTypes.keys()])}, expected only weddings`);
  }
  if (JSON.stringify([...regenerated.keys()]) !== '["weddings","venues"]') {
    failures.push(`generated-layout fixture parsed as ${JSON.stringify([...regenerated.keys()])}, expected weddings and venues`);
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

  // The vocabulary parity rule reads two files it does not own, so its own parsers are
  // pinned here: which shape the guard's lists have to take to be read at all, and what
  // the checker does when a site it depends on disappears.
  const guardFixture = {
    "0001_guard.sql": [
      "CREATE FUNCTION private.guard_tradition_pack_release() RETURNS trigger AS $$",
      "BEGIN",
      "  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.definition) k WHERE k NOT IN ('sections', 'event_vocabulary', 'design_guidance')) THEN",
      "    RAISE EXCEPTION 'unknown definition key';",
      "  END IF;",
      "  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_section) k WHERE k NOT IN ('section_key', 'position', 'kind')) THEN",
      "    RAISE EXCEPTION 'unknown section field';",
      "  END IF;",
      "  IF (v_section ->> 'section_key') NOT IN ('opening', 'welcome') THEN",
      "    RAISE EXCEPTION 'unknown section slot';",
      "  END IF;",
      "  IF v_kind IS NULL OR v_kind NOT IN ('text', 'people_list', 'event_list') THEN",
      "    RAISE EXCEPTION 'unknown kind';",
      "  END IF;",
      "  IF v_bad NOT IN ('welcome', 'closing') THEN",
      "    RAISE EXCEPTION 'unknown host field';",
      "  END IF;",
      "  IF v_rule NOT IN ('host_may_replace', 'pack_only', 'host_must_supply') THEN",
      "    RAISE EXCEPTION 'unknown override rule';",
      "  END IF;",
      "  IF EXISTS (SELECT 1 FROM jsonb_object_keys(ev) k WHERE k NOT IN ('event_key', 'labels')) THEN",
      "    RAISE EXCEPTION 'unknown event entry key';",
      "  END IF;",
      "  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.definition -> 'design_guidance') k WHERE k NOT IN ('lead_size', 'motif_reference')) THEN",
      "    RAISE EXCEPTION 'unknown design guidance key';",
      "  END IF;",
      "END;",
      "$$ LANGUAGE plpgsql;",
    ].join("\n"),
  };
  const clientFixture = [
    "export const PACK_DEFINITION_KEYS = ['sections', 'event_vocabulary', 'design_guidance'] as const",
    "export const PACK_SECTION_FIELD_KEYS = ['section_key', 'position', 'kind'] as const",
    "export const PACK_SECTION_KEYS = ['opening', 'welcome'] as const",
    "export const PACK_SECTION_KINDS = ['text', 'people_list', 'event_list'] as const",
    "export const PACK_HOST_FIELDS = ['welcome', 'closing'] as const",
    "export const PACK_OVERRIDE_RULES = ['host_may_replace', 'pack_only', 'host_must_supply'] as const",
    "export const PACK_EVENT_ENTRY_KEYS = ['event_key', 'labels'] as const",
    "export const PACK_DESIGN_GUIDANCE_KEYS = ['lead_size', 'motif_reference'] as const",
  ].join("\n");
  const readGuard = extractGuardVocabulary(guardFixture);
  if (readGuard.findings.length !== 0) {
    failures.push(`guard fixture could not be read: ${readGuard.findings[0]}`);
  }
  if ((readGuard.lists.PACK_SECTION_KEYS || []).join(",") !== "opening,welcome") {
    failures.push(`guard section slots read as ${(readGuard.lists.PACK_SECTION_KEYS || []).join(",")}`);
  }
  if ((readGuard.lists.PACK_EVENT_ENTRY_KEYS || []).join(",") !== "event_key,labels") {
    failures.push(`guard event entry keys read as ${(readGuard.lists.PACK_EVENT_ENTRY_KEYS || []).join(",")}`);
  }
  if (checkTraditionPackVocabulary({ guard: readGuard, client: extractClientVocabulary(clientFixture) }).length !== 0) {
    failures.push("negative control failed: two identical vocabularies reported drift");
  }

  const shortClient = extractClientVocabulary(clientFixture.replace("'opening', 'welcome'", "'welcome'"));
  const drift = checkTraditionPackVocabulary({ guard: readGuard, client: shortClient });
  if (drift.length !== 1 || !drift[0].includes("client is missing [opening]")) {
    failures.push(`a client list missing one guard name was not reported: ${drift.join(" | ") || "(nothing)"}`);
  }
  const longClient = extractClientVocabulary(clientFixture.replace("['text', 'people_list'", "['text', 'caste_list', 'people_list'"));
  const extraDrift = checkTraditionPackVocabulary({ guard: readGuard, client: longClient });
  if (extraDrift.length !== 1 || !extraDrift[0].includes("client names what the guard does not [caste_list]")) {
    failures.push(`a client list naming an unknown kind was not reported: ${extraDrift.join(" | ") || "(nothing)"}`);
  }

  // A site the checker depends on must announce its own disappearance. Silence here is the
  // failure mode: a parser that stopped finding an anchor would report parity forever.
  const lostSite = extractGuardVocabulary({ "0001_guard.sql": guardFixture["0001_guard.sql"].replace(/v_bad NOT IN \([^)]*\)/, "v_bad <> 'x'") });
  if (lostSite.findings.length !== 1 || !lostSite.findings[0].includes("host fields")) {
    failures.push(`a vanished guard site read as ${JSON.stringify(lostSite.findings)}`);
  }
  const blindGuard = extractGuardVocabulary({
    "0001_guard.sql": "CREATE FUNCTION private.guard_tradition_pack_release() RETURNS trigger AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;",
  });
  if (blindGuard.findings.length !== VOCABULARY_SITES.length) {
    failures.push(`a guard with no readable lists reported ${blindGuard.findings.length}, expected ${VOCABULARY_SITES.length}`);
  }
  const emptyClient = extractClientVocabulary("");
  if (emptyClient.findings.length !== VOCABULARY_SITES.length) {
    failures.push(`a contract file with none of the lists reported ${emptyClient.findings.length}, expected ${VOCABULARY_SITES.length}`);
  }
  // A documented list is the case that used to read as drift: prose inside the brackets is not
  // vocabulary, and a checker that cannot tell the two apart teaches people to delete comments.
  const commentedClient = extractClientVocabulary(
    clientFixture.replace(
      "export const PACK_SECTION_KINDS = ['text', 'people_list', 'event_list'] as const",
      "export const PACK_SECTION_KINDS = [\n  // 'text' here is prose about the shape, not a name\n  'text', 'people_list', 'event_list',\n] as const",
    ),
  );
  if ((commentedClient.lists.PACK_SECTION_KINDS || []).join(",") !== "text,people_list,event_list") {
    failures.push(`an inline comment changed the read vocabulary: ${(commentedClient.lists.PACK_SECTION_KINDS || []).join(",")}`);
  }
  if (checkTraditionPackVocabulary({ guard: readGuard, client: commentedClient }).length !== 0) {
    failures.push("a documented list reported drift against the guard that matches it");
  }

  // The default-invitation-definition mirror reads a JSON literal out of a migration and a
  // TS array out of a source file, so both readers are pinned here — including the shapes
  // that would otherwise read as "nothing to compare" and pass forever.
  const sqlFixture = {
    "0002_def.sql": [
      "CREATE FUNCTION private.default_invitation_definition() RETURNS jsonb LANGUAGE sql AS $$",
      "BEGIN",
      "  RETURN '{\"schema_version\": 1, \"sections\": [",
      "    {\"section_key\": \"welcome\", \"position\": 1, \"kind\": \"text\", \"host_field\": \"welcome\", \"required\": false},",
      "    {\"section_key\": \"ceremonies\", \"position\": 2, \"kind\": \"event_list\", \"required\": false, \"heading\": {\"en\": \"The ceremonies\"}}",
      "  ]}'::jsonb;",
      "END;",
      "$$;",
    ].join("\n"),
  };
  const clientSource = [
    "export const NO_PACK_SECTIONS: ReadonlyArray<X> = [",
    "  { key: 'welcome', position: 1, kind: 'text', hostField: 'welcome', headingEnglish: null },",
    "  { key: 'ceremonies', position: 2, kind: 'event_list', hostField: null, headingEnglish: 'The ceremonies' },",
    "];",
  ].join("\n");
  const readSql = extractDefaultDefinition(sqlFixture);
  if (readSql.findings.length !== 0) failures.push(`definition SQL fixture unreadable: ${readSql.findings[0]}`);
  if (readSql.rows.length !== 2) failures.push(`definition SQL fixture read ${readSql.rows.length} rows, expected 2`);
  const readClient = extractClientDefaultSections(clientSource);
  if (readClient.findings.length !== 0) failures.push(`definition client fixture unreadable: ${readClient.findings[0]}`);
  if (checkDefaultDefinitionMirror({ sql: readSql, client: readClient }).length !== 0) {
    failures.push(
      `negative control failed: a matching definition and client copy reported drift (${checkDefaultDefinitionMirror({ sql: readSql, client: readClient }).join(" | ")})`,
    );
  }
  // A heading the database does not have, and a swapped order, are the two drifts this check
  // exists for: each would draw a legacy page differently from a page frozen today.
  const headingDrift = extractClientDefaultSections(clientSource.replace("'The ceremonies'", "'Ceremonies'"));
  if (!checkDefaultDefinitionMirror({ sql: readSql, client: headingDrift }).some((f) => f.includes("is not the database's default"))) {
    failures.push("negative control not caught: a client heading the database never wrote");
  }
  // Same slots, same positions, listed in the other order — the client array's order is the
  // sequence a legacy page is drawn in, so a list that only agrees as a set is not a copy.
  const orderDrift = extractClientDefaultSections([
    "export const NO_PACK_SECTIONS = [",
    "  { key: 'ceremonies', position: 2, kind: 'event_list', hostField: null, headingEnglish: 'The ceremonies' },",
    "  { key: 'welcome', position: 1, kind: 'text', hostField: 'welcome', headingEnglish: null },",
    "];",
  ].join("\n"));
  if (!checkDefaultDefinitionMirror({ sql: readSql, client: orderDrift }).some((f) => f.includes("is not the database's default"))) {
    failures.push("negative control not caught: a client list in a different order");
  }
  // Silence is the failure mode for every one of these: a reader that found no anchor would
  // compare two empty lists and report parity forever.
  const noAnchor = extractDefaultDefinition({ "0001_a.sql": "CREATE TABLE public.weddings (id uuid);" });
  if (noAnchor.findings.length !== 1 || !noAnchor.findings[0].includes("no migration defines")) {
    failures.push(`a schema with no default definition reported ${JSON.stringify(noAnchor.findings)}`);
  }
  if (checkDefaultDefinitionMirror({ sql: noAnchor, client: readClient }).length !== 1) {
    failures.push("a missing definition anchor did not reach the report through the checker");
  }
  // Two definers is the forward-stage case this reader used to get wrong: the later migration
  // re-declares the function, so the later migration is the end state, and reading the earlier
  // one would compare the client against a definition the database no longer runs. The control
  // is that the last file's list wins — and that a file with no readable lists still reports.
  const twoAnchors = extractDefaultDefinition({
    "0001.sql": sqlFixture["0002_def.sql"],
    "0002.sql": sqlFixture["0002_def.sql"].replace('\\"key\\"', '\\"section_key\\"'),
  });
  if (twoAnchors.findings.length !== 0) {
    failures.push(`a second migration re-declaring the default definition reported ${twoAnchors.findings[0]}`);
  }
  const supersededGuard = extractGuardVocabulary({
    "0001_guard.sql": guardFixture["0001_guard.sql"],
    "0002_guard.sql": guardFixture["0001_guard.sql"]
      .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
      .replace("('opening', 'welcome')", "('opening', 'welcome', 'venue')"),
  });
  if (supersededGuard.findings.length !== 0) {
    failures.push(`a forward re-declaration of the guard reported ${supersededGuard.findings[0]}`);
  }
  if ((supersededGuard.lists.PACK_SECTION_KEYS || []).join(",") !== "opening,welcome,venue") {
    failures.push(`the guard reader used the superseded body: ${(supersededGuard.lists.PACK_SECTION_KEYS || []).join(",")}`);
  }
  if ((readGuard.lists.PACK_OVERRIDE_RULES || []).join(",") !== "host_may_replace,pack_only,host_must_supply") {
    failures.push(`override rules read as ${(readGuard.lists.PACK_OVERRIDE_RULES || []).join(",")}`);
  }
  if (extractGuardVocabulary({}).findings.length !== 1) {
    failures.push("a schema with no guard function at all did not report itself");
  }

  // The containment rule has to fire on the page it exists for, and stay silent on a comment.
  const scattered = checkSurfaceContainment({
    "src/pages/EditProject.tsx": [
      "  const { data } = await supabase.from('tradition_pack_releases').select('*');",
      "  // supabase.from('weddings') in a comment is not a call",
    ].join("\n"),
    "src/components/Thing.tsx": "  await supabase.rpc('rotate_invitation_token', { t });",
  });
  if (scattered.length !== 2) {
    failures.push(`surface containment caught ${scattered.length} of 2 scattered calls`);
  }
  if (!scattered.every((f) => f.includes("data access belongs in"))) {
    failures.push("surface containment reported without naming where the call belongs");
  }
  if (checkSurfaceContainment({ "src/pages/Clean.tsx": "  return <p>nothing here</p>;"} ).length !== 0) {
    failures.push("negative control failed: a page with no data access reported a finding");
  }
  const unquotedLiteral = extractDefaultDefinition({
    "0002_def.sql": sqlFixture["0002_def.sql"].replace("'::jsonb", "jsonb_build_object()"),
  });
  if (unquotedLiteral.findings.length !== 1 || !unquotedLiteral.findings[0].includes("not a single quoted JSON literal")) {
    failures.push(`a definition built at runtime reported ${JSON.stringify(unquotedLiteral.findings)}`);
  }
  const brokenJson = extractDefaultDefinition({ "0002_def.sql": sqlFixture["0002_def.sql"].replace("\"required\": false}", "\"required\": false,}") });
  if (brokenJson.findings.length !== 1 || !brokenJson.findings[0].includes("not valid JSON")) {
    failures.push(`a malformed definition JSON reported ${JSON.stringify(brokenJson.findings)}`);
  }
  const noSections = extractDefaultDefinition({
    "0002_def.sql": sqlFixture["0002_def.sql"].replace(/\{\"schema_version\": 1, "sections": /, '{"schema_version": 1, "not_sections": '),
  });
  if (noSections.findings.length !== 1 || !noSections.findings[0].includes("declares no sections array")) {
    failures.push(`a definition with no sections array reported ${JSON.stringify(noSections.findings)}`);
  }
  if (extractClientDefaultSections("export const SOMETHING_ELSE = 1;").findings.length !== 1) {
    failures.push("a source file with NO_PACK_SECTIONS removed did not report itself");
  }
  if (extractClientDefaultSections("export const NO_PACK_SECTIONS = [\n  { key: 'welcome', position: 1 },\n];").findings.length !== 1) {
    failures.push("an entry that abandoned the documented field shape was counted as parity");
  }
  if (extractClientDefaultSections("export const NO_PACK_SECTIONS = [\n];").findings.length !== 1) {
    failures.push("an empty NO_PACK_SECTIONS list did not report itself");
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
