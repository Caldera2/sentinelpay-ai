import cors from "cors";
import express from "express";
import { aiRouter } from "./routes/ai";
import { authRouter } from "./routes/auth";
import { paymentsRouter } from "./routes/payments";
import { zkRouter } from "./routes/zk";
import { env } from "./lib/env";
import { startSettlementListener } from "./services/contractListener";

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "sentinelpay-ai-api" });
});

app.use("/auth", authRouter);
app.use("/ai", aiRouter);
app.use("/zk", zkRouter);
app.use("/payments", paymentsRouter);

app.listen(env.port, async () => {
  console.log(`SentinelPay API listening on http://localhost:${env.port}`);
  await startSettlementListener();
});
