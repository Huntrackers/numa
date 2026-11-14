import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const source = new DatabaseSync(resolve(process.env.NOMA_DATA_DIR || 'data', 'noma.sqlite'));
const dest = join(mkdtempSync(join(tmpdir(), 'noma-restore-')), 'restored.sqlite');
await backup(source, dest);
const restored = new DatabaseSync(dest);
try {
  assert.equal((restored.prepare('PRAGMA integrity_check').get() as any).integrity_check, 'ok');
  for (const table of ['entities', 'ledger_entries', 'ledger_lines', 'outbox']) {
    const a = (source.prepare('SELECT count(*) as n FROM ' + table).get() as any).n;
    const b = (restored.prepare('SELECT count(*) as n FROM ' + table).get() as any).n;
    assert.equal(a, b, table);
    console.log(table, a, 'rows restored');
  }
  console.log('SQLite backup restored and integrity checked successfully.');
} finally {
  source.close();
  restored.close();
}
