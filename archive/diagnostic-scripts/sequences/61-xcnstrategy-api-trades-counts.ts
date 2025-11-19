/**
 * 61: XCNSTRATEGY API TRADES COUNTS
 *
 * Mission: Hit Polymarket trades endpoint for xcnstrategy wallet to get accurate counts
 * and compare vs our ClickHouse data.
 *
 * Only factual counts - no PnL or position interpretation.
 */

interface PolymarketTrade {
  id?: string;
  asset?: string;
  tokenId?: string;
  makerAddress?: string;
  takerAddress?: string;
  size?: number;
  price?: number;
  timestamp?: number;
  created_at?: string;
  side?: string;
  outcome?: string;
  orderId?: string;
  [key: string]: any;
}

interface EventGrouping {
  eventId?: string;
  eventTitle?: string;
  count: number;
}

async function getAPITradeData() {
  const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('61: XCNSTRATEGY API TRADES COUNTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Mission: Get accurate counts from Polymarket trades API for ${targetWallet}`);
  console.log('Endpoint: /trades?user={wallet}\n');

  try {
    // Call the trades API with pagination support
    const baseUrl = `https://data-api.polymarket.com/trades?user=${targetWallet}&limit=1000`;
    console.log(`Fetching from: ${baseUrl}`);

    const allTrades: PolymarketTrade[] = [];
    let offset = 0;
    let hasMore = true;

    // Keep fetching until we get all trades
    while (hasMore) {
      const url = `${baseUrl}&skip=${offset}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Handle different response structures
      let trades: PolymarketTrade[];
      if (Array.isArray(data)) {
        trades = data;
      } else if (data.data && Array.isArray(data.data)) {
        trades = data.data;
      } else if (data.trades && Array.isArray(data.trades)) {
        trades = data.trades;
      } else {
        console.log(`⚠️ Unexpected response structure:`, JSON.stringify(data).substring(0, 200));
        break;
      }

      console.log(`Fetched ${trades.length} trades (offset: ${offset})`);
      allTrades.push(...trades);

      // Check if we need to fetch more
      if (trades.length < 1000) {
        hasMore = false;
      } else {
        offset += trades.length;
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`\n✅ Total trades fetched: ${allTrades.length}`);

    if (allTrades.length === 0) {
      console.log('❌ No trades returned from API');
      return {
        total_trades: 0,
        distinct_assets: 0,
        distinct_conditions: 0,
        first_trade_ts: '',
        last_trade_ts: ''
      };
    }

    // Step 1: Basic counts
    console.log('\n📋 ANALYSIS 1: Basic trade counts');

    // Extract timestamps for date range
    const timestamps = allTrades
      .map(trade => trade.timestamp ? new Date(trade.timestamp * 1000) : null)
      .filter(ts => ts !== null)
      .sort((a, b) => a!.getTime() - b!.getTime());

    const first_trade_ts = timestamps.length > 0 ? timestamps[0]!.toISOString() : '';
    const last_trade_ts = timestamps.length > 0 ? timestamps[timestamps.length - 1]!.toISOString() : '';

    console.log(`  Total trades: ${allTrades.length}`);
    console.log(`  First trade: ${first_trade_ts}`);
    console.log(`  Last trade: ${last_trade_ts}`);

    // Step 2: Distinct assets
    console.log('\n📋 ANALYSIS 2: Asset coverage');

    const uniqueAssets = new Set(
      allTrades.map(trade => trade.asset || trade.tokenId || '').filter(Boolean)
    );

    console.log(`  Unique assets: ${uniqueAssets.size}`);
    console.log(`  Sample asset IDs (first 3):`);
    const sampleAssets = Array.from(uniqueAssets).slice(0, 3);
    sampleAssets.forEach(asset => console.log(`    ${asset}`));

    // Step 3: Try to extract condition/event information where available
    console.log('\n📋 ANALYSIS 3: Market/Event structure');

    // Look for condition_id in trades or try to infer from asset structure
    const conditionData: Map<string, number> = new Map();
    const eventData: EventGrouping[] = [];

    // Try to group by what market data we have
    const seenMarkets = new Set<string>();

    // Look for any market-identifying information
    allTrades.forEach(trade => {
      // Look for event IDs in various fields
      const marketId = trade.orderId ||
                       trade.outcome ||
                       (trade.side === 'BUY' ? 'YES' : 'NO') ||
                       '';

      // Use asset as primary market identifier
      const assetId = trade.asset || trade.tokenId || '';
      if (assetId) {
        const current = seenMarkets.has(assetId) ? 1 : 0;
        if (current === 0) seenMarkets.add(assetId);
      }

      // For condition_id, we can only count if we have it directly from API
      if (trade.conditionId) {
        const current = conditionData.get(trade.conditionId) || 0;
        conditionData.set(trade.conditionId, current + 1);
      }
    });

    console.log(`  Markets seen via asset IDs: ${seenMarkets.size}`);
    console.log(`  Markets with explicit condition_id: ${conditionData.size}`);

    // Step 4: Time series breakdown
    console.log('\n📋 ANALYSIS 4: Monthly activity pattern');

    const monthlyData = new Map<string, { trades: number; assets: Set<string> }>();

    allTrades.forEach(trade => {
      const timestamp = trade.timestamp ? new Date(trade.timestamp * 1000) : null;
      if (!timestamp) return;

      const monthKey = timestamp.toISOString().slice(0, 7); // YYYY-MM format
      const current = monthlyData.get(monthKey) || { trades: 0, assets: new Set<string>() };
      current.trades++;

      const assetId = trade.asset || trade.tokenId;
      if (assetId) current.assets.add(assetId);

      monthlyData.set(monthKey, current);
    });

    // Sort by month and show recent activity
    const sortedMonths = Array.from(monthlyData.entries()).sort();
    const recentMonths = sortedMonths.slice(-10);

    console.log('Recent months (YYYY-MM : trades : distinctAssets):');
    recentMonths.forEach(([month, data]) => {
      console.log(`  ${month} : ${data.trades} trades : ${data.assets.size} assets`);
    });

    // Step 5: Compare sample trade data structure vs our fixture format
    console.log('\n📋 ANALYSIS 5: Sample trade structure (first 3 trades)');

    allTrades.slice(0, 3).forEach((trade, index) => {
      console.log(`Trade ${index + 1}:`);
      console.log(`  asset/tokenId: ${trade.asset || trade.tokenId || 'N/A'}`);
      console.log(`  size: ${trade.size || 0}`);
      console.log(`  price: ${trade.price || 0}`);
      console.log(`  side: ${trade.side || 'N/A'}`);
      console.log(`  timestamp: ${trade.timestamp || 'N/A'}`);
      console.log(`  conditionId: ${trade.conditionId || 'N/A'}`);
      console.log('');
    });

    const result = {
      total_trades: allTrades.length,
      distinct_assets: uniqueAssets.size,
      distinct_conditions: conditionData.size || 0,
      first_trade_ts: first_trade_ts,
      last_trade_ts: last_trade_ts
    };

    // Final summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('API TRADES COUNTS SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');

    console.log('\nFinal API counts:');
    console.log(`  Total trades: ${result.total_trades.toLocaleString()}`);
    console.log(`  Unique assets: ${result.distinct_assets.toLocaleString()}`);
    console.log(`  Markets with condition_id: ${result.distinct_conditions.toLocaleString()}`);
    console.log(`  Date range: ${result.first_trade_ts} to ${result.last_trade_ts}`);

    return result;

  } catch (error) {
    console.error('❌ Error during API counts:', error);
    throw error;
  }
}

getAPITradeData()
  .then(data => {
    console.log('\n\n✅ Script 61 complete - API counts retrieved');
    console.log('Next: Run script 62 to compare with ClickHouse data');
  })
  .catch(console.error);