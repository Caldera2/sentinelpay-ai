"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { EIP1193Provider } from "viem";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { backendSetupMessage, fetchApiJson, isApiConfigured, setSessionToken } from "../lib/api";
import { ensureHashKeyChain, hashKey } from "../lib/wagmi";
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

  if (normalized.includes("connector already connected") || normalized.includes("already connected")) {
    return "Wallet already connected.";
  }

  if (normalized.includes("failed to connect to metamask")) {
    return "MetaMask couldn't connect. Unlock the extension, approve access, and try again.";
  }

  if (normalized.includes("user rejected") || normalized.includes("4001")) {
    return "User rejected the wallet request.";
  }

  return message;
}

function isAlreadyConnectedError(error: unknown) {
  return getWalletErrorMessage(error).toLowerCase().includes("already connected");
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
      const normalized = message.toLowerCase();

      if (normalized.includes("connector already connected") || normalized.includes("already connected")) {
        event.preventDefault();
        return;
      }

      if (!normalized.includes("failed to connect to metamask")) {
        return;
      }

      event.preventDefault();
      toast.error("MetaMask couldn't connect. Unlock the extension, approve access, and try again.");
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = getWalletErrorMessage(event.reason);
      const normalized = message.toLowerCase();

      if (normalized.includes("connector already connected") || normalized.includes("already connected")) {
        event.preventDefault();
        return;
      }

      if (!normalized.includes("failed to connect to metamask")) {
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
    if (!isApiConfigured) {
      toast.error(backendSetupMessage);
      return;
    }

    if (isConnected) {
      if (address) {
        void checkNexaIDStatus(address).catch((error) => {
          toast.error(toWalletToastMessage(error));
        });
      }

      return;
    }

    try {
      const connector = connectors.find((item) => item.name === "MetaMask") ?? connectors[0];

      if (!connector) {
        throw new Error("No wallet connector is available.");
      }

      if (typeof connector.isAuthorized === "function" && (await connector.isAuthorized())) {
        return;
      }

      const ethereum = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
      if (ethereum) {
        await ensureHashKeyChain(ethereum);
      }

      await connectAsync({
        connector,
        chainId: hashKey.id
      });
    } catch (error) {
      if (isAlreadyConnectedError(error)) {
        return;
      }

      toast.error(toWalletToastMessage(error));
    }
  }

  useEffect(() => {
    if (!isApiConfigured || !isConnected || !address || hasStarted.current) {
      return;
    }

    hasStarted.current = true;

    const authenticateAndCheck = async () => {
      setStatus("authenticating");

      try {
        const challenge = await fetchApiJson<{ message: string }>("/auth/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: address })
        });
        const signature = await signMessageAsync({ message: challenge.message });

        const verifyPayload = await fetchApiJson<{ token?: string; error?: string }>("/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: challenge.message,
            signature
          })
        });

        if (!verifyPayload.token) {
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
    const payload = await fetchApiJson<{ verified: boolean }>(`/zk/status/${walletAddress}`);

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
      const payload = await fetchApiJson<{ verified: boolean }>("/zk/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address })
      });

      if (!payload.verified) {
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
          <Button onClick={handleConnect} className="min-w-52" disabled={isPending || !isApiConfigured}>
            {!isApiConfigured ? "Backend Setup Required" : isPending ? "Connecting..." : "Connect Wallet"}
          </Button>
          <Button variant="secondary" onClick={() => address && checkNexaIDStatus(address)} disabled={!address || !isApiConfigured}>
            Re-check NexaID
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
