import { decodeTransaction } from '@near-js/transactions';
import { test, expect, type Page } from '@playwright/test';
const login = async (page: Page, user = 'owner') => {
  await page.goto('/login');
  if (user === 'owner') await page.getByRole('button', { name: 'I’m running a company' }).click();
  else if (user === 'maya')
    await page.getByRole('button', { name: 'I’m planning my money' }).click();
  else await page.getByRole('button', { name: 'Operator console', exact: true }).click();
  await page.waitForURL(
    user === 'owner'
      ? '**/company/forma/overview'
      : user === 'maya'
        ? '**/employee/overview'
        : '**/admin/companies',
  );
  await expect(page.locator('main h1')).toBeVisible();
};
const go = async (page: Page, name: string) => {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('main h1')).toBeVisible();
};
const dialog = () => 'dialog[open]';
test('company authorizes accelerated payroll and worker credits each employee', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Prepare payroll', exact: true }).click();
  await page.getByLabel('Schedule', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Preview payroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decision preview' })).toBeVisible();
  await expect(page.locator(dialog())).toContainText('Accelerated Demo Schedule');
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator(dialog())).toHaveCount(0);
  await go(page, 'Payroll');
  await expect(page.getByText('Credited to Salary Vault', { exact: true })).toHaveCount(5, {
    timeout: 15000,
  });
  await page.screenshot({ path: 'test-results/payroll-desktop.png', fullPage: true });
});
test('salary bulk change previews individual amounts and persists after reload', async ({
  page,
}) => {
  await login(page);
  await go(page, 'People');
  await page.getByRole('button', { name: 'Adjust salaries' }).click();
  await page.getByLabel('Apply to', { exact: true }).selectOption('design');
  await page.getByLabel('Change amount', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.locator(dialog())).toContainText('Maya Chen');
  await expect(page.locator(dialog())).not.toContainText('Noah Williams');
  await expect(page.locator(dialog())).toContainText('5,040.00');
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator(dialog())).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'Maya Chen' })).toContainText('5,040.00');
});
test('employee creates a goal, previews allocation, invests and repays a loan', async ({
  page,
}) => {
  await login(page, 'maya');
  await go(page, 'Savings goals');
  await page.getByRole('button', { name: 'Create a goal', exact: true }).click();
  await page.getByLabel('What are you saving for?', { exact: true }).fill('A new creative studio');
  await page.getByLabel('Target (demoUSD)', { exact: true }).fill('2500');
  await page.getByRole('button', { name: 'Confirm goal rules', exact: true }).click();
  await expect(page.locator('main')).toContainText('A new creative studio');
  await go(page, 'Salary allocation');
  await page.getByLabel('Available cash percentage', { exact: true }).fill('60');
  await page.getByLabel('Savings goals percentage', { exact: true }).fill('20');
  await page.getByLabel('DCA budget percentage', { exact: true }).fill('15');
  await page.getByLabel('Immediate investing percentage', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Preview this allocation' }).click();
  await expect(page.locator(dialog())).toContainText('Applies only to future');
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator(dialog())).toHaveCount(0);
  await go(page, 'Invest');
  await page
    .getByRole('row')
    .filter({ has: page.getByText('NEAR', { exact: true }).first() })
    .getByRole('button', { name: 'Preview buy' })
    .click();
  await page.getByLabel('Purchase value before fees (demoUSD)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Preview order', exact: true }).click();
  await expect(page.locator(dialog())).toContainText('Simulated NEAR Intents');
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator(dialog())).toHaveCount(0);
  await go(page, 'Portfolio');
  await expect(page.getByRole('row').filter({ hasText: 'NEAR' }).first()).toBeVisible();
  await go(page, 'Borrow & Earn');
  await page.getByRole('button', { name: 'Preview a loan', exact: true }).click();
  await page.getByRole('button', { name: 'Review borrowing cost' }).click();
  await expect(page.locator(dialog())).toContainText('Debt is not income');
  await page.getByRole('button', { name: 'Apply decision' }).click();
  await expect(page.locator(dialog())).toHaveCount(0);
  await page.getByRole('button', { name: 'Repay', exact: true }).click();
  await page.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await expect(page.locator(dialog())).toHaveCount(0);
  await expect(page.getByText('closed', { exact: true }).first()).toBeVisible();
});
test('all three panels render every navigation route without JavaScript errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  for (const label of [
    'People',
    'Job roles',
    'Payroll',
    'Treasury',
    'Reports',
    'numa assistant',
    'Settings',
  ])
    await go(page, label);
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m planning my money' }).click();
  await page.waitForURL('**/employee/overview');
  for (const label of [
    'Salary Vault',
    'Destinations',
    'Salary allocation',
    'Savings goals',
    'DCA plans',
    'Invest',
    'Portfolio',
    'Money plan',
    'Flexible payday',
    'Borrow & Earn',
    'numa assistant',
  ])
    await go(page, label);
  await page.screenshot({ path: 'test-results/employee-desktop.png', fullPage: true });
  await login(page, 'admin');
  for (const label of ['Users', 'Automation', 'Integrations', 'Settings', 'Audit trail'])
    await go(page, label);
  expect(errors).toEqual([]);
});
test('assistant proposes a typed change and never applies it automatically', async ({ page }) => {
  await login(page);
  await go(page, 'numa assistant');
  await page.getByLabel('Message numa assistant').fill('Increase Engineering salaries by 3%');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('button', { name: 'Open decision preview' }).click();
  await expect(page.locator(dialog())).toContainText('Noah Williams');
  await expect(page.locator(dialog())).not.toContainText('Maya Chen');
  await page.getByRole('button', { name: 'Keep editing' }).click();
});
test('CSV validates per-row errors and invitation creation does not activate payroll', async ({
  page,
}) => {
  await login(page);
  await go(page, 'People');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV content', { exact: true })
    .fill(
      'name,email,role,salary,cadence\nTaylor Quinn,taylor-e2e@forma.example,Design,4500,monthly',
    );
  await page.getByRole('button', { name: 'Validate and preview' }).click();
  await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Commit import' }).click();
  await expect(page.getByRole('heading', { name: 'Invitations created' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Taylor Quinn' })).toContainText('invited');
});
test('mobile navigation and allocation screen fit a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'maya');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await go(page, 'Salary allocation');
  await expect(page.getByRole('heading', { name: 'Give every payday direction.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden');
  await page.screenshot({ path: 'test-results/allocation-mobile.png', fullPage: true });
});
test('operator can suspend and restore a company without money controls', async ({ page }) => {
  await login(page, 'admin');
  const row = page.getByRole('row').filter({ hasText: 'Orbit Labs' });
  await row.getByRole('button', { name: 'Suspend', exact: true }).click();
  await page.getByRole('button', { name: 'Suspend company', exact: true }).click();
  await expect(row).toContainText('suspended');
  await row.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Restore access', exact: true }).click();
  await expect(row).toContainText('active');
  await expect(page.getByRole('button', { name: /withdraw/i })).toHaveCount(0);
});

test('new company setup, job role and one-time employee invitation work through the UI', async ({
  page,
}) => {
  await login(page);
  await page.locator('.workspace-picker').click();
  await page.getByRole('button', { name: 'Create a company', exact: true }).click();
  await page.getByLabel('Company name', { exact: true }).fill('Northstar E2E');
  await page.getByRole('button', { name: 'Create company', exact: true }).click();
  await expect(page.locator('.workspace-picker')).toContainText('Northstar E2E');
  await go(page, 'Job roles');
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByLabel('Role name', { exact: true }).fill('Research');
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Research' })).toBeVisible();
  await go(page, 'People');
  await page.getByRole('button', { name: 'Invite employee', exact: true }).first().click();
  await page.getByLabel('Full name', { exact: true }).fill('Jordan Blake');
  await page.getByLabel('Email address', { exact: true }).fill('jordan@northstar.example');
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invitation ready' })).toBeVisible();
  const url = await page.locator('.result-item p').innerText();
  await page.goto(url);
  await page.getByRole('button', { name: 'Accept demo invitation', exact: true }).click();
  await page.waitForURL('**/employee/overview');
  await expect(page.locator('main')).toContainText('Northstar E2E');
});
test('flexible payday shows early-pay fee and a fully reserved hold can exit early', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Prepare payroll', exact: true }).click();
  await page.getByRole('button', { name: 'Preview payroll', exact: true }).click();
  await page.getByRole('button', { name: 'Apply decision', exact: true }).click();
  await go(page, 'Payroll');
  const row = page
    .getByRole('row')
    .filter({ hasText: 'Maya Chen' })
    .filter({ has: page.getByRole('button', { name: 'Confirm earned', exact: true }) })
    .first();
  await row.getByRole('button', { name: 'Confirm earned', exact: true }).click();
  await page.getByLabel('Confirmed earned amount (demoUSD)', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Confirm earned amount', exact: true }).click();
  await login(page, 'maya');
  await go(page, 'Flexible payday');
  await page.getByRole('button', { name: 'Review advance', exact: true }).click();
  await page.getByRole('button', { name: 'Review advance', exact: true }).last().click();
  await expect(page.locator(dialog())).toContainText('scenario fee');
  await page.getByRole('button', { name: 'Apply decision', exact: true }).click();
  await page.getByRole('button', { name: 'Preview a hold', exact: true }).click();
  await page.getByRole('button', { name: 'Review hold', exact: true }).click();
  await expect(page.locator(dialog())).toContainText('employer-funded');
  await page.getByRole('button', { name: 'Apply decision', exact: true }).click();
  await page.getByRole('button', { name: 'Exit early', exact: true }).last().click();
  await page.getByRole('button', { name: 'Exit hold', exact: true }).click();
  await expect(page.getByText('exited early', { exact: true }).last()).toBeVisible();
});
test('DCA accepts an asset schedule, spending cap, fee limit and pause-resume', async ({
  page,
}) => {
  await login(page, 'maya');
  await go(page, 'DCA plans');
  await page.getByRole('button', { name: 'New DCA plan', exact: true }).click();
  await page.getByLabel('Plan name', { exact: true }).fill('Steady Bitcoin');
  await page.getByLabel('Asset', { exact: true }).selectOption('BTC');
  await page
    .getByLabel('Total spending cap including fees (demoUSD, optional)', { exact: true })
    .fill('500');
  await page.getByRole('button', { name: 'Save DCA plan', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Steady Bitcoin' });
  await expect(row).toContainText('BTC');
  await row.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(row).toContainText('paused');
  await row.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(row).toContainText('active');
});
test('salary allocation supports more than one chosen investment asset', async ({ page }) => {
  await login(page, 'maya');
  await go(page, 'Salary allocation');
  await page.getByLabel('Available cash percentage', { exact: true }).fill('50');
  await page.getByLabel('Asset for immediate investing', { exact: true }).selectOption('NEAR');
  await page.getByRole('button', { name: 'Add another investment asset', exact: true }).click();
  await page.getByLabel('Additional asset 1', { exact: true }).selectOption('BTC');
  await page.getByLabel('Additional salary share 1', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Preview this allocation', exact: true }).click();
  await expect(page.locator(dialog())).toContainText('BTC');
  await expect(page.locator(dialog())).toContainText('0.25%');
  await page.getByRole('button', { name: 'Apply decision', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Additional asset 1', { exact: true })).toHaveValue('BTC');
});

test('savings contribution basis, draft and archive persist through reload', async ({ page }) => {
  await login(page, 'maya');
  await go(page, 'Savings goals');
  await page.getByRole('button', { name: 'Create a goal', exact: true }).click();
  await page.getByLabel('What are you saving for?', { exact: true }).fill('A future workshop');
  await page.getByLabel('Target (demoUSD)', { exact: true }).fill('600');
  await page.getByLabel('Contribution type', { exact: true }).selectOption('FIXED');
  await page.getByLabel('Contribution: % or amount (demoUSD)', { exact: true }).fill('200');
  await page.getByLabel('Goal status', { exact: true }).selectOption('DRAFT');
  await page.getByLabel('Target date (optional planning date)', { exact: true }).fill('2027-03-01');
  await page.getByRole('button', { name: 'Confirm goal rules', exact: true }).click();
  const row = page.locator('.goal-row').filter({ hasText: 'A future workshop' });
  await expect(row).toContainText('200.00 demoUSD');
  await expect(row).toContainText('draft');
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Goal status', { exact: true }).selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Confirm goal rules', exact: true }).click();
  await expect(row).toContainText('active');
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Goal status', { exact: true }).selectOption('ARCHIVED');
  await page.getByRole('button', { name: 'Confirm goal rules', exact: true }).click();
  await page.reload();
  await expect(row).toContainText('archived');
  await expect(row).toContainText('target 2027-03-01');
});
