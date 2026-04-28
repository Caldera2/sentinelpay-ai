"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getOptionalPublicKey,
  getSolanaMerchantAddress,
  getSolanaRwaMintAddress,
  getSolanaUsdcMintAddress
} from "../lib/solana/config";
import { solanaConnection } from "../lib/solana/connection";

type OnChainBalanceSnapshot = {
  merchantAddress: string;
  usdcAta: string | null;
  rwaAta: string | null;
  availableUsdc: number;
  vaultBalance: number;
  totalVolume: number;
  updatedAt: string;
};

type TokenAccountBalance = Awaited<ReturnType<Connection["getTokenAccountBalance"]>>;

function toUiAmount(value?: TokenAccountBalance | null) {
  return value?.value.uiAmount ?? 0;
}

export function useOnChainBalance() {
  const queryClient = useQueryClient();
  const merchantAddress = getSolanaMerchantAddress();
  const usdcMintAddress = getSolanaUsdcMintAddress();
  const rwaMintAddress = getSolanaRwaMintAddress();

  const connection = useMemo(() => solanaConnection, []);

  const merchantPublicKey = useMemo(
    () => getOptionalPublicKey(merchantAddress),
    [merchantAddress]
  );
  const usdcMint = useMemo(() => getOptionalPublicKey(usdcMintAddress), [usdcMintAddress]);
  const rwaMint = useMemo(() => getOptionalPublicKey(rwaMintAddress), [rwaMintAddress]);

  const accountKeys = useMemo(() => {
    if (!merchantPublicKey || !usdcMint) {
      return { usdcAta: null, rwaAta: null };
    }

    const usdcAta = getAssociatedTokenAddressSync(usdcMint, merchantPublicKey);
    const rwaAta = rwaMint ? getAssociatedTokenAddressSync(rwaMint, merchantPublicKey) : null;

    return {
      usdcAta,
      rwaAta
    };
  }, [merchantPublicKey, rwaMint, usdcMint]);

  const query = useQuery({
    queryKey: ["on-chain-balance", merchantAddress, usdcMintAddress, rwaMintAddress],
    refetchInterval: 10_000,
    enabled: Boolean(merchantPublicKey && usdcMint),
    queryFn: async (): Promise<OnChainBalanceSnapshot> => {
      if (!merchantPublicKey || !usdcMint || !accountKeys.usdcAta) {
        return {
          merchantAddress,
          usdcAta: null,
          rwaAta: null,
          availableUsdc: 0,
          vaultBalance: 0,
          totalVolume: 0,
          updatedAt: new Date().toISOString()
        };
      }

      const [usdcBalance, rwaBalance] = await Promise.all([
        connection
          .getTokenAccountBalance(accountKeys.usdcAta)
          .then((value) => toUiAmount(value))
          .catch(() => 0),
        accountKeys.rwaAta
          ? connection
              .getTokenAccountBalance(accountKeys.rwaAta)
              .then((value) => toUiAmount(value))
              .catch(() => 0)
          : Promise.resolve(0)
      ]);

      return {
        merchantAddress: merchantPublicKey.toBase58(),
        usdcAta: accountKeys.usdcAta.toBase58(),
        rwaAta: accountKeys.rwaAta?.toBase58() ?? null,
        availableUsdc: usdcBalance,
        vaultBalance: rwaBalance,
        totalVolume: usdcBalance + rwaBalance,
        updatedAt: new Date().toISOString()
      };
    }
  });

  useEffect(() => {
    if (!accountKeys.usdcAta) {
      return;
    }

    const subscriptions: number[] = [];
    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: ["on-chain-balance", merchantAddress, usdcMintAddress, rwaMintAddress]
      });
    };

    subscriptions.push(connection.onAccountChange(accountKeys.usdcAta, invalidate, "confirmed"));

    if (accountKeys.rwaAta) {
      subscriptions.push(connection.onAccountChange(accountKeys.rwaAta, invalidate, "confirmed"));
    }

    return () => {
      subscriptions.forEach((id) => {
        void connection.removeAccountChangeListener(id);
      });
    };
  }, [accountKeys.rwaAta, accountKeys.usdcAta, connection, merchantAddress, queryClient, rwaMintAddress, usdcMintAddress]);

  return {
    ...query,
    data:
      query.data ??
      ({
        merchantAddress,
        usdcAta: null,
        rwaAta: null,
        availableUsdc: 0,
        vaultBalance: 0,
        totalVolume: 0,
        updatedAt: new Date().toISOString()
      } satisfies OnChainBalanceSnapshot)
  };
}
