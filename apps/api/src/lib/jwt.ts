import jwt from "jsonwebtoken";
import { env } from "./env";

export function issueJwt(walletAddress: string) {
  return jwt.sign({ walletAddress }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: "12h"
  });
}

export function verifyJwt(token: string) {
  return jwt.verify(token, env.jwtSecret) as { walletAddress: string };
}

