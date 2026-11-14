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
import { buildApp } from '../apps/api/src/server.js';
import { tickTestnet } from '../apps/worker/src/testnet.js';
import { view } from '../packages/near-adapter/src/rpc.js';
process.env.LOG_LEVEL = 'silent';
process.env.NEAR_EXECUTOR_KEY_FILE = 'data/testnet-keys/executor-limited.json';
const provider = new JsonRpcProvider({
    url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
  }),
  s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-product-live-')), 'db.sqlite')),
  app = await buildApp(s);
const checks: string[] = [],
  receipts: any[] = [];
async function identity(kind: string) {
  const key = JSON.parse(readFileSync('data/testnet-keys/' + kind + '.json', 'utf8')),
    signer = new KeyPairSigner(KeyPair.fromString(key.secretKey));
  const account = new Account(key.accountId, provider, signer);
  const headers: any = { origin: 'http://localhost:80', host: 'localhost' };
  const challenge = (
    await app.inject({ method: 'POST', url: '/api/v1/auth/challenges', headers, payload: {} })
  ).json();
  const proof = await signer.signNep413Message(
    challenge.message,
    key.accountId,
    challenge.recipient,
    Buffer.from(challenge.nonce, 'base64'),
    challenge.callbackUrl,
  );
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify',
    headers,
    payload: {
      challengeId: challenge.id,
      accountId: proof.accountId,
      publicKey: proof.publicKey.toString(),
      signature: Buffer.from(proof.signature).toString('base64'),
    },
  });
  assert.equal(result.statusCode, 200, result.body);
  headers.cookie = result.headers['set-cookie']!.toString().split(';')[0];
  headers['x-csrf-token'] = result.json().csrf;
  return { account, signer, headers, accountId: key.accountId };
}
async function post(who: any, url: string, payload: any) {
  const headers = { ...who.headers, 'idempotency-key': randomUUID() };
  let r = await app.inject({
    method: 'POST',
    url: '/api/v1' + url,
    headers,
    payload,
  });
  if (r.statusCode === 428 && r.json().code === 'APPROVAL_REQUIRED') {
    const c = r.json().approval;
    const proof = await who.signer.signNep413Message(
      c.message,
      who.accountId,
      c.recipient,
      Buffer.from(c.nonce, 'base64'),
    );
    r = await app.inject({
      method: 'POST',
      url: '/api/v1' + url,
      payload,
      headers: {
        ...headers,
        'x-numa-approval': Buffer.from(
          JSON.stringify({
            challengeId: c.id,
            accountId: proof.accountId,
            publicKey: proof.publicKey.toString(),
            signature: Buffer.from(proof.signature).toString('base64'),
          }),
        ).toString('base64url'),
      },
    });
  }
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const command = (who: any, action: string, payload: any, companyId?: string) =>
  post(who, '/live/commands', { action, payload, ...(companyId ? { companyId } : {}) });
async function apply(who: any, plan: any) {
  for (let index = 0; index < plan.steps.length; index++) {
    const op = await post(who, '/live/prepare', { planId: plan.id, index });
    if (op.local) continue;
    await post(who, '/live/dispatch', { operationId: op.operationId });
    const result = await who.account.callFunctionRaw({
      contractId: op.contractId,
      methodName: op.method,
      args: op.args,
      deposit: BigInt(op.deposit),
      gas: 100000000000000n,
      waitUntil: 'FINAL',
    });
    await post(who, '/live/confirm', {
      operationId: op.operationId,
      txHash: result.transaction.hash,
    });
    receipts.push({ method: op.method, txHash: result.transaction.hash });
  }
}
try {
  const owner = await identity('owner'),
    employee = await identity('employee');
  const contractId = process.env.NEAR_CONTRACT_ID!;
  const original = await view(contractId, 'get_account', { account_id: employee.accountId });
  const prior = JSON.parse(readFileSync('docs/LIVE_PRODUCT_SMOKE.json', 'utf8'));
  const employment = (
    await view(contractId, 'list_company_employees', { company_id: prior.companyId })
  ).find((e: any) => e.account_id === employee.accountId);
  assert.ok(employment?.accepted);
  function inputs(account: any) {
    return account.policy.goals.map((g: any) => {
      const r = account.goalRules?.find((r: any) => r.id === g.id);
      return {
        id: g.id,
        name: 'Existing testnet savings',
        target: g.target,
        priority: g.priority,
        contributionMode: r?.contribution_mode || 'PERCENT',
        contributionValue: r?.contribution_value || '10000',
        percentBasis: r?.percent_basis || 'GOAL_BUDGET',
        overflow: r?.overflow || 'NEXT',
        targetDate: r?.target_date || null,
        state:
          r?.state || (g.completed ? 'COMPLETED' : g.paused || g.released ? 'PAUSED' : 'ACTIVE'),
        confirmChanges: true,
      };
    });
  }
  const savedInputs = inputs(original);
  assert.ok(savedInputs.length < 10, 'Dedicated test wallet reached its goal-history cap.');
  const goals = savedInputs.map((g: any) => ({
    ...g,
    state: g.state === 'ACTIVE' ? 'PAUSED' : g.state,
  }));
  goals.push({
    name: 'Savings v2 acceptance',
    target: '600000000000000000000',
    priority: 1,
    contributionMode: 'FIXED',
    contributionValue: '200000000000000000000',
    percentBasis: 'GOAL_BUDGET',
    overflow: 'CASH',
    targetDate: '2026-12-01',
    state: 'ACTIVE',
    confirmChanges: true,
  });
  await apply(
    employee,
    (await command(employee, 'goal.policy', { goalBps: 5000, cashFloor: '0', goals })).plan,
  );
  const configured = await view(contractId, 'get_account', { account_id: employee.accountId });
  const id = configured.policy.goals.find(
    (g: any) => !original.policy.goals.some((o: any) => o.id === g.id),
  ).id;
  assert.equal(configured.goalRules.find((g: any) => g.id === id).contribution_mode, 'FIXED');
  checks.push(
    'Authenticated v2 savings policy keeps existing reserves and stores explicit contribution basis',
  );
  const oid = 'savings_v2_' + randomUUID().replaceAll('-', '');
  const due = Date.now() + 12000;
  const auth = await owner.account.callFunctionRaw({
    contractId,
    methodName: 'authorize_mandate',
    args: {
      company_id: prior.companyId,
      obligations: [
        {
          id: oid,
          employee_id: employment.employee_id,
          amount: '1000000000000000000000',
          due_at: (BigInt(due) * 1000000n).toString(),
        },
      ],
      execution_not_after: (BigInt(due + 60000) * 1000000n).toString(),
    },
    gas: 100000000000000n,
    waitUntil: 'FINAL',
  });
  receipts.push({ method: 'authorize_mandate', txHash: auth.transaction.hash });
  if (Date.now() < due) await new Promise((r) => setTimeout(r, due - Date.now() + 1500));
  await apply(employee, (await command(employee, 'payroll.claim', { id: oid })).plan);
  const credited = await view(contractId, 'get_account', { account_id: employee.accountId });
  assert.equal(credited.policy.goals.find((g: any) => g.id === id).funded, '200000000000000000000');
  assert.equal(BigInt(credited.cash) - BigInt(configured.cash), 800000000000000000000n);
  checks.push(
    'Real salary atomically reserves the fixed amount and credits exactly the remaining cash',
  );
  await apply(employee, (await command(employee, 'goal.release', { id })).plan);
  const released = await view(contractId, 'get_account', { account_id: employee.accountId });
  assert.equal(released.policy.goals.find((g: any) => g.id === id).funded, '0');
  assert.equal(released.goalRules.find((g: any) => g.id === id).state, 'PAUSED');
  assert.equal(BigInt(released.cash) - BigInt(credited.cash), 200000000000000000000n);
  checks.push('Release returns only the reserve to cash and keeps future contributions paused');
  const reactivated = inputs(released).map((g: any) =>
    g.id === id ? { ...g, state: 'ACTIVE' } : g,
  );
  const denied = await app.inject({
    method: 'POST',
    url: '/api/v1/live/commands',
    headers: { ...employee.headers, 'idempotency-key': randomUUID() },
    payload: {
      action: 'goal.policy',
      payload: {
        goalBps: 5000,
        cashFloor: '0',
        goals: reactivated.map((g: any) => ({ ...g, confirmChanges: false })),
      },
    },
  });
  assert.equal(denied.json().code, 'REACTIVATION_REQUIRED');
  await apply(
    employee,
    (await command(employee, 'goal.policy', { goalBps: 5000, cashFloor: '0', goals: reactivated }))
      .plan,
  );
  checks.push('Closed savings require explicit consent before reactivation');
  const final = await view(contractId, 'get_account', { account_id: employee.accountId });
  const newGoal = inputs(final).find((g: any) => g.id === id);
  await apply(
    employee,
    (
      await command(employee, 'goal.policy', {
        goalBps: original.policy.goal_bps,
        cashFloor: original.policy.cash_floor,
        goals: [...savedInputs, { ...newGoal, state: 'ARCHIVED' }],
      })
    ).plan,
  );
  checks.push('Original policy restored while the acceptance goal remains archived in history');
  writeFileSync(
    'docs/SAVINGS_TESTNET_SMOKE.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        network: 'testnet',
        contractId,
        checks,
        receipts,
        obligationId: oid,
        goalId: id,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'PASSED', checks: checks.length }));
} finally {
  await app.close();
  s.close();
}
