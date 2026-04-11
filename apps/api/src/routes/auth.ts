import { Router } from "express";
import { SiweMessage, generateNonce } from "siwe";
import { z } from "zod";
import { env } from "../lib/env";
import { issueJwt } from "../lib/jwt";
import { upsertUser } from "../lib/db";

const router = Router();
const challenges = new Map<string, string>();

router.post("/challenge", async (request, response) => {
  const schema = z.object({
    walletAddress: z.string()
  });

  const { walletAddress } = schema.parse(request.body);
  const nonce = generateNonce();

  const message = new SiweMessage({
    domain: env.siweDomain,
    address: walletAddress,
    statement: "Sign in to SentinelPay AI to access AI-assisted payment flows.",
    uri: `http://${env.siweDomain}`,
    version: "1",
    chainId: 133,
    nonce
  }).prepareMessage();

  challenges.set(walletAddress.toLowerCase(), nonce);
  response.json({ message, nonce });
});

router.post("/verify", async (request, response) => {
  const schema = z.object({
    message: z.string(),
    signature: z.string()
  });

  const { message, signature } = schema.parse(request.body);
  const siweMessage = new SiweMessage(message);
  const expectedNonce = challenges.get(siweMessage.address.toLowerCase());

  if (!expectedNonce || siweMessage.nonce !== expectedNonce) {
    return response.status(401).json({ error: "Expired or invalid SIWE challenge." });
  }

  try {
    await siweMessage.verify({ signature, domain: env.siweDomain, nonce: expectedNonce });
    challenges.delete(siweMessage.address.toLowerCase());
    await upsertUser(siweMessage.address, {});

    return response.json({
      token: issueJwt(siweMessage.address),
      walletAddress: siweMessage.address
    });
  } catch {
    return response.status(401).json({ error: "SIWE signature verification failed." });
  }
});

export const authRouter = router;

