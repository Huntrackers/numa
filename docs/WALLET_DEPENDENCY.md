# Wallet dependency provenance

numa uses @hot-labs/near-connect 0.12.0 (MIT), pinned exactly in package.json and package-lock.json. The UI permits only the Meteor manifest on NEAR testnet. A function-call key is never requested by the browser connector.

The unmodified Meteor executor is apps/web/public/wallet/meteor.js. SHA-256: 96210256a89cb382bb7fe95f29d6a2489319da87472fe77018b4cdcbf1672b50.

Source: https://github.com/Meteor-Wallet/meteor_wallet_sdk/blob/ef1be35fc3712f2de60a7563aed543d78e73f763/storage/meteor-near-connect-latest.js

The matching upstream script is distributed at /wallet/licenses/meteor-adapter-source.js. The upstream SDK preferred-source archive at commit cb83d1b7f6d8d50ab4ea2fcdabf9eda6a2ddadb9 is distributed at /wallet/licenses/meteor-sdk-source.zip. The upstream GPL-3.0 license is distributed at /wallet/licenses/meteor-sdk-LICENSE.txt. These files are separate from numa application code. Preserve their notices and source availability when redistributing.

Boundary review: local pinned executor, sandbox allow-scripts without allow-same-origin, CSP nonces, restricted external domains, testnet-only manifest, no full-access or delegated key creation, NEP-413 32-byte nonce and host binding, signed account matching, single prepared FunctionCall and explicit rejection handling. Real upstream Meteor Web initialization and popup were checked under the application CSP; signing/cancellation transport used deterministic fixtures. No claim of an independent security audit or completed human wallet signing is made.

The application receives a signed message or transaction hash; it does not collect a seed phrase or user private key. The isolated server-side executor key is limited to execute_due on the configured vault.
