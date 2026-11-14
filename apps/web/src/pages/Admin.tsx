import { Building2, Users, Settings2, RefreshCw, ExternalLink } from 'lucide-react';
import { Panel, Button, Badge, Notice, Table, Metric, Empty } from '../components';
import { api, time, sendCommand } from '../api';
import type { UIContext } from '../types';
export default function Admin({ ctx }: { ctx: UIContext }) {
  const { data: d, page, form, run } = ctx;
  if (page === 'companies')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">numa / Operator workspace</p>
            <h1>A clear view across companies.</h1>
            <p>Manage platform access. Financial authority stays with each company and employee.</p>
          </div>
          <Badge tone="copper">Operator access</Badge>
        </div>
        <div className="metrics-strip">
          <Metric label="Companies" value={d.companies.length} />
          <Metric
            label="Active"
            value={d.companies.filter((c: any) => c.status === 'ACTIVE').length}
          />
          <Metric label="Users" value={d.users.length} />
        </div>
        <Panel title="Companies">
          <Table headers={['Company', 'Book', 'Timezone', 'Status', 'Access control']}>
            {d.companies.map((c: any) => (
              <tr key={c.id}>
                <td>
                  <b>{c.name}</b>
                </td>
                <td>
                  {c.unit} / {c.mode === 'TESTNET' ? 'NEAR testnet' : 'Simulation'}
                </td>
                <td>{c.timezone}</td>
                <td>
                  <Badge tone={c.status === 'ACTIVE' ? 'good' : 'copper'}>
                    {c.status.toLowerCase()}
                  </Badge>
                </td>
                <td>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      form({
                        title:
                          c.status === 'ACTIVE'
                            ? 'Suspend company automation?'
                            : 'Restore company access?',
                        description:
                          'Existing employee claims are preserved. This does not grant the operator control over company or employee funds.',
                        fields: [],
                        submitLabel: c.status === 'ACTIVE' ? 'Suspend company' : 'Restore access',
                        submit: () =>
                          run('admin.company-status', {
                            id: c.id,
                            status: c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                            expectedVersion: c.version,
                          }),
                      })
                    }
                  >
                    {c.status === 'ACTIVE' ? 'Suspend' : 'Restore'}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Notice>
          There is no operator withdrawal, balance editor or “mark payment successful” action.
          Company suspension stops automatic execution and preserves earned claims.
        </Notice>
      </>
    );
  if (page === 'users')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">numa / Users</p>
            <h1>People across the platform.</h1>
            <p>Identity status is explicit. Sample accounts do not claim verified wallets.</p>
          </div>
        </div>
        <Panel>
          <Table headers={['Name', 'Workspace role', 'Identity']}>
            {d.users.map((u: any) => (
              <tr key={u.id}>
                <td>
                  <b>{u.name}</b>
                </td>
                <td>{u.role}</td>
                <td>
                  <Badge tone={u.demo ? 'copper' : 'good'}>
                    {u.demo ? 'Demo identity' : u.accountId || 'Unverified'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  if (page === 'automation')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">numa / Automation</p>
            <h1>Know what is running.</h1>
            <p>Persisted jobs survive restarts and use a stable financial identity.</p>
          </div>
          <Button variant="secondary" onClick={() => void ctx.refresh()}>
            <RefreshCw size={16} />
            Refresh status
          </Button>
        </div>
        <div className="metrics-strip">
          <Metric
            label="Worker"
            value={
              d.worker && Date.now() - new Date(d.worker.lastSeen).getTime() < 20000
                ? 'Running'
                : 'Not responding'
            }
            detail={d.worker ? time(d.worker.lastSeen) : 'No scan recorded'}
          />
          <Metric
            label="Queued / retry"
            value={d.jobs.filter((j: any) => ['PENDING', 'RETRY'].includes(j.status)).length}
          />
          <Metric label="Completed" value={d.jobs.filter((j: any) => j.status === 'DONE').length} />
        </div>
        {d.testnet ? (
          <Panel
            title="NEAR testnet operations"
            subtitle="Finalized chain reads and restricted execution. Refresh to see the latest worker observation."
          >
            <dl className="details">
              <div>
                <dt>Contract</dt>
                <dd>
                  {d.testnet.contractId ? (
                    <a
                      href={'https://testnet.nearblocks.io/address/' + d.testnet.contractId}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {d.testnet.contractId}
                    </a>
                  ) : (
                    'Not configured'
                  )}
                </dd>
              </div>
              <div>
                <dt>RPC</dt>
                <dd>{d.testnet.rpcHost}</dd>
              </div>
              <div>
                <dt>Testnet worker</dt>
                <dd>
                  {d.testnet.worker?.state || 'No observation'}
                  {d.testnet.worker?.lastSeen ? ' / ' + time(d.testnet.worker.lastSeen) : ''}
                </dd>
              </div>
              <div>
                <dt>Reconciliation</dt>
                <dd>
                  {d.testnet.reconciliation?.state || 'Not checked'} / Accounting:{' '}
                  {d.testnet.reconciliation?.accounting?.state || 'Not checked'}
                </dd>
              </div>
              <div>
                <dt>Unknown wallet results</dt>
                <dd>{d.testnet.unresolved} awaiting receipt verification</dd>
              </div>
              <div>
                <dt>Executor</dt>
                <dd>
                  {d.testnet.worker?.key?.limited
                    ? 'Restricted to execute_due on this contract'
                    : 'Not verified in current observation'}
                </dd>
              </div>
              <div>
                <dt>Gas allowance</dt>
                <dd>
                  {d.testnet.worker?.key?.allowance
                    ? '~' +
                      Number(BigInt(d.testnet.worker.key.allowance) / 1000000000000000000n) /
                        1000000 +
                      ' testNEAR'
                    : 'Not observed'}
                </dd>
              </div>
              <div>
                <dt>Daily backup</dt>
                <dd>
                  {d.testnet.backup?.lastSuccessAt
                    ? time(d.testnet.backup.lastSuccessAt)
                    : 'No successful snapshot recorded'}
                </dd>
              </div>
            </dl>
            {d.testnet.reconciliation?.accounting?.summary ? (
              <Notice>
                Contract capacity: {d.testnet.reconciliation.accounting.summary.companyCount}/
                {d.testnet.reconciliation.accounting.summary.maxCompanies} companies ·{' '}
                {d.testnet.reconciliation.accounting.summary.obligationCount}/
                {d.testnet.reconciliation.accounting.summary.maxObligations} obligations ·{' '}
                {d.testnet.reconciliation.accounting.summary.eventCount}/
                {d.testnet.reconciliation.accounting.summary.maxEvents} events. This bounded testnet
                contract requires a reviewed storage migration before reaching these limits.
              </Notice>
            ) : null}
            {d.testnet.worker?.error ? <Notice>{d.testnet.worker.error}</Notice> : null}
            {d.testnet.jobs.length ? (
              <Table headers={['Payroll reference', 'Status', 'Receipt']}>
                {d.testnet.jobs.map((j: any) => (
                  <tr key={j.id}>
                    <td className="address-cell">{j.obligationId}</td>
                    <td>{j.state}</td>
                    <td>
                      {j.txHash ? (
                        <a
                          href={'https://testnet.nearblocks.io/txns/' + j.txHash}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View NEAR receipt
                        </a>
                      ) : j.state === 'CONFIRMED' ? (
                        'Confirmed in contract state; transaction hash not recorded'
                      ) : (
                        'Awaiting reconciliation'
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : null}
          </Panel>
        ) : null}
        <Panel title="Job queue">
          {d.jobs.length ? (
            <Table headers={['Job', 'State', 'Attempts', 'Available', 'Last error', 'Action']}>
              {d.jobs.map((j: any) => (
                <tr key={j.id}>
                  <td>{j.kind}</td>
                  <td>
                    <Badge
                      tone={
                        j.status === 'DONE' ? 'good' : j.status === 'FAILED' ? 'bad' : 'neutral'
                      }
                    >
                      {j.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td>{j.attempts}</td>
                  <td>{time(j.available_at)}</td>
                  <td>{j.last_error || '—'}</td>
                  <td>
                    {['FAILED', 'RECONCILIATION_REQUIRED'].includes(j.status) ? (
                      <Button
                        variant="quiet"
                        onClick={() => void run('admin.reconcile', { id: j.id }).catch(() => {})}
                      >
                        Request reconciliation
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="Nothing waiting to run">
              Authorized payroll and hold maturities appear here.
            </Empty>
          )}
        </Panel>
      </>
    );
  if (page === 'integrations')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">numa / Integrations</p>
            <h1>Every connection, honestly labeled.</h1>
            <p>Infrastructure and execution status are distinct from product scenarios.</p>
          </div>
        </div>
        <Panel>
          <Table headers={['Integration', 'Purpose', 'Status']}>
            {[
              [
                'NEAR testnet RPC',
                'Read finalized accounts and contract state',
                'Available on request',
              ],
              [
                'Payroll Vault contract',
                'Native testNEAR payments and goal reserves',
                'See NEAR testnet workspace',
              ],
              [
                'NEAR wallet / NEP-413',
                'Prove ownership through a wallet signature',
                'Implemented',
              ],
              [
                'NEAR Intents',
                'Cross-chain quote, DCA and delivery workflow',
                'Simulated execution',
              ],
              [
                'Tokenized stocks and ETFs',
                'Explore investment allocations',
                'Educational simulation',
              ],
              [
                'Rhea / collateral lending',
                'Explore debt and collateral accounting',
                'Not connected; scenario model',
              ],
              [
                'Local assistant',
                'Explain balances and prepare typed proposals',
                'Deterministic engine; optional local model',
              ],
              ['Paid services', 'Hosting, email delivery, AI APIs', 'None configured'],
            ].map(([name, purpose, status]) => (
              <tr key={name}>
                <td>
                  <b>{name}</b>
                </td>
                <td>{purpose}</td>
                <td>
                  <Badge
                    tone={
                      status.toLowerCase().includes('simulat') || status.includes('Not connected')
                        ? 'copper'
                        : 'neutral'
                    }
                  >
                    {status}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  if (page === 'settings')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">numa / Platform settings</p>
            <h1>Keep the platform deliberate.</h1>
            <p>Settings stay within the bounds of this testnet build.</p>
          </div>
        </div>
        <Panel
          title="Independent automation controls"
          subtitle="Pause a local worker without changing the signed contract. Employee claims and withdrawals remain available."
        >
          <p className="panel-padding">
            Simulation worker: {d.settings.pauseDemoWorker ? 'Paused' : 'Enabled'} · NEAR testnet
            worker: {d.settings.pauseTestnetWorker ? 'Paused' : 'Enabled'}
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              form({
                title: 'Control the local workers',
                fields: [
                  {
                    id: 'pauseDemoWorker',
                    label: 'Simulation automation',
                    type: 'select',
                    value: String(!!d.settings.pauseDemoWorker),
                    options: [
                      { value: 'false', label: 'Enabled' },
                      { value: 'true', label: 'Paused' },
                    ],
                  },
                  {
                    id: 'pauseTestnetWorker',
                    label: 'NEAR testnet automation',
                    type: 'select',
                    value: String(!!d.settings.pauseTestnetWorker),
                    options: [
                      { value: 'false', label: 'Enabled' },
                      { value: 'true', label: 'Paused' },
                    ],
                  },
                ],
                submitLabel: 'Confirm worker controls',
                submit: (v) =>
                  run('admin.runtime', {
                    pauseDemoWorker: v.pauseDemoWorker === 'true',
                    pauseTestnetWorker: v.pauseTestnetWorker === 'true',
                    expectedVersion: d.settings.version,
                  }),
              })
            }
          >
            Configure automation
          </Button>
        </Panel>
        <Panel
          title="Catalog and decision controls"
          subtitle="Public metadata is read-only and free. All Intents execution stays simulated; no deposit address is requested."
        >
          <Button
            variant="secondary"
            onClick={() =>
              void sendCommand('/admin/catalog-refresh', {})
                .then(async () => {
                  await ctx.refresh();
                  ctx.result(
                    'Catalog refreshed',
                    'Official public asset metadata was imported. Prices still require freshness checks.',
                  );
                })
                .catch((e) => ctx.result('Catalog unavailable', e.message))
            }
          >
            Refresh official token metadata
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              form({
                title: 'Provider and model settings',
                description:
                  'Freshness limits apply to public prices. Fixtures have a fixed version and observation time. Quote error scenarios are intentional simulations.',
                fields: [
                  {
                    id: 'publicCatalogEnabled',
                    label: 'Free public catalog',
                    type: 'select',
                    value: String(d.settings.publicCatalogEnabled !== false),
                    options: [
                      { value: 'true', label: 'Enabled' },
                      { value: 'false', label: 'Disabled' },
                    ],
                  },
                  {
                    id: 'priceTtlSeconds',
                    label: 'Public price TTL (seconds)',
                    type: 'number',
                    min: '10',
                    step: '1',
                    value: String(d.settings.priceTtlSeconds || 30),
                  },
                  {
                    id: 'quoteTtlSeconds',
                    label: 'Quote lifetime (seconds)',
                    type: 'number',
                    min: '10',
                    step: '1',
                    value: String(d.settings.quoteTtlSeconds || 30),
                  },
                  {
                    id: 'quoteScenario',
                    label: 'Quote scenario',
                    type: 'select',
                    value: d.settings.quoteScenario || 'NORMAL',
                    options: ['NORMAL', 'NO_ROUTE', 'STALE', 'EXPIRED', 'SLIPPAGE'].map(
                      (value) => ({ value, label: value }),
                    ),
                  },
                  {
                    id: 'modelEnabled',
                    label: 'Optional local language model',
                    type: 'select',
                    value: String(d.settings.modelEnabled !== false),
                    options: [
                      { value: 'true', label: 'Enabled' },
                      { value: 'false', label: 'Disabled' },
                    ],
                  },
                  {
                    id: 'disabledAssets',
                    label: 'Disabled assets',
                    type: 'multiselect',
                    required: false,
                    value: (d.settings.disabledAssets || []).join(','),
                    options: d.assets.map((a: any) => ({
                      value: a.assetId,
                      label: a.symbol + ' · ' + a.network + ' · ' + a.provider,
                    })),
                  },
                ],
                submitLabel: 'Save provider controls',
                submit: (v) =>
                  run('admin.providers', {
                    publicCatalogEnabled: v.publicCatalogEnabled === 'true',
                    priceTtlSeconds: Number(v.priceTtlSeconds),
                    quoteTtlSeconds: Number(v.quoteTtlSeconds),
                    quoteScenario: v.quoteScenario,
                    modelEnabled: v.modelEnabled === 'true',
                    disabledAssets: v.disabledAssets.split(',').filter(Boolean),
                    expectedVersion: d.settings.version,
                  }),
              })
            }
          >
            Configure providers
          </Button>
          <p className="panel-padding">
            Catalog: {d.catalogStatus?.count || 0} public assets · Last refresh:{' '}
            {d.catalogStatus?.lastSuccessAt ? time(d.catalogStatus.lastSuccessAt) : 'Not fetched'} ·
            Quote scenario: {d.settings.quoteScenario || 'NORMAL'} · Mainnet: disabled
          </p>
        </Panel>
        <Panel
          title="Platform limits"
          action={
            <Button
              variant="secondary"
              onClick={() =>
                form({
                  title: 'Platform settings',
                  fields: [
                    {
                      id: 'maxEmployees',
                      label: 'Maximum employees per company (1–50)',
                      type: 'number',
                      min: '1',
                      step: '1',
                      value: String(d.settings.maxEmployees),
                    },
                    {
                      id: 'maintenance',
                      label: 'Maintenance mode',
                      type: 'select',
                      value: String(d.settings.maintenance),
                      options: [
                        { value: 'false', label: 'Normal operation' },
                        { value: 'true', label: 'Pause new changes' },
                      ],
                    },
                  ],
                  submitLabel: 'Save settings',
                  submit: (v) =>
                    run('admin.settings', {
                      maxEmployees: Number(v.maxEmployees),
                      maintenance: v.maintenance === 'true',
                      expectedVersion: d.settings.version,
                    }),
                })
              }
            >
              Edit settings
            </Button>
          }
        >
          <dl className="details">
            <div>
              <dt>Network</dt>
              <dd>NEAR testnet</dd>
            </div>
            <div>
              <dt>Mainnet</dt>
              <dd>Disabled in this build</dd>
            </div>
            <div>
              <dt>Employee limit</dt>
              <dd>{d.settings.maxEmployees}</dd>
            </div>
            <div>
              <dt>Maintenance</dt>
              <dd>{d.settings.maintenance ? 'Enabled' : 'Off'}</dd>
            </div>
          </dl>
        </Panel>
      </>
    );
  if (page === 'audit')
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="context-line">numa / Audit trail</p>
            <h1>Changes leave a trace.</h1>
            <p>Actor, tenant, action and timestamp, without wallet secrets.</p>
          </div>
        </div>
        <Panel>
          <Table headers={['Time', 'Actor', 'Company', 'Action', 'Reference']}>
            {d.audit.map((e: any) => (
              <tr key={e.id}>
                <td>{time(e.createdAt)}</td>
                <td>{d.users.find((u: any) => u.id === e.owner)?.name || e.owner}</td>
                <td>{e.tenant || 'Platform'}</td>
                <td>{e.action}</td>
                <td className="address-cell">{e.ref}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  return null;
}
