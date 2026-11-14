import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/db/src/index.js';
import { hash } from '../packages/domain/src/index.js';
import { LiveService } from '../apps/api/src/live.js';
import { invitationSummary, workspaceDirectory } from '../apps/api/src/onboarding.js';

let s: Store, live: LiveService, query: any;
const owner = { id: 'near-owner', mode: 'TESTNET' as const };
const invited = { id: 'near-invited', mode: 'TESTNET' as const };
const stranger = { id: 'near-stranger', mode: 'TESTNET' as const };
const token = 'c'.repeat(64);
beforeEach(() => {
  vi.stubEnv('NEAR_CONTRACT_ID', 'vault.testnet');
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-onboarding-')), 'db.sqlite'));
  for (const actor of [owner, invited, stranger])
    s.save({
      type: 'user',
      id: actor.id,
      accountId: actor.id.slice(5) + '.testnet',
      name: actor.id,
      demo: false,
      role: 'user',
    });
  s.save({
    id: 'company-one',
    type: 'company',
    tenant: 'company-one',
    owner: owner.id,
    mode: 'TESTNET',
    name: 'Private Company',
    timezone: 'UTC',
    status: 'ACTIVE',
    chainState: 'DRAFT',
    chainId: 'c_private',
  });
  s.save({
    type: 'membership',
    tenant: 'company-one',
    owner: owner.id,
    status: 'ACTIVE',
    access: 'owner',
  });
  s.save({ id: 'role-one', type: 'role', tenant: 'company-one', name: 'Private role' });
  query = vi.fn(async () => [{ employee_id: 'e_private', account_id: 'invited.testnet' }]);
  live = new LiveService(s, query);
});
afterEach(() => {
  s.close();
  vi.unstubAllEnvs();
});

function employeeInvitation(
  state = 'PENDING',
  expiresAt = new Date(Date.now() + 3600000).toISOString(),
) {
  const e = s.save({
    id: 'employee-one',
    type: 'employee',
    tenant: 'company-one',
    owner: 'pending-one',
    accountId: 'invited.testnet',
    name: 'Private Name',
    roleId: 'role-one',
    salary: '500',
    cadence: 'weekly',
    status: 'INVITED',
    chainId: 'e_private',
  });
  const i = s.save({
    id: 'invitation-one',
    type: 'invitation',
    tenant: 'company-one',
    owner: owner.id,
    employeeId: e.id,
    state,
    expiresAt,
    tokenHash: hash(token),
  });
  return { e, i };
}
function memberInvitation(state = 'PENDING') {
  return s.save({
    id: 'member-invite-one',
    type: 'member-invitation',
    tenant: 'company-one',
    owner: owner.id,
    accountId: 'invited.testnet',
    access: 'accountant',
    state,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    tokenHash: hash(token),
  });
}

