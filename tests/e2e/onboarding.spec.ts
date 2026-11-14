import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const accountId = 'new-owner.testnet';
const directory = {
  accountId,
  network: 'testnet',
  workspaces: [] as any[],
  employments: [],
};
const registration = {
  id: 'register-company-decision',
  label: 'Register company on NEAR',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  effects: {},
  steps: [
    {
      label: 'Register Northbound Labs',
      method: 'register_company',
      args: { company_id: 'c_opaque', operation_id: 'register_c_opaque' },
      deposit: '0',
      state: 'PENDING',
    },
  ],
};
const draft = {
  id: 'owned-company',
  name: 'Northbound Labs',
  timezone: 'UTC',
  access: 'owner',
  status: 'ACTIVE',
  chainState: 'DRAFT',
};
async function authenticated(page: Page, data = directory) {
  await page.route('**/api/v1/me', (r) =>
    r.fulfill({
      json: {
        user: { id: 'owner', name: accountId, accountId, role: 'user' },
        mode: 'TESTNET',
        csrf: 'fixture-csrf',
      },
    }),
  );
  await page.route('**/api/v1/onboarding', (r) => r.fulfill({ json: data }));
}
async function accessible(page: Page) {
  await page.evaluate(axe);
  const violations = await page.evaluate(async () =>
    (
      await (window as any).axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
    ).violations.map((v: any) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n: any) => n.target),
    })),
  );
  expect(violations).toEqual([]);
}

