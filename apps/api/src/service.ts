import { operatorAccount } from './operators.js';
import { randomUUID, randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { Store, acct, type Entity } from '../../../packages/db/src/index.js';
import {
  ensure,
  amount,
  hash,
  add,
  subtract,
  mulBps,
  changeSalary,
  allocate,
  occurrences,
  obligationId,
  earlyPay,
  loanInterest,
  loanRisk,
  parseCsv,
  nextDue,
  csvCell,
} from '../../../packages/domain/src/index.js';
import {
  schemas,
  previewInputs,
  type CommandAction,
  type PreviewKind,
} from '../../../packages/api-contracts/src/index.js';
import { companyForecast, employeeForecast } from '../../../packages/domain/src/forecast.js';
import {
  EARN_SCENARIOS,
  earnOutcome,
  loanStress,
} from '../../../packages/domain/src/financial-scenarios.js';
import { ScenarioCatalog, quantityFor, valueFor } from './catalog.js';
export type Actor = { id: string; mode: 'DEMO' | 'TESTNET' };
const now = () => new Date().toISOString();
const plus = (ms: number) => new Date(Date.now() + ms).toISOString();
export class Service {
  constructor(public s: Store) {}
  catalog() {
    return new ScenarioCatalog(this.s);
  }
  user(a: Actor) {
    const u = this.s.get(a.id);
    ensure(u?.type === 'user', 'UNAUTHORIZED', 'Sign in to continue.', 401);
    if (
      a.mode === 'TESTNET' &&
      u.role === 'admin' &&
      !(process.env.NUMA_ADMIN_ACCOUNTS || '')
        .split(',')
        .map((x) => x.trim())
        .includes(u.accountId)
    )
      return { ...u, role: 'user' };
    return u;
  }
  company(a: Actor, id: string, write = false, sign = false) {
    this.user(a);
    const c = this.s.get(id);
    ensure(c?.type === 'company', 'NOT_FOUND', 'Company not found.', 404);
    const m = this.s.list('membership', id, a.id).find((m) => m.status === 'ACTIVE');
    ensure(
      m && m.access !== 'employee',
      'FORBIDDEN',
      'This company is outside your workspace.',
      403,
    );
    ensure(
      !write || ['owner', 'accountant'].includes(m.access),
      'FORBIDDEN',
      'This role has read-only access.',
      403,
    );
    ensure(
      !sign || m.access === 'owner',
      'FORBIDDEN',
      'Only the company owner can authorize financial changes.',
      403,
    );
    ensure(!write || c.status === 'ACTIVE', 'COMPANY_SUSPENDED', 'This company is suspended.', 403);
    return c;
  }
  employee(a: Actor) {
    this.user(a);
    // Personal assets and history survive termination of employment.
    const employments = this.s
      .list('employee', undefined, a.id)
      .filter((e) =>
        a.mode === 'TESTNET'
          ? this.s.get(e.tenant)?.mode === 'TESTNET'
          : this.s.get(e.tenant)?.mode !== 'TESTNET',
      );
    const e = employments.find((e) => e.status !== 'ENDED') || employments.at(-1);
    ensure(e, 'FORBIDDEN', 'An employee workspace is required.', 403);
    return e;
  }
  own(a: Actor, id: string, type: string) {
    const e = this.s.get(id);
    ensure(
      e && e.type === type && e.owner === a.id,
      'NOT_FOUND',
      'Record not found in your workspace.',
      404,
    );
    return e;
  }
  tenantEntity(tenant: string, id: string, type: string) {
    const e = this.s.get(id);
    ensure(
      e && e.type === type && e.tenant === tenant,
      'NOT_FOUND',
      'Record not found in this company.',
      404,
    );
    return e;
  }
  version(e: Entity, expected: number) {
    ensure(
      e.version === expected,
      'VERSION_CONFLICT',
      'This record changed. Refresh and try again.',
      409,
    );
  }
  admin(a: Actor) {
    const user = this.user(a);
    ensure(
      user.role === 'admin' && (a.mode === 'DEMO' || operatorAccount(user.accountId)),
      'FORBIDDEN',
      'Operator access is required.',
      403,
    );
  }
  simulation(a: Actor) {
    ensure(
      a.mode === 'DEMO',
      'SIMULATION_ONLY',
      'Use the demo workspace for this scenario. Testnet balances are independent.',
      409,
    );
  }
  balance(owner: string, pocket = 'cash') {
    return this.s.balance(acct(owner, pocket)).toString();
  }
  fingerprint(tenant: string, owner?: string) {
    const types = [
      'company',
      'employee',
      'role',
      'policy',
      'goal',
      'dca',
      'position',
      'hold',
      'loan',
      'obligation',
      'money-plan',
    ];
    const e = types
      .flatMap((t) => this.s.list(t, tenant))
      .filter(
        (e) =>
          !owner ||
          e.owner === owner ||
          e.type === 'company' ||
          (e.type === 'employee' && e.owner === owner),
      );
    const journal = this.s
      .ledger(tenant)
      .filter((e) => !owner || e.lines.some((l: any) => l.account.includes(':' + owner + ':')));
    return hash({ e: e.map((e) => [e.id, e.version]), journal: journal.map((e) => e.id) });
  }
  notify(owner: string, tenant: string, title: string, body: string) {
    this.s.save({ type: 'notification', owner, tenant, title, body, read: false });
  }
  promoteSalaries(at = now()) {
    for (const e of this.s
      .list('employee')
      .filter((e) => e.pendingSalary && e.pendingSalary.effectiveFrom <= at)) {
      this.s.save({ ...e, salary: e.pendingSalary.salary, pendingSalary: null });
    }
  }
  state(a: Actor, scope: string, companyId = 'forma') {
    this.s.atomic(() => this.promoteSalaries());
    const user = this.user(a);
    const memberships = this.s
      .list('membership', undefined, a.id)
      .filter(
        (m) =>
          m.status === 'ACTIVE' &&
          (a.mode === 'TESTNET'
            ? this.s.get(m.tenant)?.mode === 'TESTNET'
            : this.s.get(m.tenant)?.mode !== 'TESTNET'),
      );
    const base = {
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        demo: !!user.demo,
        accountId: user.accountId,
      },
      mode: a.mode,
      network: 'testnet',
      unit: 'demoUSD',
      serverTime: now(),
      workspaces: memberships
        .filter((m) => m.access !== 'employee')
        .map((m) => ({ ...this.s.get(m.tenant), access: m.access })),
      notifications: this.s.list('notification', undefined, a.id),
      assets: this.catalog().list(),
      catalogStatus: this.s.get('catalog-status'),
    };
    if (scope === 'admin') {
      this.admin(a);
      return {
        ...base,
        companies: this.s
          .list('company')
          .filter(
            (c) => !c.personal && (process.env.DEMO_ENABLED !== 'false' || c.mode === 'TESTNET'),
          ),
        users: this.s
          .list('user')
          .filter((u) => process.env.DEMO_ENABLED !== 'false' || !u.demo)
          .map(({ id, name, role, demo, accountId }) => ({ id, name, role, demo, accountId })),
        audit: this.s.list('audit').slice(-300).reverse(),
        settings: this.s.get('settings'),
        jobs: this.s.db
          .prepare(
            'SELECT id,kind,status,attempts,available_at,lease_until,last_error FROM outbox ORDER BY rowid DESC LIMIT 100',
          )
          .all(),
        worker: this.s.get('worker-heartbeat'),
        testnet: {
          contractId: process.env.NEAR_CONTRACT_ID || null,
          rpcHost: (() => {
            try {
              return new URL(process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com').host;
            } catch {
              return 'Invalid RPC URL';
            }
          })(),
          worker: this.s.get('testnet-worker-heartbeat'),
          reconciliation: this.s.get('chain-sync:' + process.env.NEAR_CONTRACT_ID),
          jobs: this.s.list('chain-job').slice(-50).reverse(),
          backup: this.s.get('backup-status'),
          unresolved: this.s
            .list('chain-operation')
            .filter((o) => ['DISPATCHED', 'SUBMITTED'].includes(o.state)).length,
        },
      };
    }
    if (scope === 'company') {
      const c = this.company(a, companyId);
      const ledger = this.s.ledger(c.id);
      return {
        ...base,
        company: c,
        access: memberships.find((m) => m.tenant === c.id)?.access,
        employees: this.s.list('employee', c.id),
        roles: this.s.list('role', c.id),
        obligations: this.s.list('obligation', c.id),
        treasury: {
          cash: this.balance(c.id),
          reserved: this.balance(c.id, 'payroll'),
          bonus: this.balance(c.id, 'bonus'),
        },
        ledger,
        audit: this.s.list('audit', c.id).slice(-100).reverse(),
        worker: this.s.get('worker-heartbeat'),
      };
    }
    const e = this.employee(a);
    const own = (t: string) => this.s.list(t, e.tenant, a.id);
    const allocationBudgets = own('allocation-budget').map((g) => ({
      ...g,
      balance: this.balance(a.id, g.pocket),
    }));
    const goals = own('goal').map((g) => ({ ...g, funded: this.balance(a.id, 'goal:' + g.id) }));
    const portfolio = own('position').map((p) => {
      const asset = this.catalog()
        .list()
        .find((a) => a.id === p.asset)!;
      const value = valueFor(p.quantity, asset);
      return {
        ...p,
        price: asset.price,
        value,
        unrealized: (BigInt(value) - BigInt(p.cost)).toString(),
      };
    });
    const holds = own('hold'),
      loans = own('loan');
    const collateral = loans
      .filter((l) => l.state === 'ACTIVE')
      .reduce((s, l) => s + amount(l.collateral), 0n);
    const debt = loans
      .filter((l) => l.state === 'ACTIVE')
      .reduce((s, l) => s + amount(l.principal) + amount(l.interest), 0n);
    return {
      ...base,
      employee: e,
      company: { id: e.tenant, name: this.s.get(e.tenant)?.name },
      goals,
      allocationBudgets,
      policy: own('policy')[0],
      dca: own('dca'),
      destinations: own('destination'),
      obligations: this.s.list('obligation', e.tenant).filter((o) => o.employeeId === e.id),
      portfolio,
      orders: own('order').reverse(),
      holds,
      loans: loans.map((l) => ({
        ...l,
        repaymentReserve: this.balance(a.id, 'repayment:' + l.id),
        stress: loanStress(
          l.collateral,
          add(l.principal, l.interest),
          own('money-plan')[0]?.monthlyIncome || '0',
          own('money-plan')[0]?.expenses || '0',
          l.repaymentPlan?.amount || '0',
        ),
      })),
      earn: own('earn'),
      moneyPlan: own('money-plan')[0],
      balances: {
        autoInvest: allocationBudgets.reduce((s, g) => s + amount(g.balance), 0n).toString(),
        loanCash: this.balance(a.id, 'loan-funds'),
        earnLocked: own('earn')
          .filter((x) => ['ACTIVE', 'EXIT_PENDING'].includes(x.state))
          .reduce((s, x) => s + amount(x.principal), 0n)
          .toString(),
        cash: this.balance(a.id),
        goals: goals.reduce((s, g) => s + amount(g.funded), 0n).toString(),
        dca: this.balance(a.id, 'dca'),
        invest: this.balance(a.id, 'invest'),
        earnBudget: this.balance(a.id, 'earn-budget'),
        repaymentReserve: loans
          .reduce((n, l) => n + BigInt(this.balance(a.id, 'repayment:' + l.id)), 0n)
          .toString(),
        holds: holds
          .filter((h) => h.state === 'ACTIVE')
          .reduce((s, h) => s + amount(h.principal), 0n)
          .toString(),
        collateral: collateral.toString(),
        debt: debt.toString(),
        portfolio: portfolio.reduce((s, p) => s + amount(p.value), 0n).toString(),
      },
      ledger: this.s
        .ledger(e.tenant)
        .filter((l) => l.lines.some((x: any) => x.account.startsWith('demoUSD:' + a.id + ':'))),
    };
  }
  preview(a: Actor, companyId: string | undefined, kind: PreviewKind, input: any) {
    this.simulation(a);
    const v = (previewInputs[kind] as z.ZodType).parse(input) as any;
    let tenant = '',
      owner: string | undefined,
      effects: any = {},
      details: any = {};
    if (kind === 'salary-change' || kind === 'payroll') {
      const c = this.company(a, companyId!, true);
      tenant = c.id;
      if (kind === 'salary-change') {
        ensure(
          new Date(v.effectiveFrom).getTime() >= Date.now() - 60000,
          'INVALID_EFFECTIVE_DATE',
          'Choose today or a future effective date.',
        );
        const employees = this.s
          .list('employee', tenant)
          .filter(
            (e) =>
              e.status !== 'ENDED' &&
              (v.selection === 'all' ||
                (v.selection === 'role' && e.roleId === v.roleId) ||
                (v.selection === 'selected' && v.employeeIds?.includes(e.id))),
          );
        ensure(employees.length > 0, 'EMPTY_SELECTION', 'Select at least one employee.');
        const rows = employees.map((e) => ({
          id: e.id,
          name: e.name,
          cadence: e.cadence,
          before: e.salary,
          after: changeSalary(e.salary, v.kind, v.delta, v.direction),
          version: e.version,
        }));
        const revisions = rows.flatMap((r) =>
          this.s
            .list('obligation', tenant)
            .filter(
              (o) =>
                o.employeeId === r.id &&
                o.state === 'RESERVED' &&
                o.dueAt > now() &&
                o.dueAt >= v.effectiveFrom &&
                amount(o.earned || '0') === 0n &&
                amount(o.earlyGross || '0') === 0n,
            )
            .map((o) => {
              const after = BigInt(o.amount) + BigInt(r.after) - BigInt(r.before);
              ensure(
                after >= 0n,
                'NEGATIVE_SALARY',
                'A reserved obligation would become negative after its adjustments.',
              );
              return {
                id: o.id,
                before: o.amount,
                after: after.toString(),
                version: o.version,
                dueAt: o.dueAt,
              };
            }),
        );
        const reserveDelta = revisions.reduce((s, o) => s + BigInt(o.after) - BigInt(o.before), 0n);
        ensure(
          reserveDelta <= amount(this.balance(tenant)),
          'INSUFFICIENT_FUNDS',
          'Fund the extra reserved payroll before applying this increase.',
        );
        effects = {
          rows,
          effectiveFrom: v.effectiveFrom,
          reservationDelta: reserveDelta.toString(),
          revisedObligations: revisions.length,
          forecast: companyForecast({
            employees: this.s.list('employee', tenant),
            obligations: this.s.list('obligation', tenant),
            free: this.balance(tenant),
            timezone: c.timezone,
            from: now(),
            horizonDays: v.horizonDays,
            change: v,
          }),
          note: 'Amounts are per pay period. Eligible unearned future obligations are replaced atomically, with their original IDs. Earned and settled salary is preserved.',
        };
        details = { rows, revisions, reserveDelta: reserveDelta.toString() };
      } else {
        const people = this.s.list('employee', tenant).filter((e) => e.status === 'ACTIVE');
        ensure(people.length > 0, 'EMPTY_PAYROLL', 'Add an active employee first.');
        const list: any[] = [];
        for (const e of people) {
          ensure(
            e.demoIdentity || e.identityVerified,
            'IDENTITY_REQUIRED',
            'Employees must accept their identity first.',
          );
          const dueList = v.accelerated
            ? [{ index: 'accelerated-' + now().slice(0, 10), dueAt: plus(2500) }]
            : occurrences(
                e.cadence,
                e.anchor,
                new Date(Date.now() - 1).toISOString(),
                plus(v.days * 86400000),
                c.timezone,
              );
          for (const due of dueList) {
            const id = obligationId(tenant, e.id, e.scheduleId, due.index);
            if (this.s.get(id)) continue;
            let salary = e.salary;
            if (e.pendingSalary && e.pendingSalary.effectiveFrom <= due.dueAt)
              salary = e.pendingSalary.salary;
            list.push({
              id,
              employeeId: e.id,
              owner: e.owner,
              name: e.name,
              amount: salary,
              dueAt: due.dueAt,
              periodIndex: due.index,
              scheduleId: e.scheduleId,
            });
          }
        }
        ensure(
          list.length > 0,
          'NO_NEW_OBLIGATIONS',
          'This window is already authorized, or no payment falls in it.',
        );
        ensure(list.length <= 500, 'WINDOW_TOO_LARGE', 'Use a shorter authorization window.');
        const total = list.reduce((s, o) => s + amount(o.amount), 0n).toString();
        ensure(
          amount(this.balance(tenant)) >= amount(total),
          'INSUFFICIENT_FUNDS',
          'Fund the entire payroll window before authorizing.',
        );
        effects = {
          rows: list,
          total,
          freeAfter: subtract(this.balance(tenant), total),
          scheduleLabel: v.accelerated ? 'Accelerated Demo Schedule' : 'Calendar schedule',
          note: 'The full amount is reserved now. Payroll is credited to each Salary Vault when due.',
        };
        details = { list, total };
      }
    } else {
      const e = this.employee(a);
      tenant = e.tenant;
      owner = a.id;
      if (kind === 'allocation') {
        const policy = this.s.list('policy', tenant, a.id)[0];
        ensure(
          (policy?.version || 0) === v.expectedVersion,
          'VERSION_CONFLICT',
          'The allocation policy changed.',
          409,
        );
        for (const leg of v.legs.filter((l: any) => l.type === 'invest')) {
          const selected = this.catalog().resolve(leg.asset || 'NEAR');
          Object.assign(leg, {
            assetId: selected.assetId,
            ...this.catalog().route(a.id, selected, leg),
          });
          delete leg.source;
          delete leg.destinationOwnership;
          if (!leg.destinationId) delete leg.destinationId;
          ensure(
            this.catalog()
              .list()
              .some((x) => x.id === (leg.asset || 'NEAR')),
            'UNSUPPORTED_ASSET',
            'Choose a scenario asset for each investment share.',
          );
          if (leg.destinationId) {
            const destination = this.own(a, leg.destinationId, 'destination');
            ensure(
              destination.state === 'ACTIVE',
              'DESTINATION_ARCHIVED',
              'Select an active destination.',
            );
          }
        }
        const result = allocate(
          v.salary,
          v.legs,
          v.cashFloor,
          this.s.list('goal', tenant, a.id) as any,
        );
        effects = {
          ...result,
          forecast: employeeForecast({
            employee: { ...e, salary: v.salary },
            policy: { legs: v.legs, cashFloor: v.cashFloor },
            goals: this.s
              .list('goal', tenant, a.id)
              .map((g) => ({ ...g, funded: this.balance(a.id, 'goal:' + g.id) })),
            dca: this.s.list('dca', tenant, a.id),
            dcaBudget: this.balance(a.id, 'dca'),
            cash: this.balance(a.id),
            timezone: this.s.get(tenant)!.timezone,
            from: now(),
            horizonDays: v.horizonDays,
          }),
          note: 'Applies only to future salary credits. Investing shares buy the chosen scenario assets automatically, using a 0.25% fee deducted from that share. Amounts below 1 demoUSD accumulate separately. Existing reserves stay in place.',
        };
      }
      if (kind === 'allocation')
        effects.forecast.baseline = employeeForecast({
          employee: { ...e, salary: v.salary },
          policy: this.s.list('policy', tenant, a.id)[0] || {
            legs: [{ id: 'cash', type: 'cash', bps: 10000 }],
            cashFloor: '0',
          },
          goals: this.s
            .list('goal', tenant, a.id)
            .map((g) => ({ ...g, funded: this.balance(a.id, 'goal:' + g.id) })),
          dca: this.s.list('dca', tenant, a.id),
          dcaBudget: this.balance(a.id, 'dca'),
          cash: this.balance(a.id),
          timezone: this.s.get(tenant)!.timezone,
          from: effects.forecast.from,
          horizonDays: v.horizonDays,
        });
      if (kind === 'trade') {
        const asset = this.catalog()
          .list()
          .find((x) => x.id === v.asset);
        ensure(asset, 'UNSUPPORTED_ASSET', 'This asset is not in the scenario catalog.');
        ensure(amount(v.amount) > 0n, 'INVALID_AMOUNT', 'Enter an amount greater than zero.');
        const fee = mulBps(v.amount, 25);
        const p = this.s.list('position', tenant, a.id).find((p) => p.asset === asset.id);
        const quantity = quantityFor(v.amount, asset);
        ensure(amount(quantity) > 0n, 'AMOUNT_TOO_SMALL', 'The order is too small.');
        if (v.side === 'buy')
          ensure(
            amount(this.balance(a.id)) + amount(this.balance(a.id, 'invest')) >=
              amount(v.amount) + amount(fee),
            'INSUFFICIENT_FUNDS',
            'There is not enough available cash and investment budget.',
          );
        else
          ensure(
            p && amount(p.quantity) >= amount(quantity),
            'INSUFFICIENT_POSITION',
            'This sell exceeds your available position.',
          );
        effects = {
          ...this.catalog().quote(a.id, asset, v),
          side: v.side,
          amount: v.amount,
          fee,
          quantity,
          price: asset.price,
          net: v.side === 'buy' ? add(v.amount, fee) : subtract(v.amount, fee),

          note: 'Simulated NEAR Intents workflow. No swap or stock trade is submitted.',
        };
      }
      if (kind === 'early-pay') {
        const o = this.ownObligation(a, v.obligationId);
        ensure(
          o.state === 'RESERVED',
          'INVALID_STATE',
          'This salary is not available for an advance.',
        );
        const result = earlyPay(o.earned || '0', o.earlyGross || '0', v.gross, 100);
        effects = {
          ...result,
          remainingSalary: subtract(o.amount, add(o.earlyGross || '0', v.gross)),
          note: 'A 1% scenario fee reduces cash received. The nominal advance reduces the final payment.',
        };
      }
      if (kind === 'hold') {
        ensure(
          amount(v.amount) > 0n && amount(this.balance(a.id)) >= amount(v.amount),
          'INSUFFICIENT_FUNDS',
          'Use available salary cash only.',
        );
        const bonus = ((amount(v.amount) * 500n * BigInt(v.days)) / 3650000n).toString();
        ensure(
          amount(this.balance(tenant, 'bonus')) >= amount(bonus),
          'BONUS_NOT_FUNDED',
          'The employer must fund the full bonus before this offer can be accepted.',
        );
        effects = {
          principal: v.amount,
          bonus,
          maturity: plus(v.days * 86400000),
          annualScenarioBps: 500,
          note: 'Principal and employer-funded bonus are reserved. Early exit returns principal and forfeits the bonus. No market yield is guaranteed.',
        };
      }
      if (kind === 'loan') {
        ensure(
          amount(v.collateral) > 0n && amount(v.principal) > 0n,
          'INVALID_AMOUNT',
          'Collateral and loan must be greater than zero.',
        );
        ensure(
          amount(this.balance(a.id)) >= amount(v.collateral),
          'INSUFFICIENT_FUNDS',
          'Only free demo cash can be used as collateral. Goals and hold reserves are protected.',
        );
        ensure(
          this.s.list('loan', tenant, a.id).every((l) => l.state !== 'ACTIVE'),
          'ACTIVE_LOAN',
          'Repay the current scenario loan before borrowing again.',
        );
        ensure(
          this.s.list('loan', tenant, a.id).length === 0 ||
            this.s.balance(acct(a.id, 'loan-funds')) === 0n,
          'RECURSIVE_LEVERAGE',
          'Borrowed funds cannot create another collateral position.',
        );
        const risk = loanRisk(v.collateral, v.principal);
        ensure(
          risk.ltvBps <= 5000,
          'LTV_TOO_HIGH',
          'Initial borrowing is capped at 50% of collateral in this scenario.',
        );
        effects = {
          collateral: v.collateral,
          principal: v.principal,
          aprBps: 800,
          interest30: loanInterest(v.principal, 800, 30),
          ...risk,
          note: 'Educational collateral-loan simulation. Rhea is not connected. Debt is not income; collateral can lose value.',
        };
      }
    }
    return this.s.save({
      type: 'preview',
      tenant,
      owner: a.id,
      kind,
      input: v,
      inputHash: hash(v),
      fingerprint: this.fingerprint(tenant, owner),
      scopeOwner: owner || null,
      effects,
      details,
      expiresAt: kind === 'trade' ? effects.expiresAt : plus(300000),
      state: 'READY',
      mode: 'SIMULATION',
    });
  }
  ownObligation(a: Actor, id: string) {
    const e = this.employee(a);
    const o = this.tenantEntity(e.tenant, id, 'obligation');
    ensure(o.owner === a.id, 'NOT_FOUND', 'Salary record not found.', 404);
    return o;
  }
  apply(a: Actor, id: string) {
    const p = this.own(a, id, 'preview');
    ensure(p.state === 'READY', 'PREVIEW_USED', 'This decision was already applied.', 409);
    ensure(
      p.expiresAt > now() &&
        p.fingerprint === this.fingerprint(p.tenant, p.scopeOwner || undefined),
      'PREVIEW_STALE',
      'The underlying data changed or this preview expired. Create a new preview.',
      409,
    );
    const v = p.input;
    let result: any;
    switch (p.kind) {
      case 'salary-change': {
        this.company(a, p.tenant, true, true);
        const delta = BigInt(p.details.reserveDelta || '0');
        for (const revision of p.details.revisions || []) {
          const o = this.tenantEntity(p.tenant, revision.id, 'obligation');
          this.version(o, revision.version);
          ensure(
            o.state === 'RESERVED' && o.dueAt > now() && amount(o.earned || '0') === 0n,
            'PREVIEW_STALE',
            'An obligation is no longer eligible for replacement.',
            409,
          );
          this.s.save({ ...o, amount: revision.after });
        }
        if (delta !== 0n)
          this.s.transfer(
            'demoUSD',
            p.tenant,
            'salary-revision:' + p.id,
            'RESERVE',
            'Adjust future payroll reservation',
            acct(p.tenant, delta > 0n ? 'cash' : 'payroll'),
            acct(p.tenant, delta > 0n ? 'payroll' : 'cash'),
            (delta > 0n ? delta : -delta).toString(),
          );
        for (const r of p.details.rows) {
          const e = this.tenantEntity(p.tenant, r.id, 'employee');
          this.version(e, r.version);
          this.s.save({
            type: 'pay-agreement',
            tenant: p.tenant,
            owner: e.owner,
            employeeId: e.id,
            scheduleId: e.scheduleId,
            previousAmount: e.salary,
            amount: r.after,
            effectiveFrom: v.effectiveFrom,
            cadence: e.cadence,
          });
          this.s.save({
            ...e,
            pendingSalary: { salary: r.after, effectiveFrom: v.effectiveFrom },
            ...(v.effectiveFrom <= now() ? { salary: r.after } : {}),
          });
        }
        result = { updated: p.details.rows.length };
        break;
      }
      case 'payroll': {
        this.company(a, p.tenant, true, true);
        const mandate = this.s.save({
          type: 'mandate',
          tenant: p.tenant,
          owner: a.id,
          state: 'ACTIVE',
          expiresAt: plus(31 * 86400000),
          label: p.effects.scheduleLabel,
        });
        this.s.transfer(
          'demoUSD',
          p.tenant,
          'mandate:' + mandate.id,
          'RESERVE',
          'Prefund payroll window',
          acct(p.tenant),
          acct(p.tenant, 'payroll'),
          p.details.total,
        );
        for (const o of p.details.list) {
          const saved = this.s.save({
            type: 'obligation',
            tenant: p.tenant,
            ...o,
            state: 'RESERVED',
            mandateId: mandate.id,
            earned: '0',
            earlyGross: '0',
            paused: false,
            adjustments: [],
            accelerated: v.accelerated,
          });
          this.s.enqueue('PAYROLL', 'payroll:' + o.id, { obligationId: o.id }, o.dueAt);
        }
        result = mandate;
        break;
      }
      case 'allocation': {
        const e = this.employee(a);
        const old = this.s.list('policy', e.tenant, a.id)[0];
        result = this.s.save({
          type: 'policy',
          id: old?.id,
          tenant: e.tenant,
          owner: a.id,
          legs: v.legs,
          cashFloor: v.cashFloor,
        });
        break;
      }
      case 'trade':
        result = this.trade(a, p.tenant, p.effects, 'trade:' + p.id);
        break;
      case 'early-pay': {
        const o = this.ownObligation(a, v.obligationId);
        this.s.transfer(
          'demoUSD',
          o.tenant,
          'advance:' + p.id,
          'EARLY_PAY',
          'Early salary net advance',
          acct(o.tenant, 'payroll'),
          acct(a.id),
          p.effects.net,
        );
        this.s.transfer(
          'demoUSD',
          o.tenant,
          'advance-fee:' + p.id,
          'FEE',
          'Early pay scenario fee',
          acct(o.tenant, 'payroll'),
          acct(o.tenant),
          p.effects.fee,
        );
        result = this.s.save({ ...o, earlyGross: add(o.earlyGross || '0', v.gross) });
        this.s.save({
          type: 'early-pay',
          tenant: o.tenant,
          owner: a.id,
          obligationId: o.id,
          ...p.effects,
        });
        break;
      }
      case 'hold': {
        const e = this.employee(a);
        const h = this.s.save({
          type: 'hold',
          tenant: e.tenant,
          owner: a.id,
          principal: v.amount,
          bonus: p.effects.bonus,
          maturity: p.effects.maturity,
          state: 'ACTIVE',
        });
        this.s.transfer(
          'demoUSD',
          e.tenant,
          'hold:' + h.id,
          'RESERVE',
          'Hold principal reserved',
          acct(a.id),
          acct(a.id, 'hold:' + h.id),
          h.principal,
        );
        this.s.transfer(
          'demoUSD',
          e.tenant,
          'hold-bonus:' + h.id,
          'RESERVE',
          'Employer bonus reserved',
          acct(e.tenant, 'bonus'),
          acct(a.id, 'hold-bonus:' + h.id),
          h.bonus,
        );
        this.s.enqueue('HOLD', 'hold:' + h.id, { id: h.id }, h.maturity);
        result = h;
        break;
      }
      case 'loan': {
        const e = this.employee(a);
        const l = this.s.save({
          type: 'loan',
          tenant: e.tenant,
          owner: a.id,
          collateral: v.collateral,
          principal: v.principal,
          interest: '0',
          aprBps: 800,
          state: 'ACTIVE',
          lastAccrualDate: now().slice(0, 10),
          model: 'Noma educational cash-collateral scenario',
        });
        this.s.transfer(
          'demoUSD',
          e.tenant,
          'collateral:' + l.id,
          'RESERVE',
          'Collateral locked, protected savings excluded',
          acct(a.id),
          acct(a.id, 'collateral:' + l.id),
          l.collateral,
        );
        this.s.transfer(
          'demoUSD',
          e.tenant,
          'loan:' + l.id,
          'LOAN',
          'Loan proceeds, not income',
          acct(a.id, 'loan-liability:' + l.id),
          acct(a.id, 'loan-funds'),
          l.principal,
          true,
        );
        result = l;
        break;
      }
    }
    this.s.save({ ...p, state: 'APPLIED' });
    this.s.audit(a.id, p.tenant, 'preview.applied', p.id, { kind: p.kind, inputHash: p.inputHash });
    return { result, preview: p.effects };
  }
  trade(a: Actor, tenant: string, quote: any, key: string, fromPocket?: string): Entity {
    return this.s.atomic(() => this.executeTrade(a, tenant, quote, key, fromPocket));
  }
  private executeTrade(a: Actor, tenant: string, quote: any, key: string, fromPocket?: string) {
    const identity = this.catalog().validateQuote(a.id, quote);
    ensure(identity.enabled, 'ASSET_DISABLED', 'The selected asset is disabled.');
    if (quote.expiresAt)
      ensure(
        quote.expiresAt > now(),
        'STALE_QUOTE',
        'The quote expired. Create another preview.',
        409,
      );
    const old = this.s
      .list('position', tenant, a.id)
      .find((x) => (x.assetId || this.catalog().resolve(x.asset).assetId) === identity.assetId);
    const positionId = old?.id || randomUUID();
    const costPocket = 'position:' + positionId;
    const total = quote.net;
    let result;
    if (quote.side === 'buy') {
      let left = amount(total);
      for (const pocket of fromPocket ? [fromPocket] : ['invest', 'cash']) {
        const b = this.s.balance(acct(a.id, pocket));
        const used = b < left ? b : left;
        if (used > 0n) {
          const feeShare = 0n;
          this.s.transfer(
            'demoUSD',
            tenant,
            key + ':reserve:' + pocket,
            'ORDER',
            'Order budget reserved',
            acct(a.id, pocket),
            acct(a.id, 'order:' + key),
            used.toString(),
          );
          left -= used;
        }
      }
      ensure(left === 0n, 'INSUFFICIENT_FUNDS', 'The order budget is insufficient.');
      this.s.transfer(
        'demoUSD',
        tenant,
        key + ':cost',
        'BUY',
        'Simulated asset acquisition',
        acct(a.id, 'order:' + key),
        acct(a.id, costPocket),
        quote.amount,
      );
      this.s.transfer(
        'demoUSD',
        tenant,
        key + ':fee',
        'FEE',
        'Simulated trading fee',
        acct(a.id, 'order:' + key),
        acct('scenario-fees'),
        quote.fee,
      );
      result = this.s.save({
        type: 'position',
        tenant,
        owner: a.id,
        id: positionId,
        asset: quote.asset,
        assetId: identity.assetId,
        quantity: add(old?.quantity || '0', quote.quantity),
        cost: add(old?.cost || '0', quote.amount),
        realizedPnl: old?.realizedPnl || '0',
      });
    } else {
      ensure(
        old && amount(old.quantity) >= amount(quote.quantity),
        'INSUFFICIENT_POSITION',
        'The position changed.',
      );
      const basis = ((amount(old.cost) * amount(quote.quantity)) / amount(old.quantity)).toString();
      this.s.transfer(
        'demoUSD',
        tenant,
        key + ':remove',
        'SELL',
        'Release weighted average cost',
        acct(a.id, costPocket),
        acct('scenario-market'),
        basis,
      );
      this.s.transfer(
        'demoUSD',
        tenant,
        key + ':proceeds',
        'SELL',
        'Simulated sale proceeds',
        acct('scenario-market'),
        acct(a.id),
        quote.net,
        true,
      );
      this.s.transfer(
        'demoUSD',
        tenant,
        key + ':fee',
        'FEE',
        'Simulated trading fee',
        acct('scenario-market'),
        acct('scenario-fees'),
        quote.fee,
        true,
      );
      result = this.s.save({
        ...old,
        quantity: subtract(old.quantity, quote.quantity),
        cost: subtract(old.cost, basis),
        realizedPnl: (BigInt(old.realizedPnl) + BigInt(quote.net) - BigInt(basis)).toString(),
      });
    }
    this.s.save({
      type: 'order',
      tenant,
      owner: a.id,
      asset: quote.asset,
      assetId: identity.assetId,
      side: quote.side,
      quantity: quote.quantity,
      amount: quote.amount,
      fee: quote.fee,
      price: quote.price,
      quoteMetadata: {
        quoteId: quote.quoteId,
        minimumOutput: quote.minimumOutput,
        priceSource: quote.priceSource,
        priceAsOf: quote.priceAsOf,
        network: quote.network,
        destinationId: quote.destinationId,
        executionMode: 'SIMULATED',
      },
      mode: 'SIMULATION',
      state: 'SIMULATED_FILLED',
      route: 'NEAR Intents workflow simulation',
      eventKey: key,
    });
    return result;
  }

  command(
    a: Actor,
    action: CommandAction,
    payload: unknown,
    companyId: string | undefined,
    key: string,
  ) {
    const p = (schemas[action] as z.ZodType).parse(payload) as any;
    this.user(a);
    const inputHash = hash({ action, p, companyId });
    return this.s.atomic(() => {
      const existing = this.s.db
        .prepare('SELECT input_hash,result FROM requests WHERE key=? AND actor=?')
        .get(key, a.id) as any;
      if (existing) {
        ensure(
          existing.input_hash === inputHash,
          'IDEMPOTENCY_CONFLICT',
          'This request key belongs to different input.',
          409,
        );
        return JSON.parse(existing.result);
      }
      if (!action.startsWith('admin.') && action !== 'notification.read') this.simulation(a);
      ensure(
        action.startsWith('admin.') ||
          ['notification.read', 'assistant.message', 'payroll.claim', 'preview.create'].includes(
            action,
          ) ||
          !this.s.get('settings')?.maintenance,
        'MAINTENANCE',
        'New changes are paused for maintenance.',
        503,
      );
      let r: any = { ok: true },
        tenant = companyId || '';
      switch (action) {
        case 'company.create': {
          ensure(
            this.user(a).role !== 'admin',
            'FORBIDDEN',
            'Use a company workspace to create a company.',
            403,
          );
          ensure(
            DateTime.now().setZone(p.timezone).isValid,
            'INVALID_TIMEZONE',
            'Choose an IANA timezone.',
          );
          const c = this.s.save({
            type: 'company',
            owner: a.id,
            name: p.name,
            timezone: p.timezone,
            unit: 'demoUSD',
            mode: 'SIMULATION',
            status: 'ACTIVE',
          });
          this.s.save({ ...c, tenant: c.id });
          this.s.save({
            type: 'membership',
            tenant: c.id,
            owner: a.id,
            status: 'ACTIVE',
            access: 'owner',
          });
          tenant = c.id;
          r = c;
          break;
        }
        case 'company.settings': {
          const c = this.company(a, tenant, true, true);
          this.version(c, p.expectedVersion);
          ensure(
            DateTime.now().setZone(p.timezone).isValid,
            'INVALID_TIMEZONE',
            'Choose an IANA timezone.',
          );
          r = this.s.save({ ...c, name: p.name, timezone: p.timezone });
          break;
        }
        case 'role.save': {
          this.company(a, tenant, true);
          const old = p.id ? this.tenantEntity(tenant, p.id, 'role') : undefined;
          if (old) this.version(old, p.expectedVersion);
          r = this.s.save({ type: 'role', tenant, owner: a.id, ...p });
          break;
        }
        case 'employee.invite': {
          const c = this.company(a, tenant, true);
          ensure(
            this.s.list('employee', tenant).length < this.s.get('settings')!.maxEmployees,
            'EMPLOYEE_LIMIT',
            'The company employee limit has been reached.',
          );
          this.tenantEntity(tenant, p.roleId, 'role');
          ensure(
            !this.s
              .list('employee', tenant)
              .some((e) => e.email === p.email && e.status !== 'ENDED'),
            'DUPLICATE_EMPLOYEE',
            'This email already belongs to an employee.',
          );
          const token = randomBytes(32).toString('hex');
          const e = this.s.save({
            type: 'employee',
            tenant,
            owner: 'pending-' + randomUUID(),
            ...p,
            status: 'INVITED',
            identityVerified: false,
            scheduleId: randomUUID(),
          });
          this.s.save({
            type: 'invitation',
            tenant,
            owner: a.id,
            employeeId: e.id,
            tokenHash: hash(token),
            expiresAt: plus(72 * 3600000),
            state: 'PENDING',
          });
          r = { employee: e, invitationToken: token, invitationUrl: '/invite/' + token };
          break;
        }
        case 'employee.accept': {
          const inv = this.s.list('invitation').find((i) => i.tokenHash === hash(p.token));
          ensure(
            inv && inv.state === 'PENDING' && inv.expiresAt > now(),
            'INVALID_INVITATION',
            'The invitation expired or was already used.',
            409,
          );
          const e = this.tenantEntity(inv.tenant, inv.employeeId, 'employee');
          ensure(
            !this.s.list('employee', undefined, a.id).some((e) => e.status !== 'ENDED'),
            'ALREADY_EMPLOYED',
            'This account already has an employee workspace.',
          );
          r = this.s.save({ ...e, owner: a.id, status: 'ACTIVE', demoIdentity: true });
          this.s.save({ ...inv, state: 'ACCEPTED' });
          tenant = inv.tenant;
          this.s.save({
            type: 'membership',
            tenant,
            owner: a.id,
            access: 'employee',
            status: 'ACTIVE',
          });
          break;
        }
        case 'employee.status': {
          this.company(a, tenant, true);
          const e = this.tenantEntity(tenant, p.id, 'employee');
          this.version(e, p.expectedVersion);
          ensure(
            e.status !== 'INVITED' || p.status !== 'ACTIVE',
            'INVITATION_REQUIRED',
            'The employee must accept their invitation.',
          );
          r = this.s.save({ ...e, status: p.status });
          break;
        }
        case 'import.preview': {
          this.company(a, tenant, true);
          const rows = parseCsv(p.csv);
          ensure(
            rows.length >= 2 && rows.length <= 51,
            'INVALID_IMPORT',
            'Include a header and up to 50 employees.',
          );
          const headers = rows.shift()!.map((x) => x.trim().toLowerCase());
          const required = ['name', 'email', 'role', 'salary', 'cadence'];
          ensure(
            required.every((h) => headers.includes(h)),
            'INVALID_HEADERS',
            'CSV headers: name,email,role,salary,cadence',
          );
          const roleMap = new Map(
            this.s.list('role', tenant).map((x) => [x.name.toLowerCase(), x.id]),
          );
          const seen = new Set<string>();
          const parsed = rows.map((row, index) => {
            const v = Object.fromEntries(headers.map((h, i) => [h, (row[i] || '').trim()]));
            const errors: string[] = [];
            if (!v.name) errors.push('Name is required');
            if (!z.email().safeParse(v.email).success) errors.push('Invalid email');
            if (
              seen.has(v.email) ||
              this.s.list('employee', tenant).some((e) => e.email === v.email)
            )
              errors.push('Duplicate email');
            seen.add(v.email);
            if (!roleMap.has(v.role.toLowerCase())) errors.push('Unknown role');
            if (!/^\d+(\.\d{1,2})?$/.test(v.salary)) errors.push('Invalid salary');
            if (!['daily', 'weekly', 'monthly'].includes(v.cadence)) errors.push('Invalid cadence');
            const parts = v.salary.split('.');
            return {
              row: index + 2,
              ...v,
              roleId: roleMap.get(v.role.toLowerCase()),
              salaryAtomic: errors.length
                ? '0'
                : (BigInt(parts[0]) * 100n + BigInt((parts[1] || '').padEnd(2, '0'))).toString(),
              errors,
            };
          });
          r = this.s.save({
            type: 'import',
            tenant,
            owner: a.id,
            rows: parsed,
            state: 'PREVIEW',
            expiresAt: plus(300000),
            fingerprint: this.fingerprint(tenant),
          });
          break;
        }
        case 'import.commit': {
          this.company(a, tenant, true);
          const im = this.own(a, p.previewId, 'import');
          ensure(
            im.tenant === tenant &&
              im.state === 'PREVIEW' &&
              im.expiresAt > now() &&
              im.fingerprint === this.fingerprint(tenant),
            'PREVIEW_STALE',
            'Import preview changed or expired.',
            409,
          );
          ensure(
            im.rows.every((x: any) => x.errors.length === 0),
            'IMPORT_ERRORS',
            'Correct all row errors before importing.',
          );
          ensure(
            this.s.list('employee', tenant).length + im.rows.length <=
              this.s.get('settings')!.maxEmployees,
            'EMPLOYEE_LIMIT',
            'This import exceeds the company limit.',
          );
          const links = [];
          for (const row of im.rows) {
            const token = randomBytes(32).toString('hex');
            const e = this.s.save({
              type: 'employee',
              tenant,
              owner: 'pending-' + randomUUID(),
              name: row.name,
              email: row.email,
              roleId: row.roleId,
              salary: row.salaryAtomic,
              cadence: row.cadence,
              status: 'INVITED',
              scheduleId: randomUUID(),
              anchor: plus(86400000),
            });
            this.s.save({
              type: 'invitation',
              tenant,
              owner: a.id,
              employeeId: e.id,
              tokenHash: hash(token),
              expiresAt: plus(72 * 3600000),
              state: 'PENDING',
            });
            links.push({ name: e.name, url: '/invite/' + token });
          }
          this.s.save({ ...im, state: 'COMMITTED' });
          r = { invitationLinks: links };
          break;
        }
        case 'treasury.fund': {
          this.company(a, tenant, true, true);
          ensure(amount(p.amount) > 0n, 'INVALID_AMOUNT', 'Enter a funding amount.');
          this.s.transfer(
            'demoUSD',
            tenant,
            'fund:' + key,
            'FUND',
            'Demo scenario funding, no real money',
            acct('external'),
            acct(tenant, p.purpose),
            p.amount,
            true,
          );
          r = { funded: p.amount };
          break;
        }
        case 'preview.create':
          r = this.preview(a, companyId, p.kind, p.input);
          break;
        case 'preview.apply':
          r = this.apply(a, p.previewId);
          break;
        case 'payroll.pause': {
          this.company(a, tenant, true, true);
          const o = this.tenantEntity(tenant, p.id, 'obligation');
          this.version(o, p.expectedVersion);
          ensure(
            o.state === 'RESERVED',
            'INVALID_STATE',
            'Only unsettled obligations can be paused.',
          );
          r = this.s.save({ ...o, paused: p.paused });
          break;
        }
        case 'payroll.claim': {
          const o = this.ownObligation(a, p.id);
          ensure(o.dueAt <= now(), 'NOT_DUE', 'This salary has not reached its due date.');
          r = this.creditSalary(o, true);
          tenant = o.tenant;
          break;
        }
        case 'payroll.adjust': {
          this.company(a, tenant, true, true);
          const o = this.tenantEntity(tenant, p.id, 'obligation');
          this.version(o, p.expectedVersion);
          ensure(
            o.state === 'RESERVED' && o.dueAt > now() && amount(o.earlyGross || '0') === 0n,
            'INVALID_STATE',
            'Only unearned future obligations can be adjusted.',
          );
          const newAmount =
            p.kind === 'bonus' ? add(o.amount, p.amount) : subtract(o.amount, p.amount);
          ensure(
            amount(newAmount) >= amount(o.earned || '0'),
            'EARNED_PROTECTED',
            'A deduction cannot reduce confirmed earned salary.',
          );
          this.s.transfer(
            'demoUSD',
            tenant,
            'adjust:' + key,
            'ADJUSTMENT',
            p.reason,
            acct(tenant, p.kind === 'bonus' ? 'cash' : 'payroll'),
            acct(tenant, p.kind === 'bonus' ? 'payroll' : 'cash'),
            p.amount,
          );
          r = this.s.save({
            ...o,
            amount: newAmount,
            adjustments: [
              ...o.adjustments,
              { kind: p.kind, amount: p.amount, reason: p.reason, at: now() },
            ],
          });
          break;
        }
        case 'salary.confirm-earned': {
          this.company(a, tenant, true, true);
          const o = this.tenantEntity(tenant, p.id, 'obligation');
          this.version(o, p.expectedVersion);
          ensure(
            o.state === 'RESERVED' &&
              amount(p.amount) <= amount(o.amount) &&
              amount(p.amount) >= amount(o.earned || '0'),
            'INVALID_EARNED',
            'Confirmed earned salary must increase within the reserved obligation.',
          );
          r = this.s.save({ ...o, earned: p.amount });
          break;
        }
        case 'goal.save': {
          const e = this.employee(a);
          tenant = e.tenant;
          const old = p.id ? this.own(a, p.id, 'goal') : undefined;
          if (old) this.version(old, p.expectedVersion);
          ensure(amount(p.target) > 0n, 'INVALID_TARGET', 'Goal target must be positive.');
          ensure(
            p.contributionMode !== 'PERCENT' || amount(p.contributionValue) <= 10000n,
            'INVALID_PERCENT',
            'A goal percentage must be between 0 and 100%.',
          );
          ensure(
            !old || old.target === p.target || p.confirmChanges,
            'CONFIRM_REQUIRED',
            'Confirm the revised target in the decision form.',
          );
          const nextState = p.state || old?.state || 'ACTIVE';
          ensure(
            !old ||
              !['COMPLETED', 'RELEASED', 'ARCHIVED', 'DRAFT'].includes(old.state) ||
              nextState !== 'ACTIVE' ||
              p.confirmChanges,
            'REACTIVATION_REQUIRED',
            'Explicitly confirm before activating this goal.',
          );
          ensure(
            nextState !== 'COMPLETED' || old?.state === 'COMPLETED',
            'INVALID_STATE',
            'Only a completed goal can keep completed status.',
          );
          const funded = old ? this.balance(a.id, 'goal:' + old.id) : '0';
          ensure(
            amount(p.target) >= amount(funded),
            'TARGET_BELOW_SAVINGS',
            'The target cannot be lower than reserved savings.',
          );
          ensure(
            old || this.s.list('goal', tenant, a.id).length < 10,
            'GOAL_LIMIT',
            'Use up to ten savings goals.',
          );
          r = this.s.save({
            type: 'goal',
            tenant,
            owner: a.id,
            ...p,
            funded,
            state: amount(funded) >= amount(p.target) ? 'COMPLETED' : nextState,
          });
          break;
        }
        case 'goal.pause': {
          const g = this.own(a, p.id, 'goal');
          this.version(g, p.expectedVersion);
          ensure(
            ['ACTIVE', 'PAUSED'].includes(g.state),
            'REACTIVATION_REQUIRED',
            'Edit the target and confirm a new goal before restarting.',
          );
          r = this.s.save({ ...g, state: p.paused ? 'PAUSED' : 'ACTIVE' });
          tenant = g.tenant;
          break;
        }
        case 'goal.release': {
          const g = this.own(a, p.id, 'goal');
          this.version(g, p.expectedVersion);
          const value = this.balance(a.id, 'goal:' + g.id);
          this.s.transfer(
            'demoUSD',
            g.tenant,
            'release:' + key,
            'RELEASE',
            'Savings goal released to cash',
            acct(a.id, 'goal:' + g.id),
            acct(a.id),
            value,
          );
          r = this.s.save({
            ...g,
            state:
              g.state === 'COMPLETED'
                ? 'COMPLETED'
                : g.state === 'ARCHIVED'
                  ? 'ARCHIVED'
                  : 'PAUSED',
            funded: '0',
          });
          tenant = g.tenant;
          break;
        }
        case 'allocation.release': {
          const b = this.own(a, p.id, 'allocation-budget');
          tenant = b.tenant;
          this.s.transfer(
            'demoUSD',
            tenant,
            'allocation-release:' + key,
            'RELEASE',
            'Unused conversion budget released to cash',
            acct(a.id, b.pocket),
            acct(a.id),
            this.balance(a.id, b.pocket),
          );
          r = this.s.save({ ...b, state: 'RELEASED' });
          break;
        }
        case 'destination.save': {
          const e = this.employee(a);
          tenant = e.tenant;
          const patterns: Record<string, RegExp> = {
            NEAR: /^([a-z0-9]+[-_])*[a-z0-9]+(?:\.[a-z0-9_-]+)*$/,
            Ethereum: /^0x[a-fA-F0-9]{40}$/,
            Base: /^0x[a-fA-F0-9]{40}$/,
            Solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
            Bitcoin: /^(bc1|tb1|[13mn2])[a-zA-Z0-9]{20,88}$/,
            Tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
          };
          ensure(
            patterns[p.network].test(p.address),
            'INVALID_ADDRESS',
            'Check the address format for this network.',
          );
          r = this.s.save({
            type: 'destination',
            tenant,
            owner: a.id,
            ...p,
            verification: 'UNVERIFIED',
            state: 'ACTIVE',
          });
          break;
        }
        case 'destination.archive': {
          const d = this.own(a, p.id, 'destination');
          this.version(d, p.expectedVersion);
          r = this.s.save({ ...d, state: 'ARCHIVED' });
          tenant = d.tenant;
          break;
        }
        case 'dca.save': {
          const e = this.employee(a);
          tenant = e.tenant;
          ensure(
            this.catalog()
              .list()
              .some((x) => x.id === p.asset),
            'UNSUPPORTED_ASSET',
            'Choose a supported scenario asset.',
          );
          ensure(amount(p.amount) > 0n, 'INVALID_AMOUNT', 'DCA amount must be positive.');
          const catalogAsset = this.catalog().resolve(p.asset);
          const route = this.catalog().route(a.id, catalogAsset, p);
          const old = p.id ? this.own(a, p.id, 'dca') : undefined;
          if (old) this.version(old, p.expectedVersion);
          ensure(
            !p.endAt || p.endAt > p.anchor,
            'INVALID_END',
            'The end date must follow the first purchase.',
          );
          r = this.s.save({
            type: 'dca',
            tenant,
            owner: a.id,
            ...p,
            assetId: catalogAsset.assetId,
            ...route,
            sourcePocket: 'dca',
            scheduleId:
              old && old.cadence === p.cadence && old.anchor === p.anchor
                ? old.scheduleId
                : randomUUID(),
            spent: old?.spent || '0',
            state: 'ACTIVE',
            nextDue: nextDue(p.cadence, p.anchor, new Date(Date.now() - 1).toISOString(), 'UTC'),
          });
          break;
        }
        case 'dca.pause': {
          const d = this.own(a, p.id, 'dca');
          this.version(d, p.expectedVersion);
          r = this.s.save({ ...d, state: p.paused ? 'PAUSED' : 'ACTIVE' });
          tenant = d.tenant;
          break;
        }
        case 'dca.fund': {
          const e = this.employee(a);
          tenant = e.tenant;
          ensure(amount(p.amount) > 0n, 'INVALID_AMOUNT', 'Enter an amount.');
          this.s.transfer(
            'demoUSD',
            tenant,
            'dca-fund:' + key,
            'RESERVE',
            'Fund DCA budget',
            acct(a.id),
            acct(a.id, 'dca'),
            p.amount,
          );
          break;
        }
        case 'dca.run': {
          const d = this.own(a, p.id, 'dca');
          ensure(d.state === 'ACTIVE', 'PLAN_PAUSED', 'Resume this plan first.');
          ensure(
            d.nextDue <= now(),
            'NOT_DUE',
            'This plan is not due. Extra buys use a separate investment order.',
          );
          r = this.runDca(d, now());
          tenant = d.tenant;
          break;
        }
        case 'money-plan.save': {
          const e = this.employee(a);
          tenant = e.tenant;
          const old = this.s.list('money-plan', tenant, a.id)[0];
          if (old) this.version(old, p.expectedVersion);
          r = this.s.save({ type: 'money-plan', tenant, owner: a.id, id: old?.id, ...p });
          break;
        }
        case 'hold.exit': {
          const h = this.own(a, p.id, 'hold');
          tenant = h.tenant;
          r = this.exitHold(h);
          break;
        }
        case 'admin.providers': {
          this.admin(a);
          const settings = this.s.get('settings')!;
          this.version(settings, p.expectedVersion);
          r = this.s.save({ ...settings, ...p });
          break;
        }
        case 'loan.plan': {
          const l = this.own(a, p.id, 'loan');
          this.version(l, p.expectedVersion);
          ensure(l.state === 'ACTIVE', 'INVALID_STATE', 'This loan is closed.');
          ensure(
            !p.enabled || p.consent,
            'CONSENT_REQUIRED',
            'Explicit consent is required before reserving salary.',
          );
          r = this.s.save({
            ...l,
            repaymentPlan: {
              amount: p.amount,
              maxSalaryBps: p.maxSalaryBps,
              enabled: p.enabled,
              consent: p.consent,
              cadence: 'PER_SALARY',
              consentedAt: now(),
            },
          });
          tenant = l.tenant;
          break;
        }
        case 'loan.reserve-release': {
          const l = this.own(a, p.id, 'loan');
          tenant = l.tenant;
          const pocket = 'repayment:' + l.id;
          const reserved = this.balance(a.id, pocket);
          this.s.transfer(
            'demoUSD',
            tenant,
            'repayment-release:' + key,
            'RELEASE',
            'Release repayment reserve, debt is unchanged',
            acct(a.id, pocket),
            acct(a.id),
            reserved,
          );
          r = { released: reserved };
          break;
        }
        case 'earn.open': {
          const e = this.employee(a);
          tenant = e.tenant;
          ensure(amount(p.amount) > 0n, 'INVALID_AMOUNT', 'Enter an amount.');
          const en = this.s.save({
            type: 'earn',
            tenant,
            owner: a.id,
            principal: p.amount,
            state: 'ACTIVE',
            aprBps: EARN_SCENARIOS[p.scenario as keyof typeof EARN_SCENARIOS].aprBps,
            scenario: p.scenario,
            seed: 'v1-' + p.scenario,
            startedAt: now(),
            source: 'numa educational scenario v1: ' + p.scenario + '; not a live APY',
          });
          this.s.transfer(
            'demoUSD',
            tenant,
            'earn:' + en.id,
            'RESERVE',
            'Simulated Earn principal',
            acct(a.id),
            acct(a.id, 'earn:' + en.id),
            p.amount,
          );
          r = en;
          break;
        }
        case 'earn.exit': {
          const e = this.own(a, p.id, 'earn');
          ensure(
            ['ACTIVE', 'EXIT_PENDING'].includes(e.state),
            'INVALID_STATE',
            'This Earn position is closed.',
          );
          const scenario = (e.scenario || 'BASE') as keyof typeof EARN_SCENARIOS;
          const details = EARN_SCENARIOS[scenario];
          ensure(scenario !== 'STALE', 'STALE_DATA', 'This scenario has stale exit data.');
          ensure(details.liquidity, 'ILLIQUID', 'No exit liquidity is available in this scenario.');
          if (details.delayHours && !e.exitAvailableAt) {
            r = this.s.save({
              ...e,
              state: 'EXIT_PENDING',
              exitAvailableAt: plus(details.delayHours * 3600000),
            });
            tenant = e.tenant;
            break;
          }
          ensure(
            !e.exitAvailableAt || e.exitAvailableAt <= now(),
            'EXIT_DELAYED',
            'The exit is still in its waiting period.',
          );
          tenant = e.tenant;
          const days = Math.max(
            0,
            Math.floor((Date.now() - new Date(e.startedAt).getTime()) / 86400000),
          );
          const outcome = earnOutcome(e.principal, scenario, days);
          const interest = outcome.interest;
          this.s.transfer(
            'demoUSD',
            tenant,
            'earn-loss:' + e.id,
            'SIMULATED_LOSS',
            'Hypothetical Earn principal loss',
            acct(a.id, 'earn:' + e.id),
            acct('scenario-loss'),
            outcome.loss,
          );
          this.s.transfer(
            'demoUSD',
            tenant,
            'earn-exit:' + e.id,
            'RELEASE',
            'Simulated Earn principal returned',
            acct(a.id, 'earn:' + e.id),
            acct(a.id),
            outcome.returned,
          );
          this.s.transfer(
            'demoUSD',
            tenant,
            'earn-yield:' + e.id,
            'SIMULATED_YIELD',
            'Hypothetical Earn return',
            acct('scenario-yield'),
            acct(a.id),
            interest,
            true,
          );
          r = this.s.save({
            ...e,
            state: 'CLOSED',
            interest,
            loss: outcome.loss,
            returned: outcome.returned,
          });
          break;
        }
        case 'loan.repay': {
          const l = this.own(a, p.id, 'loan');
          tenant = l.tenant;
          ensure(l.state === 'ACTIVE', 'INVALID_STATE', 'This loan is closed.');
          this.accrueLoan(l, now());
          const current = this.s.get(l.id)!;
          const debt = add(current.principal, current.interest);
          ensure(
            amount(p.amount) > 0n && amount(p.amount) <= amount(debt),
            'EXCESS_REPAYMENT',
            'Repayment must be within the outstanding debt.',
          );
          let left = amount(p.amount);
          const order = ['repayment:' + l.id, 'loan-funds', 'cash'];
          for (const pocket of order) {
            const b = this.s.balance(acct(a.id, pocket));
            const take = b < left ? b : left;
            if (take > 0n) {
              this.s.transfer(
                'demoUSD',
                tenant,
                'repay-reserve:' + key + ':' + pocket,
                'RESERVE',
                'Reserve repayment funds',
                acct(a.id, pocket),
                acct(a.id, 'repay:' + key),
                take.toString(),
              );
              left -= take;
            }
          }
          ensure(left === 0n, 'INSUFFICIENT_FUNDS', 'Not enough available cash to repay.');
          const interestPaid =
            amount(current.interest) < amount(p.amount)
              ? amount(current.interest)
              : amount(p.amount);
          const principalPaid = amount(p.amount) - interestPaid;
          this.s.transfer(
            'demoUSD',
            tenant,
            'repay-interest:' + key,
            'INTEREST',
            'Loan interest expense',
            acct(a.id, 'repay:' + key),
            acct('scenario-interest'),
            interestPaid.toString(),
          );
          this.s.transfer(
            'demoUSD',
            tenant,
            'repay-principal:' + key,
            'REPAYMENT',
            'Principal repayment, not expense',
            acct(a.id, 'repay:' + key),
            acct(a.id, 'loan-liability:' + l.id),
            principalPaid.toString(),
          );
          const principal = subtract(current.principal, principalPaid.toString()),
            interest = subtract(current.interest, interestPaid.toString());
          const closed = principal === '0' && interest === '0';
          if (closed)
            this.s.transfer(
              'demoUSD',
              tenant,
              'collateral-release:' + l.id,
              'RELEASE',
              'Collateral released after repayment',
              acct(a.id, 'collateral:' + l.id),
              acct(a.id),
              l.collateral,
            );
          if (closed) {
            const pocket = 'repayment:' + l.id;
            this.s.transfer(
              'demoUSD',
              tenant,
              'repayment-close:' + l.id,
              'RELEASE',
              'Unused repayment reserve returned',
              acct(a.id, pocket),
              acct(a.id),
              this.balance(a.id, pocket),
            );
          }
          r = this.s.save({ ...current, principal, interest, state: closed ? 'CLOSED' : 'ACTIVE' });
          break;
        }
        case 'loan.spend': {
          const e = this.employee(a);
          tenant = e.tenant;
          ensure(amount(p.amount) > 0n, 'INVALID_AMOUNT', 'Enter an amount.');
          this.s.transfer(
            'demoUSD',
            tenant,
            'loan-spend:' + key,
            'LIVING_EXPENSE',
            p.description,
            acct(a.id, 'loan-funds'),
            acct(a.id, 'external-living-expenses'),
            p.amount,
          );
          r = this.s.save({
            type: 'living-expense',
            owner: a.id,
            tenant,
            amount: p.amount,
            description: p.description,
            source: 'Borrowed cash',
            mode: 'SIMULATION',
          });
          break;
        }
        case 'employee.withdraw': {
          const e = this.employee(a);
          tenant = e.tenant;
          ensure(amount(p.amount) > 0n, 'INVALID_AMOUNT', 'Enter an amount.');
          this.s.transfer(
            'demoUSD',
            tenant,
            'demo-withdraw:' + key,
            'WITHDRAWAL',
            'Simulated withdrawal, no external transfer',
            acct(a.id),
            acct(a.id, 'external-wallet'),
            p.amount,
          );
          r = this.s.save({
            type: 'withdrawal',
            tenant,
            owner: a.id,
            amount: p.amount,
            state: 'SIMULATED',
            mode: 'SIMULATION',
          });
          break;
        }
        case 'notification.read': {
          const n = this.own(a, p.id, 'notification');
          r = this.s.save({ ...n, read: true });
          tenant = n.tenant;
          break;
        }
        case 'admin.company-status': {
          this.admin(a);
          const c = this.s.get(p.id);
          ensure(c?.type === 'company', 'NOT_FOUND', 'Company not found.', 404);
          this.version(c, p.expectedVersion);
          r = this.s.save({ ...c, status: p.status });
          tenant = c.id;
          break;
        }
        case 'admin.runtime': {
          this.admin(a);
          const old = this.s.get('settings')!;
          this.version(old, p.expectedVersion);
          r = this.s.save({
            ...old,
            pauseDemoWorker: p.pauseDemoWorker,
            pauseTestnetWorker: p.pauseTestnetWorker,
          });
          break;
        }
        case 'admin.settings': {
          this.admin(a);
          const old = this.s.get('settings')!;
          this.version(old, p.expectedVersion);
          r = this.s.save({ ...old, ...p });
          break;
        }
        case 'admin.reconcile': {
          this.admin(a);
          const job = this.s.db.prepare('SELECT id,status FROM outbox WHERE id=?').get(p.id) as any;
          ensure(job, 'NOT_FOUND', 'Job not found.', 404);
          ensure(
            job.status === 'RECONCILIATION_REQUIRED' || job.status === 'FAILED',
            'INVALID_STATE',
            'Only failed or unknown jobs need reconciliation.',
          );
          this.s.db
            .prepare('UPDATE outbox SET status=?,available_at=? WHERE id=?')
            .run('PENDING', now(), p.id);
          r = { queued: true };
          break;
        }
        case 'assistant.message':
          r = this.assistant(a, p.scope, p.message, companyId);
          break;
      }
      this.s.audit(a.id, tenant, action, r?.id || key, { mode: a.mode });
      this.s.db
        .prepare('INSERT INTO requests VALUES(?,?,?,?)')
        .run(key, a.id, inputHash, JSON.stringify(r));
      return r;
    });
  }
  creditSalary(o: Entity, manual = false): Entity {
    if (!this.s.db.isTransaction) return this.s.atomic(() => this.creditSalary(o, manual));
    if (o.state === 'CREDITED') return o;
    ensure(o.state === 'RESERVED' && o.dueAt <= now(), 'NOT_DUE', 'This salary is not due.');
    ensure(manual || !o.paused, 'PAUSED', 'Automatic execution is paused.');
    const c = this.s.get(o.tenant)!;
    ensure(manual || c.status === 'ACTIVE', 'PAUSED', 'Company automation is suspended.');
    let remaining = subtract(o.amount, o.earlyGross || '0');
    const key = 'salary:' + o.id;
    this.s.transfer(
      'demoUSD',
      o.tenant,
      key,
      'SALARY',
      'Credited to Salary Vault',
      acct(o.tenant, 'payroll'),
      acct(o.owner),
      remaining,
    );
    const policy = this.s.list('policy', o.tenant, o.owner)[0];
    const loan = this.s
      .list('loan', o.tenant, o.owner)
      .find((l) => l.state === 'ACTIVE' && l.repaymentPlan?.enabled && l.repaymentPlan?.consent);
    if (loan) {
      const plan = loan.repaymentPlan;
      const room =
        BigInt(remaining) > BigInt(policy?.cashFloor || '0')
          ? BigInt(remaining) - BigInt(policy?.cashFloor || '0')
          : 0n;
      const cap = BigInt(mulBps(remaining, plan.maxSalaryBps));
      const debt =
        BigInt(loan.principal) +
        BigInt(loan.interest) -
        BigInt(this.balance(o.owner, 'repayment:' + loan.id));
      const take = [BigInt(plan.amount), room, cap, debt > 0n ? debt : 0n].reduce((a, b) =>
        a < b ? a : b,
      );
      this.s.transfer(
        'demoUSD',
        o.tenant,
        key + ':repayment',
        'REPAYMENT_RESERVE',
        'Consented salary reserve; not a debt repayment',
        acct(o.owner),
        acct(o.owner, 'repayment:' + loan.id),
        take.toString(),
      );
      remaining = (BigInt(remaining) - take).toString();
    }
    if (policy && amount(remaining) > 0n) {
      const goals = this.s
        .list('goal', o.tenant, o.owner)
        .map((g) => ({ ...g, funded: this.balance(o.owner, 'goal:' + g.id) }));
      const result = allocate(remaining, policy.legs, policy.cashFloor, goals as any);
      const runKey = 'demoUSD|' + key;
      ensure(
        !this.s.list('allocation-run', o.tenant, o.owner).some((r) => r.eventKey === runKey),
        'DUPLICATE_ALLOCATION',
        'This salary was already allocated.',
      );
      for (const leg of result.shares) {
        if (leg.type === 'cash' || leg.type === 'goals' || leg.amount === '0') continue;
        const pocket =
          leg.type === 'earn'
            ? 'earn-budget'
            : leg.type === 'invest'
              ? 'auto-invest:' + policy.id + ':' + policy.version + ':' + leg.id
              : leg.type;
        this.s.transfer(
          'demoUSD',
          o.tenant,
          key + ':allocation:' + leg.id,
          'ALLOCATION',
          'Salary allocated to ' + leg.type,
          acct(o.owner),
          acct(o.owner, pocket),
          leg.amount,
        );
        if (leg.type === 'invest') {
          const budgetId = 'allocation-budget-' + hash(pocket).slice(0, 32);
          const asset = this.catalog()
            .list()
            .find((x) => x.id === (leg.asset || 'NEAR'));
          const budget = this.balance(o.owner, pocket);
          let state = 'AWAITING_MINIMUM';
          if (asset && amount(budget) >= 100n) {
            const notional = ((amount(budget) * 10000n) / 10025n).toString();
            const fee = mulBps(notional, 25);
            let routeQuote: any;
            try {
              routeQuote = this.catalog().quote(o.owner, asset, { ...leg, amount: notional });
            } catch {
              state = 'AWAITING_ROUTE';
            }
            const quantity = quantityFor(notional, asset);
            if (routeQuote && amount(quantity) > 0n) {
              this.trade(
                { id: o.owner, mode: 'DEMO' },
                o.tenant,
                {
                  asset: asset.id,
                  side: 'buy',
                  amount: notional,
                  fee,
                  net: add(notional, fee),
                  price: asset.price,
                  quantity,
                  ...routeQuote,
                },
                key + ':auto-invest:' + leg.id,
                pocket,
              );
              state = 'SIMULATED_FILLED';
            }
          }
          if (!asset) state = 'AWAITING_ROUTE';
          this.s.save({
            id: budgetId,
            type: 'allocation-budget',
            tenant: o.tenant,
            owner: o.owner,
            pocket,
            asset: leg.asset || 'NEAR',
            policyVersion: policy.version,
            state,
            destinationId: leg.destinationId || null,
          });
        }
      }
      for (const contribution of result.contributions) {
        const g = this.s.get(contribution.goalId)!;
        this.s.transfer(
          'demoUSD',
          o.tenant,
          key + ':goal:' + g.id,
          'GOAL',
          'Salary saved toward ' + g.name,
          acct(o.owner),
          acct(o.owner, 'goal:' + g.id),
          contribution.amount,
        );
        const funded = this.balance(o.owner, 'goal:' + g.id);
        this.s.save({
          ...g,
          funded,
          state: amount(funded) >= amount(g.target) ? 'COMPLETED' : g.state,
        });
      }
      this.s.save({
        type: 'allocation-run',
        tenant: o.tenant,
        owner: o.owner,
        eventKey: runKey,
        policyVersion: policy.version,
        result,
      });
    }
    this.notify(
      o.owner,
      o.tenant,
      'Salary credited',
      'Your salary is in the Salary Vault. Your saved allocation has been applied.',
    );
    return this.s.save({
      ...o,
      state: 'CREDITED',
      creditedAt: now(),
      settledAmount: o.amount,
      allocationPolicyVersion: policy?.version || null,
    });
  }
  runDca(d: Entity, at: string): Entity {
    if (!this.s.db.isTransaction) return this.s.atomic(() => this.runDca(d, at));
    let current = this.s.get(d.id) || d;
    // A restarted worker records each missed slot; it never collapses history or buys in arrears.
    let result: Entity | undefined;
    const skipBacklog = new Date(at).getTime() - new Date(current.nextDue).getTime() > 300000;
    for (
      let count = 0;
      count < 100 && current.state === 'ACTIVE' && current.nextDue <= at;
      count++
    ) {
      result = this.runDcaOccurrence(current, at, skipBacklog);
      const latest = this.s.get(d.id)!;
      if (latest.nextDue === current.nextDue) break;
      current = latest;
    }
    return result || current.lastOccurrence || current;
  }
  runDcaOccurrence(d: Entity, at: string, skipBacklog = false) {
    const occurrence = d.id + '|' + d.nextDue;
    const existing = this.s
      .list('dca-occurrence', d.tenant, d.owner)
      .find((o) => o.eventKey === occurrence);
    if (existing) {
      this.s.save({
        ...d,
        nextDue: nextDue(d.cadence, d.anchor, d.nextDue, 'UTC'),
        lastOccurrence: existing,
      });
      return existing;
    }
    const expired = new Date(at).getTime() - new Date(d.nextDue).getTime() > 300000;
    const asset = this.catalog()
      .list()
      .find((x) => x.id === d.asset)!;
    const fee = mulBps(d.amount, 25),
      net = add(d.amount, fee);
    let state = 'SIMULATED_FILLED',
      reason = '';
    if (d.endAt && d.nextDue > d.endAt) {
      state = 'COMPLETED';
      reason = 'The plan end date was reached.';
    } else if (d.maxTotal && amount(d.spent || '0') + amount(net) > amount(d.maxTotal)) {
      state = 'COMPLETED';
      reason = 'The plan spending cap was reached, including fees.';
    } else if ((d.maxFeeBps ?? 25) < 25) {
      state = 'SKIPPED';
      reason = 'The scenario fee exceeds your approved fee limit.';
    } else if (expired || skipBacklog) {
      state = 'SKIPPED';
      reason = 'Missed occurrence; catch-up buys are disabled.';
    } else if (amount(this.balance(d.owner, 'dca')) < amount(net)) {
      state = 'SKIPPED';
      reason = 'Insufficient prefunded DCA budget, including fees.';
    } else {
      try {
        const routeQuote = this.catalog().quote(d.owner, asset, d);
        this.trade(
          { id: d.owner, mode: 'DEMO' },
          d.tenant,
          {
            ...routeQuote,
            side: 'buy',
            amount: d.amount,
            fee,
            net,
            price: asset.price,
            quantity: quantityFor(d.amount, asset),
          },
          'dca:' + occurrence,
          'dca',
        );
      } catch (error: any) {
        state = 'SKIPPED';
        reason = error.code || 'QUOTE_UNAVAILABLE';
      }
    }
    const result = this.s.save({
      type: 'dca-occurrence',
      tenant: d.tenant,
      owner: d.owner,
      planId: d.id,
      eventKey: occurrence,
      state,
      reason,
      scheduledAt: d.nextDue,
    });
    this.s.save({
      ...d,
      state: state === 'COMPLETED' ? 'COMPLETED' : d.state,
      spent: state === 'SIMULATED_FILLED' ? add(d.spent || '0', net) : d.spent || '0',
      nextDue: nextDue(d.cadence, d.anchor, d.nextDue, 'UTC'),
      lastOccurrence: result,
    });
    return result;
  }
  exitHold(h: Entity) {
    ensure(h.state === 'ACTIVE', 'INVALID_STATE', 'This hold is already closed.');
    const mature = h.maturity <= now();
    this.s.transfer(
      'demoUSD',
      h.tenant,
      'hold-exit:' + h.id,
      'RELEASE',
      'Held salary principal returned',
      acct(h.owner, 'hold:' + h.id),
      acct(h.owner),
      h.principal,
    );
    this.s.transfer(
      'demoUSD',
      h.tenant,
      'hold-bonus-exit:' + h.id,
      mature ? 'BONUS' : 'FORFEIT',
      mature ? 'Employer-funded hold bonus earned' : 'Unearned bonus returned to employer',
      acct(h.owner, 'hold-bonus:' + h.id),
      mature ? acct(h.owner) : acct(h.tenant, 'bonus'),
      h.bonus,
    );
    return this.s.save({ ...h, state: mature ? 'MATURED' : 'EXITED_EARLY', releasedAt: now() });
  }
  accrueLoan(l: Entity, at: string) {
    const days = Math.floor(
      (new Date(at.slice(0, 10)).getTime() - new Date(l.lastAccrualDate).getTime()) / 86400000,
    );
    if (days <= 0 || l.state !== 'ACTIVE') return l;
    const numerator =
      amount(l.principal) * BigInt(l.aprBps) * BigInt(days) + BigInt(l.interestRemainder || '0');
    const interest = (numerator / 3650000n).toString();
    return this.s.save({
      ...l,
      interest: add(l.interest, interest),
      interestRemainder: (numerator % 3650000n).toString(),
      lastAccrualDate: at.slice(0, 10),
    });
  }
  assistant(a: Actor, scope: string, message: string, companyId?: string) {
    let response = '',
      proposal: any = null;
    const text = message.toLowerCase();
    if (scope === 'company') {
      const c = this.company(a, companyId || 'forma');
      const employees = this.s.list('employee', c.id).filter((e) => e.status === 'ACTIVE');
      const monthly = employees
        .filter((e) => e.cadence === 'monthly')
        .reduce((s, e) => s + amount(e.salary), 0n);
      const weekly = employees
        .filter((e) => e.cadence === 'weekly')
        .reduce((s, e) => s + amount(e.salary), 0n);
      const daily = employees
        .filter((e) => e.cadence === 'daily')
        .reduce((s, e) => s + amount(e.salary), 0n);
      const cost = monthly + (weekly * 52n) / 12n + daily * 30n;
      const runway = cost === 0n ? null : Number((amount(this.balance(c.id)) * 10n) / cost) / 10;
      const match = text.match(/(raise|increase|decrease|reduce).*?(\d+(?:\.\d{1,2})?)\s*%/);
      const role = this.s.list('role', c.id).find((r) => text.includes(r.name.toLowerCase()));
      if (match && (role || /\b(all|everyone|every employee|entire team)\b/.test(text))) {
        proposal = {
          action: 'preview.create',
          companyId: c.id,
          payload: {
            kind: 'salary-change',
            input: {
              selection: role ? 'role' : 'all',
              ...(role ? { roleId: role.id } : {}),
              kind: 'percent',
              delta: String(Math.round(Number(match[2]) * 100)),
              direction: ['reduce', 'decrease'].includes(match[1]) ? 'decrease' : 'increase',
              effectiveFrom: now(),
            },
          },
        };
        response =
          'I can prepare a ' +
          match[2] +
          '% salary change for ' +
          (role ? role.name : 'all active employees') +
          '. Open the decision preview to inspect every amount before applying.';
      } else
        response =
          'There are ' +
          employees.length +
          ' active employees. Estimated monthly payroll is ' +
          (Number(cost) / 100).toLocaleString('en-US') +
          ' demoUSD, using 52/12 weeks and 30 days for planning only. Free treasury covers about ' +
          (runway ?? 'an undefined number of') +
          ' months. Authorizations use exact calendar dates and full prefunding. I can prepare a salary change, for example: “Increase Design salaries by 5%”.';
    } else {
      const e = this.employee(a);
      const cash = this.balance(a.id);
      const plan = this.s.list('money-plan', e.tenant, a.id)[0];
      const months =
        plan && amount(plan.expenses) > 0n
          ? Number((amount(cash) * 10n) / amount(plan.expenses)) / 10
          : 0;
      response =
        'Your available salary cash is ' +
        (Number(cash) / 100).toLocaleString('en-US') +
        ' demoUSD. That covers about ' +
        months +
        ' months of your entered expenses. Goals and held salary are reserved separately. DCA buys need a prefunded budget. Borrowing adds an equal liability, so it does not increase net worth. For a decision, use the preview in Allocation, Investments or Borrowing.';
      const dollars = (value: string) => {
        const [w, f = ''] = value.split('.');
        return (BigInt(w) * 100n + BigInt(f.padEnd(2, '0'))).toString();
      };
      const allocationMatch = text.match(/(?:save|allocate)\s+(\d+(?:\.\d{1,2})?)\s*%.*?goal/);
      const goalMatch = message.match(
        /create\s+(?:a\s+)?goal\s+(.{1,80}?)\s+(?:target|for)\s+(\d+(?:\.\d{1,2})?)/i,
      );
      const dcaMatch = message.match(
        /dca\s+(\d+(?:\.\d{1,2})?)\s*(?:demousd)?\s+(?:in|into|of)\s+([a-z0-9]+)\s+(daily|weekly|monthly)/i,
      );
      if (allocationMatch && Number(allocationMatch[1]) <= 100) {
        const policy = this.s.list('policy', e.tenant, a.id)[0],
          bps = Math.round(Number(allocationMatch[1]) * 100);
        proposal = {
          action: 'preview.create',
          payload: {
            kind: 'allocation',
            input: {
              legs: [
                { id: 'cash', type: 'cash', bps: 10000 - bps },
                { id: 'goals', type: 'goals', bps },
              ],
              cashFloor: policy?.cashFloor || '0',
              salary: e.salary,
              expectedVersion: policy?.version || 0,
              horizonDays: 90,
            },
          },
        };
        response =
          'I prepared a salary allocation with ' +
          allocationMatch[1] +
          '% for your goals. The decision preview shows the cash floor and goal overflow before you confirm.';
      } else if (goalMatch) {
        proposal = {
          action: 'goal.save',
          payload: {
            name: goalMatch[1].trim(),
            target: dollars(goalMatch[2]),
            priority: Math.min(10, this.s.list('goal', e.tenant, a.id).length + 1),
            contributionMode: 'PERCENT',
            contributionValue: '10000',
            percentBasis: 'GOAL_BUDGET',
            overflow: 'CASH',
            state: 'DRAFT',
            confirmChanges: true,
          },
        };
        response =
          'I prepared a draft goal. Review its target and contribution rule. Saving the draft reserves no money.';
      } else if (dcaMatch) {
        const asset = this.catalog()
          .list()
          .find((v) => v.id === dcaMatch[2].toUpperCase());
        if (asset) {
          proposal = {
            action: 'dca.save',
            payload: {
              name: asset.id + ' steady plan',
              asset: asset.id,
              amount: dollars(dcaMatch[1]),
              cadence: dcaMatch[3].toLowerCase(),
              anchor: new Date(Date.now() + 86400000).toISOString(),
              maxFeeBps: 25,
            },
          };
          response =
            'I prepared a simulated ' +
            dcaMatch[3].toLowerCase() +
            ' DCA plan for ' +
            dcaMatch[1] +
            ' demoUSD in ' +
            asset.id +
            '. It requires a separate prefunded budget; missed or unaffordable occurrences are skipped.';
        }
      }
    }
    return {
      message: response,
      proposal,
      engine: 'Deterministic local assistant',
      model: 'No external API',
      authority: 'Read and prepare proposals only',
      requiresHumanConfirmation: !!proposal,
    };
  }
  exportCsv(a: Actor, scope: string, companyId?: string) {
    const state = this.state(a, scope, companyId) as any;
    ensure(scope !== 'admin', 'FORBIDDEN', 'Choose a financial workspace.', 403);
    const rows = [
      ['Date', 'Book', 'Type', 'Description', 'Account', 'Debit atomic', 'Credit atomic'],
    ];
    for (const e of state.ledger)
      for (const l of e.lines)
        rows.push([
          e.created_at,
          e.book,
          e.kind,
          e.description,
          l.account,
          l.side === 'DEBIT' ? l.amount : '0',
          l.side === 'CREDIT' ? l.amount : '0',
        ]);
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }
}
