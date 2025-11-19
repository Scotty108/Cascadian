/**
 * 56: COMPARE TRACK B PNL VS POLYMARKET
 *
 * Track B - Step B5
 *
 * Compare our realized P&L for real wallets against Polymarket Data API
 * positions endpoint to validate our calculations match theirs.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

interface FixtureWallet {
  canonical_wallet: string;
  trades: FixtureTrade[];
  summary: {
    realized_pnl: number;
  };
}

interface FixtureTrade {
  timestamp: string;
  asset_id: string;
  side: string;
  size: number;
  price: number;
}

interface PolymarketPosition {
  asset?: string;
  tokenId?: string;
  size?: number;
  avgPrice?: number;
  realizedPnl?: number;
  cashPnl?: number;
  outcomeIndex?: number;
  title?: string;
  slug?: string;
  conditionId?: string;
  [key: string]: any;
}

interface AssetComparison {
  asset_prefix: string;
  our_size_raw: number;
  our_size_api: number;
  api_size: number;
  size_delta: number;
  our_realized_raw: number;
  our_realized_api: number;
  api_realized: number;
  realized_delta: number;
  our_avg_price: number;
  api_avg_price: number;
  avg_price_delta: number;
  status: 'MATCH' | 'MISMATCH_SIZE' | 'MISMATCH_REALIZED' | 'MISMATCH_ALL';
}

interface WalletResult {
  wallet: string;
  assets_compared: number;
  matches_size: number;
  matches_realized: number;
  total_our_realized: number;
  total_api_realized: number;
  total_delta: number;
  comparisons: AssetComparison[];
}

const SCALE = 1_000_000;
const EPS_SIZE = 1e-3;
const EPS_REALIZED = 1e-3;
const EPS_AVG_PRICE = 1e-4;

/**
 * Calculate realized P&L using FIFO cost basis for specific asset
 */
function calculateAssetPnL(trades: FixtureTrade[]): { netSize: number; realizedPnL: number; avgCost: number } {
  if (trades.length === 0) {
    return { netSize: 0, realizedPnL: 0, avgCost: 0 };
  }

  const positions: { netSize: number; costBasis: number } = { netSize: 0, costBasis: 0 };
  let totalRealizedPnL = 0;

  for (const trade of trades) {
    const size = trade.size;
    const price = trade.price;

    if (trade.side === 'BUY') {
      positions.netSize += size;
      positions.costBasis += size * price;
    } else {
      // SELL - calculate realized P&L using FIFO
      if (positions.netSize > 0) {
        const avgCost = positions.costBasis / positions.netSize;
        const saleRevenue = size * price;
        const saleCost = size * avgCost;
        const realizedPnL = saleRevenue - saleCost;

        totalRealizedPnL += realizedPnL;
      }

      positions.netSize -= size;
      positions.costBasis = Math.max(0, positions.netSize * (positions.netSize > 0 ? positions.costBasis / positions.netSize : 0));
    }
  }

  const avgCost = positions.netSize > 0 ? positions.costBasis / positions.netSize : 0;

  return {
    netSize: positions.netSize,
    realizedPnL: totalRealizedPnL,
    avgCost: avgCost
  };
}

/**
 * Fetch positions from Polymarket Data API
 */
async function fetchPolymarketPositions(wallet: string): Promise<PolymarketPosition[]> {
  const url = `https://data-api.polymarket.com/positions?user=${wallet}&limit=1000`;

  console.log(`  🌐 Fetching positions from: ${url}`);

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
  } else if (data.positions && Array.isArray(data.positions)) {
    return data.positions;
  } else {
    console.log(`  ⚠️  Unexpected response structure:`, JSON.stringify(data).substring(0, 200));
    return [];
  }
}

/**
 * Compare P&L for a single wallet against Polymarket API
 */
