import { getAddress } from "ethers";

export type WalletAsset = {
  symbol: string;
  balance: number;
  apy: number;
  usdValue: number;
  isRwa?: boolean;
};

export type WalletSnapshot = {
  walletAddress: string;
  hasNexaId: boolean;
  assets: WalletAsset[];
  loyaltyPointsEligible?: boolean;
};

export type PaymentIntent = {
  walletAddress: string;
  recommendedAsset: string;
  shouldUseZkDiscount: boolean;
  discountBps: number;
  reason: string;
  loyaltyMessage?: string;
  track: "PayFi" | "DeFi";
};

const scoreAsset = (asset: WalletAsset) => {
  const rwaBonus = asset.isRwa ? 80 : 0;
  const utilityBonus = asset.symbol === "HSK" ? 15 : 0;
  return asset.apy * 100 + rwaBonus + utilityBonus;
};

export function suggestPaymentStrategy(walletData: WalletSnapshot): PaymentIntent {
  const normalizedAddress = getAddress(walletData.walletAddress);
  const ownsRwa = walletData.assets.some((asset) => asset.isRwa && asset.balance > 0);
  const spendableAssets = walletData.assets.filter((asset) => asset.balance > 0);
  const lowestGrowthAsset = [...spendableAssets].sort((left, right) => scoreAsset(left) - scoreAsset(right))[0];

  let recommendedAsset = lowestGrowthAsset?.symbol ?? "HSK";
  let reason = `AI selected ${recommendedAsset} because it has the lowest near-term growth score in the wallet snapshot.`;
  let loyaltyMessage: string | undefined;
  let track: "PayFi" | "DeFi" = "PayFi";

  if (ownsRwa) {
    recommendedAsset = "HSK";
    loyaltyMessage = "RWA holder detected. Paying in HSK earns SentinelPay loyalty points and keeps yield-bearing RWAs untouched.";
    reason = "AI switched the payment rail to HSK because the wallet already holds RWAs, making HSK the best spend asset for points and gas efficiency.";
  } else if ((lowestGrowthAsset?.apy ?? 0) > 0.09) {
    track = "DeFi";
    reason = "AI marked this as a DeFi-leaning checkout because all visible assets carry meaningful yield, so it preserves higher-growth positions.";
  }

  return {
    walletAddress: normalizedAddress,
    recommendedAsset,
    shouldUseZkDiscount: walletData.hasNexaId,
    discountBps: walletData.hasNexaId ? 500 : 0,
    reason,
    loyaltyMessage,
    track
  };
}

export function buildMockWalletSnapshot(walletAddress: string, hasNexaId: boolean): WalletSnapshot {
  const normalizedAddress = getAddress(walletAddress);
  const suffix = Number.parseInt(normalizedAddress.slice(-2), 16);
  const holdsRwa = suffix % 2 === 0;

  return {
    walletAddress: normalizedAddress,
    hasNexaId,
    loyaltyPointsEligible: holdsRwa,
    assets: [
      {
        symbol: "HSK",
        balance: 128.4,
        apy: holdsRwa ? 0.01 : 0.03,
        usdValue: 128.4
      },
      {
        symbol: "USDT",
        balance: 420,
        apy: 0.018,
        usdValue: 420
      },
      {
        symbol: "sRWA",
        balance: holdsRwa ? 12 : 0,
        apy: 0.112,
        usdValue: holdsRwa ? 1200 : 0,
        isRwa: true
      }
    ]
  };
}

