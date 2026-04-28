"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { toast } from "sonner";
import { IdentityVerificationModal } from "./identity-verification-modal";
import { Button, Card } from "./ui";
import { backendSetupMessage, fetchApiJson, isApiConfigured } from "../lib/api";

type StatusState = "idle" | "connected" | "checking" | "verified" | "needs-verification";

export function ConnectWalletFlow() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const [status, setStatus] = useState<StatusState>("idle");
  const [modalOpen, setModalOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setStatus("idle");
      return;
    }

    setStatus("connected");
  }, [connected, publicKey]);

  async function checkShieldStatus() {
    if (!publicKey || !isApiConfigured) {
      return;
    }

    setStatus("checking");

    try {
      const payload = await fetchApiJson<{ verified: boolean }>(`/zk/status/${publicKey.toBase58()}`);

      if (payload.verified) {
        setStatus("verified");
        toast.success("Shield status already verified. Redirecting to the treasury dashboard.");
        router.push("/dashboard");
        return;
      }

      setStatus("needs-verification");
      setModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : backendSetupMessage);
      setStatus("connected");
    }
  }

  async function handleContinue() {
    if (!publicKey) {
      toast.error("Connect a Solana wallet to continue.");
      return;
    }

    if (!isApiConfigured) {
      router.push("/dashboard");
      return;
    }

    await checkShieldStatus();
  }

  async function handleVerify() {
    if (!publicKey) {
      return;
    }

    setVerifying(true);

    try {
      const payload = await fetchApiJson<{ verified: boolean }>("/zk/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() })
      });

      if (!payload.verified) {
        throw new Error("Shield verification failed.");
      }

      setStatus("verified");
      toast.success("Privacy shield verified. Treasury tools unlocked.");
      setModalOpen(false);
      router.push("/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify privacy shield right now.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <Card className="space-y-6 border-cyan-400/20 bg-slate-950/70">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Solana Treasury Login</div>
          <h2 className="font-display text-3xl text-white">Connect once. Route payments intelligently.</h2>
          <p className="max-w-xl text-sm leading-6 text-slate-300">
            Connect a Solana wallet, check privacy shield status, and jump into a merchant cockpit built around
            USDC settlement, Jupiter routing, and live RWA treasury allocation.
          </p>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <WalletMultiButton className="!h-12 !rounded-2xl !bg-cyan-400 !px-5 !text-sm !font-semibold !text-slate-950" />
          <Button onClick={handleContinue} className="min-w-52" disabled={!connected}>
            Continue to Dashboard
          </Button>
          <Button variant="secondary" onClick={() => void checkShieldStatus()} disabled={!connected || !isApiConfigured}>
            Check Shield Status
          </Button>
        </div>

        {!isApiConfigured ? (
          <div className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            {backendSetupMessage}
          </div>
        ) : null}

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          Status:{" "}
          <span className="font-medium text-white">
            {status === "idle" && "Waiting for wallet connection"}
            {status === "connected" && "Wallet connected"}
            {status === "checking" && "Checking privacy shield status"}
            {status === "verified" && "Shield verified and ready"}
            {status === "needs-verification" && "Verification required"}
          </span>
        </div>
      </Card>

      <IdentityVerificationModal
        open={modalOpen}
        loading={verifying}
        onClose={() => setModalOpen(false)}
        onVerify={handleVerify}
      />
    </>
  );
}
