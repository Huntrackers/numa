import { test, expect } from '@playwright/test';

const tokens = [
  { assetId: 'base-usdc', symbol: 'USDC', blockchain: 'base', decimals: 6 },
  { assetId: 'near-usdc', symbol: 'USDC', blockchain: 'near', decimals: 6 },
];
for (const [userId, path, purpose] of [
  ['owner', '/company/forma/treasury', 'company funding'],
  ['maya', '/employee/wallets', 'salary conversion'],
  ['maya', '/employee/rules', 'salary allocation'],
  ['maya', '/employee/dca', 'DCA purchase'],
  ['maya', '/employee/invest', 'investment conversion'],
] as const) {
  test(`live dry preview is available in ${purpose} without a balance mutation`, async ({
    page,
  }) => {
    await page.request.post('/api/v1/auth/demo', {
      data: { userId },
      headers: { origin: 'http://127.0.0.1:4312' },
    });
    let writes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && !r.url().endsWith('/intents/preview')) writes++;
    });
    await page.route('**/api/v1/intents/tokens', (r) => r.fulfill({ json: { tokens } }));
    await page.route('**/api/v1/intents/preview', (r) => {
      expect(r.request().postDataJSON()).toMatchObject({ amount: '100', originAsset: 'base-usdc' });
      return r.fulfill({
        json: {
          origin: tokens[0],
          destination: tokens[1],
          amountIn: '100000000',
          amountOut: '99990000',
          minAmountOut: '98990000',
          slippageBps: 100,
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          timeEstimate: 35,
          signatureVerified: true,
          providerAppFees: [],
          feeNote: 'Preview only.',
          quoteDigest: 'browser-fixture',
        },
      });
    });
    await page.goto(path);
    await page.getByText(`Preview ${purpose} with NEAR Intents`, { exact: true }).click();
    await page.getByRole('button', { name: 'Use documented sample addresses' }).click();
    await page.getByRole('button', { name: 'Get signed route preview' }).click();
    await expect(
      page.getByText('Read-only preview. Funds moved: 0.', { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(0);
    await page.getByLabel('Amount', { exact: true }).fill('200');
    await expect(page.getByText('Provider signature verified', { exact: true })).toHaveCount(0);
  });
}
