import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/db/src/index.js';
import { waitForSalarySettlement } from '../scripts/smoke-settlement.js';
let s: Store;
beforeEach(() => {
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-smoke-wait-')), 'db.sqlite'));
});
afterEach(() => s.close());
const obligation = {
  id: 'one-existing-obligation',
  credited: false,
  paused: false,
  cancelled: false,
  execution_not_after: '999999999999999999999',
};
function clock() {
  let current = 1000;
  return {
    now: () => current,
    sleep: vi.fn(async (ms: number) => {
      current += ms;
    }),
  };
}
it('observes a transient worker read timeout through its persisted backoff and settles the same mandate', async () => {
  const time = clock();
  let attempts = 0;
  const scan = vi.fn(async () => {
    attempts++;
    if (attempts === 1)
      s.save({
        id: 'testnet-worker-heartbeat',
        type: 'system',
        state: 'BLOCKED',
        retryable: true,
        retryAt: new Date(time.now() + 10000).toISOString(),
        phase: 'EXECUTOR_ACCESS_KEY_READ',
        error: 'timed out',
      });
    else {
      s.save({ id: 'testnet-worker-heartbeat', type: 'system', state: 'RUNNING', retryAt: null });
      s.save({ id: 'testnet-execute:' + obligation.id, type: 'chain-job', state: 'CONFIRMED' });
    }
  });
  const read = vi.fn(async () => ({ ...obligation, credited: attempts > 1 }));
  const result = await waitForSalarySettlement(s, 'vault.testnet', obligation.id, {
    ...time,
    scan,
    read,
    timeoutMs: 30000,
  });
  expect(result.obligation.credited).toBe(true);
  expect(scan).toHaveBeenCalledTimes(2);
  expect(result.elapsedMs).toBe(10000);
  expect(result.observations[0].phase).toBe('EXECUTOR_ACCESS_KEY_READ');
  expect(read.mock.calls.every((call: any[]) => call[2].obligation_id === obligation.id)).toBe(
    true,
  );
});
it('stops on a definitive execution-policy block without another send attempt', async () => {
  const scan = vi.fn(async () => {
    s.save({
      id: 'testnet-worker-heartbeat',
      type: 'system',
      state: 'BLOCKED',
      retryable: false,
      errorCode: 'EXECUTION_POLICY_BLOCKED',
      phase: 'EXECUTION_POLICY',
    });
  });
  await expect(
    waitForSalarySettlement(s, 'vault.testnet', obligation.id, { ...clock(), scan, read: vi.fn() }),
  ).rejects.toThrow('definitive policy');
  expect(scan).toHaveBeenCalledTimes(1);
});
it('stops on an unknown transaction outcome and never blindly repeats execution', async () => {
  const scan = vi.fn(async () => {
    s.save({
      id: 'testnet-execute:' + obligation.id,
      type: 'chain-job',
      state: 'RECONCILIATION_REQUIRED',
    });
  });
  await expect(
    waitForSalarySettlement(s, 'vault.testnet', obligation.id, { ...clock(), scan, read: vi.fn() }),
  ).rejects.toThrow('no automatic second send');
  expect(scan).toHaveBeenCalledTimes(1);
});
it('fails with observations when the bounded deadline is exhausted', async () => {
  const time = clock();
  const scan = vi.fn(async () => {
    s.save({
      id: 'testnet-worker-heartbeat',
      type: 'system',
      state: 'BLOCKED',
      retryable: true,
      retryAt: new Date(time.now() + 100000).toISOString(),
      error: 'read unavailable',
    });
  });
  await expect(
    waitForSalarySettlement(s, 'vault.testnet', obligation.id, {
      ...time,
      scan,
      read: vi.fn(async () => obligation),
      timeoutMs: 5000,
    }),
  ).rejects.toThrow('deadline expired');
  expect(scan).toHaveBeenCalledTimes(1);
  expect(time.now()).toBe(6000);
});
it('retries only the read after a confirmed job and a temporary observation timeout', async () => {
  const scan = vi.fn(async () => {
    s.save({ id: 'testnet-execute:' + obligation.id, type: 'chain-job', state: 'CONFIRMED' });
  });
  const read = vi
    .fn()
    .mockRejectedValueOnce(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    )
    .mockResolvedValue({ ...obligation, credited: true });
  const result = await waitForSalarySettlement(s, 'vault.testnet', obligation.id, {
    ...clock(),
    scan,
    read,
  });
  expect(result.obligation.credited).toBe(true);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(2);
});
it('does not authorize another mandate for a paused or cancelled obligation', async () => {
  const scan = vi.fn(async () => {});
  await expect(
    waitForSalarySettlement(s, 'vault.testnet', obligation.id, {
      ...clock(),
      scan,
      read: vi.fn(async () => ({ ...obligation, cancelled: true })),
    }),
  ).rejects.toThrow('paused, cancelled or expired');
  expect(scan).toHaveBeenCalledTimes(1);
});
