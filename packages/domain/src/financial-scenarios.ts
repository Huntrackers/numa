import { amount, ensure } from './money.js';
import { loanRisk, loanInterest } from './finance-math.js';
export const EARN_SCENARIOS = {
  BASE: { aprBps: 400, lossBps: 0, liquidity: true, delayHours: 0 },
  LOSS: { aprBps: 0, lossBps: 1500, liquidity: true, delayHours: 0 },
  ILLIQUID: { aprBps: 0, lossBps: 0, liquidity: false, delayHours: 0 },
  DELAYED: { aprBps: 400, lossBps: 0, liquidity: true, delayHours: 24 },
  STALE: { aprBps: 0, lossBps: 0, liquidity: false, delayHours: 0 },
} as const;
export function earnOutcome(
  principal: string,
  scenario: keyof typeof EARN_SCENARIOS,
  days: number,
) {
  const s = EARN_SCENARIOS[scenario];
  ensure(s, 'INVALID_SCENARIO', 'Choose a supported Earn scenario.');
  amount(principal);
  const loss = ((BigInt(principal) * BigInt(s.lossBps)) / 10000n).toString();
  return {
    ...s,
    loss,
    returned: (BigInt(principal) - BigInt(loss)).toString(),
    interest: loanInterest(principal, s.aprBps, days),
    source: 'numa educational scenario v1',
    seed: 'v1-' + scenario,
  };
}
export function loanStress(
  collateral: string,
  debt: string,
  income: string,
  expenses: string,
  repayment: string,
  shockBps = 3000,
  incomeDropBps = 2500,
) {
  ensure(
    [shockBps, incomeDropBps].every((x) => Number.isSafeInteger(x) && x >= 0 && x <= 10000),
    'INVALID_SCENARIO',
    'Scenario percentages must be between zero and 100%.',
  );
  for (const value of [collateral, debt, income, expenses, repayment]) amount(value);
  const stressedCollateral = ((BigInt(collateral) * BigInt(10000 - shockBps)) / 10000n).toString(),
    stressedIncome = (BigInt(income) * BigInt(10000 - incomeDropBps)) / 10000n;
  return {
    ...loanRisk(stressedCollateral, debt),
    stressedCollateral,
    stressedIncome: stressedIncome.toString(),
    monthlyRoom: (stressedIncome - BigInt(expenses) - BigInt(repayment)).toString(),
    shockBps,
    incomeDropBps,
    source: 'numa educational model v1; not a Rhea health factor',
  };
}
