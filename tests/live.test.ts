import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../packages/db/src/index.js';
import { LiveService } from '../apps/api/src/live.js';
import { seed } from '../apps/api/src/seed.js';
import { reconcileChain } from '../packages/near-adapter/src/reconcile.js';
vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  assertTestnet: vi.fn(async () => {}),
  operationAnchor: vi.fn(async () => ({ minimumBlockHeight: 100, preparedBlockHash: 'anchor' })),
  view: vi.fn(),
  confirmOperation: vi.fn(async () => ({
    state: 'CONFIRMED',
    txHash: 'x'.repeat(40),
    blockHash: 'b',
    logs: [],
  })),
}));
let s: Store, live: LiveService, query: any;
const owner = { id: 'wallet-owner', mode: 'TESTNET' as const },
  employee = { id: 'wallet-employee', mode: 'TESTNET' as const },
  stranger = { id: 'wallet-stranger', mode: 'TESTNET' as const };
const call = (a: any, action: string, payload: any = {}, companyId?: string, key = randomUUID()) =>
  live.command(a, action, payload, companyId, key);
beforeEach(() => {
  process.env.NEAR_CONTRACT_ID = 'vault.testnet';
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-live-')), 'db.sqlite'));
  seed(s);
  for (const [a, accountId] of [
    [owner, 'owner.testnet'],
    [employee, 'employee.testnet'],
    [stranger, 'stranger.testnet'],
  ] as const)
    s.save({ id: a.id, type: 'user', name: accountId, accountId, demo: false, role: 'user' });
  query = vi.fn(async (_c, method, args) => {
    if (method === 'get_company')
      return {
        owner: 'owner.testnet',
        free: '100000000000000000000000000',
        reserved: '0',
        version: 1,
      };
    if (method === 'get_account')
      return {
        cash: '1000000000000000000000000',
        policy: { goals: [], goal_bps: 0, cash_floor: '0', version: 0 },
      };
    return [];
  });
  live = new LiveService(s, query);
});
afterEach(() => {
  s.close();
  vi.unstubAllEnvs();
});
async function company() {
  return (await call(owner, 'company.create', { name: 'Fresh company', timezone: 'UTC' })).company;
}
async function employment() {
  const c = await company();
  const role = await call(
    owner,
    'role.save',
    { name: 'Engineering', salary: '1000000000000000000000', cadence: 'daily' },
    c.id,
  );
  const r = await call(
    owner,
    'employee.invite',
    {
      name: 'Employee',
      email: 'employee@example.org',
      accountId: 'employee.testnet',
      roleId: role.id,
      salary: role.salary,
      cadence: 'daily',
      anchor: new Date(Date.now() + 3600000).toISOString(),
    },
    c.id,
  );
  query.mockImplementation(async (_c: any, method: string) =>
    method === 'get_company'
      ? { owner: 'owner.testnet', free: '100000000000000000000000000', version: 1 }
      : method === 'list_company_employees'
        ? [{ employee_id: r.employee.chainId, account_id: 'employee.testnet', accepted: true }]
        : method === 'get_account'
          ? { cash: '100', policy: { goals: [], version: 0 } }
          : [],
  );
  return { c, role, ...r };
}
describe('integrated testnet product', () => {
  it('creates private company metadata and an opaque NEAR registration plan', async () => {
    const r = await call(owner, 'company.create', { name: 'Private name', timezone: 'UTC' });
    expect(r.company.unit).toBe('testNEAR');
    expect(JSON.stringify(r.plan.steps.map((s: any) => s.args))).not.toContain('Private name');
    expect(r.plan.steps[0].args.company_id).toMatch(/^c_/);
    expect(r.company.chainState).toBe('DRAFT');
    expect(live.memberships(owner)).toHaveLength(1);
  });
  it('keeps repeat commands idempotent', async () => {
    const k = randomUUID(),
      p = { name: 'One', timezone: 'UTC' };
    const first = await call(owner, 'company.create', p, undefined, k);
    expect(await call(owner, 'company.create', p, undefined, k)).toEqual(first);
    expect(s.list('company').filter((c) => c.mode === 'TESTNET')).toHaveLength(1);
  });
  it('rejects altered idempotent input', async () => {
    const k = randomUUID();
    await call(owner, 'company.create', { name: 'One', timezone: 'UTC' }, undefined, k);
    await expect(
      call(owner, 'company.create', { name: 'Two', timezone: 'UTC' }, undefined, k),
    ).rejects.toThrow('different input');
  });
  it('isolates demo users and cross-company access', async () => {
    const c = await company();
    await expect(live.state(stranger, 'company', c.id)).rejects.toThrow('outside your workspace');
    await expect(live.state({ id: 'owner', mode: 'TESTNET' }, 'company')).rejects.toThrow('Verify');
  });
  it('requires the exact invited NEAR identity', async () => {
    const r = await employment();
    const token = r.invitationUrl.split('/').at(-1);
    await expect(call(stranger, 'employee.accept', { token })).rejects.toThrow(
      'named in this invitation',
    );
    const accepted = await call(employee, 'employee.accept', { token });
    expect(s.get(r.employee.id)?.identityVerified).toBe(false);
    expect(accepted.plan.steps[0].method).toBe('accept_employment');
    const op: any = await live.prepare(employee, accepted.plan.id, 0);
    await live.confirm(employee, op.operationId!, 'x'.repeat(40));
    expect(s.get(r.employee.id)?.identityVerified).toBe(true);
    expect(s.get(r.employee.id)?.owner).toBe(employee.id);
  });
  it('preserves employee balance access with no active company membership', async () => {
    const state: any = await live.state(employee, 'employee');
    expect(state.account.cash).toBe('1000000000000000000000000');
    const r = await call(employee, 'employee.withdraw', { amount: '10' });
    expect(r.plan.steps[0].args.amount).toBe('10');
  });
  it('invites and revokes real observers without financial signing authority', async () => {
    const c = await company();
    const r = await call(
      owner,
      'member.invite',
      { accountId: 'stranger.testnet', access: 'observer' },
      c.id,
    );
    const membership = await call(stranger, 'member.accept', {
      token: r.invitationUrl.split('/').at(-1),
    });
    await expect(call(stranger, 'treasury.fund', { amount: '1' }, c.id)).rejects.toThrow(
      'read-only',
    );
    await call(
      owner,
      'member.revoke',
      { id: membership.id, expectedVersion: membership.version },
      c.id,
    );
    await expect(live.state(stranger, 'company', c.id)).rejects.toThrow('outside');
  });
  it('never demotes an owner with an invitation', async () => {
    const c = await company();
    await expect(
      call(owner, 'member.invite', { accountId: 'owner.testnet', access: 'observer' }, c.id),
    ).rejects.toThrow('owner already');
  });
  it('uses the same payroll UI metadata for a stable, fully prefunded contract mandate', async () => {
    const r = await employment();
    s.save({ ...s.get(r.employee.id)!, status: 'ACTIVE', owner: employee.id });
    const p = await call(owner, 'payroll.preview', { days: 2 }, r.c.id);
    expect(p.plan.steps[0].method).toBe('authorize_mandate');
    expect(p.plan.effects.total).toBe('2000000000000000000000');
    expect(p.plan.steps[0].args.obligations[0].employee_id).toBe(r.employee.chainId);
    const again = await call(owner, 'payroll.preview', { days: 2 }, r.c.id);
    expect(again.plan.steps[0].args.obligations[0].id).toBe(p.plan.steps[0].args.obligations[0].id);
  });
  it('rejects stale payroll after agreement metadata changes', async () => {
    const r = await employment();
    s.save({ ...s.get(r.employee.id)!, status: 'ACTIVE', owner: employee.id });
    const p = await call(owner, 'payroll.preview', { days: 2 }, r.c.id);
    s.save({ ...s.get(r.employee.id)!, salary: '5' });
    await expect(live.prepare(owner, p.plan.id, 0)).rejects.toThrow('Employees changed');
  });
  it('requires the owner to sign an accountant draft', async () => {
    const r = await employment();
    s.save({ ...s.get(r.employee.id)!, status: 'ACTIVE', owner: employee.id });
    s.save({
      type: 'membership',
      tenant: r.c.id,
      owner: stranger.id,
      access: 'accountant',
      status: 'ACTIVE',
    });
    const p = await call(stranger, 'payroll.preview', { days: 2 }, r.c.id);
    expect(p.plan.owner).toBe(owner.id);
    await expect(live.prepare(stranger, p.plan.id, 0)).rejects.toThrow('Record not found');
    expect(((await live.prepare(owner, p.plan.id, 0)) as any).transaction.signerId).toBe(
      'owner.testnet',
    );
  });
  it('does not overwrite a prepared operation when a signature is retried', async () => {
    const c = await company(),
      r = await call(owner, 'treasury.fund', { amount: '10' }, c.id);
    const a: any = await live.prepare(owner, r.plan.id, 0),
      b: any = await live.prepare(owner, r.plan.id, 0);
    expect(a.operationId).toBe(b.operationId);
    await live.confirm(owner, a.operationId!, 'x'.repeat(40));
    expect(s.get(r.plan.id)?.state).toBe('COMPLETED');
    await expect(live.confirm(owner, a.operationId!, 'y'.repeat(40))).rejects.toThrow(
      'another transaction',
    );
  });
  it('recovers a verified receipt into its interrupted plan projection', async () => {
    const c = await company(),
      plan = s.list('live-plan').find((p) => p.commit.companyId === c.id)!;
    const op: any = await live.prepare(owner, plan.id, 0);
    s.save({ ...s.get(op.operationId!)!, state: 'CONFIRMED', txHash: 'x'.repeat(40) });
    live.recoverProjections();
    expect(s.get(c.id)?.chainState).toBe('REGISTERED');
    expect(s.get(plan.id)?.state).toBe('COMPLETED');
  });
});
describe('finalized reconciliation', () => {
  it('persists each sequence once and advances a checkpoint across restart', async () => {
    const events = [
      {
        event_sequence: '1',
        event_type: 'PayrollCredited',
        reference: 'o1',
        account_id: 'employee.testnet',
        amount: '100',
      },
    ];
    const q = async (_c: string, m: string, a: any) =>
      m === 'list_events'
        ? events.slice(a.from_index, a.from_index + a.limit)
        : m === 'get_account'
          ? { cash: '100' }
          : m === 'list_obligations'
            ? [{ id: 'o1', account_id: 'employee.testnet', company_id: 'c1', credited: true }]
            : [];
    s.save({ id: 'job', type: 'chain-job', obligationId: 'o1', state: 'SENDING' });
    await reconcileChain(s, 'vault.testnet', q);
    await reconcileChain(s, 'vault.testnet', q);
    expect(s.list('chain-event')).toHaveLength(1);
    expect(s.get('chain-sync:vault.testnet')?.cursor).toBe(1);
    expect(s.get('job')?.state).toBe('CONFIRMED');
    expect(s.get('job')?.evidence).toBe('FINALIZED_CONTRACT_STATE');
  });
  it('blocks execution on an incompatible restored event checkpoint', async () => {
    const q = async (_c: string, m: string, a: any) =>
      m === 'list_events'
        ? [
            {
              event_sequence: '1',
              event_type: 'PayrollCredited',
              account_id: 'employee.testnet',
              amount: '1',
            },
          ].slice(a.from_index, a.from_index + a.limit)
        : [];
    await reconcileChain(s, 'vault.testnet', q);
    await expect(reconcileChain(s, 'vault.testnet', async () => [])).rejects.toThrow('checkpoint');
    expect(s.get('chain-sync:vault.testnet')?.state).toBe('BLOCKED');
  });
  it('blocks a missing sequence instead of silently skipping it', async () => {
    await expect(
      reconcileChain(s, 'vault.testnet', async () => [{ event_sequence: '2' }]),
    ).rejects.toThrow('sequence');
    expect(s.get('chain-sync:vault.testnet')?.cursor).toBe(0);
  });
});

