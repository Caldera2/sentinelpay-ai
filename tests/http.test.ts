import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../apps/api/src/app";
import type { Database } from "../apps/api/src/lib/db";
import { config, database, signingWallet, testChain } from "./helpers";
let db: Database, server: Server, base: string, cookie: string;
before(async () => {
  db = await database();
  server = await new Promise<Server>((resolve) => {
    const listener = createApp(db, testChain(), config).listen(
      0,
      "127.0.0.1",
      () => resolve(listener),
    );
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.close();
});
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  origin = config.appOrigin,
  session = cookie,
) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("unauthenticated private routes reject requests and malformed JSON does not crash the server", async () => {
  assert.equal((await request("/payments/history")).status, 401);
  assert.equal(
    (await request("/auth/challenge", "POST", { walletAddress: "invalid" }))
      .status,
    400,
  );
  assert.equal(
    (
      await fetch(base + "/auth/challenge", {
        method: "POST",
        headers: {
          Origin: config.appOrigin,
          "Content-Type": "application/json",
        },
        body: "{",
      })
    ).status,
    400,
  );
  assert.equal((await request("/health")).status, 200);
});
test("wallet login returns an HttpOnly session without exposing a bearer token", async () => {
  const wallet = signingWallet();
  const challenge = (await (
    await request("/auth/challenge", "POST", { walletAddress: wallet.address })
  ).json()) as { challengeId: string; message: string };
  const response = await request("/auth/verify", "POST", {
    challengeId: challenge.challengeId,
    signature: wallet.sign(challenge.message),
  });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie")!;
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Lax/i);
  cookie = header.split(";")[0];
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(payload.token, undefined);
  assert.equal((await request("/auth/me")).status, 200);
});
test("cross-origin mutations, client discounts and client receipt status are refused", async () => {
  assert.equal(
    (await request("/invoices", "POST", {}, "https://evil.example")).status,
    403,
  );
  assert.equal(
    (
      await request("/invoices", "POST", {
        title: "Order",
        amountUsdc: "24.99",
        discountBps: 500,
        requestId: crypto.randomUUID(),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/payments/record", "POST", {
        status: "success",
        amount: "1",
      })
    ).status,
    404,
  );
  assert.equal((await request("/zk/verify", "POST", {})).status, 410);
  assert.equal(
    (
      await request("/rpc", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccounts",
        params: [],
      })
    ).status,
    403,
  );
});
test("logout revokes the session and clears its cookie", async () => {
  const response = await request("/auth/logout", "POST", {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie")!, /Expires=/);
  assert.equal((await request("/auth/me")).status, 401);
});
