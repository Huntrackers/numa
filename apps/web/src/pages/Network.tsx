import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ExternalLink, RefreshCw, Wallet, ShieldCheck } from 'lucide-react';
import { api, localInput } from '../api';
import { Button, Panel, Badge, Notice, Metric, ErrorNotice, Table } from '../components';
import type { UIContext } from '../types';
import { connectWallet, signInWallet, sendTransaction } from '../wallet';
import './Network.css';
const yocto = (v: string) => {
  if (!/^\d+(\.\d{0,24})?$/.test(v)) throw new Error('Use up to 24 decimal places for testNEAR.');
  const [w, f = ''] = v.split('.');
  return (BigInt(w) * 10n ** 24n + BigInt(f.padEnd(24, '0'))).toString();
};
export default function Network({ ctx }: { ctx: UIContext }) {
  const [calendar, setCalendar] = useState<any>();
  const [walletAccount, setWalletAccount] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [state, setState] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await api('/chain/context'));
    } catch (e) {
      setState(undefined);
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const prepare = async (method: string, args: any, deposit = '0') => {
    const op = await api('/chain/prepare', {
      method: 'POST',
      body: JSON.stringify({ method, args, deposit }),
    });
    sessionStorage.setItem('noma-chain-operation', op.id);
    const result = await sendTransaction(op.transaction);
    if (result?.transaction?.hash) {
      const verified = await api('/chain/operations', {
        method: 'POST',
        body: JSON.stringify({ operationId: op.id, txHash: result.transaction.hash }),
      });
      ctx.result(
        'Testnet transaction confirmed',
        'The server independently checked the signer, contract, arguments and receipts.',
        [{ label: 'Explorer', value: 'https://testnet.nearblocks.io/txns/' + verified.txHash }],
      );
      await load();
    }
  };
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const hash = q.get('transactionHashes'),
      operationId = sessionStorage.getItem('noma-chain-operation');
    if (hash && operationId) {
      void api('/chain/operations', {
        method: 'POST',
        body: JSON.stringify({ operationId, txHash: hash.split(',')[0] }),
      })
        .then((r) => {
          ctx.result('Testnet transaction confirmed', 'Verified against finalized RPC receipts.', [
            { label: 'Transaction', value: r.txHash },
          ]);
          sessionStorage.removeItem('noma-chain-operation');
          history.replaceState({}, '', location.pathname);
          void load();
        })
        .catch(setError);
    }
  }, []);
  const can = state?.mode === 'TESTNET' && !!state.contractId;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="context-line">NEAR / Testnet workspace</p>
          <h1>A real network. A separate book.</h1>
          <p>Native testNEAR payments and goals, without using mainnet funds.</p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} />
          Refresh chain state
        </Button>
      </div>
      <Notice>
        testNEAR has no monetary value. DemoUSD is a separate simulation unit with no conversion
        rate to testNEAR. Mainnet transactions are disabled.
      </Notice>
      <ErrorNotice error={error} />
      {state?.error ? (
        <Notice tone="warning">
          Testnet data is temporarily unavailable ({state.error}). Refresh after a moment. Wallet
          requests remain subject to an independent receipt check.
        </Notice>
      ) : null}
      <div className="metrics-strip">
        <Metric label="Network" value="NEAR testnet" />
        <Metric
          label="Wallet identity"
          value={state?.accountId || 'Not connected'}
          detail={state?.accountId ? 'NEP-413 verified' : 'Demo sign-in does not verify a wallet'}
        />
        <Metric
          label="Contract"
          value={state?.contractId || 'Not deployed'}
          detail={
            state?.contractId ? 'Configured testnet account' : 'Contract actions stay disabled'
          }
        />
      </div>
      {state?.mode !== 'TESTNET' ? (
        <Panel title="Connect your testnet identity">
          <p>
            Use Meteor Wallet to sign a one-time sign-in message. numa never asks for a private key
            or seed phrase.
          </p>
          {walletAccount ? (
            <p>Connected: {walletAccount}. Verify your identity to open the testnet workspace.</p>
          ) : null}
          <Button
            disabled={connecting}
            onClick={() => {
              setError(null);
              setConnecting(true);
              void (async () => {
                if (!walletAccount) {
                  setWalletAccount(await connectWallet());
                } else {
                  sessionStorage.setItem('numa-return-path', location.pathname);
                  const result = await signInWallet();
                  if (result) location.reload();
                }
              })()
                .catch(setError)
                .finally(() => setConnecting(false));
            }}
          >
            {connecting
              ? 'Waiting for wallet…'
              : walletAccount
                ? 'Verify testnet identity'
                : 'Connect testnet wallet'}
            <Wallet size={16} />
          </Button>
        </Panel>
      ) : null}
      {state?.balance ? (
        <Panel title="Wallet on NEAR testnet">
          <div className="spread">
            <Metric
              label="Native wallet balance"
              value={(Number(state.balance.amount) / 1e24).toFixed(5) + ' testNEAR'}
            />
            <a
              className="text-button"
              href={'https://testnet.nearblocks.io/address/' + state.accountId}
              target="_blank"
              rel="noreferrer"
            >
              View account
              <ExternalLink size={15} />
            </a>
          </div>
        </Panel>
      ) : null}
      <div className="two-columns">
        <Panel
          title="Company contract actions"
          subtitle="Every write is signed by your connected wallet."
        >
          <div className="action-list">
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Register a company on testnet',
                  fields: [
                    {
                      id: 'companyId',
                      label: 'Public company ID',
                      hint: 'An opaque identifier; do not publish employee names or emails.',
                    },
                  ],
                  submitLabel: 'Prepare wallet transaction',
                  submit: (v) =>
                    prepare('register_company', {
                      company_id: v.companyId,
                      operation_id: crypto.randomUUID(),
                    }),
                })
              }
            >
              Register company
              <ArrowUpRight size={16} />
            </Button>
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Fund the testnet treasury',
                  fields: [
                    { id: 'companyId', label: 'Company ID' },
                    {
                      id: 'amount',
                      label: 'Amount (testNEAR)',
                      type: 'number',
                      min: '0.001',
                      step: '0.001',
                      value: '0.1',
                    },
                  ],
                  submitLabel: 'Review in wallet',
                  submit: (v) =>
                    prepare('fund_treasury', { company_id: v.companyId }, yocto(v.amount)),
                })
              }
            >
              Fund treasury
              <ArrowUpRight size={16} />
            </Button>
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Register an employee on testnet',
                  fields: [
                    { id: 'companyId', label: 'Company ID' },
                    { id: 'employeeId', label: 'Opaque employee ID' },
                    { id: 'accountId', label: 'Employee NEAR account' },
                  ],
                  submitLabel: 'Review in wallet',
                  submit: (v) =>
                    prepare('register_employee', {
                      company_id: v.companyId,
                      employee_id: v.employeeId,
                      account_id: v.accountId,
                    }),
                })
              }
            >
              Register employee
              <ArrowUpRight size={16} />
            </Button>
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Prepare a calendar payroll',
                  description:
                    'Daily, weekly or monthly payments are fully funded and executed by the testnet worker. Reuse a schedule ID to prevent duplicate periods.',
                  fields: [
                    { id: 'companyId', label: 'Company ID' },
                    { id: 'employeeId', label: 'Employee ID' },
                    { id: 'scheduleId', label: 'Stable schedule ID', value: 'schedule-v1' },
                    {
                      id: 'amount',
                      label: 'Amount per period (testNEAR)',
                      type: 'number',
                      min: '0.001',
                      step: '0.001',
                      value: '0.01',
                    },
                    {
                      id: 'cadence',
                      label: 'Pay period',
                      type: 'select',
                      options: [
                        { value: 'daily', label: 'Daily' },
                        { value: 'weekly', label: 'Weekly' },
                        { value: 'monthly', label: 'Monthly' },
                      ],
                    },
                    {
                      id: 'anchor',
                      label: 'First payment (your local time)',
                      type: 'datetime-local',
                      value: localInput(Date.now() + 120000),
                    },
                    {
                      id: 'timezone',
                      label: 'IANA timezone',
                      value: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
                    {
                      id: 'days',
                      label: 'Authorization window (days)',
                      type: 'number',
                      min: '1',
                      value: '7',
                    },
                  ],
                  submitLabel: 'Calculate payroll preview',
                  submit: async (v) => {
                    const p = await api('/chain/payroll-preview', {
                      method: 'POST',
                      body: JSON.stringify({
                        ...v,
                        amount: yocto(v.amount),
                        anchor: new Date(v.anchor).toISOString(),
                        days: Number(v.days),
                      }),
                    });
                    setCalendar(p);
                  },
                })
              }
            >
              Prepare calendar payroll
              <ArrowUpRight size={16} />
            </Button>
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Authorize one testnet obligation',
                  description:
                    'A small testnet smoke workflow. Full company calendar preparation is available in the demo panel.',
                  fields: [
                    { id: 'companyId', label: 'Company ID' },
                    { id: 'employeeId', label: 'Employee ID' },
                    {
                      id: 'amount',
                      label: 'Salary (testNEAR)',
                      type: 'number',
                      step: '0.001',
                      min: '0.001',
                      value: '0.01',
                    },
                    {
                      id: 'dueAt',
                      label: 'Due date (your local time)',
                      type: 'datetime-local',
                      value: localInput(Date.now() + 120000),
                    },
                  ],
                  submitLabel: 'Review authorization in wallet',
                  submit: (v) =>
                    prepare('authorize_mandate', {
                      company_id: v.companyId,
                      obligations: [
                        {
                          id: crypto.randomUUID(),
                          employee_id: v.employeeId,
                          amount: yocto(v.amount),
                          due_at: (BigInt(new Date(v.dueAt).getTime()) * 1000000n).toString(),
                        },
                      ],
                      execution_not_after: (BigInt(Date.now() + 86400000) * 1000000n).toString(),
                    }),
                })
              }
            >
              Authorize a funded payment
              <ArrowUpRight size={16} />
            </Button>
          </div>
        </Panel>
        <Panel
          title="Employee contract actions"
          subtitle="Claims and withdrawals depend on on-chain balances."
        >
          <div className="action-list">
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Accept employment',
                  fields: [
                    { id: 'companyId', label: 'Company ID' },
                    { id: 'employeeId', label: 'Employee ID' },
                  ],
                  submitLabel: 'Review in wallet',
                  submit: (v) =>
                    prepare('accept_employment', {
                      company_id: v.companyId,
                      employee_id: v.employeeId,
                    }),
                })
              }
            >
              Accept employment
              <ArrowUpRight size={16} />
            </Button>
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Claim a due salary',
                  fields: [{ id: 'obligationId', label: 'Obligation ID' }],
                  submitLabel: 'Review claim in wallet',
                  submit: (v) => prepare('claim_due', { obligation_id: v.obligationId }),
                })
              }
            >
              Claim due salary
              <ArrowUpRight size={16} />
            </Button>
            <Button
              disabled={!can}
              variant="secondary"
              onClick={() =>
                ctx.form({
                  title: 'Withdraw to your own wallet',
                  description:
                    'Only free on-chain salary cash can be withdrawn. Goal reserves are excluded.',
                  fields: [
                    {
                      id: 'amount',
                      label: 'Amount (testNEAR)',
                      type: 'number',
                      min: '0.001',
                      step: '0.001',
                    },
                  ],
                  submitLabel: 'Review withdrawal in wallet',
                  submit: (v) =>
                    prepare('request_withdrawal', {
                      amount: yocto(v.amount),
                      operation_id: crypto.randomUUID(),
                    }),
                })
              }
            >
              Withdraw testNEAR
              <ArrowUpRight size={16} />
            </Button>
          </div>
        </Panel>
      </div>
      {calendar ? (
        <Panel title="Calendar payroll decision preview">
          <Notice>
            Review every period before signing. The full window is reserved from company free funds.
          </Notice>
          <Table headers={['Employee ID', 'Due date', 'Amount (testNEAR)']}>
            {calendar.rows.map((o: any) => (
              <tr key={o.id}>
                <td>{o.employee_id}</td>
                <td>{new Date(Number(BigInt(o.due_at) / 1000000n)).toLocaleString()}</td>
                <td>{(Number(o.amount) / 1e24).toFixed(6)}</td>
              </tr>
            ))}
          </Table>
          <div className="panel-footer">
            <span>Total {(Number(calendar.total) / 1e24).toFixed(6)} testNEAR</span>
            <Button
              onClick={() => {
                void prepare(calendar.transaction.method, calendar.transaction.args)
                  .then(() => setCalendar(null))
                  .catch(setError);
              }}
            >
              Review authorization in wallet
            </Button>
            <Button variant="quiet" onClick={() => setCalendar(null)}>
              Discard preview
            </Button>
          </div>
        </Panel>
      ) : null}
      {state?.companies?.length ? (
        <Panel title="Your on-chain company treasuries">
          <Table headers={['Public company ID', 'Free (testNEAR)', 'Reserved (testNEAR)']}>
            {state.companies.map(([id, c]: any) => (
              <tr key={id}>
                <td>{id}</td>
                <td>{(Number(c.free) / 1e24).toFixed(6)}</td>
                <td>{(Number(c.reserved) / 1e24).toFixed(6)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
      {state?.employments?.length ? (
        <Panel title="Your employments on NEAR">
          <Table headers={['Company ID', 'Employee ID', 'Status']}>
            {state.employments.map((e: any) => (
              <tr key={e.company_id + e.employee_id}>
                <td>{e.company_id}</td>
                <td>{e.employee_id}</td>
                <td>{e.accepted ? 'Accepted' : 'Awaiting acceptance'}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
      {state?.obligations?.length ? (
        <Panel title="Your on-chain salary calendar">
          <Table headers={['Obligation ID', 'Amount (testNEAR)', 'Due date', 'State']}>
            {state.obligations.map((o: any) => (
              <tr key={o.id}>
                <td>{o.id}</td>
                <td>{(Number(o.amount) / 1e24).toFixed(6)}</td>
                <td>{new Date(Number(BigInt(o.due_at) / 1000000n)).toLocaleString()}</td>
                <td>
                  <Badge>
                    {o.credited
                      ? 'Credited'
                      : o.cancelled
                        ? 'Cancelled'
                        : o.paused
                          ? 'Paused'
                          : 'Reserved'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
      {state?.chain ? (
        <Panel title="Your on-chain Salary Vault">
          <Metric
            label="Free cash"
            value={(Number(state.chain.cash) / 1e24).toFixed(6) + ' testNEAR'}
          />
          <p>
            Goal policy: {state.chain.policy.goal_bps / 100}% of each salary, with a cash floor of{' '}
            {(Number(state.chain.policy.cash_floor) / 1e24).toFixed(6)} testNEAR.
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              ctx.form({
                title: 'Set a testnet savings goal',
                description:
                  'For a first empty policy, creates one public opaque goal. Existing goals retain their protected funds.',
                fields: [
                  { id: 'id', label: 'Goal ID', value: 'emergency-fund' },
                  {
                    id: 'target',
                    label: 'Target (testNEAR)',
                    type: 'number',
                    min: '0.001',
                    step: '0.001',
                    value: '0.1',
                  },
                  {
                    id: 'percent',
                    label: 'Salary share for goals (%)',
                    type: 'number',
                    min: '0',
                    step: '1',
                    value: '20',
                  },
                  {
                    id: 'floor',
                    label: 'Cash floor per salary (testNEAR)',
                    type: 'number',
                    min: '0',
                    step: '0.001',
                    value: '0',
                  },
                ],
                submitLabel: 'Review in wallet',
                submit: (v) => {
                  const goals = state.chain.policy.goals;
                  const old = goals.find((g: any) => g.id === v.id);
                  return prepare('set_goal_policy', {
                    goal_bps: Number(v.percent) * 100,
                    cash_floor: yocto(v.floor),
                    expected_version: state.chain.policy.version,
                    goals: [
                      ...goals.filter((g: any) => g.id !== v.id),
                      old
                        ? { ...old, target: yocto(v.target) }
                        : {
                            id: v.id,
                            target: yocto(v.target),
                            funded: '0',
                            priority: goals.length + 1,
                            paused: false,
                            completed: false,
                            released: false,
                          },
                    ],
                  });
                },
              })
            }
          >
            Set savings goal
          </Button>
          {state.chain.policy.goals.map((g: any) => (
            <div className="offer-line" key={g.id}>
              <span>
                {g.id}: {(Number(g.funded) / 1e24).toFixed(6)} /{' '}
                {(Number(g.target) / 1e24).toFixed(6)} testNEAR
              </span>
              <Button
                variant="quiet"
                disabled={g.released}
                onClick={() => {
                  void prepare('release_goal', {
                    goal_id: g.id,
                    expected_version: state.chain.policy.version,
                  }).catch(setError);
                }}
              >
                Release to cash
              </Button>
            </div>
          ))}
        </Panel>
      ) : null}
      {state?.mode === 'TESTNET' ? (
        <SignedDecisions key={state.accountId || ctx.data?.user?.accountId} />
      ) : null}
      <Panel title="Where NEAR fits">
        <div className="integration-story numa-network-integrations">
          <div>
            <b>NEAR Protocol</b>
            <p>
              Native testnet vault, on-chain authorization, atomic goal reserves and finalized
              transaction receipts.
            </p>
            <a href="https://docs.near.org/" target="_blank" rel="noreferrer">
              Protocol documentation
              <ExternalLink size={13} />
            </a>
          </div>
          <div>
            <b>NEAR Intents</b>
            <p>
              The planned cross-chain execution layer for destinations and DCA. Execution is
              simulated in this version.
            </p>
            <a
              href="https://docs.near.org/chain-abstraction/intents/overview"
              target="_blank"
              rel="noreferrer"
            >
              Intents documentation
              <ExternalLink size={13} />
            </a>
          </div>
          <div>
            <b>Local agent tools</b>
            <p>
              Typed proposals, a deterministic financial engine and human approval. No NEAR AI
              hosting integration is claimed.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}

type SignedDecision = {
  id: string;
  accountId: string;
  action: string;
  endpoint: string;
  companyId: string;
  commandHash: string;
  message: string;
  recipient: string;
  nonce: string;
  publicKey: string;
  signature: string;
  approvedAt: string;
  state: string;
};

function SignedDecisions() {
  const [records, setRecords] = useState<SignedDecision[]>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRecords(undefined);
    setError(undefined);
    void api('/approvals', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setRecords(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  return (
    <Panel
      title="Your signed decisions"
      subtitle="Your 50 most recent NEP-413 approvals for local records and planning simulations."
      action={
        <Button variant="quiet" disabled={loading} onClick={retry}>
          <RefreshCw size={14} /> Refresh signed decisions
        </Button>
      }
    >
      <p>
        These NEAR wallet signatures bind the exact decision to your account and this numa domain.
        They do not transfer tokens or prove on-chain settlement. Salary transfers and savings
        changes have separate verified transaction receipts.
      </p>
      <ErrorNotice error={error} />
      {loading ? <p role="status">Loading your signed decisions…</p> : null}
      {records?.length ? (
        <Table headers={['Decision', 'Signed at', 'Local result', 'Proof']}>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{record.action}</td>
              <td>{new Date(record.approvedAt).toLocaleString()}</td>
              <td>
                <Badge
                  tone={
                    record.state === 'APPLIED'
                      ? 'good'
                      : record.state === 'FAILED'
                        ? 'bad'
                        : 'neutral'
                  }
                >
                  {record.state === 'APPLIED'
                    ? 'Applied local decision'
                    : record.state === 'FAILED'
                      ? 'Failed after signature'
                      : 'Signature verified'}
                </Badge>
              </td>
              <td>
                <details>
                  <summary>View signed proof</summary>
                  <dl className="signed-decision-proof">
                    {[
                      ['NEAR account', record.accountId],
                      ['Recipient domain', record.recipient],
                      ['Command SHA-256', record.commandHash],
                      ['Public key', record.publicKey],
                      ['Nonce (base64)', record.nonce],
                      ['Signature (base64)', record.signature],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <pre className="signed-decision-message">{record.message}</pre>
                </details>
              </td>
            </tr>
          ))}
        </Table>
      ) : records ? (
        <p>No signed local decisions yet. Your next approved record change will appear here.</p>
      ) : null}
    </Panel>
  );
}
