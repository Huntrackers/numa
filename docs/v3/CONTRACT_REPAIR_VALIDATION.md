# Independent V3 contract repair validation

Reviewed 2026-11-06. Scope: contract source, V2 schema from numa-v2.0-source.zip, provided V3 tests, upgrade scripts, and supplied private-snapshot rehearsal log. No deployment, signing, canonical source edits, or private-key reads were performed. Reviewed source hashes are recorded in reviewed-source-hashes.json.

## Current result

The two concrete findings from the initial review are repaired in the reviewed source. No additional confirmed release-blocking defect was identified in this bounded contract review. This is not a numeric security score or a production audit certification.

Fresh command: `npm run test:contract` from `D:\NEAR Hackathon\Project`.
Result: **29 passed; 0 failed; 1 ignored**, completed in 43.34 seconds. The ignored test is the opt-in private V2 snapshot rehearsal. The Windows launcher validates and adds the LLVM-MinGW runtime DLL directory before executing Cargo tests.

The initial sandboxed invocation failed before tests started with Node `uv_os_get_passwd` ENOMEM. The authorized invocation outside that sandbox completed successfully. An earlier direct test-binary invocation on the old source exited with missing-runtime status -1073741515 and is not counted as a test result.

## Repaired findings

### P1 — Callback guaranteed gas budget could not persist the full native business state (closed)

Initial code retained native BTreeMaps for policies, obligations, employees, companies and cash, plus a native pending BTreeSet. An isolated reproduction used 500 valid public policy updates with ten legal 100-byte goal IDs each. STATE reached 723,550 bytes. A callback reload and method body consumed approximately 9.42 TGas of host charges, then the SDK STATE write failed with `HostError(GasExceeded)` at 20 TGas. A failed callback would roll back settlement, leaving its withdrawal PENDING.

Precision: `with_static_gas(20 TGas)` guarantees a minimum; the SDK default unused-gas weight may also allocate unused parent gas. The reproduction establishes failure at the guaranteed callback budget, not that every invocation necessarily receives exactly 20 TGas. The native test excludes Wasm instruction metering.

Repair verified at lib.rs:136, lib.rs:160, and lib.rs:1008: all business maps now use stable, distinct SDK IterableMap prefixes, and pending IDs use IterableSet. Every relevant collection is explicitly flushed before collateral is measured. A callback touches only the relevant records. The provided `v3_callback_wrapper_fits_20_tgas_with_1500_policies_and_2000_pending` test passed for success, failure and duplicate resolution; it includes env::state_read, the callback, env::state_write, and Drop. It also asserts constant STATE size below 1 KiB.

### P1 — Legacy upgrade command deployed a changed layout without migration (closed)

The initial scripts/upgrade-contract.ts invoked deployContract alone and emitted stateLayoutChanged:false. Deploying V3 through it onto V2 state would leave normal methods unable to deserialize STATE.

Repair verified: the legacy entry point only imports upgrade-contract-v3.ts. The guarded script defaults to snapshot-only, validates the reviewed contract account and prior code hash, requires no pending transfers, checks accounting, and limits the permitted snapshot. Its apply path places deployContract and functionCall(migrate_from_v2) in one transaction action batch, then checks the new code hash, storage version, balances, reservations, history and account views. testnet-setup.ts now aborts when STATE already exists.

## Other reviewed evidence

- V3 ContractV2 has the exact field order and Borsh types used by the V2 source ZIP. Persisted nested Company, Employee, Obligation, Goal, GoalPolicy, Withdrawal and Event layouts also match.
- Migration copies business maps, operations, withdrawal receipts and ordered events. Pending withdrawal counts and totals are checked; migration is private and guarded against reuse.
- New collection prefixes are distinct. The V2 source stored all business data under STATE, so these V3 prefixes do not collide with old collection records.
- Sorted external views preserve V2 BTreeMap key ordering and pagination; the provided regression passed.
- Storage collateral includes flushed trie growth, replacement STATE size, and 8,192 bytes per pending callback. The outgoing transfer amount is included in the pre-dispatch check. The provided insufficient-collateral and maximum-ID callback-growth tests passed.
- Callback success/failure and duplicate resolution preserve accounting in the supplied tests. Callbacks require self predecessor and exactly one promise result. Used withdrawal IDs stay archived and cannot be reused after resolution.
- History crossed the old 12,000-event cap, withdrawals crossed 2,000 archived receipts, and callback event slots remained available at the SDK Vector index boundary in passing regressions.
- The supplied private-snapshot log reports a successful rehearsal of 61 events and one policy, retaining the recorded balance and all compared rows. Its reported migration plus state-write host gas is 15,093,515,455,359 and main STATE is 397 bytes. I read the rehearsal implementation and log; I did not independently rerun that private fixture.

## Remaining evidence limits

The successful suite uses the native near-sdk mock runtime. It covers host gas and SDK persistence but is not a full Wasm sandbox or on-chain gas profile. The guarded migration and supplied rehearsal intentionally cover a small reviewed V2 snapshot; maximum-size V2 migration is not established. No mainnet deployment, audit certification, or production-scale load result is claimed.

Sources for relevant runtime semantics: https://docs.near.org/smart-contracts/anatomy/collections and https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-panics .
