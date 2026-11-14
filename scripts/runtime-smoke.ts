import { release } from '../packages/domain/src/release.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Store } from '../packages/db/src/index.js';
const url = 'http://127.0.0.1:4310';
const health = (await (await fetch(url + '/api/v1/health')).json()) as any;
assert.equal(health.name, 'numa');
assert.equal(health.version, release.version);
const openapi = (await (await fetch(url + '/api/v1/openapi.json')).json()) as any;
for (const path of [
  'state',
  'commands',
  'prepare',
  'dispatch',
  'declined',
  'confirm',
  'export.csv',
])
  assert.ok(openapi.paths['/api/v1/live/' + path]);
const s = new Store();
try {
  let worker: any, sync: any;
  const deadline = Date.now() + 30000;
  do {
    worker = s.get('testnet-worker-heartbeat');
    sync = s.get('chain-sync:' + process.env.NEAR_CONTRACT_ID);
    if (worker?.state === 'RUNNING' && sync?.state === 'HEALTHY') break;
    if (sync?.state === 'BLOCKED' || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (true);
  const backup = s.get('backup-status');
  assert.ok(
    worker && Date.now() - new Date(worker.lastSeen).getTime() < 120000,
    'A recent testnet worker observation is required.',
  );
  assert.equal(worker.state, 'RUNNING');
  assert.equal(sync?.state, 'HEALTHY');
  assert.equal(sync?.accounting?.state, 'VERIFIED');
  assert.equal(worker.key?.limited, true);
  assert.deepEqual(worker.key.methods, ['execute_due']);
  assert.ok(backup?.lastSuccessAt);
  const result = {
    checkedAt: new Date().toISOString(),
    health,
    openapiLiveRoutes: 7,
    testnetWorker: {
      state: worker.state,
      lastSeen: worker.lastSeen,
      restrictedMethods: worker.key.methods,
      receiverId: worker.key.receiverId,
    },
    reconciliation: {
      state: sync.state,
      accounting: sync.accounting.state,
      cursor: sync.cursor,
      lastSuccessAt: sync.lastSuccessAt,
    },
    backup: { lastSuccessAt: backup.lastSuccessAt, retention: backup.retention },
  };
  writeFileSync('docs/RUNTIME_SMOKE_V3.json', JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      status: 'PASSED',
      health: health.version,
      worker: worker.state,
      reconciliation: sync.state,
      restricted: true,
      backup: !!backup.lastSuccessAt,
    }),
  );
} finally {
  s.close();
}
