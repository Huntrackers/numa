import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/db/src/index.js';
import { PersonalSimulation } from '../../apps/api/src/simulation.js';
import { seed } from '../../apps/api/src/seed.js';
test('verified identity completes a personal planning journey without changing the NEAR book', async ({
  page,
}) => {
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-ui-personal-')), 'db.sqlite'));
  seed(s);
  s.save({
    id: 'real-person',
    type: 'user',
    name: 'Real person',
    accountId: 'person.testnet',
    demo: false,
  });
  const a = { id: 'real-person', mode: 'TESTNET' as const },
    sim = new PersonalSimulation(s),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.route('**/api/v1/me', (r) =>
      r.fulfill({
        json: {
          user: { id: a.id, name: 'Real person', accountId: 'person.testnet' },
          mode: 'TESTNET',
          csrf: 'fixture',
        },
      }),
    );
    await page.route('**/api/v1/simulation/state', (r) => r.fulfill({ json: sim.state(a) }));
    await page.route('**/api/v1/simulation/commands', (r) => {
      const p = r.request().postDataJSON();
      try {
        return r.fulfill({
          json: sim.command(a, p.action, p.payload, r.request().headers()['idempotency-key']),
        });
      } catch (e: any) {
        return r.fulfill({ status: 422, json: { code: e.code, message: e.message } });
      }
    });
    await page.goto('/employee/overview?book=simulation');
    await expect(
      page.getByRole('button', { name: 'Plan a scenario payday', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Plan a scenario payday', exact: true }).click();
    await page.getByLabel('Scenario salary (demoUSD)', { exact: true }).fill('1000');
    await page
      .getByLabel('Hypothetical employer bonus reserve (demoUSD)', { exact: true })
      .fill('20');
    await page.getByRole('button', { name: 'Credit scenario salary', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '1,000.00 demoUSD', exact: true }),
    ).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: 'Invest', exact: true }).click();
    await page.getByRole('button', { name: 'Preview buy' }).first().click();
    await page.getByRole('button', { name: 'Preview order', exact: true }).click();
    await expect(page.locator('dialog')).toContainText('Minimum output');
    await page.getByRole('button', { name: 'Apply decision', exact: true }).click();
    expect(s.list('order', undefined, sim.actor(a).id)).toHaveLength(1);
    expect(s.list('chain-operation')).toHaveLength(0);
    await page
      .getByRole('navigation')
      .getByRole('button', { name: 'Borrow & Earn', exact: true })
      .click();
    await page.getByRole('button', { name: 'Try Earn', exact: true }).click();
    await page.getByLabel('Hypothetical market scenario').selectOption('LOSS');
    await page.getByRole('button', { name: 'Open scenario', exact: true }).click();
    await page.getByRole('button', { name: 'Exit scenario', exact: true }).click();
    await expect(page.getByText(/loss 15.00 demoUSD/)).toBeVisible();
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/numa-v1-personal-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    s.close();
  }
});

test('non-demo login offers a verified Meteor identity without sample personas', async ({
  page,
}) => {
  await page.route('**/api/v1/config', (r) =>
    r.fulfill({
      json: {
        demoEnabled: false,
        network: 'testnet',
        mainnetEnabled: false,
        contractId: 'vault.testnet',
      },
    }),
  );
  await page.goto('/login');
  await expect(
    page.getByRole('button', { name: 'Connect testnet wallet', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'I’m running a company' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Operator console', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/numa-v1-login-mobile.png', fullPage: true });
});
