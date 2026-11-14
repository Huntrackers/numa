import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Check,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Badge, Button, ErrorNotice, Field, Notice } from '../components';
import './Workspaces.css';

export type WorkspaceDirectory = {
  accountId: string;
  network: 'testnet';
  workspaces: {
    id: string;
    name: string;
    timezone: string;
    access: string;
    status: string;
    chainState: string;
    registrationPlan?: any;
  }[];
  employments: { id: string; companyName: string; status: string }[];
};

type DirectoryProps = {
  accountId: string;
  operator?: boolean;
  data: WorkspaceDirectory;
  initialCreate?: boolean;
  onRefresh: () => Promise<void>;
  onCommand: (action: string, payload: Record<string, unknown>, companyId?: string) => Promise<any>;
  onPlan: (plan: any) => void;
  onSelectCompany: (id: string) => void;
  onPersonal: () => void;
  onAdmin?: () => void;
  onSignOut: () => void;
};

function EntryHeader({ accountId, onSignOut }: { accountId: string; onSignOut: () => void }) {
  return (
    <header className="workspace-entry-header">
      <Link className="workspace-entry-brand" to="/" aria-label="numa home">
        <span aria-hidden="true">n</span>numa
      </Link>
      <div className="workspace-entry-identity">
        <Badge tone="good">NEAR testnet</Badge>
        <span className="workspace-entry-account" title={accountId}>
          {accountId}
        </span>
        <button className="icon-button" onClick={onSignOut} aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

export default function Workspaces({
  accountId,
  operator,
  data,
  initialCreate = false,
  onRefresh,
  onCommand,
  onPlan,
  onSelectCompany,
  onPersonal,
  onAdmin,
  onSignOut,
}: DirectoryProps) {
  const [showCreate, setShowCreate] = useState(initialCreate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [createdId, setCreatedId] = useState<string>();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const companyName = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initialCreate) setShowCreate(true);
  }, [initialCreate]);
  useEffect(() => {
    if (showCreate) companyName.current?.focus();
  }, [showCreate]);
  const task = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const resume = (workspace: WorkspaceDirectory['workspaces'][number]) =>
    void task(async () => {
      if (workspace.registrationPlan) onPlan(workspace.registrationPlan);
      else {
        const result = await onCommand('company.register', { id: workspace.id }, workspace.id);
        if (result.plan) onPlan(result.plan);
        else onSelectCompany(workspace.id);
      }
    });
  return (
    <div className="workspace-entry">
      <a className="skip-link" href="#workspace-entry-main">
        Skip to workspaces
      </a>
      <EntryHeader accountId={accountId} onSignOut={onSignOut} />
      <main id="workspace-entry-main" className="workspace-entry-main">
        <div className="workspace-entry-intro">
          <div>
            <h1>Your work starts here.</h1>
            <p>
              Choose a company, set up payroll for your team, or open your personal Salary Vault.
            </p>
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => void task(onRefresh)}>
            <RefreshCw size={15} /> Refresh access
          </Button>
        </div>
        <ErrorNotice error={error} />
        <div className="workspace-entry-layout">
          <section className="workspace-directory" aria-labelledby="workspace-companies-title">
            <div className="workspace-section-heading">
              <h2 id="workspace-companies-title">Company workspaces</h2>
              <Button variant="quiet" onClick={() => setShowCreate(true)} disabled={busy}>
                <Plus size={16} /> New company
              </Button>
            </div>
            {data.workspaces.length ? (
              <ul className="workspace-directory-list">
                {data.workspaces.map((workspace) => {
                  const draft = workspace.chainState !== 'REGISTERED';
                  return (
                    <li key={workspace.id}>
                      <div className="workspace-directory-row">
                        <span className="workspace-company-mark" aria-hidden="true">
                          {workspace.name[0]?.toUpperCase()}
                        </span>
                        <div className="workspace-company-description">
                          <h3>{workspace.name}</h3>
                          <p>
                            {workspace.access === 'owner'
                              ? 'Company owner'
                              : workspace.access === 'accountant'
                                ? 'Accountant'
                                : 'Observer'}{' '}
                            · {workspace.timezone}
                          </p>
                          <Badge
                            tone={draft ? 'copper' : workspace.status === 'ACTIVE' ? 'good' : 'bad'}
                          >
                            {draft
                              ? 'NEAR registration unfinished'
                              : workspace.status === 'ACTIVE'
                                ? 'Registered on NEAR'
                                : 'Company suspended'}
                          </Badge>
                        </div>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => onSelectCompany(workspace.id)}
                        >
                          Open <ArrowRight size={15} />
                        </Button>
                      </div>
                      {draft && workspace.access === 'owner' ? (
                        <div className="workspace-registration-recovery">
                          <p>
                            Your draft is saved. Finish the wallet transaction to activate payroll.
                          </p>
                          <Button
                            variant="quiet"
                            disabled={busy || workspace.status !== 'ACTIVE'}
                            onClick={() => resume(workspace)}
                          >
                            {workspace.registrationPlan
                              ? 'Resume NEAR registration'
                              : 'Review NEAR registration'}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="workspace-first-company">
                <Building2 size={30} aria-hidden="true" />
                <h3>Give your team a place to get paid.</h3>
                <p>
                  Create a company, define job roles and choose daily, weekly or monthly pay. You
                  review a NEAR transaction before the company is activated.
                </p>
                <Button onClick={() => setShowCreate(true)} disabled={busy}>
                  Create a company workspace
                </Button>
              </div>
            )}
            {showCreate ? (
              <section className="workspace-create" aria-labelledby="workspace-create-title">
                <h2 id="workspace-create-title">Create your company</h2>
                <p>
                  You become the owner with this NEAR account. Job roles, names and payroll reports
                  remain private in your company workspace.
                </p>
                {createdId ? (
                  <Notice>
                    Your company draft is saved. Use its registration action above to continue;
                    creating another draft is unnecessary.
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setCreatedId(undefined);
                        setName('');
                      }}
                      disabled={busy}
                    >
                      Set up a different company
                    </Button>
                  </Notice>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void task(async () => {
                        const result = await onCommand('company.create', {
                          name: name.trim(),
                          timezone: timezone.trim(),
                        });
                        setCreatedId(result.company.id);
                        if (result.plan) onPlan(result.plan);
                        await onRefresh();
                      });
                    }}
                  >
                    <Field label="Company name">
                      <input
                        ref={companyName}
                        required
                        maxLength={100}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your company name"
                        autoComplete="organization"
                        disabled={busy}
                      />
                    </Field>
                    <Field
                      label="Company timezone"
                      hint="Used to calculate paydays. Keep this consistent with your payroll calendar; it locks after funding or adding employees."
                    >
                      <input
                        required
                        maxLength={100}
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        placeholder="Europe/London"
                        disabled={busy}
                      />
                    </Field>
                    <div className="workspace-create-owner">
                      <ShieldCheck size={16} aria-hidden="true" />
                      <span>Owner: {accountId}</span>
                    </div>
                    <p className="workspace-create-proof">
                      Next: review company registration, then sign in your NEAR wallet. A draft is
                      not a confirmed registration. Testnet gas is paid in testNEAR.
                    </p>
                    <div className="button-group">
                      <Button type="submit" disabled={busy || !name.trim() || !timezone.trim()}>
                        {busy ? 'Preparing your workspace…' : 'Review NEAR registration'}
                      </Button>
                      <Button
                        variant="quiet"
                        type="button"
                        disabled={busy}
                        onClick={() => setShowCreate(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </section>
            ) : null}
          </section>
          <aside className="workspace-personal">
            <Wallet size={28} aria-hidden="true" />
            <h2>Your personal Salary Vault</h2>
            <p>
              See salary receipts, keep a cash reserve and choose savings goals with your own NEAR
              wallet.
            </p>
            <Button variant="secondary" onClick={onPersonal}>
              Open personal workspace <ArrowRight size={15} />
            </Button>
            {data.employments.length ? (
              <ul className="workspace-employments">
                {data.employments.map((employment) => (
                  <li key={employment.id}>
                    <b>{employment.companyName}</b>
                    <small>
                      {employment.status === 'ENDED'
                        ? 'Past employment'
                        : employment.status === 'ACTIVE'
                          ? 'Active employment'
                          : 'Employment ' + employment.status.toLowerCase()}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="workspace-invite-help">
                Joining a team? Open the invitation link your company owner shared and connect the
                NEAR account named in that invitation.
              </p>
            )}
            <div className="workspace-access-note">
              <ShieldCheck size={18} aria-hidden="true" />
              <p>
                Company access is granted by invitation. Your job role and your access permissions
                are separate.
              </p>
            </div>
            {operator && onAdmin ? (
              <Button variant="quiet" onClick={onAdmin}>
                Platform administration
              </Button>
            ) : null}
          </aside>
        </div>
        <footer className="workspace-entry-footer">
          <Link to="/">About numa</Link>
          <Link to="/trust">NEAR execution & evidence</Link>
          <span>Built on NEAR · Testnet only</span>
        </footer>
      </main>
    </div>
  );
}

export type InvitationSummary = {
  status:
    | 'INVALID'
    | 'WRONG_ACCOUNT'
    | 'EXPIRED'
    | 'REVOKED'
    | 'ACCEPTED'
    | 'REGISTRATION_PENDING'
    | 'READY';
  kind?: 'MEMBERSHIP' | 'EMPLOYMENT';
  companyId?: string;
  companyName?: string;
  accountId?: string;
  expiresAt?: string;
  access?: string;
  employee?: { name: string; jobRole: string; salary: string; cadence: string };
  plan?: any;
};
export function Invitation({
  invitation,
  accountId,
  onAccept,
  onSwitchAccount,
  onRefresh,
  onContinue,
  onSignOut,
}: {
  invitation: InvitationSummary;
  accountId: string;
  onAccept: () => Promise<void>;
  onSwitchAccount: () => void;
  onRefresh: () => Promise<void>;
  onContinue: (companyId?: string, kind?: string) => void;
  onSignOut: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const task = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const isMember = invitation.kind === 'MEMBERSHIP';
  const messages = {
    INVALID: [
      'This invitation is unavailable',
      'Check that you opened the complete link. Ask the company owner for a new invitation if the problem continues.',
    ],
    WRONG_ACCOUNT: [
      'Use the invited NEAR account',
      'This wallet does not match the invitation. Switch to the exact account your company invited. Invitation details stay private until the account matches.',
    ],
    EXPIRED: [
      'This invitation has expired',
      'Ask the company owner for a new link. No employment or company access was accepted through this expired invitation.',
    ],
    REVOKED: [
      'This invitation is no longer active',
      'The company owner changed or revoked this invitation or access. Contact the owner for a current invitation.',
    ],
    ACCEPTED: [
      'You have accepted this invitation',
      isMember
        ? 'Your company access is ready. Open the company workspace to continue.'
        : 'Your employment acceptance is confirmed. Open your personal workspace to see your Salary Vault.',
    ],
    REGISTRATION_PENDING: [
      'Your company has one more step',
      'Ask the company owner to complete your employee registration on NEAR. Once the transaction is confirmed, refresh this invitation.',
    ],
    READY: [
      isMember ? 'Join your company workspace' : 'Accept employment on NEAR',
      isMember
        ? 'Review your access and approve this invitation with your NEAR wallet. This grants company access; it does not authorize salary transfers.'
        : 'Review your employer and pay terms. Accept with a NEAR testnet transaction from this account. You retain control of your personal Salary Vault.',
    ],
  } as const;
  const text = messages[invitation.status];
  let salary = '';
  if (invitation.employee?.salary) {
    const n = BigInt(invitation.employee.salary);
    salary =
      (n / 10n ** 24n).toString() +
      '.' +
      (n % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '').padEnd(2, '0') +
      ' testNEAR';
  }
  return (
    <div className="workspace-entry">
      <EntryHeader accountId={accountId} onSignOut={onSignOut} />
      <main className="workspace-invitation-main">
        <div className="workspace-invitation-symbol" aria-hidden="true">
          {invitation.status === 'ACCEPTED' ? <Check size={30} /> : <ShieldCheck size={30} />}
        </div>
        <h1>{text[0]}</h1>
        <p>{text[1]}</p>
        {invitation.companyName ? (
          <dl className="workspace-invitation-details">
            <div>
              <dt>Company</dt>
              <dd>{invitation.companyName}</dd>
            </div>
            <div>
              <dt>Invited account</dt>
              <dd>{invitation.accountId}</dd>
            </div>
            <div>
              <dt>{isMember ? 'Access permissions' : 'Job role'}</dt>
              <dd>{isMember ? invitation.access : invitation.employee?.jobRole}</dd>
            </div>
            {!isMember && salary ? (
              <div>
                <dt>
                  Pay per{' '}
                  {invitation.employee?.cadence === 'daily'
                    ? 'day'
                    : invitation.employee?.cadence === 'weekly'
                      ? 'week'
                      : 'month'}
                </dt>
                <dd>{salary}</dd>
              </div>
            ) : null}
            {invitation.status === 'READY' && invitation.expiresAt ? (
              <div>
                <dt>Invitation expires</dt>
                <dd>{new Date(invitation.expiresAt).toLocaleString()}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <ErrorNotice error={error} />
        <div className="button-group">
          {invitation.status === 'READY' ? (
            <Button disabled={busy} onClick={() => void task(onAccept)}>
              {busy
                ? 'Opening wallet review…'
                : invitation.plan
                  ? 'Resume employment acceptance'
                  : isMember
                    ? 'Approve company access with NEAR'
                    : 'Review NEAR acceptance'}
            </Button>
          ) : null}
          {invitation.status === 'ACCEPTED' ? (
            <Button onClick={() => onContinue(invitation.companyId, invitation.kind)}>
              Open {isMember ? 'company' : 'personal'} workspace <ArrowRight size={15} />
            </Button>
          ) : null}
          {invitation.status === 'WRONG_ACCOUNT' ? (
            <Button disabled={busy} onClick={onSwitchAccount}>
              Switch NEAR account
            </Button>
          ) : null}
          {invitation.status === 'REGISTRATION_PENDING' || invitation.status === 'READY' ? (
            <Button variant="secondary" disabled={busy} onClick={() => void task(onRefresh)}>
              <RefreshCw size={15} /> Refresh invitation
            </Button>
          ) : null}
          <Link className="btn quiet" to="/workspaces">
            Your workspaces
          </Link>
        </div>
        <div className="workspace-invitation-footnote">
          Built on NEAR · {isMember ? 'NEP-413 wallet approval' : 'Verified testnet settlement'} ·
          No real-money payment
        </div>
      </main>
    </div>
  );
}
