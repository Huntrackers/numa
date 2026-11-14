import { Service } from '../apps/api/src/service.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { Store } from '../packages/db/src/index.js';
import { challenge, verify, nep413 } from '../apps/api/src/auth.js';
import { buildApp } from '../apps/api/src/server.js';
vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  verifyKey: vi.fn(async () => true),
  accountBalance: vi.fn(),
  view: vi.fn(),
  confirmOperation: vi.fn(),
  assertTestnet: vi.fn(),
}));
let s: Store;
beforeEach(() => {
  vi.stubEnv('DEMO_ENABLED', 'true');
  s = new Store(join(mkdtempSync(join(tmpdir(), 'noma-auth-')), 'db.sqlite'));
});
afterEach(() => {
  s.close();
  vi.unstubAllEnvs();
});
describe('NEP-413 identity and session boundaries', () => {
  it('matches the official NEAR signer with a bound callback and consumes the nonce only once', async () => {
    const key = KeyPair.fromRandom('ed25519');
    const signer = new KeyPairSigner(key);
    const c = challenge(s, '127.0.0.1:4310', 'http://127.0.0.1:4310/login');
    const signed = await signer.signNep413Message(
      c.message,
      'golden.testnet',
      c.recipient,
      Buffer.from(c.nonce, 'base64'),
      c.callbackUrl,
    );
    const p = {
      challengeId: c.id,
      accountId: signed.accountId,
      publicKey: signed.publicKey.toString(),
      signature: Buffer.from(signed.signature).toString('base64'),
    };
    const id = await verify(s, p, c.recipient);
    expect(s.get(id)?.accountId).toBe('golden.testnet');
    await expect(verify(s, p, c.recipient)).rejects.toThrow('already used');
  });
  it('rejects a signature made for an unbound or altered callback', async () => {
    const signer = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
    const c = challenge(s, 'localhost:4310', 'http://localhost:4310/login');
    const signed = await signer.signNep413Message(
      c.message,
      'golden.testnet',
      c.recipient,
      Buffer.from(c.nonce, 'base64'),
      'https://attacker.example',
    );
    await expect(
      verify(
        s,
        {
          challengeId: c.id,
          accountId: signed.accountId,
          publicKey: signed.publicKey.toString(),
          signature: Buffer.from(signed.signature).toString('base64'),
        },
        c.recipient,
      ),
    ).rejects.toThrow('signature is invalid');
  });
  it('rejects an expired challenge', async () => {
    const c = challenge(s, 'localhost:4310');
    s.db.prepare('UPDATE challenges SET expires_at=? WHERE id=?').run('2000-01-01', c.id);
    await expect(
      verify(
        s,
        { challengeId: c.id, accountId: 'x.testnet', publicKey: 'ed25519:x', signature: 'x' },
        c.recipient,
      ),
    ).rejects.toThrow('expired');
  });
  it('binds the callback to the digest', () => {
    const nonce = new Uint8Array(32);
    expect(nep413('m', nonce, 'r').toString('hex')).not.toBe(
      nep413('m', nonce, 'r', 'https://x').toString('hex'),
    );
  });
  it('enforces same-origin mutations, CSRF tokens, and HttpOnly sessions', async () => {
    const app = await buildApp(s);
    try {
      const absent = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/demo',
        payload: { userId: 'owner' },
      });
      expect(absent.statusCode).toBe(403);
      const origin = 'http://localhost:80';
      const auth = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/demo',
        headers: { origin, host: 'localhost' },
        payload: { userId: 'owner' },
      });
      expect(auth.statusCode).toBe(200);
      const cookie = auth.headers['set-cookie']!.toString();
      expect(cookie).toContain('HttpOnly');
      const session = cookie.split(';')[0];
      const mutation = {
        action: 'treasury.fund',
        companyId: 'forma',
        payload: { amount: '1', purpose: 'cash' },
      };
      const noCsrf = await app.inject({
        method: 'POST',
        url: '/api/v1/commands',
        headers: { origin, host: 'localhost', cookie: session, 'idempotency-key': 'auth-test-key' },
        payload: mutation,
      });
      expect(noCsrf.statusCode).toBe(403);
      const good = await app.inject({
        method: 'POST',
        url: '/api/v1/commands',
        headers: {
          origin,
          host: 'localhost',
          cookie: session,
          'x-csrf-token': auth.json().csrf,
          'idempotency-key': 'auth-test-key',
        },
        payload: mutation,
      });
      expect(good.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

it('revokes operator authority for an existing session when the configured account is removed', async () => {
  const signer = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
  async function signIn() {
    const c = challenge(s, 'localhost:4310');
    const signed = await signer.signNep413Message(
      c.message,
      'operator.testnet',
      c.recipient,
      Buffer.from(c.nonce, 'base64'),
    );
    return verify(
      s,
      {
        challengeId: c.id,
        accountId: signed.accountId,
        publicKey: signed.publicKey.toString(),
        signature: Buffer.from(signed.signature).toString('base64'),
      },
      c.recipient,
    );
  }
  vi.stubEnv('NUMA_ADMIN_ACCOUNTS', 'operator.testnet');
  const id = await signIn();
  const actor = { id, mode: 'TESTNET' as const };
  const service = new Service(s);
  expect(() => service.admin(actor)).not.toThrow();
  vi.stubEnv('NUMA_ADMIN_ACCOUNTS', '');
  expect(() => service.admin(actor)).toThrow('Operator access');
  await signIn();
  expect(s.get(id)?.role).toBe('user');
});