describe('financial operation recovery and amendments', () => {
  it('blocks another signature while a wallet result is unknown', async () => {
    const c = await company(),
      r = await call(owner, 'treasury.fund', { amount: '10' }, c.id);
    const op: any = await live.prepare(owner, r.plan.id, 0);
    live.dispatch(owner, op.operationId);
    await expect(live.prepare(owner, r.plan.id, 0)).rejects.toThrow(
      'wallet request was already opened',
    );
    live.declined(owner, op.operationId);
    expect(((await live.prepare(owner, r.plan.id, 0)) as any).operationId).toBe(op.operationId);
  });
  it('serializes simultaneous duplicate commands for one identity', async () => {
    const key = randomUUID(),
      payload = { name: 'Only one company', timezone: 'UTC' };
    const [a, b] = await Promise.all([
      call(owner, 'company.create', payload, undefined, key),
      call(owner, 'company.create', payload, undefined, key),
    ]);
    expect(a.company.id).toBe(b.company.id);
  });
  it('preserves a one-time bonus when bulk salaries change', async () => {
    const r = await employment();
    s.save({
      ...s.get(r.employee.id)!,
      owner: employee.id,
      status: 'ACTIVE',
      identityVerified: true,
    });
    const due = (BigInt(Date.now() + 86400000) * 1000000n).toString();
    query.mockImplementation(async (_c: any, m: string) =>
      m === 'get_company'
        ? { owner: 'owner.testnet', free: '100000000000000000000000000' }
        : m === 'list_obligations'
          ? [
              {
                id: 'reserved',
                company_id: r.c.chainId,
                employee_id: r.employee.chainId,
                amount: '1100000000000000000000',
                due_at: due,
                version: 2,
                credited: false,
                cancelled: false,
              },
            ]
          : [],
    );
    const result = await call(
      owner,
      'salary.preview',
      {
        selection: 'all',
        kind: 'percent',
        delta: '1000',
        direction: 'increase',
        effectiveFrom: new Date(Date.now() + 1000).toISOString(),
      },
      r.c.id,
    );
    expect(result.plan.steps[0].args.amount).toBe('1200000000000000000000');
  });
  it('keeps earned due salary while ending employment cancels only future payments', async () => {
    const r = await employment();
    const e = s.save({
      ...s.get(r.employee.id)!,
      owner: employee.id,
      status: 'ACTIVE',
      identityVerified: true,
    });
    query.mockImplementation(async (_c: any, m: string) =>
      m === 'list_obligations'
        ? [
            {
              id: 'due',
              company_id: r.c.chainId,
              employee_id: e.chainId,
              amount: '100',
              due_at: '1',
              version: 1,
            },
            {
              id: 'future',
              company_id: r.c.chainId,
              employee_id: e.chainId,
              amount: '100',
              due_at: (BigInt(Date.now() + 86400000) * 1000000n).toString(),
              version: 1,
            },
          ]
        : [],
    );
    const result = await call(
      owner,
      'employee.status',
      { id: e.id, status: 'ENDED', expectedVersion: e.version },
      r.c.id,
    );
    expect(result.plan.steps).toHaveLength(1);
    expect(result.plan.steps[0].args.obligation_id).toBe('future');
  });
});

