import { it, expect, vi, afterEach } from 'vitest';
import { ReadOnlyIntents, exactUnits, addressMatches } from '../apps/api/src/intents.js';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import signedFixture from './fixtures/oneclick-signed-dry.json';
const tokens = [
  { assetId: 'base-usdc', symbol: 'USDC', blockchain: 'base', decimals: 6 },
  { assetId: 'near-usdc', symbol: 'USDC', blockchain: 'near', decimals: 6 },
];
const input = {
  originAsset: 'base-usdc',
  destinationAsset: 'near-usdc',
  amount: '100',
  slippageBps: 100,
  recipient: 'wrap.near',
  refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
};
function client(
  options: { verify?: boolean; alter?: (q: any) => void; status?: number; message?: string } = {},
) {
  const transport = vi.fn(async (url: any, init: any) => {
    if (String(url).endsWith('/tokens')) return new Response(JSON.stringify(tokens));
    const request = JSON.parse(init.body);
    const q = {
      quoteRequest: { ...request, appFees: [{ recipient: 'provider.near', fee: 1 }] },
      quote: {
        amountIn: request.amount,
        amountOut: '99990000',
        minAmountOut: '98990000',
        timeEstimate: 35,
      },
      timestamp: new Date().toISOString(),
      signature: 'fixture-only',
    };
    options.alter?.(q);
    return new Response(JSON.stringify(options.status ? { message: options.message } : q), {
      status: options.status || 201,
    });
  });
  return {
    service: new ReadOnlyIntents(transport as typeof fetch, () => options.verify !== false),
    transport,
  };
}
afterEach(() => vi.restoreAllMocks());
it('verifies an actual provider dry-quote signature and rejects tampering using the official SDK', () => {
  expect(verifyQuoteSignature(signedFixture as any)).toBe(true);
  const changed = structuredClone(signedFixture);
  changed.quote.amountOut = '1';
  expect(verifyQuoteSignature(changed as any)).toBe(false);
});
it('forces dry mode, exact atomic units and fixed provider origin with no execution material', async () => {
  const { service, transport } = client();
  const r = await service.preview(input);
  expect(r).toMatchObject({
    dry: true,
    signatureVerified: true,
    fundsMoved: false,
    executionEnabled: false,
    depositAddress: null,
    minAmountOut: '98990000',
    providerAppFees: [{ fee: 1 }],
  });
  const [url, init] = transport.mock.calls[1];
  expect(url).toBe('https://1click.chaindefuser.com/v0/quote');
  expect(JSON.parse(init.body)).toMatchObject({
    dry: true,
    amount: '100000000',
    depositType: 'ORIGIN_CHAIN',
    recipientType: 'DESTINATION_CHAIN',
    refundType: 'ORIGIN_CHAIN',
  });
  expect(init.redirect).toBe('error');
});
it.each([
  { dry: false },
  { url: 'https://attacker.example' },
  { depositAddress: 'attacker' },
  { jwt: 'secret' },
])('rejects extra control fields before the provider call: %j', async (extra) => {
  const { service, transport } = client();
  await expect(service.preview({ ...input, ...extra })).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it('rejects an invalid signature', async () => {
  await expect(client({ verify: false }).service.preview(input)).rejects.toThrow('signature');
});
it.each(['recipient', 'originAsset', 'dry', 'amount'])(
  'rejects a signed response with an altered %s',
  async (field) => {
    await expect(
      client({ alter: (q) => (q.quoteRequest[field] = 'changed') }).service.preview(input),
    ).rejects.toThrow('does not match');
  },
);
it('rejects stale quotes', async () => {
  await expect(
    client({
      alter: (q) => (q.timestamp = new Date(Date.now() - 180000).toISOString()),
    }).service.preview(input),
  ).rejects.toThrow('stale');
});
it('rejects a zero minimum or output larger than its maximum', async () => {
  for (const min of ['0', '9999999999'])
    await expect(
      client({ alter: (q) => (q.quote.minAmountOut = min) }).service.preview(input),
    ).rejects.toThrow('inconsistent');
});
it('distinguishes provider internal errors from route liquidity errors', async () => {
  await expect(
    client({ status: 400, message: 'Internal server error' }).service.preview(input),
  ).rejects.toMatchObject({ code: 'INTENTS_UNAVAILABLE', status: 503 });
  await expect(
    client({ status: 400, message: 'No quotes found' }).service.preview(input),
  ).rejects.toMatchObject({ code: 'INTENTS_NO_ROUTE', status: 422 });
});
it('rejects unknown assets, testnet recipients and same-asset routes', async () => {
  const { service } = client();
  await expect(service.preview({ ...input, originAsset: 'unknown' })).rejects.toThrow(
    'current 1Click catalog',
  );
  await expect(service.preview({ ...input, recipient: 'worker.testnet' })).rejects.toThrow(
    'mainnet-format',
  );
  await expect(service.preview({ ...input, destinationAsset: input.originAsset })).rejects.toThrow(
    'different destination',
  );
});
it('preserves exact large amounts and refuses precision loss', () => {
  expect(exactUnits('999999.123456', 6)).toBe('999999123456');
  expect(exactUnits('0.000000000000000000000001', 24)).toBe('1');
  expect(() => exactUnits('1.0000001', 6)).toThrow('decimal');
  expect(() => exactUnits('0', 24)).toThrow('greater');
  expect(() => exactUnits('1e4', 24)).toThrow();
});
it('deduplicates concurrent catalog reads', async () => {
  const { service, transport } = client();
  await Promise.all([service.tokens(), service.tokens(), service.tokens()]);
  expect(transport).toHaveBeenCalledTimes(1);
});
it('enforces chain-specific destination format without claiming ownership', () => {
  expect(addressMatches('near', 'wrap.near')).toBe(true);
  expect(addressMatches('near', 'x.testnet')).toBe(false);
  expect(addressMatches('base', input.refundTo)).toBe(true);
  expect(addressMatches('sol', '0x1234')).toBe(false);
  expect(addressMatches('unknown', 'anything')).toBe(false);
});
