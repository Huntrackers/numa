import { Store } from '../../db/src/index.js';
import { DomainError, ensure, hash } from '../../domain/src/index.js';
import { view, viewFinal, viewAt, rpc, confirmOperation } from './rpc.js';
import {
  postEvent,
  postMovement,
  companyAccount,
  employeeAccount,
  validateSummary,
} from './accounting.js';
export type Query = (contract: string, method: string, args: any) => Promise<any>;
export async function allObligations(contract: string, accountId: string, query: Query = view) {
  const rows: any[] = [];
  for (let from = 0; from < 2000; from += 100) {
    const page = await query(contract, 'list_obligations', {
      account_id: accountId,
      from_index: from,
      limit: 100,
    });
    rows.push(...page);
    if (page.length < 100) return rows;
  }
  const overflow = await query(contract, 'list_obligations', {
    account_id: accountId,
    from_index: 2000,
    limit: 1,
  });
  ensure(
    !overflow.length,
    'CONTRACT_CAPACITY_MISMATCH',
    'Obligation pagination exceeds the contract capacity.',
  );
  return rows;
}
export async function reconcileChain(s: Store, contract: string, query: Query = view) {
  const id = 'chain-sync:' + contract,
    previous = s.get(id);
  s.atomic(() =>
    s.save({
      id,
      type: 'chain-sync',
      tenant: 'testnet',
      contractId: contract,
      state: 'SYNCING',
      cursor: previous?.cursor || 0,
      startedAt: new Date().toISOString(),
    }),
  );
  try {
    const pinnedBlock = query === view ? await rpc('block', { finality: 'final' }) : null;
    if (pinnedBlock) query = (c, m, a) => viewAt(c, m, a, pinnedBlock.header.hash);
    const summary = await query(contract, 'financial_summary', {});
    if (summary?.version === 2)
      ensure(
        Number.isSafeInteger(summary.eventCount) && summary.eventCount >= 0,
        'CHAIN_EVENT_GAP',
        'The finalized event count is invalid.',
      );
    let cursor = previous?.cursor || 0;
    // Recheck the last event to detect a reset or a mismatching restored checkpoint.
    if (cursor) {
      const tail = await query(contract, 'list_events', { from_index: cursor - 1, limit: 1 });
      const old = s.get('chain-event:' + contract + ':' + cursor);
      ensure(
        tail.length === 1 && old?.payloadHash === hash(tail[0]),
        'CHAIN_CHECKPOINT_MISMATCH',
        'The saved checkpoint does not match the finalized contract.',
      );
    }
    // Storage v3 grows its lazy event history beyond the old 12,000-event cap.
    // Bound reads by the finalized same-block count instead of a lifetime page limit.
    const eventPageLimit =
      summary?.version === 2 ? Math.ceil(Math.max(0, summary.eventCount - cursor) / 100) + 1 : 121;
    for (let pages = 0; pages < eventPageLimit; pages++) {
      const observed =
        query === view
          ? await viewFinal(contract, 'list_events', { from_index: cursor, limit: 100 })
          : {
              value: await query(contract, 'list_events', { from_index: cursor, limit: 100 }),
              blockHash: pinnedBlock?.header.hash || null,
              blockHeight: pinnedBlock?.header.height || null,
            };
      const events = observed.value;
      ensure(
        Array.isArray(events) && events.length <= 100,
        'CHAIN_EVENT_GAP',
        'The finalized event page is invalid.',
      );
      if (!events.length) break;
      s.atomic(() => {
        for (const e of events) {
          ensure(
            Number(e.event_sequence) === cursor + 1 &&
              (summary?.version !== 2 || Number(e.event_sequence) <= summary.eventCount),
            'CHAIN_EVENT_GAP',
            'Finalized event sequence has a gap.',
          );
          const eid = 'chain-event:' + contract + ':' + e.event_sequence,
            old = s.get(eid);
          ensure(
            !old || old.payloadHash === hash(e),
            'CHAIN_EVENT_CONFLICT',
            'A finalized event differs from the stored event.',
          );
          if (!old)
            s.save({
              id: eid,
              type: 'chain-event',
              tenant: 'testnet',
              owner: e.account_id,
              contractId: contract,
              sequence: Number(e.event_sequence),
              payload: e,
              payloadHash: hash(e),
              observedAt: new Date().toISOString(),
              finality: 'final',
              observedBlockHash: observed.blockHash,
              observedBlockHeight: observed.blockHeight,
            });
          cursor++;
        }
        s.save({
          id,
          type: 'chain-sync',
          tenant: 'testnet',
          contractId: contract,
          state: 'SYNCING',
          cursor,
          observedBlockHash: observed.blockHash,
          observedBlockHeight: observed.blockHeight,
        });
      });
      if (events.length < 100) break;
    }
    const knownCompanies = new Set(
      s
        .list('company')
        .filter((c) => c.mode === 'TESTNET' && c.chainId)
        .map((c) => c.chainId),
    );
    for (const e of s
      .list('chain-event')
      .filter((e) => e.contractId === contract && e.payload.event_type === 'CompanyRegistered'))
      knownCompanies.add(e.payload.reference);
    const accounts = new Set<string>(
      s
        .list('user')
        .filter((u) => !u.demo && u.accountId)
        .map((u) => u.accountId),
    );
    for (const cid of knownCompanies) {
      const company = await query(contract, 'get_company', { company_id: cid });
      if (!company) throw Error('Registered company is missing.');
      const employees = await query(contract, 'list_company_employees', { company_id: cid });
      for (const e of employees) accounts.add(e.account_id);
      s.atomic(() =>
        s.save({
          id: 'chain-company:' + contract + ':' + cid,
          type: 'chain-company',
          tenant: 'testnet',
          contractId: contract,
          chainId: cid,
          snapshot: company,
          employees,
          observedAt: new Date().toISOString(),
        }),
      );
    }
    for (const accountId of accounts) {
      const account = await query(contract, 'get_account', { account_id: accountId });
      const obligations = await allObligations(contract, accountId, query);
      s.atomic(() => {
        s.save({
          id: 'chain-account:' + contract + ':' + accountId,
          type: 'chain-account',
          tenant: 'testnet',
          owner: accountId,
          contractId: contract,
          snapshot: account,
          observedAt: new Date().toISOString(),
        });
        for (const o of obligations)
          s.save({
            id: 'chain-obligation:' + contract + ':' + o.id,
            type: 'chain-obligation',
            tenant: o.company_id,
            owner: o.account_id,
            contractId: contract,
            chainId: o.id,
            snapshot: o,
          });
        for (const job of s
          .list('chain-job')
          .filter((j) => j.obligationId && j.state !== 'CONFIRMED')) {
          const final = obligations.find((o) => o.id === job.obligationId);
          if (final?.credited)
            s.save({
              ...job,
              state: 'CONFIRMED',
              evidence: 'FINALIZED_CONTRACT_STATE',
              reconciledAt: new Date().toISOString(),
            });
        }
      });
    }
    // A single contract view checks financial invariants at one block, avoiding cross-block races.
    let accounting: any = { state: 'UNAVAILABLE', reason: 'Contract summary v2 required' };
    if (summary?.version === 2) {
      validateSummary(summary);
      ensure(
        summary.eventCount === cursor,
        'CHAIN_EVENT_GAP',
        'Financial summary and event checkpoint differ.',
      );
      const bookId = 'chain-accounting:' + contract;
      const book = s.get(bookId);
      if (!book) {
        // Legacy events lacked amendment details. A labeled opening snapshot preserves facts without inventing history.
        s.atomic(() => {
          for (const c of s.list('chain-company').filter((c) => c.contractId === contract))
            for (const pocket of ['free', 'reserved'])
              postMovement(
                s,
                contract,
                'opening:' + c.chainId + ':' + pocket,
                'OPENING_SNAPSHOT',
                'testNEAR:external:opening',
                companyAccount(c.chainId, pocket),
                c.snapshot[pocket],
              );
          for (const a of s.list('chain-account').filter((a) => a.contractId === contract)) {
            postMovement(
              s,
              contract,
              'opening:' + a.owner + ':cash',
              'OPENING_SNAPSHOT',
              'testNEAR:external:opening',
              employeeAccount(a.owner),
              a.snapshot.cash || '0',
            );
            for (const g of a.snapshot.policy?.goals || [])
              postMovement(
                s,
                contract,
                'opening:' + a.owner + ':goal:' + g.id,
                'OPENING_SNAPSHOT',
                'testNEAR:external:opening',
                employeeAccount(a.owner, 'goal:' + g.id),
                g.funded,
              );
          }
          for (const w of summary.pending || [])
            postMovement(
              s,
              contract,
              'opening:pending:' + w.id,
              'OPENING_SNAPSHOT',
              'testNEAR:external:opening',
              'testNEAR:pending:' + w.id,
              w.amount,
            );
          s.save({
            id: bookId,
            type: 'chain-accounting',
            tenant: 'testnet',
            contractId: contract,
            cursor,
            openingSequence: cursor,
            openedAt: new Date().toISOString(),
            coverage: 'Opening snapshot plus complete v2 events',
          });
        });
      } else {
        let journalCursor = book.cursor;
        while (journalCursor < cursor) {
          const pageSize = Math.min(100, cursor - journalCursor);
          const details = await query(contract, 'get_event_details', {
            from_index: journalCursor,
            limit: pageSize,
          });
          ensure(
            Array.isArray(details) && details.length > 0 && details.length <= pageSize,
            'EVENT_DETAILS_REQUIRED',
            'Accounting event page is missing or invalid.',
          );
          s.atomic(() => {
            for (const row of details) {
              ensure(
                Number(row.sequence) === journalCursor + 1,
                'CHAIN_EVENT_GAP',
                'Accounting event sequence has a gap.',
              );
              postEvent(s, contract, row);
              journalCursor++;
            }
            s.save({ ...s.get(bookId)!, cursor: journalCursor });
          });
        }
      }
      // Independently compare every projected journal pocket with the same-block contract snapshots.
      for (const c of s.list('chain-company').filter((c) => c.contractId === contract))
        for (const pocket of ['free', 'reserved'])
          ensure(
            s.balance(companyAccount(c.chainId, pocket)) === BigInt(c.snapshot[pocket]),
            'LEDGER_MISMATCH',
            'The testNEAR company journal differs from finalized balances.',
          );
      for (const a of s.list('chain-account').filter((a) => a.contractId === contract)) {
        ensure(
          s.balance(employeeAccount(a.owner)) === BigInt(a.snapshot.cash || '0'),
          'LEDGER_MISMATCH',
          'The testNEAR employee cash journal differs from finalized balances.',
        );
        for (const g of a.snapshot.policy?.goals || [])
          ensure(
            s.balance(employeeAccount(a.owner, 'goal:' + g.id)) === BigInt(g.funded),
            'LEDGER_MISMATCH',
            'The testNEAR savings journal differs from finalized balances.',
          );
      }
      const pending = new Map(
        (summary.pending || []).map((w: any) => ['testNEAR:pending:' + w.id, BigInt(w.amount)]),
      );
      const pendingAccounts = new Set<string>(
        s
          .ledger('testnet')
          .filter((e) => e.book === 'testNEAR')
          .flatMap((e) => e.lines.map((l: any) => l.account))
          .filter((a: string) => a.startsWith('testNEAR:pending:')),
      );
      for (const [id, value] of pending)
        ensure(
          s.balance(id as string) === value,
          'LEDGER_MISMATCH',
          'The pending withdrawal journal differs from finalized balances.',
        );
      for (const id of pendingAccounts)
        ensure(
          s.balance(id) === (pending.get(id) || 0n),
          'LEDGER_MISMATCH',
          'The pending withdrawal journal differs from finalized balances.',
        );
      accounting = {
        state: 'VERIFIED',
        summary,
        openingSequence: s.get(bookId)?.openingSequence,
        checkedAt: new Date().toISOString(),
      };
    }
    return s.atomic(() =>
      s.save({
        id,
        type: 'chain-sync',
        tenant: 'testnet',
        contractId: contract,
        state: 'HEALTHY',
        accounting,
        cursor,
        observedBlockHash: s.get(id)?.observedBlockHash,
        observedBlockHeight: s.get(id)?.observedBlockHeight,
        lastSuccessAt: new Date().toISOString(),
        error: null,
      }),
    );
  } catch (e: any) {
    s.atomic(() =>
      s.save({ ...s.get(id)!, state: 'BLOCKED', error: String(e.message).slice(0, 250) }),
    );
    throw e;
  }
}
export function pendingTransactionHashes(op: any): string[] {
  return [...new Set<string>(op.pendingTxHashes ?? (op.txHash ? [op.txHash] : []))];
}
function receiptId(op: any, txHash: string) {
  return 'chain-receipt:' + hash([op.contractId, txHash]);
}
function receiptOwner(s: Store, op: any, txHash: string): string | undefined {
  const binding = s.get(receiptId(op, txHash));
  if (binding) return binding.operationId;
  // Existing v2 records predate explicit receipt bindings. Preserve their
  // successful and proven-failed receipts during the upgrade as well.
  return s
    .list('chain-operation')
    .find(
      (other) =>
        other.contractId === op.contractId &&
        ((other.state === 'CONFIRMED' && other.txHash === txHash) ||
          other.failedTxHashes?.includes(txHash)),
    )?.id;
}
function bindReceipt(s: Store, op: any, txHash: string) {
  const boundTo = receiptOwner(s, op, txHash);
  ensure(
    !boundTo || boundTo === op.id,
    'TRANSACTION_MISMATCH',
    'This transaction already belongs to another operation. Verify the current wallet request.',
    409,
  );
  s.save({
    id: receiptId(op, txHash),
    type: 'chain-receipt',
    owner: op.owner,
    tenant: op.tenant,
    contractId: op.contractId,
    operationId: op.id,
    txHash,
  });
}

