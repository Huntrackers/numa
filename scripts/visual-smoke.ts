import { browserExecutable } from './browser.js';
import { release } from '../packages/domain/src/release.js';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const errors: string[] = [];
try {
  mkdirSync('qa', { recursive: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await desktop.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const response = await page.goto('http://127.0.0.1:4310/login');
  await page.getByRole('button', { name: 'Connect testnet wallet', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'I’m running a company' }).count(), 0);
  assert.ok(
    (await page.locator('body').innerText()).includes(
      'Version ' + release.label + ' / NEAR testnet',
    ),
  );
  const csp = response!.headers()['content-security-policy'];
  assert.ok(csp && !csp.includes('unsafe-eval'));
  await page.screenshot({ path: 'qa/numa-v3-login-desktop.png', fullPage: true });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    small = await mobile.newPage();
  await small.goto('http://127.0.0.1:4310/login');
  await small.getByRole('button', { name: 'Connect testnet wallet', exact: true }).waitFor();
  assert.ok(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await small.screenshot({ path: 'qa/numa-v3-login-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Connect testnet wallet', exact: true }).click();
  const frame = page.locator('iframe[sandbox="allow-scripts"]').last().contentFrame();
  await frame.getByRole('button', { name: /Meteor Web/i }).waitFor({ timeout: 20000 });
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  await frame.locator('body').evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  await page.screenshot({ path: 'qa/numa-v3-meteor-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  const result = {
    checkedAt: new Date().toISOString(),
    status: 'PASSED',
    actualServer: 'http://127.0.0.1:4310',
    version: release.version,
    samplePersonasDisabled: true,
    pinnedMeteorInitialized: true,
    cspUnsafeEval: false,
    desktop: true,
    mobile: true,
    horizontalOverflow: false,
    screenshots: [
      'qa/numa-v3-login-desktop.png',
      'qa/numa-v3-login-mobile.png',
      'qa/numa-v3-meteor-desktop.png',
    ],
    humanSignaturePerformed: false,
  };
  writeFileSync('docs/VISUAL_RUNTIME_SMOKE_V3.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