describe('authenticated workspace and invitation discovery', () => {
  it('lists only active nonemployee memberships in actual testnet companies', () => {
    s.save({
      id: 'company-other',
      type: 'company',
      tenant: 'company-other',
      owner: stranger.id,
      mode: 'TESTNET',
      name: 'Other private company',
    });
    s.save({
      type: 'membership',
      tenant: 'company-other',
      owner: stranger.id,
      status: 'ACTIVE',
      access: 'owner',
    });
    s.save({
      type: 'membership',
      tenant: 'company-one',
      owner: invited.id,
      status: 'REVOKED',
      access: 'accountant',
    });
    expect(workspaceDirectory(s, live, owner).workspaces.map((w) => w.id)).toEqual(['company-one']);
    expect(workspaceDirectory(s, live, invited).workspaces).toEqual([]);
    expect(JSON.stringify(workspaceDirectory(s, live, stranger))).not.toContain('Private Company');
    expect(query).not.toHaveBeenCalled();
  });
  it('exposes the owner registration recovery plan without exposing another owner plan', () => {
    const plan = s.save({
      type: 'live-plan',
      tenant: 'company-one',
      owner: owner.id,
      state: 'PREVIEW',
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      steps: [{ method: 'register_company' }],
    });
    const directory = workspaceDirectory(s, live, owner);
    expect(directory.workspaces[0].registrationPlan?.id).toBe(plan.id);
    expect(workspaceDirectory(s, live, invited).workspaces).toEqual([]);
    s.save({ ...plan, expiresAt: new Date(Date.now() - 10000).toISOString() });
    expect(workspaceDirectory(s, live, owner).workspaces[0].registrationPlan).toBeUndefined();
    s.save({ ...s.get(plan.id)!, state: 'IN_PROGRESS' });
    expect(workspaceDirectory(s, live, owner).workspaces[0].registrationPlan?.id).toBe(plan.id);
  });
  it('rejects nonverified simulation identities before any directory discovery', () => {
    expect(() => workspaceDirectory(s, live, { ...owner, mode: 'DEMO' })).toThrow('Verify');
  });
  it('redacts every invitation detail from a different authenticated account', async () => {
    employeeInvitation();
    const summary = await invitationSummary(s, live, stranger, token);
    expect(summary).toEqual({ status: 'WRONG_ACCOUNT' });
    expect(query).not.toHaveBeenCalled();
  });
  it('returns invalid for unknown tokens and non-testnet invitations', async () => {
    expect(await invitationSummary(s, live, invited, 'unknown')).toEqual({ status: 'INVALID' });
    employeeInvitation();
    s.save({ ...s.get('company-one')!, mode: 'DEMO' });
    expect(await invitationSummary(s, live, invited, token)).toEqual({ status: 'INVALID' });
  });
  it('returns exact pay terms and the resumable acceptance only to the invited identity', async () => {
    const { i } = employeeInvitation();
    const plan = s.save({
      type: 'live-plan',
      tenant: 'company-one',
      owner: invited.id,
      state: 'IN_PROGRESS',
      expiresAt: '2000-01-01T00:00:00.000Z',
      commit: { invitationId: i.id },
    });
    expect(await invitationSummary(s, live, invited, token)).toMatchObject({
      status: 'READY',
      kind: 'EMPLOYMENT',
      companyName: 'Private Company',
      employee: { name: 'Private Name', jobRole: 'Private role', salary: '500', cadence: 'weekly' },
      plan: { id: plan.id },
    });
    expect(query).toHaveBeenCalledWith('vault.testnet', 'list_company_employees', {
      company_id: 'c_private',
    });
  });
  it('requires verified chain registration before offering acceptance', async () => {
    employeeInvitation();
    query.mockResolvedValue([]);
    expect(await invitationSummary(s, live, invited, token)).toMatchObject({
      status: 'REGISTRATION_PENDING',
      kind: 'EMPLOYMENT',
    });
  });
  it.each(['EXPIRED', 'REVOKED'] as const)(
    'offers no acceptance for %s invitations',
    async (state) => {
      employeeInvitation(
        state === 'REVOKED' ? 'REVOKED' : 'PENDING',
        state === 'EXPIRED' ? '2000-01-01T00:00:00.000Z' : undefined,
      );
      expect(await invitationSummary(s, live, invited, token)).toMatchObject({ status: state });
      expect(query).not.toHaveBeenCalled();
    },
  );
  it('distinguishes accepted employment from later terminated access', async () => {
    const { e } = employeeInvitation('ACCEPTED');
    s.save({ ...e, owner: invited.id, status: 'ACTIVE', identityVerified: true });
    expect(await invitationSummary(s, live, invited, token)).toMatchObject({ status: 'ACCEPTED' });
    s.save({ ...s.get(e.id)!, status: 'ENDED' });
    expect(await invitationSummary(s, live, invited, token)).toMatchObject({ status: 'REVOKED' });
  });
  it('distinguishes membership invitations, without requiring employment registration', async () => {
    memberInvitation();
    expect(await invitationSummary(s, live, invited, token)).toMatchObject({
      status: 'READY',
      kind: 'MEMBERSHIP',
      access: 'accountant',
    });
    expect(query).not.toHaveBeenCalled();
  });
  it('does not treat an accepted membership invitation as active after revocation', async () => {
    memberInvitation('ACCEPTED');
    const membership = s.save({
      type: 'membership',
      tenant: 'company-one',
      owner: invited.id,
      access: 'accountant',
      status: 'ACTIVE',
    });
    expect(await invitationSummary(s, live, invited, token)).toMatchObject({ status: 'ACCEPTED' });
    s.save({ ...membership, status: 'REVOKED' });
    expect(await invitationSummary(s, live, invited, token)).toMatchObject({ status: 'REVOKED' });
  });
});
