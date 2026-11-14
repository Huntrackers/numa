import { isolateReview } from './review-environment.js';
// Isolate before dynamic imports so API imports cannot load the installation's .env.
isolateReview('numa-e2e-');
const { Store } = await import('../packages/db/src/index.js');
const { buildApp } = await import('../apps/api/src/server.js');
const { tick } = await import('../apps/worker/src/worker.js');
const store = new Store(),
  app = await buildApp(store);
await app.listen({ port: 4312, host: '127.0.0.1' });
const timer = setInterval(() => tick(store, 'e2e-worker'), 1000);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    clearInterval(timer);
    void app.close().then(() => {
      store.close();
      process.exit(0);
    });
  });
