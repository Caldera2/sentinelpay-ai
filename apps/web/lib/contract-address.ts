import { ZeroAddress, getAddress, isAddress } from "ethers";

export function getChecksummedAddress(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !isAddress(trimmed)) {
    return null;
  }

  const checksummed = getAddress(trimmed);
  return checksummed === ZeroAddress ? null : checksummed;
}

export function isConfiguredContractAddress(value: string | null | undefined) {
  return getChecksummedAddress(value) !== null;
}
