/**
 * 58: COMPARE XCNSTRATEGY CORE POSITIONS
 *
 * Mission: Compare our local aggregated data against Polymarket API positions
 * for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b to validate:
 * - Size alignment (units scaling)
 * - Average price alignment
 * - Trade attribution correctness
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

interface FixtureEntry {
  canonical_wallet: string;
  total_fills: string;
  total_markets: string;
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
  currentValue?: number;
  initialValue?: number;
  timestamp?: number;
  [key: string]: any;
}

interface PositionComparison {
  asset_id: string;
  title?: string;
  local_size_raw: number;
  local_size_api: number;
  api_size: number;
  size_delta: number;
  size_status: 'MATCH' | 'MISMATCH';
  local_avg_price: number;
  api_avg_price: number;
  price_delta: number;
  price_status: 'MATCH' | 'MISMATCH';
  local_time_range: { min: string; max: string };
  trade_count: number;
}

const SCALE = 1_000_000;
const SIZE_TOLERANCE = 1e-2; // 0.01 shares
const PRICE_TOLERANCE = 1e-3; // 0.001 price units

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
 * Calculate aggregated position data from our local trades
 */
function calculateLocalPosition(trades: FixtureTrade[]): {
  total_size: number;
  avg_price: number;
  time_range: { min: string; max: string };
} {
  if (trades.length === 0) {
    return {
      total_size: 0,
      avg_price: 0,
      time_range: { min: '', max: '' }
    };
  }

  // Calculate net size (BUY = +, SELL = -)
  let total_size = 0;
  let total_cost = 0;

  for (const trade of trades) {
    const sign = trade.side === 'BUY' ? 1 : -1;
    total_size += sign * trade.size;
    total_cost += sign * trade.cost;
  }

  // Calculate average price (weighted by size)
  const avg_price = total_size !== 0 ? Math.abs(total_cost / total_size) : 0;

  // Get time range
  const timestamps = trades.map(t => t.timestamp).sort();
  const min_time = timestamps[0];
  const max_time = timestamps[timestamps.length - 1];

  return {
    total_size,
    avg_price,
    time_range: { min: min_time, max: max_time }
  };
}

/**
 * Get local trades for specific asset from fixture
 */
function getLocalTradesForAsset(fixtureData: FixtureEntry[], targetWallet: string, assetId: string): FixtureTrade[] {
  const wallet = fixtureData.find(w =>
    w.canonical_wallet.toLowerCase() === targetWallet.toLowerCase()
  );

  if (!wallet) {
    console.log(`  ⚠️  Wallet ${targetWallet} not found in fixture`);
    return [];
  }

  return wallet.trades.filter(trade => trade.asset_id === assetId);
}

/**
 * Compare local vs API positions for sample markets
 */
