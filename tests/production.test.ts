import { it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/db/src/index.js';
import { buildApp } from '../apps/api/src/server.js';
import { createSession, challenge, verify } from '../apps/api/src/auth.js';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { signedInject } from './approval-fixture.js';
vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  verifyKey: vi.fn(async () => true),
  accountBalance: vi.fn(),
  view: vi.fn(),
  confirmOperation: vi.fn(),
  assertTestnet: vi.fn(),
}));
afterEach(() => vi.unstubAllEnvs());
it('starts a clean non-demo installation and keeps verified personal books isolated over HTTP', async () => {
  vi.stubEnv('DEMO_ENABLED', 'false');
  vi.stubEnv('LOG_LEVEL', 'silent');
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-clean-')), 'db.sqlite'));
  const app = await buildApp(s);
  const host = 'localhost:80',
    origin = 'http://localhost:80';
  const signer = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
  const request = (options: any) => signedInject(app, options, signer);
  try {
    expect(s.list('company')).toHaveLength(0);
    expect(s.get('settings')).toBeTruthy();
    expect((await app.inject({ url: '/api/v1/config' })).json().demoEnabled).toBe(false);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/demo',
          headers: { host, origin },
          payload: { userId: 'owner' },
        })
      ).statusCode,
    ).toBe(403);
    for (const id of ['first', 'second'])
      s.save({ id, type: 'user', name: id, accountId: id + '.testnet', demo: false });
    const login = (id: string) => {
      const q = createSession(s, id, 'TESTNET');
      return { host, origin, cookie: 'noma_session=' + q.token, 'x-csrf-token': q.csrf };
    };
    const a = login('first'),
      b = login('second');
    const credit = {
      action: 'simulation.credit',
      payload: { amount: '100000', bonusReserve: '1000' },
    };
    const r = await request({
      method: 'POST',
      url: '/api/v1/simulation/commands',
      headers: { ...a, 'idempotency-key': 'http-credit-1' },
      payload: credit,
    });
    expect(r.statusCode).toBe(200);
    expect(
      (
        await request({
          method: 'POST',
          url: '/api/v1/simulation/commands',
          headers: { ...a, 'idempotency-key': 'http-credit-1' },
          payload: credit,
        })
      ).json(),
    ).toEqual(r.json());
    const state = (await app.inject({ url: '/api/v1/simulation/state', headers: a })).json();
    expect(state.balances.cash).toBe('100000');
    expect(
      (await app.inject({ url: '/api/v1/simulation/state', headers: b })).json().balances.cash,
    ).toBe('0');
    const csv = await app.inject({
      url: '/api/v1/reports/export.csv?scope=employee&book=simulation',
      headers: a,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('SALARY');
    expect(
      (
        await request({
          url:
            '/api/v1/reports/export.csv?scope=company&book=simulation&companyId=' +
            state.company.id,
          headers: b,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request({
          url: '/api/v1/live/export.csv?scope=company&companyId=' + state.company.id,
          headers: b,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request({
          method: 'POST',
          url: '/api/v1/simulation/commands',
          headers: { ...b, 'idempotency-key': 'http-denied-1' },
          payload: {
            action: 'goal.release',
            payload: { id: 'someone-elses-goal', expectedVersion: 1 },
          },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request({
          method: 'POST',
          url: '/api/v1/simulation/commands',
          headers: { ...a, 'idempotency-key': 'http-reset-1' },
          payload: { action: 'simulation.reset', payload: { confirmation: 'RESET SIMULATION' } },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/simulation/state', headers: a })).json().balances.cash,
    ).toBe('0');
    expect(s.list('chain-operation')).toHaveLength(0);
  } finally {
    await app.close();
    s.close();
  }
});
it('accepts the Meteor NEP-413 signature without a callback and rejects hostile wallet selectors', async () => {
  vi.stubEnv('DEMO_ENABLED', 'false');
  vi.stubEnv('LOG_LEVEL', 'silent');
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-meteor-auth-')), 'db.sqlite'));
  const app = await buildApp(s);
  const headers = { host: 'localhost:80', origin: 'http://localhost:80' };
  try {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenges',
      headers,
      payload: { walletId: 'https://attacker.example/adapter.js' },
    });
    expect(bad.statusCode).toBe(400);
    const cr = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenges',
      headers,
      payload: { walletId: 'meteor-wallet' },
    });
    expect(cr.statusCode).toBe(200);
    const c = cr.json();
    expect(c.callbackUrl).toBeUndefined();
    const signer = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
    const signed = await signer.signNep413Message(
      c.message,
      'meteor.testnet',
      c.recipient,
      Buffer.from(c.nonce, 'base64'),
    );
    const p = {
      challengeId: c.id,
      accountId: signed.accountId,
      publicKey: signed.publicKey.toString(),
      signature: Buffer.from(signed.signature).toString('base64'),
    };
    await expect(verify(s, p, 'attacker.example')).rejects.toThrow('expired or was already used');
    expect(s.db.prepare('SELECT used FROM challenges WHERE id=?').get(c.id)?.used).toBe(0);
    expect(await verify(s, p, c.recipient)).toBeTruthy();
    await expect(verify(s, p, c.recipient)).rejects.toThrow('already used');
  } finally {
    await app.close();
    s.close();
  }
});
