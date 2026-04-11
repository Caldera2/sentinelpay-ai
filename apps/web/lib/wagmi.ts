"use client";

import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import type { Chain, EIP1193Provider } from "viem";

type InjectedWindow = Window & {
  ethereum?: EIP1193Provider & {
    isMetaMask?: true;
    providers?: Array<EIP1193Provider & { isMetaMask?: true }>;
  };
};

export const hashKeyTestnet: Chain = {
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

export const wagmiConfig = createConfig({
  chains: [hashKeyTestnet],
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
    [hashKeyTestnet.id]: http(hashKeyTestnet.rpcUrls.default.http[0])
  }
});
