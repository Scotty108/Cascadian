#!/usr/bin/env npx tsx

/**
 * Investigate why Polymarket UI shows 192 "predictions"
 * but database shows 141 unique markets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('=== INVESTIGATING "PREDICTIONS" COUNT DISCREPANCY ===\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`UI shows: 192 predictions`);
  console.log(`Database shows: 141 unique markets\n`);

  // Method 1: Unique markets (what we already know)
  const uniqueMarketsQuery = `
    SELECT uniqExact(lower(replaceAll(condition_id, '0x', ''))) as unique_markets
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
  `;
  const marketsResult = await clickhouse.query({
    query: uniqueMarketsQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const markets = await marketsResult.json<Array<any>>();
  console.log('Method 1: Unique Markets (condition_id only)');
  console.log(`  Result: ${markets[0].unique_markets}\n`);

  // Method 2: Unique positions (market + outcome)
  const uniquePositionsQuery = `
    SELECT
      uniqExact((lower(replaceAll(condition_id, '0x', '')), outcome_index)) as unique_positions
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
  `;
  const positionsResult = await clickhouse.query({
    query: uniquePositionsQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const positions = await positionsResult.json<Array<any>>();
  console.log('Method 2: Unique Positions (market + outcome_index)');
  console.log(`  Result: ${positions[0].unique_positions}`);
  console.log(`  Difference from UI: ${192 - parseInt(positions[0].unique_positions)}\n`);

  // Method 3: Check for token_* entries (excluded by filter)
  const tokenEntriesQuery = `
    SELECT
      count() as token_trades,
      uniqExact(condition_id) as token_positions
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND condition_id LIKE 'token_%'
  `;
  const tokenResult = await clickhouse.query({
    query: tokenEntriesQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const tokens = await tokenResult.json<Array<any>>();
  console.log('Method 3: Token_* Entries (filtered out)');
  console.log(`  Token trades: ${tokens[0].token_trades}`);
  console.log(`  Token positions: ${tokens[0].token_positions}\n`);

  // Method 4: Total unique condition_ids (including token_*)
  const allPositionsQuery = `
    SELECT
      uniqExact((condition_id, outcome_index)) as all_positions,
      uniqExact(condition_id) as all_markets
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
  `;
  const allResult = await clickhouse.query({
    query: allPositionsQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const all = await allResult.json<Array<any>>();
  console.log('Method 4: All Positions (including token_*)');
  console.log(`  All positions: ${all[0].all_positions}`);
  console.log(`  All markets: ${all[0].all_markets}`);
  console.log(`  Difference from UI: ${192 - parseInt(all[0].all_positions)}\n`);

  // Method 5: Check trade direction distribution
  const directionQuery = `
    SELECT
      trade_direction,
      count() as trades,
      uniqExact((lower(replaceAll(condition_id, '0x', '')), outcome_index)) as positions
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
    GROUP BY trade_direction
    ORDER BY positions DESC
  `;
  const dirResult = await clickhouse.query({
    query: directionQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const directions = await dirResult.json<Array<any>>();
  console.log('Method 5: Positions by Trade Direction');
  directions.forEach(d => {
    console.log(`  ${d.trade_direction}: ${d.positions} positions, ${d.trades} trades`);
  });
  console.log();

  // Method 6: Check for duplicate outcomes (Yes and No on same market)
  const duplicatesQuery = `
    SELECT
      lower(replaceAll(condition_id, '0x', '')) as cid,
      groupArray(DISTINCT outcome_index) as outcomes,
      length(outcomes) as outcome_count
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
    GROUP BY cid
    HAVING outcome_count > 1
  `;
  const dupResult = await clickhouse.query({
    query: duplicatesQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const duplicates = await dupResult.json<Array<any>>();
  console.log('Method 6: Markets with Multiple Outcomes');
  console.log(`  Markets traded on both outcomes: ${duplicates.length}`);
  console.log(`  Sample:`);
  duplicates.slice(0, 3).forEach(d => {
    console.log(`    ${d.cid.substring(0, 16)}... → outcomes: ${JSON.stringify(d.outcomes)}`);
  });
  console.log();

  // Calculate what Polymarket might be counting
  const uniqueMarkets = parseInt(markets[0].unique_markets);
  const uniquePositions = parseInt(positions[0].unique_positions);
  const tokenPositions = parseInt(tokens[0].token_positions);
  const allPositions = parseInt(all[0].all_positions);

  console.log('=== ANALYSIS ===\n');
  console.log('Hypothesis 1: Polymarket counts each outcome as a prediction');
  console.log(`  Our unique positions (market + outcome): ${uniquePositions}`);
  console.log(`  UI shows: 192`);
  console.log(`  Gap: ${192 - uniquePositions} positions\n`);

  console.log('Hypothesis 2: Missing token_* entries or rewards markets');
  console.log(`  Token positions in database: ${tokenPositions}`);
  console.log(`  All positions (including tokens): ${allPositions}`);
  console.log(`  Gap: ${192 - allPositions} positions\n`);

  console.log('Hypothesis 3: Database missing recent/old trades');
  console.log(`  Check time range of trades...\n`);

  const timeRangeQuery = `
    SELECT
      min(block_time) as first_trade,
      max(block_time) as last_trade,
      dateDiff('day', first_trade, last_trade) as days_active
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
  `;
  const timeResult = await clickhouse.query({
    query: timeRangeQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const timeRange = await timeResult.json<Array<any>>();
  console.log(`  First trade: ${timeRange[0].first_trade}`);
  console.log(`  Last trade: ${timeRange[0].last_trade}`);
  console.log(`  Days active: ${timeRange[0].days_active}\n`);

  console.log('=== CONCLUSION ===\n');

  if (Math.abs(192 - uniquePositions) < 10) {
    console.log('✅ LIKELY: Polymarket counts market + outcome as separate predictions');
    console.log(`   Our count: ${uniquePositions} positions`);
    console.log(`   UI count: 192 predictions`);
    console.log(`   Very close match!\n`);
  } else if (tokenPositions > 0) {
    console.log('⚠️  POSSIBLE: Token_* entries might be rewards markets');
    console.log(`   Adding token positions: ${uniquePositions} + ${tokenPositions} = ${uniquePositions + tokenPositions}`);
    console.log(`   Still ${192 - (uniquePositions + tokenPositions)} away from 192\n`);
  } else {
    console.log('❌ MISMATCH: Database likely missing trades');
    console.log(`   Gap: ${192 - uniquePositions} positions`);
    console.log(`   Possible reasons:`);
    console.log(`     - Recent trades not yet ingested`);
    console.log(`     - Old trades before our data collection started`);
    console.log(`     - Rewards/promotional markets not in trades_raw\n`);
  }

  // Check API data
  console.log('=== API COMPARISON ===\n');
  console.log('Fetching current API data...\n');

  try {
    const apiResponse = await fetch(`https://data-api.polymarket.com/positions?user=${WALLET}&limit=500`);
    const apiData = await apiResponse.json();

    console.log(`API active positions: ${apiData.length}`);
    console.log(`Database unique markets: ${uniqueMarkets}`);
    console.log(`Database unique positions: ${uniquePositions}\n`);

    console.log('Possible explanation:');
    console.log('  - API shows current active positions only (34)');
    console.log('  - Database shows all historical trades (141 markets)');
    console.log('  - UI "predictions" (192) might include:');
    console.log('    • All historical positions (resolved + active)');
    console.log('    • Rewards/special markets not in database');
    console.log('    • Multiple outcomes counted separately\n');
  } catch (error: any) {
    console.error(`Error fetching API: ${error.message}\n`);
  }
}

main().catch(console.error);
