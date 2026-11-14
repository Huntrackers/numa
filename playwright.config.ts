import { defineConfig } from '@playwright/test';
import { browserExecutable } from './scripts/browser';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4312',
    headless: true,
    viewport: {
      width: Number(process.env.E2E_VIEWPORT_WIDTH || 1440),
      height: Number(process.env.E2E_VIEWPORT_HEIGHT || 1000),
    },
    launchOptions: { executablePath: browserExecutable() },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'node --import tsx scripts/e2e-server.ts',
    url: 'http://127.0.0.1:4312/api/v1/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
