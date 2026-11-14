import { it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/db/src/index.js';
import {
  evaluateExecution,
  guardExecution,
  policyDrills,
  type SafetyInput,
} from '../packages/near-adapter/src/safety.js';
const base = (): SafetyInput => ({
  network: 'testnet',
  receiver: 'vault.testnet',
  expectedReceiver: 'vault.testnet',
  method: 'execute_due',
  deposit: '0',
  agent: true,
  limitedKey: true,
  keyMethods: ['execute_due'],
  expectedCodeHash: 'reviewed',
  observedCodeHash: 'reviewed',
  observedAt: new Date().toISOString(),
  reconciliation: 'HEALTHY',
  paused: false,
});
afterEach(() => vi.unstubAllEnvs());
it('permits a bounded automatic payday', () =>
  expect(evaluateExecution(base()).decision).toBe('ALLOW'));
it.each([
  { network: 'mainnet' },
  { receiver: 'attacker.testnet' },
  { method: 'request_withdrawal' },
  { deposit: '1' },
  { limitedKey: false },
  { keyMethods: ['execute_due', 'claim_due'] },
  { expectedCodeHash: undefined },
  { observedCodeHash: 'drift' },
  { observedAt: 'invalid' },
  { observedAt: new Date(Date.now() - 30000).toISOString() },
  { observedAt: new Date(Date.now() + 60000).toISOString() },
  { reconciliation: 'UNKNOWN' },
  { reconciliation: 'BLOCKED' },
  { paused: true },
])('blocks unsafe dispatch: %j', (patch) =>
  expect(evaluateExecution({ ...base(), ...patch }).decision).toBe('BLOCK'),
);
it('allows independent employee exits during an operator pause or accounting issue', () => {
  for (const method of ['claim_due', 'release_goal', 'request_withdrawal'])
    expect(
      evaluateExecution({
        ...base(),
        agent: false,
        method,
        paused: true,
        reconciliation: 'BLOCKED',
      }).decision,
    ).toBe('ALLOW');
});
it('does not let employee exits bypass changed contract code', () =>
  expect(
    evaluateExecution({
      ...base(),
      agent: false,
      method: 'request_withdrawal',
      observedCodeHash: 'drift',
    }).decision,
  ).toBe('BLOCK'));
it('warns a human about a missing pin and never grants an agent the same exception', () => {
  expect(evaluateExecution({ ...base(), agent: false, expectedCodeHash: undefined })).toMatchObject(
    { decision: 'WARN', humanSignatureRequired: true },
  );
  expect(evaluateExecution({ ...base(), expectedCodeHash: undefined }).decision).toBe('BLOCK');
});
it('requires zero deposit except for human treasury funding', () => {
  expect(
    evaluateExecution({ ...base(), agent: false, method: 'fund_treasury', deposit: '10' }).decision,
  ).toBe('ALLOW');
  expect(
    evaluateExecution({ ...base(), agent: false, method: 'claim_due', deposit: '10' }).decision,
  ).toBe('BLOCK');
});
it('records a blocked guard without storing transaction args or keys', async () => {
  vi.stubEnv('NEAR_CONTRACT_ID', 'vault.testnet');
  vi.stubEnv('NEAR_EXPECTED_CODE_HASH', 'reviewed');
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-policy-')), 'db.sqlite'));
  try {
    const query = vi.fn(async () => ({
      code_hash: 'changed',
      block_hash: 'block',
      block_height: 1,
    }));
    await expect(
      guardExecution(s, { method: 'claim_due', owner: 'person' }, query),
    ).rejects.toMatchObject({ code: 'EXECUTION_POLICY_BLOCKED' });
    const entry = s.list('safety-check')[0];
    expect(entry).toMatchObject({ owner: 'person', decision: 'BLOCK', codeHash: 'changed' });
    expect(entry.args).toBeUndefined();
    expect(entry.secretKey).toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      'query',
      expect.objectContaining({ request_type: 'view_account', finality: 'final' }),
    );
  } finally {
    s.close();
  }
});
it('provides one allowed and eight blocked reproducible, unsigned drills', () => {
  const cases = policyDrills();
  expect(cases.filter((c) => c.decision === 'ALLOW')).toHaveLength(1);
  expect(cases.filter((c) => c.decision === 'BLOCK')).toHaveLength(8);
  expect(cases.every((c) => c.signed === false)).toBe(true);
});
