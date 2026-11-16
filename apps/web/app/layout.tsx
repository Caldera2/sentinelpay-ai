import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "../components/providers";
import { SolanaProvider } from "../components/providers/SolanaProvider";

export const metadata: Metadata = {
  title: "SentinelPay",
  description:
    "Solana USDC invoices, verified payment receipts, and merchant cash reserve planning.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <SolanaProvider>
          <Providers>{children}</Providers>
        </SolanaProvider>
      </body>
    </html>
  );
}
