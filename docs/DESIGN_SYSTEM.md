# numa design system

The product is a payroll-to-personal-finance workspace. Its characteristic element is a continuous payroll ribbon: funding becomes a payable, then cash, goals and investments. It explains actual state and allocations, rather than decorative charts.

Palette: harbor #213f52, paper #f7f9fa, cloud #e9eff3, glacier #c8e5ed, copper #b86632, ink #182d3a. Paper is cool white, not cream. Harbor and glacier express company stability; copper marks an action or decision. Status colors carry labels.

Typography: locally bundled Manrope for headings and numbers; DM Sans for controls and long text. Sentence case. Tabular numerical figures, English labels and dates.

Layout: a narrow harbor navigation rail, a quiet identity strip and an asymmetric workspace. One wide primary task panel plus a contextual side column. Tables remain tables. Wide flow diagrams have a text equivalent on mobile. Content aligns left.

Review: rejected a generic repeated card dashboard. Hero is the actual payroll path, with people and dates, not a large vanity number. No stock illustrations, gradients or decorative animations. Panels use 12px radius, pills only for status. Desktop sidebar becomes a labeled mobile drawer.

Interaction: changes use a decision preview, then an explicit commit. Pending/error/stale/empty states are named. Simulation labels follow money everywhere. Focus rings, accessible dialogs, reduced motion and keyboard navigation are required.

## NEAR identity and execution truth

Spell the brand numa in product copy. Technical legacy account IDs and storage filenames stay stable. A persistent Built on NEAR strip explains wallet authorization, contract reserves and payday execution. Link to the configured testnet contract and verified transaction receipts. Native amounts use testNEAR; the simulation book uses demoUSD with visible labels.

Use NEAR where the interaction demonstrates it: company registration, payroll authorization, employee savings reservation and verified settlement. DCA fills, tokenized stocks, Earn and loans have Simulation labels. The independent 1Click route preview is Live read-only and never implies execution. Avoid mainnet, official endorsement or guaranteed-yield claims. The NEAR foundation must be explained in ordinary English rather than exposing technical setup IDs in primary forms.

## Savings decisions

Every goal shows its own fixed or percentage contribution, explicit salary/goals-budget basis, priority, target date and excess destination. A review precedes the wallet signature. Draft/paused/completed/archived remain distinct. Mobile controls wrap without horizontal overflow; retained savings never look like spendable cash.

## Public review center in v2

Use the same harbor, glacier, paper and local type. A sequential salary rail describes real steps; an asymmetric finalized-observation panel shows current evidence. Four quiet sections separate evidence, live read-only routes, synthetic policy drills and try-it steps. Token amounts keep exact decimals; missing RPC or stale observations never turn green. Quote results disappear after input changes and display an expiry state. Public evidence excludes tenant metadata. Small screens stack the workbench, preserve labelled controls and keep all content within the viewport.

## V3 accessibility and recovery

### Version 3.1 public entry and approval

The anonymous landing uses a salary ribbon and two product perspectives with the same harbor, glacier and copper palette. It renders before identity bootstrap and remains readable during API outages. Company and employee actions preserve their intent through wallet login. The workspace directory shows actual memberships, draft registration and a distinct personal vault entry. Invitations reveal their type and exact terms only to the invited identity. Job role and company permission remain separate.

Sensitive off-chain decisions show a NEP-413 message review before Meteor opens. Actual settlement uses the existing transaction review. Signed local records must never look like finalized on-chain payments. The authenticated NEAR network screen shows a private decision history, signature details and clearly scoped refresh errors. Cancellation keeps the original form editable and applies no change.

Muted text uses #526975 on the existing paper surfaces to retain readable contrast. Scrollable tables expose a labelled keyboard focus target. Dialog handlers follow the latest state. The mobile drawer traps focus, makes the main area inert, closes on Escape and restores focus. Unknown routes show a dedicated recovery page. Review tabs persist in the URL and work with reload/back. Refresh failures clear previously successful evidence. Operation recovery labels distinguish unknown, rolled-back and refunded outcomes; signing is gated by server operation state. Automated accessibility checks supplement selected keyboard/mobile review and do not claim full WCAG certification.
