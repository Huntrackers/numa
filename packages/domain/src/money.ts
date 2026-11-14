export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  code: string,
  message: string,
  status = 422,
): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
export function amount(v: unknown): bigint {
  ensure(
    typeof v === 'string' && /^(0|[1-9][0-9]{0,59})$/.test(v),
    'INVALID_AMOUNT',
    'Use a non-negative integer amount in the smallest unit.',
  );
  return BigInt(v);
}
export const add = (...values: string[]) => values.reduce((s, v) => s + amount(v), 0n).toString();
export function subtract(a: string, b: string) {
  ensure(amount(a) >= amount(b), 'INSUFFICIENT_FUNDS', 'The available balance is too low.');
  return (amount(a) - amount(b)).toString();
}
export function mulBps(value: string, bps: number) {
  ensure(
    Number.isSafeInteger(bps) && bps >= 0 && bps <= 10000,
    'INVALID_PERCENT',
    'Percentage is out of range.',
  );
  return ((amount(value) * BigInt(bps)) / 10000n).toString();
}
