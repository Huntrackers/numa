# Final submission checklist and English drafts

Repository: https://github.com/Huntrackers/numa

Rules source: https://nearhackathon.com/HACKATHON.md (checked 2026-11-14).
Deadline: **2026-11-14 23:59 UTC**, **2026-11-15 03:29 Asia/Tehran**.

## Human-owned gates

- Confirm the public repository is accessible anonymously and keep it public through judging.
- Review the demo recording and publish a public X post yourself. For a local-only app, attach a
  video, not screenshots alone. Include "built at NEAR HACKATHON", `@NEARProtocol` and `#NEARHackathon`.
- Provide the actual lead name, contact email, team-size choice and mainnet prize-payout account.
  A testnet executor address is not a valid substitute for the team's payout identity.
- Confirm project name and track IDs. Suggested: `realworld`, `security`.
- If a contributor submits a second independent project, name it in both READMEs per Q-015.
- Confirm whether this repository/project has already been submitted. Never submit it twice.
- Read and explicitly accept the notice: "I agree that the organizers may use these details to
  review our submission and contact us about this hackathon."
- Review the entire exact JSON payload before authorizing the one submission. Store it outside Git.

The agent has not published an X post, invented identity/contact fields, consented on the owner's
behalf, spent mainnet funds or sent the contest application.

## Short X draft

```text
Payroll automation should not need the keys to the whole treasury.

Built numa at NEAR HACKATHON: bounded testnet payroll, employee savings and live NEAR Intents dry previews. Investing and loans are clearly labelled simulations.

https://github.com/Huntrackers/numa
@NEARProtocol #NEARHackathon
```

Attach the reviewed demo video. If a longer post exceeds the account's limit, use the shorter copy:

```text
Built numa at NEAR HACKATHON: bounded NEAR testnet payroll + employee savings. Live Intents dry quotes; investing is simulated.
https://github.com/Huntrackers/numa
@NEARProtocol #NEARHackathon
```

## Project description draft

numa connects company payroll and employee savings on NEAR testnet. Companies define job roles,
employees and daily, weekly or monthly salaries, review bulk changes and reserve a bounded payroll
window. A restricted function-call executor can only execute due obligations on the configured vault.
The contract prevents duplicate credits and allocates savings atomically. Employees claim eligible
pay and withdraw using their own wallet. Sensitive local changes require exact NEP-413 approvals;
financial operations require verified NEAR transaction receipts. The shared execution guard checks
network, receiver, method, accounting readiness and reviewed code. Company funding, salary conversion,
allocation, DCA and investing screens expose live, signature-verified NEAR Intents dry quotes without
moving funds. Real testnet settlement, live read-only prices and simulated investing/loans are explicitly
separated. A public evidence center and a keyless temporary review workspace make the product inspectable
and reproducible without paid APIs.

## Demo outline (about 90 seconds)

1. Landing: name the payroll problem and choose a workspace.
2. Company fixture: show role pay, bulk-change review and an accelerated funded payroll.
3. Wait for the isolated worker's five sample salary credits; call them fictional demoUSD.
4. Employee fixture: show salary allocation and a savings goal.
5. Company Treasury: expand NEAR Intents, quote Base USDC → NEAR USDC using public sample addresses.
   Show verified output and the zero-funds-moved label. Edit the amount to invalidate it.
6. Trust: show the reviewed testnet deployment and historical real receipts. Do not describe fixture
   payroll as the transaction shown in the explorer.
7. Policy lab: show a blocked unrestricted key. State that DCA, stocks and loans are simulations.

## Submission API shape, not a payload

The required keys are `requestId`, `projectName`, `leadName`, `email`, `size`, `tracks`, `nearAddress`,
`projectUrl`, `demoUrl`, `idea`, `consent`. Do not send a `website` field; the API treats it as a spam trap.
Generate one UUID once and reuse it on a permitted retry. The endpoint is
`POST https://nearhackathon.com/api/applications`; only 201 confirms storage. A 403 is not retried;
409 requires checking the previous submission rather than changing identities or URLs. Corrections
to an existing submission go through https://nearhackathon.com/request-changes.
