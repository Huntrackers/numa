import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });
const manifest = JSON.parse(readFileSync('docs/TESTNET_DEPLOYMENT.json', 'utf8'));
const contract = manifest.contractId;
const account = (kind: string) => {
  const r = JSON.parse(readFileSync('data/testnet-keys/' + kind + '.json', 'utf8'));
  return new Account(r.accountId, provider, new KeyPairSigner(KeyPair.fromString(r.secretKey)));
};
const owner = account('owner'),
  employee = account('employee'),
  executor = account('executor');
const NEAR = 10n ** 24n;
const company = 'smoke-' + Date.now().toString(36);
const salary = NEAR / 100n;
const checks: any[] = [];
const txs: any[] = [];
async function call(a: Account, methodName: string, args: any, deposit = 0n) {
  const r = await a.callFunctionRaw({
    contractId: contract,
    methodName,
    args,
    deposit,
    gas: 100_000_000_000_000n,
    waitUntil: 'FINAL',
  });
  for (const o of [r.transaction_outcome, ...r.receipts_outcome])
    assert.ok(
      !(typeof o.outcome.status === 'object' && 'Failure' in o.outcome.status),
      'Receipt failure ' + methodName,
    );
  assert.ok(!(typeof r.status === 'object' && 'Failure' in r.status));
  txs.push({ method: methodName, signer: a.accountId, hash: r.transaction.hash });
  console.log('Confirmed:', methodName, r.transaction.hash);
  return r;
}
async function view(methodName: string, args: any) {
  const r: any = await provider.query({
    request_type: 'call_function',
    account_id: contract,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'final',
  });
  return JSON.parse(Buffer.from(r.result).toString());
}
async function reject(a: Account, method: string, args: any) {
  try {
    await call(a, method, args);
    throw Error('Unexpected success');
  } catch (e: any) {
    assert.ok(!String(e).includes('Unexpected success'));
    checks.push({ check: method + ' rejects unauthorized or unfunded request', passed: true });
  }
}
const status = await provider.status();
assert.equal(status.chain_id, 'testnet');
await call(owner, 'register_company', { company_id: company, operation_id: company });
await call(owner, 'register_employee', {
  company_id: company,
  employee_id: 'employee',
  account_id: employee.accountId,
});
await call(employee, 'accept_employment', { company_id: company, employee_id: 'employee' });
await reject(employee, 'withdraw_company_surplus', {
  company_id: company,
  amount: '1',
  operation_id: 'attack-' + company,
});
await call(owner, 'fund_treasury', { company_id: company }, NEAR / 10n);
await call(employee, 'set_goal_policy', {
  goal_bps: 4000,
  cash_floor: '0',
  expected_version: 0,
  goals: [
    {
      id: 'reserve',
      target: (NEAR / 100n).toString(),
      funded: '0',
      priority: 1,
      paused: false,
      completed: false,
      released: false,
    },
  ],
});
const due = BigInt(Date.now() + 16000) * 1000000n;
const obligation = 'salary-' + company;
await call(owner, 'authorize_mandate', {
  company_id: company,
  obligations: [
    { id: obligation, employee_id: 'employee', amount: salary.toString(), due_at: due.toString() },
  ],
  execution_not_after: (due + 3600n * 1000000000n).toString(),
});
let c = await view('get_company', { company_id: company });
assert.equal(c.reserved, salary.toString());
checks.push({ check: 'Salary fully reserved', passed: true });
await reject(owner, 'withdraw_company_surplus', {
  company_id: company,
  amount: (NEAR / 10n).toString(),
  operation_id: 'locked-' + company,
});
await call(owner, 'pause_mandate', { obligation_id: obligation, paused: true });
await new Promise((r) => setTimeout(r, Math.max(0, Number(due / 1000000n) - Date.now() + 2000)));
await call(employee, 'claim_due', { obligation_id: obligation });
let state = await view('get_account', { account_id: employee.accountId });
assert.equal(state.cash, ((salary * 60n) / 100n).toString());
assert.equal(state.policy.goals[0].funded, ((salary * 40n) / 100n).toString());
checks.push({ check: 'Employee claims paused salary and goals allocate atomically', passed: true });
await call(employee, 'claim_due', { obligation_id: obligation });
let repeat = await view('get_account', { account_id: employee.accountId });
assert.equal(repeat.cash, state.cash);
checks.push({ check: 'Duplicate claim never credits twice', passed: true });
await reject(employee, 'request_withdrawal', {
  amount: salary.toString(),
  operation_id: 'over-' + company,
});
const withdrawal = 'withdraw-' + company;
await call(employee, 'request_withdrawal', {
  amount: (salary / 10n).toString(),
  operation_id: withdrawal,
});
let w = await view('get_withdrawal', { operation_id: withdrawal });
assert.equal(w.state, 'SUCCEEDED');
checks.push({ check: 'Withdrawal callback finalized successfully', passed: true });
state = await view('get_account', { account_id: employee.accountId });
await call(employee, 'release_goal', {
  goal_id: 'reserve',
  expected_version: state.policy.version,
});
state = await view('get_account', { account_id: employee.accountId });
assert.equal(state.cash, ((salary * 9n) / 10n).toString());
checks.push({ check: 'Employee releases goal to own free cash', passed: true });
c = await view('get_company', { company_id: company });
assert.equal(c.reserved, '0');
checks.push({ check: 'Company reserved balance reaches zero after settlement', passed: true });
writeFileSync(
  'docs/TESTNET_SMOKE.json',
  JSON.stringify(
    {
      network: 'testnet',
      contractId: contract,
      company,
      checkedAt: new Date().toISOString(),
      checks,
      transactions: txs,
    },
    null,
    2,
  ),
);
console.log('LIVE TESTNET SMOKE PASSED', checks.length);
