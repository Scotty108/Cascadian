#!/usr/bin/env npx tsx
/**
 * Recalculate PnL for Active Cohort (Last 2 Weeks)
 *
 * Uses fresh pm_token_to_condition_map_v5 to calculate accurate PnL.
 * Filters: Trades > 20, Active in last 14 days
 *
 * Exports to: tmp/cohort_pnl_recalculated.csv
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('='.repeat(80));
  console.log('RECALCULATE PNL FOR ACTIVE COHORT');
  console.log('='.repeat(80));
  console.log('Using fresh V5 token map (100% coverage for last 14 days)\n');

  const startTime = Date.now();

  // This query calculates PnL from scratch using V5 map
  const query = `
    WITH
      -- Step 1: Get all CLOB trades with V5 mapping (deduplicated)
      trades_mapped AS (
        SELECT
          te.trader_wallet,
          m.condition_id,
          m.outcome_index,
          te.side,
          te.usdc_amount / 1000000.0 AS usdc,
          te.token_amount / 1000000.0 AS tokens,
          te.trade_time
        FROM (
          SELECT
            event_id,
            any(trader_wallet) AS trader_wallet,
            any(side) AS side,
            any(usdc_amount) AS usdc_amount,
            any(token_amount) AS token_amount,
            any(token_id) AS token_id,
            any(trade_time) AS trade_time
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY event_id
        ) te
        INNER JOIN pm_token_to_condition_map_v5 m ON te.token_id = m.token_id_dec
      ),

      -- Step 2: Aggregate by wallet/condition/outcome
      positions AS (
        SELECT
          trader_wallet,
          condition_id,
          outcome_index,
          -- Cash flow: buy = negative (spend), sell = positive (receive)
          sum(if(side = 'buy', -usdc, usdc)) AS cash_flow,
          -- Share position: buy = positive, sell = negative
          sum(if(side = 'buy', tokens, -tokens)) AS shares,
          count(*) AS trades,
          min(trade_time) AS first_trade,
          max(trade_time) AS last_trade
        FROM trades_mapped
        GROUP BY trader_wallet, condition_id, outcome_index
      ),

      -- Step 3: Join with resolutions
      with_resolution AS (
        SELECT
          p.*,
          r.payout_numerators,
          -- Extract resolution price (0 or 1) based on outcome_index
          CASE
            WHEN r.payout_numerators IS NULL THEN NULL
            WHEN JSONExtractInt(r.payout_numerators, p.outcome_index + 1) >= 1000 THEN 1.0
            ELSE toFloat64(JSONExtractInt(r.payout_numerators, p.outcome_index + 1))
          END AS resolution_price
        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
      ),

      -- Step 4: Calculate realized PnL per position
      position_pnl AS (
        SELECT
          trader_wallet,
          condition_id,
          outcome_index,
          cash_flow,
          shares,
          resolution_price,
          trades,
          first_trade,
          last_trade,
          -- PnL = cash_flow + (shares * resolution_price)
          -- Unresolved markets: resolution_price = 0 (conservative)
          cash_flow + (shares * coalesce(resolution_price, 0)) AS realized_pnl,
          resolution_price IS NOT NULL AS is_resolved
        FROM with_resolution
      ),

      -- Step 5: Aggregate to wallet level
      wallet_pnl AS (
        SELECT
          trader_wallet,
          sum(realized_pnl) AS total_pnl,
          sumIf(realized_pnl, realized_pnl > 0) AS sum_gains,
          abs(sumIf(realized_pnl, realized_pnl < 0)) AS sum_losses,
          sum(trades) AS total_trades,
          countDistinct(condition_id) AS markets_traded,
          countIf(is_resolved) AS resolved_positions,
          count(*) AS total_positions,
          min(first_trade) AS first_trade,
          max(last_trade) AS last_trade
        FROM position_pnl
        GROUP BY trader_wallet
      )

    -- Final: Filter to active cohort and add metrics
    SELECT
      trader_wallet AS wallet,
      total_pnl AS realized_pnl_usd,
      sum_gains,
      sum_losses,
      if(sum_losses > 0, sum_gains / sum_losses, if(sum_gains > 0, 999, 0)) AS omega,
      total_trades,
      markets_traded,
      resolved_positions,
      total_positions,
      first_trade,
      last_trade,
      dateDiff('day', first_trade, last_trade) AS trading_days,
      -- Win rate (approximate: markets where PnL > 0)
      resolved_positions AS resolved_markets,
      -- ROI
      if(sum_losses > 0, total_pnl / sum_losses, 0) AS roi_vs_losses,
      concat('https://polymarket.com/profile/', trader_wallet) AS polymarket_url
    FROM wallet_pnl
    WHERE
      total_trades >= 20
      AND last_trade >= now() - INTERVAL 14 DAY
    ORDER BY omega DESC, total_pnl DESC
  `;

  console.log('Running PnL calculation query...');
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log(`Found ${rows.length.toLocaleString()} wallets in cohort\n`);

  // Summary stats
  const profitable = rows.filter((r) => r.realized_pnl_usd > 0);
  const highOmega = rows.filter((r) => r.omega > 1 && r.omega < 999);
  const totalPnl = rows.reduce((s, r) => s + r.realized_pnl_usd, 0);
  const avgOmega = highOmega.length > 0
    ? highOmega.reduce((s, r) => s + r.omega, 0) / highOmega.length
    : 0;

  console.log('='.repeat(80));
  console.log('COHORT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets:      ${rows.length.toLocaleString()}`);
  console.log(`Profitable:         ${profitable.length.toLocaleString()} (${((profitable.length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Omega > 1:          ${highOmega.length.toLocaleString()}`);
  console.log(`Combined PnL:       $${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Average Omega:      ${avgOmega.toFixed(2)}`);

  // Top 10 by Omega
  console.log('\n' + '='.repeat(80));
  console.log('TOP 10 BY OMEGA (with Omega > 1)');
  console.log('='.repeat(80));
  console.log('Wallet                                     | Omega    | PnL          | Trades');
  console.log('-'.repeat(80));

  highOmega.slice(0, 10).forEach((w) => {
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

  const headers = Object.keys(rows[0] || {}).join(',');
  const csvRows = rows.map((r) =>
    Object.values(r)
      .map((v) => {
        if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      })
      .join(',')
  );
  fs.writeFileSync(csvPath, [headers, ...csvRows].join('\n'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Exported to ${csvPath}`);
  console.log(`   ${rows.length.toLocaleString()} wallets, ${elapsed}s`);
}

main().catch(console.error);
