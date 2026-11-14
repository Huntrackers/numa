import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { Store } from '../packages/db/src/index.js';
import {
  ApprovalRequired,
  DecisionApprovals,
  type ApprovalContext,
} from '../apps/api/src/approvals.js';
import { createSession } from '../apps/api/src/auth.js';
import { buildApp } from '../apps/api/src/server.js';
import { LiveService } from '../apps/api/src/live.js';
import { PersonalSimulation } from '../apps/api/src/simulation.js';
import { hash } from '../packages/domain/src/index.js';
import { signedInject } from './approval-fixture.js';
import { verifyKey } from '../packages/near-adapter/src/rpc.js';

vi.mock('../packages/near-adapter/src/rpc.js', () => ({
  verifyKey: vi.fn(async () => true),
  view: vi.fn(),
  accountBalance: vi.fn(),
  confirmOperation: vi.fn(),
  assertTestnet: vi.fn(),
  operationAnchor: vi.fn(),
}));
let s: Store;
const signer = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
const otherSigner = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
const base: ApprovalContext = {
  actor: { id: 'person', mode: 'TESTNET' },
  sessionHash: 'session-one',
  accountId: 'person.testnet',
  endpoint: '/api/v1/live/commands',
  recipient: 'localhost:80',
  key: 'approval-request-1',
  action: 'role.save',
  companyId: 'company-one',
  body: {
    action: 'role.save',
    companyId: 'company-one',
    payload: { name: 'Engineering', salary: '100', cadence: 'monthly' },
  },
};
async function signature(c: any, accountId = 'person.testnet', key = signer) {
  const proof = await key.signNep413Message(
    c.message,
    accountId,
    c.recipient,
    Buffer.from(c.nonce, 'base64'),
  );
  return Buffer.from(
    JSON.stringify({
      challengeId: c.id,
      accountId: proof.accountId,
      publicKey: proof.publicKey.toString(),
      signature: Buffer.from(proof.signature).toString('base64'),
    }),
  ).toString('base64url');
}
async function pending(a: DecisionApprovals, context = base) {
  try {
    await a.run(context, () => ({ ok: true }));
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequired);
    return (e as ApprovalRequired).approval;
  }
  throw new Error('Expected approval');
}
beforeEach(() => {
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-approvals-')), 'test.sqlite'));
  s.save({
    id: 'person',
    type: 'user',
    name: 'Person',
    accountId: 'person.testnet',
    demo: false,
    role: 'user',
  });
  s.db
    .prepare('INSERT INTO sessions VALUES(?,?,?,?,?)')
    .run(
      base.sessionHash,
      base.actor.id,
      'fixture-csrf',
      new Date(Date.now() + 60000).toISOString(),
      'TESTNET',
    );
  vi.mocked(verifyKey).mockResolvedValue(true);
  vi.stubEnv('DEMO_ENABLED', 'false');
  vi.stubEnv('LOG_LEVEL', 'silent');
});
afterEach(() => {
  s.close();
  vi.unstubAllEnvs();
});

