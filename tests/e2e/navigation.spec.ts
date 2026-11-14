import { test, expect } from '@playwright/test';

for (const scenario of [
  {
    persona: 'Operator console',
    entry: '/admin/companies',
    network: '/admin/network',
    back: 'Companies',
  },
  {
    persona: 'I’m planning my money',
    entry: '/employee/overview',
    network: '/employee/network',
    back: 'Overview',
  },
  {
    persona: 'I’m running a company',
    entry: '/company/forma/overview',
    network: '/company/forma/network',
    back: 'Overview',
  },
]) {
  test('NEAR testnet preserves the workspace: ' + scenario.entry, async ({ page }) => {
    await page.goto('/login');
    await page
      .getByRole('button', {
        name: scenario.persona,
        exact: scenario.persona === 'Operator console',
      })
      .click();
    await expect(page).toHaveURL(new RegExp(scenario.entry + '$'));
    await expect(page.locator('main h1')).toBeVisible();
    const menu = page.getByRole('navigation', { name: 'Workspace navigation' });
    await menu.getByRole('button', { name: 'NEAR testnet', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(scenario.network + '$'));
    await expect(
      page.getByRole('heading', { name: 'A real network. A separate book.' }),
    ).toBeVisible();
    await expect(menu.getByRole('button', { name: scenario.back, exact: true })).toBeVisible();
    if (scenario.entry.startsWith('/admin')) {
      await expect(page.getByRole('button', { name: 'numa platform' })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'People', exact: true })).toHaveCount(0);
    }
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'A real network. A separate book.' }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(scenario.network + '$'));
    await menu.getByRole('button', { name: scenario.back, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(scenario.entry + '$'));
    await expect(page.locator('main h1')).toBeVisible();
  });
}
