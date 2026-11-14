import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store, acct } from '../packages/db/src/index.js';
import { Service, type Actor } from '../apps/api/src/service.js';
import { seed } from '../apps/api/src/seed.js';
import { tick } from '../apps/worker/src/worker.js';
let s: Store, v: Service, file: string;
const owner: Actor = { id: 'owner', mode: 'DEMO' },
  maya: Actor = { id: 'maya', mode: 'DEMO' },
  accountant: Actor = { id: 'accountant', mode: 'DEMO' },
  observer: Actor = { id: 'observer', mode: 'DEMO' };
const c = (a: Actor, action: any, payload: any = {}, tenant = 'forma', key = randomUUID()) =>
  v.command(a, action, payload, tenant, key);
const prepare = (accelerated = true) =>
  c(owner, 'preview.create', { kind: 'payroll', input: { accelerated, days: 30 } });
const apply = (a: Actor, p: any) => c(a, 'preview.apply', { previewId: p.id });
function dueAll() {
  for (const o of s.list('obligation')) {
    s.save({ ...o, dueAt: new Date(Date.now() - 1000).toISOString() });
  }
  s.db.prepare('UPDATE outbox SET available_at=?').run(new Date(Date.now() - 1000).toISOString());
}
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'noma-unit-')), 'test.sqlite');
  s = new Store(file);
  seed(s);
  v = new Service(s);
});
afterEach(() => s.close());
describe('authority and tenant boundaries', () => {
  it('isolates company tenants', () =>
    expect(() => v.state(owner, 'company', 'orbit')).toThrow('outside your workspace'));
  it('blocks accountants from authorizing payroll', () => {
    const p = prepare();
    s.save({ ...p, owner: 'accountant' });
    expect(() => apply(accountant, s.get(p.id))).toThrow('Only the company owner');
  });
  it('blocks observers from mutations', () =>
    expect(() =>
      c(observer, 'role.save', { name: 'Bad', salary: '100', cadence: 'daily' }),
    ).toThrow('read-only'));
  it('blocks employees from other employee goals', () =>
    expect(() =>
      c({ id: 'noah', mode: 'DEMO' }, 'goal.release', { id: 'goal-reserve', expectedVersion: 2 }),
    ).toThrow('not found'));
  it('blocks the site admin from company financial authority', () =>
    expect(() =>
      c({ id: 'admin', mode: 'DEMO' }, 'treasury.fund', { amount: '1', purpose: 'cash' }),
    ).toThrow('outside your workspace'));
  it('keeps testnet actors out of simulation writes', () =>
    expect(() => c({ id: 'maya', mode: 'TESTNET' }, 'employee.withdraw', { amount: '1' })).toThrow(
      'demo workspace',
    ));
  it('prevents unknown fields from altering financial status', () =>
    expect(() =>
      c(owner, 'treasury.fund', { amount: '1', purpose: 'cash', status: 'SUCCESS' }),
    ).toThrow());
});
describe('payroll invariants and recovery', () => {
  it('requires complete prefunding', () => {
    s.atomic(() =>
      s.transfer(
        'demoUSD',
        'forma',
        'empty',
        'TEST',
        'Test fixture',
        acct('forma'),
        acct('external'),
        v.balance('forma'),
      ),
    );
    expect(() => prepare()).toThrow('Fund the entire');
  });
  it('previews without making journal entries', () => {
    const n = s.ledger('forma').length;
    prepare();
    expect(s.ledger('forma')).toHaveLength(n);
    expect(s.list('obligation')).toHaveLength(0);
  });
  it('reserves the full window and credits each obligation exactly once', () => {
    const p = prepare();
    apply(owner, p);
    const n = s.list('obligation').length;
    expect(BigInt(v.balance('forma', 'payroll'))).toBe(BigInt(p.effects.total));
    dueAll();
    tick(s, 'worker-a');
    const cash = v.balance('maya');
    tick(s, 'worker-b');
    expect(v.balance('maya')).toBe(cash);
    expect(s.list('obligation').filter((o) => o.state === 'CREDITED')).toHaveLength(n);
    expect(v.balance('forma', 'payroll')).toBe('0');
  });
  it('retains stable IDs when an authorization is prepared twice', () => {
    apply(owner, prepare());
    expect(() => prepare()).toThrow('already authorized');
  });
  it('allows employee claims when automatic execution is paused', () => {
    apply(owner, prepare());
    dueAll();
    const o = s.list('obligation').find((o) => o.owner === 'maya')!;
    s.save({ ...o, paused: true });
    tick(s, 'worker');
    expect(s.get(o.id)?.state).toBe('RESERVED');
    c(maya, 'payroll.claim', { id: o.id });
    expect(s.get(o.id)?.state).toBe('CREDITED');
  });
  it('keeps credited salary immutable when the agreement changes', () => {
    apply(owner, prepare());
    dueAll();
    tick(s, 'worker');
    const o = s.list('obligation').find((o) => o.owner === 'maya')!;
    const p = c(owner, 'preview.create', {
      kind: 'salary-change',
      input: {
        selection: 'all',
        kind: 'percent',
        delta: '1000',
        direction: 'increase',
        effectiveFrom: new Date().toISOString(),
      },
    });
    apply(owner, p);
    expect(s.get(o.id)?.amount).toBe(o.amount);
  });
  it('does not redistribute the same salary after the policy changes', () => {
    apply(owner, prepare());
    dueAll();
    tick(s, 'worker');
    const o = s.list('obligation').find((o) => o.owner === 'maya')!;
    const cash = v.balance('maya'),
      p = s.get('maya-policy')!;
    s.save({ ...p, legs: [{ id: 'cash', type: 'cash', bps: 10000 }] });
    v.creditSalary(o);
    expect(v.balance('maya')).toBe(cash);
    expect(s.list('allocation-run', 'forma', 'maya')).toHaveLength(1);
  });
  it('survives database reopen and recovers an expired worker lease', () => {
    apply(owner, prepare());
    dueAll();
    s.db
      .prepare("UPDATE outbox SET status='RUNNING',lease_until=?")
      .run('2000-01-01T00:00:00.000Z');
    s.close();
    s = new Store(file);
    v = new Service(s);
    tick(s, 'replacement-worker');
    expect(s.list('obligation').every((o) => o.state === 'CREDITED')).toBe(true);
  });
});
describe('decisions and accounting', () => {
  it('replays an identical idempotency key and rejects different input', () => {
    const key = randomUUID();
    const a = c(owner, 'treasury.fund', { amount: '100', purpose: 'cash' }, 'forma', key);
    const b = c(owner, 'treasury.fund', { amount: '100', purpose: 'cash' }, 'forma', key);
    expect(a).toEqual(b);
    expect(() =>
      c(owner, 'treasury.fund', { amount: '200', purpose: 'cash' }, 'forma', key),
    ).toThrow('different input');
  });
  it('rejects stale previews when a relevant balance changes', () => {
    const p = c(maya, 'preview.create', { kind: 'hold', input: { amount: '10000', days: 30 } });
    c(maya, 'employee.withdraw', { amount: '1' });
    expect(() => apply(maya, p)).toThrow('underlying data changed');
  });
  it('rejects reuse of a decision under a new request key', () => {
    const p = c(maya, 'preview.create', { kind: 'hold', input: { amount: '10000', days: 30 } });
    apply(maya, p);
    expect(() => apply(maya, p)).toThrow('already applied');
  });
  it('never lets locked goal funds be withdrawn', () => {
    expect(() => c(maya, 'employee.withdraw', { amount: '400000' })).toThrow('balance is too low');
    expect(v.balance('maya', 'goal:goal-reserve')).toBe('96000');
  });
  it('requires the whole hold bonus to be funded', () => {
    s.atomic(() =>
      s.transfer(
        'demoUSD',
        'forma',
        'empty-bonus',
        'TEST',
        'Fixture',
        acct('forma', 'bonus'),
        acct('external'),
        v.balance('forma', 'bonus'),
      ),
    );
    expect(() =>
      c(maya, 'preview.create', { kind: 'hold', input: { amount: '100000', days: 30 } }),
    ).toThrow('fund the full bonus');
  });
  it('returns principal and forfeits only the unearned bonus on early hold exit', () => {
    const cash = v.balance('maya'),
      bonus = v.balance('forma', 'bonus');
    const r = apply(
      maya,
      c(maya, 'preview.create', { kind: 'hold', input: { amount: '10000', days: 30 } }),
    );
    expect(v.balance('maya')).toBe((BigInt(cash) - 10000n).toString());
    c(maya, 'hold.exit', { id: r.result.id });
    expect(v.balance('maya')).toBe(cash);
    expect(v.balance('forma', 'bonus')).toBe(bonus);
  });
  it('keeps a collateral loan net-worth neutral before interest', () => {
    const before = BigInt(v.balance('maya'));
    const r = apply(
      maya,
      c(maya, 'preview.create', {
        kind: 'loan',
        input: { collateral: '100000', principal: '40000' },
      }),
    );
    expect(
      BigInt(v.balance('maya')) +
        BigInt(v.balance('maya', 'loan-funds')) +
        BigInt(v.balance('maya', 'collateral:' + r.result.id)) -
        BigInt(r.result.principal),
    ).toBe(before);
    expect(s.ledger('forma').filter((e) => e.kind === 'SALARY')).toHaveLength(1);
  });
  it('repays debt and unlocks collateral without recording new income', () => {
    const r = apply(
      maya,
      c(maya, 'preview.create', {
        kind: 'loan',
        input: { collateral: '100000', principal: '40000' },
      }),
    );
    c(maya, 'loan.repay', { id: r.result.id, amount: '40000' });
    expect(s.get(r.result.id)?.state).toBe('CLOSED');
    expect(v.balance('maya', 'collateral:' + r.result.id)).toBe('0');
  });
  it('accrues simple loan interest only once for the same date', () => {
    const r = apply(
      maya,
      c(maya, 'preview.create', {
        kind: 'loan',
        input: { collateral: '100000', principal: '40000' },
      }),
    );
    const at = new Date(Date.now() + 86400000 * 30).toISOString();
    v.accrueLoan(r.result, at);
    const first = s.get(r.result.id)!;
    v.accrueLoan(first, at);
    expect(s.get(r.result.id)?.interest).toBe(first.interest);
  });
  it('handles nominal early pay, fee and final salary without duplication', () => {
    apply(owner, prepare());
    const o = s.list('obligation').find((o) => o.owner === 'maya')!;
    c(owner, 'salary.confirm-earned', { id: o.id, amount: '100000', expectedVersion: o.version });
    const before = BigInt(v.balance('maya'));
    const r = apply(
      maya,
      c(maya, 'preview.create', {
        kind: 'early-pay',
        input: { obligationId: o.id, gross: '40000' },
      }),
    );
    expect(BigInt(v.balance('maya')) - before).toBe(39600n);
    expect(s.get(o.id)?.earlyGross).toBe('40000');
    dueAll();
    tick(s, 'worker');
    expect(s.get(o.id)?.settledAmount).toBe(o.amount);
  });
  it('fills a budgeted DCA occurrence once and skips missed occurrences', () => {
    const p = c(maya, 'dca.save', {
      name: 'NEAR habit',
      asset: 'NEAR',
      amount: '1000',
      cadence: 'daily',
      anchor: new Date(Date.now() - 60000).toISOString(),
    });
    s.save({ ...p, nextDue: new Date(Date.now() - 1000).toISOString() });
    const updated = s.get(p.id)!;
    v.runDca(updated, new Date().toISOString());
    v.runDca(updated, new Date().toISOString());
    expect(s.list('order', 'forma', 'maya')).toHaveLength(1);
    const next = s.get(p.id)!;
    s.save({ ...next, nextDue: new Date(Date.now() - 3600000).toISOString() });
    const skipped = v.runDca(s.get(p.id)!, new Date().toISOString());
    expect(skipped.state).toBe('SKIPPED');
    expect(s.list('order', 'forma', 'maya')).toHaveLength(1);
  });
  it('balances every journal entry and blocks journal edits', () => {
    for (const e of s.ledger()) {
      const sum = e.lines.reduce(
        (n: bigint, l: any) => n + (l.side === 'DEBIT' ? 1n : -1n) * BigInt(l.amount),
        0n,
      );
      expect(sum).toBe(0n);
    }
    expect(() => s.db.exec("UPDATE ledger_lines SET amount='0'")).toThrow('immutable');
  });
  it('rolls back a failed financial operation completely', () => {
    const before = s.ledger().length;
    expect(() => c(maya, 'earn.open', { amount: '999999999' })).toThrow();
    expect(s.ledger()).toHaveLength(before);
    expect(s.list('earn')).toHaveLength(0);
  });
  it('validates CSV duplicates and row errors before committing', () => {
    const r = c(owner, 'import.preview', {
      csv: 'name,email,role,salary,cadence\nA,bad,Missing,0,monthly\nB,bad,Design,100,monthly',
    });
    expect(r.rows[0].errors.length).toBeGreaterThan(0);
    expect(() => c(owner, 'import.commit', { previewId: r.id })).toThrow('Correct all row errors');
  });
  it('keeps the assistant unable to mutate salaries directly', () => {
    const before = s.get('emp-maya')!.salary;
    const r = c(owner, 'assistant.message', {
      scope: 'company',
      message: 'Increase Design salaries by 5%',
    });
    expect(r.proposal.action).toBe('preview.create');
    expect(s.get('emp-maya')!.salary).toBe(before);
  });
});

