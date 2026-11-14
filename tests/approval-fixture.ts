import type { FastifyInstance } from 'fastify';
import { KeyPairSigner } from '@near-js/signers';

/** Real NEP-413 fixture signature, not an approval bypass. RPC key ownership is
 * mocked by callers, while nonce, body, domain and session checks remain real. */
export async function signedInject(app: FastifyInstance, options: any, signer: KeyPairSigner) {
  const first = await app.inject(options);
  if (first.statusCode !== 428) return first;
  const c = first.json().approval;
  const signed = await signer.signNep413Message(
    c.message,
    c.accountId,
    c.recipient,
    Buffer.from(c.nonce, 'base64'),
  );
  const proof = Buffer.from(
    JSON.stringify({
      challengeId: c.id,
      accountId: signed.accountId,
      publicKey: signed.publicKey.toString(),
      signature: Buffer.from(signed.signature).toString('base64'),
    }),
  ).toString('base64url');
  return app.inject({ ...options, headers: { ...options.headers, 'x-numa-approval': proof } });
}
