import { test, expect, type Page } from '@playwright/test';

// Identity, persisted operation and verification responses are explicit browser fixtures.
// No wallet is opened, no transaction is signed and no testnet funds move in this suite.
async function fixture(page: Page) {
  const operation: any = {
    id: 'recovery-operation',
    state: 'SUBMITTED',
    accountId: 'reviewer.testnet',
    contractId: 'vault.testnet',
    method: 'fund_company',
    pendingTxHashes: [],
  };
  const plan = {
    id: 'recovery-plan',
    label: 'Recover payroll operation',
    state: 'IN_PROGRESS',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    effects: { amount: '100000000000000000000000' },
    steps: [
      {
        label: 'Fund company treasury',
        method: 'fund_company',
        state: 'PENDING',
        operationId: operation.id,
        args: {},
        deposit: '100000000000000000000000',
      },
    ],
  };
  const company = {
    id: 'recovery-company',
    name: 'Recovery fixture',
    chainId: 'opaque-company',
    timezone: 'UTC',
  };
  const state: any = {
    mode: 'TESTNET',
    network: 'testnet',
    unit: 'testNEAR',
    contractId: 'vault.testnet',
    user: {
      id: 'recovery-owner',
      accountId: 'reviewer.testnet',
      name: 'Review owner',
      role: 'user',
    },
    serverTime: new Date().toISOString(),
    workspaces: [{ ...company, access: 'owner' }],
    company,
    access: 'owner',
    chain: { free: '1000000000000000000000000', reserved: '0' },
    roles: [],
    employees: [],
    obligations: [],
    audit: [],
    members: [],
    notifications: [],
    ledger: [],
    plans: [plan],
    operations: [operation],
  };
  await page.route('**/api/v1/me', (r) =>
    r.fulfill({ json: { user: state.user, mode: 'TESTNET', csrf: 'fixture-csrf' } }),
  );
  await page.route('**/api/v1/live/state?**', (r) => r.fulfill({ json: state }));
  await page.route('**/api/v1/operations/recovery-operation', (r) =>
    r.fulfill({ json: operation }),
  );
  await page.goto('/company/recovery-company/payroll');
  await page.getByRole('button', { name: 'Review / resume' }).click();
  await expect(page.getByRole('dialog', { name: plan.label })).toBeVisible();
  await expect(page.getByLabel('NEAR transaction hash', { exact: true })).toBeVisible();
  return { operation, plan, state };
}
const wrongHash = 'A'.repeat(44),
  correctHash = 'B'.repeat(44);

test('a mismatched hash stays editable and a corrected proof completes the step', async ({
  page,
}) => {
  const { operation } = await fixture(page);
  const submitted: string[] = [];
  await page.route('**/api/v1/live/confirm', (r) => {
    const value = r.request().postDataJSON().txHash;
    submitted.push(value);
    if (value === wrongHash)
      return r.fulfill({
        status: 409,
        json: {
          code: 'TRANSACTION_MISMATCH',
          message: 'This hash does not match. Check the transaction in your wallet.',
        },
      });
    Object.assign(operation, { state: 'CONFIRMED', txHash: correctHash });
    return r.fulfill({ json: operation });
  });
  const input = page.getByLabel('NEAR transaction hash', { exact: true });
  await input.fill(wrongHash);
  await page.getByRole('button', { name: 'Verify this transaction' }).click();
  await expect(page.getByRole('alert')).toContainText('does not match');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toBeFocused();
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toBeDisabled();
  await input.fill(correctHash);
  await page.getByRole('button', { name: 'Verify this transaction' }).click();
  await expect(page.getByText('All steps confirmed', { exact: true })).toBeVisible();
  expect(submitted).toEqual([wrongHash, correctHash]);
});

test('an unknown verification result keeps signing and discard locked', async ({ page }) => {
  const { operation } = await fixture(page);
  await page.route('**/api/v1/live/confirm', (r) => {
    Object.assign(operation, { state: 'SUBMITTED', pendingTxHashes: [wrongHash] });
    return r.fulfill({
      status: 503,
      json: {
        code: 'RPC_UNAVAILABLE',
        message: 'The result is still unknown. Retry verification.',
      },
    });
  });
  await page.getByLabel('NEAR transaction hash', { exact: true }).fill(wrongHash);
  await page.getByRole('button', { name: 'Verify this transaction' }).click();
  await expect(page.getByRole('alert')).toContainText('still unknown');
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard uncommitted decision' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Verify this transaction' })).toBeEnabled();
});

