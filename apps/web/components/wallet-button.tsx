"use client";

import dynamic from "next/dynamic";

// Wallet selection is restored from browser storage and cannot be rendered on the server.
export const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (module) => module.WalletMultiButton,
    ),
  {
    ssr: false,
    loading: () => (
      <button className="wallet-adapter-button" disabled>
        Loading wallet…
      </button>
    ),
  },
);
