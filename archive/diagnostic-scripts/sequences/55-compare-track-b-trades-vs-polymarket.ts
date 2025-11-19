/**
 * 55: COMPARE TRACK B TRADES VS POLYMARKET
 *
 * Track B - Step B4
 *
 * Compare our local trades (from fixture) against Polymarket Data API
 * to validate wallet identity and trade attribution.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

interface FixtureWallet {
  canonical_wallet: string;
  total_fills: number;
  total_markets: number;
  earliest_fill: string;
  latest_fill: string;
  trades: FixtureTrade[];
  summary: {
    total_trades: number;
    buy_trades: number;
    sell_trades: number;
    total_volume: number;
    realized_pnl: number;
  };
}

interface FixtureTrade {
  trade_id: string;
  timestamp: string;
  asset_id: string;
  side: string;
  size: number;
  price: number;
  cost: number;
}

interface PolymarketTrade {
  asset?: string;
  tokenId?: string;
  side?: string;
  outcome?: string;
  size?: number;
  price?: number;
  timestamp?: number;
  created_at?: string;
  [key: string]: any;
}

interface ComparisonResult {
  wallet: string;
  local_count: number;
  api_count: number;
  count_delta: number;
  local_window: { first: string; last: string };
  api_window: { first: string; last: string };
  volume_comparison: Map<string, { local: number; api: number; delta: number }>;
  status: 'MATCH' | 'MISMATCH' | 'ERROR';
  error_message?: string;
}

/**
 * Fetch trades from Polymarket Data API
 */
