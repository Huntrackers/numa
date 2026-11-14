import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

test('public landing remains readable while identity bootstrap is pending', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rpcRequests: string[] = [];
  page.on('request', (request) => {
    if (/https:\/\/[^/]*(near\.org|fastnear\.com)/.test(request.url()))
      rpcRequests.push(request.url());
  });
  await page.route('**/api/v1/config', async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: 'Every payday has somewhere to go.' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create a company workspace', exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('NEAR testnet only. Mainnet payments are not supported.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect testnet wallet' })).toHaveCount(0);
    expect(rpcRequests).toEqual([]);
  } finally {
    release();
  }
});

test('company and employee entries retain their intent through the sign-in entry', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create a company workspace', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe('/workspaces/new');
  await expect(page.getByRole('heading', { name: 'Step into your workspace.' })).toBeVisible();
  await page.getByRole('link', { name: 'Learn how numa works' }).click();
  await expect(
    page.getByRole('heading', { name: 'Every payday has somewhere to go.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'I’m an employee', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe('/employee/overview');
});

test('landing evidence navigation is public and preserves execution labels', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('term').filter({ hasText: 'Real NEAR testnet' })).toBeVisible();
  await expect(
    page.getByRole('term').filter({ hasText: 'NEAR Intents · Live read-only' }),
  ).toBeVisible();
  await expect(
    page.getByRole('term').filter({ hasText: 'Personal finance · Simulation' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Explore the NEAR evidence', exact: true }).click();
  await expect(page).toHaveURL(/\/trust$/);
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect testnet wallet' })).toHaveCount(0);
});

test('keyboard users can skip the header and reach the primary task', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Every payday has somewhere to go.' }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/#landing-main$/);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Create a company workspace', exact: true }).first(),
  ).toBeFocused();
});

test.describe('landing mobile accessibility', () => {
  // Inject only the local audit engine; ordinary navigation tests use the real CSP.
  test.use({ bypassCSP: true, viewport: { width: 390, height: 844 } });
  test('mobile public page has no overflow or automated WCAG violations', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Every payday has somewhere to go.' }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => {
      const audit = await (window as any).axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
      return {
        violations: audit.violations.map((violation: any) => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.map((node: any) => node.target),
        })),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await test.info().attach('landing-mobile-accessibility', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(result, null, 2)),
    });
    expect(result.violations).toEqual([]);
    expect(result.overflow).toBe(false);
  });
});
