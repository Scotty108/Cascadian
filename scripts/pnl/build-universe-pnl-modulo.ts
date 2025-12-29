#!/usr/bin/env npx tsx
/**
 * Build Universe-Wide PnL Table - Modulo Partitioning
 *
 * Uses modulo hash partitioning to process wallets in 20 batches.
 * Each batch processes ~5% of wallets, staying under memory limits.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';
const RESOLUTIONS_TABLE = 'pm_condition_resolutions';
const TRADER_EVENTS_TABLE = 'pm_trader_events_v2';
const OUTPUT_TABLE = 'pm_wallet_pnl_universe_v1';

const NUM_PARTITIONS = 50; // Split into 50 batches (smaller chunks to avoid disk issues)
const MIN_PNL_FILTER = 500;
const START_PARTITION = parseInt(process.env.START_PARTITION || '0', 10); // Resume from this partition

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 1800000, // 30 minutes
  clickhouse_settings: {
    max_bytes_before_external_group_by: '5000000000', // 5GB spill threshold
    join_algorithm: 'partial_merge',
  },
});

async function main() {
  console.log('BUILD UNIVERSE PNL - MODULO PARTITIONING');
  console.log('='.repeat(80));
  const startTime = Date.now();

  // Step 1: Create output table (skip if resuming)
  if (START_PARTITION === 0) {
    console.log('Step 1: Creating output table...');
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${OUTPUT_TABLE}` });
    await clickhouse.command({
      query: `
        CREATE TABLE ${OUTPUT_TABLE} (
          wallet String,
          polymarket_url String,
          realized_pnl Float64,
          capital_deployed Float64,
          total_return Float64,
          n_markets UInt32,
          win_count UInt32,
          loss_count UInt32,
          win_rate Float64,
          roi_pct Float64,
          computed_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (realized_pnl, wallet)
      `
    });
  } else {
    console.log(`Step 1: Resuming from partition ${START_PARTITION + 1} (table exists)...`);
  }

  // Step 2: Process each partition
  console.log(`\nStep 2: Processing partitions ${START_PARTITION + 1}-${NUM_PARTITIONS}...`);

  for (let partition = START_PARTITION; partition < NUM_PARTITIONS; partition++) {
    const partitionStart = Date.now();
    console.log(`\n  Partition ${partition + 1}/${NUM_PARTITIONS}...`);

    const sql = `
      INSERT INTO ${OUTPUT_TABLE}
      WITH
      -- Dedupe events by event_id, filter by partition
      deduped_events AS (
        SELECT
          event_id,
          lower(any(trader_wallet)) as wallet,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount
        FROM ${TRADER_EVENTS_TABLE}
        WHERE cityHash64(lower(trader_wallet)) % ${NUM_PARTITIONS} = ${partition}
        GROUP BY event_id
      ),
      -- Join with token map
      events_with_condition AS (
        SELECT
          e.wallet,
          m.condition_id,
          m.outcome_index,
          e.side,
          e.usdc_amount / 1e6 as usdc,
          e.token_amount / 1e6 as tokens
        FROM deduped_events e
        JOIN ${TOKEN_MAP_TABLE} m ON e.token_id = m.token_id_dec
      ),
      -- Aggregate to positions
      positions AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          sumIf(usdc, side = 'buy') as buy_usdc,
          sumIf(usdc, side = 'sell') as sell_usdc,
          sumIf(tokens, side = 'buy') as buy_tokens,
          sumIf(tokens, side = 'sell') as sell_tokens
        FROM events_with_condition
        GROUP BY wallet, condition_id, outcome_index
        HAVING buy_tokens > 0
      ),
      -- Join with resolutions
      positions_with_resolution AS (
        SELECT
          p.*,
          r.payout_0,
          r.payout_1,
          CASE WHEN r.condition_id IS NOT NULL THEN 1 ELSE 0 END as is_resolved
        FROM positions p
        LEFT JOIN (
          SELECT
            lower(condition_id) as condition_id,
            toUInt8(JSONExtractInt(payout_numerators, 1) > 0) as payout_0,
            toUInt8(JSONExtractInt(payout_numerators, 2) > 0) as payout_1
          FROM ${RESOLUTIONS_TABLE}
        ) r ON lower(p.condition_id) = r.condition_id
      ),
      -- Calculate PnL per position
      position_pnl AS (
        SELECT
          wallet,
          condition_id,
          buy_usdc,
          is_resolved,
          -- Sell profit with clamp
          CASE
            WHEN sell_tokens > 0 AND buy_tokens > 0 THEN
              (sell_usdc * least(buy_tokens, sell_tokens) / sell_tokens) -
              (least(buy_tokens, sell_tokens) * (buy_usdc / buy_tokens))
            ELSE 0
          END as sell_profit,
          -- Resolution profit/loss
          CASE
            WHEN (buy_tokens - sell_tokens) > 0 AND is_resolved = 1 THEN
              CASE
                WHEN outcome_index = 0 AND payout_0 > 0 THEN
                  (buy_tokens - sell_tokens) * payout_0 - (buy_tokens - sell_tokens) * (buy_usdc / buy_tokens)
                WHEN outcome_index = 1 AND payout_1 > 0 THEN
                  (buy_tokens - sell_tokens) * payout_1 - (buy_tokens - sell_tokens) * (buy_usdc / buy_tokens)
                ELSE
                  -(buy_tokens - sell_tokens) * (buy_usdc / buy_tokens)
              END
            ELSE 0
          END as resolution_profit
        FROM positions_with_resolution
      ),
      -- Market-level PnL for win rate
      market_pnl AS (
        SELECT
          wallet,
          condition_id,
          sum(sell_profit + resolution_profit) as market_total_pnl,
          max(is_resolved) as is_resolved
        FROM position_pnl
        GROUP BY wallet, condition_id
      ),
      -- Wallet metrics
      wallet_metrics AS (
        SELECT
          wallet,
          sum(sell_profit + resolution_profit) as realized_pnl,
          sum(buy_usdc) as capital_deployed,
          count(DISTINCT condition_id) as n_markets
        FROM position_pnl
        GROUP BY wallet
      ),
      -- Win/loss counts
      wallet_winloss AS (
        SELECT
          wallet,
          countIf(market_total_pnl > 0 AND is_resolved = 1) as win_count,
          countIf(market_total_pnl < 0 AND is_resolved = 1) as loss_count,
          countIf(is_resolved = 1) as resolved_markets
        FROM market_pnl
        GROUP BY wallet
      )
      SELECT
        m.wallet,
        concat('https://polymarket.com/profile/', m.wallet) as polymarket_url,
        m.realized_pnl,
        m.capital_deployed,
        if(m.capital_deployed > 0, m.realized_pnl / m.capital_deployed, 0) as total_return,
        m.n_markets,
        w.win_count,
        w.loss_count,
        if(w.resolved_markets > 0, w.win_count / w.resolved_markets, 0) as win_rate,
        if(m.capital_deployed > 0, m.realized_pnl / m.capital_deployed * 100, 0) as roi_pct,
        now() as computed_at
      FROM wallet_metrics m
      JOIN wallet_winloss w ON m.wallet = w.wallet
      WHERE m.realized_pnl >= ${MIN_PNL_FILTER}
    `;

    await clickhouse.command({ query: sql });
    const partitionElapsed = ((Date.now() - partitionStart) / 1000).toFixed(1);
    console.log(`    Completed in ${partitionElapsed}s`);
  }

  // Step 3: Summary
  console.log('\nStep 3: Summary...');
  const summaryQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        round(avg(realized_pnl), 2) as avg_pnl,
        round(median(realized_pnl), 2) as median_pnl,
        round(max(realized_pnl), 2) as max_pnl
      FROM ${OUTPUT_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const summary = (await summaryQ.json() as any[])[0];
  console.log(`  Total wallets (pnl >= $${MIN_PNL_FILTER}): ${Number(summary.total).toLocaleString()}`);
  console.log(`  Avg PnL: $${summary.avg_pnl}`);
  console.log(`  Median PnL: $${summary.median_pnl}`);
  console.log(`  Max PnL: $${summary.max_pnl}`);

  // Step 4: Export CSV
  console.log('\nStep 4: Exporting CSV...');
  const exportQ = await clickhouse.query({
    query: `SELECT * FROM ${OUTPUT_TABLE} ORDER BY realized_pnl DESC`,
    format: 'CSVWithNames'
  });
  const csv = await exportQ.text();
  const filename = `tmp/universe_pnl500_plus_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
  fs.writeFileSync(filename, csv);
  const lines = csv.split('\n').filter(l => l.trim()).length - 1;
  console.log(`  Exported ${lines.toLocaleString()} wallets to ${filename}`);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nCompleted in ${elapsed} minutes`);

  await clickhouse.close();
}

main().catch(console.error);
