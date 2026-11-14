# Third-party notices

The root MIT license applies to original numa application code, not to third-party software. Preserve upstream licenses and source notices. Dependency versions are locked in package-lock.json and contracts/payroll-vault/Cargo.lock.

| Component | Use | Upstream / license |
|---|---|---|
| React / React DOM | UI | https://github.com/facebook/react / MIT |
| Fastify and official plugins | API, cookies, CSP, rate limiting, static files | https://github.com/fastify / MIT |
| TypeScript | Type checking | https://github.com/microsoft/TypeScript / Apache-2.0 |
| Vite / Vitest / tsx | Build and testing | https://github.com/vitejs/vite / MIT; https://github.com/vitest-dev/vitest / MIT; https://github.com/privatenumber/tsx / MIT |
| Playwright | Browser tests and local video artifacts | https://github.com/microsoft/playwright / Apache-2.0 |
| axe-core 4.14.0 | Development-only accessibility checks | https://github.com/dequelabs/axe-core / MPL-2.0; notice in docs/licenses/axe-core.txt |
| near-sdk-rs | Vault | https://github.com/near/near-sdk-rs / MIT or Apache-2.0 |
| @near-js packages | RPC, ed25519 signatures and restricted executor | https://github.com/near/near-api-js / MIT or Apache-2.0, see installed package notices |
| @defuse-protocol/one-click-sdk-typescript 0.1.26 | Verify real dry quotes | https://github.com/defuse-protocol/one-click-sdk-typescript / ISC |
| @hot-labs/near-connect 0.12.0 | Sandboxed Meteor connector | https://github.com/azbang/near-connect / MIT |
| Meteor adapter and SDK source | Wallet transport in a sandboxed iframe | GPL-3.0. Full license, matching adapter source and SDK preferred-source archive are served in apps/web/public/wallet/licenses. See docs/WALLET_DEPENDENCY.md for commits and hashes. |
| Manrope / DM Sans | Local fonts | SIL Open Font License 1.1; upstream notices are in the fontsource packages |
| Lucide | Icons | https://github.com/lucide-icons/lucide / ISC |
| Zod / Luxon / noble curves / bs58 / buffer / dotenv / Drizzle | Validation, calendars, crypto and tooling | Preserve each installed package's license; full transitive inventory is generated in docs/DEPENDENCY_LICENSES.json |

The bundle carries locally served font licenses in docs/licenses. Run npm ci to restore dependencies and their notices. The development tools/model binaries in tools/ are local optional resources, excluded from source distribution. No paid hosted AI dependency is required.
