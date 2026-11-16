import { createApp } from "./app";
import { createDatabase, migrate, SCHEMA_VERSION } from "./lib/db";
import { readEnv } from "./lib/env";
import { createChain } from "./services/chain";
import { createInvoiceService } from "./services/invoiceService";
import { startReconciler } from "./services/reconciler";
import { createRefundService } from "./services/refundService";

async function main() {
  const config = readEnv();
  const db = createDatabase(config);
  if (!config.production) await migrate(db);
  const schema = await db.query(
    "SELECT version FROM schema_migrations WHERE version=$1",[SCHEMA_VERSION],
  );
  if (!schema.rows.length) throw new Error("Database migrations are required.");
  const chain = createChain(config);
  const stopReconciler = startReconciler(
    db,
    chain,
    createInvoiceService(db, chain, config),
    createRefundService(db,chain,config),
  );
  const server = createApp(db, chain, config).listen(config.port, () =>
    console.log(
      `SentinelPay API listening on port ${config.port} (${config.cluster})`,
    ),
  );
  const shutdown = () => {
    server.close(() => {
      void stopReconciler()
        .then(() => db.close())
        .then(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
void main().catch((error) => {
  console.error(
    "API startup failed",
    error instanceof Error
      ? error.message.replace(/(?:https?|postgres(?:ql)?|wss?):\/\/\S+/gi, "[redacted URL]")
      : "Configuration error",
  );
  process.exitCode = 1;
});