describe('final workflow completion', () => {
  it('revises unearned future obligations with stable IDs and matching treasury reservations', () => {
    apply(owner, prepare(false));
    const before = s.list('obligation');
    const oldReserve = BigInt(v.balance('forma', 'payroll'));
    const p = c(owner, 'preview.create', {
      kind: 'salary-change',
      input: {
        selection: 'role',
        roleId: 'design',
        kind: 'percent',
        delta: '500',
        direction: 'increase',
        effectiveFrom: new Date().toISOString(),
      },
    });
    apply(owner, p);
    expect(
      s
        .list('obligation')
        .map((o) => o.id)
        .sort(),
    ).toEqual(before.map((o) => o.id).sort());
    expect(BigInt(v.balance('forma', 'payroll'))).toBe(oldReserve + BigInt(p.details.reserveDelta));
    for (const r of p.details.revisions) expect(s.get(r.id)?.amount).toBe(r.after);
  });
  it('promotes a future salary agreement only when effective', () => {
    const e = s.get('emp-maya')!;
    s.save({
      ...e,
      pendingSalary: { salary: '500000', effectiveFrom: '2099-01-01T00:00:00.000Z' },
    });
    v.state(maya, 'employee');
    expect(s.get(e.id)?.salary).toBe(e.salary);
    v.promoteSalaries('2099-01-01T00:00:01.000Z');
    expect(s.get(e.id)?.salary).toBe('500000');
  });
  it('stops automatic execution during maintenance but preserves employee claims', () => {
    apply(owner, prepare());
    dueAll();
    s.save({ ...s.get('settings')!, maintenance: true });
    tick(s);
    expect(s.list('obligation').every((o) => o.state === 'RESERVED')).toBe(true);
    const o = s.list('obligation').find((o) => o.owner === 'maya')!;
    c(maya, 'payroll.claim', { id: o.id });
    expect(s.get(o.id)?.state).toBe('CREDITED');
  });
  it('records living expenses from borrowed cash without reducing the loan liability', () => {
    apply(
      maya,
      c(maya, 'preview.create', {
        kind: 'loan',
        input: { collateral: '100000', principal: '40000' },
      }),
    );
    const l = s.list('loan')[0];
    c(maya, 'loan.spend', { amount: '10000', description: 'Rent' });
    expect(v.balance('maya', 'loan-funds')).toBe('30000');
    expect(s.get(l.id)?.principal).toBe('40000');
    expect(() => c(maya, 'loan.spend', { amount: '40000', description: 'Excess rent' })).toThrow(
      'too low',
    );
  });
  it('accepts an invitation exactly once and enables the new employee workspace', () => {
    const r = c(owner, 'employee.invite', {
      name: 'New person',
      email: 'new@forma.example',
      roleId: 'design',
      salary: '100000',
      cadence: 'monthly',
      anchor: new Date(Date.now() + 86400000).toISOString(),
    });
    const token = (r.invitationUrl || r.url).split('/').pop();
    const actor: Actor = { id: 'new-employee', mode: 'DEMO' };
    c(actor, 'employee.accept', { token }, undefined as any);
    expect((v.state(actor, 'employee') as any).employee.status).toBe('ACTIVE');
    expect(() => c(actor, 'employee.accept', { token }, undefined as any)).toThrow('already used');
  });
});

