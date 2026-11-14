import { savingsFields, savingsValues, savingsSummary } from '../SavingsRules';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShieldCheck, CalendarDays, Wallet, ArrowRight, ExternalLink } from 'lucide-react';
import {
  Button,
  Panel,
  Metric,
  Table,
  Badge,
  Notice,
  Empty,
  Person,
  Progress,
} from '../components';
import { date, time, localInput } from '../api';
import type { UIContext } from '../types';
export const nearAtomic = (value: string) => {
  if (!/^\d+(\.\d{0,24})?$/.test(value)) throw Error('Use up to 24 decimal places.');
  const [w, f = ''] = value.split('.');
  return (BigInt(w) * 10n ** 24n + BigInt(f.padEnd(24, '0'))).toString();
};
export const nearDecimal = (value: string = '0') => {
  const n = BigInt(value),
    abs = n < 0n ? -n : n;
  return (
    (n < 0n ? '-' : '') +
    abs / 10n ** 24n +
    '.' +
    (abs % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '').padEnd(2, '0')
  );
};
export const nearMoney = (v: string = '0') => nearDecimal(v) + ' testNEAR';
export const dueDate = (v: string) => new Date(Number(BigInt(v) / 1000000n)).toISOString();
const txLink = (hash: string) => (
  <a
    className="text-button"
    href={'https://testnet.nearblocks.io/txns/' + hash}
    target="_blank"
    rel="noreferrer"
  >
    View transaction <ExternalLink size={14} />
  </a>
);
export default function Live({ ctx }: { ctx: UIContext }) {
  const { data: d, page, scope, run, form } = ctx;
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState(''),
    [dateFrom, setDateFrom] = useState(''),
    [dateTo, setDateTo] = useState('');
  const company = scope === 'company',
    c = d.company;
  const create = () => navigate('/workspaces/new');
  const fund = () =>
    form({
      title: 'Fund payroll treasury',
      description:
        'Transfer testNEAR from your wallet into the payroll contract. This is testnet money.',
      fields: [
        {
          id: 'amount',
          label: 'Amount in testNEAR',
          value: '1',
          type: 'number',
          step: '0.0001',
          min: '0.0001',
        },
      ],
      submitLabel: 'Review funding',
      submit: (v) => run('treasury.fund', { amount: nearAtomic(v.amount) }),
    });
  const roleForm = (r?: any) =>
    form({
      title: r ? 'Edit job role' : 'Create job role',
      fields: [
        { id: 'name', label: 'Job role', value: r?.name },
        { id: 'description', label: 'Description', value: r?.description || '', required: false },
        {
          id: 'salary',
          label: 'Salary per period (testNEAR)',
          value: r ? nearDecimal(r.salary) : '0.1',
          type: 'number',
          min: '0.0001',
          step: '0.0001',
        },
        {
          id: 'cadence',
          label: 'Pay frequency',
          value: r?.cadence || 'monthly',
          options: ['daily', 'weekly', 'monthly'].map((value) => ({ value, label: value })),
        },
      ],
      submitLabel: 'Save job role',
      submit: (v) =>
        run('role.save', {
          ...v,
          salary: nearAtomic(v.salary),
          ...(r ? { id: r.id, expectedVersion: r.version } : {}),
        }),
    });
  const invite = () =>
    form({
      title: 'Invite an employee',
      description:
        'The owner registers the account on NEAR. Share the one-time invitation after signing; the employee accepts with that same account.',
      fields: [
        { id: 'name', label: 'Employee name' },
        { id: 'email', label: 'Email (optional)', type: 'email', required: false },
        {
          id: 'startDate',
          label: 'Employment start date',
          type: 'date',
          value: new Date().toISOString().slice(0, 10),
        },
        {
          id: 'accountId',
          label: 'Employee NEAR testnet account',
          hint: 'Use the exact account ID. A destination address is not proof of ownership.',
        },
        {
          id: 'roleId',
          label: 'Job role',
          options: d.roles.map((r: any) => ({ value: r.id, label: r.name })),
        },
        {
          id: 'salary',
          label: 'Salary per period (testNEAR)',
          value: d.roles[0] ? nearDecimal(d.roles[0].salary) : '0.1',
          type: 'number',
          step: '0.0001',
          min: '0.0001',
        },
        {
          id: 'cadence',
          label: 'Pay frequency',
          value: d.roles[0]?.cadence || 'monthly',
          options: ['daily', 'weekly', 'monthly'].map((value) => ({ value, label: value })),
        },
        {
          id: 'anchor',
          label: 'First payday in your local timezone',
          type: 'datetime-local',
          value: localInput(Date.now() + 86400000),
        },
      ],
      onChange: (v, changed) => {
        const r = d.roles.find((r: any) => r.id === v.roleId);
        if (changed === 'roleId' && r) return { salary: nearDecimal(r.salary), cadence: r.cadence };
      },
      submitLabel: 'Review employee registration',
      submit: async (v) => {
        const r = await run('employee.invite', {
          ...v,
          salary: nearAtomic(v.salary),
          anchor: new Date(v.anchor).toISOString(),
        });
        ctx.result(
          'Employee invitation',
          'Complete the NEAR registration, then share this link with ' + v.name + '.',
          [{ label: 'Invitation link', value: location.origin + r.invitationUrl }],
        );
      },
    });
  const schedule = () =>
    form({
      title: 'Review a payroll window',
      description:
        'Only accepted employees are included. The full window is reserved; each batch needs your NEAR signature. Automation cannot add new recipients or amounts.',
      fields: [
        { id: 'days', label: 'Days ahead', value: '31', type: 'number', min: '1', step: '1' },
      ],
      submitLabel: 'Preview payroll',
      submit: (v) => run('payroll.preview', { days: Number(v.days) }),
    });
  const salary = () =>
    form({
      title: 'Change salaries together',
      fields: [
        {
          id: 'selection',
          label: 'Apply to',
          value: 'all',
          options: [
            { value: 'all', label: 'All active employees' },
            { value: 'role', label: 'A job role' },
            { value: 'selected', label: 'Selected employees' },
          ],
        },
        {
          id: 'roleId',
          label: 'Job role (for role selection)',
          required: false,
          options: d.roles.map((r: any) => ({ value: r.id, label: r.name })),
        },
        {
          id: 'employeeIds',
          label: 'Selected employees (hold Ctrl or Cmd to select several)',
          type: 'multiselect',
          required: false,
          options: d.employees
            .filter((e: any) => e.status === 'ACTIVE')
            .map((e: any) => ({ value: e.id, label: e.name })),
        },
        {
          id: 'kind',
          label: 'Change type',
          options: [
            { value: 'percent', label: 'Percentage' },
            { value: 'fixed', label: 'Fixed testNEAR amount' },
          ],
        },
        {
          id: 'direction',
          label: 'Direction',
          options: [
            { value: 'increase', label: 'Increase' },
            { value: 'decrease', label: 'Decrease' },
          ],
        },
        {
          id: 'horizonDays',
          label: 'Forecast horizon (days)',
          value: '90',
          type: 'number',
          min: '1',
          step: '1',
        },
        {
          id: 'delta',
          label: 'Change (percentage or testNEAR)',
          value: '10',
          type: 'number',
          min: '0',
          step: '0.01',
        },
        {
          id: 'effectiveFrom',
          label: 'Applies from (local time)',
          type: 'datetime-local',
          value: localInput(Date.now() + 600000),
        },
      ],
      submitLabel: 'Preview salary changes',
      submit: (v) =>
        run('salary.preview', {
          ...v,
          employeeIds:
            v.selection === 'selected' ? v.employeeIds.split(',').filter(Boolean) : undefined,
          horizonDays: Number(v.horizonDays),
          delta:
            v.kind === 'percent' ? String(Math.round(Number(v.delta) * 100)) : nearAtomic(v.delta),
          effectiveFrom: new Date(v.effectiveFrom).toISOString(),
        }),
    });
  const withdraw = () =>
    form({
      title: 'Withdraw your salary',
      description:
        'Only free testNEAR can be withdrawn. Savings stay reserved until you release them. The transfer goes to your verified NEAR account.',
      fields: [
        {
          id: 'amount',
          label: 'Amount in testNEAR',
          value: nearDecimal(d.account.cash),
          type: 'number',
          min: '0.0001',
          step: '0.0001',
        },
      ],
      submitLabel: 'Review withdrawal',
      submit: (v) => run('employee.withdraw', { amount: nearAtomic(v.amount) }),
    });
  const goalData = (g: any) => {
    const rule = d.account.goalRules?.find((r: any) => r.id === g.id);
    return {
      ...g,
      name: d.goalNames.find((n: any) => n.chainId === g.id)?.name || 'Savings goal',
      contributionMode: rule?.contribution_mode || 'PERCENT',
      contributionValue: rule?.contribution_value || '10000',
      percentBasis: rule?.percent_basis || 'GOAL_BUDGET',
      overflow: rule?.overflow || 'NEXT',
      targetDate: rule?.target_date || null,
      state:
        rule?.state || (g.completed ? 'COMPLETED' : g.paused || g.released ? 'PAUSED' : 'ACTIVE'),
    };
  };
  const goal = (existing?: any) => {
    const policy = d.account.policy;
    const g = existing ? goalData(existing) : undefined;
    form({
      title: g ? 'Edit savings goal' : 'Add a savings goal',
      description:
        'The goals budget limits all contributions. Confirming reviews your new target and status before your NEAR signature. A target date is a planning date, not a promised return.',
      fields: [
        { id: 'name', label: 'Goal name', value: g?.name },
        {
          id: 'target',
          label: 'Target (testNEAR)',
          value: g ? nearDecimal(g.target) : '1',
          type: 'number',
          step: '0.0001',
        },
        {
          id: 'goalBps',
          label: 'Salary allocated to all goals (%)',
          value: String(policy.goal_bps / 100),
          type: 'number',
          step: '0.01',
          min: '0',
        },
        {
          id: 'cashFloor',
          label: 'Minimum cash per payday (testNEAR)',
          value: nearDecimal(policy.cash_floor),
          type: 'number',
          step: '0.0001',
        },
        ...savingsFields(g, 'testNEAR', nearDecimal),
      ],
      submitLabel: 'Review savings policy',
      submit: (v) => {
        const updated = {
          ...(g ? { id: g.id } : {}),
          name: v.name,
          target: nearAtomic(v.target),
          priority: Number(v.priority),
          ...savingsValues(v, nearAtomic),
        };
        const goals = policy.goals.map((old: any) => {
          const saved = goalData(old);
          return old.id === g?.id
            ? updated
            : {
                id: saved.id,
                name: saved.name,
                target: saved.target,
                priority: saved.priority,
                contributionMode: saved.contributionMode,
                contributionValue: saved.contributionValue,
                percentBasis: saved.percentBasis,
                overflow: saved.overflow,
                targetDate: saved.targetDate,
                state: saved.state,
                confirmChanges: false,
              };
        });
        if (!g) goals.push(updated);
        return run('goal.policy', {
          goalBps: Math.round(Number(v.goalBps) * 100),
          cashFloor: nearAtomic(v.cashFloor),
          goals,
        });
      },
    });
  };
  const pending = d.plans.filter(
    (p: any) => p.state === 'IN_PROGRESS' || (p.state === 'PREVIEW' && p.expiresAt > d.serverTime),
  );
  const obligations = (d.obligations || []).filter(
    (o: any) =>
      (!dateFrom || dueDate(o.due_at).slice(0, 10) >= dateFrom) &&
      (!dateTo || dueDate(o.due_at).slice(0, 10) <= dateTo) &&
      (!roleFilter ||
        d.employees?.find((e: any) => e.chainId === o.employee_id)?.roleId === roleFilter) &&
      (!filter ||
        [o.account_id, o.id, d.employees?.find((e: any) => e.chainId === o.employee_id)?.name].some(
          (x) => x?.toLowerCase().includes(filter.toLowerCase()),
        )),
  );
  const payments = (
    <Panel
      title="Paydays on NEAR"
      subtitle="Contract state at finality. A credit becomes free cash and reserved savings in the same contract call."
      action={company ? <Button onClick={schedule}>Review payroll window</Button> : undefined}
    >
      <label className="live-filter">
        Find a payment
        <input
          aria-label="Find a payment"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Name, account or payment ID"
        />
      </label>
      {page === 'reports' ? (
        <div className="form-grid panel-padding">
          <label className="field">
            From payday (UTC)
            <input
              aria-label="Report from date"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="field">
            Through payday (UTC)
            <input
              aria-label="Report through date"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="field">
            Job role
            <select
              aria-label="Report role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All roles</option>
              {d.roles?.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {obligations.length ? (
        <Table headers={['Person', 'Payday', 'Amount', 'Status', 'Action']}>
          {obligations.map((o: any) => (
            <tr key={o.id}>
              <td>
                <b>
                  {d.employees?.find((e: any) => e.chainId === o.employee_id)?.name || o.account_id}
                </b>
                <small>{o.account_id}</small>
              </td>
              <td>{time(dueDate(o.due_at))}</td>
              <td>{nearMoney(o.amount)}</td>
              <td>
                <Badge tone={o.credited ? 'good' : 'neutral'}>
                  {o.credited
                    ? 'Credited'
                    : o.cancelled
                      ? 'Cancelled'
                      : o.execution_not_after &&
                          BigInt(o.execution_not_after) < BigInt(Date.now()) * 1000000n
                        ? BigInt(o.due_at) <= BigInt(Date.now()) * 1000000n
                          ? 'Authority expired · claim available'
                          : 'Authority expired · claim at payday'
                        : o.paused
                          ? 'Automation paused'
                          : 'Reserved'}
                </Badge>
              </td>
              <td>
                {!o.credited && !o.cancelled ? (
                  company ? (
                    <>
                      <Button
                        variant="quiet"
                        onClick={() =>
                          void run('payroll.pause', { id: o.id, paused: !o.paused }).catch(() => {})
                        }
                      >
                        {o.paused ? 'Resume' : 'Pause'}
                      </Button>
                      {BigInt(o.execution_not_after || '0') < BigInt(Date.now()) * 1000000n ? (
                        <Button
                          variant="quiet"
                          onClick={() =>
                            void run('payroll.renew', {
                              id: o.id,
                              expectedVersion: o.version,
                            }).catch(() => {})
                          }
                        >
                          Renew authority
                        </Button>
                      ) : null}
                      {BigInt(o.due_at) > BigInt(Date.now()) * 1000000n ? (
                        <Button
                          variant="quiet"
                          onClick={() =>
                            form({
                              title: 'One-time salary adjustment',
                              fields: [
                                {
                                  id: 'kind',
                                  label: 'Adjustment',
                                  options: [
                                    { value: 'bonus', label: 'Bonus' },
                                    { value: 'deduction', label: 'Deduction' },
                                  ],
                                },
                                {
                                  id: 'amount',
                                  label: 'Adjustment in testNEAR',
                                  type: 'number',
                                  step: '0.0001',
                                },
                                { id: 'reason', label: 'Reason' },
                              ],
                              submitLabel: 'Review adjustment',
                              submit: (v) =>
                                run('payroll.adjust', {
                                  id: o.id,
                                  kind: v.kind,
                                  amount: nearAtomic(v.amount),
                                  reason: v.reason,
                                  expectedVersion: o.version,
                                }),
                            })
                          }
                        >
                          Adjust
                        </Button>
                      ) : null}
                    </>
                  ) : BigInt(o.due_at) <= BigInt(Date.now()) * 1000000n ? (
                    <Button
                      variant="secondary"
                      onClick={() => void run('payroll.claim', { id: o.id }).catch(() => {})}
                    >
                      Claim salary
                    </Button>
                  ) : null
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty title="No payments in this view">
          {company
            ? 'Accept an employee invitation, fund the treasury and review a payroll window.'
            : 'Your accepted employer can authorize your next payday.'}
        </Empty>
      )}
    </Panel>
  );
  return (
    <div className="page-content live-workspace">
      <div className="page-heading">
        <div>
          <p className="context-line">{company ? 'Company payroll' : 'Your NEAR Salary Vault'}</p>
          <h1>
            {company
              ? c?.name || 'Start your company'
              : page === 'goals'
                ? 'A purpose for every payday.'
                : 'Your work. Your money.'}
          </h1>
          <p>
            {company
              ? 'A signed plan, reserved funds and automatic paydays on NEAR.'
              : 'Salary and savings settle on NEAR, under your account.'}
          </p>
        </div>
        <Badge tone="good">
          <ShieldCheck size={14} />
          NEAR testnet
        </Badge>
      </div>
      {pending.length ? (
        <Panel
          title="Decisions awaiting completion"
          subtitle="Each transaction has its own status. Resume the remaining steps after a cancelled signature or an interruption."
        >
          {pending.map((p: any) => (
            <div className="live-pending" key={p.id}>
              <div>
                <b>{p.label}</b>
                <small>
                  {p.steps.filter((s: any) => s.state === 'CONFIRMED').length} of {p.steps.length}{' '}
                  complete
                </small>
              </div>
              <Button
                variant="secondary"
                onClick={() => ctx.result('live-plan', '', [{ plan: p }])}
              >
                Review / resume
              </Button>
            </div>
          ))}
        </Panel>
      ) : null}
      {company && (!c || !d.chain) ? (
        <Empty
          title={c ? 'Register your company vault' : 'Bring your first company to NEAR'}
          action={
            <Button
              onClick={
                c
                  ? () =>
                      ctx.result('live-plan', '', [
                        { plan: d.plans.find((p: any) => p.commit?.companyId === c.id) },
                      ])
                  : create
              }
            >
              {c ? 'Review registration' : 'Create a company'}
            </Button>
          }
        >
          Company names, email and job roles stay off-chain. The contract stores opaque IDs and
          payment data.
        </Empty>
      ) : company ? (
        <>
          {['overview', 'treasury'].includes(page) ? (
            <>
              <div className="payroll-ribbon">
                <div>
                  <Wallet />
                  <span>Company treasury</span>
                  <strong>{nearMoney(d.chain.free)}</strong>
                </div>
                <ArrowRight />
                <div>
                  <CalendarDays />
                  <span>Reserved salaries</span>
                  <strong>{nearMoney(d.chain.reserved)}</strong>
                </div>
                <ArrowRight />
                <div>
                  <ShieldCheck />
                  <span>Employee vaults</span>
                  <strong>Atomic cash + savings</strong>
                </div>
              </div>
              <div className="action-row">
                <Button onClick={fund}>Fund treasury</Button>
                <Button variant="secondary" onClick={schedule}>
                  Review payroll
                </Button>
                <Button
                  variant="quiet"
                  onClick={() =>
                    form({
                      title: 'Withdraw surplus treasury',
                      description:
                        'Funds reserved for salaries cannot be withdrawn by the company.',
                      fields: [
                        {
                          id: 'amount',
                          label: 'Free testNEAR to withdraw',
                          type: 'number',
                          step: '0.0001',
                        },
                      ],
                      submitLabel: 'Review surplus withdrawal',
                      submit: (v) => run('treasury.withdraw', { amount: nearAtomic(v.amount) }),
                    })
                  }
                >
                  Withdraw surplus
                </Button>
              </div>
              {payments}
            </>
          ) : null}
          {page === 'employees' ? (
            <Panel
              title="People and employment"
              action={
                <Button onClick={invite} disabled={!d.roles.length}>
                  <Plus size={16} />
                  Invite employee
                </Button>
              }
            >
              {!d.roles.length ? (
                <Notice>Create a job role first, then invite your employee.</Notice>
              ) : null}
              <Table headers={['Employee', 'Job role', 'Pay agreement', 'NEAR identity', 'Status']}>
                {d.employees.map((e: any) => (
                  <tr key={e.id}>
                    <td>
                      <Person name={e.name} detail={e.email} />
                    </td>
                    <td>{d.roles.find((r: any) => r.id === e.roleId)?.name}</td>
                    <td>
                      {nearMoney(e.salary)} / {e.cadence}
                    </td>
                    <td>{e.accountId}</td>
                    <td>
                      <Badge tone={e.chain?.accepted ? 'good' : 'neutral'}>
                        {e.status === 'ENDED'
                          ? 'Employment ended'
                          : e.status === 'PAUSED'
                            ? 'Employment paused'
                            : e.chain?.accepted
                              ? 'Accepted on NEAR'
                              : e.chain
                                ? 'Awaiting acceptance'
                                : 'Registration pending'}
                      </Badge>
                      <Button
                        variant="quiet"
                        onClick={() =>
                          form({
                            title: 'Edit employee details',
                            description:
                              'Changing a job role keeps the existing salary and frequency. Use the salary preview to change pay.',
                            fields: [
                              { id: 'name', label: 'Employee name', value: e.name },
                              {
                                id: 'email',
                                label: 'Email (optional)',
                                type: 'email',
                                value: e.email || '',
                                required: false,
                              },
                              {
                                id: 'roleId',
                                label: 'Job role',
                                value: e.roleId,
                                options: d.roles.map((r: any) => ({ value: r.id, label: r.name })),
                              },
                              {
                                id: 'startDate',
                                label: 'Employment start date',
                                type: 'date',
                                value: e.startDate || '',
                                required: false,
                              },
                            ],
                            submitLabel: 'Save employee details',
                            submit: (v) =>
                              run('employee.update', {
                                ...v,
                                startDate: v.startDate || undefined,
                                id: e.id,
                                expectedVersion: e.version,
                              }),
                          })
                        }
                      >
                        Edit details
                      </Button>
                      {!e.identityVerified && e.status === 'INVITED' ? (
                        <>
                          <Button
                            variant="quiet"
                            onClick={() =>
                              void run('employee.invitation', {
                                id: e.id,
                                expectedVersion: e.version,
                                operation: 'reissue',
                              })
                                .then((r) =>
                                  ctx.result(
                                    'New employee invitation',
                                    'The previous link is revoked. This one-time link expires in 72 hours.',
                                    [
                                      {
                                        label: 'Invitation link',
                                        value: location.origin + r.invitationUrl,
                                      },
                                    ],
                                  ),
                                )
                                .catch(() => {})
                            }
                          >
                            Reissue invite
                          </Button>
                          <Button
                            variant="quiet"
                            onClick={() =>
                              void run('employee.invitation', {
                                id: e.id,
                                expectedVersion: e.version,
                                operation: 'revoke',
                              }).catch(() => {})
                            }
                          >
                            Revoke invite
                          </Button>
                        </>
                      ) : null}
                      {e.identityVerified ? (
                        <Button
                          variant="quiet"
                          onClick={() =>
                            form({
                              title: 'Change employment status',
                              description:
                                'Ending employment cancels only future unpaid obligations. The employee keeps access to earned salary, cash and savings.',
                              fields: [
                                {
                                  id: 'status',
                                  label: 'Employment status',
                                  value: e.status,
                                  options: ['ACTIVE', 'PAUSED', 'ENDED'].map((value) => ({
                                    value,
                                    label: value,
                                  })),
                                },
                              ],
                              submitLabel: 'Review status change',
                              submit: (v) =>
                                run('employee.status', {
                                  id: e.id,
                                  status: v.status,
                                  expectedVersion: e.version,
                                }),
                            })
                          }
                        >
                          Change status
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
          ) : null}
          {page === 'roles' ? (
            <Panel
              title="Job roles"
              subtitle="Job roles define pay agreements. Access permissions are managed separately."
              action={
                <Button onClick={() => roleForm()}>
                  <Plus size={16} />
                  Add job role
                </Button>
              }
            >
              <Table headers={['Job role', 'Default salary', 'Frequency', '']}>
                {d.roles.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      <small>{r.description}</small>
                    </td>
                    <td>{nearMoney(r.salary)}</td>
                    <td>{r.cadence}</td>
                    <td>
                      <Button variant="quiet" onClick={() => roleForm(r)}>
                        Edit role
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
          ) : null}
          {page === 'payroll' ? (
            <>
              <div className="action-row">
                <Button variant="secondary" onClick={salary}>
                  Change salaries together
                </Button>
              </div>
              {payments}
            </>
          ) : null}
          {page === 'treasury' && d.fundingRequest?.state === 'AWAITING_FUNDS' ? (
            <Notice>
              Payroll is awaiting full funding: {nearMoney(d.fundingRequest.required)} required,{' '}
              {nearMoney(d.fundingRequest.shortfall)} missing at the last review. Fund the treasury
              and review payroll again to refresh this amount. No partial authority is active.
            </Notice>
          ) : null}
          {page === 'reports' ? (
            <>
              <div className="action-row">
                <a
                  className="btn secondary"
                  href={
                    '/api/v1/live/export.csv?scope=company&companyId=' +
                    c.id +
                    '&' +
                    new URLSearchParams({
                      from: dateFrom,
                      to: dateTo,
                      roleId: roleFilter,
                      search: filter,
                    })
                  }
                >
                  Download CSV
                </a>
                <Button variant="secondary" onClick={() => window.print()}>
                  Print report
                </Button>
              </div>
              <Panel
                title="Filtered payroll totals"
                subtitle="Salary costs use the payment amount in testNEAR. Role labels use current employment metadata; no fiat rate is assumed."
              >
                <div className="metric-row">
                  <Metric label="Payment count" value={obligations.length} />
                  <Metric
                    label="Total salary obligations"
                    value={nearMoney(
                      obligations
                        .filter((o: any) => !o.cancelled)
                        .reduce((n: bigint, o: any) => n + BigInt(o.amount), 0n)
                        .toString(),
                    )}
                  />
                  <Metric
                    label="Credited salary"
                    value={nearMoney(
                      obligations
                        .filter((o: any) => o.credited)
                        .reduce((n: bigint, o: any) => n + BigInt(o.amount), 0n)
                        .toString(),
                    )}
                  />
                </div>
              </Panel>
              {payments}
              <Panel
                title="Accounting journal"
                subtitle={
                  'Unit: testNEAR · Network: NEAR testnet · ' +
                  (d.reconciliation?.accounting?.state || 'Awaiting reconciliation')
                }
              >
                <a
                  className="btn secondary"
                  href={'/api/v1/live/export.csv?scope=company&companyId=' + c.id + '&kind=journal'}
                >
                  Download accounting journal CSV
                </a>
                <Notice>
                  The journal starts with a labeled opening snapshot for legacy balances. Subsequent
                  entries come from timestamped contract events. Each movement has equal debit and
                  credit.
                </Notice>
                <Table headers={['When', 'Type', 'Account', 'Debit', 'Credit']}>
                  {(d.ledger || []).flatMap((e: any) =>
                    e.lines.map((l: any, i: number) => (
                      <tr key={e.id + ':' + i}>
                        <td>{time(e.created_at)}</td>
                        <td>{e.kind}</td>
                        <td>{l.account}</td>
                        <td>{l.side === 'DEBIT' ? nearMoney(l.amount) : '—'}</td>
                        <td>{l.side === 'CREDIT' ? nearMoney(l.amount) : '—'}</td>
                      </tr>
                    )),
                  )}
                </Table>
              </Panel>
              <Panel title="Company audit">
                <Table headers={['When', 'Action', 'Reference']}>
                  {d.audit.map((a: any) => (
                    <tr key={a.id}>
                      <td>{date(a.createdAt)}</td>
                      <td>{a.action}</td>
                      <td>{a.ref}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </>
          ) : null}
          {page === 'settings' ? (
            <>
              <Panel
                title="Company profile"
                subtitle={'Book: testNEAR · NEAR testnet · Timezone: ' + c.timezone}
                action={
                  <Button
                    variant="secondary"
                    onClick={() =>
                      form({
                        title: 'Edit company profile',
                        description:
                          'The timezone is locked after funding or employment to preserve pay schedules.',
                        fields: [
                          { id: 'name', label: 'Company name', value: c.name },
                          { id: 'timezone', label: 'IANA timezone', value: c.timezone },
                        ],
                        submitLabel: 'Save profile',
                        submit: (v) =>
                          run('company.settings', { ...v, expectedVersion: c.version }),
                      })
                    }
                  >
                    Edit profile
                  </Button>
                }
              >
                <p>
                  Job roles describe employment. Workspace permissions control access and signing.
                </p>
              </Panel>
              <Panel
                title="Workspace access"
                subtitle="Only the company owner signs financial changes. Accountants prepare drafts; observers can read."
              >
                <Button
                  onClick={() =>
                    form({
                      title: 'Invite a company member',
                      fields: [
                        { id: 'accountId', label: 'NEAR testnet account' },
                        {
                          id: 'access',
                          label: 'Access',
                          options: [
                            { value: 'accountant', label: 'Accountant' },
                            { value: 'observer', label: 'Observer' },
                          ],
                        },
                      ],
                      submitLabel: 'Create invitation',
                      submit: async (v) => {
                        const r = await run('member.invite', v);
                        ctx.result('Member invitation', 'Share with the matching NEAR account.', [
                          { label: 'Invitation link', value: location.origin + r.invitationUrl },
                        ]);
                      },
                    })
                  }
                >
                  Invite member
                </Button>
                <Table headers={['Account', 'Permission', 'Status', '']}>
                  {d.members.map((m: any) => (
                    <tr key={m.id}>
                      <td>{m.accountId}</td>
                      <td>{m.access}</td>
                      <td>{m.status}</td>
                      <td>
                        {m.access !== 'owner' && m.status === 'ACTIVE' ? (
                          <Button
                            variant="quiet"
                            onClick={() =>
                              void run('member.revoke', {
                                id: m.id,
                                expectedVersion: m.version,
                              }).catch(() => {})
                            }
                          >
                            Revoke access
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </>
          ) : null}
        </>
      ) : (
        <>
          {['overview', 'salary'].includes(page) ? (
            <>
              <div className="metric-row">
                <Metric label="Free to withdraw" value={nearMoney(d.account.cash)} />
                <Metric
                  label="Savings reserved"
                  value={nearMoney(
                    d.account.policy.goals
                      .reduce((n: bigint, g: any) => n + BigInt(g.funded), 0n)
                      .toString(),
                  )}
                />
                <Metric label="Your account" value={d.user.accountId} />
              </div>
              <div className="action-row">
                <Button onClick={withdraw} disabled={d.account.cash === '0'}>
                  Withdraw testNEAR
                </Button>
                <Button variant="secondary" onClick={() => ctx.go('goals')}>
                  Plan savings
                </Button>
              </div>
              {payments}
            </>
          ) : null}
          {page === 'goals' ? (
            <Panel
              title="Savings reserved with your salary"
              subtitle={
                'The contract allocates ' +
                d.account.policy.goal_bps / 100 +
                '% of each salary to goals, after keeping ' +
                nearMoney(d.account.policy.cash_floor) +
                ' in free cash.'
              }
              action={
                <Button onClick={() => goal()} disabled={d.account.policy.goals.length >= 10}>
                  <Plus size={16} />
                  Add goal
                </Button>
              }
            >
              {d.account.policy.goals.length ? (
                d.account.policy.goals.map((g: any) => (
                  <div className="live-goal" key={g.id}>
                    <div className="spread">
                      <h3>
                        {d.goalNames.find((n: any) => n.chainId === g.id)?.name || 'Savings goal'}
                      </h3>
                      <Badge>{goalData(g).state.toLowerCase()}</Badge>
                    </div>
                    <small>{savingsSummary(goalData(g), nearMoney)}</small>
                    <p>
                      {nearMoney(g.funded)} of {nearMoney(g.target)}
                    </p>
                    <Progress
                      value={
                        BigInt(g.target) > 0n
                          ? Number((BigInt(g.funded) * 10000n) / BigInt(g.target)) / 100
                          : 0
                      }
                      label="Savings progress"
                    />
                    <div className="action-row">
                      <Button
                        variant="quiet"
                        disabled={!['ACTIVE', 'PAUSED'].includes(goalData(g).state) || g.released}
                        onClick={() =>
                          void run('goal.pause', { id: g.id, paused: !g.paused }).catch(() => {})
                        }
                      >
                        {g.paused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button variant="quiet" onClick={() => goal(g)}>
                        Edit rules
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={g.funded === '0'}
                        onClick={() => void run('goal.release', { id: g.id }).catch(() => {})}
                      >
                        Release to free cash
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <Empty title="Choose what your salary builds">
                  A goal is reserved savings, with no assumed yield.
                </Empty>
              )}
            </Panel>
          ) : null}
        </>
      )}
      <Panel
        title="Your NEAR activity"
        subtitle="Confirmed calls include an explorer receipt. A submitted result stays pending until the final receipt is verified."
      >
        {d.operations.length ? (
          <Table headers={['Action', 'Status', 'Receipt']}>
            {d.operations.slice(0, 10).map((o: any) => (
              <tr key={o.id}>
                <td>{o.method.replaceAll('_', ' ')}</td>
                <td>
                  <Badge tone={o.state === 'CONFIRMED' ? 'good' : 'neutral'}>{o.state}</Badge>
                </td>
                <td>{o.txHash ? txLink(o.txHash) : 'Awaiting signature'}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="panel-padding">Your signed testnet activity will appear here.</p>
        )}
      </Panel>
      <Notice>
        Native payroll and savings use the NEAR testnet contract. Multi-chain receiving, DCA,
        stocks, Earn and borrowing remain clearly labeled simulations in the demo workspace.
        TestNEAR has no assumed demoUSD exchange rate.
      </Notice>
    </div>
  );
}
