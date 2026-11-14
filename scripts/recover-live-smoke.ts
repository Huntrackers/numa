import 'dotenv/config';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../packages/db/src/index.js';
import { selectDue, tickTestnet } from '../apps/worker/src/testnet.js';
import { assertTestnet, confirmOperation, view } from '../packages/near-adapter/src/rpc.js';
import { reconcileChain } from '../packages/near-adapter/src/reconcile.js';
import { hash } from '../packages/domain/src/index.js';
import { waitForSalarySettlement } from './smoke-settlement.js';

// Explicit recovery of a retained smoke database. No company creation, funding,
// replacement mandate or employee withdrawal is possible through this script.
const args = process.argv.slice(2);
const named = (name: string) => args[args.indexOf(name) + 1];
assert.ok(
  args.includes('--db') && args.includes('--obligation') && args.includes('--execute'),
  'Use --db <retained smoke sqlite> --obligation <existing id> --execute',
);
assert.equal(process.env.NEAR_NETWORK || 'testnet', 'testnet');
const dbPath = resolve(named('--db')),
  obligationId = named('--obligation');
assert.ok(existsSync(dbPath), 'The retained smoke database must already exist.');
assert.ok(/^[a-f0-9]{64}$/.test(obligationId), 'An exact existing obligation ID is required.');
const backupPath = join(dirname(dbPath), 'before-recovery-' + Date.now() + '.sqlite');
const original = new DatabaseSync(dbPath, { readOnly: true });
original.prepare('VACUUM INTO ?').run(backupPath);
original.close();
process.env.NEAR_EXECUTOR_KEY_FILE = 'data/testnet-keys/executor-limited.json';
const s = new Store(dbPath),
  contract = process.env.NEAR_CONTRACT_ID!;
const observedAt = new Date().toISOString();
try {
  await assertTestnet();
  const originalObligation = await view(contract, 'get_obligation', {
    obligation_id: obligationId,
  });
  assert.ok(originalObligation, 'The existing obligation must be observable.');
  const company = s
    .list('company')
    .find((c) => c.mode === 'TESTNET' && c.chainId === originalObligation.company_id);
  assert.ok(
    company?.status === 'ACTIVE',
    'The retained smoke company must match the active on-chain obligation.',
  );
  assert.ok(
    s
      .list('live-plan', company.id)
      .some(
        (p) =>
          p.state === 'COMPLETED' &&
          p.steps.some(
            (step: any) =>
              step.method === 'authorize_mandate' &&
              step.args.obligations.some((o: any) => o.id === obligationId),
          ),
      ),
    'The retained database must contain the confirmed authorization for this exact obligation.',
  );
  const verifyDueInventory = async () => {
    const due = await selectDue(s, contract);
    assert.ok(
      due.every((o) => o.id === obligationId && o.company_id === company.chainId),
      'Another company or obligation is due. Stop for explicit review rather than executing unrelated payments.',
    );
  };
  await verifyDueInventory();
  const before = await view(contract, 'get_account', { account_id: originalObligation.account_id });
  const settlement = await waitForSalarySettlement(s, contract, obligationId, {
    timeoutMs: 180000,
    beforeScan: verifyDueInventory,
  });
  const job = s.get('testnet-execute:' + obligationId);
  assert.equal(job?.state, 'CONFIRMED');
  assert.ok(job.txHash, 'Recovery must have an actual executor transaction receipt.');
  const verified = await confirmOperation(job.txHash, process.env.NEAR_EXECUTOR_ACCOUNT!, {
    contractId: contract,
    method: 'execute_due',
    argsHash: hash({ obligation_id: obligationId }),
    deposit: '0',
  });
  assert.equal(verified.state, 'CONFIRMED');
  const after = await view(contract, 'get_account', { account_id: originalObligation.account_id });
  await verifyDueInventory();
  await tickTestnet(s);
  const twice = await view(contract, 'get_account', { account_id: originalObligation.account_id });
  assert.equal(twice.cash, after.cash);
  assert.equal(s.get('testnet-execute:' + obligationId)?.txHash, job.txHash);
  await reconcileChain(s, contract);
  const sync = s.get('chain-sync:' + contract)!;
  assert.equal(sync.state, 'HEALTHY');
  assert.equal(sync.accounting.state, 'VERIFIED');
  const report = {
    checkedAt: new Date().toISOString(),
    startedAt: observedAt,
    network: 'testnet',
    status: 'PASSED',
    purpose:
      'Recovery of the exact retained 3.1 smoke obligation after a pre-broadcast executor-read timeout',
    contractId: contract,
    companyId: company.chainId,
    obligationId,
    originallyCredited: originalObligation.credited,
    amount: originalObligation.amount,
    recoveredCredited: settlement.obligation.credited,
    txHash: job.txHash,
    verifiedExecutorReceipt: verified.state,
    accountCashBefore: before.cash,
    accountCashAfter: after.cash,
    duplicateScanCashUnchanged: twice.cash === after.cash,
    accounting: { state: sync.accounting.state, reconciliation: sync.state, cursor: sync.cursor },
    settlementObservations: settlement.observations,
    noNewCompanyFundingOrMandate: true,
  };
  const reportPath = resolve(
    process.env.NUMA_RECOVERY_REPORT || 'artifacts/live-product-v31-recovery.json',
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: report.status,
      obligationId,
      txHash: job.txHash,
      reconciliation: sync.state,
      accounting: sync.accounting.state,
      reportPath,
      backupPath,
    }),
  );
} finally {
  s.close();
}
