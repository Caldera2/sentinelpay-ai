import { createDatabase, migrate, SCHEMA_VERSION } from "./lib/db";
import { readEnv } from "./lib/env";

async function main() {
  const db = createDatabase(readEnv());
  try {
    await migrate(db);
    console.log(`Database schema is current (version ${SCHEMA_VERSION}).`);
  } finally {
    await db.close();
  }
}
void main().catch(() => {
  console.error(
    "Migration failed. Check database connectivity and permissions.",
  );
  process.exitCode = 1;
});
