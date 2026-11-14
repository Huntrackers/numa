import { operatorAccount } from './operators.js';
import { randomBytes, createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { Store } from '../../../packages/db/src/index.js';
import { ensure, hash } from '../../../packages/domain/src/index.js';
import { verifyKey } from '../../../packages/near-adapter/src/rpc.js';
export const tokenHash = (v: string) => createHash('sha256').update(v).digest('hex');
const str = (v: string) => {
  const b = Buffer.from(v);
  const n = Buffer.alloc(4);
  n.writeUInt32LE(b.length);
  return Buffer.concat([n, b]);
};
export function nep413(
  message: string,
  nonce: Uint8Array,
  recipient: string,
  callbackUrl?: string,
) {
  ensure(nonce.length === 32, 'INVALID_NONCE', 'Nonce must contain 32 bytes.');
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  return createHash('sha256')
    .update(
      Buffer.concat([
        tag,
        str(message),
        nonce,
        str(recipient),
        callbackUrl ? Buffer.concat([Buffer.from([1]), str(callbackUrl)]) : Buffer.from([0]),
      ]),
    )
    .digest();
}
export function challenge(s: Store, recipient: string, callbackUrl?: string) {
  const nonce = randomBytes(32).toString('base64');
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  const message =
    'Sign in to numa on NEAR testnet. This signature does not authorize a transfer. Expires: ' +
    expiresAt;
  const id = randomBytes(24).toString('hex');
  s.db
    .prepare(
      'INSERT INTO challenges(id,nonce,message,recipient,expires_at,used,callback_url) VALUES(?,?,?,?,?,0,?)',
    )
    .run(id, nonce, message, recipient, expiresAt, callbackUrl || null);
  return { id, nonce, message, recipient, callbackUrl, expiresAt, network: 'testnet' };
}
export async function verify(
  s: Store,
  p: { challengeId: string; accountId: string; publicKey: string; signature: string },
  recipient: string,
) {
  const c = s.db.prepare('SELECT * FROM challenges WHERE id=?').get(p.challengeId) as any;
  ensure(
    c && !c.used && c.expires_at > new Date().toISOString() && c.recipient === recipient,
    'INVALID_CHALLENGE',
    'Sign-in challenge expired or was already used.',
    401,
  );
  ensure(
    p.publicKey.startsWith('ed25519:') &&
      /^([a-z0-9]+[-_])*[a-z0-9]+(?:\.[a-z0-9_-]+)*$/.test(p.accountId),
    'INVALID_IDENTITY',
    'Use an ed25519 NEAR account.',
  );
  const digest = nep413(
    c.message,
    Buffer.from(c.nonce, 'base64'),
    c.recipient,
    c.callback_url || undefined,
  );
  let valid = false;
  try {
    valid = ed25519.verify(
      Buffer.from(p.signature, 'base64'),
      digest,
      bs58.decode(p.publicKey.slice(8)),
    );
  } catch {}
  ensure(valid, 'INVALID_SIGNATURE', 'The wallet signature is invalid.', 401);
  ensure(
    await verifyKey(p.accountId, p.publicKey),
    'INVALID_KEY',
    'The signing key is not a full-access key for this account.',
    401,
  );
  const id = 'near-' + hash(p.accountId).slice(0, 24);
  s.atomic(() => {
    const result = s.db.prepare('UPDATE challenges SET used=1 WHERE id=? AND used=0').run(c.id);
    ensure(Number(result.changes) === 1, 'CHALLENGE_USED', 'The challenge was already used.', 401);
    const administrator = operatorAccount(p.accountId);
    if (!s.get(id))
      s.save({
        type: 'user',
        id,
        name: p.accountId,
        accountId: p.accountId,
        role: administrator ? 'admin' : 'user',
        demo: false,
      });
    else if (s.get(id)!.role !== (administrator ? 'admin' : 'user'))
      s.save({ ...s.get(id)!, role: administrator ? 'admin' : 'user' });
  });
  return id;
}
export function createSession(s: Store, userId: string, mode: 'DEMO' | 'TESTNET') {
  const token = randomBytes(32).toString('base64url'),
    csrf = randomBytes(24).toString('hex');
  s.db
    .prepare('INSERT INTO sessions VALUES(?,?,?,?,?)')
    .run(tokenHash(token), userId, csrf, new Date(Date.now() + 8 * 3600000).toISOString(), mode);
  return { token, csrf };
}
