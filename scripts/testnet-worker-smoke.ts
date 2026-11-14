import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { Store } from '../packages/db/src/index.js';
import { buildApp } from '../apps/api/src/server.js';
import { tickTestnet } from '../apps/worker/src/testnet.js';
import { view } from '../packages/near-adapter/src/rpc.js';
const deploy = JSON.parse(readFileSync('docs/TESTNET_DEPLOYMENT.json', 'utf8'));
const prior = JSON.parse(readFileSync('docs/TESTNET_SMOKE.json', 'utf8'));
process.env.NEAR_CONTRACT_ID = deploy.contractId;
process.env.NEAR_EXECUTOR_ACCOUNT = deploy.executor;
process.env.NEAR_EXECUTOR_KEY_FILE = 'data/testnet-keys/executor-limited.json';
process.env.NEAR_RPC_URL = 'https://test.rpc.fastnear.com';
process.env.LOG_LEVEL = 'silent';
const key = JSON.parse(readFileSync('data/testnet-keys/owner.json', 'utf8'));
const signer = new KeyPairSigner(KeyPair.fromString(key.secretKey));
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL });
const owner = new Account(key.accountId, provider, signer);
const s = new Store(join(mkdtempSync(join(tmpdir(), 'noma-live-')), 'db.sqlite'));
const app = await buildApp(s);
const headers: any = { origin: 'http://localhost:80', host: 'localhost' };
try {
  const c = (
    await app.inject({ method: 'POST', url: '/api/v1/auth/challenges', headers, payload: {} })
  ).json();
  const proof = await signer.signNep413Message(
    c.message,
    key.accountId,
    c.recipient,
    Buffer.from(c.nonce, 'base64'),
    c.callbackUrl,
  );
  const auth = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify',
    headers,
    payload: {
      challengeId: c.id,
      accountId: proof.accountId,
      publicKey: proof.publicKey.toString(),
      signature: Buffer.from(proof.signature).toString('base64'),
    },
  });
  assert.equal(auth.statusCode, 200, auth.body);
  headers.cookie = auth.headers['set-cookie']!.toString().split(';')[0];
  headers['x-csrf-token'] = auth.json().csrf;
  console.log('Verified real NEP-413 account against live testnet access keys.');
  const context = await app.inject({ method: 'GET', url: '/api/v1/chain/context', headers });
  assert.equal(context.statusCode, 200);
  assert.equal(context.json().accountId, key.accountId);
  assert.equal(context.json().error, null);
  assert.ok(context.json().companies.length > 0);
  console.log('Loaded company treasury from finalized testnet state.');
  const preview = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/payroll-preview',
    headers,
    payload: {
      companyId: prior.company,
      employeeId: 'employee',
      scheduleId: 'automatic-' + Date.now().toString(36),
      cadence: 'daily',
      amount: '1000000000000000000000',
      anchor: new Date(Date.now() + 20000).toISOString(),
      timezone: 'UTC',
      days: 1,
    },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  const p = preview.json();
  assert.equal(p.rows.length, 1);
  const prepared = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/prepare',
    headers,
    payload: p.transaction,
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  const op = prepared.json();
  const tx = await owner.callFunctionRaw({
    contractId: deploy.contractId,
    methodName: op.method,
    args: op.args,
    gas: 100_000_000_000_000n,
    waitUntil: 'FINAL',
  });
  const confirmed = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers,
    payload: { operationId: op.id, txHash: tx.transaction.hash },
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().state, 'CONFIRMED');
  console.log('Verified a real calendar mandate through the API.');
  await new Promise((r) =>
    setTimeout(
      r,
      Math.max(
        0,
        new Date(Number(BigInt(p.rows[0].due_at) / 1000000n)).getTime() - Date.now() + 1500,
      ),
    ),
  );
  await tickTestnet(s);
  const obligation = await view(deploy.contractId, 'get_obligation', {
    obligation_id: p.rows[0].id,
  });
  assert.ok(obligation.credited);
  const job = s.get('testnet-execute:' + obligation.id)!;
  assert.equal(job.state, 'CONFIRMED');
  await tickTestnet(s);
  const jobs = s.list('chain-job');
  assert.equal(jobs.length, 1);
  writeFileSync(
    'docs/TESTNET_WORKER_SMOKE.json',
    JSON.stringify(
      {
        network: 'testnet',
        contractId: deploy.contractId,
        checkedAt: new Date().toISOString(),
        checks: [
          'Real NEP-413 full-access-key verification',
          'Finalized company context',
          'Stable calendar preview',
          'Strict prepared operation',
          'Final transaction reconciliation',
          'Automatic executor settlement',
          'Second worker scan does not repay',
        ],
        authorizationHash: tx.transaction.hash,
        executionHash: job.txHash,
        obligationId: obligation.id,
      },
      null,
      2,
    ),
  );
  console.log('LIVE API + CALENDAR + AUTOMATIC WORKER SMOKE PASSED');
} finally {
  await app.close();
  s.close();
}