describe('bound NEP-413 decision approval', () => {
  it('does not run a decision before approval and reuses the pending nonce for the exact request', async () => {
    const a = new DecisionApprovals(s),
      execute = vi.fn();
    await expect(a.run(base, execute)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
      status: 428,
    });
    expect(execute).not.toHaveBeenCalled();
    const first = await pending(a),
      second = await pending(a);
    expect(second).toEqual(first);
    expect(first.message).toContain('salary');
    expect(first.effect).toBe('LOCAL_RECORD_OR_SIMULATION');
  });
  it('matches the official NEAR signer, stores proof, and returns cached success without signing or mutating twice', async () => {
    const a = new DecisionApprovals(s),
      c = await pending(a),
      execute = vi.fn(() => ({ changed: true }));
    const context = { ...base, proof: await signature(c) };
    expect(await a.run(context, execute)).toEqual({ changed: true });
    expect(await a.run(base, execute)).toEqual({ changed: true });
    expect(await a.run(context, execute)).toEqual({ changed: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(a.proofs(base.actor)[0]).toMatchObject({
      state: 'APPLIED',
      accountId: 'person.testnet',
      action: 'role.save',
    });
    expect(() => s.db.prepare("UPDATE decision_approvals SET message='tampered'").run()).toThrow(
      'immutable',
    );
    expect(() => s.db.prepare('DELETE FROM decision_approvals').run()).toThrow('immutable');
  });
  it.each([
    ['payload', { body: { action: 'role.save', payload: { salary: '999999' } } }],
    ['company', { companyId: 'company-two' }],
    ['action', { action: 'admin.settings' }],
  ])('rejects altered %s using the same request key', async (_name, change) => {
    const a = new DecisionApprovals(s),
      c = await pending(a);
    await expect(
      a.run({ ...base, ...change, proof: await signature(c) }, () => ({ ok: true })),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(s.db.prepare('SELECT state FROM decision_approvals').get()?.state).toBe('PENDING');
  });
  it.each([
    ['session', { sessionHash: 'session-two' }],
    ['domain', { recipient: 'attacker.example' }],
    ['account', { accountId: 'attacker.testnet' }],
    ['endpoint', { endpoint: '/api/v1/commands' }],
    ['idempotency key', { key: 'approval-other-key' }],
  ])('rejects a signature replayed across %s', async (_name, change) => {
    const a = new DecisionApprovals(s),
      c = await pending(a),
      execute = vi.fn();
    await expect(
      a.run({ ...base, ...change, proof: await signature(c) }, execute),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects an expired challenge without consuming its signature', async () => {
    const a = new DecisionApprovals(s),
      c = await pending(a);
    s.db.prepare("UPDATE decision_approvals SET expires_at='2000-01-01'").run();
    await expect(
      a.run({ ...base, proof: await signature(c) }, () => ({ ok: true })),
    ).rejects.toMatchObject({ code: 'INVALID_APPROVAL' });
  });
  it('rejects a mismatched signature and a key no longer belonging to the NEAR account', async () => {
    const a = new DecisionApprovals(s),
      c = await pending(a);
    const wrong = JSON.parse(Buffer.from(await signature(c), 'base64url').toString());
    const other = JSON.parse(
      Buffer.from(await signature(c, 'person.testnet', otherSigner), 'base64url').toString(),
    );
    wrong.publicKey = other.publicKey;
    await expect(
      a.run({ ...base, proof: Buffer.from(JSON.stringify(wrong)).toString('base64url') }, () => ({
        ok: true,
      })),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    vi.mocked(verifyKey).mockResolvedValueOnce(false);
    await expect(
      a.run({ ...base, proof: await signature(c) }, () => ({ ok: true })),
    ).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });
  it('consumes one signature exactly once under concurrent requests', async () => {
    const a = new DecisionApprovals(s),
      c = await pending(a),
      execute = vi.fn(async () => ({ ok: true }));
    const context = { ...base, proof: await signature(c) };
    const results = await Promise.all([a.run(context, execute), a.run(context, execute)]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('requires a fresh signature after a failed decision and never reuses the consumed nonce', async () => {
    const a = new DecisionApprovals(s),
      c = await pending(a),
      proof = await signature(c);
    await expect(
      a.run({ ...base, proof }, () => {
        throw new Error('Version changed');
      }),
    ).rejects.toThrow('Version changed');
    await expect(a.run({ ...base, proof }, () => ({ ok: true }))).rejects.toMatchObject({
      code: 'INVALID_APPROVAL',
    });
    const fresh = await pending(a);
    expect(fresh.id).not.toBe(c.id);
    expect(await a.run({ ...base, proof: await signature(fresh) }, () => ({ ok: true }))).toEqual({
      ok: true,
    });
  });
  it('redacts bearer tokens from the wallet message while binding the exact command', async () => {
    const a = new DecisionApprovals(s),
      token = 'unpublished-invitation-token';
    const c = await pending(a, { ...base, body: { action: 'member.accept', payload: { token } } });
    expect(c.message).not.toContain(token);
    expect(JSON.stringify(c.payload)).not.toContain(token);
    expect(c.commandHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('keeps Unicode input intact while signing portable ASCII JSON escapes', async () => {
    const a = new DecisionApprovals(s),
      context = { ...base, body: { action: 'role.save', payload: { name: 'توسعه‌دهنده 🌱' } } };
    const c = await pending(a, context);
    expect(c.message).toMatch(/\\u062a/);
    expect(c.payload).toEqual(context.body);
    expect(await a.run({ ...context, proof: await signature(c) }, () => ({ ok: true }))).toEqual({
      ok: true,
    });
  });
  it('rejects a session revoked while the NEAR access-key RPC is in flight', async () => {
    const a = new DecisionApprovals(s),
      c = await pending(a),
      execute = vi.fn();
    vi.mocked(verifyKey).mockImplementationOnce(async () => {
      s.db.prepare('DELETE FROM sessions WHERE hash=?').run(base.sessionHash);
      return true;
    });
    await expect(a.run({ ...base, proof: await signature(c) }, execute)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(s.db.prepare('SELECT state FROM decision_approvals').get()?.state).toBe('PENDING');
  });
});

it('enforces the approval protocol over authenticated HTTP and keeps real chain previews separate', async () => {
  s.save({
    id: 'person',
    type: 'user',
    accountId: 'person.testnet',
    name: 'Person',
    demo: false,
    role: 'user',
  });
  const app = await buildApp(s),
    session = createSession(s, 'person', 'TESTNET');
  const headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
    'idempotency-key': 'http-approval-credit',
  };
  const payload = { action: 'simulation.credit', payload: { amount: '1200' } };
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation/commands',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(428);
    expect(s.list('obligation')).toHaveLength(0);
    const proof = await signature(first.json().approval);
    const done = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation/commands',
      headers: { ...headers, 'x-numa-approval': proof },
      payload,
    });
    expect(done.statusCode).toBe(200);
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation/commands',
      headers,
      payload,
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toEqual(done.json());
    expect(s.list('obligation')).toHaveLength(1);
    const proofs = await app.inject({ url: '/api/v1/approvals', headers });
    expect(proofs.json()[0]).toMatchObject({ state: 'APPLIED', action: 'simulation.credit' });
  } finally {
    await app.close();
  }
});

it('requires a NEAR signature for a local-only salary plan and preserves an idempotent local receipt', async () => {
  vi.stubEnv('NEAR_CONTRACT_ID', 'vault.testnet');
  s.save({
    id: 'person',
    type: 'user',
    accountId: 'person.testnet',
    name: 'Person',
    demo: false,
    role: 'user',
  });
  s.save({
    id: 'local-company',
    tenant: 'local-company',
    type: 'company',
    owner: 'person',
    mode: 'TESTNET',
    status: 'ACTIVE',
    name: 'Company',
    timezone: 'UTC',
  });
  s.save({
    type: 'membership',
    tenant: 'local-company',
    owner: 'person',
    access: 'owner',
    status: 'ACTIVE',
  });
  const plan = new LiveService(s).plan(
    base.actor,
    'Update salary agreement',
    [{ method: 'local_salary', args: {}, deposit: '0', label: 'Apply salary agreement' }],
    {},
    'local-company',
  );
  const app = await buildApp(s),
    session = createSession(s, 'person', 'TESTNET');
  const headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
  };
  const payload = { planId: plan.id, index: 0 };
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/live/prepare',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(428);
    expect(s.get(plan.id)?.state).toBe('PREVIEW');
    expect(first.json().approval.basis.inputHash).toBe(plan.inputHash);
    const done = await app.inject({
      method: 'POST',
      url: '/api/v1/live/prepare',
      headers: { ...headers, 'x-numa-approval': await signature(first.json().approval) },
      payload,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ local: true });
    expect(s.get(plan.id)?.state).toBe('COMPLETED');
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/v1/live/prepare',
      headers,
      payload,
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toEqual({ local: true });
    expect(s.list('chain-operation')).toHaveLength(0);
  } finally {
    await app.close();
  }
});

it('never includes another identity or company preview in an approval challenge', async () => {
  for (const id of ['person', 'stranger'])
    s.save({ id, type: 'user', accountId: id + '.testnet', name: id, demo: false, role: 'user' });
  const ownPlanning = new PersonalSimulation(s).actor(base.actor);
  const hidden = s.save({
    type: 'preview',
    owner: ownPlanning.id,
    tenant: 'confidential-company',
    kind: 'salary-change',
    inputHash: 'secret-input-hash',
    fingerprint: 'secret-fingerprint',
    input: { salary: '987654321' },
    effects: { ownerPrivateNote: 'private-company-data' },
  });
  const app = await buildApp(s),
    session = createSession(s, 'stranger', 'TESTNET');
  const headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
    'idempotency-key': 'hidden-preview-1',
  };
  try {
    for (const endpoint of ['/api/v1/commands', '/api/v1/simulation/commands']) {
      const denied = await app.inject({
        method: 'POST',
        url: endpoint,
        headers,
        payload: { action: 'preview.apply', payload: { previewId: hidden.id } },
      });
      expect(denied.statusCode).toBe(404);
      expect(denied.json().approval).toBeUndefined();
      expect(denied.body).not.toContain('987654321');
      expect(denied.body).not.toContain('private-company-data');
    }
    expect(s.db.prepare('SELECT count(*) AS n FROM decision_approvals').get()?.n).toBe(0);
  } finally {
    await app.close();
  }
});

it('returns a typed invalid invitation for a malformed token without failing onboarding', async () => {
  const app = await buildApp(s),
    session = createSession(s, 'person', 'TESTNET');
  const headers = { host: 'localhost:80', cookie: 'noma_session=' + session.token };
  try {
    const invalid = await app.inject({ url: '/api/v1/invitations/short', headers });
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json()).toEqual({ status: 'INVALID' });
    const directory = await app.inject({ url: '/api/v1/onboarding', headers });
    expect(directory.statusCode).toBe(200);
    expect(directory.json().accountId).toBe('person.testnet');
  } finally {
    await app.close();
  }
});

it('binds company membership acceptance to the invited account, access and company and refuses suspended employers', async () => {
  s.save({
    id: 'invite-company',
    tenant: 'invite-company',
    type: 'company',
    mode: 'TESTNET',
    name: 'Inviting Company',
    status: 'ACTIVE',
    owner: 'owner',
    timezone: 'UTC',
  });
  const token = 'a'.repeat(64);
  const invitation = s.save({
    type: 'member-invitation',
    tenant: 'invite-company',
    owner: 'owner',
    accountId: 'person.testnet',
    access: 'accountant',
    tokenHash: hash(token),
    state: 'PENDING',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const app = await buildApp(s),
    session = createSession(s, 'person', 'TESTNET');
  const headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
    'idempotency-key': 'accept-membership',
  };
  const payload = { action: 'member.accept', payload: { token } };
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(428);
    const c = first.json().approval;
    expect(c.companyId).toBe('invite-company');
    expect(c.basis).toMatchObject({
      companyName: 'Inviting Company',
      access: 'accountant',
      accountId: 'person.testnet',
      invitationVersion: invitation.version,
      state: 'PENDING',
    });
    s.save({ ...s.get('invite-company')!, status: 'SUSPENDED' });
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: { ...headers, 'x-numa-approval': await signature(c) },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('COMPANY_SUSPENDED');
    expect(s.list('membership', 'invite-company')).toHaveLength(0);
    // A new company version changes the signed basis, so review a new request.
    s.save({ ...s.get('invite-company')!, status: 'ACTIVE' });
    const nextHeaders = { ...headers, 'idempotency-key': 'accept-membership-new' };
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: nextHeaders,
      payload,
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: { ...nextHeaders, 'x-numa-approval': await signature(fresh.json().approval) },
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().access).toBe('accountant');
    expect(s.get(invitation.id)?.state).toBe('ACCEPTED');
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: nextHeaders,
      payload,
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual(accepted.json());
    expect(s.list('membership', 'invite-company')).toHaveLength(1);
  } finally {
    await app.close();
  }
});

it('denies an owned company preview submitted under another workspace before exposing its details', async () => {
  const hidden = s.save({
    type: 'preview',
    owner: 'person',
    tenant: 'private-company',
    kind: 'payroll',
    input: { salary: '987654321' },
    effects: { privateNote: 'confidential' },
  });
  const app = await buildApp(s),
    session = createSession(s, 'person', 'TESTNET');
  try {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/commands',
      headers: {
        host: 'localhost:80',
        origin: 'http://localhost:80',
        cookie: 'noma_session=' + session.token,
        'x-csrf-token': session.csrf,
        'idempotency-key': 'wrong-workspace-preview',
      },
      payload: {
        action: 'preview.apply',
        companyId: 'other-company',
        payload: { previewId: hidden.id },
      },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().approval).toBeUndefined();
    expect(denied.body).not.toContain('987654321');
    expect(denied.body).not.toContain('confidential');
  } finally {
    await app.close();
  }
});

it('supersedes old membership invitations and prevents a signed pending invitation restoring revoked access', async () => {
  s.save({
    id: 'invite-company',
    tenant: 'invite-company',
    type: 'company',
    mode: 'TESTNET',
    name: 'Private Company',
    privateAccountingNote: 'company-private-detail',
    status: 'ACTIVE',
    owner: 'person',
    timezone: 'UTC',
  });
  s.save({
    type: 'membership',
    tenant: 'invite-company',
    owner: 'person',
    access: 'owner',
    status: 'ACTIVE',
  });
  s.save({
    id: 'colleague',
    type: 'user',
    accountId: 'colleague.testnet',
    name: 'Colleague',
    role: 'user',
    demo: false,
  });
  const member = s.save({
    type: 'membership',
    tenant: 'invite-company',
    owner: 'colleague',
    access: 'observer',
    status: 'ACTIVE',
  });
  const app = await buildApp(s),
    ownerSession = createSession(s, 'person', 'TESTNET'),
    employeeSession = createSession(s, 'colleague', 'TESTNET');
  const headersFor = (session: ReturnType<typeof createSession>) => ({
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
  });
  const ownerHeaders = headersFor(ownerSession),
    employeeHeaders = headersFor(employeeSession);
  const command = (headers: Record<string, string>, key: string, payload: any) =>
    signedInject(
      app,
      {
        method: 'POST',
        url: '/api/v1/live/commands',
        headers: { ...headers, 'idempotency-key': key },
        payload,
      },
      signer,
    );
  try {
    const before = await app.inject({ url: '/api/v1/workspaces', headers: employeeHeaders });
    expect(before.json()).toHaveLength(1);
    expect(before.body).not.toContain('company-private-detail');
    const first = await command(ownerHeaders, 'invite-first-account', {
      action: 'member.invite',
      companyId: 'invite-company',
      payload: { accountId: 'colleague.testnet', access: 'accountant' },
    });
    expect(first.statusCode).toBe(200);
    const second = await command(ownerHeaders, 'invite-second-account', {
      action: 'member.invite',
      companyId: 'invite-company',
      payload: { accountId: 'colleague.testnet', access: 'accountant' },
    });
    expect(second.statusCode).toBe(200);
    const invitations = s.list('member-invitation', 'invite-company');
    expect(invitations.map((i) => i.state)).toEqual(['REVOKED', 'PENDING']);
    const token = second.json().invitationUrl.split('/').at(-1);
    const acceptPayload = { action: 'member.accept', payload: { token } };
    const acceptHeaders = { ...employeeHeaders, 'idempotency-key': 'accept-before-revoke' };
    const review = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: acceptHeaders,
      payload: acceptPayload,
    });
    expect(review.statusCode).toBe(428);
    const proof = await signature(review.json().approval, 'colleague.testnet');
    const revoked = await command(ownerHeaders, 'revoke-after-review', {
      action: 'member.revoke',
      companyId: 'invite-company',
      payload: { id: member.id, expectedVersion: member.version },
    });
    expect(revoked.statusCode).toBe(200);
    expect(s.get(invitations[1].id)?.state).toBe('REVOKED');
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: { ...acceptHeaders, 'x-numa-approval': proof },
      payload: acceptPayload,
    });
    expect(replay.statusCode).toBe(403);
    expect(replay.json().code).toBe('INVALID_INVITATION');
    expect(s.get(member.id)?.status).toBe('REVOKED');
    const oldToken = first.json().invitationUrl.split('/').at(-1);
    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/live/commands',
      headers: { ...employeeHeaders, 'idempotency-key': 'accept-superseded-invite' },
      payload: { action: 'member.accept', payload: { token: oldToken } },
    });
    expect(old.statusCode).toBe(403);
    const after = await app.inject({ url: '/api/v1/workspaces', headers: employeeHeaders });
    expect(after.json()).toEqual([]);
    expect(after.body).not.toContain('Private Company');
    const directory = await app.inject({ url: '/api/v1/onboarding', headers: employeeHeaders });
    expect(directory.json().workspaces).toEqual([]);
  } finally {
    await app.close();
  }
});

