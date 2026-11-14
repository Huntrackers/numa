import { Store } from '../packages/db/src/index.js';
import { view } from '../packages/near-adapter/src/rpc.js';
import { tickTestnet, retryableWorkerError } from '../apps/worker/src/testnet.js';

type Options = {
  timeoutMs?: number;
  scan?: typeof tickTestnet;
  read?: typeof view;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  beforeScan?: () => Promise<void>;
};

/** Wait for one existing mandate. Never authorizes, funds or replaces payroll. */
export async function waitForSalarySettlement(
  s: Store,
  contract: string,
  obligationId: string,
  options: Options = {},
) {
  const now = options.now || Date.now,
    started = now();
  const deadline = started + (options.timeoutMs || 180000);
  const sleep =
    options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const scan = options.scan || tickTestnet,
    read = options.read || view;
  const observations: Record<string, unknown>[] = [];
  const fail = (reason: string): never => {
    const error = new Error(
      reason +
        ' ' +
        JSON.stringify({
          obligationId,
          observations,
          heartbeat: s.get('testnet-worker-heartbeat'),
          job: s.get('testnet-execute:' + obligationId),
        }),
    );
    throw Object.assign(error, { code: 'SMOKE_SETTLEMENT_BLOCKED', observations });
  };
  while (now() < deadline) {
    let job = s.get('testnet-execute:' + obligationId);
    if (['SENDING', 'RECONCILIATION_REQUIRED'].includes(job?.state))
      fail('An execution outcome needs reconciliation; no automatic second send is allowed.');
    let heartbeat = s.get('testnet-worker-heartbeat');
    if (
      heartbeat?.state === 'PAUSED' ||
      (heartbeat?.state === 'BLOCKED' && heartbeat.retryable === false)
    )
      fail('The worker has a definitive policy or configuration block.');
    const retryAt = Date.parse(heartbeat?.retryAt || '') || 0;
    if (job?.state !== 'CONFIRMED' && retryAt > now()) {
      await sleep(Math.min(5000, retryAt - now(), deadline - now()));
      continue;
    }
    if (job?.state !== 'CONFIRMED') {
      await options.beforeScan?.();
      await scan(s);
    }
    heartbeat = s.get('testnet-worker-heartbeat');
    job = s.get('testnet-execute:' + obligationId);
    observations.push({
      at: new Date(now()).toISOString(),
      state: heartbeat?.state,
      phase: heartbeat?.phase,
      error: heartbeat?.error,
      retryable: heartbeat?.retryable,
      retryAt: heartbeat?.retryAt,
      jobState: job?.state,
    });
    if (['SENDING', 'RECONCILIATION_REQUIRED'].includes(job?.state))
      fail('An execution outcome needs reconciliation; no automatic second send is allowed.');
    if (
      heartbeat?.state === 'PAUSED' ||
      (heartbeat?.state === 'BLOCKED' && heartbeat.retryable === false)
    )
      fail('The worker has a definitive policy or configuration block.');
    try {
      const obligation = await read(contract, 'get_obligation', { obligation_id: obligationId });
      if (obligation?.credited) return { obligation, observations, elapsedMs: now() - started };
      if (
        !obligation ||
        obligation.paused ||
        obligation.cancelled ||
        BigInt(obligation.execution_not_after) <= BigInt(now()) * 1000000n
      )
        fail('The existing obligation is missing, paused, cancelled or expired.');
    } catch (error) {
      if (!retryableWorkerError(error)) throw error;
      observations.push({
        at: new Date(now()).toISOString(),
        state: 'READ_RETRY',
        error: String((error as Error).message).slice(0, 180),
      });
    }
    if (now() < deadline) await sleep(Math.min(1000, deadline - now()));
  }
  return fail('The bounded settlement observation deadline expired.');
}
