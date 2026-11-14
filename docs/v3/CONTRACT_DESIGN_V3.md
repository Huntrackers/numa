# V3 payroll contract storage change

Canonical scope: `D:/NEAR Hackathon/Project/contracts/payroll-vault/src/lib.rs`, `src/v3_tests.rs`, and `src/lazy_business_tests.rs`. No deployment or transaction was performed. No API, shared script, package, environment, or key file was changed by this agent.

## Defensive review correction

The first V3 draft retained bounded native business maps. Independent review reproduced a callback failure at only 500 populated policies: persisting the 723,550-byte main STATE exceeded the callback's 20 TGas budget. That draft was not deployed and is superseded by the implementation below.

All five business maps now use stable SDK `IterableMap`; the pending ID index uses `IterableSet`. No business row or pending ID is embedded in STATE. Each collection has a unique prefix. External views sort their bounded results by key to retain the original BTreeMap order and pagination. Callbacks perform direct record lookups and never enumerate or sort unrelated business records.

Final full suite: **29 passed, 0 failed, 1 optional private-fixture test ignored**, 48.35 seconds. The optional private-fixture test was separately executed and passed. A fresh-loaded callback with **1,500 policies (ten 100-byte goal IDs each) and 2,000 pending withdrawals** persists STATE and drops all SDK caches within 20 TGas: success **1.022469999802 TGas**, failure **1.248609585814 TGas**. Duplicate callbacks also fit. Main STATE remains **372 bytes**, the same size before and after population. Sorted-list/pagination regression passes.

Actual private snapshot rehearsal: all **61 events**, every operation/withdrawal/business row, and both accounting scalars matched the exact V2 snapshot. Main STATE is **397 bytes** (the executor account length differs from the synthetic fixture). Migration plus STATE write and SDK drop used **15.093515455359 TGas**. Recorded storage changed **763,344 → 771,554 bytes**. The original recorded balance was preserved, with liability and backing checks passing. The rehearsal uses original code-storage usage; deployment review must also account for the new WASM size difference. No private snapshot data is embedded in test sources or distributable artifacts; the optional test reads file paths from environment variables at runtime.

Current evidence: `lazy-business-final.log`, `lazy-callback-gas.log`, `private-snapshot-rehearsal.log`, `callback-storage-bound-lazy.log`. Source SHA256: `95FB654975566A8CD7FBE977789269DD116A9686B40CD15F585DC9AC9CB4B4DC`.

## Design

- Public accounting schema remains `version: 2`; historical detail JSON remains `schemaVersion: 2`. Method arguments, event rows, detail envelopes, receipt fields, and page limits remain compatible. `financial_summary` adds `storageVersion: 3`.
- All events use `near_sdk::store::Vector<Event>`. All withdrawals and operation/detail records use `LookupMap`, preserving every receipt, replay hash, extended goal-rule record, and historical detail blob. Prefixes are distinct (`numa:v3:e`, `numa:v3:w`, `numa:v3:o`). The one-time marker uses a separate key.
- Event pages address indexes directly; they do not traverse earlier rows. Receipt lookup does not scan archived withdrawals. Only the bounded pending ID set is enumerated by the summary.
- The 12,000-event business limit and 2,000-lifetime-withdrawal limit are removed. `maxEvents` truthfully reports the SDK Vector index ceiling, 4,294,967,295. `maxWithdrawals` is null. Up to 2,000 concurrent pending withdrawals are allowed, retaining compatibility with every possible V2 pending set. Resolved IDs remain permanently stored, so they cannot be reused.
- One event slot and 8,192 bytes of collateral are reserved per pending withdrawal. Other events cannot consume those slots; callback resolution releases its own reservation and appends its durable event. Callback completion has no historical-count gate and no new collateral requirement.
- Storage checks flush all SDK caches before measuring actual trie storage. They account for replacement of the main STATE record instead of double-counting its old bytes. The withdrawal preflight includes the outgoing transfer amount, so the amount being dispatched cannot serve as storage collateral.
- Business records now use lazy iterable maps. New policy accounts are capped at 1,500; existing policies can still be changed and all migrated policies are preserved. Existing company/employee/obligation bounds are retained to bound full summary/list views. Cash entries arise only from bounded employment and policy accounts.

## Migration requirements

Use an atomic self-addressed deployment plus `migrate_from_v2` call. The method is `#[private]`, `#[init(ignore_state)]`, and also explicitly checks predecessor equals current account. It reads the exact V2 Borsh field sequence/types. It rejects a repeated migration, invalid receipt states, inconsistent pending sums, and discontinuous historical event sequences.

The migration copies every V2 business map and accounting scalar, every withdrawal, every operation/detail blob, and every event in order. It recreates the pending index without resubmitting transfers. Existing callback method signatures remain valid. No migration event is inserted, so historical counts and sequences are preserved exactly.

Before deployment, snapshot the current account, confirm V2 layout, confirm sufficient unencumbered storage balance, and rehearse that **the complete snapshot fits a single receipt's gas budget**. The migration is intentionally one-shot; a large V2 snapshot near its old limits may require a separately designed staged migration. This implementation does not claim arbitrary maximum-size V2 migration will fit. Check the actual deployed snapshot and pending receipts immediately before the atomic upgrade. Retain the original WASM/state snapshot for audit and rollback planning.

Storage backing after migration must cover existing liabilities, actual retained trie/main-state storage, the fixed 0.1 NEAR safety reserve, and 8,192 bytes per pending callback. An unfunded migration fails atomically.

## Verification evidence

The first history-only regression run passed 27 tests. The superseding fully lazy implementation also retains all of those tests, plus the full callback gas regression and sorted-view regression described above. The original 18 tests and these nine history/migration regressions remain passing:

1. Employee claim plus goal events crosses 12,000 historical events.
2. Withdrawal request at 11,999 events and success/failure callbacks cross the old boundary; duplicate callbacks remain idempotent.
3. 2,001 actual successful withdrawal/callback pairs preserve archived receipt lookup/replay rejection and allow a new withdrawal. Main-state serialized byte length stays constant.
4. Insufficient post-transfer callback collateral rejects the request before a transfer promise is created.
5. Maximum-length IDs/accounts and large numerical values, including a colliding obligation detail snapshot, remain below the callback storage reservation.
6. Migration compares every business map, scalar, historical event, operation blob, and receipt; exercises both pending callback outcomes; retains registration/funding/withdrawal replay defenses; rejects repeat migration.
7. Non-self migration is rejected.
8. Concurrent pending limit is enforced independently of archival history.
9. A sparse native fixture at the SDK u32 boundary proves unrelated events cannot use a callback's reserved last slot, and the callback successfully writes that final slot.

The callback footprint fixture measured **1,064 bytes** of maximum-ID event/detail trie growth against **8,192 reserved bytes**. The superseding implementation additionally includes a full native callback gas check, including state read/write and SDK drop, as recorded above. Native tests still do not substitute for execution of compiled WASM on the target runtime.

Logs: `v3-tests-final.log`, `callback-storage-bound.log`. `lib-v2.rs` is the preserved original source. Native Rust unit tests simulate state/promise contexts; caught panics do not emulate transactional rollback, which the chain runtime supplies.

## Remaining operational limits

History still consumes real storage stake and the Vector uses u32 indexes. The new design removes low lifetime caps; it does not make storage free or infinite. Full summary/list views read bounded business collections, but withdrawal callbacks read only affected rows and persist fixed-size collection descriptors. Unresolved transfers remain reserved until their genuine callback resolves; no timeout releases unverified money.
