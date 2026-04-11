export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000";
export const merchantWallet =
  process.env.NEXT_PUBLIC_MERCHANT_WALLET ?? "0x25f771D0B086602FEc043B6cCa1eD3E5fDcd8F1d";

export function getSessionToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("sentinelpay.jwt");
}

export function setSessionToken(token: string) {
  window.localStorage.setItem("sentinelpay.jwt", token);
}
