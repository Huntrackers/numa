import { DateTime } from 'luxon';
import { allocate, changeSalary, nextDue, type Cadence } from './index.js';
export function futureDates(
  cadence: Cadence,
  anchor: string,
  from: string,
  until: string,
  timezone: string,
) {
  const rows: string[] = [];
  let cursor = from;
  for (let i = 0; i < 367; i++) {
    const due = nextDue(cadence, anchor, cursor, timezone);
    if (due > until) break;
    rows.push(due);
    cursor = due;
  }
  return rows;
}
export function companyForecast({
  employees,
  obligations = [],
  free,
  timezone,
  from,
  horizonDays = 90,
  change,
}: any) {
  const until = DateTime.fromISO(from).plus({ days: horizonDays }).toISO()!;
  const rows: any[] = [];
  for (const e of employees.filter((e: any) => e.status === 'ACTIVE'))
    for (const dueAt of futureDates(e.cadence, e.anchor, from, until, timezone)) {
      const before =
        e.pendingSalary && e.pendingSalary.effectiveFrom <= dueAt
          ? e.pendingSalary.salary
          : e.salary;
      const selected =
        change &&
        (change.selection === 'all' ||
          (change.selection === 'role' && e.roleId === change.roleId) ||
          (change.selection === 'selected' && change.employeeIds?.includes(e.id)));
      const after =
        selected && dueAt >= change.effectiveFrom
          ? changeSalary(before, change.kind, change.delta, change.direction)
          : before;
      rows.push({ employeeId: e.id, name: e.name, dueAt, before, after });
    }
  const current = rows.reduce((n, r) => n + BigInt(r.before), 0n),
    proposed = rows.reduce((n, r) => n + BigInt(r.after), 0n);
  const signed = obligations
    .filter((o: any) => !o.credited && !o.cancelled && (!o.state || o.state === 'RESERVED'))
    .map((o: any) => ({
      ...o,
      dueAt: o.dueAt || new Date(Number(BigInt(o.due_at) / 1000000n)).toISOString(),
    }))
    .filter((o: any) => o.dueAt > from && o.dueAt <= until);
  const signedAmount = signed.reduce((n: bigint, o: any) => n + BigInt(o.amount), 0n),
    available = BigInt(free) + signedAmount;
  const periods = new Map<string, { current: bigint; proposed: bigint; count: number }>();
  for (const r of rows) {
    const month = DateTime.fromISO(r.dueAt).setZone(timezone).toFormat('yyyy-MM');
    const p = periods.get(month) || { current: 0n, proposed: 0n, count: 0 };
    p.current += BigInt(r.before);
    p.proposed += BigInt(r.after);
    p.count++;
    periods.set(month, p);
  }
  return {
    kind: 'company',
    from,
    until,
    horizonDays,
    current: current.toString(),
    proposed: proposed.toString(),
    difference: (proposed - current).toString(),
    signedAmount: signedAmount.toString(),
    signedCount: signed.length,
    free,
    shortfall: (proposed > available ? proposed - available : 0n).toString(),
    periods: [...periods].map(([period, v]) => ({
      period,
      current: v.current.toString(),
      proposed: v.proposed.toString(),
      count: v.count,
    })),
    affectedPaydays: rows.filter((r) => r.before !== r.after).length,
    assumptions: [
      'Employment continues through the selected horizon.',
      'Calendar projections are estimates, not signed obligations.',
      'Only existing signed reservations and free treasury fund this estimate.',
      'No token appreciation, yield or fiat exchange rate is assumed.',
    ],
  };
}
export function employeeForecast({
  employee,
  employees,
  policy,
  goals,
  dca = [],
  dcaBudget = '0',
  cash = '0',
  timezone,
  from,
  horizonDays = 90,
}: any) {
  const until = DateTime.fromISO(from).plus({ days: horizonDays }).toISO()!;
  const copies = structuredClone(goals),
    events: any[] = [],
    completion = new Map<string, { paydays: number; at: string }>(),
    counts = new Map<string, { funded: number; skipped: number; spent: bigint }>();
  let cashBalance = BigInt(cash),
    budget = BigInt(dcaBudget),
    paydays = 0;
  for (const source of employees || [employee])
    for (const at of futureDates(
      source.cadence,
      source.anchor,
      from,
      until,
      source.timezone || timezone,
    ))
      events.push({ at, kind: 'salary', employee: source });
  for (const plan of dca.filter((d: any) => d.state === 'ACTIVE')) {
    counts.set(plan.id, { funded: 0, skipped: 0, spent: BigInt(plan.spent || '0') });
    for (const at of futureDates(
      plan.cadence,
      plan.anchor,
      from,
      plan.endAt && plan.endAt < until ? plan.endAt : until,
      timezone,
    ))
      events.push({ at, kind: 'dca', plan });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === 'salary' ? -1 : 1));
  const periods: any[] = [];
  for (const event of events) {
    if (event.kind === 'salary') {
      paydays++;
      const employee = event.employee;
      const salary =
        employee.pendingSalary && employee.pendingSalary.effectiveFrom <= event.at
          ? employee.pendingSalary.salary
          : employee.salary;
      const result = allocate(salary, policy.legs, policy.cashFloor, copies);
      cashBalance += BigInt(result.shares.find((l: any) => l.type === 'cash')!.amount);
      budget += BigInt(result.shares.find((l: any) => l.type === 'dca')?.amount || '0');
      for (const c of result.contributions) {
        const g = copies.find((g: any) => g.id === c.goalId);
        g.funded = (BigInt(g.funded) + BigInt(c.amount)).toString();
        if (BigInt(g.funded) >= BigInt(g.target)) {
          g.state = 'COMPLETED';
          if (!completion.has(g.id)) completion.set(g.id, { paydays, at: event.at });
        }
      }
      periods.push({ at: event.at, cash: cashBalance.toString(), dcaBudget: budget.toString() });
    } else {
      const p = event.plan,
        c = counts.get(p.id)!;
      const amount = BigInt(p.amount),
        cost = amount + (amount * 25n) / 10000n;
      const allowed =
        budget >= cost &&
        (!p.maxTotal || c.spent + cost <= BigInt(p.maxTotal)) &&
        (p.maxFeeBps ?? 25) >= 25;
      if (allowed) {
        budget -= cost;
        c.spent += cost;
        c.funded++;
      } else c.skipped++;
    }
  }
  return {
    kind: 'employee',
    from,
    until,
    horizonDays,
    paydays,
    projectedCash: cashBalance.toString(),
    remainingDcaBudget: budget.toString(),
    goals: copies.map((g: any) => ({
      id: g.id,
      name: g.name,
      target: g.target,
      funded: g.funded,
      completion: completion.get(g.id) || null,
      state: g.state,
      targetDate: g.targetDate || null,
      targetDateMet: g.targetDate
        ? !!completion.get(g.id) && completion.get(g.id)!.at.slice(0, 10) <= g.targetDate
        : null,
    })),
    dca: dca.map((p: any) => ({
      id: p.id,
      name: p.name,
      fundedOccurrences: counts.get(p.id)?.funded || 0,
      skippedOccurrences: counts.get(p.id)?.skipped || 0,
    })),
    periods,
    assumptions: [
      'Only future salary receipts on the current agreement are assumed.',
      'Goal percentages use their explicit salary or goals-budget basis; all contributions stay within the goals budget.',
      'DCA uses prefunded budget and a scenario fee of 0.25%; prices and routes may prevent a real order.',
      'No spending, market growth, investment yield or salary increase is assumed.',
      'Completion dates depend on salaries arriving; this preview creates no mandate.',
    ],
  };
}
