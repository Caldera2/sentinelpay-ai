"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card } from "./ui";
import { fetchApiJson } from "../lib/api";

export function ConnectWalletFlow() {
  const { publicKey, connected, signMessage } = useWallet();
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const queries = useQueryClient();
  async function signIn() {
    if (!publicKey || !signMessage) {
      toast.error("Connect a Solana wallet that supports signing messages.");
      return;
    }
    setBusy(true);
    try {
      const walletAddress = publicKey.toBase58();
      const challenge = await fetchApiJson<{
        challengeId: string;
        message: string;
      }>("/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ walletAddress }),
      });
      const signed = await signMessage(
        new TextEncoder().encode(challenge.message),
      );
      const session = await fetchApiJson<{ walletAddress: string }>(
        "/auth/verify",
        {
          method: "POST",
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            signature: btoa(String.fromCharCode(...signed)),
          }),
        },
      );
      queries.removeQueries({
        predicate: (query) =>
          !["session", "config"].includes(String(query.queryKey[0])),
      });
      queries.setQueryData(["session"], {
        walletAddress: session.walletAddress,
      });
      toast.success("Wallet ownership verified.");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to sign in.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-6 border-cyan-400/20">
      <div>
        <p className="text-xs uppercase tracking-widest text-cyan-200">
          Merchant sign in
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          Connect your Solana wallet
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">
          Sign a short-lived message to prove ownership of your merchant wallet.
          Your wallet remains in control of your funds.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <WalletMultiButton />
        <Button
          disabled={!connected || busy || !signMessage}
          onClick={() => void signIn()}
        >
          {busy ? "Waiting for signature…" : "Sign in securely"}
        </Button>
      </div>
      <p className="text-sm text-slate-400">
        Signing in is free and does not authorize a payment or establish
        identity verification.
      </p>
    </Card>
  );
}
