import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { isIP } from "node:net";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z, ZodError } from "zod";
import {
  parseUsdc,
  suggestPaymentStrategy,
  type Merchant,
} from "@sentinelpay/shared";
import { SCHEMA_VERSION, type Database } from "./lib/db";
import type { AppConfig } from "./lib/env";
import { HttpError } from "./lib/errors";
import {
  createAuthService,
  cookieName,
  readSessionCookie,
  walletSchema,
} from "./services/authService";
import { createInvoiceService } from "./services/invoiceService";
import type { Chain } from "./services/chain";
import { createTreasuryService } from "./services/treasuryService";
import { createRefundService } from "./services/refundService";
import { requireAuth } from "./middleware/auth";

const uuid = z.string().uuid();
const publicKey = z
  .string()
  .min(32)
  .max(44)
  .refine((value) => {
    try {
      return new PublicKey(value).toBase58() === value;
    } catch {
      return false;
    }
  }, "Invalid Solana public key.");
const money = z.string().refine((value) => {
  try {
    parseUsdc(value, true);
    return true;
  } catch {
    return false;
  }
}, "Invalid USDC amount.");
const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
type MerchantRow = {
  wallet: string;
  name: string;
  liquid_bps: number;
  reserve_atomic: string;
  expenses_atomic: string;
  eligibility_acknowledged: boolean;
};
const merchantView = (row: MerchantRow): Merchant => ({
  walletAddress: row.wallet,
  name: row.name,
  liquidBps: row.liquid_bps,
  reserveAtomic: row.reserve_atomic,
  upcomingExpensesAtomic: row.expenses_atomic,
  eligibilityAcknowledged: row.eligibility_acknowledged,
});

