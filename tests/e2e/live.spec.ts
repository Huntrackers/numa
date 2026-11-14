import { test, expect, type Page } from '@playwright/test';
const unit = 10n ** 24n;
const accountId = 'fresh-owner.testnet';
const c = {
  id: 'fresh-company',
  name: 'Northbound Labs',
  chainId: 'opaque-company',
  timezone: 'UTC',
  unit: 'testNEAR',
  mode: 'TESTNET',
};
const employee = {
  id: 'employee-local',
  name: 'Jordan Avery',
  email: 'jordan@example.org',
  chainId: 'opaque-employee',
  accountId: 'jordan.testnet',
  salary: (unit / 10n).toString(),
  cadence: 'monthly',
  status: 'ACTIVE',
  roleId: 'engineering',
  identityVerified: true,
  version: 1,
  chain: { accepted: true },
};
const plan = {
  id: 'decision',
  label: 'Authorize scheduled payroll',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  effects: {
    total: (unit / 10n).toString(),
    rows: [
      {
        id: 'pay',
        name: employee.name,
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        amount: (unit / 10n).toString(),
      },
    ],
  },
  steps: [
    {
      label: 'Authorize payroll batch 1',
      method: 'authorize_mandate',
      state: 'PENDING',
      args: {},
      deposit: '0',
    },
  ],
};
const state = {
  mode: 'TESTNET',
  contractId: 'vault.testnet',
  unit: 'testNEAR',
  network: 'testnet',
  user: { id: 'real-owner', accountId, name: accountId },
  serverTime: new Date().toISOString(),
  workspaces: [{ ...c, access: 'owner' }],
  company: c,
  access: 'owner',
  chain: { free: (unit * 3n).toString(), reserved: (unit / 10n).toString() },
  roles: [
    {
      id: 'engineering',
      name: 'Engineering',
      salary: (unit / 10n).toString(),
      cadence: 'monthly',
      version: 1,
    },
  ],
  employees: [employee],
  obligations: [
    {
      id: 'pay',
      employee_id: employee.chainId,
      account_id: employee.accountId,
      amount: employee.salary,
      due_at: (BigInt(Date.now() + 86400000) * 1000000n).toString(),
      credited: false,
      paused: false,
    },
  ],
  audit: [],
  members: [],
  plans: [],
  notifications: [],
  operations: [],
};
async function setup(page: Page, employeeMode = false) {
  await page.route('**/api/v1/me', (r) =>
    r.fulfill({ json: { user: state.user, mode: 'TESTNET', csrf: 'fixture-csrf' } }),
  );
  await page.route('**/api/v1/live/state?**', (r) =>
    r.fulfill({
      json: employeeMode
        ? {
            ...state,
            account: {
              cash: (unit / 2n).toString(),
              policy: {
                goal_bps: 2000,
                cash_floor: '0',
                goals: [
                  {
                    id: 'goal',
                    target: unit.toString(),
                    funded: (unit / 4n).toString(),
                    paused: false,
                    completed: false,
                  },
                ],
              },
            },
            goalNames: [{ chainId: 'goal', name: 'A new studio' }],
          }
        : state,
    }),
  );
}
test('verified NEAR company uses normal people, payroll and preview screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await page.route('**/api/v1/live/commands', async (r) => {
    const body = r.request().postDataJSON();
    expect(body.action).toBe('payroll.preview');
    expect(body.companyId).toBe(c.id);
    await r.fulfill({ json: { plan } });
  });
  await page.goto('/company/' + c.id + '/employees');
  await expect(page.getByRole('heading', { name: c.name, exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: employee.name })).toContainText(
    'Accepted on NEAR',
  );
  await expect(page.getByLabel('Built on NEAR')).toContainText('Testnet settlement');
  await page.getByRole('navigation').getByRole('button', { name: 'Payroll', exact: true }).click();
  await page.getByRole('button', { name: 'Review payroll window' }).click();
  await page.getByRole('button', { name: 'Preview payroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Authorize scheduled payroll' })).toBeVisible();
  await expect(page.locator('dialog')).toContainText('0.10 testNEAR');
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue later' }).click();
  await page.screenshot({ path: 'test-results/numa-near-payroll.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('personal testnet savings and withdrawal affordances fit mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, true);
  await page.goto('/employee/goals');
  await expect(page.getByText('A new studio', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Built on NEAR')).toContainText('NEAR');
  await expect(page.getByRole('button', { name: 'Release to free cash' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/numa-near-savings-mobile.png', fullPage: true });
});

test('testnet goal edits preserve existing policy and produce explicit v2 rules', async ({
  page,
}) => {
  await setup(page, true);
  await page.route('**/api/v1/live/commands', async (r) => {
    const body = r.request().postDataJSON();
    expect(body.action).toBe('goal.policy');
    expect(body.payload.goals).toHaveLength(1);
    expect(body.payload.goals[0]).toMatchObject({
      id: 'goal',
      contributionMode: 'FIXED',
      contributionValue: (unit / 5n).toString(),
      percentBasis: 'SALARY',
      overflow: 'NEXT',
      state: 'ACTIVE',
      confirmChanges: true,
    });
    await r.fulfill({
      json: {
        plan: {
          ...plan,
          label: 'Set savings policy on NEAR',
          effects: { goalBps: 2000, cashFloor: '0' },
          steps: [
            {
              label: 'Save atomic salary allocation',
              method: 'set_goal_policy_v2',
              state: 'PENDING',
            },
          ],
        },
      },
    });
  });
  await page.goto('/employee/goals');
  await page.getByRole('button', { name: 'Edit rules', exact: true }).click();
  await page.getByLabel('Contribution type', { exact: true }).selectOption('FIXED');
  await page.getByLabel('Contribution: % or amount (testNEAR)', { exact: true }).fill('0.2');
  await page.getByLabel('Percentage is measured against', { exact: true }).selectOption('SALARY');
  await page
    .getByLabel('Contribution left over when this goal fills', { exact: true })
    .selectOption('NEXT');
  await page.getByRole('button', { name: 'Review savings policy', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Set savings policy on NEAR', exact: true }),
  ).toBeVisible();
  await expect(page.locator('dialog')).toContainText('set goal policy v2');
});
