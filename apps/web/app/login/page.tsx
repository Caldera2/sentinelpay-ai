import Link from "next/link";
import { ConnectWalletFlow } from "../../components/connect-wallet-flow";

export default function LoginPage() {
  return (
    <main className="grid-shell min-h-screen px-6 py-8 md:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="font-display text-lg text-white">
            SentinelPay AI
          </Link>
          <Link href="/dashboard" className="text-sm text-cyan-200">
            Open treasury dashboard
          </Link>
        </div>
        <ConnectWalletFlow />
      </div>
    </main>
  );
}

