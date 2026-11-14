import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function isolateReview(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  process.env.NOMA_DATA_DIR = directory;
  process.env.DOTENV_CONFIG_PATH = join(directory, 'not-configured.env');
  process.env.DOTENV_CONFIG_OVERRIDE = 'false';
  process.env.DEMO_ENABLED = 'true';
  process.env.NODE_ENV = 'development';
  process.env.LOG_LEVEL = 'silent';
  process.env.NEAR_NETWORK = 'testnet';
  delete process.env.NEAR_EXECUTOR_KEY_FILE;
  delete process.env.NEAR_EXECUTOR_ACCOUNT;
  return directory;
}
