// Postgres statements, as this app writes them, translated for SQLite (D1 and
// the local file used by tests). The hash chain itself is computed in
// JavaScript and is not changed here.

const BOOLEAN_RESULT_COLUMNS = new Set([
  "checked",
  "emailVerified",
  "locked",
  "part11",
  "part11Mode",
  "requireEmailCode",
  "required",
]);

const JSON_RESULT_COLUMNS = new Set([
  "fields",
  "metadata",
  "options",
  "roles",
]);

export type TranslatedSql = {
  params: unknown[];
  sql: string;
};

function splitOutsideStrings(
  sql: string,
): Array<{ text: string; quoted: boolean }> {
  const parts: Array<{ text: string; quoted: boolean }> = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;

    if (quote) {
      current += character;

      if (character === quote) {
        if (sql[index + 1] === quote) {
          current += sql[index + 1];
          index += 1;
          continue;
        }

        parts.push({ quoted: true, text: current });
        current = "";
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      if (current) {
        parts.push({ quoted: false, text: current });
        current = "";
      }

      quote = character;
      current = character;
      continue;
    }

    current += character;
  }

  if (current) {
    parts.push({ quoted: false, text: current });
  }

  return parts;
}

function rewriteUnquoted(sql: string, params: readonly unknown[]): TranslatedSql {
  let text = sql;

  text = text.replace(/do\s+\$\$[\s\S]*?\$\$/gi, (block) => {
    const alters = block.match(/alter\s+table[\s\S]*?;/gi) ?? [];

    return alters.join("\n");
  });
  text = text.replace(/\btext\[\]/gi, "text");
  text = text.replace(/default\s+'\{\}'/gi, "default '[]'");
  text = text.replace(/\badd\s+column\s+if\s+not\s+exists\b/gi, "add column");
  text = text.replace(/\bpublic\./g, "");
  text = text.replace(/\bextract\s*\(\s*epoch\s+from\s+now\(\)\s*\)/gi, "unixepoch()");
  text = text.replace(/\btimestamptz\b/gi, "text");
  text = text.replace(/\bbigint\b/gi, "integer");
  text = text.replace(/\bbytea\b/gi, "blob");
  text = text.replace(/\bjsonb\b/gi, "text");
  text = text.replace(/\bboolean\b/gi, "integer");
  text = text.replace(/\bdefault\s+false\b/gi, "default 0");
  text = text.replace(/\bdefault\s+true\b/gi, "default 1");
  text = text.replace(/\bjsonb_typeof\s*\(/gi, "json_type(");
  text = text.replace(/\bjsonb_array_length\s*\(/gi, "json_array_length(");
  text = text.replace(/\bis\s+not\s+distinct\s+from\b/gi, "IS");
  text = text.replace(/\bfor\s+update(?:\s+of\s+\w+)?/gi, "");
  text = text.replace(
    /\bposition\s*\(\s*(\$\d+)\s+in\s+([^)]+)\)/gi,
    "instr($2, $1)",
  );
  text = text.replace(/::[a-zA-Z_][a-zA-Z0-9_]*(?:\[\])?/g, "");
  text = text.replace(/\bilike\b/gi, "LIKE");
  text = text.replace(
    /\bcount\s*\(\s*\*\s*\)\s+FILTER\s*\(\s*WHERE\s+([\s\S]*?)\s*\)/gi,
    "sum(CASE WHEN $1 THEN 1 ELSE 0 END)",
  );

  text = text.replace(
    /=\s*ANY\s*\(\s*(\$\d+|\?)\s*\)/gi,
    "IN (SELECT value FROM json_each($1))",
  );

  const ordered: unknown[] = [];

  text = text.replace(/\$(\d+)/g, (_match, digits: string) => {
    const index = Number(digits) - 1;
    const value = params[index];

    ordered.push(value === undefined ? null : value);

    return "?";
  });

  return { params: ordered, sql: text };
}

/**
 * Translates one Postgres statement. `$1` placeholders become `?` in the
 * order they appear, so a placeholder used twice is bound twice. Text
 * inside quotes is left unchanged.
 */
export function translatePostgresSql(
  sql: string,
  params: readonly unknown[] = [],
): TranslatedSql {
  const withJson = sql.replace(
    /(\w+)\s*->>\s*'([^']+)'/g,
    "json_extract($1, '$.$2')",
  );
  const regions = splitOutsideStrings(withJson);
  const translated = rewriteUnquoted(
    regions
      .map((part, index) => (part.quoted ? `\u0000Q${index}\u0000` : part.text))
      .join(""),
    params,
  );
  let sqlOut = translated.sql;

  for (const [index, part] of regions.entries()) {
    if (part.quoted) {
      sqlOut = sqlOut.replace(`\u0000Q${index}\u0000`, part.text);
    }
  }

  return { params: translated.params, sql: sqlOut };
}

/** Splits a migration script into statements. Semicolons inside quotes stay. */
export function splitSqlScript(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;

    if (quote) {
      current += character;

      if (character === quote) {
        if (sql[index + 1] === quote) {
          current += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }

    if (character === ";") {
      if (current.trim()) {
        statements.push(current.trim());
      }

      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

export function coerceSqliteValue(column: string, value: unknown): unknown {
  if (BOOLEAN_RESULT_COLUMNS.has(column)) {
    if (value === 0 || value === 1) {
      return value === 1;
    }
  }

  if (
    JSON_RESULT_COLUMNS.has(column) &&
    typeof value === "string" &&
    (value.startsWith("{") || value.startsWith("["))
  ) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  return value;
}

export function coerceSqliteRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const coerced: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    coerced[column] = coerceSqliteValue(column, value);
  }

  return coerced;
}

export function bindSqliteValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Array.isArray(value) || (value && typeof value === "object" && !(value instanceof Uint8Array))) {
    return JSON.stringify(value);
  }

  return value;
}

export function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  return (
    code === "23505" ||
    /unique constraint/i.test(message) ||
    /UNIQUE constraint failed/i.test(message)
  );
}
