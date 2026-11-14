import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ApiError, setApprovalHandler, type ApprovalChallenge } from './api';
import { Badge, Button, Dialog, ErrorNotice, Notice } from './components';

type Request = {
  challenge: ApprovalChallenge;
  body?: string;
  resolve: (proof: string) => void;
  reject: (error: Error) => void;
};

export default function DecisionApproval() {
  const [queue, setQueue] = useState<Request[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const queued = useRef<Request[]>([]);
  const active = queue[0];
  useEffect(() => {
    const cancelPending = () => {
      for (const request of queued.current)
        request.reject(
          new ApiError(
            'APPROVAL_CANCELLED',
            'The account changed. Review the decision again.',
            409,
          ),
        );
      queued.current = [];
      setQueue([]);
      setBusy(false);
      setError(undefined);
    };
    window.addEventListener('numa:identity-changed', cancelPending);
    setApprovalHandler(
      (challenge, body) =>
        new Promise((resolve, reject) => {
          const request = { challenge, body, resolve, reject };
          queued.current = [...queued.current, request];
          setQueue(queued.current);
        }),
    );
    return () => {
      window.removeEventListener('numa:identity-changed', cancelPending);
      setApprovalHandler(undefined);
      for (const request of queued.current)
        request.reject(new ApiError('APPROVAL_CANCELLED', 'Approval was cancelled.', 409));
      queued.current = [];
    };
  }, []);
  const finish = () => {
    queued.current = queued.current.slice(1);
    setQueue(queued.current);
    setError(undefined);
    setBusy(false);
  };
  if (!active) return null;
  const c = active.challenge;
  const cancel = () => {
    if (busy) return;
    active.reject(
      new ApiError(
        'APPROVAL_CANCELLED',
        'No decision was applied. Wallet approval was cancelled.',
        409,
      ),
    );
    finish();
  };
  return (
    <Dialog title="Approve with your NEAR identity" onClose={cancel} wide>
      <div className="dialog-body">
        <Badge tone="good">
          <ShieldCheck size={13} /> NEP-413 · NEAR testnet identity
        </Badge>
        <p>
          Review this decision, then sign it in Meteor. The server verifies your account and the
          exact request before applying it.
        </p>
        <Notice>
          This message signature uses no gas and moves no funds. Contract actions use a separate
          NEAR transaction and a verified receipt. Signing a simulation decision does not make it a
          real investment.
        </Notice>
        <dl className="approval-details">
          <dt>Account</dt>
          <dd>{c.accountId}</dd>
          <dt>Recipient</dt>
          <dd>{c.recipient}</dd>
          <dt>Valid until</dt>
          <dd>{new Date(c.expiresAt).toLocaleString()}</dd>
        </dl>
        <details open>
          <summary>Message you will sign</summary>
          <pre className="approval-message">{c.message}</pre>
        </details>
        {active.body ? (
          <details>
            <summary>Exact request</summary>
            <pre className="approval-message">{active.body}</pre>
          </details>
        ) : null}
        <ErrorNotice error={error} />
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" disabled={busy} onClick={cancel}>
          Cancel decision
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            void import('./wallet')
              .then((m) => m.signDecisionApproval(c))
              .then((proof) => {
                if (queued.current[0] !== active) return;
                active.resolve(proof);
                finish();
              })
              .catch((e) => {
                if (queued.current[0] !== active) return;
                setError(e);
                setBusy(false);
              });
          }}
        >
          {busy ? 'Waiting for NEAR wallet…' : 'Sign decision in NEAR wallet'}
        </Button>
      </div>
    </Dialog>
  );
}