async function compareWalletPnL(walletData: FixtureWallet): Promise<WalletResult> {
  const wallet = walletData.canonical_wallet;
  console.log(`\n📊 Comparing P&L for wallet: ${wallet.substring(0, 12)}...`);

  try {
    // Step 1: Get our current P&L from fixture for comparison baseline
    const ourTotalRealized = walletData.summary.realized_pnl;
    console.log(`  ✓ Fixture realized P&L: $${ourTotalRealized.toFixed(4)}`);

    // Step 2: Fetch positions from Polymarket API
    const apiPositions = await fetchPolymarketPositions(wallet);
    console.log(`  ✓ API returned ${apiPositions.length} positions`);

    if (apiPositions.length === 0) {
      console.log(`  ⚠️  No positions returned from API`);
      return {
        wallet,
        assets_compared: 0,
        matches_size: 0,
        matches_realized: 0,
        total_our_realized: 0,
        total_api_realized: 0,
        total_delta: 0,
        comparisons: []
      };
    }

    // Step 3: Group our trades by asset_id
    const ourTradesByAsset = new Map<string, FixtureTrade[]>();
    for (const trade of walletData.trades) {
      if (!ourTradesByAsset.has(trade.asset_id)) {
        ourTradesByAsset.set(trade.asset_id, []);
      }
      ourTradesByAsset.get(trade.asset_id)!.push(trade);
    }

    // Step 4: Compare each API position with our calculations
    const comparisons: AssetComparison[] = [];
    let totalOurRealized = 0;
    let totalApiRealized = 0;
    let matchesSize = 0;
    let matchesRealized = 0;

    for (const position of apiPositions) {
      const assetId = position.asset || position.tokenId || position.token_id;
      const apiSize = position.size || 0;
      const apiRealized = position.realizedPnl || 0;
      const apiAvgPrice = position.avgPrice || 0;

      if (!assetId) {
        console.log(`  ⚠️  Position missing asset ID, skipping`);
        continue;
      }

      // Get our trades for this asset
      const ourTrades = ourTradesByAsset.get(assetId) || [];

      // Calculate our P&L using same FIFO logic
      const ourCalc = calculateAssetPnL(ourTrades);

      // Convert to API units (divide by SCALE)
      const ourSizeRaw = ourCalc.netSize;
      const ourSizeApi = ourSizeRaw / SCALE;
      const ourRealizedRaw = ourCalc.realizedPnL;
      const ourRealizedApi = ourRealizedRaw / SCALE;
      const ourAvgPrice = ourCalc.avgCost; // This is already in price terms

      // Compare with tolerances
      const sizeDelta = ourSizeApi - apiSize;
      const realizedDelta = ourRealizedApi - apiRealized;
      const avgPriceDelta = ourAvgPrice - apiAvgPrice;

      const sizeMatch = Math.abs(sizeDelta) < EPS_SIZE;
      const realizedMatch = Math.abs(realizedDelta) < EPS_REALIZED;
      const avgPriceMatch = Math.abs(avgPriceDelta) < EPS_AVG_PRICE;

      // Determine status
      let status: AssetComparison['status'];
      if (sizeMatch && realizedMatch) {
        status = 'MATCH';
        matchesSize++;
        matchesRealized++;
      } else if (!sizeMatch && !realizedMatch) {
        status = 'MISMATCH_ALL';
      } else if (!sizeMatch) {
        status = 'MISMATCH_SIZE';
      } else {
        status = 'MISMATCH_REALIZED';
      }

      totalOurRealized += ourRealizedApi;
      totalApiRealized += apiRealized;

      comparisons.push({
        asset_prefix: assetId.substring(0, 12) + '...',
        our_size_raw: ourSizeRaw,
        our_size_api: ourSizeApi,
        api_size: apiSize,
        size_delta: sizeDelta,
        our_realized_raw: ourRealizedRaw,
        our_realized_api: ourRealizedApi,
        api_realized: apiRealized,
        realized_delta: realizedDelta,
        our_avg_price: ourAvgPrice,
        api_avg_price: apiAvgPrice,
        avg_price_delta: avgPriceDelta,
        status
      });
    }

    // Step 5: Calculate totals
    const totalDelta = totalOurRealized - totalApiRealized;

    console.log(`\n  🎯 Comparison Results:`);
    console.log(`    Assets compared: ${comparisons.length}`);
    console.log(`    Size matches: ${matchesSize}/${comparisons.length}`);
    console.log(`    Realized P&L matches: ${matchesRealized}/${comparisons.length}`);
    console.log(`    Total our realized: $${totalOurRealized.toFixed(4)}`);
    console.log(`    Total API realized: $${totalApiRealized.toFixed(4)}`);
    console.log(`    Total delta: $${totalDelta.toFixed(4)}`);

    return {
      wallet,
      assets_compared: comparisons.length,
      matches_size: matchesSize,
      matches_realized: matchesRealized,
      total_our_realized: totalOurRealized,
      total_api_realized: totalApiRealized,
      total_delta: totalDelta,
      comparisons
    };

  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
    return {
      wallet,
      assets_compared: 0,
      matches_size: 0,
      matches_realized: 0,
      total_our_realized: 0,
      total_api_realized: 0,
      total_delta: 0,
      comparisons: []
    };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('56: COMPARE TRACK B PNL VS POLYMARKET');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Validate realized P&L against Polymarket Data API positions endpoint\n');
  console.log('Parameters:');
  console.log(`  SCALE = ${SCALE.toLocaleString()}`);
  console.log(`  EPS_SIZE = ${EPS_SIZE}`);
  console.log(`  EPS_REALIZED = ${EPS_REALIZED}`);
  console.log(`  EPS_AVG_PRICE = ${EPS_AVG_PRICE}\n`);

  // Load fixture
  const fixturePath = resolve(process.cwd(), 'fixture_track_b_wallets.json');
  const fixtureData = readFileSync(fixturePath, 'utf-8');
  const wallets: FixtureWallet[] = JSON.parse(fixtureData);

  console.log(`Loaded ${wallets.length} wallets from fixture\n`);

  const results: WalletResult[] = [];

  for (const wallet of wallets) {
    const result = await compareWalletPnL(wallet);
    results.push(result);

    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Print detailed results by wallet
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('DETAILED WALLET RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const result of results) {
    console.log(`\nWallet: ${result.wallet}`);
    console.log(`Assets compared: ${result.assets_compared}`);
    console.log(`Size matches: ${result.matches_size}/${result.assets_compared} (${(result.matches_size/result.assets_compared*100).toFixed(1)}%)`);
    console.log(`Realized P&L matches: ${result.matches_realized}/${result.assets_compared} (${(result.matches_realized/result.assets_compared*100).toFixed(1)}%)`);

    console.log(`\nSummary:`);
    console.log(`  Our realized total: $${result.total_our_realized.toFixed(4)}`);
    console.log(`  API realized total: $${result.total_api_realized.toFixed(4)}`);
    console.log(`  Delta: $${result.total_delta.toFixed(4)}`);

    if (result.comparisons.length > 0) {
      console.log(`\n| Asset ID (prefix) | Our Size | API Size | Size Δ | Our Realized | API Realized | Realized Δ | Status |`);
      console.log(`|-------------------|---------:|---------:|-------:|-------------:|-------------:|-----------:|--------|`);

      // Show top 10 by absolute realized delta
      const sortedComparisons = result.comparisons
        .sort((a, b) => Math.abs(b.realized_delta) - Math.abs(a.realized_delta))
        .slice(0, 10);

      for (const comp of sortedComparisons) {
        console.log(`| ${comp.asset_prefix.padEnd(17)} | ${comp.our_size_api.toFixed(2).padStart(8)} | ${comp.api_size.toFixed(2).padStart(8)} | ${comp.size_delta.toFixed(2).padStart(5)} | ${comp.our_realized_api.toFixed(2).padStart(12)} | ${comp.api_realized.toFixed(2).padStart(12)} | ${comp.realized_delta.toFixed(2).padStart(9)} | ${comp.status.padEnd(6)} |`);
      }
    }
  }

  // Global summary
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('GLOBAL VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const totalWallets = results.length;
  const totalAssets = results.reduce((sum, r) => sum + r.assets_compared, 0);
  const totalMatchesSize = results.reduce((sum, r) => sum + r.matches_size, 0);
  const totalMatchesRealized = results.reduce((sum, r) => sum + r.matches_realized, 0);
  const grandTotalOur = results.reduce((sum, r) => sum + r.total_our_realized, 0);
  const grandTotalApi = results.reduce((sum, r) => sum + r.total_api_realized, 0);
  const grandDelta = results.reduce((sum, r) => sum + r.total_delta, 0);

  console.log(`Total wallets processed: ${totalWallets}`);
  console.log(`Total assets compared: ${totalAssets}`);
  console.log(`Total size matches: ${totalMatchesSize}/${totalAssets} (${(totalMatchesSize/totalAssets*100).toFixed(1)}%)`);
  console.log(`Total realized P&L matches: ${totalMatchesRealized}/${totalAssets} (${(totalMatchesRealized/totalAssets*100).toFixed(1)}%)`);
  console.log(`\nGrand totals:`);
  console.log(`  Our realized P&L: $${grandTotalOur.toFixed(4)}`);
  console.log(`  API realized P&L: $${grandTotalApi.toFixed(4)}`);
  console.log(`  Grand delta: $${grandDelta.toFixed(4)}`);
  console.log(`  Delta percent: ${(Math.abs(grandDelta)/(Math.abs(grandTotalApi)||1)*100).toFixed(2)}%`);

  // Per-wallet summary
  console.log(`\nPer-wallet summary:`);
  console.log(`| Wallet (prefix) | Assets | Size Match % | Realized Match % | Total Δ |`);
  console.log(`|-----------------|--------:|-------------:|-----------------:|--------:|`);

  for (const result of results) {
    const wallet = result.wallet.substring(0, 12) + '...';
    const assets = result.assets_compared;
    const sizePct = assets > 0 ? (result.matches_size/assets*100).toFixed(1) : 'N/A';
    const realizedPct = assets > 0 ? (result.matches_realized/assets*100).toFixed(1) : 'N/A';
    const delta = result.total_delta.toFixed(2);

    console.log(`| ${wallet.padEnd(15)} | ${assets.toString().padStart(7)} | ${sizePct.padStart(12)} | ${realizedPct.padStart(16)} | ${delta.padStart(7)} |`);
  }

  // Validation result
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('VALIDATION RESULT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const successThreshold = 0.8; // 80% match rate
  const sizeMatchRate = totalMatchesSize / totalAssets;
  const realizedMatchRate = totalMatchesRealized / totalAssets;
  const deltaPercent = Math.abs(grandDelta) / (Math.abs(grandTotalApi) || 1);

  if (sizeMatchRate >= successThreshold && realizedMatchRate >= successThreshold && deltaPercent < 0.01) {
    console.log('✅ PASS: Track B P&L validation successful!');
    console.log(`   - Size match rate: ${(sizeMatchRate*100).toFixed(1)}% (≥80%)`);
    console.log(`   - Realized P&L match rate: ${(realizedMatchRate*100).toFixed(1)}% (≥80%)`);
    console.log(`   - Total delta: ${(deltaPercent*100).toFixed(2)}% (<1%)`);
    console.log('\n✅ Our realized P&L calculations align with Polymarket!');
  } else {
    console.log('⚠️  PARTIAL MATCH: Some discrepancies found');
    console.log(`   - Size match rate: ${(sizeMatchRate*100).toFixed(1)}% (target: ≥80%)`);
    console.log(`   - Realized P&L match rate: ${(realizedMatchRate*100).toFixed(1)}% (target: ≥80%)`);
    console.log(`   - Total delta: ${(deltaPercent*100).toFixed(2)}% (target: <1%)`);
    console.log('\n📋 Recommended next steps:');
    console.log('   1. Investigate largest realized P&L deltas');
    console.log('   2. Check for missing data or different calculation methods');
    console.log('   3. Verify resolution data alignment');
  }

  console.log('\n✅ Track B Step B5 complete\n');
}

main().catch(console.error);