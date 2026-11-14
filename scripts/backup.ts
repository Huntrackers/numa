import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve(process.env.NOMA_DATA_DIR || 'data');
mkdirSync(resolve(dir, 'backups'), { recursive: true });
const db = new DatabaseSync(resolve(dir, 'noma.sqlite'));
const dest = resolve(
  dir,
  'backups',
  'noma-' + new Date().toISOString().replaceAll(':', '-') + '.sqlite',
);
await backup(db, dest);
db.close();
console.log(dest);
