import { PostgresAppDatabase } from "./postgresAdapter";
import { SqliteAppDatabase } from "./sqliteAdapter";
import type { AppDatabase } from "./types";

export * from "./types";

export function createAppDatabase(): AppDatabase {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    console.log("[db] Using PostgreSQL via DATABASE_URL");
    return new PostgresAppDatabase(databaseUrl, process.env.DB_PATH || "bot.db");
  }

  console.log("[db] DATABASE_URL is not set; falling back to SQLite");
  return new SqliteAppDatabase(process.env.DB_PATH || "bot.db");
}
