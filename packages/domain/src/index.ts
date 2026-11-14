import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';

import { ensure, amount, add, subtract, mulBps } from './money.js';
export * from './money.js';
export { loanInterest, loanRisk } from './finance-math.js';
export function canonical(v: any): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
export const hash = (v: any) => createHash('sha256').update(canonical(v)).digest('hex');
export const obligationId = (
  company: string,
  employee: string,
  schedule: string,
  index: string,
  kind = 'salary',
) => hash({ company, employee, schedule, index, kind });
export type Cadence = 'daily' | 'weekly' | 'monthly';
export type Goal = {
  id: string;
  name: string;
  target: string;
  funded: string;
  priority: number;
  state: string;
  contributionMode?: 'FIXED' | 'PERCENT';
  contributionValue?: string;
  percentBasis?: 'SALARY' | 'GOAL_BUDGET';
  overflow?: 'CASH' | 'NEXT';
  targetDate?: string | null;
};
export function allocateGoals(total: string, budget: string, goals: Goal[]) {
  let available = amount(budget),
    carry = 0n;
  const contributions: { goalId: string; amount: string }[] = [];
  for (const g of [...goals]
    .filter((g) => g.state === 'ACTIVE')
    .sort((a, b) => a.priority - b.priority)) {
    const value = amount(g.contributionValue ?? '10000');
    const requestedBase =
      g.contributionMode === 'FIXED'
        ? value
        : (amount(g.percentBasis === 'SALARY' ? total : budget) * value) / 10000n;
    const requested = requestedBase + carry < available ? requestedBase + carry : available;
    const need = amount(g.target) > amount(g.funded) ? amount(g.target) - amount(g.funded) : 0n;
    const take = requested < need ? requested : need;
    const excess = requested - take;
    available -= requested;
    carry = (g.overflow ?? 'NEXT') === 'NEXT' ? excess : 0n;
    available += carry;
    if (take > 0n) contributions.push({ goalId: g.id, amount: take.toString() });
  }
  const reserved = contributions.reduce((n, g) => n + BigInt(g.amount), 0n);
  return {
    contributions,
    reserved: reserved.toString(),
    cash: (amount(budget) - reserved).toString(),
  };
}
export type Leg = {
  id: string;
  type: 'cash' | 'goals' | 'dca' | 'invest' | 'earn';
  bps: number;
  asset?: string;
  destinationId?: string;
};
export function allocate(total: string, legs: Leg[], cashFloor: string, goals: Goal[]) {
  ensure(
    legs.length > 0 && legs.length <= 10 && legs.filter((l) => l.type === 'cash').length === 1,
    'INVALID_POLICY',
    'Choose exactly one cash destination.',
  );
  ensure(
    new Set(legs.map((l) => l.id)).size === legs.length &&
      legs.every((l) => Number.isInteger(l.bps) && l.bps >= 0) &&
      legs.reduce((s, l) => s + l.bps, 0) === 10000,
    'INVALID_POLICY',
    'Allocation percentages must total 100%.',
  );
  ensure(
    ['goals', 'dca', 'earn'].every((type) => legs.filter((l) => l.type === type).length <= 1),
    'INVALID_POLICY',
    'Use one savings, DCA and Earn budget; investment shares may use multiple assets.',
  );
  const t = amount(total),
    floor = amount(cashFloor) > t ? t : amount(cashFloor);
  let shares = legs.map((l) => ({ ...l, amount: (t * BigInt(l.bps)) / 10000n }));
  const cash = shares.find((l) => l.type === 'cash')!;
  cash.amount += t - shares.reduce((s, l) => s + l.amount, 0n);
  if (cash.amount < floor) {
    const optional = shares.filter((l) => l.type !== 'cash'),
      budget = t - floor;
    const old = optional.reduce((s, l) => s + l.amount, 0n);
    for (const l of optional) l.amount = old === 0n ? 0n : (l.amount * budget) / old;
    cash.amount = t - optional.reduce((s, l) => s + l.amount, 0n);
  }
  const contributions: { goalId: string; amount: string }[] = [];
  for (const l of shares.filter((l) => l.type === 'goals')) {
    const result = allocateGoals(total, l.amount.toString(), goals);
    contributions.push(...result.contributions);
    l.amount = BigInt(result.reserved);
    cash.amount += BigInt(result.cash);
  }
  return {
    shares: shares.map((l) => ({ ...l, amount: l.amount.toString() })),
    contributions,
    total,
  };
}
export function nextDue(cadence: Cadence, anchor: string, after: string, zone: string): string {
  const a = DateTime.fromISO(anchor, { zone });
  const n = DateTime.fromISO(after, { zone });
  ensure(a.isValid && n.isValid, 'INVALID_DATE', 'Choose a valid date and timezone.');
  let candidate: DateTime = a;
  let k = 0;
  if (n >= a) {
    k =
      cadence === 'daily'
        ? Math.max(0, Math.floor(n.diff(a, 'days').days))
        : cadence === 'weekly'
          ? Math.max(0, Math.floor(n.diff(a, 'weeks').weeks))
          : Math.max(0, Math.floor(n.diff(a, 'months').months));
  }
  const calc = (i: number) => {
    const date =
      cadence === 'daily'
        ? a.plus({ days: i })
        : cadence === 'weekly'
          ? a.plus({ weeks: i })
          : a.plus({ months: i }).set({ day: Math.min(a.day, a.plus({ months: i }).daysInMonth!) });
    const target = {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: a.hour,
      minute: a.minute,
      second: a.second,
      millisecond: a.millisecond,
    };
    let result = DateTime.fromObject(target, { zone });
    if (result.hour !== a.hour || result.minute !== a.minute) {
      for (let m = 0; m < 180; m++) {
        const desired = DateTime.fromObject(target, { zone: 'UTC' }).plus({ minutes: m });
        const probe = DateTime.fromObject(
          {
            year: desired.year,
            month: desired.month,
            day: desired.day,
            hour: desired.hour,
            minute: desired.minute,
            second: 0,
            millisecond: 0,
          },
          { zone },
        );
        if (probe.hour === desired.hour && probe.minute === desired.minute) {
          result = probe;
          break;
        }
      }
    }
    return result.getPossibleOffsets().sort((x, y) => x.toMillis() - y.toMillis())[0];
  };
  candidate = calc(k);
  while (candidate <= n) {
    k++;
    candidate = calc(k);
  }
  return candidate.toUTC().toISO()!;
}
export function occurrences(
  cadence: Cadence,
  anchor: string,
  after: string,
  until: string,
  zone: string,
) {
  let cursor = after;
  const out: { index: string; dueAt: string }[] = [];
  for (let i = 0; i < 32; i++) {
    const due = nextDue(cadence, anchor, cursor, zone);
    if (due > until) break;
    out.push({ index: DateTime.fromISO(due).setZone(zone).toFormat('yyyy-MM-dd'), dueAt: due });
    cursor = due;
  }
  return out;
}
export function changeSalary(
  value: string,
  kind: 'percent' | 'fixed',
  delta: string,
  direction: 'increase' | 'decrease',
) {
  const base = amount(value);
  const diff = kind === 'percent' ? (base * amount(delta)) / 10000n : amount(delta);
  ensure(
    direction === 'increase' || base >= diff,
    'NEGATIVE_SALARY',
    'This change would make a salary negative.',
  );
  return (direction === 'increase' ? base + diff : base - diff).toString();
}
export function earlyPay(earned: string, used: string, gross: string, feeBps: number) {
  ensure(
    amount(gross) > 0n && amount(gross) <= amount(earned) - amount(used),
    'EXCEEDS_EARNED',
    'Only confirmed, earned salary can be advanced.',
  );
  const fee = mulBps(gross, feeBps);
  return { gross, fee, net: subtract(gross, fee) };
}
export function parseCsv(text: string) {
  ensure(text.length <= 1_000_000, 'FILE_TOO_LARGE', 'CSV must be smaller than 1 MB.');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  ensure(!quoted, 'INVALID_CSV', 'A quoted CSV field is unfinished.');
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export const csvCell = (value: unknown) =>
  '"' +
  String(value ?? '')
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
