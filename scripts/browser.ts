import { existsSync } from 'node:fs';
import { join } from 'node:path';

// A configured browser wins. Otherwise use installed Windows Chrome or Playwright's
// managed Chromium on all platforms; no machine-specific path is required by CI.
export function browserExecutable() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH))
      throw Error(
        'CHROME_PATH does not point to a browser. Fix it or run: npx playwright install chromium',
      );
    return process.env.CHROME_PATH;
  }
  if (process.platform === 'win32') {
    const installed = join(
      process.env.ProgramFiles || 'C:/Program Files',
      'Google/Chrome/Application/chrome.exe',
    );
    if (existsSync(installed)) return installed;
  }
  return undefined;
}
