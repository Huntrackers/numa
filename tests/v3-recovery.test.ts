import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../packages/db/src/index.js';
import { DomainError } from '../packages/domain/src/index.js';
import { LiveService } from '../apps/api/src/live.js';
import { seed } from '../apps/api/src/seed.js';
import { reconcileSubmitted } from '../packages/near-adapter/src/reconcile.js';
import { confirmOperation } from '../packages/near-adapter/src/rpc.js';

vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  assertTestnet: vi.fn(async () => {}),
  operationAnchor: vi.fn(async () => ({ minimumBlockHeight: 100, preparedBlockHash: 'anchor' })),
  view: vi.fn(),
  confirmOperation: vi.fn(),
}));
const actor = { id: 'recovery-user', mode: 'TESTNET' as const };
const firstHash = 'A'.repeat(44),
  correctedHash = 'B'.repeat(44);
let s: Store, live: LiveService, plan: any, operation: any;
const verified = (txHash: string) => ({ state: 'CONFIRMED', txHash, blockHash: 'final', logs: [] });
beforeEach(async () => {
  vi.stubEnv('NEAR_CONTRACT_ID', 'vault.testnet');
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-v3-recovery-')), 'db.sqlite'));
  seed(s);
  s.save({ id: actor.id, type: 'user', accountId: 'person.testnet', demo: false, role: 'user' });
  live = new LiveService(s, async () => ({ cash: '100', policy: { goals: [], version: 0 } }));
  plan = (await live.command(actor, 'employee.withdraw', { amount: '10' }, undefined, randomUUID()))
    .plan;
  operation = await live.prepare(actor, plan.id, 0);
  live.dispatch(actor, operation.id);
  vi.mocked(confirmOperation).mockReset();
});
afterEach(() => {
  s.close();
  vi.unstubAllEnvs();
});

it('lets a corrected matching hash resolve a previously mismatched candidate', async () => {
  vi.mocked(confirmOperation)
    .mockRejectedValueOnce(new DomainError('TRANSACTION_MISMATCH', 'Wrong transaction.'))
    .mockResolvedValueOnce(verified(correctedHash));
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toMatchObject({
    code: 'TRANSACTION_MISMATCH',
  });
  await expect(live.confirm(actor, operation.id, correctedHash)).resolves.toMatchObject({
    state: 'CONFIRMED',
    txHash: correctedHash,
  });
  expect(s.get(plan.id)?.state).toBe('COMPLETED');
});

