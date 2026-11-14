# NEAR approvals and workspace onboarding

This supplement describes the implemented 3.1 authorization boundary. It does not change the approved original product specification or claim that simulations settle on NEAR.

## Two kinds of proof

1. A financial contract action produces an unsigned `live-plan`. Meteor signs and sends the exact prepared NEAR **testnet transaction**. The server accepts settlement only after checking the final signer, contract, method, arguments, deposit, block anchor and receipt outcome. Opening a preview is not settlement.
2. A sensitive local record or planning decision requires a **NEP-413 message signature** from the authenticated account. It is verified against that account's current full-access public key on NEAR testnet. This is an off-chain decision proof, with no gas fee or token transfer. It is not an investment, loan or transaction receipt.

The [final NEP-413 specification](https://github.com/near/NEPs/blob/master/neps/nep-0413.md) defines the separation between messages and transactions. numa's verifier uses the tagged Borsh/SHA-256 format. Signed decision messages use ASCII text and JSON Unicode escapes for interoperability with older Borsh encoders; the command hash covers the original Unicode payload.

## Command inventory

| Surface                                                                                                                                             | Approval boundary                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Company registration, employee registration and employment acceptance                                                                               | Prepared NEAR contract call and verified receipt. A company stays `DRAFT` until registration is confirmed.                                      |
| Treasury funding/withdrawal, payroll authorization, adjustments, mandate renewal/pause, employee claims/withdrawals, savings policies/pause/release | Prepared NEAR contract call and verified receipt.                                                                                               |
| Company settings, job roles, employee profile changes, invitation reissue/revocation                                                                | Bound NEP-413 decision signature before local mutation.                                                                                         |
| Company member invitation, acceptance and revocation                                                                                                | Bound NEP-413 signature. Acceptance also binds the exact company, invited account, access, invitation version/state/expiry and company version. |
| Local-only salary/employment status plan with no contract change                                                                                    | Bound NEP-413 signature at `/live/prepare`, including immutable plan input hash, step, effects and commit.                                      |
| Discarding an unsigned/retryable plan                                                                                                               | Bound NEP-413 signature; unresolved wallet operations remain locked.                                                                            |
| Sensitive personal planning commands, including DCA, destinations, allocations, investment scenarios, Earn/loans, salary scenario inputs and reset  | Bound NEP-413 signature. Every command includes planning identity, book and profile epoch. Results remain labelled `demoUSD` simulations.       |
| Admin provider/runtime/site/company settings and catalog refresh                                                                                    | Operator authorization plus bound NEP-413 signature. Catalog refresh also has an idempotency key.                                               |
| Preview creation, assistant proposals, read-only Intents quotes, navigation, exports and notification read markers                                  | No wallet signature or meaningless chain transaction. These do not authorize a financial execution.                                             |
| Explicitly enabled sample demo personas                                                                                                             | Remain simulation-only and are exempt from real wallet signatures. Production/default sample sign-in stays disabled.                            |

Previously signed payroll mandates and planning schedules authorize bounded automation. The scheduler does not ask the user to sign each timer tick; it can only execute the allowed contract mandate or labelled planning scenario.

## HTTP protocol

A protected command without a decision proof returns HTTP `428` with `code: APPROVAL_REQUIRED` and an `approval` object containing: opaque challenge `id`, 32-byte base64 `nonce`, `recipient`, human-readable `message`, `network: testnet`, verified `accountId`, `action`, authorized `companyId`, state-bound SHA-256 `commandHash`, five-minute `expiresAt`, exact visible `payload` and state `basis`, and `effect: LOCAL_RECORD_OR_SIMULATION`.

The client shows the exact message/payload/basis and explicitly asks the user to continue in Meteor. It signs the server-issued message, recipient and nonce. The client retries the **same endpoint, body and Idempotency-Key**, adding `X-Numa-Approval` as base64url-encoded JSON:

```json
{ "challengeId": "...", "accountId": "...", "publicKey": "ed25519:...", "signature": "base64..." }
```

The server verifies actor, current session, account, domain/recipient, endpoint, action, company, exact request, state basis, nonce and expiry. It checks the full-access key against testnet and rechecks session validity after that RPC. It consumes the nonce once before mutation. Concurrent retries share a lock and return the persisted result once applied. A changed payload/key/domain/account/session cannot reuse a pending proof.

Applied response caching compares the immutable request hash independently from the state-bound command hash. Therefore retrying a completed reset returns its old result without resetting again; an unexecuted signature for the old planning epoch cannot credit the replacement book. The epoch is also rechecked immediately before execution to cover a reset during access-key verification.

If execution fails, the consumed proof is recorded as `FAILED`; the next review uses a fresh nonce. If the process stops after the underlying idempotent command commits but before the approval result is stored, a new approval can recover the command's cached result without repeating its effect. The app never interprets an unknown outcome as authority for a second payment.

Bearer invitation tokens are replaced by their SHA-256 hashes in wallet-visible messages and proof metadata. The original request is still bound by the command hash. Other identities' preview/import details are authorized before building a challenge; they never appear in a `428` error.

## Invitation and registration recovery

- Authenticated onboarding lists authorized active memberships and personal employments. Owner registration plans are visible only to that owner.
- Invitation links reveal company, access and employment details only to the exact invited NEAR account. Malformed links return a typed `INVALID` state.
- A new member invitation atomically supersedes older pending invitations for the same company/account. Revoking access also revokes all that account's pending company invitations. A previously signed acceptance cannot restore revoked access.
- Suspended employers cannot accept memberships or employment through a direct command or a previously reviewed employment plan.
- `company.register` resumes the owner's safe unexpired draft plan or regenerates an expired unsigned/known-failed plan with the same opaque company ID and registration operation ID. It blocks a second registration while an earlier dispatch/submission/confirmed operation needs reconciliation. Observing a company on chain alone never falsely marks the local draft registered.
- The legacy `/workspaces` endpoint filters revoked and mismatched-book memberships and returns a minimal company projection.

## Storage and tests

Database schema 5 adds a local `decision_approvals` journal. Existing databases are snapshotted before migration. Applied proofs are immutable, and verified message/account/key/signature fields cannot be rewritten. `/api/v1/approvals` returns only the current user's latest 50 signed proofs; these are private runtime records and are excluded from release archives.

The added tests use real ephemeral NEAR signatures. RPC ownership is mocked in isolated unit/HTTP fixtures; signature encoding, account/session/domain/body binding, nonce replay, expiry, concurrency, payload tampering, cancellation without mutation, session revocation, Unicode, cross-user/company privacy, invitation supersession/revocation, company suspension, draft registration recovery and planning reset races are exercised. These tests do not claim an independently performed human Meteor approval journey.

Relevant code: `apps/api/src/approvals.ts`, `apps/api/src/server.ts`, `apps/api/src/live.ts`, `apps/api/src/onboarding.ts`, `packages/db/src/index.ts`; regressions in `tests/approvals.test.ts`, `tests/live.test.ts`, `tests/production.test.ts`, `tests/onboarding.test.ts`.
