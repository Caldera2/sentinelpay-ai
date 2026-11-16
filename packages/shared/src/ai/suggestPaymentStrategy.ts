import { parseAtomic } from "../money";

export type TreasuryInputs = {
  availableUsdcAtomic: string;
  reserveAtomic: string;
  upcomingExpensesAtomic: string;
  liquidBps: number;
};

/** Deterministic cash policy, not a forecast or an investment return promise. */
export function suggestPaymentStrategy(input: TreasuryInputs) {
  const balance = parseAtomic(input.availableUsdcAtomic);
  const protectedCash =
    parseAtomic(input.reserveAtomic) +
    parseAtomic(input.upcomingExpensesAtomic);
  if (
    !Number.isInteger(input.liquidBps) ||
    input.liquidBps < 0 ||
    input.liquidBps > 10_000
  )
    throw new Error(
      "Liquid allocation must be between 0 and 10000 basis points.",
    );
  const surplus = balance > protectedCash ? balance - protectedCash : 0n;
  const requested = (balance * BigInt(10_000 - input.liquidBps)) / 10_000n;
  const suggested = requested < surplus ? requested : surplus;
  return {
    engine: "cash-reserve-rules" as const,
    availableUsdcAtomic: balance.toString(),
    protectedCashAtomic: protectedCash.toString(),
    suggestedAllocationAtomic: suggested.toString(),
    remainingLiquidAtomic: (balance - suggested).toString(),
    reason:
      suggested === 0n
        ? "Keep funds liquid: your reserve, upcoming expenses, or allocation policy leaves no eligible surplus."
        : "This amount respects your minimum reserve, upcoming expenses, and maximum yield allocation. Review fees and provider eligibility before approving.",
  };
}
