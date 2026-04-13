"use client";

import { PropsWithChildren, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import { SentinelDeploymentProvider } from "../hooks/use-sentinel-deployment";
import { wagmiConfig } from "../lib/wagmi";

export function Providers({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SentinelDeploymentProvider>
          {children}
          <Toaster
            position="top-right"
            richColors
            toastOptions={{
              className: "rounded-2xl border border-white/10 bg-slate-950 text-white"
            }}
          />
        </SentinelDeploymentProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
