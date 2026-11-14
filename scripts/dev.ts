import { spawn } from 'node:child_process';
const exe = process.execPath;
const children = [
  spawn(exe, ['--import', 'tsx', 'apps/api/src/server.ts'], { stdio: 'inherit' }),
  spawn(exe, ['--import', 'tsx', 'apps/worker/src/index.ts'], { stdio: 'inherit' }),
  spawn(exe, ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts'], {
    stdio: 'inherit',
  }),
];
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    children.forEach((c) => c.kill());
    process.exit(0);
  });
for (const c of children)
  c.on('exit', (code) => {
    if (code && code !== 0) {
      children.forEach((x) => x.kill());
      process.exit(code);
    }
  });
