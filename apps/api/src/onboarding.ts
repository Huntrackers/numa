import { Store } from '../../../packages/db/src/index.js';
import { hash } from '../../../packages/domain/src/index.js';
import { LiveService } from './live.js';
import type { Actor } from './service.js';

const now = () => new Date().toISOString();
const resumable = (plan: any) =>
  plan.state === 'IN_PROGRESS' || (plan.state === 'PREVIEW' && plan.expiresAt > now());

/** An authenticated directory, with no RPC dependency and no tenant-wide metadata. */
export function workspaceDirectory(s: Store, live: LiveService, actor: Actor) {
  const user = live.identity(actor);
  const plans = s.list('live-plan', undefined, actor.id);
  return {
    accountId: user.accountId,
    network: 'testnet',
    workspaces: live.memberships(actor).map((company: any) => ({
      id: company.id,
      name: company.name,
      timezone: company.timezone,
      access: company.access,
      status: company.status,
      chainState: company.chainState,
      registrationPlan:
        company.access === 'owner'
          ? plans
              .filter(
                (p) =>
                  p.tenant === company.id &&
                  p.steps[0]?.method === 'register_company' &&
                  resumable(p),
              )
              .at(-1)
          : undefined,
    })),
    employments: s
      .list('employee', undefined, actor.id)
      .filter((e) => s.get(e.tenant)?.mode === 'TESTNET')
      .map((e) => ({
        id: e.id,
        companyName: s.get(e.tenant)?.name,
        status: e.status,
      })),
  };
}

/** Token possession is insufficient: details are released only to the invited NEAR identity. */
export async function invitationSummary(s: Store, live: LiveService, actor: Actor, token: string) {
  const user = live.identity(actor);
  const tokenHash = hash(token);
  const member = s.list('member-invitation').find((i) => i.tokenHash === tokenHash);
  const employment = member
    ? undefined
    : s.list('invitation').find((i) => i.tokenHash === tokenHash);
  const invitation = member || employment;
  const employee = employment ? s.get(employment.employeeId) : undefined;
  const company = invitation ? s.get(invitation.tenant) : undefined;
  if (!invitation || !company || company.mode !== 'TESTNET') return { status: 'INVALID' };
  const accountId = member?.accountId || employee?.accountId;
  if (!accountId || accountId !== user.accountId) return { status: 'WRONG_ACCOUNT' };
  const kind = member ? 'MEMBERSHIP' : 'EMPLOYMENT';
  const base = {
    kind,
    companyId: company.id,
    companyName: company.name,
    accountId,
    expiresAt: invitation.expiresAt,
    access: member?.access,
    employee: employee
      ? {
          name: employee.name,
          jobRole: s.get(employee.roleId)?.name,
          salary: employee.salary,
          cadence: employee.cadence,
        }
      : undefined,
  };
  if (invitation.state === 'REVOKED') return { ...base, status: 'REVOKED' };
  if (invitation.state === 'ACCEPTED') {
    const active = member
      ? s
          .list('membership', company.id, actor.id)
          .some((m) => m.status === 'ACTIVE' && m.access !== 'employee')
      : employee?.identityVerified && employee.owner === actor.id && employee.status !== 'ENDED';
    return { ...base, status: active ? 'ACCEPTED' : 'REVOKED' };
  }
  if (invitation.state !== 'PENDING') return { ...base, status: 'INVALID' };
  if (invitation.expiresAt <= now()) return { ...base, status: 'EXPIRED' };
  if (company.status !== 'ACTIVE' || (!member && employee?.status === 'ENDED'))
    return { ...base, status: 'REVOKED' };
  if (member) return { ...base, status: 'READY' };
  const registration = await live.query(live.contract(), 'list_company_employees', {
    company_id: company.chainId,
  });
  const registered = registration.some(
    (e: any) => e.employee_id === employee!.chainId && e.account_id === accountId,
  );
  if (!registered) return { ...base, status: 'REGISTRATION_PENDING' };
  const plan = s
    .list('live-plan', company.id, actor.id)
    .filter((p) => p.commit?.invitationId === invitation.id && resumable(p))
    .at(-1);
  return { ...base, status: 'READY', plan };
}
