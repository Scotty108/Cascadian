#!/usr/bin/env npx tsx
/**
 * Build Universe-Wide PnL Table (SQL-based)
 *
 * Uses ClickHouse SQL to compute PnL for ALL wallets efficiently.
 * Much faster than streaming approach for large universe.
 *
 * Key features:
 * - Dedupes by event_id in SQL
 * - Applies sell clamp fix (min of buy_tokens, sell_tokens)
 * - Computes win_rate, roi_pct
 * - Filters at the end for realized_pnl >= 500
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import { execSync } from 'child_process';
import * as fs from 'fs';

const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';
const RESOLUTIONS_TABLE = 'pm_condition_resolutions';
const TRADER_EVENTS_TABLE = 'pm_trader_events_v2';
const OUTPUT_TABLE = 'pm_wallet_realized_profit_universe_v1';

const MIN_PNL_FILTER = 500;

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 1800000, // 30 minutes
  clickhouse_settings: {
    max_memory_usage: '20000000000', // 20GB
    max_bytes_before_external_group_by: '10000000000', // 10GB - spill to disk if needed
    join_algorithm: 'partial_merge',
  },
});

async function main() {
  console.log('BUILD UNIVERSE-WIDE PNL TABLE (SQL-BASED)');
  console.log('='.repeat(80));
  console.log('Git commit:', getGitCommit());
  console.log('');

  const startTime = Date.now();

  // Step 1: Drop and create output table
  console.log('Step 1: Creating output table...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${OUTPUT_TABLE}` });

  // Step 2: Run the massive SQL query
  console.log('Step 2: Computing PnL for all wallets (this may take 10-20 minutes)...');

  const sql = `
    CREATE TABLE ${OUTPUT_TABLE}
    ENGINE = MergeTree()
    ORDER BY (realized_profit_usd, wallet)
    AS
    WITH
    -- Dedupe events by event_id
    deduped_events AS (
      SELECT
        event_id,
        lower(any(trader_wallet)) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(token_amount) as token_amount
      FROM ${TRADER_EVENTS_TABLE}
      GROUP BY event_id
    ),
    -- Join with token map to get condition_id and outcome_index
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
    -- Aggregate to positions per wallet/condition/outcome
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
      HAVING buy_tokens > 0  -- Skip synthetic-only positions
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
    -- Calculate per-position PnL with sell clamp fix
    position_pnl AS (
      SELECT
        wallet,
        condition_id,
        buy_usdc,
        sell_usdc,
        buy_tokens,
        sell_tokens,
        is_resolved,
        -- Average buy price
        buy_usdc / buy_tokens as avg_buy_price,
        -- Net tokens held
        buy_tokens - sell_tokens as net_tokens,
        -- Sell profit with clamp: only on tokens we owned
        CASE
          WHEN sell_tokens > 0 AND buy_tokens > 0 THEN
            (sell_usdc * least(buy_tokens, sell_tokens) / sell_tokens) -
            (least(buy_tokens, sell_tokens) * (buy_usdc / buy_tokens))
          ELSE 0
        END as sell_profit,
        -- Resolution profit/loss for held tokens
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
    -- Aggregate per-market PnL for win_rate
    market_pnl AS (
      SELECT
        wallet,
        condition_id,
        sum(sell_profit + resolution_profit) as market_total_pnl,
        max(is_resolved) as is_resolved
      FROM position_pnl
      GROUP BY wallet, condition_id
    ),
    -- Calculate wallet-level metrics
    wallet_metrics AS (
      SELECT
        wallet,
        sum(sell_profit) as realized_profit_from_sells,
        sumIf(resolution_profit, resolution_profit > 0) as realized_profit_from_redemptions,
        sumIf(resolution_profit, resolution_profit < 0) as realized_loss_from_resolutions,
        sum(buy_usdc) as total_buy_usdc,
        sum(sell_usdc) as total_sell_usdc,
        count(DISTINCT condition_id) as n_markets
      FROM position_pnl
      GROUP BY wallet
    ),
    -- Calculate win/loss counts
    wallet_winloss AS (
      SELECT
        wallet,
        countIf(market_total_pnl > 0 AND is_resolved = 1) as win_count,
        countIf(market_total_pnl < 0 AND is_resolved = 1) as loss_count,
        countIf(is_resolved = 1) as resolved_markets
      FROM market_pnl
      GROUP BY wallet
    )
    -- Final select
    SELECT
      m.wallet,
      concat('https://polymarket.com/profile/', m.wallet) as polymarket_url,
      m.realized_profit_from_sells + m.realized_profit_from_redemptions + m.realized_loss_from_resolutions as realized_profit_usd,
      m.realized_profit_from_redemptions,
      m.realized_profit_from_sells,
      m.realized_loss_from_resolutions,
      m.total_sell_usdc - m.total_buy_usdc as net_cash_usd,
      m.total_buy_usdc,
      m.total_sell_usdc,
      m.n_markets,
      w.win_count,
      w.loss_count,
      w.resolved_markets,
      if(w.resolved_markets > 0, w.win_count / w.resolved_markets, 0) as win_rate,
      if(m.total_buy_usdc > 0,
        (m.realized_profit_from_sells + m.realized_profit_from_redemptions + m.realized_loss_from_resolutions) / m.total_buy_usdc * 100,
        0) as roi_pct,
      now() as computed_at
    FROM wallet_metrics m
    JOIN wallet_winloss w ON m.wallet = w.wallet
    WHERE (m.realized_profit_from_sells + m.realized_profit_from_redemptions + m.realized_loss_from_resolutions) >= ${MIN_PNL_FILTER}
  `;

  await clickhouse.command({ query: sql });

  // Step 3: Summary
  console.log('Step 3: Summary...');
  const summaryQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        round(avg(realized_profit_usd), 2) as avg_profit,
        round(median(realized_profit_usd), 2) as median_profit,
        round(min(realized_profit_usd), 2) as min_profit,
        round(max(realized_profit_usd), 2) as max_profit,
        round(avg(win_rate), 4) as avg_win_rate,
        round(avg(roi_pct), 2) as avg_roi
      FROM ${OUTPUT_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const summary = (await summaryQ.json() as any[])[0];

  console.log(`  Total wallets (pnl >= $${MIN_PNL_FILTER}): ${Number(summary.total).toLocaleString()}`);
  console.log(`  Avg PnL:    $${summary.avg_profit}`);
  console.log(`  Median PnL: $${summary.median_profit}`);
  console.log(`  Min PnL:    $${summary.min_profit}`);
  console.log(`  Max PnL:    $${summary.max_profit}`);
  console.log(`  Avg Win Rate: ${(Number(summary.avg_win_rate) * 100).toFixed(1)}%`);
  console.log(`  Avg ROI:    ${summary.avg_roi}%`);

  // Step 4: Export CSV
  console.log('\nStep 4: Exporting CSV...');
  const exportQ = await clickhouse.query({
    query: `SELECT * FROM ${OUTPUT_TABLE} ORDER BY realized_profit_usd DESC`,
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