async function comparePositions() {
  const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('58: COMPARE XCNSTRATEGY CORE POSITIONS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Mission: Compare local vs API positions for wallet ${targetWallet}`);
  console.log(`Parameters: SCALE=${SCALE.toLocaleString()}, SIZE_TOLERANCE=${SIZE_TOLERANCE}, PRICE_TOLERANCE=${PRICE_TOLERANCE}\n`);

  try {
    // Step 1: Load fixture data
    console.log('📋 STEP 1: Loading fixture data');
    const fixturePath = resolve(process.cwd(), 'fixture_track_b_wallets.json');
    const fixtureData = readFileSync(fixturePath, 'utf-8');
    const wallets: FixtureEntry[] = JSON.parse(fixtureData);

    const targetWalletEntry = wallets.find(w =>
      w.canonical_wallet.toLowerCase() === targetWallet.toLowerCase()
    );

    if (!targetWalletEntry) {
      console.log(`❌ Wallet ${targetWallet} not found in fixture`);
      return;
    }

    console.log(`✓ Found wallet with ${targetWalletEntry.trades.length} trades across ${targetWalletEntry.total_markets} markets`);
    console.log(`  Date range: ${targetWalletEntry.earliest_fill} to ${targetWalletEntry.latest_fill}`);

    // Step 2: Fetch API positions
    console.log('\n📋 STEP 2: Fetching Polymarket API positions');
    const apiPositions = await fetchPolymarketPositions(targetWallet);
    console.log(`✓ API returned ${apiPositions.length} positions`);

    if (apiPositions.length === 0) {
      console.log('⚠️  No positions returned from API');
      return;
    }

    // Step 3: Select sample of active markets
    console.log('\n📋 STEP 3: Selecting sample of active markets');

    // Filter for non-zero size positions and sort by size
    const activePositions = apiPositions
      .filter(pos => (pos.size || 0) > 0)
      .sort((a, b) => (b.size || 0) - (a.size || 0));

    console.log(`✓ Found ${activePositions.length} active positions with non-zero size`);

    // Select top 5 positions for detailed comparison
    const samplePositions = activePositions.slice(0, 5);
    console.log('\nSample positions selected:');

    for (const pos of samplePositions) {
      const title = pos.title || 'Unknown Market';
      const size = pos.size || 0;
      const avgPrice = pos.avgPrice || 0;
      console.log(`  - ${title}: ${size.toFixed(2)} shares @ $${avgPrice.toFixed(3)}`);
    }

    // Step 4: Compare each sample position
    console.log('\n📋 STEP 4: Detailed position comparisons');

    const comparisons: PositionComparison[] = [];

    for (const apiPosition of samplePositions) {
      const assetId = apiPosition.asset || apiPosition.tokenId || '';
      const title = apiPosition.title || 'Unknown Market';
      const apiSize = apiPosition.size || 0;
      const apiAvgPrice = apiPosition.avgPrice || 0;

      console.log(`\n--- Analyzing: ${title} ---`);
      console.log(`Asset ID: ${assetId}`);
      console.log(`API Size: ${apiSize.toFixed(2)} | API Avg Price: $${apiAvgPrice.toFixed(3)}`);

      // Get local trades for this asset
      const localTrades = getLocalTradesForAsset(wallets, targetWallet, assetId);
      console.log(`Local trades found: ${localTrades.length}`);

      if (localTrades.length === 0) {
        console.log('⚠️  No local trades found for this asset');
        continue;
      }

      // Calculate local position data
      const localCalc = calculateLocalPosition(localTrades);
      const localSizeApi = localCalc.total_size / SCALE;
      const localAvgPrice = localCalc.avg_price;

      // Compare sizes
      const sizeDelta = localSizeApi - apiSize;
      const sizeMatch = Math.abs(sizeDelta) < SIZE_TOLERANCE;

      // Compare average prices
      const priceDelta = localAvgPrice - apiAvgPrice;
      const priceMatch = Math.abs(priceDelta) < PRICE_TOLERANCE;

      console.log(`Local Size: ${localSizeApi.toFixed(2)} | Local Avg Price: $${localAvgPrice.toFixed(3)}`);
      console.log(`Size Δ: ${sizeDelta.toFixed(2)} (${sizeMatch ? '✅ MATCH' : '❌ MISMATCH'})`);
      console.log(`Price Δ: ${priceDelta.toFixed(3)} (${priceMatch ? '✅ MATCH' : '❌ MISMATCH'})`);
      console.log(`Time range: ${localCalc.time_range.min} to ${localCalc.time_range.max}`);

      comparisons.push({
        asset_id: assetId,
        title,
        local_size_raw: localCalc.total_size,
        local_size_api: localSizeApi,
        api_size: apiSize,
        size_delta: sizeDelta,
        size_status: sizeMatch ? 'MATCH' : 'MISMATCH',
        local_avg_price: localAvgPrice,
        api_avg_price: apiAvgPrice,
        price_delta: priceDelta,
        price_status: priceMatch ? 'MATCH' : 'MISMATCH',
        local_time_range: localCalc.time_range,
        trade_count: localTrades.length
      });
    }

    // Step 5: Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('COMPARISON SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');

    const totalComparisons = comparisons.length;
    const sizeMatches = comparisons.filter(c => c.size_status === 'MATCH').length;
    const priceMatches = comparisons.filter(c => c.price_status === 'MATCH').length;

    console.log(`\nTotal positions compared: ${totalComparisons}`);
    console.log(`Size matches: ${sizeMatches}/${totalComparisons} (${(sizeMatches/totalComparisons*100).toFixed(1)}%)`);
    console.log(`Price matches: ${priceMatches}/${totalComparisons} (${(priceMatches/totalComparisons*100).toFixed(1)}%)`);

    console.log('\nDetailed comparison table:');
    console.log('| Market | Local Size | API Size | Size Δ | Local Avg | API Avg | Price Δ | Status |');
    console.log('|--------|-----------:|---------:|-------:|----------:|--------:|--------:|--------|');

    for (const comp of comparisons) {
      const marketName = (comp.title || 'Unknown').substring(0, 20).padEnd(20);
      const sizeStatus = comp.size_status === 'MATCH' ? '✓' : '✗';
      const priceStatus = comp.price_status === 'MATCH' ? '✓' : '✗';
      const overallStatus = (comp.size_status === 'MATCH' && comp.price_status === 'MATCH') ? '✓' : '✗';

      console.log(`| ${marketName} | ${comp.local_size_api.toFixed(2).padStart(10)} | ${comp.api_size.toFixed(2).padStart(8)} | ${comp.size_delta.toFixed(2).padStart(6)} | ${comp.local_avg_price.toFixed(3).padStart(9)} | ${comp.api_avg_price.toFixed(3).padStart(7)} | ${comp.price_delta.toFixed(3).padStart(6)} | ${overallStatus.padStart(6)} |`);
    }

    // Final conclusion
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('FINAL ASSESSMENT');
    console.log('═══════════════════════════════════════════════════════════');

    const overallSuccess = sizeMatches === totalComparisons && priceMatches === totalComparisons;

    if (overallSuccess) {
      console.log('✅ SUCCESS: All position comparisons match within tolerance');
      console.log('🎯 CONCLUSION: Wallet identity, size scaling, and price calculations are correct');
      console.log('📋 This strongly supports that our canonical_wallet mapping correctly represents the xcnstrategy trading identity');
    } else {
      console.log('⚠️  PARTIAL SUCCESS: Some discrepancies found');
      console.log(`   - Size discrepancies: ${totalComparisons - sizeMatches}`);
      console.log(`   - Price discrepancies: ${totalComparisons - priceMatches}`);
      console.log('\n📋 RECOMMENDATIONS:');
      console.log('   1. Check if there are missing trades in our data');
      console.log('   2. Verify the asset_id to tokenId mapping is correct');
      console.log('   3. Consider if there are different calculation methods between systems');
    }

  } catch (error) {
    console.error('❌ Error during comparison:', error);
  }
}

comparePositions().catch(console.error);