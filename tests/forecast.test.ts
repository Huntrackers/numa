import { describe, it, expect } from 'vitest';
import { companyForecast, employeeForecast, futureDates } from '../packages/domain/src/forecast.js';
const employee = {
  id: 'e',
  name: 'Person',
  status: 'ACTIVE',
  cadence: 'monthly',
  salary: '10000',
  anchor: '2026-01-31T10:00:00.000Z',
  roleId: 'r',
};
describe('multi-period decision forecasts', () => {
  it('compares monthly periods and separates signed funding from continuation', () => {
    const f = companyForecast({
      employees: [employee],
      obligations: [{ state: 'RESERVED', amount: '10000', dueAt: '2026-02-28T10:00:00.000Z' }],
      free: '5000',
      timezone: 'UTC',
      from: '2026-02-01T00:00:00.000Z',
      horizonDays: 90,
      change: {
        selection: 'role',
        roleId: 'r',
        kind: 'percent',
        delta: '1000',
        direction: 'increase',
        effectiveFrom: '2026-02-02T00:00:00.000Z',
      },
    });
    expect(f.periods.map((p) => p.proposed)).toEqual(['11000', '11000', '11000']);
    expect(f.signedAmount).toBe('10000');
    expect(f.shortfall).toBe('18000');
    expect(f.affectedPaydays).toBe(3);
  });
  it('does not change the input agreement or create a mandate', () => {
    const input = structuredClone(employee);
    companyForecast({
      employees: [input],
      free: '0',
      timezone: 'UTC',
      from: '2026-02-01T00:00:00.000Z',
      horizonDays: 60,
    });
    expect(input).toEqual(employee);
  });
  it('forecasts a 600 goal funded by 200 per salary at the third receipt', () => {
    const g = {
      id: 'g',
      name: 'Reserve',
      target: '60000',
      funded: '0',
      priority: 1,
      state: 'ACTIVE',
    };
    const f = employeeForecast({
      employee: { ...employee, salary: '100000' },
      policy: {
        cashFloor: '0',
        legs: [
          { id: 'cash', type: 'cash', bps: 8000 },
          { id: 'goals', type: 'goals', bps: 2000 },
        ],
      },
      goals: [g],
      timezone: 'UTC',
      from: '2026-02-01T00:00:00.000Z',
      horizonDays: 90,
    });
    expect(f.goals[0].completion?.paydays).toBe(3);
    expect(f.goals[0].funded).toBe('60000');
    expect(g.funded).toBe('0');
  });
  it('skips unaffordable DCA before income arrives and includes fees', () => {
    const f = employeeForecast({
      employee: {
        ...employee,
        salary: '10000',
        cadence: 'daily',
        anchor: '2026-02-03T12:00:00.000Z',
      },
      policy: {
        cashFloor: '0',
        legs: [
          { id: 'cash', type: 'cash', bps: 5000 },
          { id: 'dca', type: 'dca', bps: 5000 },
        ],
      },
      goals: [],
      dca: [
        {
          id: 'd',
          name: 'DCA',
          state: 'ACTIVE',
          cadence: 'daily',
          anchor: '2026-02-02T15:00:00.000Z',
          amount: '5000',
          maxFeeBps: 25,
        },
      ],
      timezone: 'UTC',
      from: '2026-02-01T00:00:00.000Z',
      horizonDays: 4,
    });
    expect(f.dca[0].skippedOccurrences).toBe(2);
    expect(f.dca[0].fundedOccurrences).toBe(1);
    expect(f.remainingDcaBudget).toBe('4988');
  });
  it('supports a full year of daily salaries without a 32-payment truncation', () => {
    expect(
      futureDates(
        'daily',
        '2026-01-01T12:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        '2026-12-31T23:59:00.000Z',
        'UTC',
      ),
    ).toHaveLength(365);
  });
});
