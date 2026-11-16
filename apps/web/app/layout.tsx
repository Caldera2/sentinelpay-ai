import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "../styles/wallet-adapter.css";
import { Providers } from "../components/providers";
import { SolanaProvider } from "../components/providers/SolanaProvider";

export const metadata: Metadata = {
  title: "SentinelPay",
  description:
    "Solana USDC invoices, verified payment receipts, and merchant cash reserve planning.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="bg-background text-foreground antialiased">
        <SolanaProvider>
          <Providers>{children}</Providers>
        </SolanaProvider>
      </body>
    </html>
  );
}
