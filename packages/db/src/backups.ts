import { backup } from 'node:sqlite';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { Store } from './index.js';
let running = false;
export async function dailyBackup(s: Store, force = false) {
  if (running) return null;
  const previous = s.get('backup-status');
  if (!force && previous?.lastSuccessAt?.slice(0, 10) === new Date().toISOString().slice(0, 10))
    return null;
  running = true;
  try {
    const databases = s.db.prepare('PRAGMA database_list').all() as any[];
    const source = databases.find((d) => d.name === 'main')?.file;
    if (!source) return null;
    const dir = resolve(dirname(source), 'backups');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'numa-' + new Date().toISOString().replaceAll(':', '-') + '.sqlite');
    await backup(s.db, file);
    const records = await Promise.all(
      (await readdir(dir))
        .filter((f) => /^numa-.*\.sqlite$/.test(f))
        .map(async (name) => ({ name, time: (await stat(join(dir, name))).mtimeMs })),
    );
    const files = records.sort((a, b) => b.time - a.time).map((r) => r.name);
    for (const name of files.slice(7)) {
      const target = resolve(dir, name);
      if (dirname(target) !== dir) throw Error('Backup path escaped its directory.');
      await unlink(target);
    }
    const bytes = (await stat(file)).size;
    s.atomic(() =>
      s.save({
        id: 'backup-status',
        type: 'backup-status',
        lastSuccessAt: new Date().toISOString(),
        file,
        bytes,
        retention: 7,
      }),
    );
    return file;
  } catch (e: any) {
    s.atomic(() =>
      s.save({
        id: 'backup-status',
        type: 'backup-status',
        lastError: String(e.message).slice(0, 180),
      }),
    );
    throw e;
  } finally {
    running = false;
  }
}
