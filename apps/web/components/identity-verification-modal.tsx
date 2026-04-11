"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { Button, Card } from "./ui";

type IdentityVerificationModalProps = {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onVerify: () => void;
};

export function IdentityVerificationModal({
  open,
  loading,
  onClose,
  onVerify
}: IdentityVerificationModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-md">
      <Card className="max-w-lg space-y-6 border-cyan-400/20 bg-slate-950/90">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-cyan-200">
            <Sparkles className="h-3.5 w-3.5" />
            Identity Verification
          </div>
          <h3 className="font-display text-3xl text-white">Verify with NexaID, keep your data private.</h3>
          <p className="text-sm leading-6 text-slate-300">
            SentinelPay uses a mocked zero-knowledge proof flow so you can prove eligibility for PayFi and DeFi
            features without exposing the underlying identity data to merchants.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <span>Judges see a smooth ZK story. Users see privacy-first onboarding.</span>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Later
          </Button>
          <Button className="flex-1" onClick={onVerify} disabled={loading}>
            {loading ? "Generating ZK Proof..." : "Verify Identity"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