test('a confirmed receipt stays confirmed when the subsequent workspace refresh fails', async ({
  page,
}) => {
  const { operation, plan, state } = await fixture(page);
  let confirms = 0;
  let refreshFails = true;
  await page.route('**/api/v1/live/state?**', (r) =>
    refreshFails
      ? r.fulfill({
          status: 503,
          json: { code: 'RPC_UNAVAILABLE', message: 'Workspace temporarily unavailable.' },
        })
      : r.fulfill({ json: state }),
  );
  await page.route('**/api/v1/live/confirm', (r) => {
    confirms++;
    Object.assign(operation, { state: 'CONFIRMED', txHash: correctHash });
    Object.assign(plan, {
      state: 'COMPLETED',
      steps: plan.steps.map((step) => ({ ...step, state: 'CONFIRMED' })),
    });
    return r.fulfill({ json: operation });
  });
  await page.getByLabel('NEAR transaction hash', { exact: true }).fill(correctHash);
  await page.getByRole('button', { name: 'Verify this transaction' }).click();
  await expect(page.getByText('All steps confirmed', { exact: true })).toBeVisible();
  await expect(
    page.getByText('The decision was confirmed. The workspace refresh failed;', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verify this transaction' })).toHaveCount(0);
  refreshFails = false;
  await page.getByRole('button', { name: 'Retry workspace refresh', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry workspace refresh', exact: true }),
  ).toHaveCount(0);
  expect(confirms).toBe(1);
});

test('only a persisted initial-call failure permits preparing a fresh attempt', async ({
  page,
}) => {
  const { operation } = await fixture(page);
  await page.route('**/api/v1/live/confirm', (r) => {
    Object.assign(operation, { state: 'FAILED', failureKind: 'CONTRACT_CALL', txHash: wrongHash });
    return r.fulfill({
      status: 409,
      json: { code: 'CHAIN_CALL_FAILED', message: 'The initial call rolled back.' },
    });
  });
  let preparations = 0;
  await page.route('**/api/v1/live/prepare', (r) => {
    preparations++;
    return r.fulfill({
      status: 409,
      json: { code: 'PREVIEW_STALE', message: 'Review a new decision before signing.' },
    });
  });
  await page.getByLabel('NEAR transaction hash', { exact: true }).fill(wrongHash);
  await page.getByRole('button', { name: 'Verify this transaction' }).click();
  await expect(
    page.getByText('The initial contract call failed and rolled back.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discard uncommitted decision' })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry step 1 in NEAR wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('Review a new decision');
  expect(preparations).toBe(1);
});

test('a failed candidate does not unlock another unresolved candidate', async ({ page }) => {
  const { operation } = await fixture(page);
  await page.route('**/api/v1/live/confirm', (r) => {
    Object.assign(operation, {
      state: 'SUBMITTED',
      failedTxHashes: [wrongHash],
      pendingTxHashes: [correctHash],
    });
    return r.fulfill({
      status: 409,
      json: {
        code: 'CHAIN_CALL_FAILED',
        message: 'This candidate failed; another transaction is unresolved.',
      },
    });
  });
  await page.getByLabel('NEAR transaction hash', { exact: true }).fill(wrongHash);
  await page.getByRole('button', { name: 'Verify this transaction' }).click();
  await expect(page.getByRole('alert')).toContainText('another transaction is unresolved');
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard uncommitted decision' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry step 1 in NEAR wallet' })).toHaveCount(0);
});

test('a refunded withdrawal can be discarded but cannot be signed again', async ({ page }) => {
  const { operation, state } = await fixture(page);
  await page.route('**/api/v1/live/confirm', (r) => {
    Object.assign(operation, {
      state: 'FAILED',
      failureKind: 'TRANSFER_REFUNDED',
      txHash: wrongHash,
    });
    return r.fulfill({
      status: 409,
      json: {
        code: 'CHAIN_TRANSFER_REFUNDED',
        message: 'The contract restored the withdrawal balance.',
      },
    });
  });
  let discards = 0;
  await page.route('**/api/v1/live/commands', (r) => {
    expect(r.request().postDataJSON().action).toBe('plan.cancel');
    discards++;
    state.plans = [];
    return r.fulfill({ json: { state: 'CANCELLED' } });
  });
  await page.getByLabel('NEAR transaction hash', { exact: true }).fill(wrongHash);
  await page.getByRole('button', { name: 'Verify this transaction' }).click();
  await expect(
    page.getByText('The transfer failed and the contract restored the balance.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard uncommitted decision' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(discards).toBe(1);
});
