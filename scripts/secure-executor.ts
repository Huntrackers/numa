import 'dotenv/config';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertTestnet } from '../packages/near-adapter/src/rpc.js';
await assertTestnet();
const contract = process.env.NEAR_CONTRACT_ID!;
if (!contract?.endsWith('.testnet')) throw Error('A NEAR testnet contract is required.');
const original = JSON.parse(readFileSync('data/testnet-keys/executor.json', 'utf8'));
const file = resolve('data/testnet-keys/executor-limited.json');
let limited = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
if (!limited) {
  const key = KeyPair.fromRandom('ed25519');
  limited = {
    accountId: original.accountId,
    publicKey: key.getPublicKey().toString(),
    secretKey: key.toString(),
    limited: true,
    contractId: contract,
  };
  writeFileSync(file, JSON.stringify(limited, null, 2));
}
const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
});
const admin = new Account(
  original.accountId,
  provider,
  new KeyPairSigner(KeyPair.fromString(original.secretKey)),
);
const list: any = await provider.query({
  request_type: 'view_access_key_list',
  account_id: original.accountId,
  finality: 'final',
});
let found = list.keys.find((k: any) => k.public_key === limited.publicKey);
if (!found) {
  await admin.addFunctionCallAccessKey({
    publicKey: limited.publicKey,
    contractId: contract,
    methodNames: ['execute_due'],
    allowance: 500000000000000000000000n,
  });
}
const verified: any = await provider.query({
  request_type: 'view_access_key',
  account_id: original.accountId,
  public_key: limited.publicKey,
  finality: 'final',
});
const permission = verified.permission?.FunctionCall;
if (
  permission?.receiver_id !== contract ||
  permission.method_names.length !== 1 ||
  permission.method_names[0] !== 'execute_due'
)
  throw Error('Executor permission verification failed.');
let env = readFileSync('.env', 'utf8');
const setting = 'NEAR_EXECUTOR_KEY_FILE=' + file.replaceAll('\\', '/');
env = /^NEAR_EXECUTOR_KEY_FILE=.*$/m.test(env)
  ? env.replace(/^NEAR_EXECUTOR_KEY_FILE=.*$/m, setting)
  : env + '\n' + setting + '\n';
writeFileSync('.env', env);
console.log(
  JSON.stringify({
    accountId: limited.accountId,
    contractId: contract,
    methods: permission.method_names,
    allowance: permission.allowance,
    limited: true,
  }),
);
