import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function sourceDigest(root = process.cwd()) {
  const files = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'playwright.config.ts',
    'vitest.config.ts',
    'README.md',
  ];
  const ignored = new Set(['node_modules', 'target', 'dist', '.git', 'data', 'logs']);
  async function walk(relative: string) {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  for (const directory of ['apps', 'packages', 'contracts', 'scripts', 'tests'])
    await walk(directory);
  const entries = [];
  for (const file of files.sort()) {
    const bytes = await readFile(join(root, file));
    entries.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    entries,
  };
}
