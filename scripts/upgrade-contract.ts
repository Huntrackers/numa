// Legacy entry point now uses the guarded V3 migrator. With no arguments it
// snapshots only; it can never deploy a new state layout without migration.
import './upgrade-contract-v3.js';
