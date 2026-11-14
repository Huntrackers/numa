# Operator runbook

## Free local setup

1. Install Node 24 LTS; run `npm ci` and `npm run build` from the repository root.
2. Copy `.env.example` to a private `.env`. Leave `DEMO_ENABLED=false`, `HOST=127.0.0.1` and
   `NEAR_NETWORK=testnet`. Do not expose this local release directly to the public internet.
3. Set `NEAR_CONTRACT_ID` to your reviewed testnet vault and `NEAR_EXPECTED_CODE_HASH` to its
   finalized code hash. Public evidence can be inspected without its deployment keys.
4. Start `npm start` and `npm run worker` separately. Confirm `/api/v1/health` and `/trust`.
5. Connect a testnet wallet; NEP-413 proves control. Configure `NUMA_ADMIN_ACCOUNTS` only with
   accounts authorized to manage the installation. Operator status does not grant vault withdrawals.
6. Create a company, sign registration, create a role and an account-bound invitation. The invited
   identity accepts it. Review each transaction receiver, arguments, deposit and network in the wallet.
7. Fund with free native testNEAR from a faucet. Register and authorize a bounded payroll window.
8. For automation, review `npm run testnet:secure-executor` and `docs/START_HERE.fa.md` first.
   Supply only the dedicated function-call key, never a full-access treasury key, through a private
   file referenced by `NEAR_EXECUTOR_KEY_FILE`. It must allow only `execute_due` on the exact vault.
9. Observe the worker, finalized receipts and balanced journal. Employee claims/withdrawals use the
   employee's wallet, not the worker's key. Without an executor key, no automatic chain payment is sent.

## Intents dry mode

`GET /api/v1/intents/tokens` returns a validated subset of the provider catalog. The client submits
the returned `assetId` values to `POST /api/v1/intents/preview`:

```json
{
  "originAsset": "COPY_FROM_LIVE_CATALOG",
  "destinationAsset": "COPY_FROM_LIVE_CATALOG",
  "amount": "100",
  "slippageBps": 100,
  "recipient": "MAINNET_FORMAT_DESTINATION",
  "refundTo": "MAINNET_FORMAT_SOURCE"
}
```

These are explanatory placeholders, not a runnable request. The actual UI fills catalog choices.
The backend rejects unknown fields, including `dry`, arbitrary provider URLs and credentials.
It hard-codes `dry: true`, `EXACT_INPUT` and the official provider origin. Amounts become exact atomic
integers; destination/refund addresses must match the selected mainnet chain. An official-SDK
signature, signed request echo, positive amounts, timestamp and deadline are checked before display.

Responses explicitly state `fundsMoved:false`, `executionEnabled:false` and `depositAddress:null`.
There is no wet-quote, deposit notification or mainnet signing endpoint. Testnet addresses are not
sent as mainnet beneficiaries. A quote never updates the treasury, salary, DCA budget or ledger.

No API subscription or JWT is required to request a quote. This does not mean mainnet swaps would
be free: provider, liquidity, network and slippage costs would apply to a future execution release.
Fee documentation can change; output and returned provider fee information are shown rather than
promising a fixed universal percentage.

## Recovery, backup and stop

- Stop the worker before maintenance; do not delete its journal or retry an unknown outcome blindly.
- Use the Network view to inspect pending operations and reconcile a finalized hash. Unknown or
  partially signed results stay locked until receipt evidence resolves them.
- `npm run db:backup` creates a local backup; `npm run db:verify-backup` checks it. Keep backups private.
- `npm run db:reconcile` is an operator tool; inspect its usage and environment before running it.
- Never deploy V3 code over V2 storage without the reviewed atomic migration procedure. Build WASM
  from `contracts/payroll-vault` so the repository's target flags are applied.
- In an incident pause automated dispatch, preserve evidence and reconcile balances. A scheduling
  pause does not by itself revoke employee contract rights.

## Before any mainnet release

Independent contract/security review, token accounting review, adequate persistent-storage funding,
monitoring, tested recovery, deployment-key governance and applicable legal review are still needed.
Real investment/yield/lending products need separate integrations and risk controls. Publication for
this hackathon does not remove those requirements.
