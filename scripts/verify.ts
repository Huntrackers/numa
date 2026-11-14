import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { release } from '../packages/domain/src/release.js';
import { sourceDigest } from './source-digest.js';

const args = process.argv.slice(2);
for (const arg of args)
  if (!['--browser', '--contract'].includes(arg))
    throw Error('Supported options: --browser --contract. Reports are written under artifacts/.');
const includeBrowser = args.includes('--browser'),
  includeContract = args.includes('--contract');
const npm =
  process.env.npm_execpath || createRequire(import.meta.url).resolve('npm/bin/npm-cli.js');
const startedAt = new Date().toISOString(),
  started = performance.now();
const reportDir = resolve('artifacts/verify/' + startedAt.replace(/[:.]/g, '-'));
await mkdir(reportDir, { recursive: true });
const before = await sourceDigest();
const steps: {
  name: string;
  command: string;
  status: string;
  durationMs?: number;
  exitCode?: number;
  log?: string;
}[] = [];
const relative = (file: string) => file.slice(process.cwd().length + 1).replaceAll('\\', '/');
async function run(
  name: string,
  script: string,
  flags: string[] = [],
  env: Record<string, string> = {},
) {
  const at = performance.now();
  const command = 'npm run ' + script + (flags.length ? ' -- ' + flags.join(' ') : '');
  console.log('Verifying ' + name + ': ' + command);
  const child = spawn(
    process.execPath,
    [npm, 'run', script, ...(flags.length ? ['--', ...flags] : [])],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    },
  );
  let output = '';
  child.stdout.on('data', (b) => {
    output += b;
    process.stdout.write(b);
  });
  child.stderr.on('data', (b) => {
    output += b;
    process.stderr.write(b);
  });
  const code = await new Promise<number>((r) => {
    child.on('error', (e) => {
      output += e.message;
      r(1);
    });
    child.on('exit', (c) => r(c ?? 1));
  });
  const log = resolve(reportDir, name + '.txt');
  await writeFile(log, output);
  steps.push({
    name,
    command,
    status: code === 0 ? 'PASS' : 'FAIL',
    exitCode: code,
    durationMs: Math.round(performance.now() - at),
    log: relative(log),
  });
  return code === 0;
}
let corePassed = await run('environment', 'doctor', includeBrowser ? ['--browser'] : []);
if (corePassed) corePassed = await run('format', 'format:check');
if (corePassed)
  corePassed = await run('unit-api', 'test', [
    '--reporter=json',
    '--outputFile=' + resolve(reportDir, 'unit.json'),
  ]);
if (corePassed) corePassed = await run('build', 'build');
if (corePassed)
  corePassed = await run('http-journey', 'review:smoke', [], {
    NUMA_REVIEW_REPORT: resolve(reportDir, 'review-smoke.json'),
  });
if (corePassed && includeBrowser)
  corePassed = await run('browser', 'test:e2e', ['--reporter=list,json'], {
    PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(reportDir, 'browser.json'),
  });
else
  steps.push({
    name: 'browser',
    command: 'npm run test:e2e',
    status: includeBrowser ? 'NOT_RUN_AFTER_FAILURE' : 'NOT_REQUESTED',
  });
if (corePassed && includeContract) corePassed = await run('contract', 'test:contract');
else
  steps.push({
    name: 'contract',
    command: 'npm run test:contract',
    status: includeContract ? 'NOT_RUN_AFTER_FAILURE' : 'NOT_REQUESTED',
  });
const after = await sourceDigest();
const sourceUnchanged = before.digest === after.digest;
const report = {
  product: release.name,
  version: release.version,
  startedAt,
  completedAt: new Date().toISOString(),
  status: corePassed && sourceUnchanged ? 'PASS' : 'FAIL',
  durationMs: Math.round(performance.now() - started),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  sourceDigest: after.digest,
  sourceUnchangedDuringVerification: sourceUnchanged,
  requestedProfile: { browser: includeBrowser, contract: includeContract },
  steps,
  scoring: {
    officialScore: null,
    internalProjectScore: null,
    note: 'Passing checks is evidence, not a contest score.',
  },
  boundaries: [
    'No mainnet transfers or human wallet signatures are performed.',
    'The HTTP journey is an isolated fixture journey.',
    'Live provider availability is checked separately using npm run intents:smoke.',
  ],
};
const target = resolve('artifacts/verification.json');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(report, null, 2));
await writeFile(resolve(reportDir, 'verification.json'), JSON.stringify(report, null, 2));
console.log('Verification ' + report.status + '. Report: ' + relative(target));
if (report.status !== 'PASS') process.exitCode = 1;
