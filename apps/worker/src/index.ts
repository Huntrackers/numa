import { tickTestnet } from './testnet.js';
import 'dotenv/config';
import { Store } from '../../../packages/db/src/index.js';
import { tick } from './worker.js';
import { dailyBackup } from '../../../packages/db/src/backups.js';
import { randomUUID } from 'node:crypto';
const store = new Store();
const id = randomUUID();
let stopped = false;
const run = () => {
  if (stopped) return;
  try {
    tick(store, id);
    void dailyBackup(store).catch((e) => console.error('Daily backup failed', e.message));
    void tickTestnet(store);
  } catch (e) {
    console.error('Worker scan failed', e);
  }
};
run();
const timer = setInterval(run, 5000);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopped = true;
    clearInterval(timer);
    store.close();
    process.exit(0);
  });
console.log('numa worker is scanning persisted jobs every 5 seconds.');
