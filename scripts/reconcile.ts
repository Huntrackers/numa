import 'dotenv/config';
import { Store } from '../packages/db/src/index.js';
import { ensure } from '../packages/domain/src/index.js';
import { reconcileChain, reconcileSubmitted } from '../packages/near-adapter/src/reconcile.js';
import { LiveService } from '../apps/api/src/live.js';
const s = new Store();
try {
  const contract = process.env.NEAR_CONTRACT_ID;
  ensure(contract, 'CONTRACT_UNCONFIGURED', 'Configure the NEAR testnet contract.');
  await reconcileSubmitted(s);
  new LiveService(s).recoverProjections();
  const result = await reconcileChain(s, contract);
  console.log(
    JSON.stringify({
      network: 'testnet',
      state: result.state,
      accounting: result.accounting?.state,
      cursor: result.cursor,
      checkedAt: result.lastSuccessAt,
    }),
  );
} finally {
  s.close();
}
