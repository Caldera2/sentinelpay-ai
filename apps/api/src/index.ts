import cors from "cors";
import express from "express";
import { aiRouter } from "./routes/ai";
import { authRouter } from "./routes/auth";
import { paymentsRouter } from "./routes/payments";
import { zkRouter } from "./routes/zk";
import { env } from "./lib/env";

const app = express();
const corsConfig: cors.CorsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsConfig));
app.options("*", cors(corsConfig));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "sentinelpay-ai-api" });
});

app.use("/auth", authRouter);
app.use("/ai", aiRouter);
app.use("/zk", zkRouter);
app.use("/payments", paymentsRouter);

app.listen(env.port, () => {
  console.log(`SentinelPay API listening on http://localhost:${env.port}`);
});
