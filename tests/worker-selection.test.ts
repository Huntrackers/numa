import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/db/src/index.js';
import { allObligations } from '../packages/near-adapter/src/reconcile.js';
import { selectDue } from '../apps/worker/src/testnet.js';
describe('bounded contract pagination', () => {
  it('accepts the exact contract cap without truncating a valid final page', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: String(i) }));
    const result = await allObligations('vault.testnet', 'employee.testnet', async (_c, _m, a) =>
      rows.slice(a.from_index, a.from_index + a.limit),
    );
    expect(result).toHaveLength(2000);
    expect(result.at(-1)?.id).toBe('1999');
  });
  it('does not let suspended-company paydays starve active companies on later pages', async () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-due-')), 'db.sqlite'));
    try {
      s.save({ type: 'company', chainId: 'paused-company', status: 'SUSPENDED' });
      const due = [
        ...Array.from({ length: 53 }, (_, i) => ({ id: String(i), company_id: 'paused-company' })),
        ...Array.from({ length: 7 }, (_, i) => ({
          id: 'active-' + i,
          company_id: 'active-company',
        })),
      ];
      const result = await selectDue(s, 'vault.testnet', async (_c, _m, a) =>
        due.slice(a.from_index, a.from_index + a.limit),
      );
      expect(result.map((o) => o.id)).toEqual([
        'active-0',
        'active-1',
        'active-2',
        'active-3',
        'active-4',
      ]);
    } finally {
      s.close();
    }
  });
});
