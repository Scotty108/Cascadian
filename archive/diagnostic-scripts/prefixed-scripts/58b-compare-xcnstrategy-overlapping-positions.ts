/**
 * 58b: COMPARE XCNSTRATEGY OVERLAPPING POSITIONS
 *
 * Compare just the assets we found that overlap between our data and API
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

interface FixtureEntry {
  canonical_wallet: string;
  total_fills: string;
  total_markets: string;
  earliest_fill: string;
  latest_fill: string;
  trades: Array<{
    trade_id: string;
    timestamp: string;
    asset_id: string;
    side: string;
    size: number;
    price: number;
    cost: number;
  }>;
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

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

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
function calculateLocalPosition(trades: Array<{asset_id: string; side: string; size: number; price: number; cost: number}>): {
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
 * Compare just the overlapping positions
 */
async function compareOverlappingPositions() {
  const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('58b: COMPARE XCNSTRATEGY OVERLAPPING POSITIONS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Mission: Compare only overlapping positions for wallet ${targetWallet}`);
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

    // Step 2: Get unique local asset IDs
    const localAssets = new Set(targetWalletEntry.trades.map(t => t.asset_id));
    console.log(`✓ Local unique assets: ${localAssets.size}`);

    // Step 3: Build local position data keyed by asset
    const localPositionsByAsset = new Map<string, Array<{asset_id: string; side: string; size: number; price: number; cost: number}>>();

    for (const trade of targetWalletEntry.trades) {
      if (!localPositionsByAsset.has(trade.asset_id)) {
        localPositionsByAsset.set(trade.asset_id, []);
      }
      localPositionsByAsset.get(trade.asset_id)!.push(trade);
    }

    // Step 4: Fetch API positions and find overlaps
    console.log('\n📋 STEP 2: Fetching API positions and finding overlaps');
    const apiPositions = await fetchPolymarketPositions(targetWallet);
    console.log(`✓ API returned ${apiPositions.length} positions`);

    const overlappingPositions: Array<{
      apiPos: PolymarketPosition;
      localTrades: Array<{asset_id: string; side: string; size: number; price: number; cost: number}>;
      assetId: string;
    }> = [];

    for (const apiPos of apiPositions) {
      const apiAssetId = apiPos.asset || apiPos.tokenId || '';
      const localTrades = localPositionsByAsset.get(apiAssetId) || [];

      if (localTrades.length > 0) {
        overlappingPositions.push({ apiPos, localTrades, assetId: apiAssetId });
      }
    }

    console.log(`✓ Found ${overlappingPositions.length} overlapping positions`);

    if (overlappingPositions.length === 0) {
      console.log('⚠️  No overlapping positions found');
      return;
    }

    // Step 5: Compare each overlapping position (first 10)
    const comparisonsToAnalyze = Math.min(overlappingPositions.length, 10);
    const results: Array<PositionComparison & { title?: string; slug?: string }> = [];

    console.log(`\n📋 STEP 3: Comparing ${comparisonsToAnalyze} overlapping positions`);

    for (let i = 0; i < comparisonsToAnalyze; i++) {
      const { apiPos, localTrades, assetId } = overlappingPositions[i];

      const title = apiPos.title || 'Unknown Market';
      const apiSize = apiPos.size || 0;
      const apiAvgPrice = apiPos.avgPrice || 0;

      console.log(`\n--- ${title} ---`);
      console.log(`Asset ID: ${assetId}`);
      console.log(`Local trades: ${localTrades.length} | API Size: ${apiSize.toFixed(2)} | API Avg Price: $${apiAvgPrice.toFixed(3)}`);

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

      results.push({
        asset_id: assetId,
        title,
        slug: apiPos.slug,
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

    // Step 6: Analysis summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('OVERLAPPING POSITIONS ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════');

    const totalCompared = results.length;
    const sizeMatches = results.filter(r => r.size_status === 'MATCH').length;
    const priceMatches = results.filter(r => r.price_status === 'MATCH').length;

    console.log(`\nTotal overlapping positions analyzed: ${totalCompared}`);
    console.log(`Size matches: ${sizeMatches}/${totalCompared} (${(sizeMatches/totalCompared*100).toFixed(1)}%)`);
    console.log(`Price matches: ${priceMatches}/${totalCompared} (${(priceMatches/totalCompared*100).toFixed(1)}%)`);

    // Create a detailed table
    console.log('\nDetailed comparison results:');
    console.log('| Market | Local Size | API Size | Size Δ | Local Avg | API Avg | Price Δ | Size | Price |');
    console.log('|--------|-----------:|---------:|-------:|----------:|--------:|--------:|------:|-------|');

    for (const comp of results) {
      const marketName = (comp.title || 'Unknown').substring(0, 25).padEnd(25);
      const sizeSymbol = comp.size_status === 'MATCH' ? '✓' : '✗';
      const priceSymbol = comp.price_status === 'MATCH' ? '✓' : '✗';

      console.log(`| ${marketName} | ${comp.local_size_api.toFixed(2).padStart(10)} | ${comp.api_size.toFixed(2).padStart(8)} | ${comp.size_delta.toFixed(2).padStart(6)} | ${comp.local_avg_price.toFixed(3).padStart(9)} | ${comp.api_avg_price.toFixed(3).padStart(7)} | ${comp.price_delta.toFixed(3).padStart(6)} | ${sizeSymbol.padStart(4)} | ${priceSymbol.padStart(5)} |`);
    }

    // Overall success assessment
    const bothMatch = results.filter(r => r.size_status === 'MATCH' && r.price_status === 'MATCH').length;
    const successRate = bothMatch / totalCompared;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('FINAL ASSESSMENT');
    console.log('═══════════════════════════════════════════════════════════');

    if (successRate >= 0.8) { // 80% threshold for success
      console.log('✅ SUCCESS: Strong alignment between local and API data');
      console.log(`🎯 ${bothMatch}/${totalCompared} positions match both size and price (${(successRate*100).toFixed(1)}%)`);
      console.log('📋 Wallet identity and size scaling appear to be correct for overlapping assets');
    } else if (successRate >= 0.5) { // 50% threshold for partial success
      console.log('⚠️  PARTIAL SUCCESS: Mixed results between local and API data');
      console.log(`🎯 ${bothMatch}/${totalCompared} positions match both size and price (${(successRate*100).toFixed(1)}%)`);
      console.log('📋 Some discrepancies found, but significant overlap exists');
    } else {
      console.log('❌ LOW MATCH RATE: Significant discrepancies between local and API data');
      console.log(`🎯 Only ${bothMatch}/${totalCompared} positions match both size and price (${(successRate*100).toFixed(1)}%)`);
      console.log('📋 Data integrity concerns for overlapping assets');
    }

    // Show any significant outliers
    console.log('\nPosition-by-position analysis:');
    for (const comp of results) {
      const overallStatus = comp.size_status === 'MATCH' && comp.price_status === 'MATCH' ? '✅ MATCH' : '❌ PARTIAL/NO MATCH';
      console.log(`  ${comp.title?.substring(0, 30).padEnd(32)} | Size Δ: ${comp.size_delta.toFixed(2).padStart(8)} | Price Δ: ${comp.price_delta.toFixed(3).padStart(7)} | ${overallStatus}`);
    }

  } catch (error) {
    console.error('❌ Error during comparison:', error);
  }
}

compareOverlappingPositions().catch(console.error);