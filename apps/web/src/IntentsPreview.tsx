import { lazy, Suspense, useState } from 'react';
import { Loading, Notice } from './components';

const RoutePreview = lazy(() =>
  import('./pages/Trust').then((module) => ({ default: module.RoutePreview })),
);

export default function IntentsPreview({ purpose }: { purpose: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="intents-context" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Preview {purpose} with NEAR Intents</summary>
      {open ? (
        <Suspense fallback={<Loading />}>
          <Notice>
            Live 1Click pricing with dry: true. This is not a deposit or a trade. It never credits
            the company treasury, debits salary, changes allocations or submits a DCA order. Mainnet
            tokens and addresses cannot fund the testnet vault. Stocks, ETFs and other assets absent
            from the live catalog are not offered by this preview.
          </Notice>
          <RoutePreview purpose={purpose} />
        </Suspense>
      ) : null}
    </details>
  );
}