describe('automatic salary investment allocation', () => {
  it('buys the specified assets only after salary credit and keeps total cash spending within the assigned shares', () => {
    const policy = s.get('maya-policy')!;
    s.save({
      ...policy,
      cashFloor: '0',
      legs: [
        { id: 'cash', type: 'cash', bps: 5000 },
        { id: 'bitcoin', type: 'invest', asset: 'BTC', bps: 3000 },
        { id: 'near', type: 'invest', asset: 'NEAR', bps: 2000 },
      ],
    });
    apply(owner, prepare());
    expect(s.list('position')).toHaveLength(0);
    dueAll();
    tick(s);
    const positions = s.list('position', 'forma', 'maya');
    expect(positions.map((p) => p.asset).sort()).toEqual(['BTC', 'NEAR']);
    const budgets = s.list('allocation-budget', 'forma', 'maya');
    expect(budgets).toHaveLength(2);
    expect(budgets.every((b) => BigInt(v.balance('maya', b.pocket)) <= 1n)).toBe(true);
  });
  it('keeps small conversion amounts reserved and lets their owner release them explicitly', () => {
    const policy = s.get('maya-policy')!;
    s.save({
      ...policy,
      cashFloor: '0',
      legs: [
        { id: 'cash', type: 'cash', bps: 9999 },
        { id: 'near', type: 'invest', asset: 'NEAR', bps: 1 },
      ],
    });
    apply(owner, prepare());
    dueAll();
    tick(s);
    const b = s.list('allocation-budget', 'forma', 'maya')[0];
    expect(b.state).toBe('AWAITING_MINIMUM');
    expect(s.list('position', 'forma', 'maya')).toHaveLength(0);
    c(maya, 'allocation.release', { id: b.id });
    expect(v.balance('maya', b.pocket)).toBe('0');
  });
});

