import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { release } from '../packages/domain/src/release.js';

const timer = performance.now();
const probe = createServer();
await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((r, reject) => probe.close((e) => (e ? reject(e) : r())));
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/judge.ts')], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REVIEW_PORT: String(port),
    NEAR_EXECUTOR_KEY_FILE: 'MUST_NOT_BE_OPENED',
    NEAR_EXECUTOR_ACCOUNT: 'must-not-load.testnet',
  },
});
let childOutput = '';
child.stdout.on('data', (b) => {
  childOutput += b;
});
child.stderr.on('data', (b) => {
  childOutput += b;
});
const checks: { id: string; status: 'PASS'; detail: string }[] = [];
const record = (id: string, detail: string) => checks.push({ id, status: 'PASS', detail });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string, cookie = '') {
  const r = await fetch(base + '/api/v1' + path, {
    headers: { cookie },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(r.status, 200, path + ' did not return 200');
  return r.json();
}
async function login(userId: string) {
  const r = await fetch(base + '/api/v1/auth/demo', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  assert.equal(r.status, 200);
  const { csrf } = (await r.json()) as any;
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return { cookie, csrf };
}
async function command(
  actor: { cookie: string; csrf: string },
  action: string,
  payload: unknown,
  key = randomUUID(),
  expected = 200,
) {
  const r = await fetch(base + '/api/v1/commands', {
    method: 'POST',
    headers: {
      origin: base,
      'content-type': 'application/json',
      cookie: actor.cookie,
      'x-csrf-token': actor.csrf,
      'idempotency-key': key,
    },
    body: JSON.stringify({ companyId: 'forma', action, payload }),
  });
  const result = await r.json();
  assert.equal(r.status, expected, action + ': ' + JSON.stringify(result));
  return result as any;
}
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw Error('Review process exited before startup.');
    try {
      ready = (await get('/health')).version === release.version;
    } catch {}
    if (ready) break;
    await pause(200);
  }
  assert.ok(ready, 'The documented review process did not start.');
  const startupMs = Math.round(performance.now() - timer);
  record('startup', 'Fresh temporary database, loopback HTTP and current product version.');
  const config = await get('/config');
  assert.equal(config.demoEnabled, true);
  assert.equal(config.mainnetEnabled, false);
  assert.ok(!childOutput.includes('MUST_NOT_BE_OPENED'));
  record('isolation', 'Automatic signing settings are removed by the review launcher.');
  const owner = await login('owner');
  const before = await get('/state?scope=company&companyId=forma', owner.cookie);
  assert.equal(before.obligations.length, 0);
  assert.equal(before.company.name, 'Forma Studio');
  const preview = await command(owner, 'preview.create', {
    kind: 'payroll',
    input: { accelerated: true, days: 30 },
  });
  const untouched = await get('/state?scope=company&companyId=forma', owner.cookie);
  assert.equal(untouched.obligations.length, 0);
  assert.equal(untouched.ledger.length, before.ledger.length);
  record('preview', 'Payroll preview leaves balances and obligations unchanged.');
  const idempotency = randomUUID();
  const applied = await command(owner, 'preview.apply', { previewId: preview.id }, idempotency);
  assert.deepEqual(
    await command(owner, 'preview.apply', { previewId: preview.id }, idempotency),
    applied,
  );
  record('idempotency', 'Replaying the same authorization returns the recorded result.');
  let paid: any;
  for (let n = 0; n < 100; n++) {
    paid = await get('/state?scope=company&companyId=forma', owner.cookie);
    if (paid.obligations.length === 5 && paid.obligations.every((o: any) => o.state === 'CREDITED'))
      break;
    await pause(200);
  }
  assert.equal(paid.obligations.length, 5);
  assert.ok(paid.obligations.every((o: any) => o.state === 'CREDITED'));
  assert.equal(paid.treasury.reserved, '0');
  for (const entry of paid.ledger) {
    const sum = (side: string) =>
      entry.lines
        .filter((l: any) => l.side === side)
        .reduce((s: bigint, l: any) => s + BigInt(l.amount), 0n);
    assert.equal(sum('DEBIT'), sum('CREDIT'));
  }
  record(
    'payday',
    'The real planning worker credits all five fixture salaries; every journal entry balances.',
  );
  const employee = await login('maya');
  const personal = await get('/state?scope=employee', employee.cookie);
  assert.equal(personal.obligations.length, 1);
  assert.equal(personal.obligations[0].owner, 'maya');
  assert.ok(personal.goals.some((g: any) => BigInt(g.funded) > 0n));
  record('employee', 'The employee sees only their payday and funded savings goal.');
  const operator = await login('admin');
  const platform = await get('/state?scope=admin', operator.cookie);
  assert.equal(platform.companies.length, 2);
  await command(operator, 'treasury.fund', { amount: '1', purpose: 'cash' }, randomUUID(), 403);
  record(
    'authority',
    'The platform operator can inspect companies and cannot spend their treasury.',
  );
  const policy = await get('/review/policy-lab');
  assert.equal(policy.cases.filter((c: any) => c.decision === 'BLOCK').length, 8);
  assert.equal(policy.fundsMoved, false);
  record('policy', 'Shared policy evaluator rejects eight synthetic unsigned cases.');
  const signed = JSON.parse(await readFile('tests/fixtures/oneclick-signed-dry.json', 'utf8'));
  assert.ok(verifyQuoteSignature(signed));
  record(
    'signature',
    'Archived real dry quote signature verifies using the official SDK; not a fresh market quote.',
  );
  const claims = await get('/review/claims');
  assert.equal(claims.version, release.version);
  assert.equal(claims.classification, 'CLAIMS_TO_VERIFY');
  assert.equal(claims.score, null);
  record(
    'claims',
    'Machine-readable verification map reports claims and boundaries without self-issued scores.',
  );
  const output = process.env.NUMA_REVIEW_REPORT || 'artifacts/review-smoke.json';
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        product: release.name,
        version: release.version,
        checkedAt: new Date().toISOString(),
        status: 'PASS',
        startupMs,
        totalMs: Math.round(performance.now() - timer),
        platform: process.platform,
        node: process.version,
        mode: 'ISOLATED_HTTP_FIXTURE_JOURNEY',
        mainnetTransactions: 0,
        newOnchainTransactions: 0,
        humanSignatures: 0,
        tests: checks,
      },
      null,
      2,
    ),
  );
  console.log(
    'Review journey: ' +
      checks.length +
      ' checks passed; startup ' +
      startupMs +
      ' ms. Report: ' +
      output,
  );
} finally {
  child.kill('SIGTERM');
  await new Promise<void>((r) => {
    if (child.exitCode !== null) r();
    else child.once('exit', () => r());
  });
}
