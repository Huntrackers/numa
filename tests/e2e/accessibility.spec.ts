import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
// Only this audit context bypasses CSP so the local accessibility engine can be injected.
// The ordinary journey suite retains the application's real CSP and wallet boundaries.
test.use({ bypassCSP: true });
const check = async (page: Page, label: string) => {
  await page.waitForLoadState('networkidle');
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => {
    const r = await (window as any).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return {
      violations: r.violations.map((v: any) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes.map((n: any) => n.target),
      })),
      passes: r.passes.length,
      incomplete: r.incomplete.map((v: any) => ({ id: v.id, nodes: v.nodes.length })),
    };
  });
  await test.info().attach(label, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(result, null, 2)),
  });
  expect(result.violations, label + ' has accessibility violations').toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    label + ' has document overflow',
  ).toBe(true);
};

for (const scenario of [
  {
    persona: 'I’m running a company',
    entry: '/company/forma/',
    routes: [
      'overview',
      'employees',
      'roles',
      'payroll',
      'treasury',
      'reports',
      'assistant',
      'settings',
    ],
  },
  {
    persona: 'I’m planning my money',
    entry: '/employee/',
    routes: [
      'overview',
      'salary',
      'wallets',
      'rules',
      'goals',
      'portfolio',
      'dca',
      'invest',
      'money-plan',
      'flexible-payday',
      'borrow',
      'assistant',
    ],
  },
  {
    persona: 'Operator console',
    entry: '/admin/',
    routes: ['companies', 'users', 'automation', 'integrations', 'settings', 'audit'],
  },
]) {
  test('accessible workspace pages: ' + scenario.persona, async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/login');
    await page
      .getByRole('button', {
        name: scenario.persona,
        exact: scenario.persona === 'Operator console',
      })
      .click();
    await expect(page.locator('main h1')).toBeVisible();
    for (const route of scenario.routes) {
      await page.goto(scenario.entry + route);
      await expect(page.locator('main h1')).toBeVisible();
      await check(page, scenario.entry + route);
    }
  });
}

test('accessible public review and mobile navigation', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/login');
  await check(page, 'login');
  for (const view of ['evidence', 'intents', 'policy', 'guide']) {
    await page.goto('/trust?view=' + view);
    await expect(page.locator('main h1')).toBeVisible();
    await check(page, 'review-' + view);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await check(page, 'login-mobile');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await expect(page.locator('main h1')).toBeVisible();
  await check(page, 'company-mobile');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await check(page, 'company-mobile-navigation');
});

test('accessible salary and import forms', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await expect(page.locator('main h1')).toBeVisible();
  await page.getByRole('button', { name: 'Prepare payroll', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check(page, 'payroll-form');
  await page.keyboard.press('Escape');
  await page.goto('/company/forma/employees');
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Import employees' })).toBeVisible();
  await check(page, 'csv-import-form');
  await expect(page.getByLabel('Upload CSV file')).toBeVisible();
  await expect(page.locator('textarea')).toHaveAccessibleName(/CSV/);
});
