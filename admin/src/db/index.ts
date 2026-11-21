import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_WRITER ||
  process.env.SUPABASE_DATABASE_URL_POOLER;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);

if (process.env.NODE_ENV !== "production" && pool) {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = pool ? drizzle(pool) : (null as any);
