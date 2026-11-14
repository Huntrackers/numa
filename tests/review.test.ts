import { release } from '../packages/domain/src/release.js';
import { DomainError } from '../packages/domain/src/index.js';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/db/src/index.js';
import { buildApp } from '../apps/api/src/server.js';
import { createSession } from '../apps/api/src/auth.js';
import { rpc } from '../packages/near-adapter/src/rpc.js';
import { ReadOnlyIntents } from '../apps/api/src/intents.js';
vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  rpc: vi.fn(async () => ({ code_hash: 'reviewed', block_hash: 'final-block', block_height: 123 })),
  assertTestnet: vi.fn(async () => {}),
  operationAnchor: vi.fn(async () => ({ minimumBlockHeight: 100, preparedBlockHash: 'anchor' })),
  view: vi.fn(async () => []),
  confirmOperation: vi.fn(),
  accountBalance: vi.fn(),
}));
let s: Store, app: Awaited<ReturnType<typeof buildApp>>, headers: any;
beforeEach(async () => {
  vi.stubEnv('DEMO_ENABLED', 'false');
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.stubEnv('NEAR_CONTRACT_ID', 'vault.testnet');
  vi.stubEnv('NEAR_EXPECTED_CODE_HASH', 'reviewed');
  vi.stubEnv('NEAR_NETWORK', 'testnet');
  vi.mocked(rpc).mockResolvedValue({
    code_hash: 'reviewed',
    block_hash: 'final-block',
    block_height: 123,
  });
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-review-api-')), 'db.sqlite'));
  app = await buildApp(s);
  s.save({
    id: 'person',
    type: 'user',
    name: 'Private Employee',
    accountId: 'person.testnet',
    demo: false,
  });
  s.save({
    type: 'company',
    name: 'Private HR company',
    secretKey: 'do-not-disclose',
    payroll: 'private-salary',
  });
  const q = createSession(s, 'person', 'TESTNET');
  headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + q.token,
    'x-csrf-token': q.csrf,
  };
});
afterEach(async () => {
  await app.close();
  s.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('exposes public deployment evidence without payroll, identities, sessions or keys', async () => {
  const r = await app.inject({ url: '/api/v1/review/evidence' });
  expect(r.statusCode).toBe(200);
  const e = r.json();
  expect(e).toMatchObject({
    version: release.version,
    contract: { codeMatches: true, blockHeight: 123 },
    worker: { state: 'NOT_OBSERVED' },
    accounting: { state: 'NOT_OBSERVED' },
  });
  for (const privateValue of [
    'Private Employee',
    'Private HR company',
    'do-not-disclose',
    'private-salary',
    headers.cookie,
  ])
    expect(r.body).not.toContain(privateValue);
  expect(e.limits.independentAudit).toBe(false);
});
it('does not present an RPC failure as verified deployment evidence', async () => {
  vi.mocked(rpc).mockRejectedValueOnce(Error('RPC down'));
  const r = (await app.inject({ url: '/api/v1/review/evidence' })).json();
  expect(r.contract).toMatchObject({ status: 'UNAVAILABLE', codeMatches: false });
});
it('downloads an unscored public claim inventory without private tenant or session data', async () => {
  const result = await app.inject({ url: '/api/v1/review/claims' });
  expect(result.statusCode).toBe(200);
  expect(result.headers['content-disposition']).toContain('attachment');
  expect(result.json()).toMatchObject({
    score: null,
    officialScoringWeights: null,
    classification: 'CLAIMS_TO_VERIFY',
  });
  expect(result.json().claims.length).toBeGreaterThan(10);
  for (const value of [
    'Private Employee',
    'Private HR company',
    'private-salary',
    'do-not-disclose',
    headers.cookie,
  ])
    expect(result.body).not.toContain(value);
});
it('serves public policy drills with no signing or funds', async () => {
  const r = (await app.inject({ url: '/api/v1/review/policy-lab' })).json();
  expect(r).toMatchObject({ mode: 'DETERMINISTIC_POLICY_DRILL', fundsMoved: false });
  expect(r.cases.filter((c: any) => c.decision === 'BLOCK')).toHaveLength(8);
});
it('allows a same-origin read-only preview without a wallet session and rejects cross-origin callers', async () => {
  const preview = vi
    .spyOn(ReadOnlyIntents.prototype, 'preview')
    .mockResolvedValue({ dry: true, fundsMoved: false } as any);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/intents/preview',
        headers: { host: 'localhost:80', origin: 'https://attacker.example' },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(preview).not.toHaveBeenCalled();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/intents/preview',
        headers: { host: 'localhost:80', origin: 'http://localhost:80' },
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(s.list('chain-operation')).toHaveLength(0);
});
it('keeps financial mutations behind session and CSRF protection', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/chain/prepare',
        headers: { host: 'localhost:80', origin: 'http://localhost:80' },
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/chain/prepare',
        headers: { ...headers, 'x-csrf-token': 'wrong' },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
});
it('blocks changed code before a raw chain operation is prepared', async () => {
  vi.mocked(rpc).mockResolvedValueOnce({
    code_hash: 'drift',
    block_hash: 'new',
    block_height: 124,
  });
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/prepare',
    headers,
    payload: { method: 'claim_due', args: { obligation_id: 'due-1' }, deposit: '0' },
  });
  expect(r.statusCode).toBe(409);
  expect(r.json().code).toBe('EXECUTION_POLICY_BLOCKED');
  expect(s.list('chain-operation')).toHaveLength(0);
});
it('guards both product preparation and dispatch, while preserving owner checks', async () => {
  const made = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: { ...headers, 'idempotency-key': 'review-create-company' },
      payload: { action: 'company.create', payload: { name: 'Review company', timezone: 'UTC' } },
    })
  ).json();
  const p = await app.inject({
    method: 'POST',
    url: '/api/v1/live/prepare',
    headers,
    payload: { planId: made.plan.id, index: 0 },
  });
  expect(p.statusCode).toBe(200);
  const op = p.json();
  expect(s.list('safety-check')[0].decision).toBe('ALLOW');
  s.save({
    ...s.get('contract-observation:vault.testnet')!,
    observedAt: new Date(Date.now() - 10000).toISOString(),
  });
  vi.mocked(rpc).mockResolvedValueOnce({
    code_hash: 'drift',
    block_hash: 'new',
    block_height: 124,
  });
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/live/dispatch',
    headers,
    payload: { operationId: op.operationId },
  });
  expect(r.statusCode).toBe(409);
  expect(s.get(op.operationId)?.state).toBe('PREPARED');
  const q = createSession(s, 'stranger', 'TESTNET');
  const denied = await app.inject({
    method: 'POST',
    url: '/api/v1/live/prepare',
    headers: { ...headers, cookie: 'noma_session=' + q.token, 'x-csrf-token': q.csrf },
    payload: { planId: made.plan.id, index: 0 },
  });
  expect(denied.statusCode).toBe(404);
});

it('documents public v2 routes and returns a safe provider failure explanation', async () => {
  const schema = (await app.inject({ url: '/api/v1/openapi.json' })).json();
  expect(schema.info.version).toBe(release.version);
  for (const p of [
    'review/evidence',
    'review/policy-lab',
    'review/claims',
    'intents/tokens',
    'intents/preview',
  ])
    expect(schema.paths['/api/v1/' + p]).toBeTruthy();
  vi.spyOn(ReadOnlyIntents.prototype, 'preview').mockRejectedValue(
    new DomainError(
      'INTENTS_UNAVAILABLE',
      'The 1Click preview service is unavailable. No funds were moved.',
      503,
    ),
  );
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/intents/preview',
    headers: { host: 'localhost:80', origin: 'http://localhost:80' },
    payload: {},
  });
  expect(r.statusCode).toBe(503);
  expect(r.json().message).toContain('No funds were moved');
});
