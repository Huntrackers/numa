import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { z } from 'zod';
import { Store } from '../../../packages/db/src/index.js';
import { canonical, DomainError, ensure, hash } from '../../../packages/domain/src/index.js';
import { verifyKey } from '../../../packages/near-adapter/src/rpc.js';
import { nep413 } from './auth.js';
import type { Actor } from './service.js';

const proofSchema = z
  .object({
    challengeId: z.string().regex(/^[a-f0-9]{48}$/),
    accountId: z.string().min(2).max(64),
    publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();

export type ApprovalContext = {
  actor: Actor;
  sessionHash: string;
  accountId: string;
  endpoint: string;
  recipient: string;
  key: string;
  action: string;
  companyId?: string;
  body: unknown;
  basis?: unknown;
  proof?: string;
};

// Invitation bearer tokens must not be copied into wallet history. Their hashes
// remain bound by commandHash and the signed message.
function display(value: any): any {
  if (Array.isArray(value)) return value.map(display);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /token|secret|password/i.test(key) ? { sha256: hash(v) } : display(v),
      ]),
    );
  return value;
}

export class ApprovalRequired extends DomainError {
  constructor(public approval: Record<string, unknown>) {
    super('APPROVAL_REQUIRED', 'Review and sign this decision with your NEAR account.', 428);
  }
}

const active = new Map<string, Promise<unknown>>();

/** NEP-413 signs local decisions. It never replaces on-chain settlement. */
export class DecisionApprovals {
  constructor(private s: Store) {}

