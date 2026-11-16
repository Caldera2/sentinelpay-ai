import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../apps/api/src/app";
import { config, database, testChain } from "./helpers";

test("proxy client addresses require the proxy credential and have independent rate limits", async () => {
  const db = await database();
  const secret = "test-proxy-credential-".repeat(3);
  const server = await new Promise<Server>((resolve) => {
    const listener = createApp(db, testChain(), {
      ...config,
      proxySecret: secret,
    }).listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const request = (ip: string, credential = secret) =>
      fetch(`${base}/auth/me`, {
        headers: {
          "X-SentinelPay-Proxy": credential,
          "X-SentinelPay-Client-IP": ip,
        },
      });
    assert.equal((await request("192.0.2.1", "wrong")).status, 403);
    for (let index = 0; index < 30; index++)
      assert.equal((await request("192.0.2.1")).status, 401);
    const limited = await request("192.0.2.1");
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
    assert.equal((await request("192.0.2.2")).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});

test("direct callers cannot evade rate limits with a client-address header", async () => {
  const db = await database();
  const server = await new Promise<Server>((resolve) => {
    const listener = createApp(db, testChain(), config).listen(
      0,
      "127.0.0.1",
      () => resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (let index = 0; index < 31; index++) {
      const response = await fetch(`${base}/auth/me`, {
        headers: { "X-SentinelPay-Client-IP": `192.0.2.${index + 1}` },
      });
      assert.equal(response.status, index < 30 ? 401 : 429);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
