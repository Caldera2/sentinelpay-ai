import test from "node:test";
import assert from "node:assert/strict";
import type { Connection } from "@solana/web3.js";
import {
  confirmSignature,
  explorerUrl,
} from "../apps/web/lib/solana/connection";
test("browser confirmation refuses an on-chain error even when the status is finalized", async () => {
  const connection = {
    getSignatureStatuses: async () => ({
      value: [
        {
          err: { InstructionError: [0, "InvalidArgument"] },
          confirmationStatus: "finalized",
        },
      ],
    }),
  } as unknown as Connection;
  await assert.rejects(
    confirmSignature(connection, "signature", 1000),
    /failed on-chain/,
  );
});
test("browser confirmation accepts only finalized success and uses the correct explorer network", async () => {
  const connection = {
    getSignatureStatuses: async () => ({
      value: [{ err: null, confirmationStatus: "finalized" }],
    }),
  } as unknown as Connection;
  await confirmSignature(connection, "signature", 1000);
  assert.match(explorerUrl("signature", "devnet"), /cluster=devnet/);
  assert.doesNotMatch(explorerUrl("signature", "mainnet-beta"), /cluster=/);
});