it('keeps an unknown result locked while allowing a correct verification candidate', async () => {
  vi.mocked(confirmOperation)
    .mockRejectedValueOnce(new DomainError('RPC_UNAVAILABLE', 'Timed out.', 503))
    .mockResolvedValueOnce(verified(correctedHash));
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toThrow('Timed out');
  await expect(live.prepare(actor, plan.id, 0)).rejects.toMatchObject({
    code: 'RECONCILIATION_REQUIRED',
  });
  await expect(
    live.command(actor, 'plan.cancel', { id: plan.id }, undefined, randomUUID()),
  ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
  await expect(live.confirm(actor, operation.id, correctedHash)).resolves.toMatchObject({
    state: 'CONFIRMED',
  });
});

it('allows a fresh operation only after a proven failure of the initial contract call', async () => {
  vi.mocked(confirmOperation).mockRejectedValueOnce(
    new DomainError('CHAIN_CALL_FAILED', 'Contract call rolled back.', 409),
  );
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toMatchObject({
    code: 'CHAIN_CALL_FAILED',
  });
  expect(s.get(operation.id)?.state).toBe('FAILED');
  const retry: any = await live.prepare(actor, plan.id, 0);
  expect(retry.id).not.toBe(operation.id);
  expect(retry.state).toBe('PREPARED');
  expect(s.get(operation.id)?.state).toBe('FAILED');
});

it('never unlocks a transfer when a later receipt or callback failed', async () => {
  vi.mocked(confirmOperation).mockRejectedValueOnce(
    new DomainError('CHAIN_FAILURE', 'A transaction receipt failed.', 409),
  );
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toMatchObject({
    code: 'CHAIN_FAILURE',
  });
  expect(s.get(operation.id)?.state).toBe('SUBMITTED');
  await expect(live.prepare(actor, plan.id, 0)).rejects.toMatchObject({
    code: 'RECONCILIATION_REQUIRED',
  });
});

it('allows a refunded withdrawal to be discarded but never reuses its consumed operation ID', async () => {
  vi.mocked(confirmOperation).mockRejectedValueOnce(
    new DomainError('CHAIN_TRANSFER_REFUNDED', 'Withdrawal restored.', 409),
  );
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toMatchObject({
    code: 'CHAIN_TRANSFER_REFUNDED',
  });
  expect(s.get(operation.id)).toMatchObject({
    state: 'FAILED',
    failureKind: 'TRANSFER_REFUNDED',
    refundedTxHashes: [firstHash],
  });
  await expect(live.prepare(actor, plan.id, 0)).rejects.toMatchObject({
    code: 'NEW_WITHDRAWAL_REQUIRED',
  });
  const cancelled = await live.command(
    actor,
    'plan.cancel',
    { id: plan.id },
    undefined,
    randomUUID(),
  );
  expect(cancelled.state).toBe('CANCELLED');
  const fresh = (
    await live.command(actor, 'employee.withdraw', { amount: '10' }, undefined, randomUUID())
  ).plan;
  const retry: any = await live.prepare(actor, fresh.id, 0);
  expect(retry.args.operation_id).not.toBe(operation.args.operation_id);
  expect(s.get(operation.id)?.refundedTxHashes).toEqual([firstHash]);
});

it('reconciles persisted candidates after restart without rebroadcasting', async () => {
  vi.mocked(confirmOperation).mockRejectedValue(
    new DomainError('RPC_UNAVAILABLE', 'Offline.', 503),
  );
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toThrow('Offline');
  await expect(live.confirm(actor, operation.id, correctedHash)).rejects.toThrow('Offline');
  const confirm = vi.fn(async (tx: string) => {
    if (tx === firstHash) throw new DomainError('TRANSACTION_MISMATCH', 'Wrong transaction.');
    return verified(tx);
  });
  await reconcileSubmitted(s, confirm);
  live.recoverProjections();
  expect(s.get(operation.id)).toMatchObject({ state: 'CONFIRMED', txHash: correctedHash });
  expect(s.get(plan.id)?.state).toBe('COMPLETED');
});

it('does not let a slow invalid candidate overwrite a concurrently confirmed result', async () => {
  let rejectFirst!: (e: Error) => void;
  vi.mocked(confirmOperation)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValueOnce(verified(correctedHash));
  const slow = live.confirm(actor, operation.id, firstHash);
  const slowAssertion = expect(slow).rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
  await live.confirm(actor, operation.id, correctedHash);
  rejectFirst(new DomainError('TRANSACTION_MISMATCH', 'Wrong transaction.'));
  await slowAssertion;
  expect(s.get(operation.id)).toMatchObject({ state: 'CONFIRMED', txHash: correctedHash });
});

it('keeps the hash immutable after successful final verification', async () => {
  vi.mocked(confirmOperation).mockResolvedValue(verified(firstHash));
  await live.confirm(actor, operation.id, firstHash);
  await expect(live.confirm(actor, operation.id, correctedHash)).rejects.toMatchObject({
    code: 'TRANSACTION_MISMATCH',
  });
  expect(s.get(operation.id)?.txHash).toBe(firstHash);
});

it('does not accept the previous failed receipt as proof for a fresh wallet attempt', async () => {
  vi.mocked(confirmOperation).mockRejectedValueOnce(
    new DomainError('CHAIN_CALL_FAILED', 'Rolled back.', 409),
  );
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toThrow('Rolled back');
  const retry: any = await live.prepare(actor, plan.id, 0);
  live.dispatch(actor, retry.id);
  await expect(live.confirm(actor, retry.id, firstHash)).rejects.toMatchObject({
    code: 'TRANSACTION_MISMATCH',
  });
  expect(s.get(retry.id)?.state).toBe('SUBMITTED');
  expect(confirmOperation).toHaveBeenCalledTimes(1);
  await expect(live.prepare(actor, plan.id, 0)).rejects.toMatchObject({
    code: 'RECONCILIATION_REQUIRED',
  });
});

it('never assigns one successful receipt to two concurrent operations', async () => {
  const fresh = (
    await live.command(actor, 'employee.withdraw', { amount: '10' }, undefined, randomUUID())
  ).plan;
  const other: any = await live.prepare(actor, fresh.id, 0);
  live.dispatch(actor, other.id);
  let resolveFirst!: (value: any) => void;
  vi.mocked(confirmOperation)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(verified(firstHash));
  const slow = live.confirm(actor, operation.id, firstHash);
  const assertion = expect(slow).rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
  await live.confirm(actor, other.id, firstHash);
  resolveFirst(verified(firstHash));
  await assertion;
  expect(s.get(other.id)?.state).toBe('CONFIRMED');
  expect(s.get(operation.id)?.state).toBe('SUBMITTED');
});

it('allows discarding a fully rolled-back decision and preserves the failed receipt evidence', async () => {
  vi.mocked(confirmOperation).mockRejectedValueOnce(
    new DomainError('CHAIN_CALL_FAILED', 'Rolled back.', 409),
  );
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toThrow('Rolled back');
  const cancelled = await live.command(
    actor,
    'plan.cancel',
    { id: plan.id },
    undefined,
    randomUUID(),
  );
  expect(cancelled.state).toBe('CANCELLED');
  expect(s.get(operation.id)?.txHash).toBe(firstHash);
  expect(s.get(operation.id)?.failedTxHashes).toContain(firstHash);
});

it('does not retry a failed candidate while another outcome is unknown', async () => {
  vi.mocked(confirmOperation)
    .mockRejectedValueOnce(new DomainError('RPC_UNAVAILABLE', 'Offline.', 503))
    .mockRejectedValueOnce(new DomainError('CHAIN_CALL_FAILED', 'Rolled back.', 409));
  await expect(live.confirm(actor, operation.id, firstHash)).rejects.toThrow('Offline');
  await expect(live.confirm(actor, operation.id, correctedHash)).rejects.toThrow('Rolled back');
  expect(s.get(operation.id)?.state).toBe('SUBMITTED');
  await expect(live.prepare(actor, plan.id, 0)).rejects.toMatchObject({
    code: 'RECONCILIATION_REQUIRED',
  });
  await reconcileSubmitted(s, async () => {
    throw new DomainError('TRANSACTION_MISMATCH', 'Unrelated hash.');
  });
  expect(s.get(operation.id)?.state).toBe('FAILED');
  expect(s.get(operation.id)?.txHash).toBe(correctedHash);
});