export function createApp(db: Database, chain: Chain, config: AppConfig) {
  const app = express();
  const auth = createAuthService(db, config);
  const protectedRoute = requireAuth(auth);
  const invoices = createInvoiceService(db, chain, config);
  const treasury = createTreasuryService(db, chain, config);
  const refunds = createRefundService(db, chain, config);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.appOrigin,
      credentials: true,
      methods: ["GET", "POST", "PATCH"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.requestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/health", async (_req, res) => {
    const migration = await db.query(
      "SELECT version FROM schema_migrations WHERE version=$1",
      [SCHEMA_VERSION],
    );
    if (!migration.rows.length)
      throw new HttpError(503, "Database migration is required.");
    res.json({ ok: true, service: "sentinelpay-api" });
  });
  app.use((req, _res, next) => {
    if (config.proxySecret) {
      const actual = Buffer.from(req.get("X-SentinelPay-Proxy") || "");
      const expected = Buffer.from(config.proxySecret);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new HttpError(403, "Use the SentinelPay application API.");
    }
    if (
      ["POST", "PATCH", "DELETE"].includes(req.method) &&
      !req.path.startsWith("/public/") &&
      req.path !== "/rpc" &&
      req.get("Origin") !== config.appOrigin
    )
      throw new HttpError(403, "Request origin is not allowed.");
    next();
  });
  // One API process is the supported deployment; shared-store limiting is required before horizontal scaling.
  const rateKey = (req: express.Request) => {
    // The proxy credential has already been checked. The web forwards this only
    // from Vercel's platform-controlled address header, never a caller's header.
    const clientIp = config.proxySecret
      ? req.get("X-SentinelPay-Client-IP")
      : undefined;
    return ipKeyGenerator(
      clientIp && isIP(clientIp) ? clientIp : req.ip || "127.0.0.1",
    );
  };
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      keyGenerator: rateKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Try again shortly." },
    }),
  );
  app.use(
    "/auth",
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      keyGenerator: rateKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many sign-in requests. Try again shortly." },
    }),
  );
  app.get("/config", (_req, res) =>
    res.json({
      cluster: config.cluster,
      usdcMint: config.usdcMint,
      swapEnabled: config.swapEnabled,
      treasuryEnabled: config.treasuryEnabled,
      rwaMint: config.rwaMint,
    }),
  );
  app.post("/auth/challenge", async (req, res) => {
    const { walletAddress } = z
      .object({ walletAddress: walletSchema })
      .strict()
      .parse(req.body);
    res.json(await auth.challenge(walletAddress));
  });
  app.post("/auth/verify", async (req, res) => {
    const { challengeId, signature } = z
      .object({ challengeId: uuid, signature: z.string().length(88) })
      .strict()
      .parse(req.body);
    const session = await auth.verify(challengeId, signature);
    await auth.logout(readSessionCookie(req.headers.cookie));
    res.cookie(cookieName, session.token, {
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60_000,
    });
    res.json({
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt.toISOString(),
    });
  });
  app.get("/auth/me", protectedRoute, (req, res) =>
    res.json({ walletAddress: req.walletAddress }),
  );
  app.post("/auth/logout", async (req, res) => {
    await auth.logout(readSessionCookie(req.headers.cookie));
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      path: "/",
    });
    res.json({ ok: true });
  });
  app.get("/merchant", protectedRoute, async (req, res) => {
    const result = await db.query<MerchantRow>(
      "SELECT * FROM merchants WHERE wallet=$1",
      [req.walletAddress],
    );
    res.json(merchantView(result.rows[0]));
  });
  app.patch("/merchant", protectedRoute, async (req, res) => {
    const payload = z
      .object({
        name: z.string().trim().min(1).max(100),
        liquidBps: z.number().int().min(0).max(10000),
        reserveUsdc: money,
        upcomingExpensesUsdc: money,
        eligibilityAcknowledged: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const updated = await tx.query<MerchantRow>(
        "UPDATE merchants SET name=$1,liquid_bps=$2,reserve_atomic=$3,expenses_atomic=$4,eligibility_acknowledged=$5 WHERE wallet=$6 RETURNING *",
        [
          payload.name,
          payload.liquidBps,
          parseUsdc(payload.reserveUsdc, true).toString(),
          parseUsdc(payload.upcomingExpensesUsdc, true).toString(),
          payload.eligibilityAcknowledged,
          req.walletAddress,
        ],
      );
      await tx.query(
        "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,'merchant.policy.updated',$1)",
        [req.walletAddress],
      );
      return updated;
    });
    res.json(merchantView(result.rows[0]));
  });
  app.get("/invoices", protectedRoute, async (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    res.json({ items: await invoices.list(req.walletAddress!, limit, offset) });
  });
  app.post("/invoices", protectedRoute, async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(200),
        amountUsdc: money,
        expiresInHours: z.number().int().min(1).max(720).default(24),
        requestId: uuid,
      })
      .strict()
      .parse(req.body);
    if (parseUsdc(body.amountUsdc, true) === 0n)
      throw new HttpError(400, "Invoice amount must be positive.");
    res
      .status(201)
      .json(
        await invoices.create(
          req.walletAddress!,
          body.title,
          body.amountUsdc,
          body.expiresInHours,
          body.requestId,
        ),
      );
  });
  app.post("/invoices/:id/cancel", protectedRoute, async (req, res) =>
    res.json(
      await invoices.cancel(uuid.parse(req.params.id), req.walletAddress!),
    ),
  );
  app.get("/public/invoices/:id", async (req, res) =>
    res.json(await invoices.get(uuid.parse(req.params.id))),
  );
  app.post("/public/invoices/:id/transaction", async (req, res) => {
    const body = z
      .object({
        account: walletSchema,
        inputMint: publicKey.optional(),
        requestId: uuid,
      })
      .strict()
      .parse(req.body);
    res.json(
      await invoices.prepare(
        uuid.parse(req.params.id),
        body.account,
        body.inputMint,
        body.requestId,
      ),
    );
  });
  app.post("/public/invoices/:id/confirm", async (req, res) => {
    const body = z
      .object({
        attemptId: uuid,
        signature: z
          .string()
          .min(64)
          .max(88)
          .regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
      })
      .strict()
      .parse(req.body);
    res.json(
      await invoices.confirm(
        uuid.parse(req.params.id),
        body.attemptId,
        body.signature,
      ),
    );
  });
  app.get("/payments/history", protectedRoute, async (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    res.json({
      items: await invoices.history(req.walletAddress!, limit, offset),
    });
  });
  app.get("/payments/summary", protectedRoute, async (req, res) => {
    res.json(await invoices.summary(req.walletAddress!));
  });
  app.get("/payments/export", protectedRoute, async (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    const items = await invoices.history(req.walletAddress!, limit, offset);
    const cell = (value: string) =>
      `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
    const rows = items.map((item) =>
      [
        item.invoiceId,
        item.title,
        item.payer,
        item.amountAtomic,
        item.receivedAtomic,
        item.appliedAtomic,
        item.refundedAtomic,
        item.refundableAtomic,
        item.kind,
        item.signature,
        item.cluster,
        item.confirmedAt,
      ]
        .map(cell)
        .join(","),
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sentinelpay-payments.csv"',
    );
    res
      .type("text/csv")
      .send(
        [
          "invoice_id,title,payer,invoice_amount_atomic,received_atomic,applied_atomic,refunded_atomic,refundable_atomic,kind,signature,network,confirmed_at",
          ...rows,
        ].join("\r\n"),
      );
  });
  app.get("/refunds/pending", protectedRoute, async (req, res) =>
    res.json(await refunds.pending(req.walletAddress!)),
  );
  app.get("/refunds/history", protectedRoute, async (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    res.json({
      items: await refunds.history(req.walletAddress!, limit, offset),
    });
  });
  app.post("/refunds/transaction", protectedRoute, async (req, res) => {
    const body = z
      .object({
        receiptId: uuid,
        amountUsdc: money,
        reason: z.string().trim().min(1).max(500),
        requestId: uuid,
      })
      .strict()
      .parse(req.body);
    if (parseUsdc(body.amountUsdc, true) === 0n)
      throw new HttpError(400, "Refund amount must be positive.");
    res.json(
      await refunds.prepare(
        req.walletAddress!,
        body.receiptId,
        body.amountUsdc,
        body.reason,
        body.requestId,
      ),
    );
  });
  app.post("/refunds/:id/confirm", protectedRoute, async (req, res) => {
    const body = z
      .object({
        signature: z
          .string()
          .min(64)
          .max(88)
          .regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
      })
      .strict()
      .parse(req.body);
    res.json(
      await refunds.confirm(
        req.walletAddress!,
        uuid.parse(req.params.id),
        body.signature,
      ),
    );
  });
  app.post("/refunds/:id/expire", protectedRoute, async (req, res) =>
    res.json(
      await refunds.expire(req.walletAddress!, uuid.parse(req.params.id)),
    ),
  );
  app.get("/treasury/balance", protectedRoute, async (req, res) =>
    res.json({
      availableUsdcAtomic: await chain.balance(
        req.walletAddress!,
        config.usdcMint,
      ),
      updatedAt: new Date().toISOString(),
    }),
  );
  app.get("/treasury/plan", protectedRoute, async (req, res) => {
    const merchant = (
      await db.query<MerchantRow>("SELECT * FROM merchants WHERE wallet=$1", [
        req.walletAddress,
      ])
    ).rows[0];
    const balance = await chain.balance(req.walletAddress!, config.usdcMint);
    res.json(
      suggestPaymentStrategy({
        availableUsdcAtomic: balance,
        reserveAtomic: merchant.reserve_atomic,
        upcomingExpensesAtomic: merchant.expenses_atomic,
        liquidBps: merchant.liquid_bps,
      }),
    );
  });
  app.post("/treasury/transaction", protectedRoute, async (req, res) => {
    const body = z
      .object({
        direction: z.enum(["allocate", "withdraw"]),
        requestId: uuid,
        amountAtomic: z
          .string()
          .regex(/^[1-9]\d{0,15}$/)
          .optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await treasury.prepare(
        req.walletAddress!,
        body.direction,
        body.requestId,
        body.amountAtomic,
      ),
    );
  });
  app.get("/treasury/pending", protectedRoute, async (req, res) =>
    res.json(await treasury.pending(req.walletAddress!)),
  );
  app.post("/treasury/:id/confirm", protectedRoute, async (req, res) => {
    const body = z
      .object({
        signature: z
          .string()
          .min(64)
          .max(88)
          .regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
      })
      .strict()
      .parse(req.body);
    res.json(
      await treasury.confirm(
        req.walletAddress!,
        uuid.parse(req.params.id),
        body.signature,
      ),
    );
  });
  app.post("/treasury/:id/expire", protectedRoute, async (req, res) =>
    res.json(
      await treasury.expire(req.walletAddress!, uuid.parse(req.params.id)),
    ),
  );
  const allowedRpc = new Set([
    "getLatestBlockhash",
    "getBlockHeight",
    "getSignatureStatuses",
    "getFeeForMessage",
    "getBalance",
    "getAccountInfo",
    "getMultipleAccounts",
    "getTokenAccountBalance",
    "getMinimumBalanceForRentExemption",
    "getRecentPrioritizationFees",
    "simulateTransaction",
    "sendTransaction",
    "getVersion",
    "getGenesisHash",
  ]);
  app.post("/rpc", async (req, res) => {
    const body = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.number(), z.string()]),
        method: z.string(),
        params: z.array(z.unknown()).max(10).default([]),
      })
      .strict()
      .parse(req.body);
    if (!allowedRpc.has(body.method))
      throw new HttpError(
        403,
        "RPC method is not available through this gateway.",
      );
    const result = (await chain.rpc(body.method, body.params)) as Record<
      string,
      unknown
    >;
    res.json({ ...result, id: body.id });
  });
  app.use("/zk", (_req, res) =>
    res.status(410).json({
      error:
        "Identity proof verification is not implemented. No identity or privacy status is issued.",
    }),
  );
  app.use((_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError && error.status === 202) {
      res.status(202).json({ pending: true, message: error.message });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Invalid request.",
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large." });
      return;
    }
    if (error?.code === "23505") {
      res
        .status(409)
        .json({ error: "This receipt or request has already been recorded." });
      return;
    }
    // Do not return RPC URLs, database connection strings, provider responses, or stack traces.
    console.error("API request failed", {
      requestId: res.locals.requestId,
      type: error?.name || "Error",
      code: error?.code || "unknown",
    });
    res.status(503).json({
      error:
        "Service temporarily unavailable. Retry status checks before sending another payment.",
      requestId: res.locals.requestId,
    });
  };
  app.use(errors);
  return app;
}
