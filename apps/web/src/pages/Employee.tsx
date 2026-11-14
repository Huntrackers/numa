import { units, referencePrice } from '../api';
import { loanStress } from '../../../../packages/domain/src/financial-scenarios';
import { savingsFields, savingsValues, savingsSummary } from '../SavingsRules';
import { useState } from 'react';
import {
  Plus,
  ArrowUpRight,
  ArrowRight,
  Wallet,
  Target,
  Repeat2,
  TrendingUp,
  Coins,
  Pause,
  Play,
  Download,
  ShieldCheck,
  CalendarDays,
  Landmark,
  CheckCircle2,
  ExternalLink,
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
  ArrowLink,
} from '../components';
import { money, decimal, atomic, date, time, localInput } from '../api';
import type { UIContext } from '../types';
const colors: Record<string, string> = {
  cash: '#213f52',
  goals: '#6ba5b5',
  dca: '#b86632',
  invest: '#a8bdc9',
  earn: '#78938a',
};
const labels: Record<string, string> = {
  cash: 'Available cash',
  goals: 'Savings goals',
  dca: 'DCA budget',
  invest: 'Immediate investing',
  earn: 'Earn budget',
};
export default function Employee({ ctx }: { ctx: UIContext }) {
  const { data: d, page, run, form, decide } = ctx;
  const [category, setCategory] = useState('All');
  const b = d.balances;
  const routeFields = (asset: string, plan?: any) => [
    {
      id: 'network',
      label: 'Destination network',
      type: 'select',
      value: plan?.network || d.assets.find((a: any) => a.id === asset)?.network,
      options: [...new Set(d.assets.map((a: any) => a.network))].map((v) => ({
        value: String(v),
        label: String(v),
      })),
    },
    {
      id: 'destinationId',
      label: 'Delivery destination (simulation only)',
      type: 'select',
      required: false,
      value: plan?.destinationId || '',
      options: [
        { value: '', label: 'Internal simulated portfolio' },
        ...d.destinations
          .filter((x: any) => x.state === 'ACTIVE')
          .map((x: any) => ({
            value: x.id,
            label: x.label + ' · ' + x.network + ' · address only',
          })),
      ],
    },
    {
      id: 'maxFeeBps',
      label: 'Maximum fee (%)',
      type: 'number',
      min: '0',
      step: '0.01',
      value: String((plan?.maxFeeBps ?? 25) / 100),
    },
  ];
  const scenarioCredit = () =>
    form({
      title: 'Plan a hypothetical payday',
      description:
        'Enter a demoUSD salary yourself. This does not convert testNEAR, mint tokens or move funds. Your saved allocation runs once on this hypothetical credit.',
      fields: [
        {
          id: 'amount',
          label: 'Scenario salary (demoUSD)',
          type: 'number',
          min: '0.01',
          step: '0.01',
          value: '3000',
        },
        {
          id: 'bonusReserve',
          label: 'Hypothetical employer bonus reserve (demoUSD)',
          type: 'number',
          min: '0',
          step: '0.01',
          value: '50',
        },
      ],
      submitLabel: 'Credit scenario salary',
      submit: (v) =>
        run('simulation.credit', {
          amount: atomic(v.amount),
          bonusReserve: atomic(v.bonusReserve),
        }),
    });
  const activeGoals = d.goals.filter((g: any) => g.state === 'ACTIVE');
  const goal = (g?: any) =>
    form({
      title: g ? 'Edit savings goal' : 'Make room for a goal',
      description:
        'Savings are reserved from future salary allocations. Existing savings stay reserved. Confirming saves the target and explicitly activates a closed goal only if you choose Active.',
      fields: [
        { id: 'name', label: 'What are you saving for?', value: g?.name },
        {
          id: 'target',
          label: 'Target (demoUSD)',
          type: 'number',
          min: '0.01',
          step: '0.01',
          value: g ? decimal(g.target) : '3000',
        },
        ...savingsFields(g, 'demoUSD', decimal),
      ],
      submitLabel: 'Confirm goal rules',
      submit: (v) =>
        run('goal.save', {
          name: v.name,
          target: atomic(v.target),
          priority: Number(v.priority),
          ...savingsValues(v, atomic),
          ...(g ? { id: g.id, expectedVersion: g.version } : {}),
        }),
    });
  const trade = (asset: string, side = 'buy') =>
    form({
      title: (side === 'buy' ? 'Invest in ' : 'Sell ') + asset,
      description:
        'A simulated order using a fixed scenario quote. Nothing is submitted to NEAR Intents or a stock exchange.',
      fields: [
        {
          id: 'amount',
          label:
            side === 'buy'
              ? 'Purchase value before fees (demoUSD)'
              : 'Sale value before fees (demoUSD)',
          type: 'number',
          min: '0.01',
          step: '0.01',
          value: '100',
        },
        ...routeFields(asset),
        {
          id: 'slippage',
          label: 'Maximum slippage (%)',
          type: 'number',
          min: '0',
          step: '0.01',
          value: '0.50',
        },
      ],
      submitLabel: 'Preview order',
      submit: (v) =>
        decide('trade', {
          asset,
          side,
          amount: atomic(v.amount),
          network: v.network,
          ...(v.destinationId ? { destinationId: v.destinationId } : {}),
          maxFeeBps: Number(atomic(v.maxFeeBps)),
          slippageBps: Number(atomic(v.slippage)),
        }),
    });
  const dca = (plan?: any) =>
    form({
      title: plan ? 'Edit a DCA plan' : 'Build a steady investing habit',
      description:
        'A separate calendar buys from your prefunded demo budget. Missed occurrences are skipped; catch-up buying is disabled.',
      fields: [
        { id: 'name', label: 'Plan name', value: plan?.name || 'A little, regularly' },
        {
          id: 'asset',
          label: 'Asset',
          type: 'select',
          value: plan?.asset || 'NEAR',
          options: d.assets.map((x: any) => ({ value: x.id, label: x.symbol + ' · ' + x.network })),
        },
        {
          id: 'amount',
          label: 'Purchase per occurrence (demoUSD)',
          type: 'number',
          min: '0.01',
          step: '0.01',
          value: plan ? decimal(plan.amount) : '50',
        },
        {
          id: 'cadence',
          label: 'Frequency',
          type: 'select',
          value: plan?.cadence || 'weekly',
          options: [
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ],
        },
        {
          id: 'anchor',
          label: 'First purchase (your local time)',
          type: 'datetime-local',
          value: plan ? localInput(plan.anchor) : localInput(Date.now() + 60000),
        },
        {
          id: 'maxTotal',
          label: 'Total spending cap including fees (demoUSD, optional)',
          type: 'number',
          min: '0.01',
          step: '0.01',
          required: false,
          value: plan?.maxTotal ? decimal(plan.maxTotal) : '',
        },
        {
          id: 'endAt',
          label: 'End date (optional)',
          type: 'datetime-local',
          required: false,
          value: plan?.endAt ? localInput(plan.endAt) : '',
        },
        ...routeFields(plan?.asset || 'NEAR', plan),
      ],
      onChange: (values, changed) =>
        changed === 'asset'
          ? {
              network: d.assets.find((a: any) => a.id === values.asset)?.network || '',
              destinationId: '',
            }
          : undefined,
      submitLabel: 'Save DCA plan',
      submit: (v) =>
        run('dca.save', {
          name: v.name,
          asset: v.asset,
          network: v.network,
          ...(v.destinationId ? { destinationId: v.destinationId } : {}),
          cadence: v.cadence,
          amount: atomic(v.amount),
          anchor: new Date(v.anchor).toISOString(),
          ...(v.maxTotal ? { maxTotal: atomic(v.maxTotal) } : {}),
          ...(v.endAt ? { endAt: new Date(v.endAt).toISOString() } : {}),
          maxFeeBps: Number(atomic(v.maxFeeBps)),
          ...(plan ? { id: plan.id, expectedVersion: plan.version } : {}),
        }),
    });
  const fundDca = () =>
    form({
      title: 'Fund your DCA budget',
      description:
        'Move free demo cash into a dedicated budget. This is a reserve transfer, not an investment or expense.',
      fields: [
        {
          id: 'amount',
          label: 'Amount (demoUSD)',
          type: 'number',
          min: '0.01',
          step: '0.01',
          value: '100',
        },
      ],
      submitLabel: 'Reserve budget',
      submit: (v) => run('dca.fund', { amount: atomic(v.amount) }),
    });
  const withdraw = () =>
    form({
      title: 'Simulate a withdrawal',
      description:
        'Demo funds move to an external-wallet simulation account. For an actual testNEAR transfer, use the NEAR testnet workspace.',
      fields: [
        { id: 'amount', label: 'Amount (demoUSD)', type: 'number', min: '0.01', step: '0.01' },
      ],
      submitLabel: 'Simulate withdrawal',
      submit: (v) => run('employee.withdraw', { amount: atomic(v.amount) }),
    });
  const netWorth =
    Object.entries(b)
      .filter(([k]) => k !== 'debt')
      .reduce((s, [, v]) => s + BigInt(v as string), 0n) - BigInt(b.debt);
  const goalRows = (limit?: number) => (
    <div className="goals-list">
      {d.goals.slice(0, limit).map((g: any) => (
        <div className="goal-row" key={g.id}>
          <div className="goal-title">
            <div className="goal-glyph">
              <Target size={19} />
            </div>
            <div>
              <b>{g.name}</b>
              <small>
                {money(g.funded, false)} of {money(g.target)} ·{' '}
                {g.state.toLowerCase().replaceAll('_', ' ')}
              </small>
              <small>{savingsSummary(g, money)}</small>
            </div>
            <strong>{Math.floor((Number(g.funded) * 100) / Number(g.target))}%</strong>
          </div>
          <Progress
            value={(Number(g.funded) * 100) / Number(g.target)}
            label={g.name + ' completion'}
            color={g.priority === 1 ? '#6ba5b5' : '#b86632'}
          />
          {page === 'goals' ? (
            <div className="goal-actions">
              <Button variant="quiet" onClick={() => goal(g)}>
                Edit
              </Button>
              {['ACTIVE', 'PAUSED'].includes(g.state) ? (
                <Button
                  variant="quiet"
                  onClick={() =>
                    void run('goal.pause', {
                      id: g.id,
                      paused: g.state === 'ACTIVE',
                      expectedVersion: g.version,
                    }).catch(() => {})
                  }
                >
                  {g.state === 'ACTIVE' ? 'Pause saving' : 'Resume saving'}
                </Button>
              ) : null}
              {BigInt(g.funded) > 0n ? (
                <Button
                  variant="quiet"
                  onClick={() =>
                    form({
                      title: 'Release this goal’s savings?',
                      description:
                        'The reserved amount returns to your available cash. Future contributions stay paused. A completed or archived goal keeps its status. Reactivation requires a new confirmation.',
                      fields: [],
                      submitLabel: 'Release ' + money(g.funded),
                      submit: () => run('goal.release', { id: g.id, expectedVersion: g.version }),
                    })
                  }
                >
                  Release to cash
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
  if (page === 'overview')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / In perspective</p>
            <h1>Make payday go further, {d.employee.name.split(' ')[0]}.</h1>
            <p>Your work earns the money. Your plan gives it direction.</p>
          </div>
          {d.personalSimulation ? (
            <div className="action-row">
              <Button variant="secondary" onClick={scenarioCredit}>
                Plan a scenario payday
              </Button>
              <Button
                variant="quiet"
                onClick={() =>
                  form({
                    title: 'Reset planning simulation',
                    description:
                      'This starts a new empty planning book. The old journal is retained for audit. Your NEAR settlement and wallet connection stay available.',
                    fields: [{ id: 'confirmation', label: 'Type RESET SIMULATION' }],
                    submitLabel: 'Start a new planning book',
                    submit: (v) => run('simulation.reset', v),
                  })
                }
              >
                Reset simulation
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => ctx.go('rules')}>
              Shape your next payday
              <ArrowUpRight size={16} />
            </Button>
          )}
        </div>
        <div className="employee-hero">
          <div className="employee-balance">
            <span>Available salary cash</span>
            <h2>
              {money(b.cash, false)}
              <small>demoUSD</small>
            </h2>
            <p>Ready to use. Separate from your protected reserves.</p>
            <Button variant="light" onClick={withdraw}>
              Simulate withdrawal
              <ArrowUpRight size={16} />
            </Button>
            <div className="hero-wave" aria-hidden="true">
              <svg viewBox="0 0 500 120">
                <path d="M0 100 C80 100 80 50 160 50 S240 85 310 55 S400 10 500 10" />
                <path d="M0 115 C90 115 100 75 180 75 S260 105 340 75 S410 35 500 35" />
              </svg>
            </div>
          </div>
          <div className="payday-plan">
            <div className="spread">
              <h2>Your next salary, already planned.</h2>
              <Badge tone="neutral">Simulation</Badge>
            </div>
            <p>
              {money(d.employee.salary)} / {d.employee.cadence} from {d.company.name}
            </p>
            <div className="allocation-band">
              {(d.policy?.legs || []).map((l: any) => (
                <span key={l.id} style={{ width: l.bps / 100 + '%', background: colors[l.type] }} />
              ))}
            </div>
            <div className="allocation-legend">
              {(d.policy?.legs || []).map((l: any) => (
                <div key={l.id}>
                  <i style={{ background: colors[l.type] }} />
                  <span>{labels[l.type]}</span>
                  <b>{l.bps / 100}%</b>
                </div>
              ))}
            </div>
            <ArrowLink onClick={() => ctx.go('rules')}>Review allocation</ArrowLink>
          </div>
        </div>
        <div className="metrics-strip">
          <Metric
            label="Saved toward goals"
            value={money(b.goals, false)}
            detail={activeGoals.length + ' active goals'}
          />
          <Metric
            label="DCA budget"
            value={money(b.dca, false)}
            detail="Prefunded for future purchases"
          />
          <Metric
            label="Scenario net worth"
            value={money(netWorth.toString(), false)}
            detail="Assets less outstanding debt"
          />
          <Metric
            label="Outstanding debt"
            value={money(b.debt, false)}
            detail="Loan proceeds are not income"
          />
        </div>
        <div className="content-split">
          <Panel
            title="The things you’re making room for"
            action={<ArrowLink onClick={() => ctx.go('goals')}>All goals</ArrowLink>}
          >
            {d.goals.length ? (
              goalRows(2)
            ) : (
              <Empty
                title="Give your savings a purpose"
                action={<Button onClick={() => goal()}>Create a goal</Button>}
              />
            )}
          </Panel>
          <Panel title="A steady habit beats a guess" className="quiet-panel">
            <div className="habit-illustration" aria-hidden="true">
              {[25, 38, 33, 54, 49, 75, 68, 94].map((h, i) => (
                <i key={i} style={{ height: h + '%' }} />
              ))}
            </div>
            <p>
              Choose an amount and a rhythm. DCA uses a reserved budget and asks no market-timing
              questions.
            </p>
            <ArrowLink onClick={() => ctx.go('dca')}>Set a DCA plan</ArrowLink>
            <small className="muted">Illustration of a habit, not a performance chart.</small>
          </Panel>
        </div>
      </>
    );
  if (page === 'salary')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Salary Vault</p>
            <h1>Know where your pay stands.</h1>
            <p>A vault credit is yours. A withdrawal is a separate transfer.</p>
          </div>
          <Button onClick={withdraw}>
            Simulate withdrawal
            <ArrowUpRight size={16} />
          </Button>
        </div>
        <div className="metrics-strip">
          <Metric label="Available" value={money(b.cash)} />
          <Metric label="Goals reserved" value={money(b.goals)} />
          <Metric label="Held salary" value={money(b.holds)} />
        </div>
        <Panel title="Payment calendar" subtitle="Times below use your browser’s local timezone.">
          {d.obligations.length ? (
            <Table headers={['Payment due', 'Nominal salary', 'Status', 'Your action']}>
              {d.obligations.map((o: any) => (
                <tr key={o.id}>
                  <td>
                    {time(o.dueAt)}
                    {o.accelerated ? (
                      <small className="cell-note">Accelerated Demo Schedule</small>
                    ) : null}
                  </td>
                  <td>
                    {money(o.amount)}
                    {o.earlyGross !== '0' ? (
                      <small className="cell-note">Advance: {money(o.earlyGross)}</small>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={o.state === 'CREDITED' ? 'good' : 'neutral'}>
                      {o.state === 'CREDITED'
                        ? 'Credited to Salary Vault'
                        : 'Funded, awaiting due date'}
                    </Badge>
                  </td>
                  <td>
                    {o.state === 'RESERVED' && o.dueAt <= d.serverTime ? (
                      <Button
                        variant="secondary"
                        onClick={() => void run('payroll.claim', { id: o.id }).catch(() => {})}
                      >
                        Claim due salary
                      </Button>
                    ) : (
                      <span className="muted">
                        {o.state === 'CREDITED' ? 'Available in your vault' : 'No action needed'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="A clear calendar starts with an authorization">
              Your employer will reserve an upcoming payment window. Sample cash remains available
              for trying personal finance features.
            </Empty>
          )}
        </Panel>
        <Panel title="Your salary activity">
          <Table headers={['Date', 'Event', 'Description']}>
            {d.ledger.map((l: any) => (
              <tr key={l.id}>
                <td>{time(l.created_at)}</td>
                <td>{l.kind.toLowerCase()}</td>
                <td>{l.description}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  if (page === 'wallets')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Destinations</p>
            <h1>One salary. Your preferred destination.</h1>
            <p>Register network addresses and the asset you would like to receive.</p>
          </div>
          <Button
            onClick={() =>
              form({
                title: 'Add a payout destination',
                description:
                  'Address registration does not prove ownership. Cross-chain delivery is simulated in this version.',
                fields: [
                  { id: 'label', label: 'Destination label' },
                  {
                    id: 'network',
                    label: 'Network',
                    type: 'select',
                    options: ['NEAR', 'Ethereum', 'Base', 'Solana', 'Bitcoin', 'Tron'].map((v) => ({
                      value: v,
                      label: v,
                    })),
                  },
                  { id: 'address', label: 'Wallet address' },
                  { id: 'asset', label: 'Preferred receiving asset', value: 'USDC' },
                ],
                submitLabel: 'Save destination',
                submit: (v) => run('destination.save', v),
              })
            }
          >
            <Plus size={16} />
            Add destination
          </Button>
        </div>
        <Notice>
          NEAR Intents is the intended cross-chain execution layer. This demo stores and validates
          destinations; it does not transfer demoUSD or create wallets on those networks.
        </Notice>
        <Panel title="Your destinations">
          {d.destinations.filter((x: any) => x.state === 'ACTIVE').length ? (
            <Table
              headers={['Destination', 'Network', 'Address', 'Receive', 'Ownership', 'Action']}
            >
              {d.destinations
                .filter((x: any) => x.state === 'ACTIVE')
                .map((x: any) => (
                  <tr key={x.id}>
                    <td>
                      <b>{x.label}</b>
                    </td>
                    <td>{x.network}</td>
                    <td className="address-cell">{x.address}</td>
                    <td>{x.asset}</td>
                    <td>
                      <Badge tone="copper">Unverified address</Badge>
                    </td>
                    <td>
                      <Button
                        variant="quiet"
                        onClick={() =>
                          void run('destination.archive', {
                            id: x.id,
                            expectedVersion: x.version,
                          }).catch(() => {})
                        }
                      >
                        Archive
                      </Button>
                    </td>
                  </tr>
                ))}
            </Table>
          ) : (
            <Empty title="Where should your salary land?">
              Add your existing wallet address. Never enter a seed phrase or private key.
            </Empty>
          )}
        </Panel>
      </>
    );
  if (page === 'rules') return <Allocation ctx={ctx} />;
  if (page === 'goals')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Savings goals</p>
            <h1>Make room for what matters.</h1>
            <p>Your goals receive a share of each salary, in priority order.</p>
          </div>
          <Button onClick={() => goal()}>
            <Plus size={16} />
            Create a goal
          </Button>
        </div>
        <div className="content-split">
          <Panel title="Your savings, with a purpose">
            {d.goals.length ? (
              goalRows()
            ) : (
              <Empty
                title="Start with something you care about"
                action={<Button onClick={() => goal()}>Create a goal</Button>}
              />
            )}
          </Panel>
          <Panel title="How a goal gets funded" className="quiet-panel">
            <div className="steps">
              <p>
                <span>1</span>Give goals a percentage in your salary allocation.
              </p>
              <p>
                <span>2</span>Each salary funds the fixed or percentage contributions in priority
                order, within your goals budget.
              </p>
              <p>
                <span>3</span>Once full, savings stay reserved. Excess follows your cash or
                next-goal choice.
              </p>
            </div>
            <ArrowLink onClick={() => ctx.go('rules')}>Set the goals percentage</ArrowLink>
            <Notice>Demo goals and testNEAR contract goals are separate books.</Notice>
          </Panel>
        </div>
      </>
    );
  if (page === 'dca')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / DCA</p>
            <h1>A little, regularly.</h1>
            <p>Automate a buying rhythm using your salary-funded budget.</p>
          </div>
          <div className="button-group">
            <Button variant="secondary" onClick={fundDca}>
              Fund budget
            </Button>
            <Button onClick={() => dca()}>
              <Plus size={16} />
              New DCA plan
            </Button>
          </div>
        </div>
        <div className="metrics-strip">
          <Metric label="Available DCA budget" value={money(b.dca)} />
          <Metric
            label="Active plans"
            value={d.dca.filter((x: any) => x.state === 'ACTIVE').length}
          />
          <Metric label="Execution" value="Simulated" detail="NEAR Intents workflow" />
        </div>
        <Panel title="Your buying rhythms">
          {d.dca.length ? (
            <Table
              headers={[
                'Plan',
                'Asset',
                'Amount / occurrence',
                'Next purchase',
                'Status',
                'Actions',
              ]}
            >
              {d.dca.map((x: any) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.name}</b>
                    <small className="cell-note">{x.cadence}</small>
                  </td>
                  <td>{x.asset}</td>
                  <td>
                    {money(x.amount)}
                    <small className="cell-note">
                      Spent {money(x.spent || '0')} {x.maxTotal ? 'of ' + money(x.maxTotal) : ''},
                      including fees
                    </small>
                  </td>
                  <td>
                    {time(x.nextDue)}
                    {x.lastOccurrence ? (
                      <small className="cell-note">
                        Last: {x.lastOccurrence.state.replaceAll('_', ' ').toLowerCase()}
                        {x.lastOccurrence.reason ? ' · ' + x.lastOccurrence.reason : ''}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={x.state === 'ACTIVE' ? 'good' : 'neutral'}>
                      {x.state.toLowerCase()}
                    </Badge>
                  </td>
                  <td>
                    <div className="button-group">
                      <Button variant="quiet" onClick={() => dca(x)}>
                        Edit
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() =>
                          void run('dca.pause', {
                            id: x.id,
                            paused: x.state === 'ACTIVE',
                            expectedVersion: x.version,
                          }).catch(() => {})
                        }
                      >
                        {x.state === 'ACTIVE' ? 'Pause' : 'Resume'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty
              title="Make consistency the plan"
              action={<Button onClick={() => dca()}>Create a DCA plan</Button>}
            >
              Select a supported asset and a daily, weekly or monthly schedule.
            </Empty>
          )}
        </Panel>
        <Notice>
          Plans share your DCA budget. A missed purchase or insufficient balance is recorded as
          skipped. The worker never accumulates missed buys after an outage.
        </Notice>
      </>
    );
  if (page === 'invest')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Invest</p>
            <h1>Build a portfolio with intention.</h1>
            <p>Try an investment decision before it becomes a habit.</p>
          </div>
          <Badge tone="copper">All orders simulated</Badge>
        </div>
        <Notice>
          Every reference shows its source and observation time. Versioned fixtures remain available
          offline; public references must pass freshness checks. Stocks and ETFs below are
          educational scenarios; no claim is made that these tickers are currently tradable through
          NEAR Intents.
        </Notice>
        <div className="toolbar simple">
          <div className="tabs">
            {['All', 'Crypto', 'Commodity', 'Stock', 'ETF'].map((c) => (
              <button
                key={c}
                className={category === c ? 'active' : ''}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <span className="muted">
            Cash + investing budget: {money((BigInt(b.cash) + BigInt(b.invest)).toString())}
          </span>
        </div>
        <Panel>
          <Table headers={['Asset', 'Category', 'Scenario network', 'Reference price', 'Action']}>
            {d.assets
              .filter((x: any) => category === 'All' || x.category === category)
              .map((x: any) => (
                <tr key={x.id}>
                  <td>
                    <div className="asset-name">
                      <span className="asset-symbol" style={{ background: x.color }}>
                        {x.symbol === 'BTC' ? '₿' : x.symbol[0]}
                      </span>
                      <div>
                        <b>{x.symbol}</b>
                        <small>{x.name}</small>
                        <small>
                          {x.stale ? 'Stale · ' : ''}
                          {x.priceMode} · {time(x.asOf)}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{x.category}</td>
                  <td>{x.network}</td>
                  <td>{referencePrice(x)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={!x.enabled || x.stale}
                      onClick={() => trade(x.id)}
                    >
                      Preview buy
                      <ArrowUpRight size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
          </Table>
        </Panel>
        <div className="inline-feature">
          <Repeat2 size={24} />
          <div>
            <b>Prefer a regular rhythm?</b>
            <p>Use DCA to buy from a prefunded budget on your chosen schedule.</p>
          </div>
          <Button variant="secondary" onClick={() => ctx.go('dca')}>
            Create a DCA plan
          </Button>
        </div>
      </>
    );
  if (page === 'portfolio')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Portfolio</p>
            <h1>See the whole picture.</h1>
            <p>Holdings and cost basis come from your recorded scenario trades.</p>
          </div>
          <a
            className="btn secondary"
            href={
              '/api/v1/reports/export.csv?scope=employee' +
              (d.personalSimulation ? '&book=simulation' : '')
            }
          >
            <Download size={16} />
            Export ledger
          </a>
        </div>
        <div className="metrics-strip">
          <Metric label="Position value" value={money(b.portfolio)} />
          <Metric
            label="Unrealized P&L"
            value={money(
              d.portfolio.reduce((s: bigint, p: any) => s + BigInt(p.unrealized), 0n).toString(),
            )}
          />
          <Metric label="Outstanding debt" value={money(b.debt)} />
          <Metric label="Scenario net worth" value={money(netWorth.toString())} />
        </div>
        <Panel title="Your holdings">
          {d.portfolio.filter((p: any) => BigInt(p.quantity) > 0n).length ? (
            <Table
              headers={[
                'Asset',
                'Quantity',
                'Cost basis',
                'Scenario value',
                'Unrealized P&L',
                'Actions',
              ]}
            >
              {d.portfolio
                .filter((p: any) => BigInt(p.quantity) > 0n)
                .map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.asset}</b>
                    </td>
                    <td>{units(p.quantity, 8)}</td>
                    <td>{money(p.cost)}</td>
                    <td>{money(p.value)}</td>
                    <td>{money(p.unrealized)}</td>
                    <td>
                      <Button variant="quiet" onClick={() => trade(p.asset, 'sell')}>
                        Preview sell
                      </Button>
                    </td>
                  </tr>
                ))}
            </Table>
          ) : (
            <Empty
              title="Your first holding starts with a decision"
              action={<Button onClick={() => ctx.go('invest')}>Explore investments</Button>}
            >
              Salary and borrowed cash are excluded from investment performance.
            </Empty>
          )}
        </Panel>
        <Panel title="Order history">
          {d.orders.length ? (
            <Table headers={['Date', 'Order', 'Value', 'Fee', 'State']}>
              {d.orders.map((o: any) => (
                <tr key={o.id}>
                  <td>{time(o.createdAt)}</td>
                  <td>
                    {o.side} {o.asset}
                  </td>
                  <td>{money(o.amount)}</td>
                  <td>{money(o.fee)}</td>
                  <td>
                    <Badge tone="copper">Simulated fill</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="panel-padding muted">No orders yet.</p>
          )}
        </Panel>
        <Notice>
          Weighted average cost is used. Trading fees are booked separately; quoted P&L above
          excludes those separately booked expenses. No price history is invented.
        </Notice>
      </>
    );
  if (page === 'money-plan') {
    const p = d.moneyPlan || {};
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Money plan</p>
            <h1>A plan you can live with.</h1>
            <p>Start with expenses and a cash buffer before taking investment risk.</p>
          </div>
          <Button
            onClick={() =>
              form({
                title: 'Update your money plan',
                description:
                  'Outside savings and income are self-reported. They do not create app balances.',
                fields: [
                  {
                    id: 'monthlyIncome',
                    label: 'Expected monthly income (demoUSD)',
                    type: 'number',
                    min: '0',
                    step: '0.01',
                    value: decimal(p.monthlyIncome || '0'),
                  },
                  {
                    id: 'expenses',
                    label: 'Monthly living expenses (demoUSD)',
                    type: 'number',
                    min: '0',
                    step: '0.01',
                    value: decimal(p.expenses || '0'),
                  },
                  {
                    id: 'outsideSavings',
                    label: 'Savings outside numa (demoUSD)',
                    type: 'number',
                    min: '0',
                    step: '0.01',
                    value: decimal(p.outsideSavings || '0'),
                  },
                  {
                    id: 'repayment',
                    label: 'Planned monthly debt repayment (demoUSD)',
                    type: 'number',
                    min: '0',
                    step: '0.01',
                    value: decimal(p.repayment || '0'),
                  },
                ],
                submitLabel: 'Save money plan',
                submit: (v) =>
                  run('money-plan.save', {
                    expenses: atomic(v.expenses),
                    outsideSavings: atomic(v.outsideSavings),
                    monthlyIncome: atomic(v.monthlyIncome),
                    repayment: atomic(v.repayment),
                    ...(d.moneyPlan ? { expectedVersion: p.version } : {}),
                  }),
              })
            }
          >
            Edit money plan
          </Button>
        </div>
        <div className="metrics-strip">
          <Metric label="Monthly expenses" value={money(p.expenses)} />
          <Metric
            label="Free-cash runway"
            value={(Number(b.cash) / Math.max(1, Number(p.expenses))).toFixed(1) + ' months'}
            detail="Excludes locked collateral and goals"
          />
          <Metric label="Self-reported outside savings" value={money(p.outsideSavings)} />
        </div>
        <Panel title="Your monthly room to move">
          <div className="budget-rows">
            <div>
              <span>Expected income</span>
              <b>{money(p.monthlyIncome)}</b>
            </div>
            <div>
              <span>Living expenses</span>
              <b>− {money(p.expenses)}</b>
            </div>
            <div>
              <span>Planned loan repayment</span>
              <b>− {money(p.repayment)}</b>
            </div>
            <div className="budget-total">
              <span>Before investing and new goals</span>
              <b>
                {money(
                  (
                    BigInt(p.monthlyIncome || '0') -
                    BigInt(p.expenses || '0') -
                    BigInt(p.repayment || '0')
                  ).toString(),
                )}
              </b>
            </div>
          </div>
        </Panel>
        <Notice>
          A cash buffer helps absorb income gaps. Borrowing against assets adds interest and
          liquidation risk, so it cannot replace a sustainable spending budget. This page does not
          automatically move funds.
        </Notice>
      </>
    );
  }
  if (page === 'flexible-payday')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Flexible payday</p>
            <h1>Your timing. Clear trade-offs.</h1>
            <p>Get confirmed earnings sooner, or reserve salary for a funded bonus.</p>
          </div>
          <Badge tone="copper">Simulation</Badge>
        </div>
        <div className="two-columns">
          <Panel
            title="Need it a little earlier?"
            subtitle="Only confirmed, earned salary is eligible."
          >
            <p>
              {d.personalSimulation
                ? 'The earned amount below is a self-reported assumption in your personal scenario.'
                : 'The employer confirms earned work against a funded obligation.'}{' '}
              A nominal advance reduces the final salary, while a 1% scenario fee reduces the cash
              you receive.
            </p>
            {d.personalSimulation ? (
              <Button
                variant="secondary"
                onClick={() =>
                  form({
                    title: 'Plan a future scenario payday',
                    description:
                      'Prefund a hypothetical salary in demoUSD and enter an earned-work assumption. This creates no claim against your actual employer.',
                    fields: [
                      {
                        id: 'amount',
                        label: 'Future scenario salary (demoUSD)',
                        type: 'number',
                        min: '0.01',
                        step: '0.01',
                        value: '1000',
                      },
                      {
                        id: 'earned',
                        label: 'Assumed earned salary (demoUSD)',
                        type: 'number',
                        min: '0',
                        step: '0.01',
                        value: '400',
                      },
                      {
                        id: 'dueAt',
                        label: 'Scenario payday (local time)',
                        type: 'datetime-local',
                        value: new Date(
                          Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16),
                      },
                    ],
                    submitLabel: 'Reserve future scenario salary',
                    submit: (v) =>
                      run('simulation.schedule', {
                        amount: atomic(v.amount),
                        earned: atomic(v.earned),
                        dueAt: new Date(v.dueAt).toISOString(),
                      }),
                  })
                }
              >
                Plan a future payday
              </Button>
            ) : null}
            {d.obligations
              .filter(
                (o: any) =>
                  o.state === 'RESERVED' && BigInt(o.earned || '0') > BigInt(o.earlyGross || '0'),
              )
              .map((o: any) => (
                <div className="offer-line" key={o.id}>
                  <span>
                    {money((BigInt(o.earned) - BigInt(o.earlyGross)).toString())} available
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      form({
                        title: 'Preview early pay',
                        fields: [
                          {
                            id: 'gross',
                            label: 'Nominal salary advance (demoUSD)',
                            type: 'number',
                            min: '0.01',
                            step: '0.01',
                            value: '100',
                          },
                        ],
                        submitLabel: 'Review advance',
                        submit: (v) =>
                          decide('early-pay', { obligationId: o.id, gross: atomic(v.gross) }),
                      })
                    }
                  >
                    Review advance
                  </Button>
                </div>
              ))}
            {!d.obligations.some(
              (o: any) =>
                o.state === 'RESERVED' && BigInt(o.earned || '0') > BigInt(o.earlyGross || '0'),
            ) ? (
              <Notice>
                No confirmed earned receivable is available yet. Your employer must reserve payroll
                and confirm earned work first.
              </Notice>
            ) : null}
          </Panel>
          <Panel
            title="Happy to let it wait?"
            subtitle="An employer-funded bonus, with a reserved principal."
          >
            <p>
              Choose a hold period. numa reserves your salary principal and the full offered bonus
              at acceptance. Early exit returns principal and forfeits the unearned bonus.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                form({
                  title: 'Preview a salary hold',
                  description:
                    'The annualized 5% rate is a demo offer funded by the employer, not an investment yield.',
                  fields: [
                    {
                      id: 'amount',
                      label: 'Salary to reserve (demoUSD)',
                      type: 'number',
                      min: '0.01',
                      step: '0.01',
                      value: '500',
                    },
                    {
                      id: 'days',
                      label: 'Hold for days',
                      type: 'number',
                      min: '1',
                      step: '1',
                      value: '30',
                    },
                  ],
                  submitLabel: 'Review hold',
                  submit: (v) => decide('hold', { amount: atomic(v.amount), days: Number(v.days) }),
                })
              }
            >
              Preview a hold
            </Button>
          </Panel>
        </div>
        <Panel title="Your salary holds">
          {d.holds.length ? (
            <Table headers={['Principal', 'Reserved bonus', 'Maturity', 'State', 'Action']}>
              {d.holds.map((h: any) => (
                <tr key={h.id}>
                  <td>{money(h.principal)}</td>
                  <td>{money(h.bonus)}</td>
                  <td>{date(h.maturity)}</td>
                  <td>
                    <Badge>{h.state.toLowerCase().replaceAll('_', ' ')}</Badge>
                  </td>
                  <td>
                    {h.state === 'ACTIVE' ? (
                      <Button
                        variant="quiet"
                        onClick={() =>
                          form({
                            title: 'Exit this salary hold?',
                            description:
                              h.maturity > d.serverTime
                                ? 'You receive the principal. The unearned bonus returns to the employer.'
                                : 'You receive the principal and the earned, funded bonus.',
                            fields: [],
                            submitLabel: 'Exit hold',
                            submit: () => run('hold.exit', { id: h.id }),
                          })
                        }
                      >
                        {h.maturity > d.serverTime ? 'Exit early' : 'Release hold'}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="panel-padding muted">No salary holds yet.</p>
          )}
        </Panel>
        <Notice>
          Neither salary reserves nor bonus reserves are invested, pledged or reused by the company.
          Lower employer costs are not assumed or guaranteed.
        </Notice>
      </>
    );
  if (page === 'borrow')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">Your money / Borrow</p>
            <h1>Borrow with the full picture.</h1>
            <p>Explore collateral, interest and repayment before taking on debt.</p>
          </div>
          <Button
            onClick={() =>
              form({
                title: 'Preview a collateral loan',
                description:
                  'Only free, unborrowed demo salary cash is eligible in this educational model. It does not interact with Rhea.',
                fields: [
                  {
                    id: 'collateral',
                    label: 'Cash collateral to lock (demoUSD)',
                    type: 'number',
                    min: '0.01',
                    step: '0.01',
                    value: '1000',
                  },
                  {
                    id: 'principal',
                    label: 'Amount to borrow (demoUSD)',
                    type: 'number',
                    min: '0.01',
                    step: '0.01',
                    value: '400',
                  },
                ],
                submitLabel: 'Review borrowing cost',
                submit: (v) =>
                  decide('loan', {
                    collateral: atomic(v.collateral),
                    principal: atomic(v.principal),
                  }),
              })
            }
          >
            Preview a loan
          </Button>
        </div>
        <Notice tone="warning">
          Collateral loans can be liquidated when collateral value falls. Living on repeated
          borrowing can increase debt faster than income. numa’s demo locks cash collateral and caps
          the initial loan at 50%; it is not a live protocol risk model.
        </Notice>
        <div className="metrics-strip">
          <Metric label="Reserved collateral" value={money(b.collateral)} />
          <Metric label="Debt, including interest" value={money(b.debt)} />
          <Metric
            label="Borrowed cash"
            value={money(b.loanCash || '0')}
            detail="Kept separate from salary funds"
          />
          <Metric
            label="Scenario interest"
            value="8% APR"
            detail="Simple daily interest, no compounding"
          />
        </div>
        <Panel title="Borrowed cash for living expenses">
          <div className="spread">
            <p>
              Record a simulated living expense from borrowed funds. Debt stays outstanding and
              these funds cannot be reused as collateral.
            </p>
            <Button
              variant="secondary"
              disabled={BigInt(b.loanCash || '0') === 0n}
              onClick={() =>
                form({
                  title: 'Record a living expense',
                  fields: [
                    {
                      id: 'amount',
                      label: 'Amount from borrowed cash (demoUSD)',
                      type: 'number',
                      min: '0.01',
                      step: '0.01',
                    },
                    { id: 'description', label: 'Expense description', value: 'Living expenses' },
                  ],
                  submitLabel: 'Record expense',
                  submit: (v) =>
                    run('loan.spend', { amount: atomic(v.amount), description: v.description }),
                })
              }
            >
              Use borrowed cash
            </Button>
          </div>
        </Panel>
        <Panel title="Your loan positions">
          {d.loans.length ? (
            <Table headers={['Collateral', 'Principal', 'Accrued interest', 'State', 'Action']}>
              {d.loans.map((l: any) => (
                <tr key={l.id}>
                  <td>{money(l.collateral)}</td>
                  <td>{money(l.principal)}</td>
                  <td>{money(l.interest)}</td>
                  <td>
                    <Badge>{l.state.toLowerCase()}</Badge>
                  </td>
                  <td>
                    {l.state === 'ACTIVE' ? (
                      <>
                        <LoanStressPanel loan={l} moneyPlan={d.moneyPlan} />
                        <Button
                          variant="quiet"
                          onClick={() =>
                            form({
                              title: 'Salary repayment reserve',
                              description:
                                'With explicit consent, each future salary sets aside a limited amount after the cash floor. Reserving does not repay debt. Repay remains a separate action.',
                              fields: [
                                {
                                  id: 'amount',
                                  label: 'Reserve per payday (demoUSD)',
                                  type: 'number',
                                  min: '0',
                                  step: '0.01',
                                  value: decimal(l.repaymentPlan?.amount || '5000'),
                                },
                                {
                                  id: 'maxSalaryBps',
                                  label: 'Maximum share of salary (%)',
                                  type: 'number',
                                  min: '0',
                                  step: '0.01',
                                  value: String((l.repaymentPlan?.maxSalaryBps || 1000) / 100),
                                },
                                {
                                  id: 'consent',
                                  label: 'Salary reserve permission',
                                  type: 'select',
                                  value: String(!!l.repaymentPlan?.enabled),
                                  options: [
                                    { value: 'false', label: 'Disabled' },
                                    { value: 'true', label: 'I consent to reserving salary' },
                                  ],
                                },
                              ],
                              submitLabel: 'Confirm reserve permission',
                              submit: (v) =>
                                run('loan.plan', {
                                  id: l.id,
                                  amount: atomic(v.amount),
                                  maxSalaryBps: Number(atomic(v.maxSalaryBps)),
                                  enabled: v.consent === 'true',
                                  consent: v.consent === 'true',
                                  expectedVersion: l.version,
                                }),
                            })
                          }
                        >
                          Plan repayment reserve
                        </Button>
                        <small>Reserved: {money(l.repaymentReserve || '0')}</small>
                        {BigInt(l.repaymentReserve || '0') > 0n ? (
                          <Button
                            variant="quiet"
                            onClick={() =>
                              void run('loan.reserve-release', { id: l.id }).catch(() => {})
                            }
                          >
                            Release repayment reserve
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          onClick={() =>
                            form({
                              title: 'Repay this loan',
                              description:
                                'Interest is paid first, then principal. Full repayment releases the collateral. Your repayment reserve is used first, then borrowed cash, then free salary cash.',
                              fields: [
                                {
                                  id: 'amount',
                                  label: 'Repayment (demoUSD)',
                                  type: 'number',
                                  min: '0.01',
                                  step: '0.01',
                                  value: decimal(
                                    (BigInt(l.principal) + BigInt(l.interest)).toString(),
                                  ),
                                },
                              ],
                              submitLabel: 'Record repayment',
                              submit: (v) =>
                                run('loan.repay', { id: l.id, amount: atomic(v.amount) }),
                            })
                          }
                        >
                          Repay
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="Understand a loan before opening one">
              A preview shows collateral, debt, the 30-day cost and the scenario health factor.
            </Empty>
          )}
        </Panel>
        <Panel
          title="Try a separate Earn scenario"
          subtitle="Versioned hypothetical scenarios include principal loss and unavailable exit liquidity. No protocol is connected."
        >
          <div className="spread">
            <p>
              Earn is an explicit opt-in using free cash. Its principal is separate from goals and
              held salary.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                form({
                  title: 'Open a simulated Earn position',
                  fields: [
                    {
                      id: 'amount',
                      label: 'Free demo cash (demoUSD)',
                      type: 'number',
                      min: '0.01',
                      step: '0.01',
                      value: '100',
                    },
                    {
                      id: 'scenario',
                      label: 'Hypothetical market scenario',
                      type: 'select',
                      value: 'BASE',
                      options: [
                        { value: 'BASE', label: 'Base · hypothetical 4% APR' },
                        { value: 'LOSS', label: 'Loss · 15% principal loss' },
                        { value: 'ILLIQUID', label: 'No exit liquidity' },
                        { value: 'DELAYED', label: 'Delayed · 24-hour exit' },
                        { value: 'STALE', label: 'Stale exit data' },
                      ],
                    },
                  ],
                  submitLabel: 'Open scenario',
                  submit: (v) =>
                    run('earn.open', { amount: atomic(v.amount), scenario: v.scenario }),
                })
              }
            >
              Try Earn
            </Button>
          </div>
          {d.earn.map((e: any) => (
            <div className="offer-line" key={e.id}>
              <span>
                {money(e.principal)} · {e.scenario || 'BASE'} · {e.state.toLowerCase()}
                {e.exitAvailableAt ? ' · available ' + time(e.exitAvailableAt) : ''}
                {e.loss ? ' · loss ' + money(e.loss) : ''}
              </span>
              {['ACTIVE', 'EXIT_PENDING'].includes(e.state) ? (
                <Button
                  variant="quiet"
                  onClick={() => void run('earn.exit', { id: e.id }).catch(() => {})}
                >
                  Exit scenario
                </Button>
              ) : null}
            </div>
          ))}
        </Panel>
      </>
    );
  return null;
}
function Allocation({ ctx }: { ctx: UIContext }) {
  const d = ctx.data;
  const initial = d.policy?.legs || [{ id: 'cash', type: 'cash', bps: 10000 }];
  const [percent, setPercent] = useState<Record<string, string>>(
    Object.fromEntries(
      ['cash', 'goals', 'dca', 'invest', 'earn'].map((k) => [
        k,
        String((initial.find((l: any) => l.type === k)?.bps || 0) / 100),
      ]),
    ),
  );
  const [primaryAsset, setPrimaryAsset] = useState(
    initial.find((l: any) => l.type === 'invest')?.asset || 'NEAR',
  );
  const [extraInvest, setExtraInvest] = useState<{ id: string; asset: string; percent: string }[]>(
    initial
      .filter((l: any) => l.type === 'invest')
      .slice(1)
      .map((l: any) => ({ id: l.id, asset: l.asset || 'NEAR', percent: String(l.bps / 100) })),
  );
  const [routing, setRouting] = useState<
    Record<string, { destinationId?: string; maxFeeBps?: number }>
  >(
    Object.fromEntries(
      initial
        .filter((l: any) => l.type === 'invest')
        .map((l: any) => [l.id, { destinationId: l.destinationId, maxFeeBps: l.maxFeeBps ?? 25 }]),
    ),
  );
  const routingEditor = (id: string, asset: string) => (
    <div className="form-grid">
      <label className="field">
        <span>Receiving destination · {d.assets.find((a: any) => a.id === asset)?.network}</span>
        <select
          aria-label={'Destination for ' + id}
          value={routing[id]?.destinationId || ''}
          onChange={(e) =>
            setRouting({ ...routing, [id]: { ...routing[id], destinationId: e.target.value } })
          }
        >
          <option value="">Internal simulated portfolio</option>
          {d.destinations
            .filter(
              (x: any) =>
                x.state === 'ACTIVE' &&
                x.network === d.assets.find((a: any) => a.id === asset)?.network,
            )
            .map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.label} · address only
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>Maximum fee (%)</span>
        <input
          aria-label={'Fee cap for ' + id}
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={(routing[id]?.maxFeeBps ?? 25) / 100}
          onChange={(e) =>
            setRouting({
              ...routing,
              [id]: { ...routing[id], maxFeeBps: Math.round(Number(e.target.value) * 100) },
            })
          }
        />
      </label>
    </div>
  );
  const [floor, setFloor] = useState(decimal(d.policy?.cashFloor || '0'));
  const [salary, setSalary] = useState(decimal(d.employee.salary));
  const [horizon, setHorizon] = useState('90');
  const [error, setError] = useState('');
  const total =
    Object.values(percent).reduce((s, v) => s + Number(v || 0), 0) +
    extraInvest.reduce((s, l) => s + Number(l.percent || 0), 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="context-line">Your money / Salary allocation</p>
          <h1>Give every payday direction.</h1>
          <p>One rule for future salary credits. Existing reserves stay untouched.</p>
        </div>
        <Badge tone="copper">demoUSD policy</Badge>
      </div>
      <div className="content-split">
        <Panel
          title="Your allocation rule"
          subtitle="All destinations must add up to exactly 100%."
        >
          <div className="allocation-band large">
            {Object.entries(percent).map(([k, v]) => (
              <span
                key={k}
                style={{ width: Math.max(0, Number(v)) + '%', background: colors[k] }}
              />
            ))}
          </div>
          <div className="allocation-editor">
            {Object.entries(percent).map(([k, v]) => (
              <label key={k}>
                <i style={{ background: colors[k] }} />
                <span>
                  <b>{labels[k]}</b>
                  <small>
                    {
                      {
                        cash: 'Free cash for day-to-day life',
                        goals: 'Reserve for active goals, in priority order',
                        dca: 'Prefund scheduled simulated purchases',
                        invest: 'Buy a chosen asset on each payday, simulated',
                        earn: 'Reserve a budget, no automatic yield',
                      }[k]
                    }
                  </small>
                </span>
                <div className="percent-input">
                  <input
                    aria-label={labels[k] + ' percentage'}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={v}
                    onChange={(e) => setPercent({ ...percent, [k]: e.target.value })}
                  />
                  <span>%</span>
                </div>
              </label>
            ))}
          </div>
          <div className="panel-padding">
            <label className="field">
              <span>Asset for immediate investing</span>
              <select
                aria-label="Asset for immediate investing"
                value={primaryAsset}
                onChange={(e) => setPrimaryAsset(e.target.value)}
              >
                {d.assets.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.symbol} · {a.network}
                  </option>
                ))}
              </select>
              <small>
                The 0.25% scenario fee is deducted from this share. No external swap is sent.
              </small>
            </label>
            {routingEditor('invest', primaryAsset)}
            {extraInvest.map((leg, index) => (
              <div className="form-grid" key={leg.id}>
                <label className="field">
                  <span>Additional asset</span>
                  <select
                    aria-label={'Additional asset ' + (index + 1)}
                    value={leg.asset}
                    onChange={(e) =>
                      setExtraInvest(
                        extraInvest.map((l, i) =>
                          i === index ? { ...l, asset: e.target.value } : l,
                        ),
                      )
                    }
                  >
                    {d.assets.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.symbol} · {a.network}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Salary share (%)</span>
                  <input
                    aria-label={'Additional salary share ' + (index + 1)}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={leg.percent}
                    onChange={(e) =>
                      setExtraInvest(
                        extraInvest.map((l, i) =>
                          i === index ? { ...l, percent: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  variant="quiet"
                  onClick={() => setExtraInvest(extraInvest.filter((_, i) => i !== index))}
                >
                  Remove asset
                </Button>
                {routingEditor(leg.id, leg.asset)}
              </div>
            ))}
            <Button
              variant="secondary"
              disabled={extraInvest.length >= 5}
              onClick={() =>
                setExtraInvest([
                  ...extraInvest,
                  { id: crypto.randomUUID(), asset: 'BTC', percent: '0' },
                ])
              }
            >
              Add another investment asset
            </Button>
          </div>
          <div className="allocation-total">
            <span>Total allocated</span>
            <b className={Math.abs(total - 100) < 0.00001 ? 'good-text' : 'bad-text'}>
              {total.toFixed(2)}%
            </b>
          </div>
          <div className="form-grid panel-padding">
            <label className="field">
              <span>Cash floor per payday (demoUSD)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
              />
              <small>Optional shares shrink proportionally if needed to protect this amount.</small>
            </label>
            <label className="field">
              <span>Salary for this preview (demoUSD)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Forecast horizon (days)</span>
            <input
              type="number"
              min="1"
              max="365"
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
            />
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="panel-footer">
            <Button
              disabled={Math.abs(total - 100) > 0.00001}
              onClick={() => {
                try {
                  setError('');
                  void ctx
                    .decide('allocation', {
                      legs: Object.entries(percent)
                        .map(([k, v]) => ({
                          id: k,
                          type: k,
                          bps: Number(atomic(v)),
                          ...(k === 'invest'
                            ? {
                                asset: primaryAsset,
                                ...(routing[k]?.destinationId
                                  ? { destinationId: routing[k].destinationId }
                                  : {}),
                                maxFeeBps: routing[k]?.maxFeeBps ?? 25,
                              }
                            : {}),
                        }))
                        .concat(
                          extraInvest.map((l) => ({
                            id: l.id,
                            type: 'invest',
                            bps: Number(atomic(l.percent)),
                            asset: l.asset,
                            ...(routing[l.id]?.destinationId
                              ? { destinationId: routing[l.id].destinationId }
                              : {}),
                            maxFeeBps: routing[l.id]?.maxFeeBps ?? 25,
                          })),
                        ),
                      horizonDays: Number(horizon),
                      cashFloor: atomic(floor),
                      salary: atomic(salary),
                      expectedVersion: d.policy?.version || 0,
                    })
                    .catch((e) => setError(e.message));
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Preview this allocation
              <ArrowRight size={16} />
            </Button>
          </div>
        </Panel>
        <div className="side-stack">
          <Panel title="Your safety margin" className="quiet-panel">
            <ShieldCheck size={26} />
            <p>
              Cash gets priority. Targets cannot overfill. Inactive goals receive nothing. Rounding
              leftovers return to cash.
            </p>
            <Notice>
              This policy uses demoUSD. The NEAR testnet contract has a separate cash-and-goals
              policy.
            </Notice>
          </Panel>
          {d.allocationBudgets?.some((b: any) => BigInt(b.balance) > 0n) ? (
            <Panel title="Conversion amounts waiting">
              {d.allocationBudgets
                .filter((b: any) => BigInt(b.balance) > 0n)
                .map((b: any) => (
                  <div key={b.id}>
                    <p>
                      {b.asset}: {money(b.balance)} · {b.state.toLowerCase().replaceAll('_', ' ')}
                    </p>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        void ctx.run('allocation.release', { id: b.id }).catch(() => {});
                      }}
                    >
                      Return unused amount to cash
                    </Button>
                  </div>
                ))}
            </Panel>
          ) : null}
          <Panel title="No six-month guesswork">
            <p>
              A decision preview calculates the next salary using your current goals and balances.
              It does not invent historical investment returns.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function LoanStressPanel({ loan, moneyPlan }: { loan: any; moneyPlan: any }) {
  const [shock, setShock] = useState(30),
    [drop, setDrop] = useState(25);
  const r = loanStress(
    loan.collateral,
    (BigInt(loan.principal) + BigInt(loan.interest)).toString(),
    moneyPlan?.monthlyIncome || '0',
    moneyPlan?.expenses || '0',
    moneyPlan?.repayment || '0',
    shock * 100,
    drop * 100,
  );
  return (
    <details>
      <summary>Test collateral and income shocks</summary>
      <label className="field">
        Collateral loss (%)
        <input
          aria-label="Collateral loss (%)"
          type="number"
          min="0"
          max="99"
          value={shock}
          onChange={(e) => setShock(Math.min(99, Math.max(0, Math.round(Number(e.target.value)))))}
        />
      </label>
      <label className="field">
        Income reduction (%)
        <input
          aria-label="Income reduction (%)"
          type="number"
          min="0"
          max="100"
          value={drop}
          onChange={(e) => setDrop(Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))}
        />
      </label>
      <p>
        Scenario health factor: {r.healthFactor} · Monthly room: {money(r.monthlyRoom)}
      </p>
      <small>{r.source}. This is a read-only stress calculation.</small>
    </details>
  );
}
