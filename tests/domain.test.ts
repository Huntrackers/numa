import { describe, it, expect } from 'vitest';
import {
  amount,
  allocate,
  nextDue,
  obligationId,
  hash,
  changeSalary,
  earlyPay,
  loanInterest,
  loanRisk,
  parseCsv,
  csvCell,
} from '../packages/domain/src/index.js';
describe('exact money and scheduling', () => {
  it('rejects floats, signs, overflow-length inputs and leading zero aliases', () => {
    for (const v of [3, '1.2', '-1', '01', '1'.repeat(61)]) expect(() => amount(v)).toThrow();
  });
  it('keeps exact values above JavaScript number precision', () =>
    expect(amount('900719925474099312345678901')).toBe(900719925474099312345678901n));
  it('canonicalizes object keys and preserves unambiguous obligation identity', () => {
    expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
    expect(obligationId('ab', 'c', 'd', 'e')).not.toBe(obligationId('a', 'bc', 'd', 'e'));
  });
  it('rejects a negative salary after a bulk reduction', () =>
    expect(() => changeSalary('100', 'fixed', '101', 'decrease')).toThrow());
  it('calculates a basis-point salary change using integers', () =>
    expect(changeSalary('12345', 'percent', '1000', 'increase')).toBe('13579'));
  it('clamps a monthly day 31 to leap-year February without drifting March', () => {
    expect(nextDue('monthly', '2024-01-31T09:00:00', '2024-02-01T00:00:00', 'UTC')).toBe(
      '2024-02-29T09:00:00.000Z',
    );
    expect(nextDue('monthly', '2024-01-31T09:00:00', '2024-03-01T00:00:00', 'UTC')).toBe(
      '2024-03-31T09:00:00.000Z',
    );
  });
  it('takes the first valid local time after a DST spring gap', () =>
    expect(nextDue('daily', '2026-03-07T02:30:00', '2026-03-08T00:00:00', 'America/New_York')).toBe(
      '2026-03-08T07:00:00.000Z',
    ));
  it('takes the first occurrence of a repeated local time', () =>
    expect(nextDue('daily', '2026-10-31T01:30:00', '2026-11-01T00:00:00', 'America/New_York')).toBe(
      '2026-11-01T05:30:00.000Z',
    ));
  it('preserves a weekly local payment time across DST', () =>
    expect(
      nextDue('weekly', '2026-03-01T09:00:00', '2026-03-07T00:00:00', 'America/New_York'),
    ).toBe('2026-03-08T13:00:00.000Z'));
});
describe('allocation invariants', () => {
  const legs: any = [
    { id: 'cash', type: 'cash', bps: 3333 },
    { id: 'goals', type: 'goals', bps: 3333 },
    { id: 'dca', type: 'dca', bps: 3334 },
  ];
  it('never creates or loses a cent across varied income amounts', () => {
    for (let n = 1; n < 3000; n += 7) {
      const r = allocate(String(n), legs, '0', [
        { id: 'g', name: 'Goal', target: '100000', funded: '0', state: 'ACTIVE', priority: 1 },
      ]);
      expect(r.shares.reduce((s, l) => s + BigInt(l.amount), 0n)).toBe(BigInt(n));
    }
  });
  it('protects a cash floor by reducing optional shares proportionally', () => {
    const r = allocate('10000', legs, '8000', [
      { id: 'g', name: 'Goal', target: '100000', funded: '0', state: 'ACTIVE', priority: 1 },
    ]);
    expect(BigInt(r.shares[0].amount)).toBeGreaterThanOrEqual(8000n);
    expect(r.shares.reduce((s, l) => s + BigInt(l.amount), 0n)).toBe(10000n);
  });
  it('caps a goal at its target and routes overflow to cash', () => {
    const r = allocate(
      '10000',
      [
        { id: 'c', type: 'cash', bps: 5000 },
        { id: 'g', type: 'goals', bps: 5000 },
      ],
      '0',
      [{ id: 'g', name: 'Goal', target: '100', funded: '90', state: 'ACTIVE', priority: 1 }],
    );
    expect(r.contributions).toEqual([{ goalId: 'g', amount: '10' }]);
    expect(r.shares[0].amount).toBe('9990');
  });
  it('ignores completed, paused and released goals', () => {
    const r = allocate('100', legs, '0', [
      { id: 'g', name: 'Goal', target: '1000', funded: '0', state: 'RELEASED', priority: 1 },
    ]);
    expect(r.contributions).toHaveLength(0);
  });
  it('rejects allocations that do not sum to exactly 10000 bps', () =>
    expect(() => allocate('100', [{ id: 'c', type: 'cash', bps: 9999 }], '0', [])).toThrow());
  it('allocates nothing to optional budgets when salary is below the floor', () => {
    const r = allocate('100', legs, '1000', []);
    expect(r.shares[0].amount).toBe('100');
  });
});
describe('debt, advances and exports', () => {
  it('keeps gross advance, fee and remaining receivable distinct', () =>
    expect(earlyPay('100000', '0', '40000', 100)).toEqual({
      gross: '40000',
      fee: '400',
      net: '39600',
    }));
  it('rejects an advance on unearned or already consumed salary', () =>
    expect(() => earlyPay('10000', '9000', '2000', 100)).toThrow());
  it('computes simple daily interest and a transparent scenario risk ratio', () => {
    expect(loanInterest('100000', 800, 365)).toBe('8000');
    expect(loanRisk('100000', '50000').healthFactor).toBe(1.5);
  });
  it('parses quoted CSV commas, embedded newlines and escaped quotes', () =>
    expect(parseCsv('name,email\r\n"A, B","x""y"\r\n')).toEqual([
      ['name', 'email'],
      ['A, B', 'x"y'],
    ]));
  it('neutralizes spreadsheet formula cells', () =>
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"'));
});
