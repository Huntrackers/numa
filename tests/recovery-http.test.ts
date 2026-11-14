import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/db/src/index.js';
import { DomainError } from '../packages/domain/src/index.js';
import { buildApp } from '../apps/api/src/server.js';
import { createSession } from '../apps/api/src/auth.js';
import { confirmOperation } from '../packages/near-adapter/src/rpc.js';

vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  rpc: vi.fn(),
  assertTestnet: vi.fn(),
  view: vi.fn(),
  accountBalance: vi.fn(),
  confirmOperation: vi.fn(),
  operationAnchor: vi.fn(),
}));
let s: Store, app: Awaited<ReturnType<typeof buildApp>>, headers: Record<string, string>;
const firstHash = 'C'.repeat(44),
  correctHash = 'D'.repeat(44);
beforeEach(async () => {
  vi.stubEnv('DEMO_ENABLED', 'false');
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.stubEnv('NEAR_NETWORK', 'testnet');
  vi.mocked(confirmOperation).mockReset();
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-recovery-http-')), 'db.sqlite'));
  app = await buildApp(s);
  s.save({ id: 'person', type: 'user', accountId: 'person.testnet', demo: false, role: 'user' });
  s.save({
    id: 'operation',
    type: 'chain-operation',
    owner: 'person',
    tenant: 'testnet',
    accountId: 'person.testnet',
    contractId: 'vault.testnet',
    state: 'DISPATCHED',
    method: 'request_withdrawal',
    args: { operation_id: 'withdraw-1', amount: '10' },
    deposit: '0',
  });
  const session = createSession(s, 'person', 'TESTNET');
  headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
  };
});
afterEach(async () => {
  await app.close();
  s.close();
  vi.unstubAllEnvs();
});
const submit = (txHash: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers,
    payload: { operationId: 'operation', txHash },
  });

it('the legacy HTTP endpoint accepts a corrected candidate and protects its canonical receipt', async () => {
  vi.mocked(confirmOperation)
    .mockRejectedValueOnce(new DomainError('TRANSACTION_MISMATCH', 'Unrelated transaction.', 409))
    .mockResolvedValueOnce({
      state: 'CONFIRMED',
      txHash: correctHash,
      blockHash: 'final',
      logs: [],
    });
  const invalid = await submit(firstHash);
  expect(invalid.statusCode).toBe(409);
  expect(s.get('operation')?.state).toBe('SUBMITTED');
  const corrected = await submit(correctHash);
  expect(corrected.statusCode).toBe(200);
  expect(corrected.json()).toMatchObject({ state: 'CONFIRMED', txHash: correctHash });
  const overwritten = await submit(firstHash);
  expect(overwritten.statusCode).toBe(409);
  expect(s.get('operation')?.txHash).toBe(correctHash);
  expect(confirmOperation).toHaveBeenCalledTimes(2);
});

it('the owned recovery endpoint never reveals another user operation', async () => {
  const own = await app.inject({ url: '/api/v1/operations/operation', headers });
  expect(own.statusCode).toBe(200);
  s.save({ ...s.get('operation')!, owner: 'someone-else' });
  const other = await app.inject({ url: '/api/v1/operations/operation', headers });
  expect(other.statusCode).toBe(404);
  const mutation = await submit(correctHash);
  expect(mutation.statusCode).toBe(404);
  expect(confirmOperation).not.toHaveBeenCalled();
});