test('a fresh verified wallet creates a recoverable company draft before any NEAR signature', async ({
  page,
}) => {
  let created = false;
  const commands: any[] = [];
  const forbidden: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('companyId=forma')) forbidden.push(r.url());
  });
  await authenticated(page);
  await page.route('**/api/v1/onboarding', (r) =>
    r.fulfill({
      json: created
        ? { ...directory, workspaces: [{ ...draft, registrationPlan: registration }] }
        : directory,
    }),
  );
  await page.route('**/api/v1/live/commands', (r) => {
    const body = r.request().postDataJSON();
    commands.push(body);
    created = true;
    return r.fulfill({ json: { company: draft, plan: registration } });
  });
  await page.goto('/workspaces/new');
  await expect(
    page.getByRole('heading', { name: 'Create your company', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Company name', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: 'Company name', exact: true }).fill('Northbound Labs');
  await page.getByRole('textbox', { name: /Company timezone/ }).fill('UTC');
  await page.getByRole('button', { name: 'Review NEAR registration', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Register company on NEAR');
  await expect(page.getByRole('button', { name: 'Sign step 1 in NEAR wallet' })).toBeVisible();
  expect(commands).toEqual([
    { action: 'company.create', payload: { name: 'Northbound Labs', timezone: 'UTC' } },
  ]);
  await page.getByRole('button', { name: 'Continue later' }).click();
  await expect(page.getByText('NEAR registration unfinished', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Resume NEAR registration', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Register company on NEAR');
  expect(commands).toHaveLength(1);
  expect(forbidden).toEqual([]);
});

test('expired drafts review the same company registration and never create a replacement company', async ({
  page,
}) => {
  const commands: any[] = [];
  await authenticated(page, { ...directory, workspaces: [draft] });
  await page.route('**/api/v1/live/commands', (r) => {
    commands.push(r.request().postDataJSON());
    return r.fulfill({ json: { company: draft, plan: registration } });
  });
  await page.goto('/workspaces');
  await page.getByRole('button', { name: 'Review NEAR registration', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(commands).toEqual([
    { action: 'company.register', payload: { id: draft.id }, companyId: draft.id },
  ]);
});

test('a saved company and its NEAR decision survive a failed directory refresh without a duplicate submit', async ({
  page,
}) => {
  let created = false;
  let creates = 0;
  await authenticated(page);
  await page.route('**/api/v1/onboarding', (r) =>
    created
      ? r.fulfill({
          status: 503,
          json: {
            code: 'DIRECTORY_UNAVAILABLE',
            message: 'Workspace directory temporarily unavailable.',
          },
        })
      : r.fulfill({ json: directory }),
  );
  await page.route('**/api/v1/live/commands', (r) => {
    expect(r.request().postDataJSON().action).toBe('company.create');
    creates++;
    created = true;
    return r.fulfill({ json: { company: draft, plan: registration } });
  });
  await page.goto('/workspaces/new');
  await page.getByRole('textbox', { name: 'Company name', exact: true }).fill(draft.name);
  await page.getByRole('button', { name: 'Review NEAR registration', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Register company on NEAR');
  await page.getByRole('button', { name: 'Continue later' }).click();
  await expect(page.getByText(/Your company draft is saved/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review NEAR registration', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Review NEAR registration', exact: true }),
  ).toHaveCount(0);
  expect(creates).toBe(1);
});

test('a delayed company response never opens a previous wallet decision after a different identity signs in', async ({
  page,
}) => {
  const nextAccount = 'different-owner.testnet';
  let switched = false;
  let released: () => void = () => {};
  let posted: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    released = resolve;
  });
  const sent = new Promise<void>((resolve) => {
    posted = resolve;
  });
  await page.route('**/api/v1/me', (r) =>
    r.fulfill({
      json: {
        user: {
          id: switched ? 'different-owner' : 'owner',
          name: switched ? nextAccount : accountId,
          accountId: switched ? nextAccount : accountId,
          role: 'user',
        },
        mode: 'TESTNET',
        csrf: 'fixture-csrf',
      },
    }),
  );
  await page.route('**/api/v1/onboarding', (r) =>
    r.fulfill({ json: { ...directory, accountId: switched ? nextAccount : accountId } }),
  );
  await page.route('**/api/v1/live/commands', async (r) => {
    posted();
    await gate;
    await r.fulfill({ json: { company: draft, plan: registration } });
  });
  await page.route('**/api/v1/auth/logout', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/wallet/meteor.js?**', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `window.selector.ready({
    signIn:async()=>[{accountId:'${nextAccount}'}],getAccounts:async()=>[{accountId:'${nextAccount}'}],signOut:async()=>{},
    signMessage:async()=>({accountId:'${nextAccount}',publicKey:'ed25519:test-public-key',signature:'test-public-signature'})
  });`,
    }),
  );
  await page.route('**/api/v1/auth/challenges', (r) =>
    r.fulfill({
      json: {
        id: 'test-login-challenge',
        message: 'Test fixture login. No funds.',
        nonce: Buffer.alloc(32).toString('base64'),
        recipient: '127.0.0.1:4312',
      },
    }),
  );
  await page.route('**/api/v1/auth/verify', (r) => {
    switched = true;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto('/workspaces/new');
  await page
    .getByRole('textbox', { name: 'Company name', exact: true })
    .fill('Previous wallet company');
  await page.getByRole('button', { name: 'Review NEAR registration', exact: true }).click();
  await sent;
  try {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Connect testnet wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Verify testnet identity', exact: true }).click();
    await expect(page.locator('.workspace-entry-account')).toHaveText(nextAccount);
    const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/live/commands'));
    released();
    await response;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Previous wallet company', { exact: true })).toHaveCount(0);
    await expect(page.locator('.workspace-entry-account')).toHaveText(nextAccount);
  } finally {
    released();
  }
});

test('workspaces use actual memberships and preserve the company route', async ({ page }) => {
  await authenticated(page, {
    ...directory,
    workspaces: [
      { ...draft, chainState: 'REGISTERED' },
      {
        ...draft,
        id: 'second-company',
        name: 'Second company',
        access: 'observer',
        chainState: 'REGISTERED',
      },
    ],
  });
  await page.goto('/workspaces');
  await expect(page.getByRole('heading', { name: 'Second company', exact: true })).toBeVisible();
  await expect(page.getByText('Observer · UTC', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Platform administration' })).toHaveCount(0);
  await accessible(page);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Second company' })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(page).toHaveURL(/\/company\/second-company\/overview$/);
});

test('invitation metadata stays redacted for the wrong wallet and switch account retains the invite path', async ({
  page,
}) => {
  await authenticated(page);
  await page.route('**/api/v1/invitations/**', (r) =>
    r.fulfill({ json: { status: 'WRONG_ACCOUNT' } }),
  );
  await page.route('**/api/v1/auth/logout', (r) => r.fulfill({ json: { ok: true } }));
  await page.goto('/invite/' + 'a'.repeat(64));
  await expect(
    page.getByRole('heading', { name: 'Use the invited NEAR account', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Review NEAR acceptance|Approve company access/ }),
  ).toHaveCount(0);
  await expect(page.getByText('Northbound Labs', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch NEAR account', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect testnet wallet', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/invite\/a{64}$/);
});

test('employment invitations show exact pay terms and resume a saved NEAR decision', async ({
  page,
}) => {
  await authenticated(page);
  const acceptance = {
    ...registration,
    id: 'accept-employment',
    label: 'Accept employment on NEAR',
    commit: { employeeId: 'employee-one' },
    steps: [
      { method: 'accept_employment', label: 'Accept Northbound Labs', state: 'PENDING', args: {} },
    ],
  };
  await page.route('**/api/v1/invitations/**', (r) =>
    r.fulfill({
      json: {
        status: 'READY',
        kind: 'EMPLOYMENT',
        companyId: draft.id,
        companyName: draft.name,
        accountId,
        employee: {
          name: 'Jordan',
          jobRole: 'Engineer',
          salary: '100000000000000000000000',
          cadence: 'weekly',
        },
        expiresAt: registration.expiresAt,
        plan: acceptance,
      },
    }),
  );
  let commands = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/live/commands')) commands++;
  });
  await page.goto('/invite/' + 'b'.repeat(64));
  await expect(page.getByRole('definition').filter({ hasText: '0.10 testNEAR' })).toBeVisible();
  await expect(page.getByText('Pay per week', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve company access with NEAR' })).toHaveCount(
    0,
  );
  await accessible(page);
  await page.getByRole('button', { name: 'Resume employment acceptance', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Accept employment on NEAR');
  expect(commands).toBe(0);
});

test('company access invitations call only member.accept and continue into the actual company', async ({
  page,
}) => {
  let accepted = false;
  const commands: any[] = [];
  const token = 'd'.repeat(64);
  await authenticated(page);
  await page.route('**/api/v1/invitations/**', (r) =>
    r.fulfill({
      json: {
        status: accepted ? 'ACCEPTED' : 'READY',
        kind: 'MEMBERSHIP',
        companyId: draft.id,
        companyName: draft.name,
        accountId,
        access: 'accountant',
        expiresAt: registration.expiresAt,
      },
    }),
  );
  await page.route('**/api/v1/live/commands', (r) => {
    commands.push(r.request().postDataJSON());
    accepted = true;
    return r.fulfill({ json: { tenant: draft.id, access: 'accountant' } });
  });
  await page.goto('/invite/' + token);
  await expect(page.getByRole('button', { name: 'Review NEAR acceptance' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve company access with NEAR', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'You have accepted this invitation', exact: true }),
  ).toBeVisible();
  expect(commands).toEqual([{ action: 'member.accept', payload: { token } }]);
  await page.getByRole('button', { name: 'Open company workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/company\/owned-company\/overview$/);
});

for (const [status, heading] of [
  ['EXPIRED', 'This invitation has expired'],
  ['REVOKED', 'This invitation is no longer active'],
  ['REGISTRATION_PENDING', 'Your company has one more step'],
] as const) {
  test(status.toLowerCase() + ' invitation has no acceptance button', async ({ page }) => {
    await authenticated(page);
    await page.route('**/api/v1/invitations/**', (r) =>
      r.fulfill({ json: { status, kind: 'EMPLOYMENT', companyName: draft.name, accountId } }),
    );
    await page.goto('/invite/' + 'e'.repeat(64));
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Review NEAR acceptance|Approve company access/ }),
    ).toHaveCount(0);
  });
}

test('workspace and invitation entry fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await authenticated(page, {
    ...directory,
    workspaces: [
      {
        ...draft,
        name: 'A long but valid company name for a small screen',
        registrationPlan: registration,
      },
    ],
  });
  await page.goto('/workspaces/new');
  await expect(page.getByRole('textbox', { name: 'Company name', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
  await page.route('**/api/v1/invitations/**', (r) =>
    r.fulfill({
      json: {
        status: 'READY',
        kind: 'MEMBERSHIP',
        companyName: draft.name,
        accountId,
        access: 'accountant',
      },
    }),
  );
  await page.goto('/invite/' + 'f'.repeat(64));
  await expect(
    page.getByRole('button', { name: 'Approve company access with NEAR', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
});

test('NEAR network separates signed local decisions from settlement and clears stale proofs on refresh failure', async ({
  page,
}) => {
  await authenticated(page);
  await page.route('**/api/v1/live/state?**', (r) =>
    r.fulfill({
      json: {
        mode: 'TESTNET',
        unit: 'testNEAR',
        network: 'testnet',
        contractId: 'vault.testnet',
        user: { id: 'owner', accountId, name: accountId },
        workspaces: [],
        notifications: [],
      },
    }),
  );
  await page.route('**/api/v1/chain/context', (r) =>
    r.fulfill({ json: { mode: 'TESTNET', accountId, contractId: 'vault.testnet' } }),
  );
  let failed = false;
  await page.route('**/api/v1/approvals', (r) =>
    failed
      ? r.fulfill({
          status: 503,
          json: { code: 'UNAVAILABLE', message: 'Signed decisions are temporarily unavailable.' },
        })
      : r.fulfill({
          json: [
            {
              id: 'approved-role',
              accountId,
              endpoint: '/api/v1/live/commands',
              action: 'role.save',
              companyId: draft.id,
              commandHash: 'a'.repeat(64),
              recipient: '127.0.0.1:4312',
              message:
                'numa decision approval - NEAR testnet - NEP-413\nAction: role.save\nThis signature does not transfer tokens.',
              nonce: 'public-nonce',
              publicKey: 'ed25519:public-key',
              signature: 'public-signature',
              approvedAt: new Date().toISOString(),
              state: 'APPLIED',
            },
          ],
        }),
  );
  await page.goto('/company/' + draft.id + '/network');
  await expect(
    page.getByRole('heading', { name: 'Your signed decisions', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'role.save', exact: true })).toBeVisible();
  await expect(page.getByText('Applied local decision', { exact: true })).toBeVisible();
  await page.getByText('View signed proof', { exact: true }).click();
  await expect(page.locator('.signed-decision-message')).toContainText(
    'This signature does not transfer tokens.',
  );
  await expect(page.locator('.signed-decision-proof')).toContainText('a'.repeat(64));
  await accessible(page);
  failed = true;
  await page.getByRole('button', { name: 'Refresh signed decisions', exact: true }).click();
  await expect(
    page.getByText('Signed decisions are temporarily unavailable.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'role.save', exact: true })).toHaveCount(0);
  await expect(page.getByText('Applied local decision', { exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Refresh signed decisions', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'role.save', exact: true })).toBeVisible();
});

test('sample network never requests private signed decision history', async ({ page }) => {
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v1/approvals')) requests++;
  });
  await page.route('**/api/v1/chain/context', (r) =>
    r.fulfill({ json: { mode: 'DEMO', contractId: 'vault.testnet' } }),
  );
  await page.goto('/login');
  await page.getByRole('button', { name: 'I’m running a company' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'NEAR testnet', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Connect your testnet identity', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your signed decisions', exact: true }),
  ).toHaveCount(0);
  expect(requests).toBe(0);
});
