import { ArrowUpRight } from 'lucide-react';
export function NearMark() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true">
      <path
        d="M6 25V7l20 18V7M6 7l7 2M26 25l-7-2"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function NearFoundation({ mode, contractId }: { mode: string; contractId?: string }) {
  return (
    <section className="near-foundation" aria-label="Built on NEAR">
      <div className="near-foundation-title">
        <NearMark />
        <strong>Built on NEAR</strong>
        <span>
          {mode === 'TESTNET'
            ? 'Testnet settlement'
            : mode === 'OPERATOR'
              ? 'Platform operations'
              : 'Simulation workspace'}
        </span>
      </div>
      <p>
        {mode === 'OPERATOR'
          ? 'Inspect NEAR testnet settlement, restricted execution and reconciliation. Fictional demoUSD is tracked in a separate simulation book.'
          : mode === 'TESTNET'
            ? 'NEAR signatures authorize payroll. The contract reserves salaries and savings; the worker calls it at payday.'
            : 'Explore payroll and personal finance with fictional demoUSD. The NEAR testnet vault uses a separate balance.'}
      </p>
      <a
        href={
          contractId
            ? 'https://testnet.nearblocks.io/address/' + contractId
            : 'https://docs.near.org/chain-abstraction/intents/overview'
        }
        target="_blank"
        rel="noreferrer"
      >
        {contractId ? 'View the NEAR contract' : 'Explore NEAR Intents'}
        <ArrowUpRight size={15} />
      </a>
    </section>
  );
}
