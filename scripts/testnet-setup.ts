import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { actionCreators } from '@near-js/transactions';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const keyDir = resolve('data/testnet-keys');
mkdirSync(keyDir, { recursive: true });
const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });
const manifestPath = resolve('data/testnet-keys/accounts.json');
let manifest: any = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const suffix = manifest.suffix || Date.now().toString(36);
manifest.suffix = suffix;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
async function get(kind: string) {
  let rec = manifest[kind];
  if (!rec) {
    const key = KeyPair.fromRandom('ed25519');
    rec = {
      accountId: 'noma-' + kind + '-' + suffix + '.testnet',
      publicKey: key.getPublicKey().toString(),
      secretKey: key.toString(),
    };
    writeFileSync(resolve(keyDir, kind + '.json'), JSON.stringify(rec, null, 2));
    manifest[kind] = { accountId: rec.accountId, keyFile: kind + '.json' };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } else rec = JSON.parse(readFileSync(resolve(keyDir, rec.keyFile), 'utf8'));
  const account = new Account(
    rec.accountId,
    provider,
    new KeyPairSigner(KeyPair.fromString(rec.secretKey)),
  );
  let exists = true;
  try {
    await account.getState();
  } catch {
    exists = false;
  }
  if (!exists) {
    const r = await fetch('https://helper.testnet.near.org/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newAccountId: rec.accountId, newAccountPublicKey: rec.publicKey }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok)
      throw new Error('Testnet faucet rejected ' + kind + ': ' + r.status + ' ' + (await r.text()));
    console.log('Faucet account created:', rec.accountId);
  }
  return account;
}
const deployment = await get('vault');
const owner = await get('owner');
const employee = await get('employee');
const executor = await get('executor');
console.log(
  'Accounts ready:',
  [deployment, owner, employee, executor].map((a) => a.accountId),
);
if (process.argv.includes('--accounts-only')) process.exit(0);
const wasm = readFileSync(
  'contracts/payroll-vault/target/wasm32-unknown-unknown/release/noma_payroll_vault.wasm',
);
const initialized = await provider
  .query({
    request_type: 'view_state',
    account_id: deployment.accountId,
    prefix_base64: 'U1RBVEU=',
    finality: 'final',
  })
  .then((r: any) => r.values.length > 0)
  .catch((error) => {
    throw new Error('Unable to establish whether the vault is initialized.', { cause: error });
  });
if (initialized)
  throw new Error(
    'Existing contract state detected. Use a reviewed atomic migration; setup never overwrites an initialized vault.',
  );
// A fresh vault must never expose deployed code before its owner-selected executor
// is initialized. Both actions commit or roll back in the same receipt.
const deploy = await deployment.signAndSendTransaction({
  receiverId: deployment.accountId,
  actions: [
    actionCreators.deployContract(wasm),
    actionCreators.functionCall('new', { executor: executor.accountId }, 100_000_000_000_000n, 0n),
  ],
  waitUntil: 'FINAL',
  throwOnFailure: true,
});
console.log(
  'Contract deployed and initialized atomically:',
  deployment.accountId,
  deploy.transaction.hash,
);
const config = {
  network: 'testnet',
  contractId: deployment.accountId,
  owner: owner.accountId,
  employee: employee.accountId,
  executor: executor.accountId,
  deployedAt: new Date().toISOString(),
  deploymentHash: deploy.transaction.hash,
};
writeFileSync('docs/TESTNET_DEPLOYMENT.json', JSON.stringify(config, null, 2));
console.log('Deployment manifest written without secret keys.');
