import { release } from '../../../packages/domain/src/release.js';
import type { FastifyInstance } from 'fastify';
import { Store } from '../../../packages/db/src/index.js';
import {
  observeContract,
  policyDrills,
  reviewedDeployment,
} from '../../../packages/near-adapter/src/safety.js';
import { ReadOnlyIntents } from './intents.js';
import { reviewClaims } from './claims.js';
export async function publicEvidence(s: Store) {
  const contractId = process.env.NEAR_CONTRACT_ID || null;
  let contract: any = null;
  if (contractId)
    try {
      const o = await observeContract(s);
      contract = {
        contractId: o.contractId,
        expectedCodeHash: o.expectedCodeHash || null,
        observedCodeHash: o.observedCodeHash,
        codeMatches: !!o.expectedCodeHash && o.expectedCodeHash === o.observedCodeHash,
        observedAt: o.observedAt,
        blockHeight: o.blockHeight,
        blockHash: o.blockHash,
      };
    } catch {
      contract = { contractId, status: 'UNAVAILABLE', codeMatches: false };
    }
  const worker = s.get('testnet-worker-heartbeat'),
    sync = s.get('chain-sync:' + contractId),
    now = Date.now();
  const fresh = !!worker && now - Date.parse(worker.lastSeen) < 120000;
  const syncFresh = !!sync?.lastSuccessAt && now - Date.parse(sync.lastSuccessAt) < 120000;
  return {
    product: 'numa',
    version: release.version,
    observedAt: new Date().toISOString(),
    network: 'testnet',
    contract,
    worker: {
      state: fresh ? worker.state : 'NOT_OBSERVED',
      fresh,
      restrictedMethods: worker?.key?.limited ? worker.key.methods : [],
      gasSponsorship:
        'The executor pays testnet gas for scheduled execute_due calls. Interactive employee wallet actions still require their own gas.',
    },
    accounting: {
      state: syncFresh ? sync.accounting?.state || 'UNKNOWN' : 'NOT_OBSERVED',
      syncState: sync?.state || 'NOT_OBSERVED',
      fresh: syncFresh,
      lastSuccessAt: sync?.lastSuccessAt || null,
      eventCursor: sync?.cursor ?? null,
    },
    capabilities: [
      {
        feature: 'Salary settlement and savings',
        mode: 'LIVE_TESTNET',
        description: 'NEAR contract reserves payroll and allocates savings in the same call.',
      },
      {
        feature: 'Cross-chain route previews',
        mode: 'LIVE_READ_ONLY',
        description:
          'Signed 1Click dry quotes. No mainnet transaction or deposit address is created.',
      },
      {
        feature: 'Investing, DCA, Earn and loans',
        mode: 'SIMULATION',
        description: 'An independent demoUSD planning ledger. No real returns or lending.',
      },
      {
        feature: 'Assistant proposals',
        mode: 'LOCAL_OPTIONAL',
        description: 'Typed proposals with server validation; the model has no signing tools.',
      },
    ],
    reviewedDeployment,
    proofs: [
      {
        label: 'V3 atomic storage migration',
        hash: '9pktZBWMC3Uu85E5oMBsNW5B9DQ8m8d6am9bBQdYihrB',
      },
      {
        label: 'Accounting contract upgrade',
        hash: 'BbuW2TFcCHLsw5EMCzuPskwmywjFVtUNkRWTESMKQwbo',
      },
      { label: 'Scheduled salary execution', hash: '5rVEcXSHkmR2XsWPDr5U13Auzjp8oBzojJmLk2gvJXVk' },
      {
        label: 'Duplicate execution checked',
        hash: '4D3wsKzySZ1QGVFLcBTBCjNbFg42muoTZprhon6tLKvR',
      },
    ].map((p) => ({
      ...p,
      evidence:
        'Recorded successful testnet smoke; inspect the public explorer for independent confirmation.',
      url: 'https://testnet.nearblocks.io/txns/' + p.hash,
    })),
    limits: {
      maximumCompanies: 30,
      employeesPerCompany: 50,
      obligationsPerBatch: 20,
      authorizationDays: 31,
      mainnetTransactions: false,
      stablecoinSettlement: false,
      independentAudit: false,
    },
  };
}
export function registerReviewRoutes(
  app: FastifyInstance,
  s: Store,
  intents = new ReadOnlyIntents(),
) {
  app.get('/api/v1/review/claims', (_req, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="numa-review-claims.json"');
    return reviewClaims;
  });
  app.get(
    '/api/v1/review/evidence',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    () => publicEvidence(s),
  );
  app.get('/api/v1/review/policy-lab', () => ({
    mode: 'DETERMINISTIC_POLICY_DRILL',
    cases: policyDrills(),
    fundsMoved: false,
  }));
  app.get(
    '/api/v1/intents/tokens',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async () => ({
      provider: 'NEAR Intents / 1Click',
      mode: 'LIVE_READ_ONLY',
      tokens: await intents.tokens(),
    }),
  );
  app.post(
    '/api/v1/intents/preview',
    { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    (req) => intents.preview(req.body),
  );
}
