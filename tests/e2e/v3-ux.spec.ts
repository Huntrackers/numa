import { test, expect } from '@playwright/test';

test('pending financial decision keeps its current Escape guard', async ({ page }) => {
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finish = resolve));
  // This isolates dialog behavior from prior fixture payroll obligations; no salary is applied.
  await page.route('**/api/v1/commands', async (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action === 'preview.create')
      return route.fulfill({
        json: {
          id: 'ui-only-preview',
          kind: 'payroll',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          effects: {
            total: '10000',
            freeAfter: '90000',
            note: 'UI-only financial decision fixture.',
          },
        },
      });
    if (action === 'preview.apply') {
      await gate;
      return route.fulfill({ json: { applied: true } });
    }
    await route.continue();
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await expect(page.locator('main h1')).toBeVisible();
  await page.getByRole('button', { name: 'Prepare payroll', exact: true }).click();
  await page.getByRole('button', { name: 'Preview payroll', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Decision preview' })).toBeVisible();
  try {
    await page.getByRole('button', { name: 'Apply decision', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply decision', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Decision preview' })).toBeVisible();
  } finally {
    finish();
  }
  await expect(page.getByRole('dialog', { name: 'Decision preview' })).toHaveCount(0);
});

test('review sections support direct links, reload and browser back', async ({ page }) => {
  await page.goto('/trust?view=policy');
  await expect(
    page.getByRole('heading', { name: 'One policy, two execution paths.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try numa', exact: true }).click();
  await expect(page).toHaveURL(/view=guide/);
  await expect(page.getByRole('link', { name: 'Download verification map' })).toHaveAttribute(
    'href',
    '/api/v1/review/claims',
  );
  await expect(page.getByRole('link', { name: 'Download verification map' })).toHaveAttribute(
    'download',
    'numa-verification-map.json',
  );
  await expect(page.getByRole('heading', { name: 'Walk through a payday.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Walk through a payday.' })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'One policy, two execution paths.' }),
  ).toBeVisible();
});

test('a failed evidence refresh removes the prior verified status', async ({ page }) => {
  let fail = false;
  await page.route('**/api/v1/review/evidence', async (route) => {
    if (fail)
      return route.fulfill({
        status: 503,
        json: { code: 'UNAVAILABLE', message: 'Evidence unavailable. Retry the refresh.' },
      });
    return route.fulfill({
      json: {
        observedAt: new Date().toISOString(),
        contract: {
          codeMatches: true,
          contractId: 'fixture.testnet',
          observedCodeHash: 'fixture-code',
          blockHeight: 42,
        },
        worker: { fresh: true, state: 'RUNNING' },
        accounting: { fresh: true, state: 'VERIFIED' },
        capabilities: [],
        proofs: [],
      },
    });
  });
  await page.route('**/api/v1/review/policy-lab', (route) =>
    route.fulfill({ json: { cases: [] } }),
  );
  await page.goto('/trust');
  await expect(page.getByText('Matches reviewed deployment', { exact: true })).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Evidence unavailable');
  await expect(page.getByText('Matches reviewed deployment', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Not verified', { exact: true })).toBeVisible();
});

test('mobile payroll table can be reached and scrolled by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await expect(page.locator('main h1')).toBeVisible();
  const table = page.getByRole('region', { name: 'Employee table', exact: true }).first();
  await table.focus();
  await expect(table).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unknown routes offer a working return to workspace access', async ({ page }) => {
  await page.goto('/company/forma/unknown-page');
  await expect(
    page.getByRole('heading', { name: 'This path does not lead to a workspace.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open workspace access' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'A better rhythm for money.' })).toBeVisible();
});

test('mobile navigation contains keyboard focus and restores it on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await expect(page.locator('main h1')).toBeVisible();
  const opener = page.getByRole('button', { name: 'Open navigation' });
  await opener.click();
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.sidebar')))
    .toBe(true);
  await expect
    .poll(() => page.locator('.main-shell').evaluate((el) => (el as HTMLElement).inert))
    .toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.sidebar')))
    .toBe(true);
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.sidebar')))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await expect(opener).toBeFocused();
  await expect
    .poll(() => page.locator('.main-shell').evaluate((el) => (el as HTMLElement).inert))
    .toBe(false);
});
