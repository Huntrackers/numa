import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  Fingerprint,
  Layers3,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { NearMark } from '../Near';
import './Landing.css';

export type LandingProps = {
  onCompany(): void;
  onEmployee(): void;
  onSignIn(): void;
  signedIn?: boolean;
};

function Brand() {
  return (
    <span className="landing-brand" aria-label="numa home">
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
    </span>
  );
}

export default function Landing({
  onCompany,
  onEmployee,
  onSignIn,
  signedIn = false,
}: LandingProps) {
  return (
    <div className="numa-landing">
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-header">
        <Link to="/" aria-label="numa home">
          <Brand />
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#product">The product</a>
          <a href="#how-it-works">How it works</a>
          <Link to="/trust">NEAR evidence</Link>
        </nav>
        <button className="landing-login" onClick={onSignIn}>
          {signedIn ? 'Open workspace' : 'Sign in'} <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <div className="landing-built">
              <NearMark />
              <span>Built on NEAR</span>
              <span className="landing-testnet">Testnet</span>
            </div>
            <h1 id="landing-title">Every payday has somewhere to go.</h1>
            <p className="landing-intro">
              Set your team’s roles and pay schedule. Let payroll run. Give every employee a clear
              path from salary to spending and savings.
            </p>
            <div className="landing-hero-actions">
              <button className="landing-button landing-button-primary" onClick={onCompany}>
                Create a company workspace <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button className="landing-employee-link" onClick={onEmployee}>
                I’m an employee
              </button>
            </div>
            <p className="landing-access-note">
              Connect a NEAR testnet wallet when you’re ready. Employees join their company through
              an invitation.
            </p>
          </div>

          <div className="landing-payroll-map" aria-label="Illustrative payroll path">
            <div className="landing-map-heading">
              <span>The path of a payday</span>
              <span>Illustrative flow</span>
            </div>
            <div className="landing-map-source">
              <div className="landing-map-icon">
                <Layers3 size={23} aria-hidden="true" />
              </div>
              <div>
                <b>Company treasury</b>
                <span>Fund and authorize on NEAR</span>
              </div>
              <span className="landing-map-tag">testNEAR</span>
            </div>
            <div className="landing-map-connector">
              <span />
              <CalendarDays size={16} aria-hidden="true" />
              <b>Daily, weekly or monthly</b>
            </div>
            <div className="landing-map-payday">
              <span className="landing-map-check">
                <Check size={18} aria-hidden="true" />
              </span>
              <div>
                <b>Salary reserved. Payday settled.</b>
                <span>The contract records the result.</span>
              </div>
              <NearMark />
            </div>
            <div className="landing-map-branches">
              <div className="landing-map-branch landing-map-cash">
                <Wallet size={20} aria-hidden="true" />
                <div>
                  <b>Available cash</b>
                  <span>Claim to your wallet</span>
                </div>
              </div>
              <div className="landing-map-branch landing-map-savings">
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                  <b>Savings goals</b>
                  <span>Reserve your chosen share</span>
                </div>
              </div>
            </div>
            <div className="landing-map-caption">
              <Fingerprint size={16} aria-hidden="true" />
              <span>You review. Your wallet authorizes. NEAR records.</span>
            </div>
          </div>
        </section>

        <section className="landing-product" id="product" aria-labelledby="landing-product-title">
          <div className="landing-section-intro">
            <h2 id="landing-product-title">One payroll. Two perspectives.</h2>
            <p>The company keeps its commitments. The employee decides what comes next.</p>
          </div>
          <div className="landing-perspectives">
            <article className="landing-company">
              <div className="landing-perspective-title">
                <span className="landing-perspective-symbol" aria-hidden="true">
                  ↗
                </span>
                <h3>For the company</h3>
              </div>
              <p className="landing-perspective-lead">Make payroll a process you can follow.</p>
              <ul className="landing-feature-list">
                <li>
                  <b>Define roles and salaries</b>
                  <span>
                    Set pay by role. Review a raise or reduction for one group or the whole team.
                  </span>
                </li>
                <li>
                  <b>Authorize a recurring schedule</b>
                  <span>
                    Fund the treasury and approve a payroll mandate. The worker executes when due.
                  </span>
                </li>
                <li>
                  <b>Keep the numbers explainable</b>
                  <span>
                    Track obligations, treasury reserves, payment history and accounting reports.
                  </span>
                </li>
              </ul>
              <button className="landing-text-action" onClick={onCompany}>
                Set up your company <ArrowRight size={16} aria-hidden="true" />
              </button>
            </article>
            <article className="landing-employee">
              <div className="landing-perspective-title">
                <span className="landing-perspective-symbol" aria-hidden="true">
                  ↘
                </span>
                <h3>For the employee</h3>
              </div>
              <p className="landing-perspective-lead">Give your salary a plan of its own.</p>
              <ul className="landing-feature-list">
                <li>
                  <b>See what you earned</b>
                  <span>Check your next payday, settled salary and wallet withdrawal history.</span>
                </li>
                <li>
                  <b>Build savings with every payday</b>
                  <span>
                    Choose fixed or percentage contributions to your goals, then review and sign.
                  </span>
                </li>
                <li>
                  <b>Explore the next step</b>
                  <span>
                    Preview supported cross-chain routes and try DCA and investment plans in
                    simulation.
                  </span>
                </li>
              </ul>
              <button className="landing-text-action" onClick={onEmployee}>
                Open your personal workspace <ArrowRight size={16} aria-hidden="true" />
              </button>
            </article>
          </div>
        </section>

        <section className="landing-how" id="how-it-works" aria-labelledby="landing-how-title">
          <div className="landing-section-intro">
            <h2 id="landing-how-title">From a workspace to the next payday.</h2>
            <p>Your NEAR wallet is your identity and your approval tool.</p>
          </div>
          <ol className="landing-steps">
            <li>
              <span className="landing-step-number" aria-hidden="true">
                1
              </span>
              <h3>Create and register</h3>
              <p>
                Connect your wallet, name your company and review its registration on NEAR testnet.
              </p>
            </li>
            <li>
              <span className="landing-step-number" aria-hidden="true">
                2
              </span>
              <h3>Invite and prepare</h3>
              <p>
                Define roles, invite exact NEAR accounts and let each employee accept their
                employment.
              </p>
            </li>
            <li>
              <span className="landing-step-number" aria-hidden="true">
                3
              </span>
              <h3>Fund and authorize</h3>
              <p>
                Review the schedule and reserves. Sign the mandate before automatic payday
                execution.
              </p>
            </li>
            <li>
              <span className="landing-step-number" aria-hidden="true">
                4
              </span>
              <h3>Follow the result</h3>
              <p>
                Check the confirmed receipt. Employees claim cash or keep their chosen savings
                reserved.
              </p>
            </li>
          </ol>
        </section>

        <section className="landing-near" aria-labelledby="landing-near-title">
          <div className="landing-near-explanation">
            <NearMark />
            <h2 id="landing-near-title">NEAR is part of the work.</h2>
            <p>
              Wallet signatures establish who you are. The NEAR contract holds payroll reserves,
              enforces approved mandates and records settlement. You can inspect the evidence before
              connecting a wallet.
            </p>
            <Link className="landing-near-link" to="/trust">
              Explore the NEAR evidence <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <dl className="landing-execution-scope">
            <div>
              <dt>
                <span className="landing-status-dot" />
                Real NEAR testnet
              </dt>
              <dd>
                Company registration, payroll mandates, salary settlement, savings and withdrawals
                in testNEAR.
              </dd>
            </div>
            <div>
              <dt>NEAR Intents · Live read-only</dt>
              <dd>Supported token catalog and route quotes. Quotes do not move funds.</dd>
            </div>
            <div>
              <dt>Personal finance · Simulation</dt>
              <dd>
                DCA, investments, Earn, loans and Flexible Payday use fictional demoUSD. No
                guaranteed returns.
              </dd>
            </div>
          </dl>
        </section>

        <section className="landing-start" aria-labelledby="landing-start-title">
          <div>
            <h2 id="landing-start-title">Start with the team. Build from payday.</h2>
            <p>Create a workspace for your company, or open the invitation your employer shared.</p>
          </div>
          <div className="landing-start-actions">
            <button className="landing-button landing-button-primary" onClick={onCompany}>
              Create a company workspace
            </button>
            <button className="landing-button landing-button-secondary" onClick={onEmployee}>
              Employee access
            </button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <Brand />
        <p>NEAR testnet only. Mainnet payments are not supported.</p>
        <Link to="/trust">Execution scope and evidence</Link>
      </footer>
    </div>
  );
}
