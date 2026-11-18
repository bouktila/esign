import { bundledMigrations } from "./migrations.bundled.ts";
import { splitSqlScript, translatePostgresSql } from "./sql-dialect.ts";
import type { SqlDatabase } from "./sqlite-driver.ts";

const MIGRATION_TABLE = `
  create table if not exists signudoc_migrations (
    version text primary key,
    applied_at text not null default current_timestamp
  )
`;

function isAlreadyApplied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /duplicate column|already exists/i.test(message);
}

function stripChecks(sql: string): string {
  let result = "";

  for (let index = 0; index < sql.length; index += 1) {
    if (/^check\s*\(/i.test(sql.slice(index))) {
      const open = sql.indexOf("(", index);
      let depth = 0;

      for (let cursor = open; cursor < sql.length; cursor += 1) {
        if (sql[cursor] === "(") {
          depth += 1;
        } else if (sql[cursor] === ")") {
          depth -= 1;

          if (depth === 0) {
            index = cursor;
            break;
          }
        }
      }

      continue;
    }

    result += sql[index];
  }

  let tidy = result;

  for (let pass = 0; pass < 6; pass += 1) {
    tidy = tidy
      .replace(/,\s*,/g, ",")
      .replace(/,\s*(constraint\b)/gi, ",\n$1")
      .replace(/,\s*\)/g, ")");
  }

  return tidy;
}

function expandAlter(statement: string): string[] {
  if (!/^\s*alter\s+table\b/i.test(statement)) {
    return [statement];
  }

  if (/drop\s+constraint|add\s+constraint/i.test(statement)) {
    return [];
  }

  const adds = [
    ...statement.matchAll(/add\s+column\s+[\s\S]*?(?=,\s*add\s+column|$)/gi),
  ];

  if (adds.length <= 1) {
    return [statement];
  }

  const table = statement.match(/^\s*alter\s+table\s+[^\s]+/i)?.[0];

  if (!table) {
    return [statement];
  }

  return adds.map((add) => `${table} ${add[0].replace(/,\s*$/, "").trim()}`);
}

/**
 * Applies db/migrations on SQLite. Postgres scripts are translated statement
 * by statement. A column that is already there is skipped, so a migration
 * can be re-run after a partial apply.
 */
async function runStatement(database: SqlDatabase, sql: string): Promise<void> {
  await database.prepare(sql).run();
}

export async function migrateSqlDatabase(database: SqlDatabase): Promise<void> {
  await runStatement(database, MIGRATION_TABLE.trim());
  const applied = await database
    .prepare("select version from signudoc_migrations")
    .all();
  const versions = new Set(
    (applied.results ?? []).map((row) => String(row.version)),
  );

  for (const migration of bundledMigrations) {
    if (versions.has(migration.version)) {
      continue;
    }

    const script = translatePostgresSql(
      migration.sql.replace(/--[^\n]*/g, ""),
    ).sql.replace(/\(\(true\)\)/g, "(1)");

    for (const statement of splitSqlScript(script).flatMap((part) =>
      expandAlter(stripChecks(part)),
    )) {
      if (!/^\s*(create|alter|insert|update|delete|drop)\b/i.test(statement)) {
        continue;
      }

      try {
        await runStatement(database, statement);
      } catch (error) {
        if (!isAlreadyApplied(error)) {
          throw new Error(
            `Migration ${migration.version} failed: ${error instanceof Error ? error.message : String(error)}\n${statement}`,
            { cause: error },
          );
        }
      }
    }

    await database
      .prepare("insert into signudoc_migrations (version) values (?)")
      .bind(migration.version)
      .run();
  }
}
