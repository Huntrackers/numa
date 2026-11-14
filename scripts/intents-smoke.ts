import { writeFileSync } from 'node:fs';
import { ReadOnlyIntents } from '../apps/api/src/intents.js';
let captured: any;
const client = new ReadOnlyIntents(async (url, init) => {
  const r = await fetch(url, init);
  if (String(url).endsWith('/quote') && r.ok) captured = await r.clone().json();
  return r;
});
const tokens = await client.tokens();
const origin = tokens.find((t) => t.blockchain === 'base' && t.symbol === 'USDC');
const destination = tokens.find((t) => t.blockchain === 'near' && t.symbol === 'USDC');
if (!origin || !destination) throw Error('The live catalog no longer offers this smoke route.');
const result = await client.preview({
  originAsset: origin.assetId,
  destinationAsset: destination.assetId,
  amount: '100',
  slippageBps: 100,
  recipient: 'wrap.near',
  refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
});
writeFileSync(
  'docs/INTENTS_READONLY_SMOKE.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      ...result,
      addresses: 'Public documented examples for a dry query only; not project-owned accounts.',
    },
    null,
    2,
  ),
);
if (captured)
  writeFileSync('tests/fixtures/oneclick-signed-dry.json', JSON.stringify(captured, null, 2));
console.log(
  JSON.stringify({
    mode: result.mode,
    signatureVerified: result.signatureVerified,
    dry: result.dry,
    fundsMoved: result.fundsMoved,
    executionEnabled: result.executionEnabled,
  }),
);
