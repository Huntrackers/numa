import { chromium, expect } from '@playwright/test';
import { browserExecutable } from './browser.js';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
const base = process.env.REVIEW_URL || 'http://127.0.0.1:4313';
mkdirSync('qa/v3-recordings', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: 'qa/v3-recordings', size: { width: 1440, height: 1000 } },
});
await ctx.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.id = 'recording-caption';
    bar.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;padding:15px 25px;background:#213f52;color:white;font:14px sans-serif;z-index:99999;pointer-events:none';
    bar.textContent = 'numa 3.1 / NEAR HACKATHON / Local review recording';
    document.body.append(bar);
  });
});
const page = await ctx.newPage(),
  errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const caption = async (text: string) =>
  page.locator('#recording-caption').evaluate((el, text) => (el.textContent = text), text);
const pause = async (ms = 2200) => page.waitForTimeout(ms);
const go = async (name: string) => {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('main h1')).toBeVisible();
};
const shots: string[] = [];
async function shot(name: string) {
  const p = 'qa/v3-' + name + '.png';
  await page
    .locator('#recording-caption')
    .evaluate((el) => ((el as HTMLElement).style.visibility = 'hidden'));
  await page.screenshot({ path: p, fullPage: true });
  await page
    .locator('#recording-caption')
    .evaluate((el) => ((el as HTMLElement).style.visibility = 'visible'));
  shots.push(p);
}
try {
  await page.goto(base + '/trust');
  await expect(page.getByText('Matches reviewed deployment', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await caption('Live NEAR testnet observation / receipts below are recorded historical evidence');
  await pause();
  await shot('trust-desktop');
  await page.getByRole('button', { name: 'Execution policy lab' }).click();
  await expect(page.getByText('BLOCK', { exact: true })).toHaveCount(8);
  await caption(
    'Synthetic policy drills / shared API and worker evaluator / no attack is broadcast',
  );
  await pause();
  await shot('policy-desktop');
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await expect(page.locator('main h1')).toBeVisible();
  await caption('Fixture company / fictional demoUSD / this journey does not send testNEAR');
  await pause();
  await page.getByRole('button', { name: 'Prepare payroll', exact: true }).click();
  await page.getByLabel('Schedule', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Preview payroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decision preview' })).toBeVisible();
  await caption('Review the funded payroll before authorizing / accelerated fixture schedule');
  await pause();
  await shot('payroll-preview');
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await go('Payroll');
  await expect(page.getByText('Credited to Salary Vault', { exact: true })).toHaveCount(5, {
    timeout: 20000,
  });
  await caption('The isolated planning worker credited each fictional payday once');
  await pause();
  await shot('payroll-credited');
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'I’m planning my money' }).click();
  await expect(page.locator('main h1')).toBeVisible();
  await go('Savings goals');
  await page.getByRole('button', { name: 'Create a goal', exact: true }).click();
  await page.getByLabel('What are you saving for?', { exact: true }).fill('A new creative studio');
  await page.getByLabel('Target (demoUSD)', { exact: true }).fill('2500');
  await page.getByRole('button', { name: 'Confirm goal rules', exact: true }).click();
  await expect(page.locator('main')).toContainText('A new creative studio');
  await caption('Employee fixture / a savings purpose with explicit contribution rules');
  await pause();
  await shot('goals-desktop');
  await go('Salary allocation');
  await page.getByLabel('Available cash percentage', { exact: true }).fill('60');
  await page.getByLabel('Savings goals percentage', { exact: true }).fill('20');
  await page.getByLabel('DCA budget percentage', { exact: true }).fill('15');
  await page.getByLabel('Immediate investing percentage', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Preview this allocation' }).click();
  await expect(page.getByRole('heading', { name: 'Decision preview' })).toBeVisible();
  await caption('Future salary allocation / DCA and investing stay in the simulated planning book');
  await pause();
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await go('Treasury');
  await page.getByText('Preview company funding with NEAR Intents', { exact: true }).click();
  await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
  await caption(
    'Live mainnet market data / public sample addresses / dry quote only / zero funds moved',
  );
  await page.getByRole('button', { name: 'Get signed route preview' }).click();
  await expect(page.getByText('Provider signature verified', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await pause(3500);
  await shot('intents-desktop');
  await page.goto(base + '/trust');
  await caption(
    'Actual salary and savings settle on NEAR testnet / inspect the recorded public receipts',
  );
  await page
    .getByRole('heading', { name: 'Inspect the recorded receipts' })
    .scrollIntoViewIfNeeded();
  await pause(3500);
  await shot('receipts-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/trust');
  await expect(
    page.getByRole('heading', { name: 'Follow the money. Inspect the boundaries.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh evidence', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  await expect(page.getByText('Matches reviewed deployment', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await caption('numa 3.1 / mobile review');
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
    throw Error('Mobile overflow');
  await shot('trust-mobile');
  await page.getByRole('button', { name: 'Live route preview' }).click();
  await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
    throw Error('Route mobile overflow');
  await shot('intents-mobile');
  if (errors.length) throw Error('Browser errors: ' + errors.join('; '));
  writeFileSync(
    'docs/REVIEW_WALKTHROUGH_V3.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        status: 'PASSED',
        fixturePayroll: true,
        liveReadOnlyQuote: true,
        providerSignatureVerified: true,
        fundsMoved: 0,
        realSalaryEvidence: 'Recorded historical testnet receipts, not the fixture payroll',
        screenshots: shots,
        mobileOverflow: false,
        pageErrors: errors,
        video: 'qa/numa-v3-walkthrough.webm',
      },
      null,
      2,
    ),
  );
} finally {
  await page.close();
  await ctx.close();
  const video = await page.video()?.path();
  await browser.close();
  if (video) renameSync(video, 'qa/numa-v3-walkthrough.webm');
}
console.log(
  'Review walkthrough recorded; live dry quote verified, fixture payroll labelled, screenshots saved.',
);
