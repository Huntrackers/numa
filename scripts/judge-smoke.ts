import { release } from '../packages/domain/src/release.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../packages/db/src/index.js';
import { createHash } from 'node:crypto';
const dir = mkdtempSync(join(tmpdir(), 'numa-isolation-check-'));
const file = join(dir, 'noma.sqlite');
const store = new Store(file);
store.save({ id: 'private-marker', type: 'system', value: 'must-stay-independent' });
store.close();
const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex'),
  before = digest();
const base = 'http://127.0.0.1:4315';
const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/judge.ts')], {
  env: {
    ...process.env,
    REVIEW_PORT: '4315',
    NOMA_DATA_DIR: dir,
    DEMO_ENABLED: 'false',
    NEAR_EXECUTOR_ACCOUNT: 'must-not-load.testnet',
    NEAR_EXECUTOR_KEY_FILE: join(dir, 'missing-private-key.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let output = '';
child.stdout.on('data', (b) => (output += b));
child.stderr.on('data', (b) => (output += b));
try {
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw Error('Review exited before ready');
    try {
      healthy =
        (
          (await (
            await fetch(base + '/api/v1/health', { signal: AbortSignal.timeout(500) })
          ).json()) as any
        ).version === release.version;
      if (healthy) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(healthy);
  const config = (await (await fetch(base + '/api/v1/config')).json()) as any;
  assert.equal(config.demoEnabled, true);
  const login = await fetch(base + '/api/v1/auth/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ userId: 'owner' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const state = (await (
    await fetch(base + '/api/v1/state?scope=company&companyId=forma', { headers: { cookie } })
  ).json()) as any;
  assert.equal(state.company.name, 'Forma Studio');
  assert.equal(state.obligations.length, 0);
  const evidence = (await (await fetch(base + '/api/v1/review/evidence')).json()) as any;
  assert.equal(evidence.worker.fresh, false);
  assert.ok(!output.includes('missing-private-key'));
  assert.equal(digest(), before);
  writeFileSync(
    'docs/JUDGE_ISOLATION_SMOKE_V3.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        status: 'PASSED',
        version: release.version,
        privateDatabaseUnchanged: true,
        freshFixtureObligations: 0,
        fixtureLogin: true,
        automaticSignerObserved: false,
        localEnvLoaded: false,
      },
      null,
      2,
    ),
  );
  console.log(
    'Isolated judge boot verified; original database unchanged, fresh fixtures, no automatic signer.',
  );
} finally {
  child.kill('SIGTERM');
  await new Promise<void>((r) => {
    if (child.exitCode !== null) r();
    else child.once('exit', () => r());
  });
}
