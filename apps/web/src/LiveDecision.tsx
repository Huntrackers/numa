import { savingsSummary } from './SavingsRules';
import Forecast from './Forecast';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { sendTransaction } from './wallet';
import { Badge, Button, Dialog, ErrorNotice, Notice, Table } from './components';
import { nearMoney, dueDate } from './pages/Live';
export default function LiveDecision({
  plan: initial,
  onClose,
  onDone,
}: {
  plan: any;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [plan, setPlan] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [refreshWarning, setRefreshWarning] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const notifyDone = async () => {
    if (!mounted.current) return;
    try {
      await onDone();
      if (mounted.current) setRefreshWarning(false);
    } catch {
      if (mounted.current) setRefreshWarning(true);
    }
  };
  const clearPending = (id: string) => {
    try {
      if (JSON.parse(localStorage.getItem('numa-pending-operation') || '{}').operationId === id)
        localStorage.removeItem('numa-pending-operation');
    } catch {
      /* Invalid browser recovery data never changes the server operation. */
    }
  };
  const [hash, setHash] = useState(''),
    [operation, setOperation] = useState<any>(),
    [checkingOperation, setCheckingOperation] = useState(false),
    [recoveryOpen, setRecoveryOpen] = useState(false);
  const operationRequest = useRef(0),
    hashInput = useRef<HTMLInputElement>(null);
  const index = plan.steps.findIndex((s: any) => s.state !== 'CONFIRMED');
  const step = plan.steps[index],
    operationId = step?.operationId;
  const currentOperation = operation?.id === operationId ? operation : undefined;
  const retryableFailure =
    currentOperation?.state === 'FAILED' && currentOperation.failureKind === 'CONTRACT_CALL';
  const operationLocked =
    !!operationId &&
    (checkingOperation || (!retryableFailure && currentOperation?.state !== 'PREPARED'));
  const refundedFailure =
    currentOperation?.state === 'FAILED' && currentOperation.failureKind === 'TRANSFER_REFUNDED';
  const discardLocked =
    !!operationId &&
    (checkingOperation || !['PREPARED', 'FAILED'].includes(currentOperation?.state));
  const hashMismatch = error instanceof ApiError && error.code === 'TRANSACTION_MISMATCH';
  const markOperation = (value: any) => {
    operationRequest.current++;
    setCheckingOperation(false);
    setOperation(value);
  };
  const readOperation = async (id: string, signal?: AbortSignal) => {
    const request = ++operationRequest.current;
    setCheckingOperation(true);
    try {
      const value = await api('/operations/' + encodeURIComponent(id), { signal });
      if (request === operationRequest.current && !signal?.aborted) setOperation(value);
      return value;
    } catch (e) {
      if (request === operationRequest.current && !signal?.aborted) setOperation(undefined);
      throw e;
    } finally {
      if (request === operationRequest.current && !signal?.aborted) setCheckingOperation(false);
    }
  };
  useEffect(() => {
    if (!operationId) {
      markOperation(undefined);
      setRecoveryOpen(false);
      setHash('');
      return;
    }
    setHash('');
    const controller = new AbortController();
    void readOperation(operationId, controller.signal)
      .then((op) => {
        if (!controller.signal.aborted) {
          if (['DISPATCHED', 'SUBMITTED'].includes(op.state)) setRecoveryOpen(true);
          setHash((current) => current || op.txHash || op.pendingTxHashes?.at(-1) || '');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => {
      controller.abort();
      operationRequest.current++;
    };
  }, [operationId]);
  useEffect(() => {
    if (hashMismatch) hashInput.current?.focus();
  }, [hashMismatch]);
  const confirm = async (id: string, txHash: string) => {
    setError(undefined);
    try {
      const verified = await api('/live/confirm', {
        method: 'POST',
        body: JSON.stringify({ operationId: id, txHash }),
      });
      clearPending(id);
      if (!mounted.current) return;
      markOperation(verified);
      setPlan((current: any) => ({
        ...current,
        steps: current.steps.map((s: any, i: number) =>
          i === index ? { ...s, state: 'CONFIRMED', txHash } : s,
        ),
      }));
      setHash('');
      setRecoveryOpen(false);
      await notifyDone();
    } catch (e) {
      setRecoveryOpen(true);
      // Only the server's persisted outcome can unlock a new signature or discard.
      // A failed candidate can coexist with another unresolved transaction hash.
      await readOperation(id).catch(() => {});
      throw e;
    }
  };
  const execute = async () => {
    if (operationLocked) return;
    setBusy(true);
    setError(undefined);
    let activeOperation = operationId;
    try {
      const op = await api('/live/prepare', {
        method: 'POST',
        body: JSON.stringify({ planId: plan.id, index }),
      });
      if (!mounted.current) return;
      if (op.local) {
        setPlan((current: any) => ({
          ...current,
          steps: current.steps.map((s: any, i: number) =>
            i === index ? { ...s, state: 'CONFIRMED' } : s,
          ),
        }));
        await notifyDone();
        return;
      }
      activeOperation = op.operationId;
      markOperation(op);
      setPlan((p: any) => ({
        ...p,
        steps: p.steps.map((s: any, i: number) =>
          i === index ? { ...s, operationId: op.operationId } : s,
        ),
      }));
      localStorage.setItem(
        'numa-pending-operation',
        JSON.stringify({ operationId: op.operationId, planId: plan.id, accountId: op.accountId }),
      );
      const dispatched = await api('/live/dispatch', {
        method: 'POST',
        body: JSON.stringify({ operationId: op.operationId }),
      });
      if (!mounted.current) {
        // This component has not called the wallet, so this known unsent attempt can be re-armed.
        await api('/live/declined', {
          method: 'POST',
          body: JSON.stringify({ operationId: op.operationId }),
        }).catch(() => {});
        return;
      }
      markOperation(dispatched);
      let result;
      try {
        result = await sendTransaction(op.transaction);
      } catch (e: any) {
        if (
          e?.type === 'userRejected' ||
          e?.code === 4001 ||
          e?.message === 'User rejected the request.'
        ) {
          const declined = await api('/live/declined', {
            method: 'POST',
            body: JSON.stringify({ operationId: op.operationId }),
          });
          markOperation(declined);
        }
        throw e;
      }
      const txHash = result?.transaction?.hash;
      if (!txHash)
        throw Error(
          'The wallet has not returned a transaction hash. Open wallet activity and verify the existing transaction before trying again.',
        );
      const pending = JSON.parse(localStorage.getItem('numa-pending-operation') || '{}');
      if (pending.operationId === op.operationId)
        localStorage.setItem('numa-pending-operation', JSON.stringify({ ...pending, txHash }));
      if (!mounted.current) return;
      setHash(txHash);
      localStorage.setItem(
        'numa-pending-operation',
        JSON.stringify({
          operationId: op.operationId,
          planId: plan.id,
          accountId: op.accountId,
          txHash,
        }),
      );
      await confirm(op.operationId, txHash);
    } catch (e) {
      if (activeOperation) {
        await readOperation(activeOperation).catch(() => {});
        setRecoveryOpen(true);
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={plan.label}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="dialog-body">
        <div className="spread">
          <Badge tone="good">NEAR testnet / testNEAR</Badge>
          <span>Expires {new Date(plan.expiresAt).toLocaleTimeString()}</span>
        </div>
        <Notice>
          Your wallet signs each contract call. Review the amount and receiver before approving.
          This preview alone moves no funds.
        </Notice>
        {refreshWarning ? (
          <Notice tone="warning">
            The decision was confirmed. The workspace refresh failed; this does not undo the
            confirmed result.{' '}
            <Button variant="quiet" onClick={() => void notifyDone()}>
              Retry workspace refresh
            </Button>
          </Notice>
        ) : null}
        {plan.effects.rows ? (
          <Table
            headers={
              plan.effects.rows[0]?.before
                ? ['Person', 'Current', 'Proposed', 'Period']
                : ['Person', 'Payday', 'Amount']
            }
          >
            {plan.effects.rows.map((r: any) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                {r.before ? (
                  <>
                    <td>{nearMoney(r.before)}</td>
                    <td>{nearMoney(r.after)}</td>
                    <td>{r.cadence}</td>
                  </>
                ) : (
                  <>
                    <td>{new Date(r.dueAt || dueDate(r.due_at)).toLocaleString()}</td>
                    <td>{nearMoney(r.amount)}</td>
                  </>
                )}
              </tr>
            ))}
          </Table>
        ) : null}
        {['amount', 'total', 'freeAfter', 'reservationDelta', 'cashFloor']
          .filter((k) => plan.effects[k] !== undefined)
          .map((k) => (
            <p key={k}>
              <b>
                {
                  {
                    amount: 'Amount',
                    total: 'Total salaries',
                    freeAfter: 'Free treasury after change',
                    reservationDelta: 'Change to reserved salaries',
                    cashFloor: 'Cash kept per payday',
                  }[k]
                }
                :
              </b>{' '}
              {nearMoney(plan.effects[k])}
            </p>
          ))}
        {plan.effects.goalBps !== undefined ? (
          <p>Goals receive {plan.effects.goalBps / 100}% of each salary.</p>
        ) : null}
        {plan.effects.savings ? (
          <Table headers={['Goal', 'Target', 'Contribution and excess', 'State']}>
            {plan.effects.savings.map((g: any, i: number) => (
              <tr key={i}>
                <td>{g.name}</td>
                <td>{nearMoney(g.target)}</td>
                <td>{savingsSummary(g, nearMoney)}</td>
                <td>{g.state}</td>
              </tr>
            ))}
          </Table>
        ) : null}
        {plan.effects.forecast ? (
          <Forecast value={plan.effects.forecast} format={nearMoney} />
        ) : null}
        <ol className="live-steps">
          {plan.steps.map((s: any, i: number) => (
            <li key={i}>
              <div>
                <strong>{s.label}</strong>
                <small>
                  {s.method === 'local_salary'
                    ? 'Off-chain future agreement'
                    : s.method.replaceAll('_', ' ')}
                </small>
              </div>
              <Badge tone={s.state === 'CONFIRMED' ? 'good' : 'neutral'}>
                {s.state === 'CONFIRMED' ? 'Confirmed' : i === index ? 'Next' : 'Waiting'}
              </Badge>
            </li>
          ))}
        </ol>
        <ErrorNotice error={error} />
        {retryableFailure ? (
          <Notice>
            The initial contract call failed and rolled back. Review this step and retry, or discard
            this uncommitted decision. Network gas may have been spent.
          </Notice>
        ) : refundedFailure ? (
          <Notice>
            The transfer failed and the contract restored the balance. Discard this uncommitted
            decision, then create a new withdrawal. This operation cannot be sent again.
          </Notice>
        ) : operationLocked ? (
          <Notice tone="warning">
            {checkingOperation
              ? 'Checking the existing operation…'
              : 'An existing wallet request needs verification. Signing and discarding stay locked until its outcome is known.'}
          </Notice>
        ) : null}
        {step?.operationId ? (
          <details open={recoveryOpen} onToggle={(e) => setRecoveryOpen(e.currentTarget.open)}>
            <summary>Recover an existing transaction</summary>
            <p>
              If the wallet completed this step but the result was lost, paste the transaction hash
              from your wallet. Verification checks the signer, contract, method, arguments and
              deposit.
            </p>
            <label className="field">
              <span>NEAR transaction hash</span>
              <input
                ref={hashInput}
                value={hash}
                aria-invalid={hashMismatch}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setHash(e.target.value.trim());
                  setError(undefined);
                }}
              />
            </label>
            <Button
              variant="secondary"
              disabled={
                busy ||
                checkingOperation ||
                currentOperation?.state === 'FAILED' ||
                hash.length < 20
              }
              onClick={() => {
                setBusy(true);
                void confirm(step.operationId, hash)
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              Verify this transaction
            </Button>
          </details>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {index < 0 ? 'Close' : 'Continue later'}
        </Button>
        {index >= 0 && !plan.steps.some((s: any) => s.state === 'CONFIRMED') ? (
          <Button
            variant="quiet"
            disabled={busy || discardLocked}
            onClick={() => {
              setBusy(true);
              void api('/live/commands', {
                method: 'POST',
                headers: { 'Idempotency-Key': crypto.randomUUID() },
                body: JSON.stringify({ action: 'plan.cancel', payload: { id: plan.id } }),
              })
                .then(async () => {
                  await notifyDone();
                  if (mounted.current) onClose();
                })
                .catch(setError)
                .finally(() => setBusy(false));
            }}
          >
            Discard uncommitted decision
          </Button>
        ) : null}
        {index >= 0 ? (
          <Button disabled={busy || operationLocked} onClick={() => void execute()}>
            {busy
              ? 'Waiting for wallet / finality…'
              : step.method === 'local_salary'
                ? 'Apply future agreement'
                : retryableFailure
                  ? 'Retry step ' + (index + 1) + ' in NEAR wallet'
                  : 'Sign step ' + (index + 1) + ' in NEAR wallet'}
          </Button>
        ) : (
          <Badge tone="good">All steps confirmed</Badge>
        )}
      </div>
    </Dialog>
  );
}
