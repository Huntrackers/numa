import { z } from 'zod';
import { Store } from '../../../packages/db/src/index.js';
import { ensure, hash, mulBps } from '../../../packages/domain/src/index.js';
import { assets as fixtures } from './seed.js';
export const TOKEN_SOURCE = 'https://1click.chaindefuser.com/v0/tokens';
export const FIXTURE_AS_OF = '2026-11-04T00:00:00.000Z';
const SCALE = 100000000000000n;
export function priceNano(text: string) {
  ensure(/^\d+(\.\d+)?$/.test(text), 'INVALID_PRICE', 'Invalid provider price.');
  const [whole, part = ''] = text.split('.');
  return (BigInt(whole) * 100000000n + BigInt((part + '00000000').slice(0, 8))).toString();
}
export function quantityFor(cents: string, asset: any) {
  return ((BigInt(cents) * SCALE) / BigInt(asset.priceNanoUsd)).toString();
}
export function valueFor(quantity: string, asset: any) {
  return ((BigInt(quantity) * BigInt(asset.priceNanoUsd)) / SCALE).toString();
}
export class ScenarioCatalog {
  constructor(public s: Store) {}
  list() {
    const settings = this.s.get('settings');
    const disabled = new Set(settings?.disabledAssets || []);
    return [
      ...fixtures.map((a: any) => ({
        ...a,
        symbol: a.id,
        assetId: 'fixture:' + a.network.toLowerCase().replaceAll(' ', '-') + ':' + a.id,
        provider: 'numa-scenario',
        decimals: a.id === 'NEAR' ? 24 : 8,
        quantityDecimals: 8,
        priceNanoUsd: (BigInt(a.price) * 1000000n).toString(),
        source: 'Versioned educational fixture v1',
        asOf: FIXTURE_AS_OF,
        receivedAt: FIXTURE_AS_OF,
        priceMode: 'FIXTURE',
        mode: 'SIMULATION',
      })),
      ...this.s
        .list('catalog-asset')
        .map((a) => ({ ...a, priceMode: 'PUBLIC_REFERENCE', mode: 'SIMULATION' })),
    ].map((a: any) => ({
      ...a,
      enabled:
        !disabled.has(a.assetId) &&
        (a.priceMode === 'FIXTURE' || settings?.publicCatalogEnabled !== false),
      stale:
        a.priceMode !== 'FIXTURE' &&
        Date.now() - Date.parse(a.asOf) > (settings?.priceTtlSeconds || 30) * 1000,
    }));
  }
  resolve(id: string) {
    const a = this.list().find((a) => a.id === id || a.assetId === id);
    ensure(a, 'UNSUPPORTED_ASSET', 'Choose an asset from the catalog.');
    return a;
  }
  route(owner: string, asset: any, input: any) {
    const network = input.network || asset.network;
    ensure(
      network === asset.network,
      'UNSUPPORTED_ROUTE',
      'The selected asset is not available on that destination network.',
    );
    if (input.destinationId) {
      const d = this.s.get(input.destinationId);
      ensure(
        d?.type === 'destination' && d.owner === owner && d.state !== 'ARCHIVED',
        'DESTINATION_NOT_FOUND',
        'Choose an active destination in your workspace.',
      );
      ensure(
        d.network === network,
        'DESTINATION_NETWORK_MISMATCH',
        'Destination and asset networks differ.',
      );
    }
    return {
      network,
      destinationId: input.destinationId || null,
      destinationOwnership: input.destinationId ? 'ADDRESS_ONLY' : 'INTERNAL_SIMULATION',
      source: 'PREFUNDED_SIMULATION',
    };
  }
  basis(owner: string, asset: any, input: any) {
    return hash({
      assetId: asset.assetId,
      priceNanoUsd: asset.priceNanoUsd,
      asOf: asset.asOf,
      settingsVersion: this.s.get('settings')?.version,
      network: input.network || asset.network,
      destination: input.destinationId ? this.s.get(input.destinationId) : null,
      owner,
    });
  }
  validateQuote(owner: string, quote: any) {
    const asset = this.resolve(quote.assetId || quote.asset);
    ensure(
      quote.quoteBasis === this.basis(owner, asset, quote),
      'PREVIEW_STALE',
      'The price, provider settings or destination changed. Review a fresh quote.',
      409,
    );
    ensure(
      quote.expiresAt > new Date().toISOString(),
      'STALE_QUOTE',
      'The quote expired. Create another preview.',
      409,
    );
    this.quote(owner, asset, quote);
    return asset;
  }
  quote(owner: string, asset: any, input: any) {
    const scenario = this.s.get('settings')?.quoteScenario || 'NORMAL';
    ensure(asset.enabled, 'ASSET_DISABLED', 'This asset is disabled by the operator.');
    ensure(
      scenario !== 'NO_ROUTE',
      'UNSUPPORTED_ROUTE',
      'The selected scenario has no available route.',
    );
    ensure(
      !asset.stale && scenario !== 'STALE',
      'STALE_QUOTE',
      'The reference price is stale. Refresh the public catalog or select a versioned fixture.',
    );
    ensure(scenario !== 'EXPIRED', 'STALE_QUOTE', 'The quote expired before confirmation.');
    const feeBps = 25;
    ensure(
      (input.maxFeeBps ?? 25) >= feeBps,
      'FEE_LIMIT',
      'The scenario fee exceeds your approved limit.',
    );
    const quantity = quantityFor(input.amount, asset);
    const outputDecimals = input.side === 'sell' ? 2 : 8;
    const quotedOutput =
      input.side === 'sell'
        ? (BigInt(input.amount) - BigInt(mulBps(input.amount, feeBps))).toString()
        : quantity;
    const minOutput = (
      (BigInt(quotedOutput) * BigInt(10000 - (input.slippageBps ?? 50))) /
      10000n
    ).toString();
    ensure(
      BigInt(quantity) > 0n && BigInt(minOutput) > 0n,
      'AMOUNT_TOO_SMALL',
      'The order is below the supported quantity precision.',
    );
    const output = scenario === 'SLIPPAGE' ? '0' : quotedOutput;
    ensure(
      BigInt(output) >= BigInt(minOutput),
      'MIN_OUTPUT',
      'The simulated output is below your approved minimum.',
    );
    return {
      quoteBasis: this.basis(owner, asset, input),
      maxFeeBps: input.maxFeeBps ?? 25,
      ...this.route(owner, asset, input),
      asset: asset.id,
      assetId: asset.assetId,
      provider: asset.provider,
      decimals: asset.decimals,
      quantityDecimals: 8,
      quantity,
      minimumOutput: minOutput,
      outputDecimals,
      outputAsset: input.side === 'sell' ? 'demoUSD' : asset.symbol,
      slippageBps: input.slippageBps ?? 50,
      fee: mulBps(input.amount, feeBps),
      feeBps,
      price: asset.price,
      priceNanoUsd: asset.priceNanoUsd,
      priceAsOf: asset.asOf,
      priceSource: asset.source,
      priceMode: asset.priceMode,
      expiresAt: new Date(
        Date.now() + (this.s.get('settings')?.quoteTtlSeconds || 30) * 1000,
      ).toISOString(),
      executionMode: 'SIMULATED',
      quoteId: hash([asset.assetId, input, Date.now()]),
    };
  }
  async refresh(fetcher: typeof fetch = fetch) {
    ensure(
      this.s.get('settings')?.publicCatalogEnabled !== false,
      'PROVIDER_DISABLED',
      'The public catalog is disabled.',
    );
    const response = await fetcher(TOKEN_SOURCE, { signal: AbortSignal.timeout(12000) });
    ensure(response.ok, 'CATALOG_UNAVAILABLE', 'The public token catalog is unavailable.', 503);
    const rows = z
      .array(
        z.object({
          assetId: z.string().min(1).max(500),
          decimals: z.number().int().min(0).max(36),
          blockchain: z.string().max(50),
          symbol: z.string().max(40),
          price: z.union([z.string(), z.number()]).optional(),
          priceUpdatedAt: z.string().optional(),
          contractAddress: z.string().max(500).optional(),
        }),
      )
      .max(20000)
      .parse(await response.json());
    const names: Record<string, string> = {
      near: 'NEAR',
      eth: 'Ethereum',
      ethereum: 'Ethereum',
      base: 'Base',
      sol: 'Solana',
      solana: 'Solana',
      btc: 'Bitcoin',
      bitcoin: 'Bitcoin',
      tron: 'Tron',
    };
    const at = new Date().toISOString();
    let count = 0;
    this.s.atomic(() => {
      for (const row of rows) {
        const network = names[row.blockchain.toLowerCase()];
        if (
          !network ||
          !row.price ||
          !row.priceUpdatedAt ||
          !Number.isFinite(Date.parse(row.priceUpdatedAt))
        )
          continue;
        let nano;
        try {
          nano = priceNano(String(row.price));
        } catch {
          continue;
        }
        if (BigInt(nano) === 0n) continue;
        this.s.save({
          id: 'public-' + hash(row.assetId).slice(0, 32),
          type: 'catalog-asset',
          tenant: '',
          owner: '',
          assetId: row.assetId,
          provider: 'near-intents-1click',
          symbol: row.symbol,
          name: row.symbol + ' on ' + network,
          network,
          decimals: row.decimals,
          quantityDecimals: 8,
          priceNanoUsd: nano,
          price: (BigInt(nano) / 1000000n).toString(),
          asOf: row.priceUpdatedAt,
          receivedAt: at,
          source: TOKEN_SOURCE,
          contractAddress: row.contractAddress || null,
          color: '#496c8c',
          category: 'Crypto',
        });
        count++;
      }
      this.s.save({
        id: 'catalog-status',
        type: 'system',
        source: TOKEN_SOURCE,
        lastSuccessAt: at,
        count,
      });
    });
    return { count, source: TOKEN_SOURCE, execution: 'SIMULATION_ONLY' };
  }
}
