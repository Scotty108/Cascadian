import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { readFileSync } from 'fs';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function crossReferencePolymarketAPI() {
  console.log('=== Cross-Reference: Database vs Polymarket API ===\n');

  // Load Polymarket API data
  // File contains concatenated JSON objects, extract first 60298 chars (first complete object)
  const apiDataPath = resolve(__dirname, '../docs/archive/agent-os-oct-2025/product/Wallet_trade_details.md');
  const fileContent = readFileSync(apiDataPath, 'utf-8');
  const jsonStr = fileContent.substring(0, 60298); // First complete JSON object

  const apiData = JSON.parse(jsonStr);
  const apiOrders = apiData.orders;

  console.log(`Loaded ${apiOrders.length} orders from Polymarket API\n`);

  // Get unique markets from API
  const apiMarkets = new Map<string, any>();
  apiOrders.forEach((order: any) => {
    const cid = order.condition_id.toLowerCase().replace('0x', '');
    if (!apiMarkets.has(cid)) {
      apiMarkets.set(cid, {
        condition_id: cid,
        title: order.title,
        slug: order.market_slug,
        token_ids: new Set(),
        trade_count: 0,
        sides: { BUY: 0, SELL: 0 }
      });
    }
    const market = apiMarkets.get(cid)!;
    market.token_ids.add(order.token_id);
    market.trade_count++;
    market.sides[order.side as 'BUY' | 'SELL']++;
  });

  console.log(`API contains ${apiMarkets.size} unique markets\n`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get our database markets
  const dbQuery = `
    SELECT
      condition_id_norm_v3 AS condition_id,
      outcome_index_v3 AS outcome_idx,
      count() AS trade_count,
      countIf(trade_direction = 'BUY') AS buy_count,
      countIf(trade_direction = 'SELL') AS sell_count,
      sum(abs(usd_value)) AS volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
    GROUP BY condition_id, outcome_idx
    ORDER BY volume DESC
    LIMIT 20
  `;

  const dbResult = await clickhouse.query({ query: dbQuery, format: 'JSONEachRow' });
  const dbMarkets = await dbResult.json<any[]>();

  console.log(`Database contains ${dbMarkets.length} markets (top 20 by volume)\n`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Cross-reference
  console.log('CROSS-REFERENCE RESULTS:\n');

  const foundInAPI: any[] = [];
  const notFoundInAPI: any[] = [];

  dbMarkets.forEach((dbMarket, idx) => {
    const cid = dbMarket.condition_id.toLowerCase().replace('0x', '');
    const inAPI = apiMarkets.has(cid);

    if (inAPI) {
      const apiMarket = apiMarkets.get(cid)!;
      foundInAPI.push({
        rank: idx + 1,
        condition_id: cid.substring(0, 20) + '...',
        outcome_idx: dbMarket.outcome_idx,
        db_trades: Number(dbMarket.trade_count),
        db_buys: Number(dbMarket.buy_count),
        db_sells: Number(dbMarket.sell_count),
        api_trades: apiMarket.trade_count,
        api_buys: apiMarket.sides.BUY,
        api_sells: apiMarket.sides.SELL,
        api_title: apiMarket.title,
        api_token_ids: apiMarket.token_ids.size
      });
    } else {
      notFoundInAPI.push({
        rank: idx + 1,
        condition_id: cid.substring(0, 20) + '...',
        outcome_idx: dbMarket.outcome_idx,
        db_trades: Number(dbMarket.trade_count),
        volume: Number(dbMarket.volume)
      });
    }
  });

  console.log(`✅ FOUND IN API: ${foundInAPI.length} markets\n`);

  if (foundInAPI.length > 0) {
    console.log('| # | Condition ID         | Out | DB Trades | API Trades | Match? | API Title                              |');
    console.log('|---|----------------------|-----|-----------|------------|--------|----------------------------------------|');
    foundInAPI.forEach(m => {
      const match = m.db_trades === m.api_trades ? '✅' : '⚠️';
      console.log(`| ${String(m.rank).padStart(1)} | ${m.condition_id} | ${String(m.outcome_idx).padStart(3)} | ${String(m.db_trades).padStart(9)} | ${String(m.api_trades).padStart(10)} | ${match}      | ${m.api_title.substring(0, 38).padEnd(38)} |`);
    });
    console.log('\n');

    // Detailed analysis for markets with trade count discrepancies
    const discrepancies = foundInAPI.filter(m => m.db_trades !== m.api_trades);
    if (discrepancies.length > 0) {
      console.log(`⚠️  TRADE COUNT DISCREPANCIES: ${discrepancies.length} markets\n`);
      discrepancies.forEach(m => {
        console.log(`Market: ${m.api_title}`);
        console.log(`  Condition ID: ${m.condition_id}...`);
        console.log(`  Database:  ${m.db_buys} BUYs, ${m.db_sells} SELLs = ${m.db_trades} total`);
        console.log(`  API:       ${m.api_buys} BUYs, ${m.api_sells} SELLs = ${m.api_trades} total`);
        console.log(`  Gap:       ${m.api_trades - m.db_trades} trades`);
        console.log('');
      });
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log(`❌ NOT FOUND IN API: ${notFoundInAPI.length} markets\n`);

  if (notFoundInAPI.length > 0) {
    console.log('These are in our database but NOT in the Polymarket API response:\n');
    console.log('| # | Condition ID         | Out | DB Trades | Volume      |');
    console.log('|---|----------------------|-----|-----------|-------------|');
    notFoundInAPI.forEach(m => {
      console.log(`| ${String(m.rank).padStart(1)} | ${m.condition_id} | ${String(m.outcome_idx).padStart(3)} | ${String(m.db_trades).padStart(9)} | $${Number(m.volume).toLocaleString().padStart(10)} |`);
    });
    console.log('\n');

    console.log('🚨 CRITICAL: If our top 10 markets are NOT in the API response, this suggests:\n');
    console.log('  1. ❌ API response is for different time period');
    console.log('  2. ❌ Database has trades that Polymarket doesn\'t recognize');
    console.log('  3. ❌ Condition ID format mismatch');
    console.log('  4. ❌ API response is incomplete\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Token ID analysis for matching markets
  if (foundInAPI.length > 0) {
    console.log('TOKEN ID ANALYSIS:\n');
    console.log('Checking if token_id encodes outcome index correctly\n');

    // Sample a few markets from API to decode token_ids
    const sampleMarkets = Array.from(apiMarkets.values()).slice(0, 5);
    for (const market of sampleMarkets) {
      console.log(`Market: ${market.title}`);
      console.log(`  Condition ID: 0x${market.condition_id.substring(0, 16)}...`);
      console.log(`  Unique token_ids: ${market.token_ids.size}`);

      // Get sample token IDs
      const tokenIds = Array.from(market.token_ids) as string[];
      tokenIds.slice(0, 3).forEach((tokenId: string) => {
        console.log(`    Token ID: ${tokenId.substring(0, 30)}...`);
      });
      console.log('');
    }

    console.log('NOTE: token_id = condition_id + outcome_index encoded as uint256');
    console.log('      We need to decode these to verify outcome indices match our data\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Summary
  console.log('SUMMARY:\n');
  console.log(`Total markets in database (top 20):  ${dbMarkets.length}`);
  console.log(`Markets found in API:                 ${foundInAPI.length} ✅`);
  console.log(`Markets NOT found in API:             ${notFoundInAPI.length} ❌`);
  console.log(`Trade count matches:                  ${foundInAPI.filter(m => m.db_trades === m.api_trades).length} ✅`);
  console.log(`Trade count discrepancies:            ${foundInAPI.filter(m => m.db_trades !== m.api_trades).length} ⚠️`);
  console.log('');

  if (notFoundInAPI.length > foundInAPI.length) {
    console.log('🚨 BLOCKER: Majority of database markets are NOT in API response!');
    console.log('   This means the Polymarket API data is from a different time window');
    console.log('   or our database has markets that don\'t match Polymarket\'s records.\n');
  } else if (notFoundInAPI.length === 0) {
    console.log('✅ PERFECT MATCH: All database markets are in API response!');
    console.log('   We can use this data to verify resolutions and outcomes.\n');
  } else {
    console.log('⚠️  PARTIAL MATCH: Some markets overlap, investigate the gaps.\n');
  }

  return {
    foundInAPI,
    notFoundInAPI,
    apiMarkets: Array.from(apiMarkets.values())
  };
}

crossReferencePolymarketAPI().catch(console.error);
