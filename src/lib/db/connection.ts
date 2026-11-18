import { attachDatabasePool } from "@vercel/functions";
import pg, {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

import { getEnv } from "../utils/env.ts";
import { requireConfigValue } from "../services/service-config.ts";
import {
  createNodeSqliteDatabase,
  createQueryDatabase,
  type QueryDatabase,
  type SqlDatabase,
} from "./sqlite-driver.ts";
import { migrateSqlDatabase } from "./sqlite-migrate.ts";

declare global {
  var __signudocPgPool: Pool | undefined;
}

// Parse bigint values into numbers because this app stores timestamps and counts
// that are already modeled as numbers throughout the codebase.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

let cachedPool: Pool | null = null;

export type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;
export type DbPool = Pool;

export function usesSqliteDriver(
  env: { DATABASE_DRIVER?: string; SQLITE_PATH?: string } = process.env as {
    DATABASE_DRIVER?: string;
    SQLITE_PATH?: string;
  },
): boolean {
  const driver = env.DATABASE_DRIVER?.trim().toLowerCase();

  return driver === "d1" || driver === "sqlite" || Boolean(env.SQLITE_PATH?.trim());
}

let sqliteDatabase: QueryDatabase | null = null;
let sharedSql: SqlDatabase | null = null;

function sharedSqlite(): SqlDatabase {
  if (!sharedSql) {
    sharedSql =
      process.env.DATABASE_DRIVER?.trim().toLowerCase() === "d1"
        ? cloudflareSqlDatabase()
        : createNodeSqliteDatabase(sqliteFilePath());
  }

  return sharedSql;
}

function sqliteFilePath(): string {
  return (
    process.env.SQLITE_PATH?.trim() || ".data/equity-on-sign.sqlite"
  );
}

/**
 * D1 when the Worker binding is present, otherwise a local SQLite file.
 * `prepare` waits until the binding can be imported, so this object can be
 * built before the first request.
 */
export function cloudflareSqlDatabase(): SqlDatabase {
  let resolved: SqlDatabase | null = null;

  async function ready(): Promise<SqlDatabase> {
    if (!resolved) {
      const loaded = await import("../cloudflare/workers-env.ts");
      const database = loaded.env.DB;

      if (!database) {
        throw new Error(
          "D1 binding DB is not on this Worker. Create the equity-on-sign-staging database and set its id in wrangler.jsonc.",
        );
      }

      resolved = database as unknown as SqlDatabase;
    }

    return resolved;
  }

  function prepared(sql: string) {
    const values: unknown[] = [];
    const statement = {
      all: async () => (await ready()).prepare(sql).bind(...values).all(),
      bind(...bound: unknown[]) {
        values.splice(0, values.length, ...bound);

        return statement;
      },
      first: async <T>() =>
        (await ready()).prepare(sql).bind(...values).first<T>(),
      run: async () => (await ready()).prepare(sql).bind(...values).run(),
    };

    return statement;
  }

  return {
    async batch(statements) {
      const results = [];

      for (const statement of statements) {
        results.push(await statement.all());
      }

      return results;
    },
    exec: (sql) => ready().then((database) => database.exec(sql)),
    prepare: prepared,
  };
}

export function getSqliteDatabase(): QueryDatabase {
  if (sqliteDatabase) {
    return sqliteDatabase;
  }

  const database = sharedSqlite();

  const queries = createQueryDatabase(database);
  let ready: Promise<void> | null = null;
  const migrateOnce = () => {
    ready ??= migrateSqlDatabase(database);

    return ready;
  };
  const original = queries.query.bind(queries);

  queries.query = async (text, values) => {
    await migrateOnce();

    return original(text, values);
  };
  const originalConnect = queries.connect.bind(queries);

  queries.connect = async () => {
    await migrateOnce();

    return originalConnect();
  };
  sqliteDatabase = queries;

  return sqliteDatabase;
}

/** The object better-auth should see: a D1-shaped database, not a pg pool. */
export function getSqliteAuthDatabase(): SqlDatabase {
  return sharedSqlite();
}

export function getDb(): Pool {
  if (usesSqliteDriver()) {
    return getSqliteDatabase() as unknown as Pool;
  }

  if (cachedPool) {
    return cachedPool;
  }

  if (globalThis.__signudocPgPool) {
    cachedPool = globalThis.__signudocPgPool;
    return cachedPool;
  }

  const isOnVercel = process.env.VERCEL === "1";
  const pool = new Pool({
    application_name: "signudoc",
    connectionString: requireConfigValue(
      "database",
      "DATABASE_URL",
      getEnv().databaseUrl,
    ),
    connectionTimeoutMillis: 10_000,
    // A Vercel function instance is suspended between requests, so idle
    // connections are released quickly there instead of being left to die.
    idleTimeoutMillis: isOnVercel ? 5_000 : 30_000,
    max: process.env.NODE_ENV === "production" ? 10 : 5,
  });

  pool.on("error", (error) => {
    console.error("[db] Postgres pool error", error);
  });

  if (isOnVercel) {
    // Keeps the instance alive just long enough to close idle connections
    // before it is suspended, so they do not pile up on the database.
    attachDatabasePool(pool);
  }

  if (process.env.NODE_ENV !== "production") {
    globalThis.__signudocPgPool = pool;
  }

  cachedPool = pool;
  return pool;
}

/**
 * Makes getDb() return this pool from now on, for tests that need the code
 * under test to use a pool of their own. Returns the pool it replaces.
 */
export function replaceDbPoolForTests(pool: Pool): Pool | null {
  const replaced = cachedPool;

  cachedPool = pool;
  globalThis.__signudocPgPool = pool;

  return replaced;
}

export async function withTransaction<T>(
  run: (client: PoolClient) => Promise<T>,
  pool: Pool = getDb(),
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends QueryResultRow>(
  db: DbExecutor,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const result: QueryResult<T> = await db.query(text, values as unknown[]);
  return result.rows[0] ?? null;
}

export async function queryMany<T extends QueryResultRow>(
  db: DbExecutor,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result: QueryResult<T> = await db.query(text, values as unknown[]);
  return result.rows;
}
