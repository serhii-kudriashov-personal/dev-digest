import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * A `Db` **or** a transaction scope. Repository helpers take this so they can be
 * composed inside `db.transaction(...)` — Drizzle hands the callback a
 * `PgTransaction`, which is not assignable to `Db`.
 *
 * This type is for use INSIDE the repository ring only. A transaction handle
 * must never appear in a signature that a service or a route can see.
 */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client over postgres-js. Used by the app (one shared handle)
 * and by the Testcontainers harness (per-test handle).
 */
export function createDb(databaseUrl: string, opts?: { max?: number }): DbHandle {
  const sql = postgres(databaseUrl, { max: opts?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
