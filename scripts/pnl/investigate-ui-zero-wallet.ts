/**
 * Investigate UI Zero PnL Case
 *
 * Wallet 0x34393448709dd71742f4a8f8b973955cf59b4f64 shows:
 * - V18: -$8259.78
 * - UI: $0.00
 *
 * This script investigates why the UI would show $0.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0x34393448709dd71742f4a8f8b973955cf59b4f64';

async function investigate() {
  console.log('=== WALLET TRADING ACTIVITY ANALYSIS ===\n');
  console.log('Wallet:', wallet, '\n');

  // 1. Basic activity stats
  console.log('1. BASIC ACTIVITY STATISTICS');
  const basicStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_fills,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade,
        dateDiff('day', min(trade_time), max(trade_time)) as days_active,
        count(DISTINCT token_id) as unique_tokens,
        sum(usdc_amount) / 1000000.0 as total_volume_usdc
      FROM (
        SELECT
          event_id,
          any(trade_time) as trade_time,
          any(token_id) as token_id,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });

  const stats = await basicStats.json();
  console.log(JSON.stringify(stats, null, 2));

  // 2. Check how many markets we can map
  console.log('\n2. TOKEN->CONDITION MAPPING COVERAGE');
  const mappingCoverage = await clickhouse.query({
    query: `
      WITH wallet_tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
      )
      SELECT
        countIf(m.condition_id IS NOT NULL) as mapped_tokens,
        countIf(m.condition_id IS NULL) as unmapped_tokens,
        count() as total_tokens
      FROM wallet_tokens wt
      LEFT JOIN pm_token_to_condition_map_v5 m
        ON wt.token_id = m.token_id_dec
    `,
    format: 'JSONEachRow'
  });

  const mapping = await mappingCoverage.json();
  console.log(JSON.stringify(mapping, null, 2));

  // 3. Resolution status
  console.log('\n3. RESOLUTION STATUS');
  const resolvedCheck = await clickhouse.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT m.condition_id
        FROM (
          SELECT DISTINCT token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND is_deleted = 0
        ) wt
        JOIN pm_token_to_condition_map_v5 m
          ON wt.token_id = m.token_id_dec
      )
      SELECT
        countIf(r.condition_id IS NOT NULL) as resolved,
        countIf(r.condition_id IS NULL) as unresolved,
        count() as total_markets
      FROM wallet_markets wm
      LEFT JOIN pm_condition_resolutions r
        ON lower(wm.condition_id) = lower(r.condition_id)
    `,
    format: 'JSONEachRow'
  });

  const resolved = await resolvedCheck.json();
  console.log(JSON.stringify(resolved, null, 2));

  // 4. Buy/Sell distribution
  console.log('\n4. BUY/SELL DISTRIBUTION');
  const sideStats = await clickhouse.query({
    query: `
      SELECT
        side,
        count() as fills,
        sum(usdc_amount) / 1000000.0 as volume_usdc
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY side
      ORDER BY side
    `,
    format: 'JSONEachRow'
  });

  const sides = await sideStats.json();
  console.log(JSON.stringify(sides, null, 2));

  // 5. Time period analysis
  console.log('\n5. TRADING TIMELINE');
  const timeline = await clickhouse.query({
    query: `
      SELECT
        toDate(trade_time) as date,
        count() as fills,
        sum(usdc_amount) / 1000000.0 as volume,
        count(DISTINCT token_id) as tokens
      FROM (
        SELECT
          event_id,
          any(trade_time) as trade_time,
          any(usdc_amount) as usdc_amount,
          any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY date
      ORDER BY date
    `,
    format: 'JSONEachRow'
  });

  const timeData = await timeline.json();
  console.log(JSON.stringify(timeData, null, 2));

  // 6. Check for "future" trades (Nov 2025 is in the future!)
  console.log('\n6. SANITY CHECK: Are these trades from the FUTURE?');
  const futureCheck = await clickhouse.query({
    query: `
      SELECT
        min(trade_time) as earliest,
        max(trade_time) as latest,
        now() as current_time,
        if(max(trade_time) > now(), 'FUTURE TRADES!', 'OK') as status
      FROM (
        SELECT
          event_id,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });

  const future = await futureCheck.json();
  console.log(JSON.stringify(future, null, 2));

  // 7. Sample markets (top 5 by volume)
  console.log('\n7. TOP 5 MARKETS BY VOLUME');
  const topMarkets = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.question,
        count() as fills,
        sum(t.usdc_amount) / 1000000.0 as volume,
        r.payout_numerators
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v5 m
        ON t.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r
        ON lower(m.condition_id) = lower(r.condition_id)
      GROUP BY m.condition_id, m.question, r.payout_numerators
      ORDER BY volume DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const markets = await topMarkets.json();
  console.log(JSON.stringify(markets, null, 2));

  console.log('\n=== INVESTIGATION COMPLETE ===\n');
}

investigate().catch(console.error);
