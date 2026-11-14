import { useState } from 'react';
import {
  Plus,
  ArrowUpRight,
  ArrowRight,
  Users,
  Play,
  Pause,
  CalendarDays,
  Download,
  Upload,
  SlidersHorizontal,
  Wallet,
  CheckCircle2,
  ShieldCheck,
  Search,
  ChevronRight,
  Building2,
} from 'lucide-react';
import {
  Button,
  Badge,
  Panel,
  Notice,
  Empty,
  Metric,
  Progress,
  Table,
  Person,
  ArrowLink,
} from '../components';
import { money, decimal, atomic, date, time, cmd, localInput } from '../api';
import type { UIContext, FieldDef } from '../types';
const periodLabel: Record<string, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};
export default function Company({ ctx }: { ctx: UIContext }) {
  const { data: d, page, form, run, decide } = ctx;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const roles = new Map<string, string>(d.roles.map((r: any) => [r.id, r.name]));
  const active = d.employees.filter((e: any) => e.status === 'ACTIVE');
  const pending = d.obligations.filter((o: any) => o.state === 'RESERVED');
  const credited = d.obligations.filter((o: any) => o.state === 'CREDITED');
  const canWrite = ['owner', 'accountant'].includes(d.access);
  const canSign = d.access === 'owner';
  const employeeFields: FieldDef[] = [
    { id: 'name', label: 'Full name' },
    { id: 'email', label: 'Email address', type: 'email' },
    {
      id: 'roleId',
      label: 'Job role',
      type: 'select',
      options: d.roles.map((r: any) => ({ value: r.id, label: r.name })),
    },
    {
      id: 'salary',
      label: 'Salary per period (demoUSD)',
      type: 'number',
      min: '0',
      step: '0.01',
      value: '4800',
    },
    {
      id: 'cadence',
      label: 'Pay frequency',
      type: 'select',
      options: [
        { value: 'monthly', label: 'Monthly' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'daily', label: 'Daily' },
      ],
    },
    {
      id: 'anchor',
      label: 'First payment',
      type: 'datetime-local',
      value: localInput(Date.now() + 86400000),
    },
  ];
  const invite = () =>
    form({
      title: 'Invite an employee',
      description: 'The invitation must be accepted before this employee can join payroll.',
      fields: employeeFields,
      submitLabel: 'Create invitation',
      submit: async (v) => {
        const r = await run('employee.invite', {
          ...v,
          salary: atomic(v.salary),
          anchor: new Date(v.anchor).toISOString(),
        });
        ctx.result('Invitation ready', 'Share this one-time invitation. It expires in 72 hours.', [
          { label: r.employee.name, value: location.origin + r.invitationUrl },
        ]);
      },
    });
  const fund = (purpose = 'cash') =>
    form({
      title: purpose === 'bonus' ? 'Fund employer bonuses' : 'Fund the treasury',
      description:
        'Adds demonstration money to this company’s simulation book. No real transfer occurs.',
      fields: [
        {
          id: 'amount',
          label: 'Amount (demoUSD)',
          type: 'number',
          min: '0.01',
          step: '0.01',
          value: purpose === 'bonus' ? '500' : '25000',
        },
      ],
      submitLabel: 'Add demo funds',
      submit: (v) => run('treasury.fund', { amount: atomic(v.amount), purpose }),
    });
  const payroll = () =>
    form({
      title: 'Prepare a payroll window',
      description: 'Every obligation in this window must be funded before automation can run.',
      fields: [
        {
          id: 'days',
          label: 'Authorization window (days)',
          type: 'number',
          min: '1',
          value: '30',
          step: '1',
        },
        {
          id: 'accelerated',
          label: 'Schedule',
          type: 'select',
          options: [
            { value: 'false', label: 'Use employee calendar dates' },
            { value: 'true', label: 'Accelerated Demo Schedule (due in seconds)' },
          ],
          hint: 'Accelerated schedules are limited to one sample obligation per employee per day.',
        },
      ],
      submitLabel: 'Preview payroll',
      submit: (v) =>
        decide('payroll', { days: Number(v.days), accelerated: v.accelerated === 'true' }),
    });
  const bulk = () =>
    form({
      title: 'Change salaries together',
      description:
        'Amounts are per pay period. Unearned future reservations are updated atomically. Earned and settled salary stays protected.',
      fields: [
        {
          id: 'selection',
          label: 'Apply to',
          type: 'select',
          options: [
            { value: 'all', label: 'All employees' },
            ...d.roles.map((r: any) => ({ value: r.id, label: r.name + ' role' })),
            ...(selected.length
              ? [{ value: 'selected', label: selected.length + ' selected employees' }]
              : []),
          ],
        },
        {
          id: 'direction',
          label: 'Direction',
          type: 'select',
          options: [
            { value: 'increase', label: 'Increase' },
            { value: 'decrease', label: 'Decrease' },
          ],
        },
        {
          id: 'kind',
          label: 'Change type',
          type: 'select',
          options: [
            { value: 'percent', label: 'Percentage' },
            { value: 'fixed', label: 'Fixed demoUSD per period' },
          ],
        },
        {
          id: 'horizonDays',
          label: 'Forecast horizon (days)',
          type: 'number',
          min: '1',
          step: '1',
          value: '90',
        },
        { id: 'delta', label: 'Change amount', type: 'number', min: '0', step: '0.01', value: '5' },
        {
          id: 'effectiveFrom',
          label: 'Effective from',
          type: 'datetime-local',
          value: localInput(),
        },
      ],
      submitLabel: 'Preview changes',
      submit: (v) =>
        decide('salary-change', {
          selection:
            v.selection === 'all' ? 'all' : v.selection === 'selected' ? 'selected' : 'role',
          ...(v.selection === 'selected'
            ? { employeeIds: selected }
            : v.selection !== 'all'
              ? { roleId: v.selection }
              : {}),
          kind: v.kind,
          horizonDays: Number(v.horizonDays),
          delta: atomic(v.delta),
          direction: v.direction,
          effectiveFrom: new Date(v.effectiveFrom).toISOString(),
        }),
    });
  const roleForm = (r?: any) =>
    form({
      title: r ? 'Edit job role' : 'Create a job role',
      description: 'Job roles group salaries. They never grant access permissions.',
      fields: [
        { id: 'name', label: 'Role name', value: r?.name },
        {
          id: 'salary',
          label: 'Default salary per period (demoUSD)',
          type: 'number',
          step: '0.01',
          min: '0',
          value: r ? decimal(r.salary) : '5000',
        },
        {
          id: 'cadence',
          label: 'Default pay frequency',
          type: 'select',
          value: r?.cadence || 'monthly',
          options: Object.entries(periodLabel).map(([value, label]) => ({ value, label })),
        },
      ],
      submitLabel: 'Save role',
      submit: (v) =>
        run('role.save', {
          ...v,
          salary: atomic(v.salary),
          ...(r ? { id: r.id, expectedVersion: r.version } : {}),
        }),
    });
  const importCsv = () =>
    form({
      title: 'Import employees',
      description:
        'Start with name,email,role,salary,cadence. Salary is a decimal demoUSD amount per period. Up to 50 rows.',
      fields: [
        {
          id: 'csv',
          label: 'CSV content',
          type: 'textarea',
          value:
            'name,email,role,salary,cadence\nTaylor Quinn,taylor@forma.example,Design,4500,monthly',
        },
      ],
      submitLabel: 'Validate and preview',
      submit: async (v) => {
        const r = await run('import.preview', v);
        ctx.result(
          'Import preview',
          r.rows.some((x: any) => x.errors.length)
            ? 'Correct the errors and upload a new preview.'
            : 'All rows are valid. Commit creates invitation links.',
          r.rows
            .map((x: any) => ({
              label: 'Row ' + x.row + ': ' + x.name,
              value: x.errors.length
                ? x.errors.join('; ')
                : x.email + ' · ' + money(x.salaryAtomic) + ' / ' + x.cadence,
            }))
            .concat([
              {
                label: 'Import reference',
                value: r.id,
                commit: r.rows.every((x: any) => !x.errors.length) ? r.id : null,
              },
            ]),
        );
      },
    });
  const employeeTable = (list: any[], compact = false) => (
    <Table
      headers={
        compact
          ? ['Employee', 'Salary / period', 'Status']
          : ['Select', 'Employee', 'Job role', 'Salary / period', 'Frequency', 'Status', 'Actions']
      }
    >
      {list.map((e: any) => (
        <tr key={e.id}>
          {!compact ? (
            <td>
              <input
                type="checkbox"
                aria-label={'Select ' + e.name}
                checked={selected.includes(e.id)}
                onChange={(ev) =>
                  setSelected(
                    ev.target.checked ? [...selected, e.id] : selected.filter((id) => id !== e.id),
                  )
                }
              />
            </td>
          ) : null}
          <td>
            <Person name={e.name} detail={compact ? roles.get(e.roleId) : e.email} />
          </td>
          {!compact ? <td>{roles.get(e.roleId) || 'Unassigned'}</td> : null}
          <td>
            <b>{money(e.salary, false)}</b>
            {e.pendingSalary && e.pendingSalary.salary !== e.salary ? (
              <small className="cell-note">
                {money(e.pendingSalary.salary, false)} from {date(e.pendingSalary.effectiveFrom)}
              </small>
            ) : null}
          </td>
          {!compact ? <td>{periodLabel[e.cadence]}</td> : null}
          <td>
            <Badge tone={e.status === 'ACTIVE' ? 'good' : 'neutral'}>
              {e.status.toLowerCase()}
            </Badge>
          </td>
          {!compact ? (
            <td>
              {canWrite && e.status !== 'INVITED' && e.status !== 'ENDED' ? (
                <Button
                  variant="quiet"
                  onClick={() =>
                    void run('employee.status', {
                      id: e.id,
                      status: e.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED',
                      expectedVersion: e.version,
                    }).catch(() => {})
                  }
                >
                  {e.status === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}{' '}
                  {e.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                </Button>
              ) : e.status === 'INVITED' ? (
                <span className="muted">Awaiting acceptance</span>
              ) : null}
            </td>
          ) : null}
        </tr>
      ))}
    </Table>
  );
  if (page === 'overview')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">{d.company.name} / Payroll workspace</p>
            <h1>A good day to pay people.</h1>
            <p>Keep the team paid. Give every payday a clear path.</p>
          </div>
          <Button onClick={payroll} disabled={!canSign}>
            <Play size={16} />
            Prepare payroll
          </Button>
        </div>
        <section className="payroll-ribbon">
          <div className="ribbon-intro">
            <span className="small-label">The next payday</span>
            <h2>
              From the treasury
              <br />
              to their next chapter.
            </h2>
            <p>
              {active.length} people. {new Set(active.map((e: any) => e.cadence)).size} pay rhythms.
              One funded plan.
            </p>
            <Badge tone="light">Powered by NEAR</Badge>
          </div>
          <div className="money-path">
            <div className="path-node">
              <div className="path-icon">
                <Wallet size={24} />
              </div>
              <b>Treasury</b>
              <strong>{money(d.treasury.cash, false)}</strong>
              <small>demoUSD available</small>
            </div>
            <span className="path-connector">
              <i />
              <ArrowRight size={18} />
            </span>
            <div className="path-node">
              <div className="path-icon">
                <ShieldCheck size={24} />
              </div>
              <b>Reserved payroll</b>
              <strong>{money(d.treasury.reserved, false)}</strong>
              <small>Fully prefunded</small>
            </div>
            <span className="path-connector">
              <i />
              <ArrowRight size={18} />
            </span>
            <div className="path-node">
              <div className="path-people">
                {active.slice(0, 3).map((e: any) => (
                  <span key={e.id}>
                    {e.name
                      .split(' ')
                      .map((s: string) => s[0])
                      .join('')}
                  </span>
                ))}
              </div>
              <b>Salary Vaults</b>
              <strong>{credited.length}</strong>
              <small>Salary credits completed</small>
            </div>
          </div>
        </section>
        <div className="metrics-strip">
          <Metric
            label="People on payroll"
            value={active.length}
            detail={
              d.employees.filter((e: any) => e.status === 'INVITED').length + ' invitations pending'
            }
          />
          <Metric label="Awaiting a payday" value={pending.length} detail="Funded obligations" />
          <Metric
            label="Employer bonus reserve"
            value={money(d.treasury.bonus, false)}
            detail="demoUSD, outside payroll"
          />
          <Metric
            label="Automation"
            value={
              d.worker && Date.now() - new Date(d.worker.lastSeen).getTime() < 20000
                ? 'Running'
                : 'Waiting'
            }
            detail={
              d.worker
                ? 'Last scan ' + time(d.worker.lastSeen)
                : 'Start the worker to run schedules'
            }
          />
        </div>
        <div className="content-split">
          <Panel
            title="The people behind the payroll"
            subtitle="A clear view of each pay agreement."
            action={<ArrowLink onClick={() => ctx.go('employees')}>Manage team</ArrowLink>}
          >
            {employeeTable(d.employees.slice(0, 5), true)}
          </Panel>
          <div className="side-stack">
            <Panel title="Before the next payday" className="quiet-panel">
              <div className="check-line">
                <CheckCircle2 size={18} />
                <div>
                  <b>Your books are separate</b>
                  <p>Demo balances never become testnet funds.</p>
                </div>
              </div>
              <div className="check-line">
                <CalendarDays size={18} />
                <div>
                  <b>Dates follow your team</b>
                  <p>{d.company.timezone}. Monthly dates use the last available calendar day.</p>
                </div>
              </div>
              <ArrowLink onClick={() => ctx.go('treasury')}>Review the treasury</ArrowLink>
            </Panel>
            <button className="assistant-callout" onClick={() => ctx.go('assistant')}>
              <span className="assistant-mark">n</span>
              <div>
                <b>Work it out with numa</b>
                <p>“Increase Design salaries by 5%”</p>
              </div>
              <ArrowUpRight size={20} />
            </button>
          </div>
        </div>
      </>
    );
  if (page === 'employees')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Company / People</p>
            <h1>Your team, in rhythm.</h1>
            <p>Define the pay agreement once. Let the funded schedule do the rest.</p>
          </div>
          <div className="button-group">
            <Button variant="secondary" onClick={importCsv} disabled={!canWrite}>
              <Upload size={16} />
              Import CSV
            </Button>
            <Button onClick={invite} disabled={!canWrite || !d.roles.length}>
              <Plus size={16} />
              Invite employee
            </Button>
          </div>
        </div>
        <Panel>
          <div className="toolbar">
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Search employees"
                placeholder="Find someone on your team"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Filter job role"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All job roles</option>
              {d.roles.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={bulk} disabled={!canSign}>
              <SlidersHorizontal size={16} />
              Adjust salaries
            </Button>
          </div>
          {employeeTable(
            d.employees.filter(
              (e: any) =>
                (e.name + ' ' + e.email).toLowerCase().includes(search.toLowerCase()) &&
                (filter === 'all' || e.roleId === filter),
            ),
          )}
          {!d.employees.length ? (
            <Empty
              title="Make room for your first teammate"
              action={<Button onClick={invite}>Invite employee</Button>}
            />
          ) : null}
        </Panel>
        <Notice>
          A salary amount belongs to its period. A weekly amount is not silently converted to a
          monthly salary. Job roles and workspace permissions are managed separately.
        </Notice>
      </>
    );
  if (page === 'roles')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Company / Job roles</p>
            <h1>A role for every contribution.</h1>
            <p>Set defaults and make salary changes to a whole group.</p>
          </div>
          <Button onClick={() => roleForm()} disabled={!canWrite}>
            <Plus size={16} />
            Create role
          </Button>
        </div>
        <Panel>
          <Table headers={['Job role', 'People', 'Default / period', 'Frequency', 'Actions']}>
            {d.roles.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>{d.employees.filter((e: any) => e.roleId === r.id).length}</td>
                <td>{money(r.salary)}</td>
                <td>{periodLabel[r.cadence]}</td>
                <td>
                  <Button variant="quiet" onClick={() => roleForm(r)} disabled={!canWrite}>
                    Edit role
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Notice>
          Changing a role’s default applies to new agreements. Use Adjust salaries to preview and
          change current employee pay.
        </Notice>
      </>
    );
  if (page === 'payroll')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Company / Payroll</p>
            <h1>Every payment, accounted for.</h1>
            <p>Authorize a funded window. Track each employee’s independent obligation.</p>
          </div>
          <Button onClick={payroll} disabled={!canSign}>
            <Play size={16} />
            Prepare payroll
          </Button>
        </div>
        <div className="metrics-strip">
          <Metric
            label="Reserved for employees"
            value={money(d.treasury.reserved, false)}
            detail="demoUSD protected from spending"
          />
          <Metric label="Pending obligations" value={pending.length} />
          <Metric label="Salary vault credits" value={credited.length} />
        </div>
        <Panel
          title="Payroll obligations"
          subtitle="A vault credit is separate from an external withdrawal."
        >
          {d.obligations.length ? (
            <Table headers={['Employee', 'Due', 'Amount', 'State', 'Controls']}>
              {[...d.obligations]
                .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
                .map((o: any) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.name}</b>
                      {o.accelerated ? (
                        <small className="cell-note">Accelerated Demo Schedule</small>
                      ) : null}
                    </td>
                    <td>{time(o.dueAt)}</td>
                    <td>
                      {money(o.amount)}
                      {o.earlyGross !== '0' ? (
                        <small className="cell-note">{money(o.earlyGross)} already advanced</small>
                      ) : null}
                    </td>
                    <td>
                      <Badge
                        tone={o.state === 'CREDITED' ? 'good' : o.paused ? 'copper' : 'neutral'}
                      >
                        {o.state === 'CREDITED'
                          ? 'Credited to Salary Vault'
                          : o.paused
                            ? 'Automation paused'
                            : 'Reserved'}
                      </Badge>
                    </td>
                    <td>
                      {o.state === 'RESERVED' && canSign ? (
                        <div className="button-group">
                          <Button
                            variant="quiet"
                            onClick={() =>
                              void run('payroll.pause', {
                                id: o.id,
                                paused: !o.paused,
                                expectedVersion: o.version,
                              }).catch(() => {})
                            }
                          >
                            {o.paused ? 'Resume' : 'Pause'}
                          </Button>
                          <Button
                            variant="quiet"
                            onClick={() =>
                              form({
                                title: 'Confirm earned salary',
                                description:
                                  'Confirm only work already performed. This makes an early-pay scenario available.',
                                fields: [
                                  {
                                    id: 'amount',
                                    label: 'Confirmed earned amount (demoUSD)',
                                    type: 'number',
                                    min: '0',
                                    step: '0.01',
                                    value: decimal(o.earned || '0'),
                                  },
                                ],
                                submitLabel: 'Confirm earned amount',
                                submit: (v) =>
                                  run('salary.confirm-earned', {
                                    id: o.id,
                                    amount: atomic(v.amount),
                                    expectedVersion: o.version,
                                  }),
                              })
                            }
                          >
                            Confirm earned
                          </Button>
                          {new Date(o.dueAt).getTime() > Date.now() ? (
                            <Button
                              variant="quiet"
                              onClick={() =>
                                form({
                                  title: 'Add payroll adjustment',
                                  fields: [
                                    {
                                      id: 'kind',
                                      label: 'Adjustment',
                                      type: 'select',
                                      options: [
                                        { value: 'bonus', label: 'Bonus' },
                                        { value: 'deduction', label: 'Deduction' },
                                      ],
                                    },
                                    {
                                      id: 'amount',
                                      label: 'Amount (demoUSD)',
                                      type: 'number',
                                      step: '0.01',
                                      min: '0.01',
                                    },
                                    { id: 'reason', label: 'Reason' },
                                  ],
                                  submitLabel: 'Record adjustment',
                                  submit: (v) =>
                                    run('payroll.adjust', {
                                      id: o.id,
                                      kind: v.kind,
                                      amount: atomic(v.amount),
                                      reason: v.reason,
                                      expectedVersion: o.version,
                                    }),
                                })
                              }
                            >
                              Adjust
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="muted">Settled</span>
                      )}
                    </td>
                  </tr>
                ))}
            </Table>
          ) : (
            <Empty
              title="Your first payroll starts here"
              action={
                <Button onClick={payroll} disabled={!canSign}>
                  Prepare payroll
                </Button>
              }
            >
              Preview a 30-day calendar window, or use the clearly labeled accelerated demo.
            </Empty>
          )}
        </Panel>
        <Notice>
          Pausing automation preserves employee claims. Due, authorized salary can still be claimed
          by the employee.
        </Notice>
      </>
    );
  if (page === 'treasury')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Company / Treasury</p>
            <h1>Give the next payday a home.</h1>
            <p>Free cash, protected payroll and bonus funding stay separate.</p>
          </div>
          <Button onClick={() => fund()} disabled={!canSign}>
            <Plus size={16} />
            Add demo funds
          </Button>
        </div>
        <section className="treasury-layout">
          <div className="treasury-main">
            <Wallet size={30} />
            <p>Available treasury</p>
            <h2>
              {money(d.treasury.cash, false)}
              <small>demoUSD</small>
            </h2>
            <span>Simulation funds. No market value.</span>
          </div>
          <div className="treasury-reserves">
            <Metric
              label="Reserved payroll"
              value={money(d.treasury.reserved)}
              detail="Cannot be used for other spending"
            />
            <Metric
              label="Employer bonus pool"
              value={money(d.treasury.bonus)}
              detail={<ArrowLink onClick={() => fund('bonus')}>Fund bonus pool</ArrowLink>}
            />
          </div>
        </section>
        <Notice>
          Automatic salary payments require 100% of the authorized window to be reserved. Uninvested
          treasury earns no assumed return. Hold bonuses are paid from an explicitly funded employer
          pool.
        </Notice>
        <Panel title="Recent treasury activity">
          <Table headers={['Date', 'Event', 'Description']}>
            {d.ledger
              .filter((l: any) =>
                l.lines.some(
                  (x: any) =>
                    x.account.includes(':forma:') || x.account.includes(':' + d.company.id + ':'),
                ),
              )
              .slice(0, 10)
              .map((l: any) => (
                <tr key={l.id}>
                  <td>{time(l.created_at)}</td>
                  <td>
                    <Badge>{l.kind.toLowerCase()}</Badge>
                  </td>
                  <td>{l.description}</td>
                </tr>
              ))}
          </Table>
        </Panel>
      </>
    );
  if (page === 'reports') {
    const total = credited.reduce((s: bigint, o: any) => s + BigInt(o.amount), 0n);
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Company / Reports</p>
            <h1>The story behind the numbers.</h1>
            <p>Follow recorded payroll and inspect the balanced journal.</p>
          </div>
          <a
            className="btn secondary"
            href={'/api/v1/reports/export.csv?scope=company&companyId=' + d.company.id}
          >
            <Download size={16} />
            Export ledger CSV
          </a>
        </div>
        <div className="metrics-strip">
          <Metric label="Credited payroll" value={money(total.toString())} />
          <Metric label="Ledger entries" value={d.ledger.length} />
          <Metric label="Book" value="demoUSD" detail="Kept separate from testNEAR" />
        </div>
        <Panel title="Payroll by job role">
          {d.roles.map((r: any) => {
            const paid = credited
              .filter(
                (o: any) => d.employees.find((e: any) => e.id === o.employeeId)?.roleId === r.id,
              )
              .reduce((s: bigint, o: any) => s + BigInt(o.amount), 0n);
            return (
              <div className="report-bar" key={r.id}>
                <div className="spread">
                  <b>{r.name}</b>
                  <span>{money(paid.toString())}</span>
                </div>
                <Progress
                  value={total === 0n ? 0 : Number((paid * 100n) / total)}
                  label={r.name + ' share of credited payroll'}
                />
              </div>
            );
          })}
        </Panel>
        <Panel
          title="General ledger"
          subtitle="Atomic amounts in CSV are exact. Every entry has equal debits and credits."
        >
          <Table headers={['Date', 'Entry', 'Description', 'Debit total', 'Balance']}>
            {d.ledger.map((l: any) => {
              const dr = l.lines
                .filter((x: any) => x.side === 'DEBIT')
                .reduce((s: bigint, x: any) => s + BigInt(x.amount), 0n);
              const cr = l.lines
                .filter((x: any) => x.side === 'CREDIT')
                .reduce((s: bigint, x: any) => s + BigInt(x.amount), 0n);
              return (
                <tr key={l.id}>
                  <td>{time(l.created_at)}</td>
                  <td>{l.kind}</td>
                  <td>{l.description}</td>
                  <td>{money(dr.toString())}</td>
                  <td>
                    <Badge tone={dr === cr ? 'good' : 'bad'}>
                      {dr === cr ? 'Balanced' : 'Unbalanced'}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      </>
    );
  }
  if (page === 'settings')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Company / Settings</p>
            <h1>A workspace that fits your team.</h1>
            <p>Manage identity and calendar preferences.</p>
          </div>
        </div>
        <Panel
          title="Company profile"
          action={
            <Button
              variant="secondary"
              disabled={!canSign}
              onClick={() =>
                form({
                  title: 'Company settings',
                  fields: [
                    { id: 'name', label: 'Company name', value: d.company.name },
                    {
                      id: 'timezone',
                      label: 'IANA timezone',
                      value: d.company.timezone,
                      hint: 'For example Europe/London or Asia/Tehran',
                    },
                  ],
                  submitLabel: 'Save settings',
                  submit: (v) =>
                    run('company.settings', { ...v, expectedVersion: d.company.version }),
                })
              }
            >
              Edit profile
            </Button>
          }
        >
          <dl className="details">
            <div>
              <dt>Company</dt>
              <dd>{d.company.name}</dd>
            </div>
            <div>
              <dt>Calendar timezone</dt>
              <dd>{d.company.timezone}</dd>
            </div>
            <div>
              <dt>Payroll book</dt>
              <dd>demoUSD / Simulation</dd>
            </div>
            <div>
              <dt>Your access</dt>
              <dd>{d.access}</dd>
            </div>
          </dl>
        </Panel>
        <Notice>
          Timezone changes affect newly prepared obligations. Existing authorized due dates stay
          fixed.
        </Notice>
        <Panel title="Access boundaries">
          <p>
            Owners authorize funding and payments. Accountants prepare data and reports. Observers
            have read-only access. Job roles never grant any of these permissions.
          </p>
        </Panel>
      </>
    );
  return null;
}
