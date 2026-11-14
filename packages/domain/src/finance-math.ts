import { amount, ensure } from './money.js';
export function loanInterest(principal: string, aprBps: number, days: number) {
  ensure(Number.isSafeInteger(days) && days >= 0, 'INVALID_DAYS', 'Invalid accrual period.');
  ensure(Number.isSafeInteger(aprBps) && aprBps >= 0, 'INVALID_RATE', 'Invalid scenario rate.');
  return ((amount(principal) * BigInt(aprBps) * BigInt(days)) / 3650000n).toString();
}
export function loanRisk(collateral: string, debt: string, thresholdBps = 7500) {
  const c = amount(collateral),
    d = amount(debt);
  ensure(
    c > 0n || d === 0n,
    'INVALID_COLLATERAL',
    'A positive collateral value is required for outstanding debt.',
  );
  return {
    ltvBps: c === 0n ? 0 : Number((d * 10000n) / c),
    healthFactor:
      d === 0n ? null : Number((c * BigInt(thresholdBps) * 1000n) / (10000n * d)) / 1000,
  };
}
