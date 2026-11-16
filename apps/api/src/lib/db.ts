import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import type { AppConfig } from "./env";

export interface Sql {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(
  config: Pick<AppConfig, "databaseUrl" | "dataDir" | "production"> & {
    schema?: string;
  },
): Database {
  if (config.databaseUrl) {
    if (config.schema && !/^[a-z_][a-z0-9_]{0,62}$/.test(config.schema))
      throw new Error("Invalid database schema.");
    const pool = postgres(config.databaseUrl, {
      max: 10,
      connect_timeout: 10,
      idle_timeout: 30,
      ssl: config.production ? { rejectUnauthorized: true } : false,
      connection: {
        search_path: config.schema || "public",
        client_min_messages: "warning",
      },
    });
    const client = (sql: Pick<typeof pool, "unsafe">): Sql => ({
      query: async <T>(statement: string, params: unknown[] = []) => ({
        rows: Array.from(
          await sql.unsafe(
            statement,
            params as NonNullable<Parameters<typeof pool.unsafe>[1]>,
          ),
        ) as T[],
      }),
    });
    return {
      query: client(pool).query,
      async transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
        return (await pool.begin(async (tx) => fn(client(tx)))) as T;
      },
      close: () => pool.end({ timeout: 5 }),
    };
  }
  const pg = new PGlite(config.dataDir);
  return {
    query: async <T>(sql: string, params: unknown[] = []) => ({
      rows: (await pg.query<T>(sql, params)).rows,
    }),
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params: unknown[] = []) => ({
            rows: (await tx.query<T>(sql, params)).rows,
          }),
        }),
      ),
    close: () => pg.close(),
  };
}

