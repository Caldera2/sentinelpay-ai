"use client";

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, parseEther, type Eip1193Provider } from "ethers";
import { BrainCircuit, ShieldCheck, Sparkles, Wallet2 } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useSwitchChain } from "wagmi";
import type { PaymentIntent } from "@sentinelpay/shared";
import { sentinelPayAbi } from "@sentinelpay/shared";
import { apiBaseUrl, contractAddress, getSessionToken, merchantWallet } from "../lib/api";
import { hashKeyTestnet } from "../lib/wagmi";
import { Badge, Button, Card, Switch } from "./ui";

const defaultIntent: PaymentIntent = {
  walletAddress: "0x0000000000000000000000000000000000000000",
  recommendedAsset: "HSK",
  shouldUseZkDiscount: true,
  discountBps: 500,
  reason: "AI prefers HSK for this demo because it keeps higher-growth assets and RWAs untouched while matching the settlement rail.",
  loyaltyMessage: "RWA holders earn loyalty points when they settle with HSK.",
  track: "PayFi"
};

function humanizeTxError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("user rejected") || message.includes("rejected") || message.includes("4001")) {
    return "User rejected the wallet request.";
  }

  if (message.includes("insufficient") || message.includes("funds")) {
    return "Insufficient HSK to cover the payment and gas.";
  }

  return "Payment could not be completed right now.";
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function UserCheckout() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [intent, setIntent] = useState<PaymentIntent>(defaultIntent);
  const [showAiReason, setShowAiReason] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = getSessionToken();

    if (!address || !token) {
      return;
    }

    fetch(`${apiBaseUrl}/ai/intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ walletAddress: address })
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as PaymentIntent;
        setIntent(payload);
      })
      .catch(() => undefined);
  }, [address]);

  async function handlePay() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before starting checkout.");
      return;
    }

    const toastId = toast.loading("Preparing SentinelPay transaction...");
    setSubmitting(true);

    try {
      if (chainId !== hashKeyTestnet.id) {
        await switchChainAsync({ chainId: hashKeyTestnet.id });
      }

      const ethereum = (window as Window & { ethereum?: unknown }).ethereum;
      if (!ethereum) {
        throw new Error("Wallet provider unavailable.");
      }

      const provider = new BrowserProvider(ethereum as Eip1193Provider);
      const signer = await provider.getSigner();

      const verifyResponse = await fetch(`${apiBaseUrl}/zk/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ walletAddress: address })
      });
      const verifyPayload = (await verifyResponse.json()) as { proofHash?: string };

      if (!verifyPayload.proofHash) {
        throw new Error("Missing NexaID proof hash.");
      }

      const contract = new Contract(contractAddress, sentinelPayAbi, signer);
      const amount = intent.shouldUseZkDiscount ? 0.095 : 0.1;

      const tx = await contract.processPayment(merchantWallet, verifyPayload.proofHash, intent.track, {
        value: parseEther(amount.toString())
      });

      toast.loading("Settlement submitted. Waiting for HashKey confirmation...", { id: toastId });
      const receipt = await tx.wait();
      toast.success("Payment settled successfully.", {
        id: toastId,
        description: `HashKey tx ${tx.hash.slice(0, 12)}... confirmed`
      });
    } catch (error) {
      toast.error(humanizeTxError(error), { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="space-y-6 border-cyan-400/20">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">User Checkout</div>
          <h3 className="font-display text-3xl text-white">Stripe-grade PayFi checkout</h3>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            HSK is the primary settlement token. The AI layer picks the best asset story, then the on-chain settlement
            engine routes part of the payment into an RWA vault for the hackathon demo.
          </p>
        </div>
        <Badge className="gap-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          Verified by NexaID
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-400">Spend asset</div>
              <div className="mt-1 text-4xl font-semibold text-white">{intent.recommendedAsset}</div>
            </div>
            <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-200">Discount</div>
              <div className="text-2xl font-semibold text-white">{intent.discountBps / 100}%</div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BrainCircuit className="h-5 w-5 text-cyan-300" />
                <div>
                  <div className="font-medium text-white">Powered by AI</div>
                  <div className="text-sm text-slate-400">Explain the token choice before the user pays.</div>
                </div>
              </div>
              <Switch checked={showAiReason} onCheckedChange={setShowAiReason} />
            </div>

            {showAiReason ? (
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                <p>{intent.reason}</p>
                {intent.loyaltyMessage ? <p className="text-cyan-200">{intent.loyaltyMessage}</p> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-gradient-to-br from-cyan-400/15 via-slate-900 to-slate-950 p-5">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-slate-300">
              <Wallet2 className="h-5 w-5 text-cyan-300" />
              HashKey Chain Testnet
            </div>
            <div>
              <div className="text-sm text-slate-400">Merchant</div>
              <div className="mt-1 font-mono text-sm text-white">{shortenAddress(merchantWallet)}</div>
            </div>
            <div>
              <div className="text-sm text-slate-400">Amount due</div>
              <div className="mt-1 text-3xl font-semibold text-white">
                {intent.shouldUseZkDiscount ? "0.095 HSK" : "0.10 HSK"}
              </div>
            </div>
            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                ZK discount {intent.shouldUseZkDiscount ? "active" : "not active"}
              </div>
            </div>
            <Button className="w-full" onClick={handlePay} disabled={submitting || contractAddress.startsWith("0x0000")}>
              {submitting ? "Processing..." : "Pay with HSK"}
            </Button>
            {contractAddress.startsWith("0x0000") ? (
              <p className="text-xs text-amber-200">Set `NEXT_PUBLIC_CONTRACT_ADDRESS` after deployment to enable checkout.</p>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
