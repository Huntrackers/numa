import { z } from 'zod';
const money = z.string().regex(/^(0|[1-9][0-9]{0,59})$/);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(100);
const cadence = z.enum(['daily', 'weekly', 'monthly']);
const leg = z
  .object({
    id,
    type: z.enum(['cash', 'goals', 'dca', 'invest', 'earn']),
    bps: z.number().int().min(0).max(10000),
    asset: z.string().max(100).optional(),
    assetId: z.string().max(500).optional(),
    network: z.string().max(50).optional(),
    maxFeeBps: z.number().int().min(0).max(10000).default(25),
    destinationId: id.optional(),
  })
  .strict();
export const schemas = {
  'company.create': z.object({ name, timezone: z.string().max(80) }).strict(),
  'company.settings': z
    .object({ name, timezone: z.string().max(80), expectedVersion: z.number().int() })
    .strict(),
  'role.save': z
    .object({
      id: id.optional(),
      name,
      description: z.string().trim().max(1000).default(''),
      salary: money,
      cadence,
      expectedVersion: z.number().int().optional(),
    })
    .strict(),
  'employee.invite': z
    .object({
      name,
      email: z.union([z.email(), z.literal('')]).optional(),
      startDate: z.iso.date().optional(),
      roleId: id,
      salary: money,
      cadence,
      anchor: z.iso.datetime({ offset: true }),
      accountId: z.string().max(64).optional(),
    })
    .strict(),
  'employee.status': z
    .object({
      id,
      status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']),
      expectedVersion: z.number().int(),
    })
    .strict(),
  'employee.accept': z.object({ token: z.string().min(20).max(200) }).strict(),
  'import.preview': z.object({ csv: z.string().max(1_000_000) }).strict(),
  'import.commit': z.object({ previewId: id }).strict(),
  'treasury.fund': z.object({ amount: money, purpose: z.enum(['cash', 'bonus']) }).strict(),
  'payroll.pause': z
    .object({ id, paused: z.boolean(), expectedVersion: z.number().int() })
    .strict(),
  'payroll.claim': z.object({ id }).strict(),
  'payroll.adjust': z
    .object({
      id,
      kind: z.enum(['bonus', 'deduction']),
      amount: money,
      reason: name,
      expectedVersion: z.number().int(),
    })
    .strict(),
  'preview.create': z
    .object({
      kind: z.enum([
        'salary-change',
        'allocation',
        'payroll',
        'trade',
        'early-pay',
        'hold',
        'loan',
      ]),
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
  'preview.apply': z.object({ previewId: id }).strict(),
  'goal.save': z
    .object({
      id: id.optional(),
      name,
      target: money,
      priority: z.number().int().min(1).max(10),
      contributionMode: z.enum(['FIXED', 'PERCENT']).default('PERCENT'),
      contributionValue: money.default('10000'),
      percentBasis: z.enum(['SALARY', 'GOAL_BUDGET']).default('GOAL_BUDGET'),
      overflow: z.enum(['CASH', 'NEXT']).default('CASH'),
      targetDate: z.string().date().nullable().optional(),
      state: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
      confirmChanges: z.boolean().default(false),
      expectedVersion: z.number().int().optional(),
    })
    .strict(),
  'goal.pause': z.object({ id, paused: z.boolean(), expectedVersion: z.number().int() }).strict(),
  'goal.release': z.object({ id, expectedVersion: z.number().int() }).strict(),
  'allocation.release': z.object({ id }).strict(),
  'destination.save': z
    .object({
      network: z.enum(['NEAR', 'Ethereum', 'Base', 'Solana', 'Bitcoin', 'Tron']),
      address: z.string().trim().min(2).max(150),
      label: name,
      asset: z.string().max(30),
    })
    .strict(),
  'destination.archive': z.object({ id, expectedVersion: z.number().int() }).strict(),
  'dca.save': z
    .object({
      id: id.optional(),
      name,
      asset: z.string().max(100),
      network: z.string().max(50).optional(),
      destinationId: id.optional(),
      sourcePocket: z.literal('dca').default('dca'),
      amount: money,
      cadence,
      anchor: z.iso.datetime({ offset: true }),
      endAt: z.iso.datetime({ offset: true }).optional(),
      maxTotal: money.optional(),
      maxFeeBps: z.number().int().min(0).max(10000).default(25),
      expectedVersion: z.number().int().optional(),
    })
    .strict(),
  'dca.pause': z.object({ id, paused: z.boolean(), expectedVersion: z.number().int() }).strict(),
  'dca.fund': z.object({ amount: money }).strict(),
  'dca.run': z.object({ id }).strict(),
  'money-plan.save': z
    .object({
      expenses: money,
      outsideSavings: money,
      monthlyIncome: money,
      repayment: money,
      expectedVersion: z.number().int().optional(),
    })
    .strict(),
  'hold.exit': z.object({ id }).strict(),
  'earn.open': z
    .object({
      amount: money,
      scenario: z.enum(['BASE', 'LOSS', 'ILLIQUID', 'DELAYED', 'STALE']).default('BASE'),
    })
    .strict(),
  'loan.plan': z
    .object({
      id,
      amount: money,
      maxSalaryBps: z.number().int().min(0).max(10000),
      enabled: z.boolean(),
      consent: z.boolean(),
      expectedVersion: z.number().int(),
    })
    .strict(),
  'loan.reserve-release': z.object({ id }).strict(),
  'earn.exit': z.object({ id }).strict(),
  'loan.spend': z.object({ amount: money, description: name }).strict(),
  'loan.repay': z.object({ id, amount: money }).strict(),
  'employee.withdraw': z.object({ amount: money }).strict(),
  'salary.confirm-earned': z
    .object({ id, amount: money, expectedVersion: z.number().int() })
    .strict(),
  'notification.read': z.object({ id }).strict(),
  'admin.company-status': z
    .object({ id, status: z.enum(['ACTIVE', 'SUSPENDED']), expectedVersion: z.number().int() })
    .strict(),
  'admin.runtime': z
    .object({
      pauseDemoWorker: z.boolean(),
      pauseTestnetWorker: z.boolean(),
      expectedVersion: z.number().int(),
    })
    .strict(),
  'admin.settings': z
    .object({
      maxEmployees: z.number().int().min(1).max(50),
      maintenance: z.boolean(),
      expectedVersion: z.number().int(),
    })
    .strict(),
  'admin.providers': z
    .object({
      publicCatalogEnabled: z.boolean(),
      priceTtlSeconds: z.number().int().min(10).max(900),
      quoteTtlSeconds: z.number().int().min(10).max(120),
      quoteScenario: z.enum(['NORMAL', 'NO_ROUTE', 'STALE', 'EXPIRED', 'SLIPPAGE']),
      modelEnabled: z.boolean(),
      disabledAssets: z.array(z.string().max(500)).max(1000),
      expectedVersion: z.number().int(),
    })
    .strict(),
  'admin.reconcile': z.object({ id }).strict(),
  'assistant.message': z
    .object({ message: z.string().trim().min(1).max(2000), scope: z.enum(['company', 'employee']) })
    .strict(),
};
export const command = z
  .object({
    action: z.enum(Object.keys(schemas) as [keyof typeof schemas, ...(keyof typeof schemas)[]]),
    companyId: id.optional(),
    payload: z.unknown(),
  })
  .strict();
export const previewInputs = {
  'salary-change': z
    .object({
      horizonDays: z.number().int().min(1).max(365).default(90),
      selection: z.enum(['all', 'role', 'selected']),
      roleId: id.optional(),
      employeeIds: z.array(id).max(50).optional(),
      kind: z.enum(['percent', 'fixed']),
      delta: money,
      direction: z.enum(['increase', 'decrease']),
      effectiveFrom: z.iso.datetime({ offset: true }),
    })
    .strict(),
  allocation: z
    .object({
      legs: z.array(leg).min(1).max(10),
      cashFloor: money,
      horizonDays: z.number().int().min(1).max(365).default(90),
      salary: money,
      expectedVersion: z.number().int(),
    })
    .strict(),
  payroll: z
    .object({
      accelerated: z.boolean().default(false),
      days: z.number().int().min(1).max(31).default(30),
    })
    .strict(),
  trade: z
    .object({
      asset: id,
      side: z.enum(['buy', 'sell']),
      amount: money,
      network: z.string().max(50).optional(),
      destinationId: id.optional(),
      maxFeeBps: z.number().int().min(0).max(10000).default(25),
      slippageBps: z.number().int().min(0).max(1000).default(50),
    })
    .strict(),
  'early-pay': z.object({ obligationId: id, gross: money }).strict(),
  hold: z.object({ amount: money, days: z.number().int().min(1).max(90) }).strict(),
  loan: z.object({ collateral: money, principal: money }).strict(),
};
export type CommandAction = keyof typeof schemas;
export type PreviewKind = keyof typeof previewInputs;

const chainId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const accountId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9._-]+$/);
const nearMoney = z.string().regex(/^(0|[1-9][0-9]{0,38})$/);
const goal = z
  .object({
    id: chainId,
    target: nearMoney,
    funded: nearMoney,
    priority: z.number().int().min(1).max(10),
    paused: z.boolean(),
    completed: z.boolean(),
    released: z.boolean(),
  })
  .strict();
