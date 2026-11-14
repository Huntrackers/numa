import { api } from '../api';
import { useState } from 'react';
import { ArrowUp, ArrowRight, Sparkles, ShieldCheck } from 'lucide-react';
import { Button, Badge, Notice, Panel, ErrorNotice, Dialog, Table } from '../components';
import type { UIContext } from '../types';
export default function Assistant({ ctx }: { ctx: UIContext }) {
  const [proposalReview, setProposalReview] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]),
    [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const send = async (text = input) => {
    if (!text.trim() || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', message: text }]);
    setBusy(true);
    setError(null);
    try {
      const r = await api('/agent/messages', {
        method: 'POST',
        body: JSON.stringify({
          scope: ctx.scope,
          message: text,
          ...(ctx.data.personalSimulation ? { book: 'simulation' } : {}),
          ...(ctx.scope === 'company' ? { companyId: ctx.companyId } : {}),
        }),
      });
      setMessages((m) => [...m, { role: 'assistant', ...r }]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="context-line">
            {ctx.scope === 'company' ? 'Company' : 'Your money'} / numa assistant
          </p>
          <h1>Work through the decision.</h1>
          <p>Ask about your numbers. Review a proposal before anything changes.</p>
        </div>
        <Badge>Local, no paid API</Badge>
      </div>
      {proposalReview ? (
        <Dialog title="Review the typed proposal" onClose={() => setProposalReview(null)}>
          <div className="dialog-body">
            <Notice>
              This proposal changes planning settings only. It cannot sign a transaction or withdraw
              funds. All amounts use the separate demoUSD planning book.
            </Notice>
            <Table headers={['Setting', 'Proposed value']}>
              {Object.entries(proposalReview.payload).map(([key, value]) => (
                <tr key={key}>
                  <td>{key.replaceAll(/([A-Z])/g, ' $1')}</td>
                  <td>
                    {['target', 'amount'].includes(key)
                      ? (Number(value) / 100).toFixed(2) + ' demoUSD'
                      : String(value)}
                  </td>
                </tr>
              ))}
            </Table>
            <ErrorNotice error={error} />
          </div>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setProposalReview(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void ctx
                  .run(proposalReview.action, proposalReview.payload)
                  .then(() => setProposalReview(null))
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              Confirm planning settings
            </Button>
          </div>
        </Dialog>
      ) : null}
      <div className="assistant-layout">
        <Panel className="chat-panel">
          <div className="chat-messages" aria-live="polite">
            {!messages.length ? (
              <div className="chat-empty">
                <span className="assistant-emblem">n</span>
                <h2>A little clarity goes a long way.</h2>
                <p>
                  {ctx.scope === 'company'
                    ? 'Understand payroll coverage or prepare a bulk salary change.'
                    : 'Understand your available cash, reserves and borrowing decisions.'}
                </p>
                <div className="prompt-chips">
                  {(ctx.scope === 'company'
                    ? ['How long does our treasury last?', 'Increase Design salaries by 5%']
                    : ['How much cash can I use?', 'How should I think about borrowing?']
                  ).map((p) => (
                    <button key={p} onClick={() => void send(p)}>
                      {p}
                      <ArrowUp size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={'chat-message ' + m.role}>
                  <span>{m.role === 'user' ? 'You' : 'numa'}</span>
                  <p>{m.message}</p>
                  {m.explanation ? <p className="model-explanation">{m.explanation}</p> : null}
                  {m.proposal ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void (
                          m.proposal.action === 'salary.preview'
                            ? ctx.run('salary.preview', m.proposal.payload)
                            : m.proposal.action === 'preview.create'
                              ? ctx.decide(m.proposal.payload.kind, m.proposal.payload.input)
                              : Promise.resolve(setProposalReview(m.proposal))
                        ).catch(setError)
                      }
                    >
                      Open decision preview
                      <ArrowRight size={16} />
                    </Button>
                  ) : null}
                  {m.engine ? (
                    <small>{m.engine}. Financial calculations use the deterministic engine.</small>
                  ) : null}
                </div>
              ))
            )}
            {busy ? <p className="muted">Working through your numbers…</p> : null}
          </div>
          <ErrorNotice error={error} />
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="assistant-input">
              Message numa assistant
            </label>
            <input
              id="assistant-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your money or prepare a change"
              maxLength={2000}
            />
            <Button disabled={busy || !input.trim()} type="submit" aria-label="Send message">
              <ArrowUp size={19} />
            </Button>
          </form>
        </Panel>
        <div className="side-stack">
          <Panel title="You stay in control" className="quiet-panel">
            <ShieldCheck size={26} />
            <p>
              The assistant can explain figures and prepare a typed proposal. It cannot sign a
              transaction, withdraw funds or grant itself permission.
            </p>
          </Panel>
          <Notice>
            The built-in assistant works without a language model. A locally installed model can add
            explanations; financial results still come from fixed, tested calculations.
          </Notice>
        </div>
      </div>
    </>
  );
}
