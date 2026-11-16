import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Invoice, PreparedPayment } from "@sentinelpay/shared";
import { createApp } from "../apps/api/src/app";
import {
  config,
  database,
  signingWallet,
  testChain,
  transaction,
} from "./helpers";

test("cancellation HTTP flow enforces ownership and closes checkout after a failed attempt", async () => {
  const db = await database(),
    chain = testChain();
  const server = await new Promise<Server>((resolve) => {
    const listener = createApp(db, chain, config).listen(0, "127.0.0.1", () =>
      resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = {
    Origin: config.appOrigin,
    "Content-Type": "application/json",
  };
  const post = (
    path: string,
    body: unknown,
    cookie?: string,
    origin = config.appOrigin,
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        ...headers,
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  async function login(wallet: ReturnType<typeof signingWallet>) {
    const challenge = (await (
      await post("/auth/challenge", { walletAddress: wallet.address })
    ).json()) as { challengeId: string; message: string };
    const response = await post("/auth/verify", {
      challengeId: challenge.challengeId,
      signature: wallet.sign(challenge.message),
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  try {
    const owner = signingWallet(),
      payer = signingWallet();
    const cookie = await login(owner),
      otherCookie = await login(signingWallet());
    const created = await post(
      "/invoices",
      {
        title: "Cancel failed payment",
        amountUsdc: "1",
        expiresInHours: 24,
        requestId: randomUUID(),
      },
      cookie,
    );
    assert.equal(created.status, 201);
    const invoice = (await created.json()) as Invoice,
      path = `/invoices/${invoice.id}/cancel`;
    assert.equal((await post(path, {})).status, 401);
    assert.equal((await post(path, {}, otherCookie)).status, 404);
    assert.equal(
      (await post(path, {}, cookie, "https://untrusted.example")).status,
      403,
    );
    const preparation = await post(
      `/public/invoices/${invoice.id}/transaction`,
      { account: payer.address, requestId: randomUUID() },
    );
    assert.equal(preparation.status, 200);
    const attempt = (await preparation.json()) as PreparedPayment;
    const signature = "2".repeat(88),
      failed = transaction(chain.built[0]);
    failed.meta!.err = { InstructionError: [0, { Custom: 1 }] } as never;
    chain.receipts.set(signature, failed);
    const confirmation = await post(`/public/invoices/${invoice.id}/confirm`, {
      attemptId: attempt.attemptId,
      signature,
    });
    assert.equal(confirmation.status, 422);
    assert.equal(
      ((await confirmation.json()) as { code: string }).code,
      "TRANSACTION_FAILED",
    );
    for (let retry = 0; retry < 2; retry++) {
      const cancelled = await post(path, {}, cookie);
      assert.equal(cancelled.status, 200);
      assert.equal(((await cancelled.json()) as Invoice).status, "cancelled");
    }
    const publicInvoice = await fetch(base + `/public/invoices/${invoice.id}`);
    assert.equal(((await publicInvoice.json()) as Invoice).status, "cancelled");
    const closed = await post(`/public/invoices/${invoice.id}/transaction`, {
      account: payer.address,
      requestId: randomUUID(),
    });
    assert.equal(closed.status, 409);
    assert.equal(
      (
        await db.query(
          "SELECT id FROM audit_events WHERE action='invoice.cancelled' AND entity_id=$1",
          [invoice.id],
        )
      ).rows.length,
      1,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
