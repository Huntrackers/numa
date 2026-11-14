import { randomBytes, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { Store, type Entity } from '../../../packages/db/src/index.js';
import {
  ensure,
  hash,
  occurrences,
  obligationId,
  changeSalary,
  csvCell,
} from '../../../packages/domain/src/index.js';
import {
  view,
  assertTestnet,
  confirmOperation,
  operationAnchor,
} from '../../../packages/near-adapter/src/rpc.js';
import { Service, type Actor } from './service.js';
import { employeeForecast, companyForecast } from '../../../packages/domain/src/forecast.js';
import { accountLedger } from '../../../packages/near-adapter/src/accounting.js';
import {
  allObligations,
  verifyOperationCandidate,
} from '../../../packages/near-adapter/src/reconcile.js';
import { schemas, previewInputs } from '../../../packages/api-contracts/src/index.js';
const formatNear = (v: string) =>
  (BigInt(v) / 10n ** 24n).toString() +
  '.' +
  (BigInt(v) % 10n ** 24n).toString().padStart(24, '0').slice(0, 6);
const stamp = () => new Date().toISOString();
const ns = (v: string | number) => (BigInt(new Date(v).getTime()) * 1000000n).toString();
const nearAmount = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,38})$/)
  .refine((v) => BigInt(v) < 2n ** 128n);
