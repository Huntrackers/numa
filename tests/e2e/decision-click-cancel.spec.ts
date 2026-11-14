import { test, expect } from '@playwright/test';

for (const scenario of [
  {
    page: 'employees',
    button: 'Reissue invite',
    action: 'employee.invitation',
    operation: 'reissue',
  },
  {
    page: 'employees',
    button: 'Revoke invite',
    action: 'employee.invitation',
    operation: 'revoke',
  },
  { page: 'settings', button: 'Revoke access', action: 'member.revoke' },
]) {
  test('cancelling direct action keeps the page usable: ' + scenario.button, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let requests = 0;
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        json: {
          mode: 'TESTNET',
          csrf: 'fixture-csrf',
          user: { id: 'fixture-owner', name: 'Owner', accountId: 'owner.testnet' },
        },
      }),
    );
    await page.route('**/api/v1/live/state?**', (route) =>
      route.fulfill({
        json: {
          mode: 'TESTNET',
          network: 'testnet',
          unit: 'testNEAR',
          contractId: 'vault.testnet',
          user: { id: 'fixture-owner', accountId: 'owner.testnet' },
          company: { id: 'mine', name: 'Direct action company', timezone: 'UTC', version: 1 },
          chain: { free: '0', reserved: '0' },
          access: 'owner',
          workspaces: [],
          plans: [],
          operations: [],
          obligations: [],
          notifications: [],
          audit: [],
          roles: [
            {
              id: 'role',
              name: 'Engineer',
              salary: '100000000000000000000000',
              cadence: 'monthly',
            },
          ],
          employees: [
            {
              id: 'employee',
              name: 'Invited teammate',
              accountId: 'employee.testnet',
              roleId: 'role',
              salary: '100000000000000000000000',
              cadence: 'monthly',
              status: 'INVITED',
              identityVerified: false,
              version: 1,
            },
          ],
          members: [
            {
              id: 'member',
              accountId: 'accountant.testnet',
              access: 'accountant',
              status: 'ACTIVE',
              version: 1,
            },
          ],
        },
      }),
    );
    await page.route('**/api/v1/live/commands', (route) => {
      requests++;
      const request = route.request();
      const body = request.postDataJSON();
      expect(body.action).toBe(scenario.action);
      if (scenario.operation) expect(body.payload.operation).toBe(scenario.operation);
      expect(request.headers()['x-numa-approval']).toBeUndefined();
      return route.fulfill({
        status: 428,
        json: {
          code: 'APPROVAL_REQUIRED',
          message: 'Review the NEAR decision.',
          approval: {
            id: 'a'.repeat(48),
            nonce: Buffer.alloc(32).toString('base64'),
            network: 'testnet',
            accountId: 'owner.testnet',
            recipient: '127.0.0.1:4312',
            commandHash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            message: 'numa decision approval: ' + scenario.action,
          },
        },
      });
    });
    await page.goto('/company/mine/' + scenario.page);
    await page.getByRole('button', { name: scenario.button, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Approve with your NEAR identity' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel decision', exact: true }).click();
    await expect(
      page.getByText('No decision was applied. Wallet approval was cancelled.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: scenario.button, exact: true })).toBeEnabled();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(requests).toBe(1);
    expect(pageErrors).toEqual([]);
  });
}
