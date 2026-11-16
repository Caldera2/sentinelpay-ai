export const USDC_DECIMALS = 6;
export const MAX_PAYMENT_ATOMIC = 1_000_000_000_000n;

export function parseUsdc(value: string, allowZero = false): bigint {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(value)
  )
    throw new Error("Use a USDC amount with at most six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (atomic > MAX_PAYMENT_ATOMIC || (allowZero ? atomic < 0n : atomic <= 0n))
    throw new Error(
      "Amount must be positive and no greater than 1,000,000 USDC.",
    );
  return atomic;
}

export function parseAtomic(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value))
    throw new Error("Invalid atomic amount.");
  return BigInt(value);
}

export function formatUsdc(value: string | bigint): string {
  const amount = typeof value === "bigint" ? value : parseAtomic(value);
  return `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0")}`;
}

/** Base58 serialization preserves leading zero bytes and case. */
export function encodeBase58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = "";
  while (number > 0n) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "1".repeat(zeros) + encoded;
}