it('binds every signed simulation decision to its planning book epoch and keeps reset retries idempotent', async () => {
  const app = await buildApp(s),
    session = createSession(s, 'person', 'TESTNET');
  const headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
  };
  const credit = {
    method: 'POST' as const,
    url: '/api/v1/simulation/commands',
    headers: { ...headers, 'idempotency-key': 'credit-old-book' },
    payload: { action: 'simulation.credit', payload: { amount: '5000' } },
  };
  const reset = {
    method: 'POST' as const,
    url: '/api/v1/simulation/commands',
    headers: { ...headers, 'idempotency-key': 'reset-current-book' },
    payload: { action: 'simulation.reset', payload: { confirmation: 'RESET SIMULATION' } },
  };
  try {
    const review = await app.inject(credit);
    expect(review.statusCode).toBe(428);
    expect(review.json().approval.basis.profileEpoch).toBe(1);
    const oldProof = await signature(review.json().approval);
    const resetDone = await signedInject(app, reset, signer);
    expect(resetDone.statusCode).toBe(200);
    expect(s.get('simulation-profile:person')?.epoch).toBe(2);
    const resetRepeat = await app.inject(reset);
    expect(resetRepeat.statusCode).toBe(200);
    expect(resetRepeat.json()).toEqual(resetDone.json());
    expect(s.get('simulation-profile:person')?.epoch).toBe(2);
    const stale = await app.inject({
      ...credit,
      headers: { ...credit.headers, 'x-numa-approval': oldProof },
    });
    expect(stale.statusCode).toBe(409);
    const state = await app.inject({ url: '/api/v1/simulation/state', headers });
    expect(state.json().balances.cash).toBe('0');
    expect(s.list('obligation')).toHaveLength(0);
  } finally {
    await app.close();
  }
});

