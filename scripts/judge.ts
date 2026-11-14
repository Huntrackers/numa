import { release } from '../packages/domain/src/release.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// An isolated fixture workspace, deliberately separate from the user's .env and payroll database.
const reviewData = mkdtempSync(join(tmpdir(), 'numa-review-'));
process.env.NOMA_DATA_DIR = reviewData;
// Never load this installation's .env into the isolated review process.
process.env.DOTENV_CONFIG_PATH = join(reviewData, 'not-configured.env');
process.env.DOTENV_CONFIG_OVERRIDE = 'false';
process.env.NEAR_CONTRACT_ID ||= 'noma-vault-mw4ab6ev.testnet';
process.env.DEMO_ENABLED = 'true';
process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'silent';
process.env.NEAR_NETWORK = 'testnet';
delete process.env.NEAR_EXECUTOR_KEY_FILE;
delete process.env.NEAR_EXECUTOR_ACCOUNT;
const { Store } = await import('../packages/db/src/index.js');
const { buildApp } = await import('../apps/api/src/server.js');
const { tick } = await import('../apps/worker/src/worker.js');
// Reassert isolation after imports and remove every automatic-signing setting.
process.env.NOMA_DATA_DIR = reviewData;
delete process.env.NEAR_EXECUTOR_KEY_FILE;
delete process.env.NEAR_EXECUTOR_ACCOUNT;
const store = new Store(),
  app = await buildApp(store);
const reviewPort = Number(process.env.REVIEW_PORT || 4313);
if (!Number.isInteger(reviewPort) || reviewPort < 1024 || reviewPort > 65535)
  throw Error('Use a review port between 1024 and 65535.');
await app.listen({ port: reviewPort, host: '127.0.0.1' });
const timer = setInterval(() => tick(store, 'isolated-review'), 1000);
console.log(
  'numa ' + release.label + ' review workspace: http://127.0.0.1:' + reviewPort + '/trust',
);
console.log(
  'Sample personas: /login. Fictional demoUSD only; no automatic testnet signer is loaded. Ctrl+C stops this workspace.',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    clearInterval(timer);
    void app.close().then(() => {
      store.close();
      process.exit(0);
    });
  });
