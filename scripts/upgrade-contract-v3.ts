import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { actionCreators } from '@near-js/transactions';
import bs58 from 'bs58';
import { rpc, viewAt } from '../packages/near-adapter/src/rpc.js';

// This is deliberately specific to the reviewed V2 deployment and small snapshot.
// Stop the local worker/API and back up SQLite before --apply-v2-migration.
const apply = process.argv.includes('--apply-v2-migration');
assert(process.argv.slice(2).every((a) => ['--apply-v2-migration', '--snapshot-only'].includes(a)));
const contractId = process.env.NEAR_CONTRACT_ID!;
assert.equal(contractId, 'noma-vault-mw4ab6ev.testnet');
const previousHash = 'CdMHFFPDjW5NNpEbukL5kyzecb4CTY57Rd24onJ3y7M';
const block = await rpc('block', { finality: 'final' });
const at = block.header.hash;
const accountState = await rpc('query', {
  request_type: 'view_account',
  account_id: contractId,
  block_id: at,
});
assert.equal(
  accountState.code_hash,
  previousHash,
  'Only the reviewed V2 code can be migrated by this script.',
);
const summary = await viewAt(contractId, 'financial_summary', {}, at);
assert.equal(summary.version, 2);
assert(!summary.storageVersion, 'Already migrated');
assert.equal(
  summary.pendingTransfers,
  '0',
  'Wait for all genuine callbacks before this controlled upgrade.',
);
assert(summary.liabilityValid && summary.backingValid);
assert(
  summary.eventCount <= 500 && summary.obligationCount <= 100,
  'Large state requires a separately rehearsed migration.',
);
const state = await rpc('query', {
  request_type: 'view_state',
  account_id: contractId,
  prefix_base64: '',
  block_id: at,
});
const oldCode = await rpc('query', {
  request_type: 'view_code',
  account_id: contractId,
  block_id: at,
});
const suffix = 'v3-' + Date.now();
const backup = 'data/contract-backups/' + suffix;
mkdirSync(backup, { recursive: true });
writeFileSync(backup + '/state.json', JSON.stringify(state));
writeFileSync(backup + '/code.wasm', Buffer.from(oldCode.code_base64, 'base64'));
const stateRecord = state.values.find(
  (v: any) => Buffer.from(v.key, 'base64').toString() === 'STATE',
);
assert(stateRecord);
writeFileSync(backup + '/state.borsh', Buffer.from(stateRecord.value, 'base64'));
writeFileSync(
  backup + '/context.json',
  JSON.stringify({ accountState, summary, block: block.header }, null, 2),
);
const events: any[] = [],
  details: any[] = [];
for (let i = 0; i < summary.eventCount; i += 100) {
  events.push(...(await viewAt(contractId, 'list_events', { from_index: i, limit: 100 }, at)));
  details.push(
    ...(await viewAt(contractId, 'get_event_details', { from_index: i, limit: 100 }, at)),
  );
}
const accounts = new Map<string, any>();
for (const id of new Set<string>(events.map((e) => e.account_id)))
  accounts.set(id, await viewAt(contractId, 'get_account', { account_id: id }, at));
writeFileSync(backup + '/views.json', JSON.stringify({ events, details, accounts: [...accounts] }));
console.log(
  JSON.stringify({
    mode: apply ? 'MIGRATION' : 'SNAPSHOT_ONLY',
    backup,
    eventCount: summary.eventCount,
    stateBytes: Buffer.from(stateRecord.value, 'base64').length,
  }),
);
if (!apply) process.exit(0);
const key = JSON.parse(readFileSync('data/testnet-keys/vault.json', 'utf8'));
assert.equal(key.accountId, contractId);
const wasm = readFileSync(
  'contracts/payroll-vault/target/wasm32-unknown-unknown/release/noma_payroll_vault.wasm',
);
const digest = createHash('sha256').update(wasm).digest();
const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
});
const account = new Account(
  contractId,
  provider,
  new KeyPairSigner(KeyPair.fromString(key.secretKey)),
);
const tx = await account.signAndSendTransaction({
  receiverId: contractId,
  actions: [
    actionCreators.deployContract(wasm),
    actionCreators.functionCall('migrate_from_v2', {}, 250_000_000_000_000n, 0n),
  ],
  waitUntil: 'FINAL',
  throwOnFailure: true,
});
assert.equal(tx.final_execution_status, 'FINAL');
assert(tx.status && typeof tx.status === 'object' && 'SuccessValue' in tx.status);
const afterBlock = await rpc('block', { finality: 'final' });
const afterAt = afterBlock.header.hash;
const after = await viewAt(contractId, 'financial_summary', {}, afterAt);
assert.equal(after.storageVersion, 3);
assert(after.liabilityValid && after.backingValid);
for (const field of [
  'eventCount',
  'obligationCount',
  'companyCount',
  'withdrawalCount',
  'companyTotal',
  'employeeCash',
  'employeeGoals',
  'pendingTransfers',
  'totalLiability',
  'computedLiability',
  'reservations',
])
  assert.deepEqual(after[field], summary[field], 'Migration changed ' + field);
for (let i = 0; i < events.length; i += 100) {
  assert.deepEqual(
    await viewAt(contractId, 'list_events', { from_index: i, limit: 100 }, afterAt),
    events.slice(i, i + 100),
  );
  assert.deepEqual(
    await viewAt(contractId, 'get_event_details', { from_index: i, limit: 100 }, afterAt),
    details.slice(i, i + 100),
  );
}
for (const [id, before] of accounts)
  assert.deepEqual(await viewAt(contractId, 'get_account', { account_id: id }, afterAt), before);
const afterState = await rpc('query', {
  request_type: 'view_account',
  account_id: contractId,
  block_id: afterAt,
});
assert.equal(afterState.code_hash, bs58.encode(digest));
const report = {
  version: '3.0.0',
  status: 'PASS',
  network: 'testnet',
  contractId,
  txHash: tx.transaction.hash,
  checkedAt: new Date().toISOString(),
  previousCodeHash: previousHash,
  codeHash: afterState.code_hash,
  wasmSha256: digest.toString('hex'),
  stateLayoutChanged: true,
  atomicDeployAndMigrate: true,
  beforeBlock: at,
  afterBlock: afterAt,
  preservedEvents: events.length,
  preservedAccountViews: accounts.size,
  preservedFinancialFields: true,
  storageVersion: after.storageVersion,
  gasBurnt: tx.receipts_outcome
    .reduce((s: bigint, r: any) => s + BigInt(r.outcome.gas_burnt), 0n)
    .toString(),
  limitation:
    'Migration evidence applies to this small reviewed snapshot; maximum-size state migration is not claimed.',
};
writeFileSync('docs/v3/CONTRACT_MIGRATION_V3.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
