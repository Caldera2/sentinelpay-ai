"use client";

import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import type { Chain, EIP1193Provider } from "viem";

type ProviderRequestError = Error & {
  code?: number;
};

type ChainSwitchProvider = {
  request: (...args: any[]) => Promise<unknown>;
};

type InjectedWindow = Window & {
  ethereum?: EIP1193Provider & {
    isMetaMask?: true;
    providers?: Array<EIP1193Provider & { isMetaMask?: true }>;
  };
};

export const hashKey: Chain = {
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: {
    name: "HSK",
    symbol: "HSK",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ["https://133.rpc.thirdweb.com"]
    },
    public: {
      http: ["https://133.rpc.thirdweb.com"]
    }
  },
  blockExplorers: {
    default: {
      name: "HashKey Explorer",
      url: "https://hashkey.blockscout.com"
    }
  },
  testnet: true
};

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

export async function ensureHashKeyChain(provider: ChainSwitchProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHexChainId(hashKey.id) }]
    });
  } catch (error) {
    const requestError = error as ProviderRequestError;
    const message = requestError.message?.toLowerCase() ?? "";
    const shouldAddChain = requestError.code === 4902 || message.includes("unrecognized chain id");

    if (!shouldAddChain) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: toHexChainId(hashKey.id),
          chainName: hashKey.name,
          nativeCurrency: hashKey.nativeCurrency,
          rpcUrls: hashKey.rpcUrls.default.http,
          blockExplorerUrls: [hashKey.blockExplorers?.default.url].filter(Boolean)
        }
      ]
    });
  }
}

export const wagmiConfig = createConfig({
  chains: [hashKey],
  multiInjectedProviderDiscovery: false,
  connectors: [
    injected({
      shimDisconnect: true,
      target: {
        id: "metaMask",
        name: "MetaMask",
        provider: (window) => {
          const injectedWindow = window as InjectedWindow | undefined;
          const ethereum = injectedWindow?.ethereum;

          if (!ethereum) {
            return undefined;
          }

          if (ethereum.providers?.length) {
            return ethereum.providers.find((provider) => provider.isMetaMask) ?? ethereum.providers[0];
          }

          return ethereum.isMetaMask ? ethereum : ethereum;
        }
      }
    })
  ],
  transports: {
    [hashKey.id]: http(hashKey.rpcUrls.default.http[0])
  }
});