export const chainArgs = {
  register_company: z.object({ company_id: chainId, operation_id: chainId }).strict(),
  register_employee: z
    .object({ company_id: chainId, employee_id: chainId, account_id: accountId })
    .strict(),
  accept_employment: z.object({ company_id: chainId, employee_id: chainId }).strict(),
  fund_treasury: z.object({ company_id: chainId }).strict(),
  authorize_mandate: z
    .object({
      company_id: chainId,
      obligations: z
        .array(
          z
            .object({ id: chainId, employee_id: chainId, amount: nearMoney, due_at: nearMoney })
            .strict(),
        )
        .min(1)
        .max(20),
      execution_not_after: nearMoney,
    })
    .strict(),
  execute_due: z.object({ obligation_id: chainId }).strict(),
  claim_due: z.object({ obligation_id: chainId }).strict(),
  set_goal_policy: z
    .object({
      goal_bps: z.number().int().min(0).max(10000),
      cash_floor: nearMoney,
      goals: z.array(goal).max(10),
      expected_version: z.number().int().min(0),
    })
    .strict(),
  pause_goal: z
    .object({ goal_id: chainId, paused: z.boolean(), expected_version: z.number().int() })
    .strict(),
  release_goal: z.object({ goal_id: chainId, expected_version: z.number().int() }).strict(),
  request_withdrawal: z.object({ amount: nearMoney, operation_id: chainId }).strict(),
  withdraw_company_surplus: z
    .object({ company_id: chainId, amount: nearMoney, operation_id: chainId })
    .strict(),
  pause_mandate: z.object({ obligation_id: chainId, paused: z.boolean() }).strict(),
};
export const chainCalendar = z
  .object({
    companyId: chainId,
    employeeId: chainId,
    scheduleId: chainId,
    amount: nearMoney,
    cadence: z.enum(['daily', 'weekly', 'monthly']),
    anchor: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(80),
    days: z.number().int().min(1).max(30),
  })
  .strict();
