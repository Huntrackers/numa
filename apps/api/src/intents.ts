import { z } from 'zod';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { ensure } from '../../../packages/domain/src/index.js';
const base = 'https://1click.chaindefuser.com/v0';
const atomic = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const tokenSchema = z.object({
  assetId: z.string().min(1).max(300),
  symbol: z.string().min(1).max(40),
  blockchain: z.string().max(30),
  decimals: z.number().int().min(0).max(30),
});
export const intentPreviewSchema = z
  .object({
    originAsset: z.string().min(1).max(300),
    destinationAsset: z.string().min(1).max(300),
    amount: z.string().regex(/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,30})?$/),
    slippageBps: z.number().int().min(0).max(300),
    recipient: z.string().min(2).max(128),
    refundTo: z.string().min(2).max(128),
  })
  .strict();
const supported = new Set(['near', 'eth', 'base', 'arb', 'btc', 'sol', 'tron']);
export type IntentToken = z.infer<typeof tokenSchema>;
export function addressMatches(chain: string, address: string) {
  if (chain === 'near')
    return (
      address.length >= 2 &&
      address.length <= 64 &&
      !address.endsWith('.testnet') &&
      /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/.test(address)
    );
  if (['eth', 'base', 'arb'].includes(chain)) return /^0x[a-fA-F0-9]{40}$/.test(address);
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (chain === 'btc')
    return /^(bc1[a-z0-9]{20,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(address);
  if (chain === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  return false;
}
export function exactUnits(value: string, decimals: number) {
  ensure(
    /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,30})?$/.test(value),
    'INVALID_AMOUNT',
    'Use a positive decimal amount.',
  );
  const [whole, part = ''] = value.split('.');
  ensure(
    part.length <= decimals,
    'AMOUNT_PRECISION',
    'The input has more decimal places than this token supports.',
  );
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt((part || '').padEnd(decimals, '0') || '0');
  ensure(result > 0n, 'INVALID_AMOUNT', 'The amount must be greater than zero.');
  return result.toString();
}
export class ReadOnlyIntents {
  private cache?: { tokens: IntentToken[]; at: number };
  private pending?: Promise<IntentToken[]>;
  constructor(
    private transport: typeof fetch = fetch,
    private verify: (q: any) => boolean = verifyQuoteSignature,
  ) {}
  private async request(path: string, body?: unknown) {
    let response: Response;
    try {
      response = await this.transport(base + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      ensure(
        false,
        'INTENTS_UNAVAILABLE',
        'The 1Click preview service is unavailable. No funds were moved.',
        503,
      );
    }
    const text = await response!.text();
    ensure(
      text.length <= 2_000_000,
      'PROVIDER_RESPONSE_INVALID',
      'The provider response exceeded the permitted size.',
      502,
    );
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      ensure(false, 'PROVIDER_RESPONSE_INVALID', 'The provider returned an invalid response.', 502);
    }
    const noRoute =
      response!.status === 400 &&
      /no quotes|no route|amount.*(small|minimum)|insufficient/i.test(String(data?.message || ''));
    ensure(
      response!.ok,
      noRoute ? 'INTENTS_NO_ROUTE' : 'INTENTS_UNAVAILABLE',
      noRoute
        ? 'The provider could not quote this route or amount. No funds were moved.'
        : 'The 1Click preview service is unavailable. No funds were moved.',
      noRoute ? 422 : 503,
    );
    return data;
  }
  async tokens() {
    if (this.cache && Date.now() - this.cache.at < 60000) return this.cache.tokens;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const raw = z
        .array(z.unknown())
        .max(10000)
        .parse(await this.request('/tokens'));
      const seen = new Set<string>();
      const tokens: IntentToken[] = [];
      for (const item of raw) {
        const parsed = tokenSchema.safeParse(item);
        if (
          parsed.success &&
          supported.has(parsed.data.blockchain) &&
          !seen.has(parsed.data.assetId)
        ) {
          seen.add(parsed.data.assetId);
          tokens.push(parsed.data);
        }
      }
      ensure(
        tokens.length > 0,
        'PROVIDER_RESPONSE_INVALID',
        'No supported tokens were returned.',
        502,
      );
      this.cache = { tokens, at: Date.now() };
      return tokens;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  async preview(raw: unknown) {
    const p = intentPreviewSchema.parse(raw),
      tokens = await this.tokens();
    const origin = tokens.find((t) => t.assetId === p.originAsset),
      destination = tokens.find((t) => t.assetId === p.destinationAsset);
    ensure(
      origin && destination,
      'UNKNOWN_PROVIDER_ASSET',
      'Choose tokens from the current 1Click catalog.',
    );
    ensure(
      origin.assetId !== destination.assetId,
      'SAME_ASSET',
      'Choose a different destination token.',
    );
    ensure(
      addressMatches(origin.blockchain, p.refundTo) &&
        addressMatches(destination.blockchain, p.recipient),
      'INVALID_DESTINATION',
      'Use mainnet-format addresses for this read-only quote. Testnet addresses are not valid for 1Click.',
    );
    const amount = exactUnits(p.amount, origin.decimals);
    // This module has no wet-quote, deposit, status mutation, intent-signing or broadcasting path.
    const request = {
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: p.slippageBps,
      originAsset: origin.assetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: destination.assetId,
      amount,
      recipient: p.recipient,
      recipientType: 'DESTINATION_CHAIN',
      refundTo: p.refundTo,
      refundType: 'ORIGIN_CHAIN',
      deadline: new Date(Date.now() + 180000).toISOString(),
      quoteWaitingTimeMs: 0,
    };
    const response = await this.request('/quote', request);
    let verified = false;
    try {
      verified = this.verify(response);
    } catch {}
    ensure(
      verified,
      'QUOTE_SIGNATURE_INVALID',
      'The provider signature could not be verified. This quote was rejected.',
      502,
    );
    for (const [k, v] of Object.entries(request))
      ensure(
        response.quoteRequest?.[k] === v,
        'QUOTE_REQUEST_MISMATCH',
        'The signed quote does not match the requested route.',
        502,
      );
    const quote = z
      .object({
        amountIn: atomic,
        amountOut: atomic,
        minAmountOut: atomic,
        timeEstimate: z.number().nonnegative().optional(),
        deadline: z.string().optional(),
      })
      .passthrough()
      .parse(response.quote);
    ensure(
      quote.amountIn === amount &&
        BigInt(quote.amountOut) > 0n &&
        BigInt(quote.minAmountOut) > 0n &&
        BigInt(quote.minAmountOut) <= BigInt(quote.amountOut),
      'PROVIDER_RESPONSE_INVALID',
      'The provider quote has inconsistent amounts.',
      502,
    );
    const timestamp = Date.parse(response.timestamp),
      now = Date.now();
    ensure(
      Number.isFinite(timestamp) && timestamp <= now + 30000 && now - timestamp < 120000,
      'QUOTE_STALE',
      'The provider quote is stale. Request a fresh preview.',
      409,
    );
    const expires = Math.min(
      now + 30000,
      Date.parse(request.deadline),
      quote.deadline ? Date.parse(quote.deadline) : Infinity,
    );
    ensure(
      Number.isFinite(expires) && expires > now,
      'QUOTE_EXPIRED',
      'The provider quote has expired.',
      409,
    );
    return {
      mode: 'LIVE_READ_ONLY',
      provider: 'NEAR Intents / 1Click',
      network: 'mainnet-data-only',
      signatureVerified: true,
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(expires).toISOString(),
      origin,
      destination,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      timeEstimate: quote.timeEstimate ?? null,
      slippageBps: p.slippageBps,
      recipient: p.recipient,
      refundTo: p.refundTo,
      dry: true,
      executionEnabled: false,
      fundsMoved: false,
      depositAddress: null,
      quoteDigest: response.signature,
      providerAppFees: z
        .array(
          z.object({ recipient: z.string().max(128), fee: z.number().int().min(0).max(10000) }),
        )
        .max(20)
        .parse(response.quoteRequest.appFees || []),
      feeNote: 'The provider fee schedule is reflected in its quoted output. No swap is submitted.',
    };
  }
}
