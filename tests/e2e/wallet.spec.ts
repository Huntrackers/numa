import { test, expect } from '@playwright/test';
const boundary = `window.selector.ready({
 signIn:async p=>{if(p.network!=='testnet'||p.addFunctionCallKey)throw Error('Unexpected wallet authority');return [{accountId:'wallet-boundary.testnet'}];},
 getAccounts:async()=>[{accountId:'wallet-boundary.testnet'}],
 signMessage:async p=>{await window.selector.ui.showIframe();document.body.innerHTML='<h1>Signature boundary</h1><pre></pre><button>Cancel signature</button>';document.querySelector('pre').textContent=JSON.stringify(p);return new Promise((resolve,reject)=>{document.querySelector('button').addEventListener('click',()=>{window.selector.ui.hideIframe();reject({message:'Wallet verification canceled in test',type:'userRejected'});});});},
 signAndSendTransaction:async p=>{await window.selector.ui.showIframe();document.body.innerHTML='<h1>Transaction boundary</h1><pre></pre><button>Cancel transaction</button>';document.querySelector('pre').textContent=JSON.stringify(p);return new Promise((resolve,reject)=>{document.querySelector('button').addEventListener('click',()=>{window.selector.ui.hideIframe();reject({message:'Transaction canceled in test',type:'userRejected'});});});}
});`;
test('Meteor NEP-413 uses testnet, a bounded nonce and no function-call key', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/wallet/meteor.js?**', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: boundary }),
  );
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'NEAR testnet', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connect testnet wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Verify testnet identity', exact: true }).click();
  const frame = page.locator('iframe[sandbox="allow-scripts"]').last().contentFrame();
  await expect(frame.getByRole('heading', { name: 'Signature boundary' })).toBeVisible();
  const p = JSON.parse(await frame.locator('pre').innerText());
  expect(p.network).toBe('testnet');
  expect(Object.values(p.nonce)).toHaveLength(32);
  expect(p.recipient).toBe('127.0.0.1:4312');
  expect(p.message).toContain('does not authorize a transfer');
  expect(p.callbackUrl).toBeUndefined();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  await frame.getByRole('button', { name: 'Cancel signature' }).press('Enter');
  await expect(
    page.getByText('Wallet verification canceled in test', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('the pinned Meteor adapter initializes under the application CSP', async ({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('Wallet console:', m.text());
  });
  page.on('pageerror', (e) => console.log('Wallet page error:', e.message));
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__csp.push(e.violatedDirective + ':' + e.blockedURI),
    );
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'NEAR testnet', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connect testnet wallet', exact: true }).click();
  const frame = page.locator('iframe[sandbox="allow-scripts"]').last().contentFrame();
  await expect(frame.getByRole('button', { name: /Meteor Web/i })).toBeVisible({ timeout: 20000 });

  await page.screenshot({ path: 'test-results/meteor-connect.png', fullPage: true });
  await page
    .context()
    .route('https://wallet.meteorwallet.app/**', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<h1>Official Meteor wallet boundary</h1>' }),
    );
  const popupPromise = page.waitForEvent('popup');
  await frame.getByRole('button', { name: /Meteor Web/i }).click();
  const popup = await popupPromise;
  expect(new URL(popup.url()).hostname).toBe('wallet.meteorwallet.app');
  await popup.close();
  expect(
    (await page.evaluate(() => (window as any).__csp)).filter((v: string) =>
      v.startsWith('script-src'),
    ),
  ).toEqual([]);
});

test('the prepared withdrawal reaches Meteor unchanged and cancellation re-arms only the same operation', async ({
  page,
}) => {
  const account = 'wallet-boundary.testnet',
    amount = '100000000000000000000000',
    operation = 'bounded-op';
  let dispatches = 0,
    declines = 0;
  let operationState = 'PREPARED';
  await page.route('**/api/v1/operations/' + operation, (r) =>
    r.fulfill({ json: { id: operation, state: operationState } }),
  );
  await page.route('**/wallet/meteor.js?**', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: boundary }),
  );
  await page.route('**/api/v1/me', (r) =>
    r.fulfill({
      json: {
        user: { id: 'wallet', name: account, accountId: account },
        mode: 'TESTNET',
        csrf: 'test',
      },
    }),
  );
  await page.route('**/api/v1/live/state?**', (r) =>
    r.fulfill({
      json: {
        mode: 'TESTNET',
        unit: 'testNEAR',
        network: 'testnet',
        contractId: 'vault.testnet',
        user: { id: 'wallet', accountId: account },
        serverTime: new Date().toISOString(),
        plans: [],
        operations: [],
        notifications: [],
        workspaces: [],
        obligations: [],
        account: {
          cash: '1000000000000000000000000',
          policy: { goals: [], goal_bps: 0, cash_floor: '0' },
        },
      },
    }),
  );
  const plan = {
    id: 'withdraw',
    label: 'Withdraw your testNEAR',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    effects: { amount },
    steps: [{ method: 'request_withdrawal', label: 'Withdraw free salary cash', state: 'PENDING' }],
  };
  await page.route('**/api/v1/live/commands', (r) => r.fulfill({ json: { plan } }));
  await page.route('**/api/v1/live/prepare', (r) =>
    r.fulfill({
      json: {
        operationId: operation,
        id: operation,
        state: 'PREPARED',
        accountId: account,
        transaction: {
          signerId: account,
          receiverId: 'vault.testnet',
          actions: [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'request_withdrawal',
                args: { amount, operation_id: operation },
                gas: '100000000000000',
                deposit: '0',
              },
            },
          ],
        },
      },
    }),
  );
  await page.route('**/api/v1/live/dispatch', (r) => {
    dispatches++;
    operationState = 'DISPATCHED';
    return r.fulfill({ json: { id: operation, state: operationState } });
  });
  await page.route('**/api/v1/live/declined', (r) => {
    declines++;
    operationState = 'PREPARED';
    expect(r.request().postDataJSON().operationId).toBe(operation);
    return r.fulfill({ json: { id: operation, state: operationState } });
  });
  await page.goto('/employee/overview');
  await page.getByRole('button', { name: 'Withdraw testNEAR', exact: true }).click();
  await page.getByLabel('Amount in testNEAR', { exact: true }).fill('0.1');
  await page.getByRole('button', { name: /Review withdrawal/ }).click();
  await page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' }).click();
  const frame = page.locator('iframe[sandbox="allow-scripts"]').last().contentFrame();
  await expect(frame.getByRole('heading', { name: 'Transaction boundary' })).toBeVisible();
  const input = JSON.parse(await frame.locator('pre').innerText());
  expect(input.network).toBe('testnet');
  expect(input.receiverId).toBe('vault.testnet');
  expect(input.signerId).toBe(account);
  expect(input.actions).toHaveLength(1);
  expect(input.actions[0].params.args).toEqual({ amount, operation_id: operation });
  expect(input.actions[0].params.deposit).toBe('0');
  await frame.getByRole('button', { name: 'Cancel transaction' }).press('Enter');
  await expect(page.getByText('Transaction canceled in test', { exact: true })).toBeVisible();
  expect(dispatches).toBe(1);
  expect(declines).toBe(1);
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toBeEnabled();
});
