import { readdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export async function runPostgresMigrations(pool: Pool) {
  const client = await pool.connect();
  const lock = "SELECT pg_advisory_%s(hashtext('facebotstudio.schema_migrations'), hashtext(current_database()))";
  let locked = false;
  let releaseError: Error | undefined;
  try {
    await client.query(lock.replace("%s", "lock"));
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const fileName of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [fileName]);
      if (applied.rowCount) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, fileName), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [fileName]);
        await client.query("COMMIT");
        console.log(`[db] Applied migration ${fileName}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (locked) await client.query(lock.replace("%s", "unlock"));
    } catch (error) {
      releaseError = error as Error;
    } finally {
      client.release(releaseError);
    }
  }
}
