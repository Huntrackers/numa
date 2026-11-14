let csrf = '';
export type ApprovalChallenge = {
  id: string;
  nonce: string;
  message: string;
  recipient: string;
  expiresAt: string;
  network: 'testnet';
  accountId: string;
  commandHash: string;
  action?: string;
  companyId?: string;
};
type ApprovalHandler = (challenge: ApprovalChallenge, body?: string) => Promise<string>;
let approvalHandler: ApprovalHandler | undefined;
export function setApprovalHandler(handler?: ApprovalHandler) {
  approvalHandler = handler;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
    public fieldErrors: { path: (string | number)[]; message: string }[] = [],
  ) {
    super(message);
  }
}
export async function api(path: string, options: RequestInit = {}, approved = false): Promise<any> {
  const r = await fetch('/api/v1' + path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
  });
  const data = await r.json();
  if (r.status === 428 && data.code === 'APPROVAL_REQUIRED' && data.approval && !approved) {
    if (!approvalHandler)
      throw new ApiError(
        'APPROVAL_UNAVAILABLE',
        'Wallet approval is not ready. Please retry.',
        428,
      );
    const proof = await approvalHandler(
      data.approval,
      typeof options.body === 'string' ? options.body : undefined,
    );
    return api(
      path,
      {
        ...options,
        headers: { ...options.headers, 'X-Numa-Approval': proof },
      },
      true,
    );
  }
  if (!r.ok)
    throw new ApiError(data.code, data.message, r.status, data.requestId, data.fieldErrors);
  if (data.csrf) csrf = data.csrf;
  return data;
}
const inFlight = new Map<string, Promise<any>>();
export function resetIdentityRequests() {
  inFlight.clear();
  window.dispatchEvent(new Event('numa:identity-changed'));
}
export function sendCommand(endpoint: string, bodyValue: any) {
  const body = JSON.stringify(bodyValue),
    scope = endpoint + ':' + body;
  if (inFlight.has(scope)) return inFlight.get(scope)!;
  const saved = sessionStorage.getItem('numa-request:' + scope);
  const key = saved || crypto.randomUUID();
  sessionStorage.setItem('numa-request:' + scope, key);
  const promise = api(endpoint, { method: 'POST', headers: { 'Idempotency-Key': key }, body })
    .then((result) => {
      sessionStorage.removeItem('numa-request:' + scope);
      return result;
    })
    .catch((e) => {
      if (e instanceof ApiError && e.status < 500)
        sessionStorage.removeItem('numa-request:' + scope);
      throw e;
    })
    .finally(() => {
      if (inFlight.get(scope) === promise) inFlight.delete(scope);
    });
  inFlight.set(scope, promise);
  return promise;
}
export function cmd(action: string, payload: any = {}, companyId?: string) {
  return sendCommand('/commands', { action, payload, ...(companyId ? { companyId } : {}) });
}
export const demoLogin = (userId: string) =>
  api('/auth/demo', { method: 'POST', body: JSON.stringify({ userId }) });
export function atomic(value: string) {
  if (!/^\d+(\.\d{0,2})?$/.test(value))
    throw new Error('Use a positive amount with up to two decimals.');
  const [whole, dec = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(dec.padEnd(2, '0'))).toString();
}
export function decimal(value: string) {
  const n = BigInt(value || '0');
  return (n / 100n).toString() + '.' + (n % 100n).toString().padStart(2, '0');
}
export function money(v: string | number | undefined, unit = true) {
  const n = BigInt(typeof v === 'number' ? Math.trunc(v) : v || '0');
  const value = n < 0n ? -n : n;
  return (
    (n < 0n ? '-' : '') +
    new Intl.NumberFormat('en-US').format(value / 100n) +
    '.' +
    (value % 100n).toString().padStart(2, '0') +
    (unit ? ' demoUSD' : '')
  );
}
export function date(v: string, short = false) {
  return new Date(v).toLocaleDateString(
    'en-GB',
    short
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}
export function time(v: string) {
  return new Date(v).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function localInput(value: string | number = Date.now()) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function units(value: string, decimals = 8) {
  const n = BigInt(value || '0'),
    scale = 10n ** BigInt(decimals),
    abs = n < 0n ? -n : n;
  return (
    (n < 0n ? '-' : '') +
    new Intl.NumberFormat('en-US').format(abs / scale) +
    (decimals ? '.' + (abs % scale).toString().padStart(decimals, '0') : '')
  );
}
export function referencePrice(asset: any) {
  return asset.priceNanoUsd ? units(asset.priceNanoUsd, 8) + ' USD reference' : money(asset.price);
}
