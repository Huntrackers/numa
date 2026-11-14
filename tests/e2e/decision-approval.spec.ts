import { test, expect, type Page } from '@playwright/test';

const accountId = 'approval-user.testnet';
const challenge = {
  id: 'a'.repeat(48),
  nonce: Buffer.alloc(32).toString('base64'),
  recipient: '127.0.0.1:4312',
  accountId,
  network: 'testnet',
  commandHash: 'b'.repeat(64),
  message: 'numa decision approval - role.save - exact request bound to NEAR testnet identity',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};
// Only the wallet transport is a fixture. Cryptographic verification is exercised in approvals.test.ts.
const executor = `window.selector.ready({
  signIn:async()=>[{accountId:'${accountId}'}],getAccounts:async()=>[{accountId:'${accountId}'}],
  signMessage:async p=>{await window.selector.ui.showIframe();document.body.innerHTML='<h1>NEAR decision signature</h1><pre></pre><button>Sign fixture proof</button><button>Reject fixture proof</button>';document.querySelector('pre').textContent=JSON.stringify(p);return new Promise((resolve,reject)=>{
    document.querySelectorAll('button')[0].onclick=()=>{window.selector.ui.hideIframe();resolve({accountId:'${accountId}',publicKey:'ed25519:fixture-public-key',signature:'fixture-signature'});};
    document.querySelectorAll('button')[1].onclick=()=>{window.selector.ui.hideIframe();reject({message:'Decision signature rejected',type:'userRejected'});};
  });}
});`;

async function setup(page: Page, recipient = challenge.recipient) {
  let mutations = 0;
  let first: { body: any; key: string | undefined } | undefined;
  let proof: any;
  await page.route('**/api/v1/me', (r) =>
    r.fulfill({
      json: { mode: 'TESTNET', user: { id: 'owner', accountId, name: accountId }, csrf: 'fixture' },
    }),
  );
  await page.route('**/api/v1/live/state?**', (r) =>
    r.fulfill({
      json: {
        mode: 'TESTNET',
        network: 'testnet',
        unit: 'testNEAR',
        contractId: 'vault.testnet',
        user: { id: 'owner', accountId },
        company: { id: 'mine', name: 'My company', timezone: 'UTC' },
        chain: { free: '1000000000000000000000000', reserved: '0' },
        access: 'owner',
        workspaces: [],
        roles: mutations
          ? [
              {
                id: 'new-role',
                name: 'Design',
                salary: '100000000000000000000000',
                cadence: 'monthly',
                version: 1,
              },
            ]
          : [],
        employees: [],
        plans: [],
        operations: [],
        obligations: [],
        notifications: [],
        audit: [],
        members: [],
      },
    }),
  );
  await page.route('**/wallet/meteor.js?**', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: executor }),
  );
  await page.route('**/api/v1/live/commands', (r) => {
    const request = r.request();
    const body = request.postDataJSON();
    const key = request.headers()['idempotency-key'];
    expect(body.action).toBe('role.save');
    const header = request.headers()['x-numa-approval'];
    if (!header) {
      first = { body, key };
      return r.fulfill({
        status: 428,
        json: {
          code: 'APPROVAL_REQUIRED',
          message: 'NEAR signature required.',
          approval: { ...challenge, recipient },
        },
      });
    }
    expect(body).toEqual(first!.body);
    expect(key).toBe(first!.key);
    proof = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    mutations++;
    return r.fulfill({ json: { id: 'new-role' } });
  });
  await page.goto('/company/mine/roles');
  await page.getByRole('button', { name: 'Add job role', exact: true }).click();
  await page.getByRole('textbox', { name: 'Job role', exact: true }).fill('Design');
  await page.getByRole('button', { name: 'Save job role', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Approve with your NEAR identity' }),
  ).toBeVisible();
  return { mutations: () => mutations, proof: () => proof };
}

test('cancelling a sensitive decision never retries or mutates the record', async ({ page }) => {
  const state = await setup(page);
  await expect(
    page.getByText('This message signature uses no gas', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel decision', exact: true }).click();
  await expect(
    page
      .getByText('No decision was applied. Wallet approval was cancelled.', { exact: true })
      .last(),
  ).toBeVisible();
  expect(state.mutations()).toBe(0);
  await expect(page.getByRole('heading', { name: 'Create job role', exact: true })).toBeVisible();
});

test('exact reviewed decision reaches Meteor and retries with the same idempotency key', async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Sign decision in NEAR wallet', exact: true }).click();
  const frame = page.locator('iframe[sandbox="allow-scripts"]').last().contentFrame();
  await expect(frame.getByRole('heading', { name: 'NEAR decision signature' })).toBeVisible();
  const signed = JSON.parse(await frame.locator('pre').innerText());
  expect(signed.message).toBe(challenge.message);
  expect(signed.recipient).toBe(challenge.recipient);
  expect(signed.network).toBe('testnet');
  expect(signed.signerId).toBe(accountId);
  expect(Object.values(signed.nonce)).toHaveLength(32);
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.hot-connector-popup .modal-content').last()).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 0, 0)',
  );
  await frame.getByRole('button', { name: 'Sign fixture proof' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Design' })).toBeVisible();
  expect(state.mutations()).toBe(1);
  expect(state.proof()).toEqual({
    challengeId: challenge.id,
    accountId,
    publicKey: 'ed25519:fixture-public-key',
    signature: 'fixture-signature',
  });
});

test('a rejected wallet signature leaves the review open and applies nothing', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Sign decision in NEAR wallet', exact: true }).click();
  const frame = page.locator('iframe[sandbox="allow-scripts"]').last().contentFrame();
  await expect(page.locator('.hot-connector-popup .modal-content').last()).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 0, 0)',
  );
  await frame.getByRole('button', { name: 'Reject fixture proof' }).click();
  await expect(page.getByText('Decision signature rejected', { exact: true })).toBeVisible();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(
    page.getByRole('button', { name: 'Sign decision in NEAR wallet', exact: true }),
  ).toBeEnabled();
  expect(state.mutations()).toBe(0);
});

test('a foreign approval domain is blocked before the wallet sees it', async ({ page }) => {
  const state = await setup(page, 'foreign.example');
  await page.getByRole('button', { name: 'Sign decision in NEAR wallet', exact: true }).click();
  await expect(
    page.getByText('The approval recipient or network does not match this application.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.mutations()).toBe(0);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});
