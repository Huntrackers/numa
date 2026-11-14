import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ShieldCheck, RefreshCw, Globe2 } from 'lucide-react';
import { api, units } from '../api';
import { Badge, Button, ErrorNotice, Field, Notice, Panel } from '../components';
import './trust.css';
import { release } from '../../../../packages/domain/src/release';
type Token = { assetId: string; symbol: string; blockchain: string; decimals: number };
type Quote = {
  origin: Token;
  destination: Token;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  expiresAt: string;
  requestedAt: string;
  timeEstimate: number | null;
  slippageBps: number;
  signatureVerified: boolean;
  providerAppFees: { recipient: string; fee: number }[];
  feeNote: string;
  quoteDigest: string;
};
const label = (t: Token) =>
  t.symbol + ' / ' + t.blockchain + ' / ' + t.assetId.replace('nep141:', '').slice(0, 22);
const stamp = (s?: string) => (s ? new Date(s).toLocaleString('en-GB') : 'Not observed');
export default function Trust() {
  const loc = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view') || 'evidence';
  const view = ['evidence', 'intents', 'policy', 'guide'].includes(requestedView)
    ? requestedView
    : 'evidence';
  const setView = (next: string) => {
    const query = new URLSearchParams(searchParams);
    query.set('view', next);
    setSearchParams(query, { state: loc.state });
  };
  const [evidence, setEvidence] = useState<any>(),
    [cases, setCases] = useState<any[]>([]),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const returnTo =
    typeof loc.state?.returnTo === 'string' &&
    new RegExp('^/(company|employee|admin)/').test(loc.state.returnTo)
      ? loc.state.returnTo
      : '/login';
  async function refresh(signal?: AbortSignal) {
    setBusy(true);
    setError(undefined);
    try {
      const [e, p] = await Promise.all([
        api('/review/evidence', { signal }),
        api('/review/policy-lab', { signal }),
      ]);
      setEvidence(e);
      setCases(p.cases);
    } catch (e) {
      if (!signal?.aborted) setError(e);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const c = new AbortController();
    void refresh(c.signal);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, []);
  const recent = !!evidence && !error && now - Date.parse(evidence.observedAt) < 120000;
  const contractGood = recent && evidence?.contract?.codeMatches;
  return (
    <div className="trust-page">
      <a href="#trust-content" className="skip-link">
        Skip to content
      </a>
      <header className="trust-top">
        <Link to={returnTo}>
          <ArrowLeft size={16} />
          Workspace access
        </Link>
        <Link className="trust-brand" to="/login">
          numa<span>Built on NEAR</span>
        </Link>
        <Badge tone="copper">Version {release.label} / testnet</Badge>
      </header>
      <main id="trust-content">
        <div className="trust-intro">
          <div>
            <h1>
              Follow the money.
              <br />
              Inspect the boundaries.
            </h1>
            <p>
              Payroll belongs to the people who earn it. See what runs on NEAR, what is simulated,
              and what an automated executor is allowed to do.
            </p>
          </div>
          <div className="trust-seal">
            <ShieldCheck size={38} />
            <b>Evidence before execution</b>
            <span>A public view. No private payroll data.</span>
          </div>
        </div>
        <nav className="trust-tabs" aria-label="Review sections">
          {[
            ['evidence', 'Execution evidence'],
            ['intents', 'Live route preview'],
            ['policy', 'Execution policy lab'],
            ['guide', 'Try numa'],
          ].map(([id, title]) => (
            <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>
              {title}
            </button>
          ))}
        </nav>
        {view === 'intents' ? (
          <RoutePreview />
        ) : view === 'policy' ? (
          <>
            <div className="page-heading">
              <div>
                <h2>One policy, two execution paths.</h2>
                <p>
                  The API and scheduled worker call the same execution guard before dispatch. These
                  synthetic scenarios use its actual evaluator.
                </p>
              </div>
              <Badge>Deterministic drill</Badge>
            </div>
            <Notice>
              No attack is sent to a network. These checks are a reproducible policy exercise, not
              an independent security audit.
            </Notice>
            <div className="policy-list">
              {cases.map((c) => (
                <article key={c.id}>
                  <div>
                    <h3>{c.title}</h3>
                    <p>
                      {c.reasons.length
                        ? c.reasons.join(', ')
                        : 'Exact receiver, reviewed code, healthy accounting and a restricted execute_due key.'}
                    </p>
                  </div>
                  <Badge tone={c.decision === 'BLOCK' ? 'bad' : 'good'}>{c.decision}</Badge>
                </article>
              ))}
            </div>
            <p>
              Contract permissions remain authoritative. The code pin is checked off chain before
              dispatch; it cannot eliminate upgrade timing risk. Employee claims and withdrawals
              remain available during an automation pause when the contract permits them.
            </p>
            <ErrorNotice error={error} />
          </>
        ) : view === 'guide' ? (
          <ReviewGuide />
        ) : (
          <>
            <div className="spread trust-observed">
              <span role="status" aria-live="polite">
                {busy && !evidence
                  ? 'Loading finalized evidence…'
                  : 'Observed ' + stamp(evidence?.observedAt)}
                {!recent && evidence ? ' / observation is stale' : ''}
              </span>
              <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={15} />
                {busy ? 'Checking evidence…' : 'Refresh evidence'}
              </Button>
            </div>
            <ErrorNotice error={error} />
            <div className="trust-execution">
              <section className="trust-rail" aria-label="Salary execution path">
                {[
                  ['Company authorizes', 'A human reserves a bounded payroll mandate.'],
                  [
                    'Executor checks',
                    'Only execute_due, zero attached deposit, reviewed vault code.',
                  ],
                  ['NEAR settles', 'The contract checks timing and prevents duplicate payment.'],
                  [
                    'Employee chooses',
                    'Salary and savings are recorded atomically. Withdraw with your wallet.',
                  ],
                ].map(([h, p], i) => (
                  <div key={h}>
                    <span>{i + 1}</span>
                    <div>
                      <h3>{h}</h3>
                      <p>{p}</p>
                    </div>
                  </div>
                ))}
              </section>
              <Panel
                title="Current network observation"
                subtitle="Finalized RPC plus local worker and accounting telemetry."
              >
                <dl className="trust-facts">
                  <div>
                    <dt>Vault code</dt>
                    <dd>
                      <Badge tone={contractGood ? 'good' : 'copper'}>
                        {busy && !evidence
                          ? 'Checking…'
                          : contractGood
                            ? 'Matches reviewed deployment'
                            : 'Not verified'}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>Executor</dt>
                    <dd>
                      {recent && evidence?.worker?.fresh
                        ? evidence.worker.state
                        : 'Not observed / stale'}
                    </dd>
                  </div>
                  <div>
                    <dt>Accounting</dt>
                    <dd>
                      {recent && evidence?.accounting?.fresh
                        ? evidence.accounting.state
                        : 'Not observed / stale'}
                    </dd>
                  </div>
                  <div>
                    <dt>Contract</dt>
                    <dd>
                      {evidence?.contract?.contractId ? (
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={
                            'https://testnet.nearblocks.io/address/' + evidence.contract.contractId
                          }
                        >
                          {evidence.contract.contractId}
                          <ArrowUpRight size={12} />
                        </a>
                      ) : busy && !evidence ? (
                        'Checking…'
                      ) : (
                        'Not configured'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Code hash</dt>
                    <dd>{evidence?.contract?.observedCodeHash || 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Finalized block</dt>
                    <dd>{evidence?.contract?.blockHeight || 'Unavailable'}</dd>
                  </div>
                </dl>
              </Panel>
            </div>
            <div className="trust-boundaries">
              {evidence?.capabilities.map((c: any) => (
                <div key={c.feature}>
                  <Badge tone={c.mode === 'SIMULATION' ? 'copper' : 'neutral'}>
                    {c.mode.replaceAll('_', ' ')}
                  </Badge>
                  <h3>{c.feature}</h3>
                  <p>{c.description}</p>
                </div>
              ))}
            </div>
            <Panel
              title="Inspect the recorded receipts"
              subtitle="Historical testnet smoke evidence. Open the explorer to confirm each transaction independently."
            >
              <div className="trust-receipts">
                {evidence?.proofs.map((p: any) => (
                  <a key={p.hash} href={p.url} target="_blank" rel="noreferrer">
                    <span>
                      <b>{p.label}</b>
                      <small>{p.hash}</small>
                    </span>
                    <ArrowUpRight size={17} />
                  </a>
                ))}
              </div>
            </Panel>
            <Notice>
              The scheduled executor pays testnet gas for payday calls. Employee wallet actions need
              their own gas. Native testNEAR is used for settlement; real stablecoins, investing,
              lending and guaranteed returns are not offered.
            </Notice>
          </>
        )}
      </main>
      <footer className="trust-footer">
        <span>numa {release.label} · A better rhythm for money.</span>
        <a href="https://nearhackathon.com/" target="_blank" rel="noreferrer">
          Built for NEAR HACKATHON
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
export function RoutePreview({ purpose = 'salary conversion' }: { purpose?: string } = {}) {
  const [tokens, setTokens] = useState<Token[]>([]),
    [catalogError, setCatalogError] = useState<unknown>(),
    [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState(''),
    [destination, setDestination] = useState(''),
    [amount, setAmount] = useState('100'),
    [slippage, setSlippage] = useState('100'),
    [recipient, setRecipient] = useState(''),
    [refund, setRefund] = useState('');
  const [quote, setQuote] = useState<Quote>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const sequence = useRef(0),
    active = useRef<AbortController | null>(null);
  async function catalog(signal?: AbortSignal) {
    setLoading(true);
    setCatalogError(undefined);
    try {
      const r = await api('/intents/tokens', { signal });
      setTokens(r.tokens);
      setOrigin(
        r.tokens.find((t: Token) => t.blockchain === 'base' && t.symbol === 'USDC')?.assetId ||
          r.tokens[0]?.assetId ||
          '',
      );
      setDestination(
        r.tokens.find((t: Token) => t.blockchain === 'near' && t.symbol === 'USDC')?.assetId ||
          r.tokens[1]?.assetId ||
          '',
      );
    } catch (e) {
      if (!signal?.aborted) setCatalogError(e);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const c = new AbortController();
    void catalog(c.signal);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      c.abort();
      active.current?.abort();
      sequence.current++;
      clearInterval(t);
    };
  }, []);
  function invalidate() {
    sequence.current++;
    active.current?.abort();
    setQuote(undefined);
    setError(undefined);
    setBusy(false);
  }
  const source = tokens.find((t) => t.assetId === origin),
    target = tokens.find((t) => t.assetId === destination);
  const expired = !!quote && now >= Date.parse(quote.expiresAt);
  function sample() {
    invalidate();
    const sampleFor = (chain?: string) =>
      ['base', 'eth', 'arb'].includes(chain || '')
        ? '0x2527D02599Ba641c19FEa793cD0F167589a0f10D'
        : chain === 'near'
          ? 'wrap.near'
          : '';
    setRefund(sampleFor(source?.blockchain));
    setRecipient(sampleFor(target?.blockchain));
  }
  async function preview() {
    const id = ++sequence.current;
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setQuote(undefined);
    setError(undefined);
    try {
      const q = await api('/intents/preview', {
        method: 'POST',
        signal: c.signal,
        body: JSON.stringify({
          originAsset: origin,
          destinationAsset: destination,
          amount,
          slippageBps: Number(slippage),
          recipient,
          refundTo: refund,
        }),
      });
      if (id === sequence.current) {
        setQuote(q);
        setNow(Date.now());
      }
    } catch (e) {
      if (id === sequence.current && !c.signal.aborted) setError(e);
    } finally {
      if (id === sequence.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Preview {purpose}.</h2>
          <p>
            Explore live routes from the NEAR Intents / 1Click catalog. Each accepted preview has a
            verified provider signature.
          </p>
        </div>
        <Badge>Live read-only</Badge>
      </div>
      <Notice>
        These are mainnet market quotes with dry mode forced on. No wallet connection, deposit
        address, signature request or transfer is created. This preview is separate from testnet
        salary and simulated DCA.
      </Notice>
      <div className="route-workbench">
        <Panel
          title="Build a route"
          subtitle="Use mainnet-format destination and refund addresses. Address format does not prove ownership."
        >
          <form
            className="route-form"
            onSubmit={(e) => {
              e.preventDefault();
              void preview();
            }}
          >
            <ErrorNotice error={catalogError} />
            {catalogError ? (
              <Button type="button" variant="secondary" onClick={() => void catalog()}>
                Retry token catalog
              </Button>
            ) : null}
            <Field label="From token">
              <select
                required
                value={origin}
                disabled={loading}
                onChange={(e) => {
                  invalidate();
                  setOrigin(e.target.value);
                  setRefund('');
                }}
              >
                {tokens.map((t) => (
                  <option key={t.assetId} value={t.assetId}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To token">
              <select
                required
                value={destination}
                disabled={loading}
                onChange={(e) => {
                  invalidate();
                  setDestination(e.target.value);
                  setRecipient('');
                }}
              >
                {tokens.map((t) => (
                  <option key={t.assetId} value={t.assetId}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="route-fields">
              <Field label="Amount">
                <input
                  required
                  inputMode="decimal"
                  pattern="(0|[1-9][0-9]{0,5})([.][0-9]{1,30})?"
                  value={amount}
                  onChange={(e) => {
                    invalidate();
                    setAmount(e.target.value);
                  }}
                />
              </Field>
              <Field label="Slippage limit">
                <select
                  value={slippage}
                  onChange={(e) => {
                    invalidate();
                    setSlippage(e.target.value);
                  }}
                >
                  <option value="50">0.5%</option>
                  <option value="100">1%</option>
                  <option value="200">2%</option>
                  <option value="300">3%</option>
                </select>
              </Field>
            </div>
            <Field
              label="Recipient address"
              hint={target ? 'Destination chain: ' + target.blockchain : undefined}
            >
              <input
                required
                value={recipient}
                maxLength={128}
                autoComplete="off"
                onChange={(e) => {
                  invalidate();
                  setRecipient(e.target.value.trim());
                }}
              />
            </Field>
            <Field
              label="Refund address"
              hint={source ? 'Origin chain: ' + source.blockchain : undefined}
            >
              <input
                required
                value={refund}
                maxLength={128}
                autoComplete="off"
                onChange={(e) => {
                  invalidate();
                  setRefund(e.target.value.trim());
                }}
              />
            </Field>
            <Button
              type="button"
              variant="quiet"
              disabled={loading || !source || !target}
              onClick={sample}
            >
              Use documented sample addresses
            </Button>
            <small>
              Samples are public examples for a query, not your accounts. For other networks, enter
              an address with the correct format.
            </small>
            <ErrorNotice error={error} />
            <Button
              type="submit"
              disabled={
                busy ||
                loading ||
                !origin ||
                !destination ||
                origin === destination ||
                !recipient ||
                !refund
              }
            >
              {busy ? 'Verifying provider quote…' : 'Get signed route preview'}
            </Button>
          </form>
        </Panel>
        <section
          className={'route-result ' + (expired ? 'quote-expired' : '')}
          aria-live="polite"
          aria-label="Route preview result"
        >
          {quote ? (
            <>
              <Badge tone={expired ? 'copper' : 'good'}>
                {expired ? 'Preview expired' : 'Provider signature verified'}
              </Badge>
              <h3>
                {units(quote.amountIn, quote.origin.decimals)} {quote.origin.symbol}
                <span>on {quote.origin.blockchain}</span>
              </h3>
              <div className="route-bridge">
                <Globe2 size={23} />
                <span>NEAR Intents / 1Click</span>
              </div>
              <h3>
                {units(quote.amountOut, quote.destination.decimals)} {quote.destination.symbol}
                <span>on {quote.destination.blockchain}</span>
              </h3>
              <dl className="trust-facts">
                <div>
                  <dt>Minimum output</dt>
                  <dd>
                    {units(quote.minAmountOut, quote.destination.decimals)}{' '}
                    {quote.destination.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Slippage cap</dt>
                  <dd>{quote.slippageBps / 100}%</dd>
                </div>
                <div>
                  <dt>Provider estimate</dt>
                  <dd>
                    {quote.timeEstimate === null ? 'Not provided' : quote.timeEstimate + ' seconds'}
                  </dd>
                </div>
                <div>
                  <dt>Preview validity</dt>
                  <dd>
                    {expired
                      ? 'Expired. Request a fresh preview.'
                      : Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000)) +
                        ' seconds remaining'}
                  </dd>
                </div>
                <div>
                  <dt>Provider app fees</dt>
                  <dd>
                    {quote.providerAppFees.length
                      ? quote.providerAppFees.map((f, i) => (
                          <span key={i}>
                            {f.fee} bps ({f.fee / 100}%)
                            <br />
                            <small>Recipient: {f.recipient}</small>
                          </span>
                        ))
                      : 'None returned'}
                  </dd>
                </div>
              </dl>
              <p>
                {quote.feeNote} Provider app fees are supplied by 1Click, not added by numa. Quoted
                output can include other route costs.
              </p>
              <details>
                <summary>Provider signature</summary>
                <code>{quote.quoteDigest}</code>
                <p>Verified by the official SDK before this preview was accepted.</p>
              </details>
              <strong className="route-no-funds">Read-only preview. Funds moved: 0.</strong>
            </>
          ) : (
            <>
              <Globe2 size={42} />
              <h3>A route you can inspect.</h3>
              <p>
                Choose two tokens and request a quote. See the minimum output, provider fees and
                expiry before any future integration could execute it.
              </p>
              <span>No transfer controls exist in this preview.</span>
            </>
          )}
        </section>
      </div>
    </>
  );
}
function ReviewGuide() {
  return (
    <div className="review-guide">
      <h2>Walk through a payday.</h2>
      <p>
        Use two verified Meteor testnet accounts for an actual company-to-employee journey. For a
        fast introduction, start the isolated fixture workspace with <code>npm run judge</code>.
      </p>
      <ol>
        <li>
          <h3>Set a company rhythm</h3>
          <p>
            Create a company and job role. Add an employee, select daily, weekly or monthly pay and
            inspect the next occurrences. The employee accepts with the invited testnet identity.
          </p>
        </li>
        <li>
          <h3>Authorize a bounded payday</h3>
          <p>
            Fund the testnet treasury, review the reservation and approve a mandate with an end
            date. The restricted worker can execute only eligible obligations.
          </p>
        </li>
        <li>
          <h3>Give salary a purpose</h3>
          <p>
            As the employee, set a savings goal and allocation. After payday, inspect cash, savings
            and the public receipt. Claim or withdraw with your own wallet.
          </p>
        </li>
        <li>
          <h3>Inspect what can go wrong</h3>
          <p>
            Open the execution policy lab. Compare allowed execution with code drift, injected
            recipients and an unbounded agent key. Then try a signed, read-only cross-chain route.
          </p>
        </li>
        <li>
          <h3>Explore the personal plan</h3>
          <p>
            Switch to the clearly labelled demoUSD book for DCA, investments, borrowing and flexible
            payday scenarios. Simulated balances never become testNEAR.
          </p>
        </li>
      </ol>
      <Notice>
        The fixture workspace uses a separate temporary database and has no scheduled testnet
        signer. Automated testnet payroll needs a locally configured restricted executor. The setup,
        checks and contract limits are documented in the repository README.
      </Notice>
      <p>
        Source code, repeatable checks and recorded testnet receipts are available in the project
        handoff. Public repository, video and submission links must be supplied by the project
        owner.
      </p>
      <a
        className="btn secondary"
        href="/api/v1/review/claims"
        download="numa-verification-map.json"
      >
        Download verification map
        <ArrowUpRight size={15} aria-hidden="true" />
      </a>
    </div>
  );
}
