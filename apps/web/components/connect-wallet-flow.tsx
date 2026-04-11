"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { apiBaseUrl, setSessionToken } from "../lib/api";
import { hashKeyTestnet } from "../lib/wagmi";
import { IdentityVerificationModal } from "./identity-verification-modal";
import { Button, Card } from "./ui";

type StatusState = "idle" | "authenticating" | "checking" | "verified" | "needs-verification";

function getWalletErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Unable to open wallet connection.";
}

function toWalletToastMessage(error: unknown) {
  const message = getWalletErrorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("failed to connect to metamask")) {
    return "MetaMask couldn't connect. Unlock the extension, approve access, and try again.";
  }

  if (normalized.includes("user rejected") || normalized.includes("4001")) {
    return "User rejected the wallet request.";
  }

  return message;
}

export function ConnectWalletFlow() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const hasStarted = useRef(false);
  const [status, setStatus] = useState<StatusState>("idle");
  const [modalOpen, setModalOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const message = getWalletErrorMessage(event.error ?? event.message);

      if (!message.toLowerCase().includes("failed to connect to metamask")) {
        return;
      }

      event.preventDefault();
      toast.error("MetaMask couldn't connect. Unlock the extension, approve access, and try again.");
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = getWalletErrorMessage(event.reason);

      if (!message.toLowerCase().includes("failed to connect to metamask")) {
        return;
      }

      event.preventDefault();
      toast.error("MetaMask couldn't connect. Unlock the extension, approve access, and try again.");
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  async function handleConnect() {
    try {
      const connector = connectors.find((item) => item.name === "MetaMask") ?? connectors[0];

      if (!connector) {
        throw new Error("No wallet connector is available.");
      }

      await connectAsync({
        connector,
        chainId: hashKeyTestnet.id
      });
    } catch (error) {
      toast.error(toWalletToastMessage(error));
    }
  }

  useEffect(() => {
    if (!isConnected || !address || hasStarted.current) {
      return;
    }

    hasStarted.current = true;

    const authenticateAndCheck = async () => {
      setStatus("authenticating");

      try {
        const challengeResponse = await fetch(`${apiBaseUrl}/auth/challenge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: address })
        });
        const challenge = (await challengeResponse.json()) as { message: string };
        const signature = await signMessageAsync({ message: challenge.message });

        const verifyResponse = await fetch(`${apiBaseUrl}/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: challenge.message,
            signature
          })
        });
        const verifyPayload = (await verifyResponse.json()) as { token?: string; error?: string };

        if (!verifyResponse.ok || !verifyPayload.token) {
          throw new Error(verifyPayload.error ?? "Unable to establish SentinelPay session.");
        }

        setSessionToken(verifyPayload.token);
        setStatus("checking");
        await checkNexaIDStatus(address);
      } catch (error) {
        hasStarted.current = false;
        setStatus("idle");
        toast.error(toWalletToastMessage(error));
      }
    };

    void authenticateAndCheck();
  }, [address, isConnected, signMessageAsync]);

  async function checkNexaIDStatus(walletAddress: string) {
    const response = await fetch(`${apiBaseUrl}/zk/status/${walletAddress}`);
    const payload = (await response.json()) as { verified: boolean };

    if (payload.verified) {
      setStatus("verified");
      toast.success("NexaID is already linked. Redirecting to dashboard.");
      router.push("/dashboard");
      return;
    }

    setStatus("needs-verification");
    setModalOpen(true);
  }

  async function handleVerify() {
    if (!address) {
      return;
    }

    setVerifying(true);

    try {
      const response = await fetch(`${apiBaseUrl}/zk/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address })
      });
      const payload = (await response.json()) as { verified: boolean };

      if (!response.ok || !payload.verified) {
        throw new Error("Mock ZK verification failed.");
      }

      toast.success("NexaID verified with a privacy-preserving proof.");
      setModalOpen(false);
      router.push("/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify NexaID right now.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <Card className="space-y-6 border-cyan-400/20 bg-slate-950/70">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">HashKey Chain Testnet Login</div>
          <h2 className="font-display text-3xl text-white">Connect once. Prove privately. Pay intelligently.</h2>
          <p className="max-w-xl text-sm leading-6 text-slate-300">
            The login flow uses Wagmi for wallet access and SIWE on the backend to protect the AI endpoints. If your
            wallet is not yet linked to NexaID, we guide you into a clean ZK verification modal.
          </p>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <Button onClick={handleConnect} className="min-w-52" disabled={isPending}>
            {isPending ? "Connecting..." : "Connect Wallet"}
          </Button>
          <Button variant="secondary" onClick={() => address && checkNexaIDStatus(address)} disabled={!address}>
            Re-check NexaID
          </Button>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          Status:{" "}
          <span className="font-medium text-white">
            {status === "idle" && "Waiting for wallet connection"}
            {status === "authenticating" && "Signing SIWE challenge"}
            {status === "checking" && "Checking NexaID status"}
            {status === "verified" && "Verified and ready"}
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