it('refuses a simulation decision if the book resets during access-key verification', async () => {
  const app = await buildApp(s),
    session = createSession(s, 'person', 'TESTNET');
  const headers = {
    host: 'localhost:80',
    origin: 'http://localhost:80',
    cookie: 'noma_session=' + session.token,
    'x-csrf-token': session.csrf,
  };
  const credit = {
    method: 'POST' as const,
    url: '/api/v1/simulation/commands',
    headers: { ...headers, 'idempotency-key': 'credit-reset-race' },
    payload: { action: 'simulation.credit', payload: { amount: '5000' } },
  };
  try {
    const review = await app.inject(credit),
      proof = await signature(review.json().approval);
    vi.mocked(verifyKey).mockImplementationOnce(async () => {
      const reset = await signedInject(
        app,
        {
          method: 'POST',
          url: '/api/v1/simulation/commands',
          headers: { ...headers, 'idempotency-key': 'signed-racing-reset' },
          payload: { action: 'simulation.reset', payload: { confirmation: 'RESET SIMULATION' } },
        },
        signer,
      );
      expect(reset.statusCode).toBe(200);
      return true;
    });
    const stale = await app.inject({
      ...credit,
      headers: { ...credit.headers, 'x-numa-approval': proof },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('PREVIEW_STALE');
    const state = await app.inject({ url: '/api/v1/simulation/state', headers });
    expect(state.json().balances.cash).toBe('0');
    expect(s.list('obligation')).toHaveLength(0);
  } finally {
    await app.close();
  }
});
