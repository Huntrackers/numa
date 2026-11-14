import { it, expect } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../packages/db/src/index.js';
import { dailyBackup } from '../packages/db/src/backups.js';
it('creates a consistent daily snapshot, skips repeats and retains seven files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'numa-backup-')),
    s = new Store(join(dir, 'test.sqlite'));
  try {
    s.save({ id: 'test', type: 'proof', name: 'Durable' });
    const file = await dailyBackup(s);
    expect(file).toBeTruthy();
    const restored = new DatabaseSync(file!);
    expect((restored.prepare('PRAGMA integrity_check').get() as any).integrity_check).toBe('ok');
    expect(restored.prepare("SELECT id FROM entities WHERE id='test'").get()).toBeTruthy();
    restored.close();
    expect(await dailyBackup(s)).toBeNull();
    for (let i = 0; i < 8; i++) await dailyBackup(s, true);
    expect(readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.sqlite'))).toHaveLength(7);
  } finally {
    s.close();
  }
});
it('snapshots version one before migration and makes finalized events immutable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'numa-migration-')),
    file = join(dir, 'old.sqlite'),
    db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT);INSERT INTO migrations VALUES(1,'old');",
  );
  db.close();
  const s = new Store(file);
  try {
    expect(readdirSync(join(dir, 'backups')).some((f) => f.includes('pre-migration'))).toBe(true);
    s.save({ id: 'event', type: 'chain-event', sequence: 1 });
    expect(() => s.save({ ...s.get('event')!, sequence: 2 })).toThrow('immutable');
    expect(() => s.db.prepare("DELETE FROM entities WHERE id='event'").run()).toThrow('immutable');
  } finally {
    s.close();
  }
});
