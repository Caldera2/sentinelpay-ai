// Public address derived from the historical keypair committed to this repository.
// Application-level retirement is separate from reviewing its on-chain authority.
export const EXPOSED_SIGNING_ADDRESSES = [
  "9pkPja8kDWGWyCNE7PWhwUbe1hgwyEpFQLgohLzMXoAH",
] as const;
export const isCompromisedWallet = (address: string) =>
  EXPOSED_SIGNING_ADDRESSES.some((known) => known === address);
