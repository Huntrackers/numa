import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { promises as fs } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { format } from 'prettier';
const source = process.cwd(),
  dest = resolve(process.argv[2] || '../numa-v3.1-source');
if (dest === source || dest.startsWith(source + '/') || dest.startsWith(source + '\\'))
  throw Error('Export outside the application workspace.');
const publicQuote = JSON.parse(
  await fs.readFile(join(source, 'tests/fixtures/oneclick-signed-dry.json'), 'utf8'),
);
if (!verifyQuoteSignature(publicQuote)) throw Error('Public quote fixture signature is invalid.');
const publicSignature = publicQuote.signature;
await fs.mkdir(dest, { recursive: false });
const rootFiles = [
  'README.md',
  '.nvmrc',
  '.node-version',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
  '.prettierrc.json',
  '.env.example',
  '.gitignore',
  'START_NUMA.cmd',
  'START_NUMA.ps1',
  'STOP_NUMA.cmd',
  'STOP_NUMA.ps1',
];
const rejected = new Set([
  'node_modules',
  'dist',
  'data',
  'logs',
  'target',
  '.git',
  'tools',
  'test-results',
  'playwright-report',
  'artifacts',
]);
const entries = [];
async function copy(p) {
  const rel = relative(source, p).replaceAll('\\', '/');
  if (
    rel.split('/').some((s) => rejected.has(s)) ||
    rel.split('/').some((n) => n.startsWith('.env') && n !== '.env.example') ||
    /[.](sqlite|key|tmp)$/i.test(rel)
  )
    throw Error('Private or generated path rejected: ' + rel);
  const b = await fs.readFile(p);
  const scanText = b
    .toString('utf8')
    .split(publicSignature)
    .join('[verified public provider signature]');
  if (
    /ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}/.test(scanText) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(scanText)
  )
    throw Error('Secret-like material rejected: ' + rel);
  const out = join(dest, rel);
  await fs.mkdir(resolve(out, '..'), { recursive: true });
  await fs.writeFile(out, b);
  entries.push({
    path: rel,
    bytes: b.length,
    sha256: createHash('sha256').update(b).digest('hex'),
  });
}
async function walk(p) {
  for (const e of await fs.readdir(p, { withFileTypes: true })) {
    if (rejected.has(e.name) || e.isSymbolicLink()) continue;
    const f = join(p, e.name);
    if (e.isDirectory()) await walk(f);
    else await copy(f);
  }
}
for (const f of rootFiles) await copy(join(source, f));
for (const d of ['apps', 'packages', 'contracts', 'scripts', 'tests', '.github'])
  await walk(join(source, d));
for (const e of await fs.readdir(join(source, 'docs'), { withFileTypes: true })) {
  if (e.isFile() && /[.](md|json|txt)$/.test(e.name) && !e.name.startsWith('RELEASE_MANIFEST'))
    await copy(join(source, 'docs', e.name));
}
for (const d of ['final-fa-v1', 'hackathon-2026', 'licenses', 'v3', 'v3.1', 'submission'])
  await walk(join(source, 'docs', d));
entries.sort((a, b) => a.path.localeCompare(b.path));
const manifest = JSON.stringify(
  {
    product: 'numa',
    version: JSON.parse(await fs.readFile(join(source, 'package.json'), 'utf8')).version,
    generatedAt: new Date().toISOString(),
    privatePathsExcluded: true,
    entries,
  },
  null,
  2,
);
await fs.writeFile(
  join(dest, 'SOURCE_MANIFEST.json'),
  await format(manifest, {
    ...JSON.parse(await fs.readFile(join(source, '.prettierrc.json'), 'utf8')),
    parser: 'json',
  }),
);
console.log(
  JSON.stringify({ destination: dest, files: entries.length, privatePathsExcluded: true }),
);
