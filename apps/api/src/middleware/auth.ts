import { NextFunction, Request, Response } from "express";
import { verifyJwt } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      walletAddress?: string;
    }
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return response.status(401).json({ error: "Missing bearer token." });
  }

  try {
    const token = header.replace("Bearer ", "");
    const payload = verifyJwt(token);
    request.walletAddress = payload.walletAddress;
    return next();
  } catch {
    return response.status(401).json({ error: "Invalid session token." });
  }
}

