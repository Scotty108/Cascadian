#!/usr/bin/env npx tsx

/**
 * Deep Dive: Rewards vs Predictions
 *
 * If user counted 60+ rewards, but UI shows 192 predictions and database shows 141:
 * - 192 predictions (UI)
 * - 60+ rewards (counted by user)
 * - 141 markets (database)
 *
 * Possible scenarios:
 * 1. Rewards are INCLUDED in the 192 count (192 = 131 regular + 61 rewards)
 * 2. Rewards are SEPARATE from 192 (total would be 192 + 60 = 252)
 * 3. Some rewards ARE in database, some are not
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('=== DEEP DIVE: REWARDS vs PREDICTIONS ===\n');
  console.log(`Wallet: ${WALLET}\n`);

  console.log('Known counts:');
  console.log(`  - Polymarket UI: 192 "predictions"`);
  console.log(`  - User counted: 60+ rewards`);
  console.log(`  - Database: 141 markets\n`);

  console.log('=== HYPOTHESIS TESTING ===\n');

  // Hypothesis 1: Rewards are INCLUDED in 192
  console.log('Hypothesis 1: Rewards included in 192 predictions');
  console.log(`  192 total - 60 rewards = 132 regular predictions`);
  console.log(`  Database has 141 markets`);
  console.log(`  Gap: 141 - 132 = 9 markets`);
  console.log(`  Conclusion: Database has MORE than expected (unlikely)\n`);

  // Hypothesis 2: Rewards are SEPARATE from 192
  console.log('Hypothesis 2: Rewards separate from 192 predictions');
  console.log(`  192 predictions + 60 rewards = 252 total positions`);
  console.log(`  Database has 141 markets`);
  console.log(`  Gap: 252 - 141 = 111 missing positions`);
  console.log(`  Conclusion: Large gap, could be rewards + other markets\n`);

  // Let's investigate database characteristics
  console.log('=== DATABASE INVESTIGATION ===\n');

  // 1. Check for any market characteristics that might indicate rewards
  const marketCharsQuery = `
    SELECT
      lower(replaceAll(condition_id, '0x', '')) as cid,
      count() as trade_count,
      uniqExact(trade_direction) as direction_types,
      groupArray(DISTINCT trade_direction) as directions,
      min(block_time) as first_trade,
      max(block_time) as last_trade,
      sum(toFloat64(abs(cashflow_usdc))) as total_volume,
      avg(toFloat64(abs(cashflow_usdc))) as avg_trade_size
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
    GROUP BY cid
    ORDER BY trade_count ASC
    LIMIT 20
  `;

  const charsResult = await clickhouse.query({
    query: marketCharsQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const chars = await charsResult.json<Array<any>>();

  console.log('Markets with FEWEST trades (potential rewards?):');
  console.log('CID (first 16) | Trades | Volume | Avg Size | First Trade');
  console.log('---------------|--------|--------|----------|------------');

  chars.forEach(c => {
    const cid = c.cid.substring(0, 16);
    const trades = c.trade_count;
    const volume = parseFloat(c.total_volume).toFixed(2);
    const avgSize = parseFloat(c.avg_trade_size).toFixed(2);
    const firstTrade = c.first_trade.split(' ')[0];
    console.log(`${cid}... | ${String(trades).padStart(6)} | $${String(volume).padStart(6)} | $${String(avgSize).padStart(8)} | ${firstTrade}`);
  });
  console.log();

  // 2. Check markets with only 1 trade (might be rewards claims)
  const singleTradeQuery = `
    SELECT
      count() as markets_with_1_trade
    FROM (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as cid,
        count() as trade_count
      FROM default.trades_raw
      WHERE lower(wallet) = lower({wallet:String})
        AND length(replaceAll(condition_id, '0x', '')) = 64
      GROUP BY cid
      HAVING trade_count = 1
    )
  `;

  const singleResult = await clickhouse.query({
    query: singleTradeQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const single = await singleResult.json<Array<any>>();

  console.log(`Markets with exactly 1 trade: ${single[0].markets_with_1_trade}`);
  console.log('(Rewards might be claimed with single transaction)\n');

  // 3. Trade direction distribution
  const directionQuery = `
    SELECT
      trade_direction,
      count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets
    FROM default.trades_raw
    WHERE lower(wallet) = lower({wallet:String})
      AND length(replaceAll(condition_id, '0x', '')) = 64
    GROUP BY trade_direction
    ORDER BY markets DESC
  `;

  const dirResult = await clickhouse.query({
    query: directionQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const directions = await dirResult.json<Array<any>>();

  console.log('Markets by trade direction:');
  directions.forEach(d => {
    console.log(`  ${d.trade_direction}: ${d.markets} markets`);
  });
  console.log();

  // 4. Get all market IDs to compare with API
  console.log('=== FETCHING API DATA FOR COMPARISON ===\n');

  try {
    // Fetch both active and closed positions
    const [activeResp, closedResp] = await Promise.all([
      fetch(`https://data-api.polymarket.com/positions?user=${WALLET}&limit=500`),
      fetch(`https://data-api.polymarket.com/closed-positions?user=${WALLET}&limit=500`)
    ]);

    const activeData = await activeResp.json();
    const closedData = await closedResp.json();

    console.log(`API active positions: ${activeData.length}`);
    console.log(`API closed positions: ${closedData.length}`);
    console.log(`Total API positions: ${activeData.length + closedData.length}\n`);

    // Extract unique condition IDs from API
    const apiConditionIds = new Set<string>();
    [...activeData, ...closedData].forEach((pos: any) => {
      if (pos.market?.condition_id) {
        apiConditionIds.add(pos.market.condition_id.toLowerCase().replace('0x', ''));
      }
    });

    console.log(`Unique condition IDs in API: ${apiConditionIds.size}\n`);

    // Compare with database
    const dbQuery = `
      SELECT groupArray(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as cids
      FROM default.trades_raw
      WHERE lower(wallet) = lower({wallet:String})
        AND length(replaceAll(condition_id, '0x', '')) = 64
    `;

    const dbResult = await clickhouse.query({
      query: dbQuery,
      format: 'JSONEachRow',
      query_params: { wallet: WALLET }
    });
    const dbData = await dbResult.json<Array<any>>();
    const dbConditionIds = new Set(dbData[0].cids);

    console.log(`Unique condition IDs in database: ${dbConditionIds.size}\n`);

    // Calculate overlap
    const inBoth = new Set([...apiConditionIds].filter(id => dbConditionIds.has(id)));
    const onlyApi = new Set([...apiConditionIds].filter(id => !dbConditionIds.has(id)));
    const onlyDb = new Set([...dbConditionIds].filter(id => !apiConditionIds.has(id)));

    console.log('--- OVERLAP ANALYSIS ---\n');
    console.log(`In both API and database: ${inBoth.size}`);
    console.log(`Only in API (missing from DB): ${onlyApi.size}`);
    console.log(`Only in database (not in API): ${onlyDb.size}\n`);

    if (onlyApi.size > 0) {
      console.log('Sample markets missing from database:');
      Array.from(onlyApi).slice(0, 5).forEach(id => {
        console.log(`  ${id.substring(0, 16)}...`);
      });
      console.log();
    }

  } catch (error: any) {
    console.error(`Error fetching API: ${error.message}\n`);
  }

  // 5. Check for small volume trades (might be rewards)
  const smallVolumeQuery = `
    SELECT
      count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets_under_10
    FROM (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as cid,
        sum(toFloat64(abs(cashflow_usdc))) as total_volume
      FROM default.trades_raw
      WHERE lower(wallet) = lower({wallet:String})
        AND length(replaceAll(condition_id, '0x', '')) = 64
      GROUP BY cid
      HAVING total_volume < 10
    )
  `;

  const smallResult = await clickhouse.query({
    query: smallVolumeQuery,
    format: 'JSONEachRow',
    query_params: { wallet: WALLET }
  });
  const small = await smallResult.json<Array<any>>();

  console.log('=== POTENTIAL REWARDS INDICATORS ===\n');
  console.log(`Markets with <$10 total volume: ${small[0].markets_under_10}`);
  console.log(`(Small volume might indicate rewards claims)\n`);

  // Final calculation
  console.log('=== FINAL CALCULATION ===\n');

  console.log('If user counted 60+ rewards:');
  console.log('  Scenario A: Rewards are PART of 192 predictions');
  console.log(`    Regular predictions: 192 - 60 = 132`);
  console.log(`    Database has: 141`);
  console.log(`    Extra in DB: 141 - 132 = 9 markets`);
  console.log(`    → Some rewards might be IN the database\n`);

  console.log('  Scenario B: Rewards are SEPARATE from 192 predictions');
  console.log(`    Total positions: 192 + 60 = 252`);
  console.log(`    Database has: 141`);
  console.log(`    Missing: 252 - 141 = 111 positions`);
  console.log(`    → Database missing significant data\n`);

  console.log('Next steps:');
  console.log('  1. Clarify: Are rewards shown separately on UI or included in 192?');
  console.log('  2. Check: Which specific markets are the "rewards" you counted?');
  console.log('  3. Verify: Can we identify reward markets by characteristics?\n');
}

main().catch(console.error);