async function fetchPolymarketTrades(wallet: string): Promise<PolymarketTrade[]> {
  const url = `https://data-api.polymarket.com/trades?user=${wallet}&limit=1000`;

  console.log(`  🌐 Fetching from: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Handle different response structures
  if (Array.isArray(data)) {
    return data;
  } else if (data.data && Array.isArray(data.data)) {
    return data.data;
  } else if (data.trades && Array.isArray(data.trades)) {
    return data.trades;
  } else {
    console.log(`  ⚠️  Unexpected response structure:`, JSON.stringify(data).substring(0, 200));
    return [];
  }
}

/**
 * Normalize Polymarket API trade to our format
 */
function normalizePolymarketTrade(trade: PolymarketTrade): {
  asset_id: string;
  side: string;
  size: number;
  timestamp: string;
} | null {
  // Extract asset ID
  const asset_id = trade.asset || trade.tokenId || trade.token_id;
  if (!asset_id) {
    return null;
  }

  // Extract side
  let side = 'UNKNOWN';
  if (trade.side) {
    side = trade.side.toUpperCase();
  } else if (trade.outcome) {
    // Some APIs use outcome field
    side = trade.outcome === 'Yes' || trade.outcome === 'YES' ? 'BUY' : 'SELL';
  }

  // Extract size
  const size = trade.size || trade.amount || 0;

  // Extract timestamp
  let timestamp = '';
  if (trade.timestamp) {
    // Unix timestamp
    timestamp = new Date(trade.timestamp * 1000).toISOString();
  } else if (trade.created_at) {
    timestamp = trade.created_at;
  }

  return { asset_id, side, size, timestamp };
}

/**
 * Calculate volume by asset
 */
function calculateVolumeByAsset(trades: { asset_id: string; size: number }[]): Map<string, number> {
  const volumeByAsset = new Map<string, number>();

  for (const trade of trades) {
    const current = volumeByAsset.get(trade.asset_id) || 0;
    volumeByAsset.set(trade.asset_id, current + trade.size);
  }

  return volumeByAsset;
}

/**
 * Compare trades for a single wallet
 */
async function compareWalletTrades(wallet: FixtureWallet): Promise<ComparisonResult> {
  console.log(`\n📊 Comparing wallet: ${wallet.canonical_wallet.substring(0, 12)}...`);

  try {
    // Fetch Polymarket trades
    const apiTrades = await fetchPolymarketTrades(wallet.canonical_wallet);

    console.log(`  ✓ API returned ${apiTrades.length} trades`);

    // Normalize API trades
    const normalizedApiTrades = apiTrades
      .map(normalizePolymarketTrade)
      .filter((t): t is NonNullable<typeof t> => t !== null);

    console.log(`  ✓ Normalized ${normalizedApiTrades.length} API trades`);

    // Calculate local metrics
    const localCount = wallet.trades.length;
    const localVolumeByAsset = calculateVolumeByAsset(
      wallet.trades.map(t => ({ asset_id: t.asset_id, size: t.size }))
    );
    const localFirstTs = wallet.earliest_fill;
    const localLastTs = wallet.latest_fill;

    // Calculate API metrics
    const apiCount = normalizedApiTrades.length;
    const apiVolumeByAsset = calculateVolumeByAsset(normalizedApiTrades);

    const apiTimestamps = normalizedApiTrades
      .map(t => t.timestamp)
      .filter(t => t)
      .sort();
    const apiFirstTs = apiTimestamps[0] || '';
    const apiLastTs = apiTimestamps[apiTimestamps.length - 1] || '';

    // Compare volumes by asset
    const allAssets = new Set([
      ...Array.from(localVolumeByAsset.keys()),
      ...Array.from(apiVolumeByAsset.keys())
    ]);

    const volumeComparison = new Map<string, { local: number; api: number; delta: number }>();

    for (const assetId of allAssets) {
      const localVol = localVolumeByAsset.get(assetId) || 0;
      const apiVol = apiVolumeByAsset.get(assetId) || 0;
      const delta = apiVol - localVol;

      volumeComparison.set(assetId, {
        local: localVol,
        api: apiVol,
        delta
      });
    }

    // Determine status
    const countDelta = apiCount - localCount;
    const countMatchPercent = localCount > 0 ? Math.abs(countDelta / localCount) : 0;

    let hasVolumeMismatch = false;
    for (const [_, comparison] of volumeComparison) {
      if (Math.abs(comparison.delta) > 1e-6) {
        hasVolumeMismatch = true;
        break;
      }
    }

    const status = (countMatchPercent < 0.05 && !hasVolumeMismatch) ? 'MATCH' : 'MISMATCH';

    return {
      wallet: wallet.canonical_wallet,
      local_count: localCount,
      api_count: apiCount,
      count_delta: countDelta,
      local_window: { first: localFirstTs, last: localLastTs },
      api_window: { first: apiFirstTs, last: apiLastTs },
      volume_comparison: volumeComparison,
      status
    };

  } catch (error) {
    console.log(`  ❌ Error: ${error}`);

    return {
      wallet: wallet.canonical_wallet,
      local_count: wallet.trades.length,
      api_count: 0,
      count_delta: 0,
      local_window: { first: wallet.earliest_fill, last: wallet.latest_fill },
      api_window: { first: '', last: '' },
      volume_comparison: new Map(),
      status: 'ERROR',
      error_message: String(error)
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('55: COMPARE TRACK B TRADES VS POLYMARKET');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Validate trade attribution against Polymarket Data API\n');

  // Load fixture
  const fixturePath = resolve(process.cwd(), 'fixture_track_b_wallets.json');
  const fixtureData = readFileSync(fixturePath, 'utf-8');
  const wallets: FixtureWallet[] = JSON.parse(fixtureData);

  console.log(`Loaded ${wallets.length} wallets from fixture\n`);

  const results: ComparisonResult[] = [];

  for (const wallet of wallets) {
    const result = await compareWalletTrades(wallet);
    results.push(result);

    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 750));
  }

  // Print detailed results
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('DETAILED COMPARISON RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const result of results) {
    console.log(`\nWallet: ${result.wallet.substring(0, 12)}...`);
    console.log(`Status: ${result.status}`);

    if (result.error_message) {
      console.log(`Error: ${result.error_message}`);
      continue;
    }

    console.log(`\nTrade Counts:`);
    console.log(`  Local trades:  ${result.local_count}`);
    console.log(`  API trades:    ${result.api_count}`);
    console.log(`  Delta:         ${result.count_delta} (${result.count_delta > 0 ? '+' : ''}${((result.count_delta / result.local_count) * 100).toFixed(2)}%)`);

    console.log(`\nTime Windows:`);
    console.log(`  Local: ${result.local_window.first.substring(0, 19)} -> ${result.local_window.last.substring(0, 19)}`);
    console.log(`  API:   ${result.api_window.first.substring(0, 19)} -> ${result.api_window.last.substring(0, 19)}`);

    console.log(`\nVolume by Asset (top 10 by absolute delta):`);
    console.log(`| Asset ID (prefix) | Local Volume | API Volume | Delta |`);
    console.log(`|-------------------|-------------:|-----------:|------:|`);

    const sortedAssets = Array.from(result.volume_comparison.entries())
      .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
      .slice(0, 10);

    for (const [assetId, comparison] of sortedAssets) {
      const prefix = assetId.substring(0, 12) + '...';
      const local = comparison.local.toFixed(2);
      const api = comparison.api.toFixed(2);
      const delta = comparison.delta.toFixed(2);

      console.log(`| ${prefix} | ${local} | ${api} | ${delta} |`);
    }
  }

  // Print summary
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const matchCount = results.filter(r => r.status === 'MATCH').length;
  const mismatchCount = results.filter(r => r.status === 'MISMATCH').length;
  const errorCount = results.filter(r => r.status === 'ERROR').length;

  console.log(`Total wallets: ${results.length}`);
  console.log(`MATCH: ${matchCount}`);
  console.log(`MISMATCH: ${mismatchCount}`);
  console.log(`ERROR: ${errorCount}`);
  console.log('');

  console.log('Per-wallet status:');
  for (const result of results) {
    const wallet = result.wallet.substring(0, 12) + '...';
    const status = result.status;
    const countMatch = result.count_delta === 0 ? '✓' : `Δ${result.count_delta}`;

    console.log(`  ${wallet}: ${status} (count: ${countMatch})`);
  }

  console.log('\n');

  if (matchCount === results.length - errorCount) {
    console.log('✅ PASS: All wallets match (excluding errors)');
  } else if (mismatchCount > 0) {
    console.log('⚠️  WARNING: Some wallets have mismatches');
  }

  if (errorCount > 0) {
    console.log(`❌ ${errorCount} wallet(s) had API errors`);
  }

  console.log('\n✅ Track B Step B4 complete\n');
  console.log('Next: Run script 56 to compare P&L vs Polymarket Data API\n');
}

main().catch(console.error);
