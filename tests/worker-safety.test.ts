import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KeyPair } from '@near-js/crypto';
import { Store } from '../packages/db/src/index.js';
import { rpc } from '../packages/near-adapter/src/rpc.js';
const state = vi.hoisted(() => ({
  code: 'reviewed',
  send: vi.fn(async () => ({ transaction: { hash: 'test-receipt' } })),
}));
vi.mock('@near-js/accounts', () => ({
  Account: class {
    callFunctionRaw = state.send;
  },
}));
vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  assertTestnet: vi.fn(async () => {}),
  view: vi.fn(async (_c, m) =>
    m === 'list_due' ? [{ id: 'due', company_id: 'company' }] : { credited: true },
  ),
  rpc: vi.fn(async (_m, a) =>
    a.request_type === 'view_access_key'
      ? {
          permission: {
            FunctionCall: {
              receiver_id: 'vault.testnet',
              method_names: ['execute_due'],
              allowance: '100',
            },
          },
        }
      : { code_hash: state.code, block_hash: 'final', block_height: 1 },
  ),
}));
vi.mock('../packages/near-adapter/src/reconcile.js', () => ({
  reconcileSubmitted: vi.fn(async () => {}),
  reconcileChain: vi.fn(async (s) =>
    s.save({ id: 'chain-sync:vault.testnet', type: 'system', state: 'HEALTHY' }),
  ),
}));
let s: Store;
beforeEach(() => {
  vi.resetModules();
  state.code = 'reviewed';
  state.send.mockClear();
  const dir = mkdtempSync(join(tmpdir(), 'numa-worker-policy-'));
  s = new Store(join(dir, 'db.sqlite'));
  const key = KeyPair.fromRandom('ed25519');
  const keyFile = join(dir, 'ephemeral-test-key.json');
  writeFileSync(
    keyFile,
    JSON.stringify({
      accountId: 'executor.testnet',
      publicKey: key.getPublicKey().toString(),
      secretKey: key.toString(),
      limited: true,
    }),
  );
  vi.stubEnv('NEAR_NETWORK', 'testnet');
  vi.stubEnv('NEAR_CONTRACT_ID', 'vault.testnet');
  vi.stubEnv('NEAR_EXPECTED_CODE_HASH', 'reviewed');
  vi.stubEnv('NEAR_EXECUTOR_ACCOUNT', 'executor.testnet');
  vi.stubEnv('NEAR_EXECUTOR_KEY_FILE', keyFile);
});
afterEach(() => {
  s.close();
  vi.unstubAllEnvs();
});
it('stops an automatic payday before broadcast when finalized contract code changes', async () => {
  state.code = 'drift';
  const { tickTestnet } = await import('../apps/worker/src/testnet.js');
  await tickTestnet(s);
  expect(state.send).not.toHaveBeenCalled();
  expect(s.get('testnet-worker-heartbeat')?.state).toBe('BLOCKED');
  expect(s.list('safety-check')[0].reasons).toContain('CONTRACT_CODE_CHANGED');
  expect(s.list('chain-job')).toHaveLength(0);
});
it('executes a bounded payday through the shared guard and records confirmation', async () => {
  const { tickTestnet } = await import('../apps/worker/src/testnet.js');
  await tickTestnet(s);
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({
      contractId: 'vault.testnet',
      methodName: 'execute_due',
      args: { obligation_id: 'due' },
    }),
  );
  expect(s.list('safety-check')[0]).toMatchObject({ agent: true, decision: 'ALLOW' });
  expect(s.get('testnet-execute:due')?.state).toBe('CONFIRMED');
  await tickTestnet(s);
  expect(state.send).toHaveBeenCalledTimes(1);
});
it('persists an executor-read timeout phase and honors its backoff before another attempt', async () => {
  vi.mocked(rpc).mockClear();
  vi.mocked(rpc).mockRejectedValueOnce(
    new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
  );
  const { tickTestnet } = await import('../apps/worker/src/testnet.js');
  await tickTestnet(s);
  const heartbeat = s.get('testnet-worker-heartbeat')!;
  expect(heartbeat).toMatchObject({
    state: 'BLOCKED',
    retryable: true,
    phase: 'EXECUTOR_ACCESS_KEY_READ',
    errorCode: '23',
  });
  expect(heartbeat.error).toContain('timeout');
  expect(Date.parse(heartbeat.retryAt)).toBeGreaterThan(Date.now());
  expect(s.list('chain-job')).toHaveLength(0);
  expect(state.send).not.toHaveBeenCalled();
  await tickTestnet(s);
  expect(vi.mocked(rpc)).toHaveBeenCalledTimes(1);
});
