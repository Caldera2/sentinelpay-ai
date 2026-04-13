"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type PropsWithChildren } from "react";
import { backendSetupMessage, contractAddress as rawContractAddress } from "../lib/api";
import { getChecksummedAddress } from "../lib/contract-address";

type SentinelDeploymentState = {
  address: string | null;
  isReady: boolean;
  message: string;
};

const setupMessage = "Please deploy your contract and update the .env file to enable payments on HashKey Testnet.";

const SentinelDeploymentContext = createContext<SentinelDeploymentState>({
  address: null,
  isReady: false,
  message: setupMessage
});

export function SentinelDeploymentProvider({ children }: PropsWithChildren) {
  const state = useMemo<SentinelDeploymentState>(() => {
    const address = getChecksummedAddress(rawContractAddress);

    return {
      address,
      isReady: Boolean(address),
      message: setupMessage
    };
  }, []);

  const warnedRef = useRef(false);
  const activatedRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    if (!state.isReady && !warnedRef.current) {
      console.warn(
        "[SentinelPay] NEXT_PUBLIC_CONTRACT_ADDRESS is not configured. Update apps/web/.env.local and the root .env after deployment."
      );
      console.warn(`[SentinelPay] Backend reminder: ${backendSetupMessage}`);
      warnedRef.current = true;
    }
  }, [state.isReady]);

  useEffect(() => {
    if (!state.isReady || !state.address || activatedRef.current) {
      return;
    }

    console.log("SentinelPay Active at:", state.address);
    activatedRef.current = true;
  }, [state.address, state.isReady]);

  return <SentinelDeploymentContext.Provider value={state}>{children}</SentinelDeploymentContext.Provider>;
}

export function useSentinelDeployment() {
  return useContext(SentinelDeploymentContext);
}
