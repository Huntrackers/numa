import { release } from '../../../packages/domain/src/release.js';

// A map for independent verification, not a self-issued pass certificate or a judging score.
export const reviewClaims = {
  product: release.name,
  version: release.version,
  classification: 'CLAIMS_TO_VERIFY',
  score: null,
  officialScoringWeights: null,
  rule: 'https://nearhackathon.com/HACKATHON.md',
  sourceRule: 'Q-017',
  quickStart: ['npm ci', 'npm run build', 'npm run judge'],
  verification: ['npm run verify', 'npm run verify -- --browser --contract'],
  claims: [
    {
      id: 'N01',
      claim: 'Roles and daily, weekly or monthly salaries with bulk compensation previews',
      mode: 'TESTNET_AND_LABELLED_FIXTURE',
      tests: ['tests/live.test.ts', 'tests/domain.test.ts', 'tests/e2e/workflows.spec.ts'],
    },
    {
      id: 'N02',
      claim: 'A funded mandate reserves salary and credits each obligation once',
      mode: 'LIVE_TESTNET',
      tests: [
        'contracts/payroll-vault/src/lib.rs',
        'tests/worker-selection.test.ts',
        'tests/service.test.ts',
      ],
    },
    {
      id: 'N03',
      claim: 'Restricted executor and shared code, method, receiver and network guards',
      mode: 'LIVE_TESTNET',
      tests: ['tests/safety.test.ts', 'tests/worker-safety.test.ts', 'tests/review.test.ts'],
    },
    {
      id: 'N04',
      claim: 'Employees can claim due salary and withdraw independently of the automation pause',
      mode: 'LIVE_TESTNET',
      tests: ['contracts/payroll-vault/src/lib.rs', 'tests/live.test.ts'],
    },
    {
      id: 'N05',
      claim: 'Atomic goal allocation, cash floor and consistent integer rounding',
      mode: 'LIVE_TESTNET',
      tests: [
        'tests/savings.test.ts',
        'tests/fixtures/goal-vectors.json',
        'contracts/payroll-vault/src/lib.rs',
      ],
    },
    {
      id: 'N06',
      claim: 'Finalized journal reconciliation and recovery from an older backup',
      mode: 'LIVE_TESTNET_PROJECTION',
      tests: ['tests/release-recovery.test.ts', 'tests/backups.test.ts'],
    },
    {
      id: 'N07',
      claim: 'An incorrect hash can be corrected; an unknown outcome cannot be blindly resent',
      mode: 'LIVE_TESTNET',
      tests: ['tests/v3-recovery.test.ts', 'tests/rpc.test.ts'],
    },
    {
      id: 'N08',
      claim: 'Nonce-based identity, tenant and role isolation, immediate operator revocation',
      mode: 'TESTNET_AUTH',
      tests: ['tests/auth.test.ts', 'tests/production.test.ts', 'tests/live.test.ts'],
    },
    {
      id: 'N09',
      claim: 'Provider-signed NEAR Intents dry quotes, exact amounts and explicit expiry',
      mode: 'LIVE_READ_ONLY',
      tests: ['tests/intents.test.ts', 'tests/e2e/trust.spec.ts'],
      liveCheck: 'npm run intents:smoke',
    },
    {
      id: 'N10',
      claim:
        'DCA, investing, Earn, loans and Flexible Payday operate only in the labelled simulation book',
      mode: 'SIMULATION',
      tests: ['tests/v1.test.ts', 'tests/e2e/workflows.spec.ts'],
    },
    {
      id: 'N11',
      claim:
        'Assistant proposals require server validation and human confirmation; no model signing tools',
      mode: 'LOCAL_OPTIONAL',
      tests: ['tests/model.test.ts', 'tests/e2e/workflows.spec.ts'],
    },
    {
      id: 'N12',
      claim: 'Desktop, mobile, keyboard and accessibility journeys',
      mode: 'USER_INTERFACE',
      tests: ['tests/e2e/v3-ux.spec.ts', 'tests/e2e/accessibility.spec.ts'],
    },
    {
      id: 'N13',
      claim:
        'Fresh review startup uses an isolated temporary database without automatic signing keys',
      mode: 'LOCAL_REVIEW',
      tests: ['scripts/review-smoke.ts', 'scripts/judge-smoke.ts'],
    },
  ],
  boundaries: [
    'Automated browser tests use fixtures at selected identity and transaction boundaries.',
    'Native Rust tests are not a complete chain sandbox.',
    'Live Intents requests need public provider availability and never submit a swap.',
    'Mainnet money, real investing and lending, TEE and guaranteed returns are not claimed.',
  ],
};
