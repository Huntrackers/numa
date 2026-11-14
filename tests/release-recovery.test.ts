import { it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/db/src/index.js';
import { reconcileChain } from '../packages/near-adapter/src/reconcile.js';
import { employeeAccount } from '../packages/near-adapter/src/accounting.js';
it('restores an older SQLite snapshot, replays finalized movements once and blocks a balance mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'numa-old-backup-')),
    file = join(dir, 'active.sqlite'),
    snapshot = join(dir, 'old.sqlite');
  let s = new Store(file);
  let count = 1,
    cash = '100';
  const events = [
    {
      event_sequence: '1',
      event_type: 'PayrollCredited',
      reference: 'pay',
      account_id: 'person.testnet',
      amount: '100',
    },
    {
      event_sequence: '2',
      event_type: 'WithdrawalRequested',
      reference: 'w1',
      account_id: 'person.testnet',
      amount: '40',
    },
  ];
  const q = async (_c: string, m: string, a: any): Promise<any> => {
    if (m === 'list_events')
      return events.slice(0, count).slice(a.from_index, a.from_index + a.limit);
    if (m === 'get_account') return { cash, policy: { goals: [] } };
    if (m === 'get_event_details')
      return [
        {
          sequence: 2,
          event: events[1],
          details: {
            schemaVersion: 2,
            timestampNs: '1793965000000000000',
            withdrawal: { state: 'PENDING' },
          },
        },
      ].slice(0, count - 1);
    if (m === 'financial_summary')
      return {
        version: 2,
        eventCount: count,
        liabilityValid: true,
        totalLiability: '100',
        computedLiability: '100',
        backingValid: true,
        accountBalance: '1000',
        backingRequired: '500',
        reservations: [],
        pending: count === 2 ? [{ id: 'w1', amount: '40' }] : [],
      };
    return [];
  };
  try {
    s.save({ id: 'person', type: 'user', accountId: 'person.testnet', demo: false });
    await reconcileChain(s, 'vault.testnet', q);
    s.db.prepare('VACUUM INTO ?').run(snapshot);
    count = 2;
    cash = '60';
    await reconcileChain(s, 'vault.testnet', q);
    expect(s.balance(employeeAccount('person.testnet'))).toBe(60n);
    s.close();
    s = new Store(snapshot);
    await reconcileChain(s, 'vault.testnet', q);
    const entries = s.ledger().length;
    await reconcileChain(s, 'vault.testnet', q);
    expect(s.ledger()).toHaveLength(entries);
    expect(s.get('chain-sync:vault.testnet')?.accounting.state).toBe('VERIFIED');
    expect(s.balance('testNEAR:pending:w1')).toBe(40n);
    cash = '59';
    await expect(reconcileChain(s, 'vault.testnet', q)).rejects.toThrow('journal differs');
    expect(s.get('chain-sync:vault.testnet')?.state).toBe('BLOCKED');
  } finally {
    s.close();
  }
});
it('rolls back a nested financial step without committing its partial journal', () => {
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-savepoint-')), 'db.sqlite'));
  try {
    s.atomic(() => {
      s.save({ id: 'outer', type: 'proof' });
      expect(() =>
        s.atomic(() => {
          s.save({ id: 'inner', type: 'proof' });
          throw Error('partial failure');
        }),
      ).toThrow('partial failure');
      expect(s.get('inner')).toBeUndefined();
    });
    expect(s.get('outer')).toBeTruthy();
  } finally {
    s.close();
  }
});

it('replays lazy history beyond the former 12,000-event boundary and preserves its journal cursor', async () => {
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'numa-long-history-')), 'db.sqlite'));
  let count = 0,
    eventPages = 0,
    detailPages = 0;
  const event = (sequence: number) => ({
    event_sequence: String(sequence),
    event_type: 'MandatePaused',
    reference: 'o1',
    account_id: 'owner.testnet',
    amount: '0',
  });
  const q = async (_contract: string, method: string, args: any): Promise<any> => {
    if (method === 'financial_summary')
      return {
        version: 2,
        storageVersion: 3,
        eventCount: count,
        liabilityValid: true,
        totalLiability: '0',
        computedLiability: '0',
        backingValid: true,
        accountBalance: '1000',
        backingRequired: '0',
        reservations: [],
        pending: [],
      };
    if (method === 'list_events') {
      eventPages++;
      return Array.from(
        { length: Math.max(0, Math.min(args.limit, count - args.from_index)) },
        (_, i) => event(args.from_index + i + 1),
      );
    }
    if (method === 'get_event_details') {
      detailPages++;
      return Array.from(
        { length: Math.max(0, Math.min(args.limit, count - args.from_index)) },
        (_, i) => ({
          sequence: args.from_index + i + 1,
          event: event(args.from_index + i + 1),
          details: { schemaVersion: 2, timestampNs: '1000000000' },
        }),
      );
    }
    return [];
  };
  try {
    await reconcileChain(s, 'vault.testnet', q);
    count = 12101;
    await reconcileChain(s, 'vault.testnet', q);
    expect(eventPages).toBeGreaterThan(121);
    expect(detailPages).toBe(122);
    expect(s.get('chain-sync:vault.testnet')).toMatchObject({
      state: 'HEALTHY',
      cursor: count,
      accounting: { state: 'VERIFIED' },
    });
    expect(s.get('chain-accounting:vault.testnet')?.cursor).toBe(count);
    await reconcileChain(s, 'vault.testnet', q);
    expect(s.list('chain-event')).toHaveLength(count);
    expect(detailPages).toBe(122);
  } finally {
    s.close();
  }
});
