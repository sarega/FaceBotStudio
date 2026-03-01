import dotenv from "dotenv";
import { createAppDatabase } from "../backend/db/index";

dotenv.config();

async function main() {
  const db = createAppDatabase();
  try {
    await db.initialize();
    await db.ping();
    console.log(`[db] Migration/bootstrap complete using ${db.driver}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("[db] Migration failed", error);
  process.exit(1);
});