  private challenge(context: ApprovalContext, commandHash: string, requestHash: string) {
    const now = new Date().toISOString();
    this.s.db
      .prepare("DELETE FROM decision_approvals WHERE state='PENDING' AND expires_at<?")
      .run(now);
    const previous = this.s.db
      .prepare(
        "SELECT * FROM decision_approvals WHERE actor=? AND endpoint=? AND request_key=? AND session_hash=? AND state='PENDING' AND expires_at>? ORDER BY rowid DESC LIMIT 1",
      )
      .get(context.actor.id, context.endpoint, context.key, context.sessionHash, now) as any;
    if (previous) return this.publicChallenge(previous, context);
    const count = this.s.db
      .prepare("SELECT count(*) AS total FROM decision_approvals WHERE actor=? AND state='PENDING'")
      .get(context.actor.id) as any;
    ensure(
      count.total < 30,
      'APPROVAL_LIMIT',
      'Too many pending decisions. Wait for them to expire.',
      429,
    );
    const id = randomBytes(24).toString('hex');
    const nonce = randomBytes(32).toString('base64');
    const expiresAt = new Date(Date.now() + 5 * 60000).toISOString();
    // ASCII JSON escapes keep the signed text interoperable with older wallet
    // Borsh implementations; the actual command hash still covers Unicode input.
    const visible = canonical(
      display({ body: context.body, basis: context.basis || null }),
    ).replace(/[^\x20-\x7e]/g, (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
    const message = [
      'numa decision approval - NEAR testnet - NEP-413',
      'This signature approves a local record or planning simulation. It does not transfer tokens or settle an investment.',
      'Account: ' + context.accountId,
      'Action: ' + context.action,
      'Workspace: ' + (context.companyId || 'personal/platform'),
      'Endpoint: ' + context.endpoint,
      'Domain: ' + context.recipient,
      'Command SHA-256: ' + commandHash,
      'Session binding: ' + hash(context.sessionHash),
      'Request binding: ' + hash(context.key),
      'Expires: ' + expiresAt,
      'Details: ' +
        (visible.length <= 8000
          ? visible
          : 'Large input; review the application preview. SHA-256: ' + hash(visible)),
    ].join('\n');
    this.s.db
      .prepare(
        'INSERT INTO decision_approvals(id,request_key,actor,session_hash,account_id,endpoint,action,company_id,input_hash,request_hash,nonce,message,recipient,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        context.key,
        context.actor.id,
        context.sessionHash,
        context.accountId,
        context.endpoint,
        context.action,
        context.companyId || '',
        commandHash,
        requestHash,
        nonce,
        message,
        context.recipient,
        expiresAt,
        'PENDING',
      );
    return this.publicChallenge(
      {
        id,
        nonce,
        message,
        recipient: context.recipient,
        expires_at: expiresAt,
        input_hash: commandHash,
      },
      context,
    );
  }

  private publicChallenge(row: any, context: ApprovalContext) {
    return {
      id: row.id,
      nonce: row.nonce,
      message: row.message,
      recipient: row.recipient,
      expiresAt: row.expires_at,
      network: 'testnet',
      accountId: context.accountId,
      commandHash: row.input_hash,
      action: context.action,
      companyId: context.companyId || null,
      endpoint: context.endpoint,
      payload: display(context.body),
      basis: display(context.basis || null),
      effect: 'LOCAL_RECORD_OR_SIMULATION',
    };
  }

  async run<T>(context: ApprovalContext, execute: () => T | Promise<T>): Promise<T> {
    if (context.actor.mode === 'DEMO') return execute();
    const request = {
      endpoint: context.endpoint,
      body: context.body,
      accountId: context.accountId,
      companyId: context.companyId || '',
      actor: context.actor.id,
      action: context.action,
      recipient: context.recipient,
    };
    const requestHash = hash(request);
    const commandHash = hash({ ...request, basis: context.basis || null });
    const lockId = hash([context.actor.id, context.endpoint, context.key]);
    const previous = active.get(lockId) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const existing = this.s.db
          .prepare(
            'SELECT * FROM decision_approvals WHERE actor=? AND endpoint=? AND request_key=? ORDER BY rowid DESC LIMIT 1',
          )
          .get(context.actor.id, context.endpoint, context.key) as any;
        // The response of an applied command is safe to replay even if the state
        // it changed (e.g. a planning-book reset) has since advanced. A pending
        // signature is always checked against the current, state-bound hash.
        if (existing?.state === 'APPLIED' && existing.request_hash === requestHash)
          return JSON.parse(existing.result) as T;
        ensure(
          !existing || existing.input_hash === commandHash,
          'IDEMPOTENCY_CONFLICT',
          'This decision key belongs to different input.',
          409,
        );
        // Returning an already applied result has no new side effect and needs no new signature.
        if (existing?.state === 'APPLIED' && existing.session_hash === context.sessionHash)
          return JSON.parse(existing.result) as T;
        if (!context.proof)
          throw new ApprovalRequired(this.challenge(context, commandHash, requestHash));
        let proof: z.infer<typeof proofSchema>;
        try {
          ensure(
            context.proof.length <= 1500,
            'INVALID_APPROVAL',
            'The decision signature is invalid.',
            401,
          );
          proof = proofSchema.parse(
            JSON.parse(Buffer.from(context.proof, 'base64url').toString('utf8')),
          );
        } catch {
          throw new DomainError('INVALID_APPROVAL', 'The decision signature is invalid.', 401);
        }
        const c = this.s.db
          .prepare('SELECT * FROM decision_approvals WHERE id=?')
          .get(proof.challengeId) as any;
        ensure(
          c && c.state === 'PENDING' && c.expires_at > new Date().toISOString(),
          'INVALID_APPROVAL',
          'This decision expired or was already used. Review a new decision.',
          401,
        );
        ensure(
          c.actor === context.actor.id &&
            c.session_hash === context.sessionHash &&
            c.account_id === context.accountId &&
            proof.accountId === context.accountId &&
            c.endpoint === context.endpoint &&
            c.request_key === context.key &&
            c.recipient === context.recipient &&
            c.input_hash === commandHash,
          'APPROVAL_MISMATCH',
          'This signature belongs to a different account, session or decision.',
          403,
        );
        let valid = false;
        try {
          valid = ed25519.verify(
            Buffer.from(proof.signature, 'base64'),
            nep413(c.message, Buffer.from(c.nonce, 'base64'), c.recipient),
            bs58.decode(proof.publicKey.slice(8)),
          );
        } catch {}
        ensure(valid, 'INVALID_SIGNATURE', 'The decision signature is invalid.', 401);
        ensure(
          await verifyKey(proof.accountId, proof.publicKey),
          'INVALID_KEY',
          'The signing key is not a full-access key for this NEAR account.',
          401,
        );
        // RPC verification may outlive a logout or session expiry. Do not consume
        // the nonce or mutate local records after that authorization is revoked.
        const session = this.s.db
          .prepare('SELECT * FROM sessions WHERE hash=? AND user_id=? AND expires_at>? AND mode=?')
          .get(context.sessionHash, context.actor.id, new Date().toISOString(), 'TESTNET');
        ensure(
          session && this.s.get(context.actor.id)?.accountId === context.accountId,
          'UNAUTHORIZED',
          'Your session ended. Sign in and review the decision again.',
          401,
        );
        const approvedAt = new Date().toISOString();
        const consumed = this.s.db
          .prepare(
            "UPDATE decision_approvals SET state='VERIFIED',public_key=?,signature=?,approved_at=? WHERE id=? AND state='PENDING' AND expires_at>?",
          )
          .run(proof.publicKey, proof.signature, approvedAt, c.id, approvedAt);
        ensure(
          Number(consumed.changes) === 1,
          'APPROVAL_USED',
          'This decision was already signed.',
          409,
        );
        try {
          const result = await execute();
          this.s.db
            .prepare(
              "UPDATE decision_approvals SET state='APPLIED',result=? WHERE id=? AND state='VERIFIED'",
            )
            .run(JSON.stringify(result), c.id);
          this.s.audit(context.actor.id, context.companyId || '', 'near.decision-approved', c.id, {
            action: context.action,
            commandHash,
            accountId: context.accountId,
            protocol: 'NEP-413',
            effect: 'LOCAL_RECORD_OR_SIMULATION',
          });
          return result;
        } catch (error) {
          this.s.db
            .prepare("UPDATE decision_approvals SET state='FAILED' WHERE id=? AND state='VERIFIED'")
            .run(c.id);
          throw error;
        }
      });
    active.set(lockId, task);
    try {
      return await task;
    } finally {
      if (active.get(lockId) === task) active.delete(lockId);
    }
  }

  proofs(actor: Actor) {
    return this.s.db
      .prepare(
        'SELECT id,account_id AS accountId,endpoint,action,company_id AS companyId,input_hash AS commandHash,message,recipient,nonce,public_key AS publicKey,signature,approved_at AS approvedAt,state FROM decision_approvals WHERE actor=? AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 50',
      )
      .all(actor.id);
  }
}

export const liveLocalDecisions = new Set([
  'company.settings',
  'role.save',
  'employee.update',
  'employee.invitation',
  'member.invite',
  'member.accept',
  'member.revoke',
  'plan.cancel',
]);
export const unsignedDecisions = new Set([
  'preview.create',
  'import.preview',
  'assistant.message',
  'notification.read',
]);
