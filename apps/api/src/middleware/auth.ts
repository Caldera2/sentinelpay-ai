import type { NextFunction, Request, Response } from "express";
import type { createAuthService } from "../services/authService";
import { readSessionCookie } from "../services/authService";
import { HttpError } from "../lib/errors";

declare global {
  namespace Express {
    interface Request {
      walletAddress?: string;
    }
  }
}

export function requireAuth(auth: ReturnType<typeof createAuthService>) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const wallet = await auth.session(
      readSessionCookie(request.headers.cookie),
    );
    if (!wallet) throw new HttpError(401, "Sign in with your Solana wallet.");
    request.walletAddress = wallet;
    next();
  };
}