describe('DCA and interest limits', () => {
  it('stops purchases at the fee-inclusive spending cap', () => {
    const plan = c(maya, 'dca.save', {
      name: 'Capped plan',
      asset: 'NEAR',
      amount: '1000',
      cadence: 'daily',
      anchor: new Date(Date.now() + 60000).toISOString(),
      maxTotal: '500',
      maxFeeBps: 25,
    });
    const due = { ...plan, nextDue: new Date().toISOString() };
    s.save(due);
    const result = v.runDca(due, new Date().toISOString());
    expect(result.state).toBe('COMPLETED');
    expect(s.get(plan.id)?.state).toBe('COMPLETED');
    expect(s.list('order', 'forma', 'maya')).toHaveLength(0);
  });
  it('keeps daily rounding fractions so accrual equals a single interval', () => {
    apply(
      maya,
      c(maya, 'preview.create', {
        kind: 'loan',
        input: { collateral: '100000', principal: '33333' },
      }),
    );
    const loan = s.list('loan')[0];
    const base = new Date('2030-01-01T00:00:00.000Z');
    s.save({ ...loan, lastAccrualDate: '2030-01-01' });
    for (let day = 1; day <= 30; day++)
      v.accrueLoan(s.get(loan.id)!, new Date(base.getTime() + day * 86400000).toISOString());
    expect(s.get(loan.id)?.interest).toBe(((33333n * 800n * 30n) / 3650000n).toString());
  });
});