const id = z.string().min(1).max(100);
export const liveSchemas: Record<string, z.ZodType> = {
  'plan.cancel': z.object({ id }).strict(),
  'company.create': schemas['company.create'],
  'company.register': z.object({ id }).strict(),
  'company.settings': schemas['company.settings'],
  'role.save': schemas['role.save'],
  'employee.invite': schemas['employee.invite'],
  'employee.accept': schemas['employee.accept'],
  'employee.status': schemas['employee.status'],
  'employee.update': z
    .object({
      id,
      expectedVersion: z.number().int(),
      name: z.string().trim().min(1).max(100),
      email: z.union([z.email(), z.literal('')]).optional(),
      roleId: id,
      startDate: z.iso.date().optional(),
    })
    .strict(),
  'employee.invitation': z
    .object({ id, expectedVersion: z.number().int(), operation: z.enum(['reissue', 'revoke']) })
    .strict(),
  'payroll.renew': z.object({ id, expectedVersion: z.number().int() }).strict(),
  'payroll.adjust': schemas['payroll.adjust'],
  'member.invite': z
    .object({
      accountId: z.string().regex(/^[a-z0-9._-]{2,64}$/),
      access: z.enum(['accountant', 'observer']),
    })
    .strict(),
  'member.accept': z.object({ token: z.string().min(20).max(200) }).strict(),
  'member.revoke': z.object({ id, expectedVersion: z.number().int() }).strict(),
  'treasury.fund': z.object({ amount: nearAmount }).strict(),
  'treasury.withdraw': z.object({ amount: nearAmount }).strict(),
  'payroll.preview': z.object({ days: z.number().int().min(1).max(31).default(31) }).strict(),
  'salary.preview': previewInputs['salary-change'],
  'payroll.pause': z.object({ id, paused: z.boolean() }).strict(),
  'payroll.claim': z.object({ id }).strict(),
  'employee.withdraw': z.object({ amount: nearAmount }).strict(),
  'goal.policy': z
    .object({
      goalBps: z.number().int().min(0).max(10000),
      cashFloor: nearAmount,
      goals: z
        .array(
          schemas['goal.save']
            .omit({ expectedVersion: true })
            .extend({ target: nearAmount, contributionValue: nearAmount.default('10000') }),
        )
        .max(10),
    })
    .strict(),
  'goal.pause': z.object({ id, paused: z.boolean() }).strict(),
  'goal.release': z.object({ id }).strict(),
};
const commandQueues = new Map<string, Promise<unknown>>();
export type ChainView = (contract: string, method: string, args: any) => Promise<any>;
export class LiveService {
  basic: Service;
  constructor(
    public s: Store,
    public query: ChainView = view,
  ) {
    this.basic = new Service(s);
  }
  identity(a: Actor) {
    const u = this.basic.user(a);
    ensure(
      a.mode === 'TESTNET' && u.accountId && !u.demo,
      'WALLET_AUTH_REQUIRED',
      'Verify your NEAR testnet identity.',
      403,
    );
    return u;
  }
  contract() {
    const c = process.env.NEAR_CONTRACT_ID;
    ensure(c, 'CONTRACT_UNCONFIGURED', 'Configure the NEAR testnet contract.', 409);
    return c;
  }
  company(a: Actor, id: string, write = false, sign = false) {
    this.identity(a);
    const c = this.basic.company(a, id, write, sign);
    ensure(c.mode === 'TESTNET', 'BOOK_MISMATCH', 'Choose a testnet company.', 409);
    return c;
  }
  memberships(a: Actor) {
    return this.s
      .list('membership', undefined, a.id)
      .filter((m) => m.status === 'ACTIVE' && m.access !== 'employee')
      .map((m) => ({ ...this.s.get(m.tenant), access: m.access }))
      .filter((c: any) => c.mode === 'TESTNET');
  }
  private stateCache = new Map<string, { until: number; promise: Promise<any> }>();
  async state(a: Actor, scope: string, companyId?: string) {
    this.identity(a);
    if (scope === 'company' && companyId && companyId !== 'forma') this.company(a, companyId);
    const key = [a.id, scope, companyId].join(':');
    const old = this.stateCache.get(key);
    if (old && old.until > Date.now()) return old.promise;
    const promise = this.readState(a, scope, companyId);
    this.stateCache.set(key, { until: Date.now() + 5000, promise });
    try {
      return await promise;
    } catch (e) {
      this.stateCache.delete(key);
      throw e;
    }
  }
  async readState(a: Actor, scope: string, companyId?: string) {
    const u = this.identity(a),
      workspaces = this.memberships(a),
      contractId = this.contract();
    this.recoverProjections();
    const employments = this.s
      .list('employee', undefined, a.id)
      .filter((e) => this.s.get(e.tenant)?.mode === 'TESTNET');
    const base = {
      mode: 'TESTNET',
      unit: 'testNEAR',
      network: 'testnet',
      contractId,
      user: { id: u.id, name: u.name, role: u.role, accountId: u.accountId },
      workspaces,
      employments,
      notifications: this.s.list('notification', undefined, a.id),
      serverTime: stamp(),
      plans: this.s
        .list('live-plan', undefined, a.id)
        .filter((p) =>
          scope === 'company'
            ? !companyId || companyId === 'forma'
              ? p.steps[0]?.method === 'register_company'
              : p.tenant === companyId
            : !p.tenant || p.steps.some((step: any) => step.method === 'accept_employment'),
        )
        .filter(
          (p) => p.state === 'IN_PROGRESS' || (p.state === 'PREVIEW' && p.expiresAt > stamp()),
        )
        .reverse()
        .concat(
          this.s
            .list('live-plan', undefined, a.id)
            .filter((p) => p.state === 'COMPLETED')
            .slice(-30)
            .reverse(),
        ),
      operations: this.s.list('chain-operation', undefined, a.id).slice(-50).reverse(),
      reconciliation: this.s.get('chain-sync:' + contractId),
    };
    if (scope === 'company') {
      if (!companyId || companyId === 'forma') return { ...base, onboarding: true };
      const c = this.company(a, companyId),
        employees = this.s.list('employee', c.id);
      const chain = await this.query(contractId, 'get_company', { company_id: c.chainId });
      const onchain = chain
        ? await this.query(contractId, 'list_company_employees', { company_id: c.chainId })
        : [];
      const obligations = chain
        ? (
            await Promise.all(
              [...new Set(onchain.map((e: any) => e.account_id))].map((account_id) =>
                allObligations(contractId, account_id as string, this.query),
              ),
            )
          )
            .flat()
            .filter((o: any) => o.company_id === c.chainId)
        : [];
      return {
        ...base,
        company: c,
        chain,
        access: workspaces.find((m) => m.id === c.id)?.access,
        employees: employees.map((e) => ({
          ...e,
          chain: onchain.find((v: any) => v.employee_id === e.chainId),
        })),
        fundingRequest: this.s.get('funding-request:' + c.id),
        roles: this.s.list('role', c.id),
        members: this.s
          .list('membership', c.id)
          .filter((m) => m.access !== 'employee')
          .map((m) => ({ ...m, accountId: this.s.get(m.owner)?.accountId })),
        obligations,
        ledger: accountLedger(this.s, 'testNEAR:company:' + c.chainId + ':'),
        audit: this.s.list('audit', c.id).slice(-100).reverse(),
      };
    }
    const [account, chainEmployments, obligations] = await Promise.all([
      this.query(contractId, 'get_account', { account_id: u.accountId }),
      this.query(contractId, 'list_employments', { account_id: u.accountId }),
      allObligations(contractId, u.accountId, this.query),
    ]);
    return {
      ...base,
      account,
      chainEmployments,
      obligations,
      ledger: accountLedger(this.s, 'testNEAR:employee:' + u.accountId + ':'),
      goalNames: this.s.list('live-goal', undefined, a.id),
      withdrawals: this.s
        .list('chain-operation', undefined, a.id)
        .filter((o) => o.method === 'request_withdrawal'),
    };
  }
  goalForecast(a: Actor, p: any, goals: any[], account: any) {
    const employees = this.s
      .list('employee', undefined, a.id)
      .filter((e) => e.status === 'ACTIVE' && this.s.get(e.tenant)?.mode === 'TESTNET')
      .map((e) => ({ ...e, timezone: this.s.get(e.tenant)?.timezone || 'UTC' }));
    if (!employees.length) return undefined;
    const forecast: any = employeeForecast({
      employees,
      employee: employees[0],
      policy: {
        cashFloor: p.cashFloor,
        legs: [
          { id: 'cash', type: 'cash', bps: 10000 - p.goalBps },
          { id: 'goals', type: 'goals', bps: p.goalBps },
        ],
      },
      goals: goals.map((g: any, i: number) => ({
        ...p.goals[i],
        id: g.id,
        funded: account.policy.goals.find((v: any) => v.id === g.id)?.funded || '0',
        state: g.rule.state,
      })),
      cash: account.cash,
      from: stamp(),
      timezone: 'UTC',
      horizonDays: 90,
    });
    forecast.baseline = employeeForecast({
      employees,
      employee: employees[0],
      policy: {
        cashFloor: account.policy.cash_floor,
        legs: [
          { id: 'cash', type: 'cash', bps: 10000 - account.policy.goal_bps },
          { id: 'goals', type: 'goals', bps: account.policy.goal_bps },
        ],
      },
      goals: account.policy.goals.map((g: any) => {
        const r = account.goalRules?.find((r: any) => r.id === g.id);
        return {
          ...g,
          name:
            this.s.list('live-goal', undefined, a.id).find((n) => n.chainId === g.id)?.name ||
            'Savings goal',
          contributionMode: r?.contribution_mode || 'PERCENT',
          contributionValue: r?.contribution_value || '10000',
          percentBasis: r?.percent_basis || 'GOAL_BUDGET',
          overflow: r?.overflow || 'NEXT',
          state:
            r?.state || (g.completed ? 'COMPLETED' : g.paused || g.released ? 'PAUSED' : 'ACTIVE'),
        };
      }),
      cash: account.cash,
      from: forecast.from,
      timezone: 'UTC',
      horizonDays: 90,
    });
    return forecast;
  }
  payrollPlan(plan: any) {
    return (
      !!plan.tenant &&
      plan.steps.some((s: any) =>
        [
          'authorize_mandate',
          'replace_future_obligations',
          'pause_mandate',
          'renew_mandate',
          'cancel_future_obligation',
          'local_employee_status',
          'local_salary',
        ].includes(s.method),
      )
    );
  }
  assertPayrollUnlocked(tenant: string, except?: string) {
    ensure(
      !this.s
        .list('live-plan', tenant)
        .some((p) => p.id !== except && p.state === 'IN_PROGRESS' && this.payrollPlan(p)),
      'PLAN_IN_PROGRESS',
      'Finish the existing payroll decision before changing salaries, employment or the payroll calendar.',
      409,
    );
  }
  validateBasis(plan: any) {
    if (this.payrollPlan(plan)) this.assertPayrollUnlocked(plan.tenant, plan.id);
    if (plan.commit?.employeeIds)
      ensure(
        hash(
          plan.commit.employeeIds.map((id: string) => {
            const e = this.s.get(id);
            return [id, e?.version];
          }),
        ) === plan.commit.basis,
        'PREVIEW_STALE',
        'Employees changed. Review a fresh payroll plan.',
        409,
      );
    if (plan.commit?.companyTimezone !== undefined)
      ensure(
        this.s.get(plan.tenant)?.timezone === plan.commit.companyTimezone,
        'PREVIEW_STALE',
        'The payroll timezone changed. Review a fresh decision.',
        409,
      );
    else if (plan.commit?.companyVersion && plan.state !== 'IN_PROGRESS')
      this.basic.version(this.s.get(plan.tenant)!, plan.commit.companyVersion);
    if (plan.commit?.employeeStatus)
      this.basic.version(
        this.s.get(plan.commit.employeeStatus.id)!,
        plan.commit.employeeStatus.version,
      );
    for (const e of plan.commit?.salaryUpdates || [])
      this.basic.version(this.s.get(e.id)!, e.version);
  }
  plan(a: Actor, label: string, steps: any[], effects: any = {}, tenant = '', commit: any = {}) {
    ensure(steps.length > 0, 'NO_CHANGES', 'There are no new contract changes.');
    return this.s.save({
      type: 'live-plan',
      owner:
        tenant &&
        [
          'register_company',
          'register_employee',
          'fund_treasury',
          'fund_treasury_once',
          'authorize_mandate',
          'replace_future_obligations',
          'pause_mandate',
          'renew_mandate',
          'cancel_future_obligation',
          'withdraw_company_surplus',
          'local_employee_status',
          'local_salary',
        ].includes(steps[0]?.method)
          ? this.s.get(tenant)!.owner
          : a.id,
      createdBy: a.id,
      snapshotId: randomUUID(),
      inputHash: hash({ steps, effects, commit }),
      tenant,
      label,
      contractId: this.contract(),
      state: 'PREVIEW',
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      steps: steps.map((s) => ({ ...s, state: 'PENDING' })),
      effects,
      commit,
    });
  }
  step(method: string, args: any, label: string, deposit = '0') {
    return { method, args, label, deposit };
  }
  async command(
    a: Actor,
    action: string,
    payload: unknown,
    companyId: string | undefined,
    key: string,
  ) {
    const queueKey = a.id;
    const previous = commandQueues.get(queueKey) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => this.executeCommand(a, action, payload, companyId, key));
    commandQueues.set(queueKey, task);
    try {
      return await task;
    } finally {
      if (commandQueues.get(queueKey) === task) commandQueues.delete(queueKey);
    }
  }
  async executeCommand(
    a: Actor,
    action: string,
    payload: unknown,
    companyId: string | undefined,
    key: string,
  ) {
    const u = this.identity(a),
      schema = liveSchemas[action];
    ensure(schema, 'UNKNOWN_ACTION', 'Unknown testnet action.');
    const p = schema.parse(payload) as any;
    if (p.effectiveFrom) p.effectiveFrom = new Date(p.effectiveFrom).toISOString();
    const inputHash = hash({ action, p, companyId });
    const existing = this.s.db
      .prepare('SELECT input_hash,result FROM requests WHERE key=? AND actor=?')
      .get(key, a.id) as any;
    if (existing) {
      ensure(
        existing.input_hash === inputHash,
        'IDEMPOTENCY_CONFLICT',
        'Request key reused with different input.',
        409,
      );
      return JSON.parse(existing.result);
    }
    ensure(
      [
        'plan.cancel',
        'employee.withdraw',
        'payroll.claim',
        'goal.release',
        'member.accept',
        'employee.accept',
      ].includes(action) || !this.s.get('settings')?.maintenance,
      'MAINTENANCE',
      'New changes are paused.',
      503,
    );
    let result: any;
    if (
      companyId &&
      [
        'company.settings',
        'employee.status',
        'employee.update',
        'payroll.adjust',
        'payroll.preview',
        'salary.preview',
        'payroll.pause',
      ].includes(action)
    ) {
      this.company(a, companyId, true);
      this.assertPayrollUnlocked(companyId);
    }
    if (action === 'plan.cancel') {
      result = this.s.atomic(() => {
        const plan = this.basic.own(a, p.id, 'live-plan');
        ensure(
          ['PREVIEW', 'IN_PROGRESS'].includes(plan.state) &&
            !plan.steps.some(
              (step: any) =>
                step.state === 'CONFIRMED' ||
                (step.operationId &&
                  !['PREPARED', 'FAILED'].includes(this.s.get(step.operationId)?.state)),
            ),
          'RECONCILIATION_REQUIRED',
          'Only an unsigned decision or a verified failed call without a pending wallet result can be discarded.',
          409,
        );
        for (const step of plan.steps)
          if (step.operationId)
            this.s.save({ ...this.s.get(step.operationId)!, state: 'CANCELLED' });
        return this.s.save({ ...plan, state: 'CANCELLED', cancelledAt: stamp() });
      });
    } else if (action === 'company.register') {
      const c = this.company(a, p.id, true, true);
      ensure(
        !companyId || companyId === c.id,
        'FORBIDDEN',
        'Choose the same company workspace.',
        403,
      );
      ensure(
        c.chainState === 'DRAFT',
        'ALREADY_REGISTERED',
        'This company is already registered.',
        409,
      );
      const related = this.s
        .list('live-plan', c.id)
        .filter((plan) => plan.steps.some((step: any) => step.method === 'register_company'));
      const unresolved = related.find((plan) =>
        plan.steps.some((step: any) => {
          const op = step.operationId && this.s.get(step.operationId);
          return op && !['PREPARED', 'FAILED', 'CANCELLED'].includes(op.state);
        }),
      );
      ensure(
        !unresolved,
        'RECONCILIATION_REQUIRED',
        'Resume the existing registration and verify its wallet transaction before creating another decision.',
        409,
      );
      const current = related.find(
        (plan) => ['PREVIEW', 'IN_PROGRESS'].includes(plan.state) && plan.expiresAt > stamp(),
      );
      if (current) result = { company: c, plan: current };
      else {
        const chain = await this.query(this.contract(), 'get_company', { company_id: c.chainId });
        ensure(
          !chain,
          'RECONCILIATION_REQUIRED',
          'A company already exists on NEAR. Verify the original registration receipt before completing setup.',
          409,
        );
        result = this.s.atomic(() => {
          for (const old of related.filter((plan) =>
            ['PREVIEW', 'IN_PROGRESS'].includes(plan.state),
          )) {
            for (const step of old.steps)
              if (step.operationId && this.s.get(step.operationId)?.state === 'PREPARED')
                this.s.save({ ...this.s.get(step.operationId)!, state: 'CANCELLED' });
            this.s.save({ ...old, state: 'CANCELLED', cancelledAt: stamp() });
          }
          return {
            company: c,
            plan: this.plan(
              a,
              'Register company on NEAR',
              [
                this.step(
                  'register_company',
                  { company_id: c.chainId, operation_id: 'register_' + c.chainId },
                  'Register ' + c.name,
                ),
              ],
              {},
              c.id,
              { companyId: c.id },
            ),
          };
        });
      }
    } else if (action === 'company.create') {
      ensure(
        DateTime.now().setZone(p.timezone).isValid,
        'INVALID_TIMEZONE',
        'Choose an IANA timezone.',
      );
      const companyId = randomUUID(),
        chainId = 'c_' + randomBytes(16).toString('hex');
      result = this.s.atomic(() => {
        const c = this.s.save({
          id: companyId,
          type: 'company',
          tenant: companyId,
          owner: a.id,
          ...p,
          chainId,
          unit: 'testNEAR',
          mode: 'TESTNET',
          status: 'ACTIVE',
          chainState: 'DRAFT',
        });
        this.s.save({
          type: 'membership',
          tenant: c.id,
          owner: a.id,
          status: 'ACTIVE',
          access: 'owner',
        });
        const plan = this.plan(
          a,
          'Register company on NEAR',
          [
            this.step(
              'register_company',
              { company_id: chainId, operation_id: 'register_' + chainId },
              'Register ' + p.name,
            ),
          ],
          {},
          c.id,
          { companyId: c.id },
        );
        return { company: c, plan };
      });
    } else if (action === 'company.settings' || action === 'role.save') {
      const c = this.company(a, companyId!, true, action === 'company.settings');
      if (action === 'company.settings') {
        this.basic.version(c, p.expectedVersion);
        ensure(
          DateTime.now().setZone(p.timezone).isValid,
          'INVALID_TIMEZONE',
          'Choose an IANA timezone.',
        );
        if (p.timezone !== c.timezone) {
          const chain = await this.query(this.contract(), 'get_company', { company_id: c.chainId });
          ensure(
            !chain ||
              (BigInt(chain.free) === 0n &&
                BigInt(chain.reserved) === 0n &&
                !this.s.list('employee', c.id).length),
            'TIMEZONE_LOCKED',
            'The company timezone is locked after funding or employment. Create a separate company book for a different timezone.',
          );
        }
        result = this.s.save({ ...c, name: p.name, timezone: p.timezone });
      } else {
        nearAmount.parse(p.salary);
        const old = p.id ? this.basic.tenantEntity(c.id, p.id, 'role') : undefined;
        if (old) this.basic.version(old, p.expectedVersion);
        result = this.s.save({ type: 'role', tenant: c.id, owner: a.id, ...p });
      }
    } else if (action === 'member.invite') {
      const c = this.company(a, companyId!, true, true);
      ensure(
        p.accountId !== u.accountId,
        'OWNER_PROTECTED',
        'The owner already has full company access.',
      );
      const token = randomBytes(32).toString('hex');
      this.s.atomic(() => {
        for (const old of this.s
          .list('member-invitation', c.id)
          .filter((entry) => entry.accountId === p.accountId && entry.state === 'PENDING'))
          this.s.save({ ...old, state: 'REVOKED', revokedAt: stamp(), reason: 'SUPERSEDED' });
        this.s.save({
          type: 'member-invitation',
          tenant: c.id,
          owner: a.id,
          accountId: p.accountId,
          access: p.access,
          tokenHash: hash(token),
          state: 'PENDING',
          expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
        });
      });
      result = { invitationUrl: '/invite/' + token };
    } else if (action === 'member.accept') {
      const i = this.s.list('member-invitation').find((i) => i.tokenHash === hash(p.token));
      ensure(
        i && i.state === 'PENDING' && i.expiresAt > stamp() && i.accountId === u.accountId,
        'INVALID_INVITATION',
        'Use the invited NEAR account before this invitation expires.',
        403,
      );
      const invitedCompany = this.s.get(i.tenant);
      ensure(
        invitedCompany?.mode === 'TESTNET' && invitedCompany.status === 'ACTIVE',
        'COMPANY_SUSPENDED',
        'This company invitation is not currently available.',
        403,
      );
      result = this.s.atomic(() => {
        const m = this.s.list('membership', i.tenant, a.id).find((m) => m.access !== 'employee');
        this.s.save({ ...i, state: 'ACCEPTED' });
        return this.s.save({
          type: 'membership',
          tenant: i.tenant,
          owner: a.id,
          id: m?.id,
          access: i.access,
          status: 'ACTIVE',
        });
      });
    } else if (action === 'member.revoke') {
      const c = this.company(a, companyId!, true, true),
        m = this.basic.tenantEntity(c.id, p.id, 'membership');
      this.basic.version(m, p.expectedVersion);
      ensure(m.access !== 'owner', 'OWNER_PROTECTED', 'The owner cannot be removed.');
      result = this.s.atomic(() => {
        const accountId = this.s.get(m.owner)?.accountId;
        for (const invitation of this.s
          .list('member-invitation', c.id)
          .filter((entry) => entry.accountId === accountId && entry.state === 'PENDING'))
          this.s.save({
            ...invitation,
            state: 'REVOKED',
            revokedAt: stamp(),
            reason: 'ACCESS_REVOKED',
          });
        return this.s.save({ ...m, status: 'REVOKED' });
      });
    } else if (action === 'employee.invite') {
      const c = this.company(a, companyId!, true, true);
      nearAmount.parse(p.salary);
      this.basic.tenantEntity(c.id, p.roleId, 'role');
      ensure(
        p.accountId && /^[a-z0-9._-]{2,64}$/.test(p.accountId),
        'ACCOUNT_REQUIRED',
        'Enter the employee NEAR testnet account.',
      );
      const chain = await this.query(this.contract(), 'get_company', { company_id: c.chainId });
      ensure(
        chain?.owner === u.accountId,
        'COMPANY_UNREGISTERED',
        'Register the company on NEAR first.',
      );
      ensure(
        this.s.list('employee', c.id).length <
          Math.min(50, this.s.get('settings')?.maxEmployees || 50),
        'EMPLOYEE_LIMIT',
        'Employee limit reached.',
      );
      ensure(
        !this.s
          .list('employee', c.id)
          .some((e) => e.accountId === p.accountId && e.status !== 'ENDED'),
        'DUPLICATE_EMPLOYEE',
        'This account is already invited.',
      );
      const token = randomBytes(32).toString('hex'),
        eid = randomUUID(),
        chainId = 'e_' + randomBytes(16).toString('hex');
      result = this.s.atomic(() => {
        const e = this.s.save({
          id: eid,
          type: 'employee',
          tenant: c.id,
          owner: 'pending-' + eid,
          ...p,
          chainId,
          scheduleId: randomUUID(),
          status: 'INVITED',
          identityVerified: false,
        });
        this.s.save({
          type: 'invitation',
          tenant: c.id,
          owner: a.id,
          employeeId: e.id,
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
          state: 'PENDING',
        });
        return {
          employee: e,
          invitationUrl: '/invite/' + token,
          plan: this.plan(
            a,
            'Register employee on NEAR',
            [
              this.step(
                'register_employee',
                { company_id: c.chainId, employee_id: chainId, account_id: p.accountId },
                'Register ' + p.name,
              ),
            ],
            {},
            c.id,
          ),
        };
      });
    } else if (action === 'employee.update') {
      const c = this.company(a, companyId!, true, true),
        e = this.basic.tenantEntity(c.id, p.id, 'employee');
      this.basic.version(e, p.expectedVersion);
      this.basic.tenantEntity(c.id, p.roleId, 'role');
      result = this.s.save({
        ...e,
        name: p.name,
        email: p.email || '',
        roleId: p.roleId,
        startDate: p.startDate || e.startDate,
      });
    } else if (action === 'employee.invitation') {
      const c = this.company(a, companyId!, true, true),
        e = this.basic.tenantEntity(c.id, p.id, 'employee');
      this.basic.version(e, p.expectedVersion);
      ensure(
        !e.identityVerified && e.status === 'INVITED',
        'INVALID_STATE',
        'Only an unaccepted invitation can be changed.',
      );
      const related = this.s
        .list('live-plan')
        .filter(
          (x) => x.commit?.employeeId === e.id && ['PREVIEW', 'IN_PROGRESS'].includes(x.state),
        );
      ensure(
        !related.some((x) =>
          x.steps.some(
            (st: any) =>
              st.operationId &&
              ['DISPATCHED', 'SUBMITTED', 'CONFIRMED'].includes(
                this.s.get(st.operationId)?.state || '',
              ),
          ),
        ),
        'RECONCILIATION_REQUIRED',
        'An acceptance is in progress. Reconcile the wallet result before changing this invitation.',
      );
      const token = randomBytes(32).toString('hex');
      result = this.s.atomic(() => {
        for (const x of related) this.s.save({ ...x, state: 'CANCELLED' });
        for (const i of this.s
          .list('invitation', c.id)
          .filter((i) => i.employeeId === e.id && i.state === 'PENDING'))
          this.s.save({ ...i, state: 'REVOKED' });
        const employee = this.s.save({
          ...e,
          status: p.operation === 'revoke' ? 'ENDED' : 'INVITED',
        });
        if (p.operation === 'revoke') return { employee };
        this.s.save({
          type: 'invitation',
          tenant: c.id,
          owner: a.id,
          employeeId: e.id,
          tokenHash: hash(token),
          state: 'PENDING',
          expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
        });
        return { employee, invitationUrl: '/invite/' + token };
      });
    } else if (action === 'employee.accept') {
      const inv = this.s.list('invitation').find((i) => i.tokenHash === hash(p.token));
      ensure(
        inv && inv.state === 'PENDING' && inv.expiresAt > stamp(),
        'INVALID_INVITATION',
        'The invitation expired or was already used.',
        409,
      );
      const e = this.basic.tenantEntity(inv.tenant, inv.employeeId, 'employee'),
        c = this.s.get(e.tenant)!;
      ensure(
        c.status === 'ACTIVE',
        'COMPANY_SUSPENDED',
        'This company invitation is not currently available.',
        403,
      );
      ensure(
        c.mode === 'TESTNET' && e.accountId === u.accountId,
        'WRONG_INVITEE',
        'Connect the NEAR account named in this invitation.',
        403,
      );
      const registered = await this.query(this.contract(), 'list_company_employees', {
        company_id: c.chainId,
      });
      ensure(
        registered.some((v: any) => v.employee_id === e.chainId && v.account_id === u.accountId),
        'REGISTRATION_PENDING',
        'Ask the owner to complete employee registration first.',
        409,
      );
      result = {
        plan: this.plan(
          a,
          'Accept employment on NEAR',
          [
            this.step(
              'accept_employment',
              { company_id: c.chainId, employee_id: e.chainId },
              'Accept ' + c.name,
            ),
          ],
          {},
          c.id,
          { employeeId: e.id, invitationId: inv.id },
        ),
      };
    } else if (action === 'employee.status') {
      const c = this.company(a, companyId!, true, true),
        e = this.basic.tenantEntity(c.id, p.id, 'employee');
      this.basic.version(e, p.expectedVersion);
      ensure(
        e.identityVerified,
        'INVITATION_REQUIRED',
        'The employee must accept their invitation first.',
      );
      const obligations = await allObligations(this.contract(), e.accountId, this.query);
      const eligible = obligations.filter(
        (o: any) =>
          o.company_id === c.chainId && o.employee_id === e.chainId && !o.credited && !o.cancelled,
      );
      const steps = eligible
        .filter((o: any) => p.status !== 'ENDED' || BigInt(o.due_at) > BigInt(ns(Date.now())))
        .map((o: any) =>
          p.status === 'ENDED'
            ? this.step(
                'cancel_future_obligation',
                { obligation_id: o.id, expected_version: o.version },
                'Cancel unearned future payment',
              )
            : this.step(
                'pause_mandate',
                { obligation_id: o.id, paused: p.status === 'PAUSED' },
                p.status === 'PAUSED' ? 'Pause payment automation' : 'Resume payment automation',
              ),
        );
      if (!steps.length)
        steps.push(this.step('local_employee_status', {}, 'Update employment status'));
      result = {
        plan: this.plan(
          a,
          'Change employment status',
          steps,
          { employee: e.name, status: p.status },
          c.id,
          { employeeStatus: { id: e.id, version: e.version, status: p.status } },
        ),
      };
    } else if (action === 'payroll.renew') {
      const c = this.company(a, companyId!, true, true),
        o = await this.query(this.contract(), 'get_obligation', { obligation_id: p.id });
      ensure(
        o?.company_id === c.chainId && !o.credited && !o.cancelled,
        'INVALID_STATE',
        'Choose an unsettled company obligation.',
      );
      ensure(
        o.version === p.expectedVersion,
        'VERSION_CONFLICT',
        'The payment changed. Refresh and review again.',
        409,
      );
      const expiry = ns(Date.now() + 31 * 86400000 - 60000);
      result = {
        plan: this.plan(
          a,
          'Renew payroll execution authority',
          [
            this.step(
              'renew_mandate',
              { obligation_id: o.id, execution_not_after: expiry, expected_version: o.version },
              'Renew authority for the same recipient and amount',
            ),
          ],
          {
            amount: o.amount,
            expiresAt: new Date(Number(BigInt(expiry) / 1000000n)).toISOString(),
          },
          c.id,
        ),
      };
    } else if (action === 'payroll.adjust') {
      const c = this.company(a, companyId!, true, true),
        o = await this.query(this.contract(), 'get_obligation', { obligation_id: p.id });
      ensure(
        o?.company_id === c.chainId &&
          !o.credited &&
          !o.cancelled &&
          BigInt(o.due_at) > BigInt(ns(Date.now())),
        'FUTURE_ONLY',
        'Choose an unpaid future payment.',
      );
      ensure(o.version === p.expectedVersion, 'VERSION_CONFLICT', 'This payment changed.', 409);
      nearAmount.parse(p.amount);
      const value =
        p.kind === 'bonus'
          ? BigInt(o.amount) + BigInt(p.amount)
          : BigInt(o.amount) - BigInt(p.amount);
      ensure(value > 0n, 'INVALID_AMOUNT', 'The adjusted payment must stay positive.');
      result = {
        plan: this.plan(
          a,
          'Review one-time salary adjustment',
          [
            this.step(
              'replace_future_obligations',
              { obligation_id: o.id, amount: value.toString(), expected_version: o.version },
              p.kind + ': ' + p.reason,
            ),
          ],
          { amount: value.toString(), reason: p.reason },
          c.id,
        ),
      };
    } else if (action === 'treasury.withdraw') {
      const c = this.company(a, companyId!, true, true),
        chain = await this.query(this.contract(), 'get_company', { company_id: c.chainId });
      ensure(
        BigInt(p.amount) > 0n && BigInt(p.amount) <= BigInt(chain.free),
        'INSUFFICIENT_FUNDS',
        'Only free treasury funds can be withdrawn.',
      );
      result = {
        plan: this.plan(
          a,
          'Withdraw free company funds',
          [
            this.step(
              'withdraw_company_surplus',
              {
                company_id: c.chainId,
                amount: p.amount,
                operation_id: 'cw_' + randomBytes(16).toString('hex'),
              },
              'Withdraw surplus to company owner',
            ),
          ],
          { amount: p.amount },
          c.id,
        ),
      };
    } else if (action === 'treasury.fund') {
      const c = this.company(a, companyId!, true, true);
      ensure(BigInt(p.amount) > 0n, 'INVALID_AMOUNT', 'Enter a positive amount.');
      result = {
        plan: this.plan(
          a,
          'Fund payroll treasury',
          [
            this.step(
              'fund_treasury_once',
              { company_id: c.chainId, operation_id: 'f_' + randomBytes(16).toString('hex') },
              'Fund treasury',
              p.amount,
            ),
          ],
          { amount: p.amount },
          c.id,
        ),
      };
    } else if (action === 'payroll.preview') {
      const c = this.company(a, companyId!, true);
      const chain = await this.query(this.contract(), 'get_company', { company_id: c.chainId });
      ensure(chain, 'COMPANY_UNREGISTERED', 'Register the company first.');
      const employees = this.s.list('employee', c.id).filter((e) => e.status === 'ACTIVE');
      const registered = await this.query(this.contract(), 'list_company_employees', {
        company_id: c.chainId,
      });
      const rows: any[] = [];
      // Keep every due date within the same finite authority window, including its last seconds.
      const executionExpiry = Date.now() + 31 * 86400000 - 60000;
      const until = new Date(
        Math.min(Date.now() + p.days * 86400000, executionExpiry),
      ).toISOString();
      for (const e of employees) {
        ensure(
          registered.some((r: any) => r.employee_id === e.chainId && r.accepted),
          'EMPLOYEE_UNVERIFIED',
          e.name + ' must accept employment on NEAR.',
        );
        const old = await allObligations(this.contract(), e.accountId, this.query);
        for (const d of occurrences(e.cadence, e.anchor, stamp(), until, c.timezone)) {
          const oid = obligationId(c.chainId, e.chainId, e.scheduleId, d.index);
          if (!old.some((o: any) => o.id === oid))
            rows.push({
              id: oid,
              employee_id: e.chainId,
              amount:
                e.pendingSalary && e.pendingSalary.effectiveFrom <= d.dueAt
                  ? e.pendingSalary.salary
                  : e.salary,
              due_at: ns(d.dueAt),
              name: e.name,
              dueAt: d.dueAt,
            });
        }
      }
      ensure(
        rows.length,
        'NO_NEW_OBLIGATIONS',
        'No new payday in this window. Extend the window or check active employees.',
      );
      const total = rows.reduce((n, r) => n + BigInt(r.amount), 0n);
      if (BigInt(chain.free) < total) {
        const missing = (total - BigInt(chain.free)).toString();
        this.s.atomic(() => {
          this.s.save({
            id: 'funding-request:' + c.id,
            type: 'funding-request',
            tenant: c.id,
            owner: c.owner,
            state: 'AWAITING_FUNDS',
            required: total.toString(),
            available: chain.free,
            shortfall: missing,
            days: p.days,
          });
          const noticeId = 'funding-notice:' + c.id;
          this.s.save({
            id: noticeId,
            type: 'notification',
            tenant: c.id,
            owner: c.owner,
            read: false,
            title: 'Payroll is awaiting funds',
            message:
              'Required ' +
              formatNear(total.toString()) +
              ' testNEAR. Shortfall ' +
              formatNear(missing) +
              ' testNEAR. No new payroll authority was activated.',
          });
        });
      }
      ensure(
        BigInt(chain.free) >= total,
        'FULL_PREFUNDING_REQUIRED',
        'Fund the full payroll window before authorization. Required ' +
          formatNear(total.toString()) +
          ' testNEAR; available ' +
          formatNear(chain.free) +
          ' testNEAR.',
        409,
      );
      const priorFunding = this.s.get('funding-request:' + c.id);
      if (priorFunding) this.s.save({ ...priorFunding, state: 'READY_FOR_REVIEW', shortfall: '0' });
      const steps = [];
      for (let i = 0; i < rows.length; i += 20)
        steps.push(
          this.step(
            'authorize_mandate',
            {
              company_id: c.chainId,
              obligations: rows.slice(i, i + 20).map(({ id, employee_id, amount, due_at }) => ({
                id,
                employee_id,
                amount,
                due_at,
              })),
              execution_not_after: ns(executionExpiry),
            },
            'Authorize payroll batch ' + (1 + i / 20),
          ),
        );
      result = {
        plan: this.plan(
          a,
          'Authorize scheduled payroll',
          steps,
          {
            rows,
            total: total.toString(),
            freeAfter: (BigInt(chain.free) - total).toString(),
            days: p.days,
          },
          c.id,
          {
            basis: hash(employees.map((e) => [e.id, e.version])),
            employeeIds: employees.map((e) => e.id),
            chainVersion: chain.version,
            companyVersion: c.version,
            companyTimezone: c.timezone,
          },
        ),
      };
    } else if (action === 'salary.preview') {
      const c = this.company(a, companyId!, true);
      const employees = this.s
        .list('employee', c.id)
        .filter(
          (e) =>
            e.status === 'ACTIVE' &&
            (p.selection === 'all' ||
              (p.selection === 'role' && e.roleId === p.roleId) ||
              (p.selection === 'selected' && p.employeeIds?.includes(e.id))),
        );
      ensure(employees.length, 'EMPTY_SELECTION', 'Select at least one employee.');
      ensure(p.effectiveFrom >= stamp(), 'PAST_EFFECTIVE_DATE', 'Use a future effective date.');
      const steps: any[] = [],
        rows: any[] = [],
        updates: any[] = [];
      let delta = 0n;
      for (const e of employees) {
        ensure(
          !e.pendingSalary,
          'PENDING_SALARY_CHANGE',
          'A salary change is already scheduled. Wait for its effective date before scheduling another.',
          409,
        );
        const after = changeSalary(e.salary, p.kind, p.delta, p.direction);
        ensure(BigInt(after) > 0n, 'INVALID_SALARY', 'Salary must remain positive.');
        rows.push({ id: e.id, name: e.name, before: e.salary, after, cadence: e.cadence });
        updates.push({ id: e.id, salary: after, version: e.version });
        const obligations = await allObligations(this.contract(), e.accountId, this.query);
        for (const o of obligations.filter(
          (o: any) =>
            o.company_id === c.chainId &&
            o.employee_id === e.chainId &&
            !o.credited &&
            !o.cancelled &&
            BigInt(o.due_at) >= BigInt(ns(p.effectiveFrom)),
        )) {
          const revised = BigInt(o.amount) + BigInt(after) - BigInt(e.salary);
          ensure(revised > 0n, 'INVALID_SALARY', 'This change would erase an adjusted payment.');
          delta += revised - BigInt(o.amount);
          steps.push(
            this.step(
              'replace_future_obligations',
              { obligation_id: o.id, amount: revised.toString(), expected_version: o.version },
              'Revise ' +
                e.name +
                ' / ' +
                new Date(Number(BigInt(o.due_at) / 1000000n)).toLocaleDateString('en-GB'),
            ),
          );
        }
      }
      const chain = await this.query(this.contract(), 'get_company', { company_id: c.chainId });
      ensure(
        BigInt(chain.free) >= delta,
        'FULL_PREFUNDING_REQUIRED',
        'Fund the additional reserved salaries first.',
      );
      // A local agreement can change even when there are no signed future obligations.
      if (!steps.length)
        steps.push({
          method: 'local_salary',
          args: {},
          deposit: '0',
          label: 'Update future salary agreement',
        });
      const allReserved = (
        await Promise.all(
          this.s
            .list('employee', c.id)
            .filter((e) => e.accountId)
            .map((e) => allObligations(this.contract(), e.accountId, this.query)),
        )
      )
        .flat()
        .filter((o) => o.company_id === c.chainId);
      result = {
        plan: this.plan(
          a,
          'Review salary changes',
          steps,
          {
            rows,
            reservationDelta: delta.toString(),
            freeAfter: (BigInt(chain.free) - delta).toString(),
            effectiveFrom: p.effectiveFrom,
            forecast: companyForecast({
              employees: this.s.list('employee', c.id),
              obligations: allReserved,
              free: chain.free,
              timezone: c.timezone,
              from: stamp(),
              horizonDays: p.horizonDays,
              change: p,
            }),
          },
          c.id,
          { salaryUpdates: updates, effectiveFrom: p.effectiveFrom, companyVersion: c.version },
        ),
      };
    } else if (action === 'payroll.pause') {
      const c = this.company(a, companyId!, true, true),
        o = await this.query(this.contract(), 'get_obligation', { obligation_id: p.id });
      ensure(o?.company_id === c.chainId, 'NOT_FOUND', 'Payment not found in this company.', 404);
      result = {
        plan: this.plan(
          a,
          p.paused ? 'Pause automation' : 'Resume automation',
          [
            this.step(
              'pause_mandate',
              { obligation_id: p.id, paused: p.paused },
              'Change payment automation',
            ),
          ],
          {},
          c.id,
        ),
      };
    } else if (action === 'payroll.claim') {
      const o = await this.query(this.contract(), 'get_obligation', { obligation_id: p.id });
      ensure(
        o?.account_id === u.accountId,
        'FORBIDDEN',
        'Only the employee can claim this salary.',
        403,
      );
      result = {
        plan: this.plan(a, 'Claim earned salary', [
          this.step('claim_due', { obligation_id: p.id }, 'Credit salary to vault'),
        ]),
      };
    } else if (action === 'employee.withdraw') {
      const account = await this.query(this.contract(), 'get_account', { account_id: u.accountId });
      ensure(
        BigInt(p.amount) > 0n && BigInt(p.amount) <= BigInt(account.cash),
        'INSUFFICIENT_FUNDS',
        'Choose an amount within your free testNEAR balance.',
      );
      result = {
        plan: this.plan(
          a,
          'Withdraw to your NEAR account',
          [
            this.step(
              'request_withdrawal',
              { amount: p.amount, operation_id: 'w_' + randomBytes(16).toString('hex') },
              'Withdraw testNEAR',
            ),
          ],
          { amount: p.amount },
        ),
      };
    } else if (action === 'goal.policy' || action === 'goal.pause' || action === 'goal.release') {
      const account = await this.query(this.contract(), 'get_account', { account_id: u.accountId }),
        policy = account.policy;
      if (action === 'goal.policy') {
        const goals = p.goals.map((g: any) => {
          const old = policy.goals.find((v: any) => v.id === g.id);
          const previousRule = account.goalRules?.find((v: any) => v.id === g.id);
          ensure(!g.id || old, 'INVALID_GOAL', 'Existing goal not found.');
          ensure(
            BigInt(g.target) > 0n && BigInt(g.target) >= BigInt(old?.funded || '0'),
            'INVALID_TARGET',
            'Keep the target at or above reserved savings.',
          );
          ensure(
            g.contributionMode !== 'PERCENT' || BigInt(g.contributionValue) <= 10000n,
            'INVALID_PERCENT',
            'A goal percentage must be between 0 and 100%.',
          );
          const state =
            g.state ||
            previousRule?.state ||
            (old?.completed ? 'COMPLETED' : old?.paused || old?.released ? 'PAUSED' : 'ACTIVE');
          ensure(
            !old || old.target === g.target || g.confirmChanges,
            'CONFIRM_REQUIRED',
            'Explicitly confirm the new target.',
          );
          ensure(
            state !== 'COMPLETED' || old?.completed,
            'INVALID_STATE',
            'Only a funded goal can be completed.',
          );
          ensure(
            !old ||
              !(
                old.completed ||
                old.released ||
                ['DRAFT', 'ARCHIVED'].includes(previousRule?.state)
              ) ||
              state !== 'ACTIVE' ||
              g.confirmChanges,
            'REACTIVATION_REQUIRED',
            'Explicitly confirm goal reactivation.',
          );
          const gid = g.id || 'g_' + randomBytes(12).toString('hex');
          return {
            id: gid,
            target: g.target,
            priority: g.priority,
            confirm_changes: g.confirmChanges,
            rule: {
              id: gid,
              contribution_mode: g.contributionMode,
              contribution_value: g.contributionValue,
              percent_basis: g.percentBasis,
              overflow: g.overflow,
              target_date: g.targetDate || null,
              state,
            },
          };
        });
        ensure(
          policy.goals.every((g: any) => goals.some((v: any) => v.id === g.id)),
          'GOAL_HISTORY_REQUIRED',
          'Keep existing goals; pause or release them instead.',
        );
        result = {
          plan: this.plan(
            a,
            'Set savings policy on NEAR',
            [
              this.step(
                'set_goal_policy_v2',
                {
                  goal_bps: p.goalBps,
                  cash_floor: p.cashFloor,
                  goals,
                  expected_version: policy.version,
                },
                'Save atomic salary allocation',
              ),
            ],
            {
              goalBps: p.goalBps,
              cashFloor: p.cashFloor,
              savings: goals.map((g: any, i: number) => ({ ...p.goals[i], state: g.rule.state })),
              forecast: this.goalForecast(a, p, goals, account),
            },
            '',
            { goalNames: goals.map((g: any, i: number) => ({ id: g.id, name: p.goals[i].name })) },
          ),
        };
      } else {
        ensure(
          policy.goals.some((g: any) => g.id === p.id),
          'NOT_FOUND',
          'Savings goal not found.',
          404,
        );
        result = {
          plan: this.plan(
            a,
            action === 'goal.pause' ? 'Change savings status' : 'Release savings to free cash',
            [
              this.step(
                action === 'goal.pause' ? 'pause_goal' : 'release_goal',
                {
                  goal_id: p.id,
                  expected_version: policy.version,
                  ...(action === 'goal.pause' ? { paused: p.paused } : {}),
                },
                'Confirm savings change',
              ),
            ],
          ),
        };
      }
    }
    ensure(result, 'UNKNOWN_ACTION', 'Unsupported action.');
    this.s.atomic(() => {
      this.s.db
        .prepare('INSERT OR IGNORE INTO requests VALUES(?,?,?,?)')
        .run(key, a.id, inputHash, JSON.stringify(result));
      this.s.audit(a.id, companyId || '', action, result.plan?.id || result.id || '', {
        mode: 'TESTNET',
      });
    });
    this.stateCache.clear();
    return result;
  }
  async prepare(a: Actor, planId: string, index: number) {
    const u = this.identity(a),
      plan = this.basic.own(a, planId, 'live-plan');
    ensure(
      plan.expiresAt > stamp() || plan.state === 'IN_PROGRESS',
      'PREVIEW_EXPIRED',
      'Review a fresh decision before signing.',
      409,
    );
    ensure(
      ['PREVIEW', 'IN_PROGRESS'].includes(plan.state),
      'ALREADY_APPLIED',
      'This plan is complete or discarded.',
      409,
    );
    ensure(
      plan.steps[index] && plan.steps.slice(0, index).every((s: any) => s.state === 'CONFIRMED'),
      'STEP_ORDER',
      'Finish the earlier transaction first.',
      409,
    );
    if (
      plan.tenant &&
      [
        'register_company',
        'register_employee',
        'fund_treasury',
        'fund_treasury_once',
        'authorize_mandate',
        'replace_future_obligations',
        'renew_mandate',
        'pause_mandate',
        'cancel_future_obligation',
        'withdraw_company_surplus',
        'local_employee_status',
        'local_salary',
      ].includes(plan.steps[index].method)
    )
      this.company(a, plan.tenant, true, true);
    if (plan.commit?.invitationId) {
      const inv = this.s.get(plan.commit.invitationId);
      ensure(
        inv?.state === 'PENDING' && inv.expiresAt > stamp(),
        'INVALID_INVITATION',
        'This invitation expired or was revoked. Ask your employer for a new link.',
        409,
      );
      ensure(
        this.s.get(inv.tenant)?.status === 'ACTIVE',
        'COMPANY_SUSPENDED',
        'This company invitation is not currently available.',
        403,
      );
    }
    const step = plan.steps[index];
    const sync = this.s.get('chain-sync:' + plan.contractId);
    if (!['claim_due', 'request_withdrawal', 'release_goal'].includes(step.method))
      ensure(
        sync?.state !== 'BLOCKED',
        'RECONCILIATION_REQUIRED',
        'Financial reconciliation is blocked. Resolve the mismatch before signing another change.',
        409,
      );
    ensure(step.state !== 'CONFIRMED', 'ALREADY_APPLIED', 'This step is complete.', 409);
    this.validateBasis(plan);
    if (
      ['set_goal_policy', 'set_goal_policy_v2', 'pause_goal', 'release_goal'].includes(step.method)
    ) {
      const current = await this.query(this.contract(), 'get_account', { account_id: u.accountId });
      ensure(
        current.policy.version === step.args.expected_version,
        'PREVIEW_STALE',
        'Your salary or savings policy changed. Review a new savings decision.',
        409,
      );
    }
    const old = step.operationId && this.s.get(step.operationId);
    if (old) {
      ensure(
        old.state !== 'FAILED' || old.failureKind !== 'TRANSFER_REFUNDED',
        'NEW_WITHDRAWAL_REQUIRED',
        'The contract restored this withdrawal. Discard this decision and create a new withdrawal with a fresh operation ID.',
        409,
      );
      if (old.state === 'FAILED' && old.failureKind === 'CONTRACT_CALL') {
        // A failed initial receipt rolled back the contract call. Preserve its
        // evidence and give the reviewed step a new local operation record.
        this.s.atomic(() => {
          const latest = this.s.get(planId)!;
          ensure(
            this.s.get(old.id)?.state === 'FAILED',
            'RECONCILIATION_REQUIRED',
            'Verify the existing transaction before retrying.',
            409,
          );
          const steps = latest.steps.map((s: any, i: number) =>
            i === index
              ? {
                  ...s,
                  operationId: undefined,
                  previousOperationIds: [...(s.previousOperationIds || []), old.id],
                }
              : s,
          );
          this.s.save({ ...latest, steps });
        });
      } else {
        ensure(
          !['DISPATCHED', 'SUBMITTED'].includes(old.state),
          'RECONCILIATION_REQUIRED',
          'A wallet request was already opened. Verify its transaction hash before sending another request.',
          409,
        );
        return this.withTransaction(old);
      }
    }
    if (['local_salary', 'local_employee_status'].includes(step.method)) {
      this.s.atomic(() => {
        const steps = plan.steps.map((s: any, i: number) =>
          i === index ? { ...s, state: 'CONFIRMED' } : s,
        );
        this.finish({ ...plan, steps }, a);
      });
      return { local: true };
    }
    await assertTestnet();
    const anchor = await operationAnchor();
    const op = this.s.atomic(() => {
      const latest = this.s.get(planId)!;
      ensure(
        ['PREVIEW', 'IN_PROGRESS'].includes(latest.state),
        'ALREADY_APPLIED',
        'This decision is no longer active.',
        409,
      );
      this.validateBasis(latest);
      const already = latest.steps[index].operationId;
      if (already) return this.s.get(already)!;
      const op = this.s.save({
        type: 'chain-operation',
        owner: a.id,
        tenant: plan.tenant || 'testnet',
        contractId: plan.contractId,
        method: step.method,
        args: step.args,
        argsHash: hash(step.args),
        deposit: step.deposit || '0',
        state: 'PREPARED',
        accountId: u.accountId,
        planId,
        index,
        ...anchor,
      });
      const steps = latest.steps.map((s: any, i: number) =>
        i === index ? { ...s, operationId: op.id } : s,
      );
      this.s.save({ ...latest, steps, state: 'IN_PROGRESS' });
      return op;
    });
    return this.withTransaction(op);
  }
  dispatch(a: Actor, operationId: string) {
    this.identity(a);
    return this.s.atomic(() => {
      const op = this.basic.own(a, operationId, 'chain-operation');
      ensure(
        op.state === 'PREPARED',
        'RECONCILIATION_REQUIRED',
        'This wallet request is already in progress.',
        409,
      );
      return this.s.save({ ...op, state: 'DISPATCHED', dispatchedAt: stamp() });
    });
  }
  declined(a: Actor, operationId: string) {
    this.identity(a);
    return this.s.atomic(() => {
      const op = this.basic.own(a, operationId, 'chain-operation');
      ensure(
        op.state === 'DISPATCHED' && !op.txHash,
        'RECONCILIATION_REQUIRED',
        'Verify the existing transaction first.',
        409,
      );
      return this.s.save({ ...op, state: 'PREPARED', declinedAt: stamp() });
    });
  }
  withTransaction(op: Entity) {
    return {
      ...op,
      operationId: op.id,
      transaction: {
        receiverId: op.contractId,
        signerId: op.accountId,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: op.method,
              args: op.args,
              gas: '100000000000000',
              deposit: op.deposit,
            },
          },
        ],
      },
    };
  }
  finish(plan: any, a: Actor) {
    if (!plan.steps.every((s: any) => s.state === 'CONFIRMED'))
      return this.s.save({ ...plan, state: 'IN_PROGRESS' });
    const c = plan.commit || {};
    if (c.employeeStatus) {
      const e = this.s.get(c.employeeStatus.id)!;
      this.basic.version(e, c.employeeStatus.version);
      this.s.save({
        ...e,
        status: c.employeeStatus.status,
        ...(e.status === 'ENDED' && c.employeeStatus.status === 'ACTIVE'
          ? { scheduleId: randomUUID() }
          : {}),
      });
    }
    if (c.companyId) {
      const company = this.s.get(c.companyId)!;
      this.s.save({ ...company, chainState: 'REGISTERED' });
    }
    if (c.employeeId) {
      const e = this.s.get(c.employeeId)!;
      this.s.save({ ...e, owner: a.id, status: 'ACTIVE', identityVerified: true });
      this.s.save({ ...this.s.get(c.invitationId)!, state: 'ACCEPTED' });
      if (!this.s.list('membership', e.tenant, a.id).some((m) => m.access === 'employee'))
        this.s.save({
          type: 'membership',
          tenant: e.tenant,
          owner: a.id,
          access: 'employee',
          status: 'ACTIVE',
        });
    }
    for (const e of c.salaryUpdates || []) {
      const old = this.s.get(e.id)!;
      ensure(
        old.version === e.version,
        'PROJECTION_CONFLICT',
        'Salary metadata changed during signing; reconcile the agreement before continuing.',
        409,
      );
      this.s.save({ ...old, pendingSalary: { salary: e.salary, effectiveFrom: c.effectiveFrom } });
    }
    for (const g of c.goalNames || [])
      this.s.save({
        id: 'goal-name:' + a.id + ':' + g.id,
        type: 'live-goal',
        owner: a.id,
        chainId: g.id,
        name: g.name,
      });
    return this.s.save({ ...plan, state: 'COMPLETED', completedAt: stamp() });
  }
  async confirm(a: Actor, operationId: string, txHash: string) {
    this.identity(a);
    const op = this.basic.own(a, operationId, 'chain-operation');
    const result = await verifyOperationCandidate(this.s, operationId, txHash, confirmOperation);
    this.stateCache.clear();
    return this.s.atomic(() => {
      const saved = this.s.save({ ...this.s.get(op.id)!, ...result });
      if (op.planId) {
        const plan = this.s.get(op.planId)!;
        if (plan.state !== 'COMPLETED') {
          const steps = plan.steps.map((s: any, i: number) =>
            i === op.index ? { ...s, state: 'CONFIRMED', txHash } : s,
          );
          this.finish({ ...plan, steps }, a);
        }
      }
      return saved;
    });
  }
  recoverProjections() {
    for (const op of this.s
      .list('chain-operation')
      .filter((o) => o.state === 'CONFIRMED' && o.planId)) {
      const plan = this.s.get(op.planId);
      if (!plan || plan.state === 'COMPLETED' || plan.steps[op.index]?.state === 'CONFIRMED')
        continue;
      this.s.atomic(() => {
        const steps = plan.steps.map((s: any, i: number) =>
          i === op.index ? { ...s, state: 'CONFIRMED', txHash: op.txHash } : s,
        );
        this.finish({ ...plan, steps }, { id: op.owner, mode: 'TESTNET' });
      });
    }
  }
  async assistant(a: Actor, message: string, companyId: string) {
    const state: any = await this.state(a, 'company', companyId);
    ensure(state.company, 'COMPANY_REQUIRED', 'Create a company workspace first.');
    const employees = state.employees.filter((e: any) => e.status === 'ACTIVE');
    const text = message.toLowerCase();
    const match = text.match(/(increase|raise|reduce|decrease).*?(\d+(?:\.\d{1,2})?)\s*%/);
    const role = state.roles.find((r: any) => text.includes(r.name.toLowerCase()));
    let proposal: any = null;
    let response =
      employees.length +
      ' active employees. Free treasury: ' +
      formatNear(state.chain?.free || '0') +
      ' testNEAR. Reserved payroll: ' +
      formatNear(state.chain?.reserved || '0') +
      ' testNEAR. Automation can execute only your fully funded, signed mandates. I can prepare a percentage salary change for a named job role or all employees.';
    if (match && (role || /\b(all|everyone|every employee|entire team)\b/.test(text))) {
      proposal = {
        action: 'salary.preview',
        payload: {
          selection: role ? 'role' : 'all',
          ...(role ? { roleId: role.id } : {}),
          kind: 'percent',
          delta: String(Math.round(Number(match[2]) * 100)),
          direction: ['reduce', 'decrease'].includes(match[1]) ? 'decrease' : 'increase',
          effectiveFrom: new Date(Date.now() + 600000).toISOString(),
          horizonDays: 90,
        },
      };
      response =
        'Prepared a ' +
        match[2] +
        '% salary change for ' +
        (role?.name || 'all active employees') +
        '. Review the exact calendar cost, affected people and reserved obligations before the owner signs.';
    } else if (match)
      response =
        'Name a job role or explicitly say all employees. No salary change has been prepared.';
    return {
      message: response,
      proposal,
      engine: 'Deterministic NEAR payroll assistant',
      authority: 'Read and prepare only',
      requiresHumanConfirmation: !!proposal,
    };
  }
  async export(a: Actor, scope: string, companyId?: string, filters: any = {}) {
    const state: any = await this.state(a, scope, companyId);
    if (filters.kind === 'journal') {
      const rows = [
        [
          'unit',
          'network',
          'decimals',
          'time_utc',
          'entry',
          'kind',
          'account',
          'side',
          'amount',
          'amount_atomic',
          'event_key',
        ],
      ];
      for (const e of state.ledger || [])
        for (const l of e.lines)
          rows.push([
            'testNEAR',
            'testnet',
            '24',
            e.created_at,
            e.id,
            e.kind,
            l.account,
            l.side,
            formatNear(l.amount),
            l.amount,
            e.event_key,
          ]);
      return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    }
    const rows = [
      [
        'unit',
        'network',
        'decimals',
        'company',
        'employee',
        'obligation',
        'amount',
        'amount_atomic',
        'due_at_utc',
        'state',
      ],
    ];
    for (const o of state.obligations || []) {
      const due = new Date(Number(BigInt(o.due_at) / 1000000n)).toISOString().slice(0, 10),
        employee = state.employees?.find((e: any) => e.chainId === o.employee_id);
      if (
        (filters.from && due < filters.from) ||
        (filters.to && due > filters.to) ||
        (filters.roleId && employee?.roleId !== filters.roleId) ||
        (filters.search &&
          ![o.account_id, o.id, employee?.name].some((v) =>
            v?.toLowerCase().includes(filters.search.toLowerCase()),
          ))
      )
        continue;
      rows.push([
        'testNEAR',
        'testnet',
        '24',
        o.company_id,
        o.account_id,
        o.id,
        (BigInt(o.amount) / 10n ** 24n).toString() +
          '.' +
          (BigInt(o.amount) % 10n ** 24n).toString().padStart(24, '0'),
        o.amount,
        new Date(Number(BigInt(o.due_at) / 1000000n)).toISOString(),
        o.credited ? 'CREDITED' : o.cancelled ? 'CANCELLED' : o.paused ? 'PAUSED' : 'RESERVED',
      ]);
    }
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }
}
