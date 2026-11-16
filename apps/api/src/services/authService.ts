import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { isCompromisedWallet } from "@sentinelpay/shared";
import type { Database } from "../lib/db";
import type { AppConfig } from "../lib/env";
import { HttpError } from "../lib/errors";

export const walletSchema = z
  .string()
  .min(32)
  .max(44)
  .refine((address) => {
    try {
      const key = new PublicKey(address);
      return key.toBase58() === address && PublicKey.isOnCurve(key.toBytes()) && !isCompromisedWallet(address);
    } catch {
      return false;
    }
  }, "A signing Solana wallet is required.");
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const cookieName = "sentinelpay.session";

export function createAuthService(
  db: Database,
  config: AppConfig,
  now = () => new Date(),
) {
  return {
    async challenge(wallet: string) {
      walletSchema.parse(wallet);
      const id = randomUUID();
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
      const nonce = randomBytes(24).toString("hex");
      const message = `${new URL(config.appOrigin).host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to SentinelPay. This does not authorize payments.\n\nURI: ${config.appOrigin}\nVersion: 1\nChain ID: solana:${config.cluster}\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
      await db.transaction(async (tx) => {
        await tx.query("DELETE FROM auth_challenges WHERE expires_at <= $1", [
          issuedAt,
        ]);
        await tx.query("DELETE FROM sessions WHERE expires_at <= $1", [
          issuedAt,
        ]);
        const count = await tx.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM auth_challenges WHERE wallet=$1",
          [wallet],
        );
        if (Number(count.rows[0].count) >= 5)
          throw new HttpError(
            429,
            "Too many active sign-in requests. Wait five minutes.",
          );
        await tx.query(
          "INSERT INTO auth_challenges(id,wallet,message,expires_at) VALUES($1,$2,$3,$4)",
          [id, wallet, message, expiresAt],
        );
      });
      return { challengeId: id, message, expiresAt: expiresAt.toISOString() };
    },
    async verify(challengeId: string, signatureBase64: string) {
      return db.transaction(async (tx) => {
        const result = await tx.query<{
          wallet: string;
          message: string;
          expires_at: Date;
        }>(
          "SELECT wallet,message,expires_at FROM auth_challenges WHERE id=$1 FOR UPDATE",
          [challengeId],
        );
        const challenge = result.rows[0];
        if (!challenge || new Date(challenge.expires_at) <= now())
          throw new HttpError(
            401,
            "Sign-in request expired or was already used.",
          );
        walletSchema.parse(challenge.wallet);
        const signature = Buffer.from(signatureBase64, "base64");
        if (
          signature.length !== 64 ||
          signature.toString("base64") !== signatureBase64
        )
          throw new HttpError(401, "Invalid wallet signature.");
        const publicKey = createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            new PublicKey(challenge.wallet).toBuffer(),
          ]),
          format: "der",
          type: "spki",
        });
        if (
          !verify(
            null,
            Buffer.from(challenge.message, "utf8"),
            publicKey,
            signature,
          )
        )
          throw new HttpError(401, "Invalid wallet signature.");
        await tx.query("DELETE FROM auth_challenges WHERE id=$1", [
          challengeId,
        ]);
        await tx.query(
          "INSERT INTO merchants(wallet) VALUES($1) ON CONFLICT DO NOTHING",
          [challenge.wallet],
        );
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now().getTime() + 60 * 60_000);
        await tx.query(
          "INSERT INTO sessions(token_hash,wallet,expires_at) VALUES($1,$2,$3)",
          [hashToken(token), challenge.wallet, expiresAt],
        );
        return { token, walletAddress: challenge.wallet, expiresAt };
      });
    },
    async session(token: string | null) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const result = await db.query<{ wallet: string }>(
        "SELECT wallet FROM sessions WHERE token_hash=$1 AND expires_at>$2",
        [hashToken(token), now()],
      );
      const wallet = result.rows[0]?.wallet;
      return wallet && !isCompromisedWallet(wallet) ? wallet : null;
    },
    async logout(token: string | null) {
      if (token)
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          hashToken(token),
        ]);
    },
  };
}

export function readSessionCookie(header?: string) {
  const cookie = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  return cookie?.slice(cookieName.length + 1) || null;
}