describe('personal access after employment ends', () => {
  it('retains assets, history and withdrawal rights after termination and suspension', () => {
    const before = v.state(maya, 'employee') as any;
    const employee = before.employee;
    c(owner, 'employee.status', {
      id: employee.id,
      status: 'ENDED',
      expectedVersion: employee.version,
    });
    s.save({ ...s.get('forma')!, status: 'SUSPENDED' });
    for (const m of s.list('membership', 'forma', 'maya')) s.save({ ...m, status: 'REVOKED' });
    const after = v.state(maya, 'employee') as any;
    expect(after.balances.cash).toBe(before.balances.cash);
    expect(after.ledger).toEqual(before.ledger);
    c(maya, 'employee.withdraw', { amount: '100' });
    expect(v.balance('maya')).toBe((BigInt(before.balances.cash) - 100n).toString());
  });
  it('does not grant personal access to an account with no employment', () => {
    expect(() => v.state({ id: 'new-employee', mode: 'DEMO' }, 'employee')).toThrow(
      'employee workspace',
    );
  });
});

describe('explicit savings rules and operator automation', () => {
  it('requires explicit consent to change a target or reactivate an archived goal', () => {
    const g = c(maya, 'goal.save', {
      name: 'Workshop',
      target: '60000',
      priority: 1,
      state: 'DRAFT',
      contributionMode: 'FIXED',
      contributionValue: '20000',
      percentBasis: 'SALARY',
      overflow: 'CASH',
      targetDate: '2027-03-01',
    });
    expect(g.state).toBe('DRAFT');
    expect(() =>
      c(maya, 'goal.save', {
        ...{ id: g.id, name: g.name, target: '70000', priority: 1, expectedVersion: g.version },
        state: 'ACTIVE',
      }),
    ).toThrow('Confirm the revised target');
    const active = c(maya, 'goal.save', {
      id: g.id,
      name: g.name,
      target: g.target,
      priority: 1,
      expectedVersion: g.version,
      state: 'ACTIVE',
      confirmChanges: true,
    });
    const archived = c(maya, 'goal.save', {
      id: g.id,
      name: g.name,
      target: g.target,
      priority: 1,
      expectedVersion: active.version,
      state: 'ARCHIVED',
    });
    expect(() =>
      c(maya, 'goal.pause', { id: g.id, paused: false, expectedVersion: archived.version }),
    ).toThrow('confirm a new goal');
    expect(() =>
      c(maya, 'goal.save', {
        id: g.id,
        name: g.name,
        target: g.target,
        priority: 1,
        expectedVersion: archived.version,
        state: 'ACTIVE',
      }),
    ).toThrow('Explicitly confirm');
  });
  it('can pause simulation execution without changing the independent testnet control', () => {
    const admin: Actor = { id: 'admin', mode: 'DEMO' };
    const settings = s.get('settings')!;
    expect(() =>
      c(owner, 'admin.runtime', {
        pauseDemoWorker: true,
        pauseTestnetWorker: false,
        expectedVersion: settings.version,
      }),
    ).toThrow();
    c(admin, 'admin.runtime', {
      pauseDemoWorker: true,
      pauseTestnetWorker: false,
      expectedVersion: settings.version,
    });
    tick(s);
    expect(s.get('worker-heartbeat')?.state).toBe('PAUSED');
    expect(s.get('settings')?.pauseTestnetWorker).toBe(false);
    const state: any = v.state(admin, 'admin');
    expect(state.testnet).toHaveProperty('rpcHost');
    expect(JSON.stringify(state.testnet)).not.toMatch(/secretKey|privateKey/);
  });
});