export const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS merchants (
  wallet text COLLATE "C" PRIMARY KEY,
  name text NOT NULL DEFAULT 'Merchant' CHECK (length(name) BETWEEN 1 AND 100),
  liquid_bps integer NOT NULL DEFAULT 10000 CHECK (liquid_bps BETWEEN 0 AND 10000),
  reserve_atomic numeric(20,0) NOT NULL DEFAULT 0 CHECK (reserve_atomic >= 0),
  expenses_atomic numeric(20,0) NOT NULL DEFAULT 0 CHECK (expenses_atomic >= 0),
  eligibility_acknowledged boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY, wallet text COLLATE "C" NOT NULL, message text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, wallet text COLLATE "C" NOT NULL REFERENCES merchants(wallet), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY, merchant_wallet text COLLATE "C" NOT NULL REFERENCES merchants(wallet),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  amount_atomic numeric(20,0) NOT NULL CHECK (amount_atomic > 0 AND amount_atomic <= 1000000000000),
  mint text COLLATE "C" NOT NULL, cluster text NOT NULL CHECK (cluster IN ('devnet', 'mainnet-beta')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  paid_late boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_merchant_date ON invoices(merchant_wallet, created_at DESC, id);
CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), payer text COLLATE "C" NOT NULL,
  memo text UNIQUE NOT NULL, blockhash text NOT NULL, last_valid_block_height bigint NOT NULL,
  unsigned_transaction text NOT NULL,
  signature text COLLATE "C" UNIQUE,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','confirmed','failed')),
  received_atomic numeric(20,0), confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  ,last_checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS attempts_invoice ON payment_attempts(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_one_receipt ON payment_attempts(invoice_id) WHERE status='confirmed';
CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, wallet text COLLATE "C" NOT NULL,
  action text NOT NULL, entity_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_wallet_date ON audit_events(wallet, created_at DESC);
CREATE TABLE IF NOT EXISTS treasury_trades (
  id uuid PRIMARY KEY, merchant_wallet text COLLATE "C" NOT NULL REFERENCES merchants(wallet),
  direction text NOT NULL CHECK(direction IN ('allocate','withdraw')),
  input_mint text COLLATE "C" NOT NULL, output_mint text COLLATE "C" NOT NULL,
  input_atomic numeric(20,0) NOT NULL CHECK(input_atomic>0), minimum_output_atomic numeric(20,0) NOT NULL CHECK(minimum_output_atomic>0),
  memo text NOT NULL UNIQUE, blockhash text NOT NULL, last_valid_block_height bigint NOT NULL, unsigned_transaction text NOT NULL,
  submitted_signature text COLLATE "C", signature text COLLATE "C" UNIQUE,
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','confirmed','expired')),
  received_atomic numeric(20,0), created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS treasury_one_pending ON treasury_trades(merchant_wallet) WHERE status='prepared';
CREATE INDEX IF NOT EXISTS treasury_merchant_date ON treasury_trades(merchant_wallet,created_at DESC);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`;

export const SCHEMA_VERSION = 2;
export const receiptSchema = `
ALTER TABLE payment_attempts ADD COLUMN input_mint text COLLATE "C";
UPDATE payment_attempts p SET input_mint=i.mint FROM invoices i WHERE i.id=p.invoice_id;
ALTER TABLE payment_attempts ALTER COLUMN input_mint SET NOT NULL;
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_status_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_status_check CHECK(status IN ('prepared','confirmed','duplicate','failed'));
CREATE TABLE payment_receipts (
  id uuid PRIMARY KEY, signature text COLLATE "C" NOT NULL UNIQUE,
  attempt_id uuid NOT NULL REFERENCES payment_attempts(id), invoice_id uuid NOT NULL REFERENCES invoices(id),
  received_atomic numeric(20,0) NOT NULL CHECK(received_atomic>0),
  applied_atomic numeric(20,0) NOT NULL CHECK(applied_atomic>=0 AND applied_atomic<=received_atomic),
  confirmed_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX receipt_one_invoice_payment ON payment_receipts(invoice_id) WHERE applied_atomic>0;
CREATE INDEX receipts_invoice_date ON payment_receipts(invoice_id,confirmed_at DESC,id);
CREATE INDEX receipts_attempt ON payment_receipts(attempt_id);
INSERT INTO payment_receipts(id,signature,attempt_id,invoice_id,received_atomic,applied_atomic,confirmed_at)
SELECT p.id,p.signature,p.id,p.invoice_id,COALESCE(p.received_atomic,i.amount_atomic),i.amount_atomic,p.confirmed_at
FROM payment_attempts p JOIN invoices i ON i.id=p.invoice_id WHERE p.status='confirmed';
CREATE TABLE refunds (
  id uuid PRIMARY KEY, receipt_id uuid NOT NULL REFERENCES payment_receipts(id),
  merchant_wallet text COLLATE "C" NOT NULL REFERENCES merchants(wallet),
  destination text COLLATE "C" NOT NULL, amount_atomic numeric(20,0) NOT NULL CHECK(amount_atomic>0),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), memo text NOT NULL UNIQUE,
  blockhash text NOT NULL,last_valid_block_height bigint NOT NULL,unsigned_transaction text NOT NULL,
  submitted_signature text COLLATE "C",signature text COLLATE "C" UNIQUE,
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','confirmed','failed','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),confirmed_at timestamptz,last_checked_at timestamptz
);
CREATE UNIQUE INDEX refund_one_pending_per_merchant ON refunds(merchant_wallet) WHERE status='prepared';
CREATE INDEX refunds_receipt_status ON refunds(receipt_id,status);
CREATE INDEX refunds_merchant_date ON refunds(merchant_wallet,created_at DESC,id);
DELETE FROM sessions WHERE wallet='9pkPja8kDWGWyCNE7PWhwUbe1hgwyEpFQLgohLzMXoAH';
DELETE FROM auth_challenges WHERE wallet='9pkPja8kDWGWyCNE7PWhwUbe1hgwyEpFQLgohLzMXoAH';
`;

export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    for (const statement of schema
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean))
      await tx.query(statement);
    await tx.query(
      "SELECT version FROM schema_migrations WHERE version=1 FOR UPDATE",
    );
    const current = await tx.query(
      "SELECT version FROM schema_migrations WHERE version=$1",
      [SCHEMA_VERSION],
    );
    if (!current.rows.length) {
      for (const statement of receiptSchema
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        SCHEMA_VERSION,
      ]);
    }
  });
}
