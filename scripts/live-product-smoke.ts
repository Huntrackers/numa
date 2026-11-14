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
import { waitForSalarySettlement } from './smoke-settlement.js';
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
  checks.push('Two genuine NEP-413 identities');
  const created = await command(owner, 'company.create', {
    name: 'numa live acceptance ' + Date.now().toString(36),
    timezone: 'UTC',
  });
  const c = created.company;
  await apply(owner, created.plan);
  checks.push('Private company creation and NEAR registration');
  const role = await command(
    owner,
    'role.save',
    { name: 'Engineering', salary: '1000000000000000000000', cadence: 'daily' },
    c.id,
  );
  const signedDecisions = (
    await app.inject({ url: '/api/v1/approvals', headers: owner.headers })
  ).json();
  assert.ok(
    signedDecisions.some((proof: any) => proof.action === 'role.save' && proof.state === 'APPLIED'),
  );
  checks.push(
    'Sensitive role metadata requires and records a genuine NEAR NEP-413 decision signature',
  );
  const invited = await command(
    owner,
    'employee.invite',
    {
      name: 'Acceptance employee',
      email: 'acceptance@example.org',
      accountId: employee.accountId,
      roleId: role.id,
      salary: role.salary,
      cadence: 'daily',
      anchor: new Date(Date.now() + 120000).toISOString(),
    },
    c.id,
  );
  await apply(owner, invited.plan);
  await apply(
    employee,
    (await command(employee, 'employee.accept', { token: invited.invitationUrl.split('/').at(-1) }))
      .plan,
  );
  checks.push('Invitation and employee acceptance from ordinary product metadata');
  const funding = (
    await command(owner, 'treasury.fund', { amount: '10000000000000000000000' }, c.id)
  ).plan;
  await apply(owner, funding);
  checks.push('Treasury funding through a verified prepared operation');
  const treasuryBefore = await view(process.env.NEAR_CONTRACT_ID!, 'get_company', {
    company_id: c.chainId,
  });
  let duplicateRejected = false;
  try {
    await owner.account.callFunctionRaw({
      contractId: process.env.NEAR_CONTRACT_ID!,
      methodName: funding.steps[0].method,
      args: funding.steps[0].args,
      deposit: BigInt(funding.steps[0].deposit),
      gas: 100000000000000n,
      waitUntil: 'FINAL',
    });
  } catch {
    duplicateRejected = true;
  }
  assert.equal(duplicateRejected, true);
  const treasuryAfter = await view(process.env.NEAR_CONTRACT_ID!, 'get_company', {
    company_id: c.chainId,
  });
  assert.equal(treasuryAfter.free, treasuryBefore.free);
  checks.push('Duplicate funding operation rejected without a second credit');
  const accountBefore = await view(process.env.NEAR_CONTRACT_ID!, 'get_account', {
    account_id: employee.accountId,
  });
  const names = accountBefore.policy.goals.map((g: any) => ({
    id: g.id,
    name: 'Existing goal',
    target: g.target,
    priority: g.priority,
  }));
  if (names.length < 10) {
    names.push({ name: 'Acceptance savings', target: '500000000000000000000', priority: 1 });
    await apply(
      employee,
      (await command(employee, 'goal.policy', { goalBps: 2500, cashFloor: '0', goals: names }))
        .plan,
    );
  }
  checks.push('Salary-linked atomic goal policy');
  // Set an imminent first payday before authorizing; this remains the ordinary calendar path.
  const e = s.get(invited.employee.id)!;
  s.save({ ...e, anchor: new Date(Date.now() + 60000).toISOString() });
  const payroll = await command(owner, 'payroll.preview', { days: 1 }, c.id);
  await apply(owner, payroll.plan);
  checks.push('Calendar-based full-prefunding mandate');
  const amendment = await command(
    owner,
    'salary.preview',
    {
      selection: 'all',
      kind: 'percent',
      delta: '1000',
      direction: 'increase',
      effectiveFrom: new Date(Date.now() + 1000).toISOString(),
    },
    c.id,
  );
  await apply(owner, amendment.plan);
  checks.push('Role-aware bulk salary amendment replaces a future obligation');
  const amended = await view(process.env.NEAR_CONTRACT_ID!, 'get_obligation', {
    obligation_id: payroll.plan.effects.rows[0].id,
  });
  assert.equal(amended.amount, '1100000000000000000000');
  await apply(
    owner,
    (
      await command(
        owner,
        'payroll.adjust',
        {
          id: amended.id,
          kind: 'bonus',
          amount: '100000000000000000000',
          reason: 'Acceptance bonus',
          expectedVersion: amended.version,
        },
        c.id,
      )
    ).plan,
  );
  checks.push('One-time bonus stays separate from recurring salary');
  console.log('Waiting for a scheduled NEAR payday.');
  const due = Number(BigInt(payroll.plan.effects.rows[0].due_at) / 1000000n);
  if (due > Date.now()) await new Promise((r) => setTimeout(r, due - Date.now() + 1500));
  const settlement = await waitForSalarySettlement(
    s,
    process.env.NEAR_CONTRACT_ID!,
    payroll.plan.effects.rows[0].id,
  );
  const obligation = settlement.obligation;
  assert.equal(obligation.credited, true);
  checks.push('Restricted executor automatically credits salary after reconciliation');
  const after = await view(process.env.NEAR_CONTRACT_ID!, 'get_account', {
    account_id: employee.accountId,
  });
  assert.ok(BigInt(after.cash) > BigInt(accountBefore.cash));
  await tickTestnet(s);
  const twice = await view(process.env.NEAR_CONTRACT_ID!, 'get_account', {
    account_id: employee.accountId,
  });
  assert.equal(twice.cash, after.cash);
  checks.push('Second scan cannot credit the salary twice');
  await apply(
    employee,
    (await command(employee, 'employee.withdraw', { amount: '100000000000000000000' }, undefined))
      .plan,
  );
  checks.push('Employee withdrawal with finalized callback verification');
  const state = await app.inject({
    method: 'GET',
    url: '/api/v1/live/state?scope=company&companyId=' + c.id,
    headers: owner.headers,
  });
  assert.equal(state.statusCode, 200, state.body);
  assert.equal(state.json().employees[0].chain.accepted, true);
  assert.equal(state.json().obligations[0].credited, true);
  checks.push('Ordinary company workspace reads finalized payroll');
  writeFileSync(
    process.env.NUMA_LIVE_SMOKE_REPORT || 'docs/LIVE_PRODUCT_SMOKE.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        network: 'testnet',
        contractId: process.env.NEAR_CONTRACT_ID,
        checks,
        receipts,
        companyId: c.chainId,
        obligationId: obligation.id,
        reconciliation: s.get('chain-sync:' + process.env.NEAR_CONTRACT_ID)?.state,
        settlementObservation: settlement,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'PASSED', checks: checks.length, company: c.chainId }));
} finally {
  await app.close();
  s.close();
}
