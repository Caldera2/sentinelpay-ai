"use client";

import { PropsWithChildren, useEffect, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter
} from "@solana/wallet-adapter-wallets";
import { SentinelConnection } from "../../lib/solana/connection";

export function SolanaProvider({ children }: PropsWithChildren) {
  const sentinelConnection = SentinelConnection.getInstance();
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function checkRpcAuthorization() {
      try {
        await sentinelConnection.getLatestBlockhash("confirmed");
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[SentinelPay] Solana RPC health probe failed: ${message}`);
        }
      }
    }

    void checkRpcAuthorization();

    return () => {
      cancelled = true;
    };
  }, [sentinelConnection]);

  return (
    <ConnectionProvider endpoint={sentinelConnection.endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