describe('unfinished decision isolation', () => {
  it('prevents profile edits from invalidating a partially signed salary projection', async () => {
    const { c, employee: e, role } = await employment();
    const p = live.plan(
      owner,
      'Salary amendment',
      [
        live.step('replace_future_obligations', {}, 'First amendment'),
        live.step('replace_future_obligations', {}, 'Second amendment'),
      ],
      {},
      c.id,
      { salaryUpdates: [{ id: e.id, version: e.version, salary: '2000' }] },
    );
    s.save({
      ...p,
      state: 'IN_PROGRESS',
      steps: p.steps.map((step: any, i: number) =>
        i === 0 ? { ...step, state: 'CONFIRMED' } : step,
      ),
    });
    await expect(
      call(
        owner,
        'employee.update',
        {
          id: e.id,
          expectedVersion: e.version,
          name: 'Changed name',
          email: 'person@example.org',
          roleId: role.id,
        },
        c.id,
      ),
    ).rejects.toMatchObject({ code: 'PLAN_IN_PROGRESS' });
    expect(s.get(e.id)?.version).toBe(e.version);
  });
  it('blocks overlapping payroll changes, allows funding and preserves all active plans after expiry', async () => {
    const c = await company();
    const p = live.plan(
      owner,
      'Partially signed raise',
      [
        live.step('replace_future_obligations', {}, 'First'),
        live.step('replace_future_obligations', {}, 'Second'),
      ],
      {},
      c.id,
    );
    s.save({
      ...p,
      state: 'IN_PROGRESS',
      expiresAt: '2000-01-01T00:00:00.000Z',
      steps: p.steps.map((v: any, i: number) => (i === 0 ? { ...v, state: 'CONFIRMED' } : v)),
    });
    await expect(call(owner, 'payroll.preview', { days: 1 }, c.id)).rejects.toThrow(
      'Finish the existing',
    );
    await expect(call(owner, 'treasury.fund', { amount: '1' }, c.id)).resolves.toHaveProperty(
      'plan',
    );
    for (let i = 0; i < 35; i++)
      s.save({ type: 'live-plan', owner: owner.id, state: 'COMPLETED', steps: [] });
    const state: any = await live.state(owner, 'company', c.id);
    expect(state.plans.some((v: any) => v.id === p.id)).toBe(true);
    await expect(live.prepare(owner, p.id, 1)).resolves.toHaveProperty('operationId');
    await expect(call(owner, 'plan.cancel', { id: p.id })).rejects.toThrow('Only an unsigned');
  });
  it('checks stale metadata even when a transaction was already prepared', async () => {
    const { c, employee: e } = await employment();
    const p = live.plan(
      owner,
      'Salary',
      [live.step('replace_future_obligations', {}, 'Change')],
      {},
      c.id,
      { salaryUpdates: [{ id: e.id, version: e.version }] },
    );
    await live.prepare(owner, p.id, 0);
    s.save({ ...e, name: 'Changed after preparation' });
    await expect(live.prepare(owner, p.id, 0)).rejects.toThrow('changed');
  });
  it('serializes two concurrently prepared payroll decisions at company level', async () => {
    const c = await company();
    const first = live.plan(owner, 'First', [live.step('authorize_mandate', {}, 'Sign')], {}, c.id);
    const second = live.plan(
      owner,
      'Second',
      [live.step('authorize_mandate', {}, 'Sign')],
      {},
      c.id,
    );
    const attempts = await Promise.allSettled([
      live.prepare(owner, first.id, 0),
      live.prepare(owner, second.id, 0),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((a) => a.status === 'rejected')).toHaveLength(1);
  });
  it('discards an unsigned prepared decision but never a dispatched result', async () => {
    const c = await company();
    const p = live.plan(owner, 'Unsigned', [live.step('authorize_mandate', {}, 'Sign')], {}, c.id);
    const op: any = await live.prepare(owner, p.id, 0);
    await call(owner, 'plan.cancel', { id: p.id });
    expect(s.get(op.operationId!)?.state).toBe('CANCELLED');
    await expect(live.prepare(owner, p.id, 0)).rejects.toThrow('complete or discarded');
    const p2 = live.plan(
      owner,
      'Wallet open',
      [live.step('authorize_mandate', {}, 'Sign')],
      {},
      c.id,
    );
    const op2: any = await live.prepare(owner, p2.id, 0);
    live.dispatch(owner, op2.operationId!);
    await expect(call(owner, 'plan.cancel', { id: p2.id })).rejects.toThrow('Only an unsigned');
  });
});

describe('real savings forecast', () => {
  it('compares existing rules with a proposed fixed contribution without reserving anything', async () => {
    const { c, employee: e } = await employment();
    s.save({ ...e, owner: employee.id, status: 'ACTIVE', salary: '1000', cadence: 'daily' });
    const account = { cash: '100', policy: { cash_floor: '0', goal_bps: 0, goals: [] } };
    const result = live.goalForecast(
      employee,
      {
        goalBps: 5000,
        cashFloor: '0',
        goals: [
          {
            name: 'Workshop',
            target: '600',
            priority: 1,
            contributionMode: 'FIXED',
            contributionValue: '200',
            overflow: 'CASH',
          },
        ],
      },
      [{ id: 'g1', rule: { state: 'ACTIVE' } }],
      account,
    );
    expect(result.goals[0].completion.paydays).toBe(3);
    expect(BigInt(result.baseline.projectedCash) - BigInt(result.projectedCash)).toBe(600n);
    expect(s.list('live-goal')).toHaveLength(0);
    expect(account.cash).toBe('100');
  });
});

it('can resume a partial payroll plan after company suspension and restoration', async () => {
  const c = await company();
  const plan = live.plan(
    owner,
    'Resume payroll',
    [
      live.step('replace_future_obligations', {}, 'First'),
      live.step('replace_future_obligations', {}, 'Second'),
    ],
    {},
    c.id,
    { companyVersion: c.version, companyTimezone: c.timezone },
  );
  s.save({
    ...plan,
    state: 'IN_PROGRESS',
    steps: plan.steps.map((step: any, i: number) =>
      i === 0 ? { ...step, state: 'CONFIRMED' } : step,
    ),
  });
  const suspended = s.save({ ...c, status: 'SUSPENDED' });
  await expect(live.prepare(owner, plan.id, 1)).rejects.toThrow('suspended');
  s.save({ ...suspended, status: 'ACTIVE' });
  await expect(live.prepare(owner, plan.id, 1)).resolves.toHaveProperty('operationId');
});

describe('v1 lifecycle and reports', () => {
  it('keeps employee pay unchanged when changing the job role and reissues one-use invitations', async () => {
    const r = await employment();
    const newer = await call(
      owner,
      'role.save',
      {
        name: 'New role',
        description: 'Responsibilities',
        salary: '9000000000000000000000',
        cadence: 'monthly',
      },
      r.c.id,
    );
    const edited = await call(
      owner,
      'employee.update',
      {
        id: r.employee.id,
        name: 'Updated person',
        email: '',
        roleId: newer.id,
        startDate: '2026-11-01',
        expectedVersion: s.get(r.employee.id)!.version,
      },
      r.c.id,
    );
    expect(edited.salary).toBe(r.employee.salary);
    expect(edited.cadence).toBe('daily');
    const renewed = await call(
      owner,
      'employee.invitation',
      { id: edited.id, operation: 'reissue', expectedVersion: edited.version },
      r.c.id,
    );
    await expect(
      call(employee, 'employee.accept', { token: r.invitationUrl.split('/').at(-1) }),
    ).rejects.toThrow('expired');
    expect(renewed.invitationUrl).not.toBe(r.invitationUrl);
    const current = s.get(edited.id)!;
    await call(
      owner,
      'employee.invitation',
      { id: current.id, operation: 'revoke', expectedVersion: current.version },
      r.c.id,
    );
    await expect(
      call(employee, 'employee.accept', { token: renewed.invitationUrl.split('/').at(-1) }),
    ).rejects.toThrow('expired');
  });
  it('clips every due date to the single signed execution window and exports human and atomic units', async () => {
    const r = await employment();
    s.save({ ...s.get(r.employee.id)!, status: 'ACTIVE', owner: employee.id });
    const result = await call(owner, 'payroll.preview', { days: 31 }, r.c.id);
    for (const step of result.plan.steps.filter((s: any) => s.method === 'authorize_mandate'))
      for (const o of step.args.obligations)
        expect(BigInt(o.due_at) <= BigInt(step.args.execution_not_after)).toBe(true);
    const previous = query.getMockImplementation();
    const item = result.plan.steps.find((s: any) => s.method === 'authorize_mandate').args
      .obligations[0];
    query.mockImplementation(async (c: any, m: string, a: any) =>
      m === 'list_obligations'
        ? [{ ...item, company_id: r.c.chainId, account_id: 'employee.testnet', credited: false }]
        : previous(c, m, a),
    );
    const csv = await live.export(owner, 'company', r.c.id);
    expect(csv).toContain('amount_atomic');
    expect(csv).toContain('testNEAR');
    expect(csv).toContain('0.001000000000000000000000');
  });
  it('leaves no assistant mutation or unknown-role proposal', async () => {
    const r = await employment();
    const n = s.ledger().length;
    const response = await live.assistant(owner, 'increase unknown team 10%', r.c.id);
    expect(response.proposal).toBeNull();
    expect(s.ledger()).toHaveLength(n);
  });
});

it('preserves an explicit unfunded payroll request without creating partial signing authority', async () => {
  const { c, employee: invitedEmployee } = await employment();
  s.save({ ...invitedEmployee, status: 'ACTIVE', identityVerified: true });
  const prior = query.getMockImplementation()!;
  query.mockImplementation(async (c0: any, m: string, a: any) =>
    m === 'get_company'
      ? { owner: 'owner.testnet', free: '0', reserved: '0', version: 1 }
      : prior(c0, m, a),
  );
  await expect(call(owner, 'payroll.preview', { days: 2 }, c.id)).rejects.toThrow(
    'Fund the full payroll window',
  );
  expect(s.get('funding-request:' + c.id)?.state).toBe('AWAITING_FUNDS');
  expect(s.get('funding-notice:' + c.id)?.owner).toBe(owner.id);
  expect(
    s
      .list('live-plan', c.id)
      .some((p) => p.steps.some((x: any) => x.method === 'authorize_mandate')),
  ).toBe(false);
});

describe('resumable workspace registration', () => {
  it('reuses a safe unexpired draft registration without creating a second company', async () => {
    const created = await call(owner, 'company.create', {
      name: 'Draft workspace',
      timezone: 'UTC',
    });
    const resumed = await call(
      owner,
      'company.register',
      { id: created.company.id },
      created.company.id,
    );
    expect(resumed.plan.id).toBe(created.plan.id);
    expect(s.list('company').filter((c) => c.mode === 'TESTNET')).toHaveLength(1);
    expect(s.get(created.company.id)?.chainState).toBe('DRAFT');
  });
  it('regenerates an expired unsigned plan with the same opaque company and registration operation id', async () => {
    const created = await call(owner, 'company.create', {
      name: 'Expired workspace',
      timezone: 'UTC',
    });
    s.save({ ...created.plan, expiresAt: '2000-01-01' });
    query.mockResolvedValueOnce(null);
    const resumed = await call(
      owner,
      'company.register',
      { id: created.company.id },
      created.company.id,
    );
    expect(resumed.plan.id).not.toBe(created.plan.id);
    expect(resumed.plan.steps[0].args).toEqual(created.plan.steps[0].args);
    expect(s.get(created.plan.id)?.state).toBe('CANCELLED');
    expect(s.get(created.company.id)?.chainState).toBe('DRAFT');
  });
  it.each(['DISPATCHED', 'SUBMITTED', 'CONFIRMED'])(
    'blocks a second registration while the original transaction is %s',
    async (state) => {
      const created = await call(owner, 'company.create', {
        name: 'Unresolved workspace',
        timezone: 'UTC',
      });
      const op = s.save({
        type: 'chain-operation',
        owner: owner.id,
        tenant: created.company.id,
        state,
      });
      s.save({
        ...created.plan,
        expiresAt: '2000-01-01',
        steps: [{ ...created.plan.steps[0], operationId: op.id }],
      });
      await expect(
        call(owner, 'company.register', { id: created.company.id }, created.company.id),
      ).rejects.toThrow('existing registration');
      expect(s.list('live-plan', created.company.id)).toHaveLength(1);
    },
  );
  it('requires the verified original receipt when a draft already exists on chain', async () => {
    const created = await call(owner, 'company.create', {
      name: 'Chain workspace',
      timezone: 'UTC',
    });
    s.save({ ...created.plan, expiresAt: '2000-01-01' });
    await expect(
      call(owner, 'company.register', { id: created.company.id }, created.company.id),
    ).rejects.toThrow('original registration receipt');
    expect(s.get(created.company.id)?.chainState).toBe('DRAFT');
  });
  it('rejects another wallet attempting to resume a company registration', async () => {
    const created = await call(owner, 'company.create', {
      name: 'Private workspace',
      timezone: 'UTC',
    });
    await expect(
      call(stranger, 'company.register', { id: created.company.id }, created.company.id),
    ).rejects.toThrow();
    expect(s.get(created.company.id)?.chainState).toBe('DRAFT');
  });
});

it('refuses accepting membership or employment after an employer is suspended', async () => {
  const r = await employment();
  const invitation = await call(
    owner,
    'member.invite',
    { accountId: 'stranger.testnet', access: 'observer' },
    r.c.id,
  );
  s.save({ ...s.get(r.c.id)!, status: 'SUSPENDED' });
  await expect(
    call(stranger, 'member.accept', { token: invitation.invitationUrl.split('/').at(-1) }),
  ).rejects.toThrow('not currently available');
  await expect(
    call(employee, 'employee.accept', { token: r.invitationUrl.split('/').at(-1) }),
  ).rejects.toThrow('not currently available');
  expect(s.list('membership', r.c.id, stranger.id)).toHaveLength(0);
});

it('rechecks employer status before preparing an already reviewed employment acceptance', async () => {
  const r = await employment();
  const accepted = await call(employee, 'employee.accept', {
    token: r.invitationUrl.split('/').at(-1),
  });
  s.save({ ...s.get(r.c.id)!, status: 'SUSPENDED' });
  await expect(live.prepare(employee, accepted.plan.id, 0)).rejects.toThrow(
    'not currently available',
  );
  expect(s.get(accepted.plan.id)?.state).toBe('PREVIEW');
});
