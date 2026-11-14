import { units, referencePrice } from './api';
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  Children,
  isValidElement,
  type ReactNode,
} from 'react';
import { X, ArrowUpRight, Check, Info, ArrowRight, AlertCircle, LoaderCircle } from 'lucide-react';
import Forecast from './Forecast';
import { money, date, ApiError } from './api';
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button className={'btn ' + variant + ' ' + className} {...props}>
      {children}
    </button>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>;
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'panel ' + className}>
      {title ? (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: string }) {
  return (
    <div className={'notice ' + tone}>
      <Info size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <ArrowUpRight size={27} />
      </div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}
export function Progress({
  value,
  color = 'var(--harbor)',
  label,
}: {
  value: number;
  color?: string;
  label: string;
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, value)}
    >
      <i style={{ width: Math.max(0, Math.min(100, value)) + '%', background: color }} />
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Escape must use the current close guard, including while a financial decision is pending.
  const requestClose = useEffectEvent(onClose);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      requestClose();
    };
    d.addEventListener('cancel', cancel);
    return () => {
      d.removeEventListener('cancel', cancel);
      d.close();
    };
  }, []);
  return (
    <dialog className={'dialog ' + (wide ? 'wide' : '')} ref={ref} aria-labelledby={titleId}>
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="notice error">
      <AlertCircle size={18} />
      <div>
        {error instanceof Error ? error.message : String(error)}
        {error instanceof ApiError && error.requestId ? (
          <small style={{ display: 'block' }}>Request: {error.requestId}</small>
        ) : null}
      </div>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      <span>Opening your workspace…</span>
    </div>
  );
}
function rowText(node: ReactNode): string {
  return Children.toArray(node)
    .map((n) =>
      typeof n === 'string' || typeof n === 'number'
        ? String(n)
        : isValidElement(n)
          ? rowText((n.props as any).children) + ' ' + String((n.props as any).name || '')
          : '',
    )
    .join(' ');
}
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0);
  const all = Children.toArray(children),
    rows = all.filter((r) => !query || rowText(r).toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(rows.length / 15)),
    current = Math.min(page, pages - 1);
  return (
    <>
      <div className="table-controls">
        {all.length > 15 ? (
          <>
            <label>
              Search rows{' '}
              <input
                aria-label={'Search ' + headers[0] + ' table'}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <small>{rows.length} records</small>
          </>
        ) : null}
      </div>
      <div className="table-wrap" role="region" aria-label={headers[0] + ' table'} tabIndex={0}>
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.slice(current * 15, current * 15 + 15)}</tbody>
        </table>
        {!rows.length ? <p className="panel-padding muted">No matching records.</p> : null}
      </div>
      {pages > 1 ? (
        <div className="table-controls">
          <Button variant="quiet" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous page
          </Button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <Button
            variant="quiet"
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Next page
          </Button>
        </div>
      ) : null}
    </>
  );
}
export function Person({ name, detail }: { name: string; detail?: string }) {
  return (
    <div className="person">
      <span className="avatar">
        {name
          .split(' ')
          .map((s) => s[0])
          .slice(0, 2)
          .join('')}
      </span>
      <div>
        <strong>{name}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}
export function Preview({
  preview,
  busy,
  error,
  onApply,
  onClose,
}: {
  preview: any;
  busy: boolean;
  error: unknown;
  onApply: () => void;
  onClose: () => void;
}) {
  const e = preview.effects;
  return (
    <Dialog title="Decision preview" onClose={onClose} wide>
      <div className="dialog-body">
        <div className="spread">
          <Badge tone="copper">Simulation</Badge>
          <span className="muted">
            Expires{' '}
            {new Date(preview.expiresAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <h3 className="preview-heading">
          {{
            'salary-change': 'A new salary rhythm',
            payroll: 'Fund the next payroll',
            allocation: 'Give every payday a plan',
            trade: 'Review this investment',
            'early-pay': 'Get earned salary earlier',
            hold: 'Let your salary wait',
            loan: 'Understand the borrowing cost',
          }[preview.kind as string] || 'Review this change'}
        </h3>
        {e.rows ? (
          <Table
            headers={
              preview.kind === 'salary-change'
                ? ['Employee', 'Current / period', 'Proposed / period', 'Period']
                : ['Employee', 'Due date', 'Amount']
            }
          >
            {e.rows.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                </td>
                {preview.kind === 'salary-change' ? (
                  <>
                    <td>{money(r.before)}</td>
                    <td className="emphasis">{money(r.after)}</td>
                    <td>{r.cadence}</td>
                  </>
                ) : (
                  <>
                    <td>{date(r.dueAt)}</td>
                    <td>{money(r.amount)}</td>
                  </>
                )}
              </tr>
            ))}
          </Table>
        ) : null}
        {e.shares ? (
          <div className="preview-allocations">
            {e.shares.map((l: any) => (
              <div key={l.id}>
                <span>
                  {l.type === 'goals'
                    ? 'Savings goals'
                    : l.type === 'dca'
                      ? 'DCA budget'
                      : l.type === 'invest'
                        ? 'Immediate buy: ' + (l.asset || 'NEAR') + ' (' + l.bps / 100 + '%)'
                        : l.type}
                </span>
                <b>{money(l.amount)}</b>
              </div>
            ))}
          </div>
        ) : null}
        <div className="preview-values">
          {Object.entries(e)
            .filter(
              ([k, v]) =>
                [
                  'total',
                  'freeAfter',
                  'principal',
                  'bonus',
                  'gross',
                  'fee',
                  'net',
                  'remainingSalary',
                  'collateral',
                  'interest30',
                  'amount',
                ].includes(k) && typeof v === 'string',
            )
            .map(([k, v]) => (
              <Metric
                key={k}
                label={
                  {
                    freeAfter: 'Free treasury after reservation',
                    remainingSalary: 'Final salary remaining',
                    interest30: 'Interest over 30 days',
                    net: 'Net amount',
                    gross: 'Nominal advance',
                  }[k] || k.charAt(0).toUpperCase() + k.slice(1)
                }
                value={money(v as string)}
              />
            ))}
        </div>
        {e.asset ? (
          <p>
            <b>
              {e.side === 'buy' ? 'Buy' : 'Sell'} {e.asset}
            </b>{' '}
            at {referencePrice(e)} per unit. Quantity: {units(e.quantity, 8)}.
          </p>
        ) : null}
        {e.assetId ? (
          <Notice>
            Asset ID: {e.assetId}
            <br />
            Reference: {e.priceSource} · {e.priceAsOf}
            <br />
            Network: {e.network} · Destination: {e.destinationId || 'Internal simulated portfolio'}
            <br />
            Minimum output:{' '}
            {units(e.minimumOutput, e.outputDecimals ?? 8) + ' ' + (e.outputAsset || '')} · Fee cap
            enforced before execution
          </Notice>
        ) : null}
        {e.maturity ? (
          <p>
            Matures on <b>{date(e.maturity)}</b>.
          </p>
        ) : null}
        {e.healthFactor ? (
          <p>
            Initial scenario health factor: <b>{e.healthFactor}</b>. This uses numa’s educational
            model.
          </p>
        ) : null}
        {e.revisedObligations ? (
          <p>
            {e.revisedObligations} future obligations will be revised. Reservation change:{' '}
            <b>{money(e.reservationDelta)}</b>.
          </p>
        ) : null}
        {e.forecast ? <Forecast value={e.forecast} /> : null}
        {e.scheduleLabel ? <Badge>{e.scheduleLabel}</Badge> : null}
        <Notice>{e.note}</Notice>
        <ErrorNotice error={error} />
        <p className="fineprint">
          This preview does not move money. Applying rechecks the saved balances and versions.
        </p>
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep editing
        </Button>
        <Button onClick={onApply} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Apply decision
        </Button>
      </div>
    </Dialog>
  );
}
export function ArrowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  );
}
