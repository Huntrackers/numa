import { guardExecution } from '../../../packages/near-adapter/src/safety.js';
import { randomUUID } from 'node:crypto';
import { acquireLease, releaseLease } from '../../../packages/db/src/lease.js';
import { readFileSync } from 'node:fs';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { assertTestnet, view, rpc } from '../../../packages/near-adapter/src/rpc.js';
import {
  reconcileChain,
  reconcileSubmitted,
} from '../../../packages/near-adapter/src/reconcile.js';
import { LiveService } from '../../api/src/live.js';
import { Store } from '../../../packages/db/src/index.js';
export async function selectDue(
  s: Store,
  contract: string,
  query: (c: string, m: string, a: any) => Promise<any> = view,
) {
  const suspended = new Set(
    s
      .list('company')
      .filter((c) => c.chainId && c.status !== 'ACTIVE')
      .map((c) => c.chainId),
  );
  const selected: any[] = [];
  for (let from = 0; from < 2000 && selected.length < 5; from += 50) {
    const page = await query(contract, 'list_due', { from_index: from, limit: 50 });
    selected.push(
      ...page.filter((o: any) => !suspended.has(o.company_id)).slice(0, 5 - selected.length),
    );
    if (page.length < 50) break;
  }
  return selected;
}
const instanceId = randomUUID();
let active = false;
let failures = 0;
let nextScanAt = 0;
let checkedExecutorUntil = 0;
const lastReconciliation = new WeakMap<Store, number>();
export function retryableWorkerError(error: any) {
  return (
    [
      'RPC_UNAVAILABLE',
      'TimeoutError',
      'AbortError',
      'ETIMEDOUT',
      'ECONNRESET',
      'EAI_AGAIN',
    ].includes(String(error?.code || error?.name)) ||
    ['TimeoutError', 'AbortError'].includes(error?.name) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(error?.message || ''))
  );
}
export async function tickTestnet(s: Store) {
  const persistedRetry = Date.parse(s.get('testnet-worker-heartbeat')?.retryAt || '') || 0;
  if (active || Date.now() < Math.max(nextScanAt, persistedRetry)) return;
  const contract = process.env.NEAR_CONTRACT_ID,
    keyFile = process.env.NEAR_EXECUTOR_KEY_FILE,
    accountId = process.env.NEAR_EXECUTOR_ACCOUNT;
  if (!contract || !keyFile || !accountId) return;
  const leaseId = 'testnet-worker-lease:' + contract;
  if (!acquireLease(s, leaseId, instanceId)) return;
  active = true;
  const heartbeat = setInterval(() => acquireLease(s, leaseId, instanceId), 15000);
  let phase = 'NETWORK_VALIDATION';
  try {
    await assertTestnet();
    // Startup and every scan reconcile finalized state before another execution.
    phase = 'SUBMITTED_RECONCILIATION';
    await reconcileSubmitted(s);
    new LiveService(s).recoverProjections();
    if (
      !lastReconciliation.get(s) ||
      Date.now() - lastReconciliation.get(s)! > 30000 ||
      s.get('chain-sync:' + contract)?.state !== 'HEALTHY'
    ) {
      phase = 'ACCOUNTING_RECONCILIATION';
      await reconcileChain(s, contract);
      lastReconciliation.set(s, Date.now());
    }
    if (s.get('settings')?.maintenance || s.get('settings')?.pauseTestnetWorker) {
      s.atomic(() =>
        s.save({
          id: 'testnet-worker-heartbeat',
          type: 'system',
          state: 'PAUSED',
          lastSeen: new Date().toISOString(),
          contractId: contract,
          retryAt: null,
          retryable: false,
          phase: 'PAUSED_BY_CONFIGURATION',
        }),
      );
      return;
    }
    phase = 'EXECUTOR_CONFIGURATION';
    const key = JSON.parse(readFileSync(keyFile, 'utf8'));
    if (key.accountId !== accountId) throw Error('Executor identity mismatch');
    if (!key.limited)
      throw Error(
        'A dedicated restricted executor key is required. Run scripts/secure-executor.ts.',
      );
    if (Date.now() > checkedExecutorUntil) {
      phase = 'EXECUTOR_ACCESS_KEY_READ';
      const access = await rpc('query', {
        request_type: 'view_access_key',
        account_id: accountId,
        public_key: key.publicKey,
        finality: 'final',
      });
      const permission = access.permission?.FunctionCall;
      if (
        permission?.receiver_id !== contract ||
        permission.method_names?.length !== 1 ||
        permission.method_names[0] !== 'execute_due'
      )
        throw Error('Executor key must only call execute_due on the configured contract.');
      s.atomic(() =>
        s.save({
          id: 'testnet-executor',
          type: 'system',
          accountId,
          receiverId: permission.receiver_id,
          methods: permission.method_names,
          allowance: permission.allowance,
          checkedAt: new Date().toISOString(),
          limited: true,
        }),
      );
      checkedExecutorUntil = Date.now() + 60000;
    }

    const provider = new JsonRpcProvider({
      url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
    });
    const account = new Account(
      accountId,
      provider,
      new KeyPairSigner(KeyPair.fromString(key.secretKey)),
    );
    phase = 'DUE_OBSERVATION';
    const due = await selectDue(s, contract);
    s.atomic(() =>
      s.save({
        id: 'testnet-worker-heartbeat',
        type: 'system',
        state: 'RUNNING',
        lastSeen: new Date().toISOString(),
        contractId: contract,
        dueObserved: due.length,
        key: s.get('testnet-executor'),
        error: null,
        errorCode: null,
        retryAt: null,
        retryable: null,
        phase: 'RUNNING',
      }),
    );
    for (const o of due) {
      if (s.list('company').some((c) => c.chainId === o.company_id && c.status !== 'ACTIVE'))
        continue;
      const id = 'testnet-execute:' + o.id;
      const previous = s.get(id);
      if (previous?.state === 'CONFIRMED') continue;
      phase = 'EXECUTION_POLICY';
      await guardExecution(s, { method: 'execute_due', receiver: contract, agent: true });
      s.atomic(() =>
        s.save({ id, type: 'chain-job', tenant: 'testnet', obligationId: o.id, state: 'SENDING' }),
      );
      try {
        const result = await account.callFunctionRaw({
          contractId: contract,
          methodName: 'execute_due',
          args: { obligation_id: o.id },
          gas: 100_000_000_000_000n,
          waitUntil: 'FINAL',
        });
        const final = await view(contract, 'get_obligation', { obligation_id: o.id });
        if (!final?.credited) throw Error('Obligation not credited');
        s.atomic(() =>
          s.save({
            id,
            type: 'chain-job',
            tenant: 'testnet',
            obligationId: o.id,
            state: 'CONFIRMED',
            txHash: result.transaction.hash,
          }),
        );
        console.log('Testnet payroll credited', o.id, result.transaction.hash);
      } catch (e: any) {
        s.atomic(() =>
          s.save({
            id,
            type: 'chain-job',
            tenant: 'testnet',
            obligationId: o.id,
            state: 'RECONCILIATION_REQUIRED',
            error: String(e.message).slice(0, 180),
          }),
        );
        console.error('Testnet execution needs reconciliation', o.id);
      }
    }
    failures = 0;
    nextScanAt = 0;
  } catch (e: any) {
    failures = Math.min(failures + 1, 5);
    nextScanAt = Date.now() + Math.min(60_000, 5_000 * 2 ** failures);
    s.atomic(() =>
      s.save({
        id: 'testnet-worker-heartbeat',
        type: 'system',
        state: 'BLOCKED',
        lastSeen: new Date().toISOString(),
        contractId: contract,
        error: String(e.message || e.code).slice(0, 180),
        errorCode: String(e.code || e.name || 'WORKER_ERROR'),
        retryable: retryableWorkerError(e),
        retryAt: new Date(nextScanAt).toISOString(),
        failureCount: failures,
        phase,
      }),
    );
    console.error('Testnet scan unavailable:', String(e.message).slice(0, 180));
  } finally {
    clearInterval(heartbeat);
    releaseLease(s, leaseId, instanceId);
    active = false;
  }
}