// A pasted hash is a verification candidate, not an immutable receipt binding.
// Keep every unresolved candidate durable while keeping wallet dispatch locked.
export async function verifyOperationCandidate(
  s: Store,
  operationId: string,
  txHash: string,
  confirm: (tx: string, account: string, op: any) => Promise<any> = confirmOperation,
) {
  ensure(
    typeof txHash === 'string' && txHash.length >= 20 && txHash.length <= 100,
    'INVALID_TRANSACTION_HASH',
    'Enter the complete transaction hash.',
    400,
  );
  const op = s.atomic(() => {
    const current = s.get(operationId);
    ensure(current?.type === 'chain-operation', 'NOT_FOUND', 'Operation not found.', 404);
    if (current.state === 'CONFIRMED') {
      ensure(
        current.txHash === txHash,
        'TRANSACTION_MISMATCH',
        'A confirmed operation cannot be assigned another transaction.',
        409,
      );
      return current;
    }
    ensure(current.state !== 'CANCELLED', 'ALREADY_APPLIED', 'This operation was discarded.', 409);
    ensure(
      current.state !== 'FAILED',
      current.failureKind === 'TRANSFER_REFUNDED' ? 'CHAIN_TRANSFER_REFUNDED' : 'CHAIN_CALL_FAILED',
      current.failureKind === 'TRANSFER_REFUNDED'
        ? 'The contract restored this withdrawal. Discard this decision and create a new withdrawal.'
        : 'This contract call failed before committing changes. Prepare a fresh attempt.',
      409,
    );
    const pending = [...new Set([...pendingTransactionHashes(current), txHash])];
    ensure(
      pending.length <= 16,
      'VERIFICATION_LIMIT',
      'Too many unresolved transaction candidates. Resolve an existing hash before adding another.',
      409,
    );
    return s.save({ ...current, state: 'SUBMITTED', txHash: pending[0], pendingTxHashes: pending });
  });
  if (op.state === 'CONFIRMED') return op;
  try {
    const boundTo = receiptOwner(s, op, txHash);
    ensure(
      !boundTo || boundTo === op.id,
      'TRANSACTION_MISMATCH',
      'This transaction already belongs to another operation. Verify the current wallet request.',
      409,
    );
    const result = await confirm(txHash, op.accountId, op);
    ensure(
      result.state === 'CONFIRMED',
      'RECONCILIATION_REQUIRED',
      'The transaction result is not confirmed.',
      409,
    );
    return s.atomic(() => {
      const current = s.get(operationId)!;
      ensure(
        current.state !== 'CONFIRMED' || current.txHash === txHash,
        'TRANSACTION_MISMATCH',
        'A confirmed operation cannot be assigned another transaction.',
        409,
      );
      if (current.state === 'CONFIRMED') return current;
      bindReceipt(s, current, txHash);
      return s.save({
        ...current,
        ...result,
        txHash,
        pendingTxHashes: [],
        needsProjection: !!current.planId,
        lastError: null,
        lastErrorCode: null,
        verifiedAt: new Date().toISOString(),
      });
    });
  } catch (e: any) {
    let failureError = e;
    s.atomic(() => {
      const current = s.get(operationId)!;
      // An older request must never overwrite a result verified concurrently.
      if (current.state === 'CONFIRMED') return;
      const boundTo = receiptOwner(s, current, txHash);
      if (boundTo && boundTo !== current.id)
        failureError = new DomainError(
          'TRANSACTION_MISMATCH',
          'This transaction already belongs to another operation. Verify the current wallet request.',
          409,
        );
      const rejected = failureError.code === 'TRANSACTION_MISMATCH';
      const rolledBack = failureError.code === 'CHAIN_CALL_FAILED';
      const refunded = failureError.code === 'CHAIN_TRANSFER_REFUNDED';
      if (rolledBack || refunded || failureError.code === 'CHAIN_FAILURE')
        bindReceipt(s, current, txHash);
      const pending = pendingTransactionHashes(current).filter(
        (h) => !(rejected || rolledBack || refunded) || h !== txHash,
      );
      const failed = [
        ...new Set<string>([
          ...(current.failedTxHashes || []),
          ...(rolledBack || refunded ? [txHash] : []),
        ]),
      ].slice(-16);
      const refundedHashes = [
        ...new Set<string>([...(current.refundedTxHashes || []), ...(refunded ? [txHash] : [])]),
      ].slice(-16);
      const failure = failed.length > 0 && pending.length === 0;
      s.save({
        ...current,
        state: failure ? 'FAILED' : 'SUBMITTED',
        txHash: pending[0] || (failure ? failed.at(-1) : undefined),
        pendingTxHashes: pending,
        ...(rejected
          ? {
              rejectedTxHashes: [...new Set([...(current.rejectedTxHashes || []), txHash])].slice(
                -16,
              ),
            }
          : {}),
        ...(failed.length ? { failedTxHashes: failed } : {}),
        ...(refundedHashes.length ? { refundedTxHashes: refundedHashes } : {}),
        ...(failure
          ? { failureKind: refundedHashes.length ? 'TRANSFER_REFUNDED' : 'CONTRACT_CALL' }
          : {}),
        lastCheckAt: new Date().toISOString(),
        lastErrorCode: failureError.code || 'UNAVAILABLE',
        lastError: String(failureError.message).slice(0, 180),
      });
    });
    throw failureError;
  }
}

export async function reconcileSubmitted(
  s: Store,
  confirm: (tx: string, account: string, op: any) => Promise<any> = confirmOperation,
) {
  for (const op of s.list('chain-operation').filter((o) => o.state === 'SUBMITTED')) {
    for (const txHash of pendingTransactionHashes(op)) {
      try {
        await verifyOperationCandidate(s, op.id, txHash, confirm);
        break;
      } catch {
        // The durable state distinguishes rejected candidates, a rolled-back
        // initial call, and an unresolved result that must not be resent.
        if (s.get(op.id)?.state === 'CONFIRMED') break;
      }
    }
  }
}
