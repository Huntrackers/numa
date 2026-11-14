# Independent numa V3 review

Reviewed 6 November 2026. **Corrected candidate: PASS. Non-official preliminary observed-delivery and assurance score: 95/100.** This is not an official judging score or a forecast of a human jury outcome.

## official_rules_checked

Freshly retrieved [official site](https://nearhackathon.com/) and [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) on 2026-11-06. Q-017 describes screening and leaves final decisions to humans. Q-010 permits testnet; Q-011 makes integrations optional; Q-012 permits local demonstrations with a public repository, reproducible instructions and X video. Q-014 requires a LICENSE and public repository through judging. No official numerical weights or 99-point threshold were published. The saved Markdown hash is 86654c13521fe629493bf498d41c0f7573047867d67fcdd8c2543411fc13062f.

## environment

Windows 10.0.26300.0 x64; Node 24.16.0; npm 11.13.0; installed Chromium through the packaged Playwright resolver. Extraction was fresh with no node_modules or private environment file. All generated artifacts are confined to the independent reproduction directory.

## commands_executed and reproducibility_result

- Original archive SHA-256: 8d32b1b31842b185456ec4296f13b7296f2a3fbf943ac48ab42c8af26d6f52fc. All 221 original manifest entries matched. No unexpected/private env, DB or key files were present. Two long Ed25519 values are public quote signatures.
- npm ci exited 0 and installed 234 packages.
- Original npm run verify -- --browser exited 1 at SOURCE_MANIFEST.json formatting. This genuine packaging defect is preserved in original-package-format-failure.log.
- Only six explicitly approved release paths were updated: exporter, atomic setup script, walkthrough script, manifest, and V2/V3 walkthrough metadata. No app, UI or contract code changed. All 222 corrected manifest entries matched; manifest hash 82de3b229c7098c16f902fd590b53118abd3a22b01fcd0dc5bbfb05eba63433b.
- Corrected npm run verify -- --browser exited 0 in 146.560 seconds: 227/227 unit/API tests, 10/10 HTTP checks, and 47/47 browser tests with zero skipped or flaky cases. The fresh HTTP workspace started in 1056 ms.
- Source digest remained unchanged during verification: c043536caa64400e2453c062fb53c327a6175035bb20b04004ed7a2ef3b391fe. Final setup-script hash: f78a4be0ffb7eda1b6401f3b9f6dfa0ae27ae8fc1a97b748a0e9309c88679c5b.
- Native contract tests were independently rerun earlier: 29 passed, 0 failed, 1 intentionally ignored. They were not rebuilt inside this fresh extraction.
- Read-only public RPC independently confirmed the reviewed V3 code hash, storageVersion 3, valid liability/backing, credited target obligation, and successful migration and withdrawal transactions.
- A fresh request through the packaged Intents client verified a provider signature with dry: true, fundsMoved: false and executionEnabled: false. No signing or transaction was performed.

## claim_results

Evidence is scoped explicitly: passing fixture tests do not become new chain transactions. All 31 test/source references in the public claim inventory exist.

| ID | Outcome | Expected action/result | Independent observation |
|---|---|---|---|
| N01 | VERIFIED | Company sets roles, salary schedules and bulk amendments; preview explains each change. | Fresh API/domain and browser workflows; public amendment receipts are historical corroboration. |
| N02 | VERIFIED | Authorize a fully funded mandate; worker credits each obligation once. | Fresh isolated HTTP journey credits five fixture salaries exactly once; prior independent native tests and current public credited obligation corroborate real contract behavior. |
| N03 | VERIFIED | Changed network, receiver, method, key capability or contract hash stops dispatch. | Pure policy drill is correctly labelled synthetic; API dispatch and worker broadcast-boundary tests additionally execute the real guard paths with mocked transport. |
| N04 | VERIFIED | Employee claims eligible salary despite automation pause and withdraws own cash. | Prior independently run native pause/claim and withdrawal tests; fresh API/UI affordances; independent RPC confirms recorded V3 withdrawal and callback success. |
| N05 | VERIFIED | Employee goal policy allocates payday atomically, preserves floor and integer rounding. | Shared TypeScript/Rust vectors and native contract tests; fresh employee goal, contribution-basis and allocation browser checks. |
| N06 | VERIFIED | Reconciled journal balances and an older backup recovers finalized data. | Fresh backup/reconciliation tests and balanced entries for every salary in the HTTP fixture journey. |
| N07 | VERIFIED | Correct an invalid transaction hash; keep unknown outcomes locked instead of resending. | Fresh API and five browser recovery scenarios cover corrected proof, unresolved alternatives, initial rollback and refunded withdrawal. |
| N08 | VERIFIED | Identity, tenant and operator boundaries prevent unrelated account access and spending. | Fresh authentication/tenant/API tests; operator spending returns 403; pinned Meteor adapter initializes under CSP. Browser signing results are fixtures. |
| N09 | VERIFIED | Request a signed USDC Base-to-NEAR route preview with exact amounts and expiry. | Fresh public provider request through packaged ReadOnlyIntents returns signatureVerified: true, dry: true, fundsMoved: false, executionEnabled: false; UI expiry/outage/late-response tests pass. |
| N10 | VERIFIED | DCA, investment, Earn, loans and Flexible Payday remain in the labelled simulation book. | Fresh domain/API/browser workflows and source boundary inspection. No real market settlement is inferred. |
| N11 | VERIFIED | Assistant offers a typed proposal that needs server validation and human confirmation. | Fresh model validation and browser confirmation tests; source exposes no model signing path. Optional live Ollama explanation is separately NOT_RUN. |
| N12 | VERIFIED | Navigate company, employee and operator workspaces on desktop/mobile and by keyboard. | 47 browser tests passed, including axe audits, 390px viewport, focus restoration, table scrolling, dialog Escape guard and return navigation. |
| N13 | VERIFIED | Start judge mode without keys; obtain an isolated temporary fixture workspace. | Fresh HTTP startup 1056 ms; signer environment variables are removed and a new temporary database is used. |
| L01 | NOT_RUN | Complete a new real testnet journey through an interactive human Meteor wallet. | No wallet signatures or new chain transactions authorized in this review. Existing real receipts were independently inspected; browser signing boundaries were mocked. |
| L02 | NOT_RUN | Run optional local Ollama generation. | Optional model runtime is excluded from source; typed proposal safeguards were tested without relying on generation. |

Detailed code/test mappings are in INDEPENDENT_Q017_REVIEW.json. Fresh logs, reports, provider proof and public RPC responses are under public-evidence/.

## findings

**P2 closed — Generated source manifest prevented documented verification.** Reproduction was a clean install followed by npm run verify -- --browser. package.json includes root JSON in format:check, but the exporter emitted an incompatible manifest format. The exporter now formats the manifest using the repository Prettier configuration; the corrected full run passed. The original failure is retained.

**P3 remaining dependency observation — Eight low advisory entries.** Fresh npm audit reports 8 low and 0 moderate/high/critical entries. The elliptic advisory propagates through secp256k1 and NEAR-JS dependencies; these are not eight independently established application exploits. Exploitability of the product Ed25519 paths was not established. Track compatible upstream remediation; do not force breaking upgrades during release.

The earlier native-state callback and deploy-without-migration P1 findings were repaired and validated separately in CONTRACT_REPAIR_VALIDATION.md. No additional confirmed product blocker was found.

## track_fit

Real-World Money is the strongest fit: prefunded payroll and employee savings use a real NEAR vault. AI Security & Defense is supported by bounded executor authority and guards at API/worker dispatch boundaries. The visible policy lab itself is a clearly labelled unsigned evaluator demonstration. Autonomous Business is a partial fit; fully autonomous company management is not claimed.

## publication_gates

The public repository, public X video with required mention/tag, actual team/contact/payout details, consent and approved submission remain owner actions. LICENSE is present. The owner must verify any pre-window baseline/judged diff and reciprocal disclosure if another independent project is submitted. These follow Procedure 1–2, Q-001–005, Q-012, Q-014 and Q-015. No lack of users, mainnet, hosting, revenue, SLA or external audit is treated as an invented official disqualification.

## preliminary_score

**95/100 using this reviewer's non-official observed-delivery and assurance method:**

| Criterion | Score | Reason for any withheld points |
|---|---:|---|
| Reproducibility and artifact integrity |25/25|Corrected package, locked installation and documented verification reproduced.|
| Advertised behavior and observable evidence |28/30|2 withheld: new end-to-end interactive human-wallet journey was not independently performed; historical receipts and fixture browser boundaries are clearly separated.|
| Failure behavior and execution assurance |23/25|1 withheld: no full-size Wasm callback gas profile; 1 withheld: remaining low dependency advisories.|
| Interface and accessibility evidence |14/15|1 withheld: automated/keyboard checks were performed, but manual assistive-technology coverage was not.|
| Claim clarity and track fit |5/5|Real testnet, read-only data and simulation are distinguished and relevant.|

These weights were chosen for this technical prototype review; they are not attributed to the organizers. Withheld points for unperformed checks represent reduced assurance, not proof of a defect or eligibility failure. No deduction applies for active users, revenue, mainnet, paid hosting, SLA, external audit or unfinished publication. The evidence does not justify rounding this result to 99+.

## limitations and conclusion

This is a bounded native/API/browser reproduction with independent read-only corroboration. It does not establish production-scale performance, all Wasm instruction costs, manual screen-reader behavior, or a new human-wallet transaction. Optional Ollama generation was not run. Final documentation-only additions require fresh manifest validation; substantive code changes require renewed testing.

The corrected candidate reproduces successfully and supports its stated bounded functionality. Publication eligibility remains conditional on the owner's official submission gates.


