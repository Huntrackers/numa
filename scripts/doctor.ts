import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { browserExecutable } from './browser.js';
import { release } from '../packages/domain/src/release.js';

const checks: { name: string; status: string; detail: string; required: boolean }[] = [];
const check = (name: string, passed: boolean, detail: string, required = true) =>
  checks.push({
    name,
    status: passed ? 'PASS' : required ? 'FAIL' : 'NOT_AVAILABLE',
    detail,
    required,
  });
check(
  'Node.js 24',
  Number(process.versions.node.split('.')[0]) === 24,
  process.version + '; use Node.js 24 LTS (see .nvmrc).',
);
try {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.prepare('SELECT 1').get();
  db.close();
  check('SQLite', true, 'Built-in Node SQLite opens and queries an in-memory database.');
} catch {
  check('SQLite', false, 'Use the documented Node.js 24 runtime.');
}
const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
check(
  'Locked package version',
  manifest.version === release.version && lock.packages[''].version === release.version,
  release.version + '; install using npm ci.',
);
let browser = '';
try {
  browser = browserExecutable() || chromium.executablePath();
} catch {}
check(
  'Browser',
  !!browser && existsSync(browser),
  browser && existsSync(browser)
    ? 'A usable Chromium executable is installed.'
    : 'Run npx playwright install chromium, or set CHROME_PATH to an installed browser.',
  process.argv.includes('--browser'),
);
check(
  'Built web assets',
  existsSync(resolve('dist/web/index.html')),
  'Run npm run build before npm run judge.',
  false,
);
const passed = checks.every((c) => !c.required || c.status === 'PASS');
console.log(
  JSON.stringify(
    {
      product: release.name,
      version: release.version,
      status: passed ? 'PASS' : 'FAIL',
      platform: process.platform,
      architecture: process.arch,
      checks,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;
