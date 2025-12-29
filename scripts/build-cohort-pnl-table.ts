#!/usr/bin/env npx tsx
/**
 * Build Cohort PnL Table
 *
 * Creates a materialized table with PnL for active cohort.
 * This avoids repeated slow queries by pre-calculating everything.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('='.repeat(80));
  console.log('BUILD COHORT PNL TABLE');
  console.log('='.repeat(80));

  const startTime = Date.now();

  // Step 1: Create the table
  console.log('\n1. Creating cohort PnL table...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_cohort_pnl_active_v1'
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_cohort_pnl_active_v1 (
        wallet String,
        realized_pnl_usd Float64,
        sum_gains Float64,
        sum_losses Float64,
        omega Float64,
        total_trades UInt64,
        markets_traded UInt64,
        first_trade DateTime,
        last_trade DateTime,
        created_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(created_at)
      ORDER BY wallet
    `
  });
  console.log('   Table created.');

  // Step 2: Insert data using INSERT INTO ... SELECT
  // This is more efficient than running the query and then inserting
  console.log('\n2. Populating table (this will take 5-10 minutes)...');

  await clickhouse.command({
    query: `
      INSERT INTO pm_cohort_pnl_active_v1
      (wallet, realized_pnl_usd, sum_gains, sum_losses, omega, total_trades, markets_traded, first_trade, last_trade)
      WITH
        -- Dedupe trades by event_id
        deduped_trades AS (
          SELECT
            event_id,
            any(trader_wallet) AS trader_wallet,
            any(side) AS side,
            any(usdc_amount) / 1000000.0 AS usdc,
            any(token_amount) / 1000000.0 AS tokens,
            any(token_id) AS token_id,
            any(trade_time) AS trade_time
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY event_id
        ),

        -- Map tokens to conditions
        trades_mapped AS (
          SELECT
            d.trader_wallet,
            m.condition_id,
            m.outcome_index,
            d.side,
            d.usdc,
            d.tokens,
            d.trade_time
          FROM deduped_trades d
          INNER JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
        ),

        -- Aggregate to positions
        positions AS (
          SELECT
            trader_wallet,
            condition_id,
            outcome_index,
            sum(if(side = 'buy', -usdc, usdc)) AS cash_flow,
            sum(if(side = 'buy', tokens, -tokens)) AS shares,
            count(*) AS trades,
            min(trade_time) AS first_trade,
            max(trade_time) AS last_trade
          FROM trades_mapped
          GROUP BY trader_wallet, condition_id, outcome_index
        ),

        -- Join with resolutions
        with_resolution AS (
          SELECT
            p.trader_wallet,
            p.condition_id,
            p.cash_flow,
            p.shares,
            p.trades,
            p.first_trade,
            p.last_trade,
            CASE
              WHEN r.payout_numerators IS NULL THEN 0
              WHEN JSONExtractInt(r.payout_numerators, p.outcome_index + 1) >= 1000 THEN 1.0
              ELSE toFloat64(JSONExtractInt(r.payout_numerators, p.outcome_index + 1))
            END AS resolution_price
          FROM positions p
          LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
        ),

        -- Calculate PnL per position
        position_pnl AS (
          SELECT
            trader_wallet,
            condition_id,
            cash_flow + (shares * resolution_price) AS realized_pnl,
            trades,
            first_trade,
            last_trade
          FROM with_resolution
        ),

        -- Aggregate to wallet level
        wallet_pnl AS (
          SELECT
            trader_wallet AS wallet,
            sum(realized_pnl) AS realized_pnl_usd,
            sumIf(realized_pnl, realized_pnl > 0) AS sum_gains,
            abs(sumIf(realized_pnl, realized_pnl < 0)) AS sum_losses,
            sum(trades) AS total_trades,
            uniqExact(condition_id) AS markets_traded,
            min(first_trade) AS first_trade,
            max(last_trade) AS last_trade
          FROM position_pnl
          GROUP BY trader_wallet
        )

      -- Final: Filter to active cohort (>= 20 trades, active last 14 days)
      SELECT
        wallet,
        realized_pnl_usd,
        sum_gains,
        sum_losses,
        if(sum_losses > 0.01,
           sum_gains / sum_losses,
           if(sum_gains > 0, 999, 0)) AS omega,
        total_trades,
        markets_traded,
        first_trade,
        last_trade
      FROM wallet_pnl
      WHERE total_trades >= 20
        AND last_trade >= now() - INTERVAL 14 DAY
    `,
    clickhouse_settings: {
      max_execution_time: 1800,  // 30 minute timeout
      max_memory_usage: 30000000000  // 30GB memory
    }
  });

  const elapsed1 = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   Done! (${elapsed1} min)`);

  // Step 3: Verify
  console.log('\n3. Verifying...');
  const countQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_cohort_pnl_active_v1',
    format: 'JSONEachRow'
  });
  const countRows = await countQ.json() as any[];
  const count = parseInt(countRows[0]?.cnt || '0');
  console.log(`   Total wallets: ${count.toLocaleString()}`);

  // Step 4: Query and export
  console.log('\n4. Exporting to CSV...');
  const dataQ = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_cohort_pnl_active_v1
      ORDER BY omega DESC, realized_pnl_usd DESC
    `,
    format: 'JSONEachRow'
  });
  const rows = await dataQ.json() as any[];

  // Summary stats
  const profitable = rows.filter((r: any) => r.realized_pnl_usd > 0);
  const highOmega = rows.filter((r: any) => r.omega > 1 && r.omega < 999);
  const highPnlOmega = rows.filter((r: any) => r.realized_pnl_usd > 500 && r.omega > 1 && r.omega < 999);
  const totalPnl = rows.reduce((s: number, r: any) => s + r.realized_pnl_usd, 0);

  console.log('\n' + '='.repeat(80));
  console.log('COHORT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets:      ${rows.length.toLocaleString()}`);
  console.log(`Profitable:         ${profitable.length.toLocaleString()} (${((profitable.length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Omega > 1:          ${highOmega.length.toLocaleString()}`);
  console.log(`PnL>$500 & Omega>1: ${highPnlOmega.length.toLocaleString()}`);
  console.log(`Combined PnL:       $${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // Top 10 by omega
  const sorted = [...highOmega].sort((a: any, b: any) => b.omega - a.omega);

  console.log('\n' + '='.repeat(80));
  console.log('TOP 10 BY OMEGA');
  console.log('='.repeat(80));
  console.log('Wallet                                     | Omega    | PnL          | Trades');
  console.log('-'.repeat(80));

  sorted.slice(0, 10).forEach((w: any) => {
    const pnlStr = w.realized_pnl_usd >= 0
      ? `+$${w.realized_pnl_usd.toFixed(0).padStart(9)}`
      : `-$${Math.abs(w.realized_pnl_usd).toFixed(0).padStart(9)}`;
    console.log(
      `${w.wallet} | ${w.omega.toFixed(2).padStart(8)} | ${pnlStr} | ${w.total_trades.toString().padStart(5)}`
    );
  });

  // Export to CSV
  const csvPath = 'tmp/cohort_pnl_recalculated.csv';
  if (!fs.existsSync('tmp')) {
    fs.mkdirSync('tmp', { recursive: true });
  }

  const enriched = rows.map((r: any) => ({
    ...r,
    polymarket_url: `https://polymarket.com/profile/${r.wallet}`,
  }));

  const headers = Object.keys(enriched[0] || {}).join(',');
  const csvRows = enriched.map((r: any) =>
    Object.values(r)
      .map((v) => {
        if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
          return `"${(v as string).replace(/"/g, '""')}"`;
        }
        return v;
      })
      .join(',')
  );
  fs.writeFileSync(csvPath, [headers, ...csvRows].join('\n'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Exported to ${csvPath}`);
  console.log(`   ${enriched.length.toLocaleString()} wallets, ${elapsed}s total`);
}

main().catch(console.error);
