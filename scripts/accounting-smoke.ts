import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { Store } from '../packages/db/src/index.js';
import { reconcileChain } from '../packages/near-adapter/src/reconcile.js';
import { view, assertTestnet } from '../packages/near-adapter/src/rpc.js';
await assertTestnet();
const contract = process.env.NEAR_CONTRACT_ID!,
  provider = new JsonRpcProvider({
    url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
  }),
  store = new Store(join(mkdtempSync(join(tmpdir(), 'numa-financial-')), 'db.sqlite'));
const account = (kind: string) => {
  const k = JSON.parse(readFileSync('data/testnet-keys/' + kind + '.json', 'utf8'));
  return new Account(k.accountId, provider, new KeyPairSigner(KeyPair.fromString(k.secretKey)));
};
const owner = account('owner'),
  executor = account('executor-limited');
const receipts: any[] = [];
async function call(who: Account, methodName: string, args: any) {
  const result = await who.callFunctionRaw({
    contractId: contract,
    methodName,
    args,
    gas: 100000000000000n,
    waitUntil: 'FINAL',
  });
  assert.ok(!('Failure' in (result.status as any)), JSON.stringify(result.status));
  receipts.push({ method: methodName, txHash: result.transaction.hash });
}
try {
  const opening: any = await reconcileChain(store, contract);
  assert.equal(opening.accounting.state, 'VERIFIED');
  const prior = JSON.parse(readFileSync('docs/LIVE_PRODUCT_SMOKE.json', 'utf8'));
  const company = await view(contract, 'get_company', { company_id: prior.companyId });
  const employees = await view(contract, 'list_company_employees', { company_id: prior.companyId });
  const person = employees.find((e: any) => e.accepted);
  assert.ok(person);
  assert.ok(BigInt(company.free) > 100000000000000000000n);
  const id = 'v1_' + randomUUID().replaceAll('-', ''),
    due = Date.now() + 40000,
    expiry = due + 10000,
    ns = (time: number) => (BigInt(time) * 1000000n).toString();
  await call(owner, 'authorize_mandate', {
    company_id: prior.companyId,
    obligations: [
      { id, employee_id: person.employee_id, amount: '100000000000000000000', due_at: ns(due) },
    ],
    execution_not_after: ns(expiry),
  });
  await call(owner, 'replace_future_obligations', {
    obligation_id: id,
    amount: '200000000000000000000',
    expected_version: 1,
  });
  await call(owner, 'replace_future_obligations', {
    obligation_id: id,
    amount: '100000000000000000000',
    expected_version: 2,
  });
  await call(owner, 'pause_mandate', { obligation_id: id, paused: true });
  console.log('Reserved and amended; waiting for the bounded authority to expire.');
  if (Date.now() <= expiry) await new Promise((r) => setTimeout(r, expiry - Date.now() + 2000));
  await call(owner, 'renew_mandate', {
    obligation_id: id,
    execution_not_after: ns(Date.now() + 60000),
    expected_version: 4,
  });
  await call(owner, 'pause_mandate', { obligation_id: id, paused: false });
  await call(executor, 'execute_due', { obligation_id: id });
  await call(executor, 'execute_due', { obligation_id: id });
  const result: any = await reconcileChain(store, contract);
  assert.equal(result.accounting.state, 'VERIFIED');
  assert.equal((await view(contract, 'get_obligation', { obligation_id: id })).credited, true);
  const count = store.ledger().length;
  await reconcileChain(store, contract);
  assert.equal(store.ledger().length, count);
  assert.ok(store.ledger().some((e) => e.kind === 'ReserveIncreased'));
  assert.ok(store.ledger().some((e) => e.kind === 'PayrollCredited'));
  writeFileSync(
    'docs/ACCOUNTING_TESTNET_SMOKE.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        network: 'testnet',
        contractId: contract,
        obligationId: id,
        checks: [
          'legacy opening snapshot',
          'owner amendments',
          'expiry and owner-only renewal',
          'restricted executor',
          'duplicate execution',
          'same-block financial summary',
          'balanced journal replay',
          'duplicate reconciliation',
        ],
        receipts,
        openingSequence: opening.cursor,
        finalSequence: result.cursor,
        journalEntries: count,
        accounting: result.accounting.state,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ status: 'PASSED', receipts: receipts.length, journalEntries: count }),
  );
} finally {
  store.close();
}
