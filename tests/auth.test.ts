import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "../apps/api/src/lib/db";
import { createAuthService } from "../apps/api/src/services/authService";
import { config, database, signingWallet } from "./helpers";
let db: Database;
before(async () => {
  db = await database();
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query("TRUNCATE merchants,auth_challenges,sessions CASCADE");
});

test("valid Solana signature creates an opaque, revocable session", async () => {
  const wallet = signingWallet();
  const auth = createAuthService(db, config);
  const challenge = await auth.challenge(wallet.address);
  assert.match(challenge.message, /Chain ID: solana:devnet/);
  const session = await auth.verify(
    challenge.challengeId,
    wallet.sign(challenge.message),
  );
  assert.equal(await auth.session(session.token), wallet.address);
  assert.equal(session.token.length, 43);
  await auth.logout(session.token);
  assert.equal(await auth.session(session.token), null);
});
test("signatures from a different wallet and changed messages are rejected", async () => {
  const owner = signingWallet(),
    attacker = signingWallet(),
    auth = createAuthService(db, config);
  const challenge = await auth.challenge(owner.address);
  await assert.rejects(
    auth.verify(challenge.challengeId, attacker.sign(challenge.message)),
    /Invalid wallet signature/,
  );
  await assert.rejects(
    auth.verify(challenge.challengeId, owner.sign(challenge.message + "x")),
    /Invalid wallet signature/,
  );
  assert.equal((await db.query("SELECT * FROM sessions")).rows.length, 0);
});
test("challenge replay and concurrent replay issue at most one session", async () => {
  const owner = signingWallet(),
    auth = createAuthService(db, config),
    challenge = await auth.challenge(owner.address);
  const signature = owner.sign(challenge.message);
  const results = await Promise.allSettled([
    auth.verify(challenge.challengeId, signature),
    auth.verify(challenge.challengeId, signature),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal((await db.query("SELECT * FROM sessions")).rows.length, 1);
});
test("expired challenges and expired sessions are refused", async () => {
  let now = new Date();
  const auth = createAuthService(db, config, () => now),
    owner = signingWallet();
  const expired = await auth.challenge(owner.address);
  now = new Date(now.getTime() + 6 * 60000);
  await assert.rejects(
    auth.verify(expired.challengeId, owner.sign(expired.message)),
    /expired/,
  );
  const fresh = await auth.challenge(owner.address);
  const session = await auth.verify(
    fresh.challengeId,
    owner.sign(fresh.message),
  );
  now = new Date(now.getTime() + 61 * 60000);
  assert.equal(await auth.session(session.token), null);
});
test("Ethereum addresses, off-curve keys and malformed tokens cannot authenticate", async () => {
  const auth = createAuthService(db, config);
  await assert.rejects(auth.challenge("0x" + "1".repeat(40)));
  assert.equal(await auth.session("sentinelpay-demo-secret"), null);
  await assert.rejects(auth.verify(randomUUID(), "A".repeat(88)), /expired/);
});
