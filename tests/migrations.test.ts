import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate, schema, SCHEMA_VERSION } from "../apps/api/src/lib/db";
import {
  createAuthService,
  hashToken,
} from "../apps/api/src/services/authService";
import { EXPOSED_SIGNING_ADDRESSES } from "@sentinelpay/shared";
import { config, database, signingWallet } from "./helpers";

test("version 2 preserves verified legacy receipts and revokes exposed-wallet sessions", async () => {
  const db = await database(false);
  try {
    for (const statement of schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
    const wallet = signingWallet().address,
      payer = signingWallet().address,
      invoice = randomUUID(),
      attempt = randomUUID(),
      token = "a".repeat(43),
      exposed = EXPOSED_SIGNING_ADDRESSES[0];
    await db.query("INSERT INTO merchants(wallet) VALUES($1),($2)", [
      wallet,
      exposed,
    ]);
    await db.query(
      "INSERT INTO invoices(id,merchant_wallet,title,amount_atomic,mint,cluster,status,expires_at) VALUES($1,$2,'Legacy',1000000,$3,$4,'paid',now()+interval '1 day')",
      [invoice, wallet, config.usdcMint, config.cluster],
    );
    await db.query(
      "INSERT INTO payment_attempts(id,invoice_id,payer,memo,blockhash,last_valid_block_height,unsigned_transaction,signature,status,received_atomic,confirmed_at) VALUES($1,$2,$3,'legacy','blockhash',1000,'eA==',$4,'confirmed',1500000,now())",
      [attempt, invoice, payer, "B".repeat(88)],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,wallet,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [hashToken(token), exposed],
    );
    await migrate(db);
    await migrate(db);
    const receipt = (
      await db.query<{ received_atomic: string; applied_atomic: string }>(
        "SELECT * FROM payment_receipts",
      )
    ).rows;
    assert.equal(receipt.length, 1);
    assert.equal(receipt[0].received_atomic, "1500000");
    assert.equal(receipt[0].applied_atomic, "1000000");
    assert.equal(
      (
        await db.query(
          "SELECT version FROM schema_migrations WHERE version=$1",
          [SCHEMA_VERSION],
        )
      ).rows.length,
      1,
    );
    assert.equal((await db.query("SELECT * FROM sessions")).rows.length, 0);
    const auth = createAuthService(db, config);
    await assert.rejects(auth.challenge(exposed));
    await db.query(
      "INSERT INTO sessions(token_hash,wallet,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [hashToken(token), exposed],
    );
    assert.equal(await auth.session(token), null);
  } finally {
    await db.close();
  }
});
