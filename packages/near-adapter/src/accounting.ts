import { Store } from '../../db/src/index.js';
import { ensure } from '../../domain/src/index.js';
const account = (kind: string, id: string, pocket: string) =>
  'testNEAR:' + kind + ':' + id + ':' + pocket;
export const companyAccount = (id: string, pocket = 'free') => account('company', id, pocket);
export const employeeAccount = (id: string, pocket = 'cash') => account('employee', id, pocket);
export function postMovement(
  s: Store,
  contract: string,
  key: string,
  kind: string,
  from: string,
  to: string,
  value: string,
  at?: string,
) {
  if (BigInt(value) === 0n) return;
  s.post(
    'testNEAR',
    'testnet',
    'chain-ledger:' + contract + ':' + key,
    kind,
    'Finalized NEAR testnet ' + kind,
    [
      { account: from, side: 'CREDIT', amount: value },
      { account: to, side: 'DEBIT', amount: value },
    ],
    at,
  );
}
export function postEvent(s: Store, contract: string, row: any) {
  const e = row.event,
    d = row.details,
    o = d?.obligation,
    w = d?.withdrawal;
  ensure(
    d?.schemaVersion === 2,
    'EVENT_DETAILS_REQUIRED',
    'Complete event details are required for accounting.',
  );
  const key = String(e.event_sequence),
    amount = e.amount;
  const at = new Date(Number(BigInt(d.timestampNs) / 1000000n)).toISOString();
  let from = '',
    to = '';
  switch (e.event_type) {
    case 'TreasuryFunded':
      from = 'testNEAR:external:capital';
      to = companyAccount(e.reference);
      break;
    case 'MandateAuthorized':
      from = companyAccount(e.reference);
      to = companyAccount(e.reference, 'reserved');
      break;
    case 'ReserveIncreased':
      ensure(o, 'EVENT_DETAILS_REQUIRED', 'Missing obligation.');
      from = companyAccount(o.company_id);
      to = companyAccount(o.company_id, 'reserved');
      break;
    case 'ReserveReleased':
      ensure(o, 'EVENT_DETAILS_REQUIRED', 'Missing obligation.');
      from = companyAccount(o.company_id, 'reserved');
      to = companyAccount(o.company_id);
      break;
    case 'PayrollCredited':
      ensure(o, 'EVENT_DETAILS_REQUIRED', 'Missing obligation.');
      from = companyAccount(o.company_id, 'reserved');
      to = employeeAccount(e.account_id);
      break;
    case 'GoalFunded':
      from = employeeAccount(e.account_id);
      to = employeeAccount(e.account_id, 'goal:' + e.reference);
      break;
    case 'GoalReleased':
      from = employeeAccount(e.account_id, 'goal:' + e.reference);
      to = employeeAccount(e.account_id);
      break;
    case 'WithdrawalRequested':
      ensure(w, 'EVENT_DETAILS_REQUIRED', 'Missing withdrawal.');
      from = w.company_id ? companyAccount(w.company_id) : employeeAccount(e.account_id);
      to = 'testNEAR:pending:' + e.reference;
      break;
    case 'WithdrawalResolved':
      ensure(
        w && ['SUCCEEDED', 'FAILED'].includes(w.state),
        'EVENT_DETAILS_REQUIRED',
        'Missing withdrawal result.',
      );
      from = 'testNEAR:pending:' + e.reference;
      to =
        w.state === 'SUCCEEDED'
          ? 'testNEAR:external:withdrawn'
          : w.company_id
            ? companyAccount(w.company_id)
            : employeeAccount(e.account_id);
      break;
    default:
      return;
  }
  postMovement(s, contract, key, e.event_type, from, to, amount, at);
}
export function validateSummary(summary: any) {
  ensure(
    summary?.version === 2,
    'ACCOUNTING_UNAVAILABLE',
    'The contract financial summary is unavailable.',
  );
  ensure(
    summary.liabilityValid && BigInt(summary.totalLiability) === BigInt(summary.computedLiability),
    'LIABILITY_MISMATCH',
    'Contract liabilities do not match company and employee balances.',
  );
  ensure(
    summary.backingValid && BigInt(summary.accountBalance) >= BigInt(summary.backingRequired),
    'BACKING_MISMATCH',
    'The contract balance does not cover liabilities and storage reserve.',
  );
  ensure(
    summary.reservations.every((r: any) => r.valid && BigInt(r.reserved) === BigInt(r.expected)),
    'RESERVE_MISMATCH',
    'Reserved treasury differs from unsettled salary obligations.',
  );
}
export function accountLedger(s: Store, prefix: string) {
  return s
    .ledger('testnet')
    .filter((e) => e.book === 'testNEAR' && e.lines.some((l: any) => l.account.startsWith(prefix)));
}
