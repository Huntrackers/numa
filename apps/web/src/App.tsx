import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { release } from '../../../packages/domain/src/release';
import { isKnownRoute, safeReturnPath } from './routes';
import DecisionApproval from './DecisionApproval';
import {
  ArrowUpRight,
  ArrowRight,
  LayoutDashboard,
  Users,
  Layers3,
  CalendarDays,
  Wallet,
  ChartNoAxesCombined,
  MessageSquare,
  Settings2,
  Target,
  Repeat2,
  TrendingUp,
  Coins,
  Landmark,
  Globe2,
  ShieldCheck,
  Activity,
  FileClock,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Bell,
  Check,
  Plus,
  RefreshCw,
  Copy,
} from 'lucide-react';
import { api, sendCommand, cmd, demoLogin, ApiError, resetIdentityRequests } from './api';
import {
  Button,
  Badge,
  Dialog,
  Field,
  ErrorNotice,
  Loading,
  Preview,
  Notice,
  Empty,
} from './components';
import type { FormDef, UIContext } from './types';
const Company = lazy(() => import('./pages/Company'));
const Employee = lazy(() => import('./pages/Employee'));
const Admin = lazy(() => import('./pages/Admin'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Live = lazy(() => import('./pages/Live'));
const LiveDecision = lazy(() => import('./LiveDecision'));
import { NearFoundation } from './Near';
const Trust = lazy(() => import('./pages/Trust'));
const IntentsPreview = lazy(() => import('./IntentsPreview'));
const Network = lazy(() => import('./pages/Network'));
const Landing = lazy(() => import('./pages/Landing'));
const Workspaces = lazy(() => import('./pages/Workspaces'));
const Invitation = lazy(() =>
  import('./pages/Workspaces').then((m) => ({ default: m.Invitation })),
);
const navigation: any = {
  company: [
    ['overview', 'Overview', LayoutDashboard],
    ['employees', 'People', Users],
    ['roles', 'Job roles', Layers3],
    ['payroll', 'Payroll', CalendarDays],
    ['treasury', 'Treasury', Wallet],
    ['reports', 'Reports', ChartNoAxesCombined],
    ['assistant', 'numa assistant', MessageSquare],
    ['settings', 'Settings', Settings2],
  ],
  employee: [
    ['overview', 'Overview', LayoutDashboard],
    ['salary', 'Salary Vault', Wallet],
    ['wallets', 'Destinations', Globe2],
    ['rules', 'Salary allocation', Layers3],
    ['goals', 'Savings goals', Target],
    ['dca', 'DCA plans', Repeat2],
    ['invest', 'Invest', TrendingUp],
    ['portfolio', 'Portfolio', ChartNoAxesCombined],
    ['money-plan', 'Money plan', Coins],
    ['flexible-payday', 'Flexible payday', CalendarDays],
    ['borrow', 'Borrow & Earn', Landmark],
    ['assistant', 'numa assistant', MessageSquare],
  ],
  admin: [
    ['companies', 'Companies', Layers3],
    ['users', 'Users', Users],
    ['automation', 'Automation', Activity],
    ['integrations', 'Integrations', Globe2],
    ['settings', 'Settings', Settings2],
    ['audit', 'Audit trail', FileClock],
  ],
};
function NumaLogo({ small = false }: { small?: boolean }) {
  return (
    <div className={'noma-logo ' + (small ? 'small' : '')}>
      <svg width="28" height="30" viewBox="0 0 28 30" aria-hidden="true">
        <path
          d="M3 26V4L14 16V4L25 16V26"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>numa</span>
    </div>
  );
}
export default function App() {
  return (
    <>
      <WorkspaceApp />
      <DecisionApproval />
    </>
  );
}
function WorkspaceApp() {
  const nav = useNavigate(),
    loc = useLocation();
  const [auth, setAuth] = useState<any>(null),
    [boot, setBoot] = useState(true),
    [data, setData] = useState<any>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<unknown>(),
    [form, setForm] = useState<FormDef | null>(null),
    [preview, setPreview] = useState<any>(),
    [previewError, setPreviewError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(''),
    [switcher, setSwitcher] = useState(false),
    [mobile, setMobile] = useState(false),
    [notifications, setNotifications] = useState(false),
    [walletAccount, setWalletAccount] = useState(''),
    [walletBusy, setWalletBusy] = useState(false),
    [result, setResult] = useState<any>(),
    [livePlan, setLivePlan] = useState<any>(),
    [loadedContext, setLoadedContext] = useState(''),
    [staleError, setStaleError] = useState<unknown>(),
    [lastRefresh, setLastRefresh] = useState(''),
    [appConfig, setAppConfig] = useState<any>(),
    [directory, setDirectory] = useState<any>(),
    [invitation, setInvitation] = useState<any>(),
    [entryError, setEntryError] = useState<unknown>(),
    [entryLoading, setEntryLoading] = useState(false);
  const refreshSequence = useRef(0);
  const entrySequence = useRef(0);
  const identityGeneration = useRef(0);
  const updateIdentity = (value: any) => {
    identityGeneration.current++;
    resetIdentityRequests();
    setLivePlan(undefined);
    setPreview(undefined);
    setForm(null);
    setResult(undefined);
    setSwitcher(false);
    setNotifications(false);
    setToast('');
    setError(undefined);
    setAuth(value);
  };
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobile) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),[tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobile(false);
      } else if (event.key === 'Tab') {
        const items = controls(),
          first = items[0],
          last = items[items.length - 1];
        if (!first) return;
        if (!sidebarRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mobile]);
  const parts = loc.pathname.split('/').filter(Boolean);
  const scope = ['employee', 'admin'].includes(parts[0]) ? parts[0] : 'company';
  const companyId = parts[0] === 'company' ? parts[1] || 'forma' : 'forma';
  const page =
    parts[0] === 'network'
      ? 'network'
      : scope === 'company'
        ? parts[2] || 'overview'
        : parts[1] || (scope === 'admin' ? 'companies' : 'overview');
  const simulationBook =
    auth?.mode === 'TESTNET' &&
    scope === 'employee' &&
    (new URLSearchParams(loc.search).get('book') === 'simulation' ||
      !['overview', 'salary', 'goals', 'network'].includes(page));
  const dataContext = [
    auth?.user.id,
    auth?.mode,
    scope,
    companyId,
    page === 'network' ? 'network' : simulationBook ? 'simulation' : 'workspace',
  ].join(':');
  const unknownRoute = !isKnownRoute(loc.pathname);
  const isLanding = loc.pathname === '/';
  const isPublic = parts[0] === 'trust' && !unknownRoute;
  const isEntry = parts[0] === 'workspaces' || parts[0] === 'invite';
  const isLogin = loc.pathname === '/login' || parts[0] === 'invite';
  const inviteToken = parts[0] === 'invite' ? parts[1] : undefined;
  const requestedReturn = safeReturnPath(
    inviteToken
      ? loc.pathname
      : new URLSearchParams(loc.search).get('next') ||
          (loc.pathname !== '/login'
            ? loc.pathname + loc.search
            : sessionStorage.getItem('numa-return-path')),
  );
  const refreshDirectory = useCallback(async () => {
    const sequence = ++entrySequence.current;
    const generation = identityGeneration.current;
    const values = await Promise.all([
      api('/onboarding'),
      inviteToken
        ? api('/invitations/' + encodeURIComponent(inviteToken))
        : Promise.resolve(undefined),
    ]);
    if (sequence !== entrySequence.current || generation !== identityGeneration.current) return;
    setDirectory(values[0]);
    setInvitation(values[1]);
    setEntryError(undefined);
  }, [inviteToken]);
  useEffect(() => {
    if (!auth || auth.mode !== 'TESTNET' || !isEntry || unknownRoute) return;
    let active = true;
    setEntryLoading(true);
    setDirectory(undefined);
    setInvitation(undefined);
    setEntryError(undefined);
    void refreshDirectory()
      .catch((e) => {
        if (active) setEntryError(e);
      })
      .finally(() => {
        if (active) setEntryLoading(false);
      });
    return () => {
      active = false;
      entrySequence.current++;
    };
  }, [auth, isEntry, inviteToken, unknownRoute, refreshDirectory]);
  const go = useCallback(
    (p: string) => {
      nav(
        scope === 'company'
          ? '/company/' + companyId + '/' + p
          : '/' +
              scope +
              '/' +
              p +
              (simulationBook && scope === 'employee' && p !== 'network' ? '?book=simulation' : ''),
      );
      setMobile(false);
      setError(null);
    },
    [nav, scope, companyId, simulationBook],
  );
  const refresh = useCallback(async () => {
    if (!auth) return;
    const sequence = ++refreshSequence.current;
    const generation = identityGeneration.current;
    if (page === 'network') {
      setData((old: any) => old || { user: auth.user, notifications: [], workspaces: [] });
      setLoadedContext(dataContext);
      return;
    }
    const r = await api(
      simulationBook
        ? '/simulation/state'
        : (auth.mode === 'TESTNET' && scope !== 'admin' ? '/live/state?scope=' : '/state?scope=') +
            scope +
            '&companyId=' +
            encodeURIComponent(companyId),
    );
    if (sequence !== refreshSequence.current || generation !== identityGeneration.current) return;
    setData(r);
    setStaleError(undefined);
    setLastRefresh(new Date().toISOString());
    setLoadedContext(dataContext);
  }, [auth, scope, companyId, page, dataContext, simulationBook]);
  useEffect(() => {
    void (async () => {
      try {
        setAppConfig(await api('/config'));
        const { completeWalletCallback } = await import('./wallet');
        const callback = await completeWalletCallback();
        const me = await api('/me');
        updateIdentity(me);
        const pendingRaw = localStorage.getItem('numa-pending-operation');
        if (me.mode === 'TESTNET' && pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw);
            const params = new URLSearchParams(location.search);
            const txHash = params.get('transactionHashes')?.split(',')[0] || pending.txHash;
            if (pending.accountId === me.user.accountId && txHash) {
              await api('/live/confirm', {
                method: 'POST',
                body: JSON.stringify({ operationId: pending.operationId, txHash }),
              });
              localStorage.removeItem('numa-pending-operation');
              if (params.has('transactionHashes')) history.replaceState({}, '', location.pathname);
            }
          } catch {
            /* Keep the operation available for explicit recovery. */
          }
        }

        if (callback) {
          const destination = safeReturnPath(sessionStorage.getItem('numa-return-path'));
          sessionStorage.removeItem('numa-return-path');
          nav(destination);
        }
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) setError(e);
      } finally {
        setBoot(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!auth || isLogin || isPublic || isLanding || isEntry || unknownRoute) return;
    let alive = true;
    setLoading(true);
    setStaleError(undefined);
    setError(null);
    refresh()
      .catch((e) => {
        if (alive) {
          setError(e);
          setData(undefined);
          setLoadedContext(dataContext);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const t = setInterval(() => {
      void refresh().catch((e) => {
        if (alive) setStaleError(e);
      });
    }, 5000);
    return () => {
      alive = false;
      refreshSequence.current++;
      clearInterval(t);
    };
  }, [refresh, isLogin, isPublic, isLanding, isEntry, unknownRoute]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const login = async (userId: string, path?: string) => {
    setError(null);
    try {
      await demoLogin(userId);
      const me = await api('/me');
      updateIdentity(me);
      setData(undefined);
      setSwitcher(false);
      nav(
        path ||
          (parts[0] === 'invite'
            ? loc.pathname
            : userId === 'admin'
              ? '/admin/companies'
              : ['new-employee', 'maya', 'noah', 'lena', 'eli', 'amara'].includes(userId)
                ? '/employee/overview'
                : '/company/' + (userId === 'other-owner' ? 'orbit' : 'forma') + '/overview'),
      );
    } catch (e) {
      setError(e);
    }
  };
  const run = async (action: string, payload: any = {}) => {
    if (staleError) throw new Error('Refresh the workspace before making a new decision.');
    setError(null);
    const generation = identityGeneration.current;
    try {
      const r =
        auth.mode === 'TESTNET' && scope !== 'admin'
          ? await sendCommand(
              action === 'notification.read'
                ? '/commands'
                : simulationBook
                  ? '/simulation/commands'
                  : '/live/commands',
              { action, payload, ...(scope === 'company' ? { companyId } : {}) },
            )
          : await cmd(action, payload, scope === 'company' ? companyId : undefined);
      if (generation !== identityGeneration.current)
        throw new ApiError(
          'IDENTITY_CHANGED',
          'The account changed. Check the original workspace for this request’s outcome.',
          409,
        );
      if (r.plan) setLivePlan(r.plan);
      if (!['preview.create', 'assistant.message', 'import.preview'].includes(action)) {
        await refresh().catch(setStaleError);
        setToast(
          r.plan
            ? 'Decision prepared. Complete the NEAR wallet steps to apply it.'
            : 'Saved. Your workspace is up to date.',
        );
      }
      return r;
    } catch (e) {
      if (generation === identityGeneration.current) setError(e);
      throw e;
    }
  };
  const decide = async (kind: string, input: any) => {
    const p = await run('preview.create', { kind, input });
    setPreviewError(null);
    setPreview(p);
  };
  const ctx: UIContext = {
    data,
    page,
    scope,
    companyId,
    run,
    decide,
    form: setForm,
    go,
    result: (title, body, items = []) =>
      title === 'live-plan' ? setLivePlan(items[0]?.plan) : setResult({ title, body, items }),
    refresh,
  };
  if (unknownRoute)
    return (
      <main id="main-content" className="not-found-page">
        <NumaLogo />
        <p className="context-line">Page not found</p>
        <h1>This path does not lead to a workspace.</h1>
        <p>
          The link may be incomplete. Open a workspace or inspect the public execution evidence.
        </p>
        <div className="action-row">
          <Link className="btn primary" to="/login">
            Open workspace access
          </Link>
          <Link className="btn secondary" to="/trust">
            View execution evidence
          </Link>
        </div>
      </main>
    );
  if (isPublic)
    return (
      <Suspense fallback={<Loading />}>
        <Trust />
      </Suspense>
    );
  if (isLanding)
    return (
      <Suspense fallback={<Loading />}>
        <Landing
          signedIn={!!auth}
          onCompany={() =>
            nav(auth?.mode === 'TESTNET' ? '/workspaces/new' : '/login?next=%2Fworkspaces%2Fnew')
          }
          onEmployee={() =>
            nav(
              auth?.mode === 'TESTNET'
                ? '/employee/overview'
                : '/login?next=%2Femployee%2Foverview',
            )
          }
          onSignIn={() => nav(auth?.mode === 'TESTNET' ? '/workspaces' : '/login')}
        />
      </Suspense>
    );
  if (boot) return <Loading />;
  const signOut = async () => {
    identityGeneration.current++;
    resetIdentityRequests();
    await api('/auth/logout', { method: 'POST', body: '{}' });
    try {
      await (await import('./wallet')).disconnectWallet();
    } catch {
      /* Session is already revoked. */
    }
    updateIdentity(null);
    setData(undefined);
    setDirectory(undefined);
    setWalletAccount('');
    setLivePlan(undefined);
    if (!inviteToken) sessionStorage.removeItem('numa-return-path');
    nav(inviteToken ? loc.pathname : '/login');
  };
  if (auth?.mode === 'TESTNET' && isEntry) {
    const command = async (action: string, payload: any = {}, id?: string) => {
      const generation = identityGeneration.current;
      const r = await sendCommand('/live/commands', {
        action,
        payload,
        ...(id ? { companyId: id } : {}),
      });
      if (generation !== identityGeneration.current)
        throw new ApiError(
          'IDENTITY_CHANGED',
          'The account changed. Check the original workspace for this request’s outcome.',
          409,
        );
      if (r.plan) setLivePlan(r.plan);
      await refreshDirectory().catch(setEntryError);
      return r;
    };
    return (
      <Suspense fallback={<Loading />}>
        {entryLoading ? (
          <Loading />
        ) : directory ? (
          inviteToken && invitation ? (
            <Invitation
              invitation={invitation}
              accountId={auth.user.accountId}
              onAccept={async () => {
                if (invitation.plan) setLivePlan(invitation.plan);
                else
                  await command(
                    invitation.kind === 'EMPLOYMENT' ? 'employee.accept' : 'member.accept',
                    { token: inviteToken },
                  );
              }}
              onSwitchAccount={() => {
                void signOut().catch(setEntryError);
              }}
              onSignOut={() => {
                void signOut().catch(setEntryError);
              }}
              onRefresh={refreshDirectory}
              onContinue={(id?: string, kind?: string) =>
                nav(
                  kind === 'EMPLOYMENT'
                    ? '/employee/overview'
                    : id
                      ? '/company/' + id + '/overview'
                      : '/workspaces',
                )
              }
            />
          ) : (
            <Workspaces
              accountId={auth.user.accountId}
              operator={auth.user.role === 'admin'}
              data={directory}
              initialCreate={parts[1] === 'new'}
              onRefresh={refreshDirectory}
              onCommand={command}
              onPlan={setLivePlan}
              onSelectCompany={(id) => nav('/company/' + id + '/overview')}
              onPersonal={() => nav('/employee/overview')}
              onAdmin={() => nav('/admin/companies')}
              onSignOut={() => {
                void signOut().catch(setEntryError);
              }}
            />
          )
        ) : null}
        {entryError ? (
          <section className="entry-error" aria-label="Workspace access notice">
            <ErrorNotice error={entryError} />
            <div className="action-row">
              <Button
                onClick={() => {
                  setEntryLoading(true);
                  void refreshDirectory()
                    .catch(setEntryError)
                    .finally(() => setEntryLoading(false));
                }}
              >
                Retry workspace access
              </Button>
              <Link className="btn secondary" to="/">
                Return to numa
              </Link>
            </div>
          </section>
        ) : null}
        {livePlan ? (
          <LiveDecision
            key={livePlan.id}
            plan={livePlan}
            onClose={() => setLivePlan(undefined)}
            onDone={async () => {
              await refreshDirectory();
            }}
          />
        ) : null}
      </Suspense>
    );
  }
  if (!auth || isLogin)
    return (
      <div className="login-page">
        <div className="login-story">
          <NumaLogo />
          <div className="login-copy">
            <span className="login-kicker">Payroll and personal finance, built on NEAR.</span>
            <h1>
              A better rhythm
              <br /> for money.
            </h1>
            <p>
              From the company treasury to a personal plan.
              <br /> Make every payday the beginning of something.
            </p>
            <div className="login-flow">
              <span>Work</span>
              <i />
              <span>Payday</span>
              <i />
              <span>Possibility</span>
            </div>
          </div>
          <div className="login-network">
            <span className="near-monogram">Ⓝ</span>
            <div>
              <b>Built for NEAR</b>
              <small>NEAR settlement. Salary-linked savings. Signed Intents previews.</small>
            </div>
          </div>
        </div>
        <div className="login-entry">
          <div className="login-topline">
            <Badge tone="copper">Version {release.label} / NEAR testnet</Badge>
            <a href="https://docs.near.org/" target="_blank" rel="noreferrer">
              About NEAR
              <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="login-options">
            <p className="context-line">Welcome to numa</p>
            <h2>Step into your workspace.</h2>
            <p>Connect Meteor to verify your NEAR testnet identity.</p>
            <Link className="text-button" to="/">
              Learn how numa works <ArrowRight size={14} />
            </Link>
            {auth?.mode === 'TESTNET' ? (
              <Button onClick={() => nav(requestedReturn)}>
                Continue as {auth.user.accountId}
              </Button>
            ) : null}
            {appConfig?.demoEnabled ? (
              <>
                <button className="workspace-option" onClick={() => void login('owner')}>
                  <div className="workspace-icon">
                    <Layers3 size={23} />
                  </div>
                  <div>
                    <b>I’m running a company</b>
                    <span>People, payroll and a treasury with a plan</span>
                  </div>
                  <ArrowRight size={20} />
                </button>
                <button className="workspace-option" onClick={() => void login('maya')}>
                  <div className="workspace-icon employee">
                    <Wallet size={23} />
                  </div>
                  <div>
                    <b>I’m planning my money</b>
                    <span>Salary, goals and steady investing habits</span>
                  </div>
                  <ArrowRight size={20} />
                </button>
              </>
            ) : null}
            <div className="login-secondary">
              <button onClick={() => nav('/trust')}>
                Explore execution &amp; safety <ArrowUpRight size={13} />
              </button>
              {appConfig?.demoEnabled ? (
                <button onClick={() => void login('admin')}>Operator console</button>
              ) : null}
              <button
                className={appConfig?.demoEnabled ? undefined : 'login-wallet-action'}
                disabled={walletBusy}
                onClick={() => {
                  setError(null);
                  setWalletBusy(true);
                  sessionStorage.setItem('numa-return-path', requestedReturn);
                  void import('./wallet')
                    .then(async (m) => {
                      if (!walletAccount) setWalletAccount(await m.connectWallet());
                      else {
                        await m.signInWallet();
                        const me = await api('/me');
                        updateIdentity(me);
                        setData(undefined);
                        sessionStorage.removeItem('numa-return-path');
                        nav(requestedReturn);
                      }
                    })
                    .catch(setError)
                    .finally(() => setWalletBusy(false));
                }}
              >
                {walletBusy
                  ? 'Waiting for wallet…'
                  : walletAccount
                    ? 'Verify testnet identity'
                    : 'Connect testnet wallet'}
                <ArrowUpRight size={13} />
              </button>
            </div>
            <ErrorNotice error={error} />
            {parts[0] === 'invite' ? (
              <Notice>
                {appConfig?.demoEnabled && auth?.mode !== 'TESTNET' ? (
                  <Button
                    onClick={() => {
                      void (async () => {
                        await demoLogin('new-employee');
                        updateIdentity(await api('/me'));
                        await cmd('employee.accept', { token: parts[1] });
                        setData(undefined);
                        nav('/employee/overview');
                      })().catch(setError);
                    }}
                  >
                    Accept demo invitation
                  </Button>
                ) : null}
                <p>You have a workspace invitation. Verify the invited NEAR account first.</p>
                {auth?.mode === 'TESTNET' ? (
                  <>
                    <Button
                      onClick={() => {
                        void run('employee.accept', { token: parts[1] }).catch(() => {});
                      }}
                    >
                      Accept employment on NEAR
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void run('member.accept', { token: parts[1] })
                          .then(() => nav('/company/forma/overview'))
                          .catch(() => {});
                      }}
                    >
                      Accept company access
                    </Button>
                  </>
                ) : (
                  <p>Use “Connect testnet wallet” and “Verify testnet identity” above.</p>
                )}
              </Notice>
            ) : null}
            <p className="login-disclosure">
              DemoUSD is fictional money. Cross-chain swaps, investing and loans are simulations.
              Native testNEAR lives in a separate wallet workspace.
            </p>
          </div>
          <div className="login-footer">A clear plan for the people behind the numbers.</div>
          {livePlan ? (
            <Suspense fallback={<Loading />}>
              <LiveDecision
                key={livePlan.id}
                plan={livePlan}
                onClose={() => setLivePlan(undefined)}
                onDone={async () => {
                  if (livePlan.commit?.employeeId) {
                    setLivePlan(undefined);
                    sessionStorage.removeItem('numa-return-path');
                    nav('/employee/overview');
                  } else await refresh();
                }}
              />
            </Suspense>
          ) : null}
        </div>
      </div>
    );
  const currentNav = navigation[scope];
  return (
    <div className={'app-shell ' + (mobile ? 'mobile-open' : '')}>
      <aside
        className="sidebar"
        id="workspace-sidebar"
        ref={sidebarRef}
        role={mobile ? 'dialog' : 'complementary'}
        aria-modal={mobile || undefined}
        aria-label="Workspace menu"
      >
        <div className="sidebar-brand">
          <NumaLogo small />
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button className="workspace-picker" onClick={() => setSwitcher(true)}>
          <span className="workspace-avatar">
            {scope === 'admin' ? 'N' : scope === 'employee' ? 'M' : 'F'}
          </span>
          <div>
            <b>
              {scope === 'admin'
                ? 'numa platform'
                : scope === 'employee'
                  ? 'Personal workspace'
                  : data?.company?.name || 'Company workspace'}
            </b>
            <small>
              {scope === 'admin' ? 'Operator' : scope === 'employee' ? 'Your money' : 'Company'}
            </small>
          </div>
          <ChevronDown size={16} />
        </button>
        <nav aria-label="Workspace navigation">
          {true
            ? currentNav
                .filter(
                  (n: any) =>
                    auth.mode !== 'TESTNET' ||
                    (scope === 'admin'
                      ? navigation.admin.map((v: any) => v[0])
                      : scope === 'company'
                        ? [
                            'overview',
                            'employees',
                            'roles',
                            'payroll',
                            'treasury',
                            'reports',
                            'assistant',
                            'settings',
                          ]
                        : navigation.employee.map((v: any) => v[0])
                    ).includes(n[0]),
                )
                .map(([p, label, Icon]: any) => (
                  <button key={p} className={page === p ? 'active' : ''} onClick={() => go(p)}>
                    <Icon size={18} />
                    <span>{label}</span>
                    {p === 'assistant' ? <i className="new-dot" /> : null}
                  </button>
                ))
            : null}
          <div className="nav-divider" />
          <button
            className={page === 'network' ? 'active network-nav' : 'network-nav'}
            onClick={() => go('network')}
          >
            <Globe2 size={18} />
            <span>NEAR testnet</span>
            <span className="testnet-dot" />
          </button>
          <button onClick={() => nav('/trust', { state: { returnTo: loc.pathname + loc.search } })}>
            <ShieldCheck size={18} />
            <span>Execution &amp; safety</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="environment-note">
            <ShieldCheck size={15} />
            <span>
              {auth.mode === 'DEMO' ? 'Simulation workspace' : 'Verified testnet identity'}
            </span>
          </div>
          <button className="profile-button" onClick={() => setSwitcher(true)}>
            <span className="profile-avatar">{auth.user?.name?.[0] || 'N'}</span>
            <div>
              <b>{auth.user?.name}</b>
              <small>{auth.mode === 'DEMO' ? 'Switch demo persona' : 'NEAR testnet account'}</small>
            </div>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>
      {mobile ? (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      ) : null}
      <div className="main-shell" inert={mobile}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="workspace-sidebar"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>
              {page === 'network'
                ? 'NEAR testnet'
                : scope === 'company'
                  ? 'Company workspace'
                  : scope === 'employee'
                    ? 'Personal workspace'
                    : 'Platform workspace'}
            </span>
            <span className="breadcrumb-slash">/</span>
            <b>
              {page === 'network'
                ? 'Network'
                : currentNav.find((n: any) => n[0] === page)?.[1] || 'Workspace'}
            </b>
          </div>
          <div className="topbar-right">
            <Badge tone={auth.mode === 'DEMO' ? 'copper' : 'good'}>
              {auth.mode === 'DEMO' || simulationBook ? 'demoUSD · Simulation' : 'NEAR testnet'}
            </Badge>
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={19} />
              {data?.notifications?.some((n: any) => !n.read) ? <i /> : null}
            </button>
          </div>
        </header>
        <main id="main-content">
          {staleError ? (
            <Notice tone="warning">
              The latest refresh failed. Displayed data is from{' '}
              {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : 'an earlier observation'}.
              New decisions are paused.{' '}
              <Button variant="quiet" onClick={() => void refresh().catch(setStaleError)}>
                Retry refresh
              </Button>
            </Notice>
          ) : null}
          <ErrorNotice error={error} />
          {auth.mode === 'TESTNET' && scope === 'employee' && page !== 'network' ? (
            <div className="action-row" aria-label="Personal book">
              <Button
                variant={!simulationBook ? 'primary' : 'secondary'}
                onClick={() => nav('/employee/overview')}
              >
                NEAR settlement
              </Button>
              <Button
                variant={simulationBook ? 'primary' : 'secondary'}
                onClick={() => nav('/employee/overview?book=simulation')}
              >
                Planning simulation
              </Button>
            </div>
          ) : null}
          {simulationBook ? (
            <Notice>
              Personal planning book · demoUSD. Enter a hypothetical salary to try allocation, DCA
              and investment scenarios. Your testNEAR salary and savings stay in the separate NEAR
              settlement book.
            </Notice>
          ) : null}
          <NearFoundation
            mode={scope === 'admin' ? 'OPERATOR' : simulationBook ? 'DEMO' : auth.mode}
            contractId={data?.contractId || data?.testnet?.contractId}
          />
          {loading || loadedContext !== dataContext ? (
            <Loading />
          ) : data ? (
            <Suspense fallback={<Loading />}>
              {scope === 'company' && page === 'treasury' ? (
                <IntentsPreview key={scope + ':' + page} purpose="company funding" />
              ) : scope === 'employee' && ['wallets', 'rules', 'dca', 'invest'].includes(page) ? (
                <IntentsPreview
                  key={scope + ':' + page}
                  purpose={
                    page === 'dca'
                      ? 'DCA purchase'
                      : page === 'invest'
                        ? 'investment conversion'
                        : page === 'rules'
                          ? 'salary allocation'
                          : 'salary conversion'
                  }
                />
              ) : null}
              {page === 'network' ? (
                <Network ctx={ctx} />
              ) : page === 'assistant' ? (
                <Assistant key={scope + ':' + simulationBook} ctx={ctx} />
              ) : auth.mode === 'TESTNET' && scope !== 'admin' && !simulationBook ? (
                <Live ctx={ctx} />
              ) : page === 'assistant' ? (
                <Assistant key={scope} ctx={ctx} />
              ) : scope === 'company' ? (
                <Company key={companyId} ctx={ctx} />
              ) : scope === 'employee' ? (
                <Employee ctx={ctx} />
              ) : (
                <Admin ctx={ctx} />
              )}
            </Suspense>
          ) : (
            <Empty
              title="This workspace could not be opened"
              action={
                <Button variant="secondary" onClick={() => void refresh().catch(setError)}>
                  Try again
                </Button>
              }
            >
              Check your access or switch to another persona.
            </Empty>
          )}
        </main>
        <footer className="app-footer">
          <span>numa makes the path visible.</span>
          <span>
            Built on NEAR <i /> English interface / v{release.label}
          </span>
        </footer>
      </div>
      {livePlan ? (
        <Suspense fallback={<Loading />}>
          <LiveDecision
            key={livePlan.id}
            plan={livePlan}
            onClose={() => setLivePlan(undefined)}
            onDone={refresh}
          />
        </Suspense>
      ) : null}
      {form ? <ActionForm config={form} onClose={() => setForm(null)} /> : null}
      {preview ? (
        <Preview
          preview={preview}
          busy={busy}
          error={previewError}
          onClose={() => {
            if (!busy) setPreview(null);
          }}
          onApply={() => {
            setBusy(true);
            setPreviewError(null);
            void run('preview.apply', { previewId: preview.id })
              .then(() => {
                setPreview(null);
                setToast('Decision applied. Your records have been updated.');
              })
              .catch(setPreviewError)
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
      {switcher ? (
        <Dialog title="Choose a workspace" onClose={() => setSwitcher(false)}>
          <div className="dialog-body workspace-switcher">
            <p>
              {auth.mode === 'TESTNET'
                ? 'Choose a company or your personal NEAR workspace.'
                : 'Each demo persona has its own server-side access rules.'}
            </p>
            {auth.mode === 'TESTNET' && auth.user.role === 'admin' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  nav('/admin/companies');
                  setSwitcher(false);
                }}
              >
                Platform administration
              </Button>
            ) : null}
            {auth.mode === 'TESTNET' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  nav('/employee/overview');
                  setSwitcher(false);
                }}
              >
                My NEAR Salary Vault
              </Button>
            ) : null}
            {data?.workspaces?.length ? (
              <div className="actual-workspaces">
                {data.workspaces.map((w: any) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      nav('/company/' + w.id + '/overview');
                      setSwitcher(false);
                    }}
                  >
                    <span className="avatar">{w.name[0]}</span>
                    <div>
                      <b>{w.name}</b>
                      <small>{w.access}</small>
                    </div>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </div>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setSwitcher(false);
                if (auth.mode === 'TESTNET') {
                  nav('/workspaces/new');
                  return;
                }
                setForm({
                  title: 'Create a company workspace',
                  fields: [
                    { id: 'name', label: 'Company name' },
                    { id: 'timezone', label: 'IANA timezone', value: 'UTC' },
                  ],
                  submitLabel: 'Create company',
                  submit: async (v) => {
                    const c = await run('company.create', v);
                    nav('/company/' + (c.company?.id || c.id) + '/overview');
                  },
                });
              }}
            >
              Create a company
            </Button>
            {auth.mode === 'TESTNET' ? (
              <Button
                variant="quiet"
                onClick={() => {
                  nav('/workspaces');
                  setSwitcher(false);
                }}
              >
                Manage workspaces & invitations
              </Button>
            ) : null}
            {(auth.mode === 'DEMO'
              ? [
                  ['owner', 'Alex Morgan', 'Company owner'],
                  ['maya', 'Maya Chen', 'Employee'],
                  ['accountant', 'Sam Taylor', 'Accountant, drafts and reports'],
                  ['observer', 'Jamie Ross', 'Read-only observer'],
                  ['admin', 'numa operator', 'Platform administration'],
                  ['other-owner', 'River Bennett', 'Another company, isolated tenant'],
                ]
              : []
            ).map(([id, name, role]) => (
              <button key={id} onClick={() => void login(id)}>
                <span className="avatar">{name[0]}</span>
                <div>
                  <b>{name}</b>
                  <small>{role}</small>
                </div>
                <ArrowRight size={17} />
              </button>
            ))}
            <Button
              variant="secondary"
              onClick={() => {
                setSwitcher(false);
                void signOut().catch(setError);
              }}
            >
              <LogOut size={16} />
              Sign out
            </Button>
          </div>
        </Dialog>
      ) : null}
      {notifications ? (
        <Dialog title="Your notifications" onClose={() => setNotifications(false)}>
          <div className="dialog-body">
            {data?.notifications?.length ? (
              data.notifications
                .slice()
                .reverse()
                .map((n: any) => (
                  <button
                    className={'notification-row ' + (!n.read ? 'unread' : '')}
                    key={n.id}
                    onClick={() => {
                      void run('notification.read', { id: n.id }).catch(() => {});
                    }}
                  >
                    <b>{n.title}</b>
                    <p>{n.body}</p>
                    <small>{n.read ? 'Read' : 'Click to mark as read'}</small>
                  </button>
                ))
            ) : (
              <Empty title="You’re all caught up" />
            )}
          </div>
        </Dialog>
      ) : null}
      {result ? (
        <Dialog title={result.title} onClose={() => setResult(null)} wide>
          <div className="dialog-body">
            <p>{result.body}</p>
            {result.items?.map((x: any, i: number) => (
              <div className="result-item" key={i}>
                <b>{x.label}</b>
                <p>{x.value}</p>
                {x.commit ? (
                  <Button
                    onClick={() => {
                      void run('import.commit', { previewId: x.commit })
                        .then((r) =>
                          setResult({
                            title: 'Invitations created',
                            body: 'Share each one-time invitation with the matching employee.',
                            items: r.invitationLinks.map((l: any) => ({
                              label: l.name,
                              value: location.origin + l.url,
                            })),
                          }),
                        )
                        .catch(() => {});
                    }}
                  >
                    Commit import
                  </Button>
                ) : (
                  <Button
                    variant="quiet"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(x.value)
                        .then(() => setToast('Copied to clipboard.'))
                    }
                  >
                    <Copy size={14} />
                    Copy
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Dialog>
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
function ActionForm({ config, onClose }: { config: FormDef; onClose: () => void }) {
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={config.title}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide={config.fields.some((f) => f.type === 'textarea')}
    >
      <form
        onChange={(e) => {
          const el = e.target as unknown as HTMLInputElement;
          const form = e.currentTarget;
          const changes = config.onChange?.(
            Object.fromEntries(new FormData(form).entries()) as Record<string, string>,
            el.name,
          );
          for (const [key, value] of Object.entries(changes || {})) {
            const target = form.elements.namedItem(key) as HTMLInputElement | null;
            if (target) target.value = value;
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const values = Object.fromEntries(
            config.fields.map((f) => [
              f.id,
              f.type === 'multiselect' ? fd.getAll(f.id).join(',') : String(fd.get(f.id) || ''),
            ]),
          ) as Record<string, string>;
          setBusy(true);
          setError(null);
          void config
            .submit(values)
            .then(() => onClose())
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          {config.description ? <p className="form-description">{config.description}</p> : null}
          {config.fields.map((f) => (
            <Field key={f.id} label={f.label} hint={f.hint}>
              {f.type === 'select' || f.options ? (
                <select
                  aria-label={f.label}
                  name={f.id}
                  multiple={f.type === 'multiselect'}
                  defaultValue={
                    f.type === 'multiselect'
                      ? (f.value || '').split(',')
                      : f.value || f.options?.[0]?.value
                  }
                  aria-invalid={
                    error instanceof ApiError &&
                    error.fieldErrors.some((x) => x.path.includes(f.id))
                  }
                  required={f.required !== false}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <>
                  <input
                    aria-label="Upload CSV file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={async (e) => {
                      const file = e.currentTarget.files?.[0];
                      const target = e.currentTarget.form?.elements.namedItem(
                        f.id,
                      ) as HTMLTextAreaElement;
                      if (!file) return;
                      if (file.size > 1000000) {
                        setError(new Error('Use a CSV file smaller than one megabyte.'));
                        return;
                      }
                      try {
                        target.value = await file.text();
                        setError(null);
                      } catch (err) {
                        setError(err);
                      }
                    }}
                  />
                  <textarea
                    aria-label={f.label}
                    name={f.id}
                    defaultValue={f.value}
                    required={f.required !== false}
                    rows={7}
                  />
                </>
              ) : (
                <input
                  aria-label={f.label}
                  name={f.id}
                  aria-invalid={
                    error instanceof ApiError &&
                    error.fieldErrors.some((x) => x.path.includes(f.id))
                  }
                  type={f.type || 'text'}
                  defaultValue={f.value}
                  min={f.min}
                  step={f.step}
                  required={f.required !== false}
                  maxLength={f.type === 'text' || !f.type ? 500 : undefined}
                />
              )}
              {error instanceof ApiError
                ? error.fieldErrors
                    .filter((x) => x.path[0] === f.id)
                    .map((x, i) => (
                      <small className="field-error" role="alert" key={i}>
                        {x.message}
                      </small>
                    ))
                : null}
            </Field>
          ))}
          <ErrorNotice error={error} />
        </div>
        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Working…' : config.submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
