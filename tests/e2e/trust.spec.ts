import { test, expect } from '@playwright/test';
const tokens = [
  { assetId: 'base-usdc', symbol: 'USDC', blockchain: 'base', decimals: 6 },
  { assetId: 'near-usdc', symbol: 'USDC', blockchain: 'near', decimals: 6 },
];
const catalog = async (page: any) =>
  page.route('**/api/v1/intents/tokens', async (route: any) => route.fulfill({ json: { tokens } }));
const response = (expires = 30000) => ({
  origin: tokens[0],
  destination: tokens[1],
  amountIn: '100000000',
  amountOut: '99990000',
  minAmountOut: '98990000',
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + expires).toISOString(),
  timeEstimate: 35,
  slippageBps: 100,
  signatureVerified: true,
  providerAppFees: [{ recipient: 'provider.near', fee: 1 }],
  feeNote: 'Provider fee schedule is reflected in quoted output.',
  quoteDigest: 'fixture-browser-only',
});
test('public review shows boundaries, recorded evidence and unsigned policy drills', async ({
  page,
}) => {
  await page.goto('/trust');
  await expect(
    page.getByRole('heading', { name: 'Follow the money. Inspect the boundaries.' }),
  ).toBeVisible();
  await expect(page.getByText('Recorded', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Accounting contract upgrade' })).toHaveAttribute(
    'href',
    /testnet.nearblocks.io/,
  );
  await page.getByRole('button', { name: 'Execution policy lab' }).click();
  await expect(page.getByText('BLOCK', { exact: true })).toHaveCount(8);
  await expect(page.getByText('ALLOW', { exact: true })).toHaveCount(1);
  await expect(page.getByText('No attack is sent to a network.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Try numa' }).click();
  await expect(page.getByRole('heading', { name: 'Walk through a payday.' })).toBeVisible();
});
test('signed route preview displays exact amounts, fee and invalidates after editing', async ({
  page,
}) => {
  await catalog(page);
  await page.route('**/api/v1/intents/preview', (route) => route.fulfill({ json: response() }));
  await page.goto('/trust?view=intents');
  await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
  await expect(page.getByLabel('Recipient address', { exact: false })).toHaveValue('wrap.near');
  await page.getByRole('button', { name: 'Get signed route preview' }).click();
  await expect(page.getByText('Provider signature verified', { exact: true })).toBeVisible();
  await expect(page.getByText('98.990000 USDC', { exact: true })).toBeVisible();
  await expect(page.getByText('Read-only preview. Funds moved: 0.', { exact: true })).toBeVisible();
  await expect(page.getByText('1 bps (0.01%)', { exact: false })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('200');
  await expect(page.getByText('Provider signature verified', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'A route you can inspect.' })).toBeVisible();
});
test('expired quotes are marked and an outage never displays a fabricated route', async ({
  page,
}) => {
  await catalog(page);
  await page.route('**/api/v1/intents/preview', (route) => route.fulfill({ json: response(200) }));
  await page.goto('/trust?view=intents');
  await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
  await page.getByRole('button', { name: 'Get signed route preview' }).click();
  await expect(page.getByText('Preview expired', { exact: true })).toBeVisible();
  await page.unroute('**/api/v1/intents/preview');
  await page.route('**/api/v1/intents/preview', (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: 'INTENTS_UNAVAILABLE',
        message: '1Click preview unavailable. No funds were moved.',
      },
    }),
  );
  await page.getByRole('button', { name: 'Get signed route preview' }).click();
  await expect(page.getByRole('alert')).toContainText('No funds were moved');
  await expect(page.getByText('Provider signature verified', { exact: true })).toHaveCount(0);
});
test('a late quote cannot restore results for inputs that have changed', async ({ page }) => {
  await catalog(page);
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => (finish = resolve));
  await page.route('**/api/v1/intents/preview', async (route) => {
    await pending;
    await route.fulfill({ json: response() }).catch(() => {});
  });
  await page.goto('/trust?view=intents');
  await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
  await page.getByRole('button', { name: 'Get signed route preview' }).click();
  await expect(page.getByRole('button', { name: 'Verifying provider quote…' })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('300');
  finish();
  await expect(page.getByRole('heading', { name: 'A route you can inspect.' })).toBeVisible();
  await expect(page.getByText('Provider signature verified', { exact: true })).toHaveCount(0);
});
test('mobile review and route form fit the viewport and are keyboard reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await catalog(page);
  await page.goto('/trust?view=intents');
  await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Get signed route preview' }).focus();
  await expect(page.getByRole('button', { name: 'Get signed route preview' })).toBeFocused();
  await page.getByRole('button', { name: 'Execution policy lab' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('review navigation preserves the operator workspace', async ({ page }) => {
  const r = await page.request.post('/api/v1/auth/demo', {
    data: { userId: 'admin' },
    headers: { origin: 'http://127.0.0.1:4312' },
  });
  expect(r.ok()).toBeTruthy();
  await page.goto('/admin/companies');
  await page.getByRole('button', { name: 'Execution & safety' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4312/trust');
  await page.getByRole('link', { name: 'Workspace access' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4312/admin/companies');
  await expect(page.getByRole('heading', { name: 'Companies', exact: true })).toBeVisible();
});

test('sample addresses wait for the live catalog to identify the route networks', async ({
  page,
}) => {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/intents/tokens', async (route) => {
    await ready;
    await route.fulfill({ json: { tokens } });
  });
  await page.goto('/trust?view=intents');
  await expect(
    page.getByRole('button', { name: 'Use documented sample addresses' }),
  ).toBeDisabled();
  release();
  await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
  await expect(page.getByLabel('Recipient address', { exact: false })).toHaveValue('wrap.near');
  await expect(page.getByRole('button', { name: 'Get signed route preview' })).toBeEnabled();
});
