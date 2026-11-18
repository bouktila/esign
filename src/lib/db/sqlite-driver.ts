import { coerceSqliteRow, bindSqliteValue, translatePostgresSql } from "./sql-dialect.ts";

// A D1-shaped database. The real binding and the node:sqlite stand-in both
// satisfy it, so better-auth's D1 dialect and this app's query() share one
// path.

export type SqlStatementResult = {
  meta?: { changes?: number; last_row_id?: number };
  results: Record<string, unknown>[];
};

export type SqlBoundStatement = {
  all(): Promise<SqlStatementResult>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<SqlStatementResult>;
};

export type SqlPrepared = SqlBoundStatement & {
  bind(...values: unknown[]): SqlBoundStatement;
};

export type SqlDatabase = {
  batch(statements: readonly SqlPrepared[]): Promise<SqlStatementResult[]>;
  exec(sql: string): Promise<{ count: number }>;
  prepare(sql: string): SqlPrepared;
};

export type QueryResult = {
  rowCount: number;
  rows: Record<string, unknown>[];
};

export type QueryClient = {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
};

export type QueryDatabase = QueryClient & {
  connect(): Promise<QueryClient>;
};

const LOCKS_SQL = `
  create table if not exists equity_on_locks (
    id integer primary key,
    taken_at integer not null
  )
`;

function returnsRows(sql: string): boolean {
  return /^\s*(select|with|pragma|insert|update|delete)\b/i.test(sql);
}

function rowCountOf(result: SqlStatementResult, sql: string): number {
  if (/^\s*(insert|update|delete)\b/i.test(sql)) {
    return result.meta?.changes ?? result.results.length;
  }

  return result.results.length;
}

export function createQueryDatabase(database: SqlDatabase): QueryDatabase {
  let locksReady: Promise<void> | null = null;

  function ensureLocks(): Promise<void> {
    locksReady ??= database.exec(LOCKS_SQL).then(() => undefined);

    return locksReady;
  }

  async function query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult> {
    if (/^\s*begin\b/i.test(text)) {
      await database.exec("BEGIN IMMEDIATE").catch(() => undefined);

      return { rowCount: 0, rows: [] };
    }

    if (/^\s*commit\b/i.test(text)) {
      await database.exec("COMMIT").catch(() => undefined);

      return { rowCount: 0, rows: [] };
    }

    if (/^\s*rollback\b/i.test(text)) {
      await database.exec("ROLLBACK").catch(() => undefined);

      return { rowCount: 0, rows: [] };
    }

    const advisory = await advisoryResult(text, values);

    if (advisory) {
      return advisory;
    }

    const translated = translatePostgresSql(text, values);
    const bound = translated.params.map((value) => bindSqliteValue(value));
    const prepared = database.prepare(translated.sql);
    const statement = bound.length > 0 ? prepared.bind(...bound) : prepared;
    const result = returnsRows(translated.sql)
      ? await statement.all()
      : await statement.run();
    const rows = (result.results ?? []).map((row) => coerceSqliteRow(row));

    return {
      rowCount: rowCountOf({ ...result, results: rows }, translated.sql),
      rows,
    };
  }

  async function advisoryResult(
    text: string,
    values: readonly unknown[],
  ): Promise<QueryResult | null> {
    if (/pg_try_advisory_xact_lock/i.test(text)) {
      await ensureLocks();
      const id = Number(values[0]);
      const now = Math.floor(Date.now() / 1000);
      const taken = await database
        .prepare(
          `insert into equity_on_locks (id, taken_at) values (?, ?)
           on conflict(id) do update set taken_at = excluded.taken_at
           where equity_on_locks.taken_at < excluded.taken_at - 3600`,
        )
        .bind(id, now)
        .run();
      const locked = (taken.meta?.changes ?? 0) > 0;

      return { rowCount: 1, rows: [{ locked }] };
    }

    if (/pg_advisory_xact_lock|pg_advisory_lock|hashtextextended/i.test(text)) {
      return { rowCount: 1, rows: [{ locked: true }] };
    }

    return null;
  }

  return {
    connect() {
      return Promise.resolve({
        query,
        release() {
          return undefined;
        },
      });
    },
    query,
    release() {
      return undefined;
    },
  };
}

type NodeStatement = {
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): { changes?: number; lastInsertRowid?: number | bigint };
};

type NodeDatabase = {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
};

export function createNodeSqliteDatabase(filePath: string): SqlDatabase {
  // node:sqlite is built into Node 22+. The import is dynamic so a Worker
  // bundle that never calls this does not have to resolve it.
  const holder: { db?: NodeDatabase } = {};

  function db(): NodeDatabase {
    if (!holder.db) {
      throw new Error("SQLite is not open yet.");
    }

    return holder.db;
  }

  const opening = import("node:sqlite").then((sqlite) => {
    const database = new sqlite.DatabaseSync(filePath);

    database.exec("PRAGMA foreign_keys = ON");
    holder.db = database as unknown as NodeDatabase;
  });

  function prepare(sql: string): SqlPrepared {
    const boundValues: unknown[] = [];

    const statement: SqlPrepared = {
      all: () => execute(false),
      bind(...values: unknown[]) {
        boundValues.splice(0, boundValues.length, ...values);

        return statement;
      },
      first: async <T>() => {
        const result = await execute(false);

        return (result.results[0] as T | undefined) ?? null;
      },
      run: () => execute(true),
    };

    async function execute(write: boolean): Promise<SqlStatementResult> {
      await opening;
      const prepared = db().prepare(sql);
      const values = boundValues;

      if (write && !/^\s*(select|with|pragma)\b/i.test(sql)) {
        const outcome = prepared.run(...values);

        return {
          meta: {
            changes: outcome.changes ?? 0,
            last_row_id: Number(outcome.lastInsertRowid ?? 0),
          },
          results: [],
        };
      }

      const rows = prepared.all(...values) as Record<string, unknown>[];

      return { meta: { changes: 0 }, results: rows };
    }

    return statement;
  }

  return {
    async batch(statements) {
      const results: SqlStatementResult[] = [];

      for (const statement of statements) {
        results.push(await statement.all());
      }

      return results;
    },
    async exec(sql: string) {
      await opening;
      db().exec(sql);

      return { count: 0 };
    },
    prepare,
  };
}

export async function openNodeSqlite(filePath: string): Promise<SqlDatabase> {
  const database = createNodeSqliteDatabase(filePath);

  await database.exec("PRAGMA foreign_keys = ON");

  return database;
}
