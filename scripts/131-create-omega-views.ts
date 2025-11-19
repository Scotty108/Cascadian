#!/usr/bin/env tsx
/**
 * Create Omega Metric Views
 *
 * Creates two views:
 * 1. pm_wallet_market_omega - Per wallet per market Omega stats
 * 2. pm_wallet_omega_stats - Aggregated wallet-level Omega ratios
 *
 * Omega Ratio = Sum(Positive Returns) / Abs(Sum(Negative Returns))
 * Higher is better. Omega > 1 means positive expected value.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🎯 Creating Omega Metric Views');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Create market-level Omega view
  console.log('Step 1: Creating pm_wallet_market_omega (per wallet per market)...');
  console.log('');

  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_wallet_market_omega'
  });

  await clickhouse.command({
    query: `
      CREATE VIEW pm_wallet_market_omega AS
      SELECT
        wallet_address,
        condition_id,
        question,

        -- Outcome Stats
        COUNT(DISTINCT outcome_index) as outcomes_traded,
        SUM(total_trades) as total_trades,
        SUM(gross_notional) as total_volume,
        SUM(fees_paid) as total_fees,

        -- P&L Components
        SUM(pnl_net) as market_pnl_net,
        SUM(pnl_gross) as market_pnl_gross,
        SUM(CASE WHEN pnl_net > 0 THEN pnl_net ELSE 0 END) as positive_returns,
        ABS(SUM(CASE WHEN pnl_net < 0 THEN pnl_net ELSE 0 END)) as negative_returns,

        -- Omega Ratio (market level)
        CASE
          WHEN ABS(SUM(CASE WHEN pnl_net < 0 THEN pnl_net ELSE 0 END)) > 0
            THEN SUM(CASE WHEN pnl_net > 0 THEN pnl_net ELSE 0 END) /
                 ABS(SUM(CASE WHEN pnl_net < 0 THEN pnl_net ELSE 0 END))
          WHEN SUM(CASE WHEN pnl_net > 0 THEN pnl_net ELSE 0 END) > 0
            THEN 999.0  -- Infinite Omega (all wins, no losses)
          ELSE 0.0      -- No positive returns
        END as omega_ratio,

        -- Additional Metrics
        MIN(first_trade_ts) as first_trade,
        MAX(last_trade_ts) as last_trade,
        groupArray(DISTINCT data_sources) as data_sources,
        market_type,
        status,
        resolved_at

      FROM pm_wallet_market_pnl_resolved
      WHERE status = 'resolved'
        AND market_type = 'binary'
      GROUP BY
        wallet_address,
        condition_id,
        question,
        market_type,
        status,
        resolved_at
    `
  });

  console.log('✅ pm_wallet_market_omega created');
  console.log('');

  // Step 2: Create wallet-level Omega view
  console.log('Step 2: Creating pm_wallet_omega_stats (aggregated wallet level)...');
  console.log('');

  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_wallet_omega_stats'
  });

  await clickhouse.command({
    query: `
      CREATE VIEW pm_wallet_omega_stats AS
      WITH wallet_aggregates AS (
        SELECT
          wallet_address,
          COUNT(DISTINCT condition_id) as markets,
          SUM(total_trades) as trades,
          SUM(total_volume) as volume,
          SUM(total_fees) as fees,
          SUM(market_pnl_net) as pnl_net,
          SUM(market_pnl_gross) as pnl_gross,
          SUM(positive_returns) as pos_returns,
          SUM(negative_returns) as neg_returns,
          COUNT(CASE WHEN market_pnl_net > 0 THEN 1 END) as wins,
          stddevPop(market_pnl_net) as pnl_stddev,
          COUNT(CASE
            WHEN arrayExists(arr -> arrayExists(x -> x = 'polymarket_data_api', arr), data_sources)
            THEN 1
          END) as external_markets,
          MIN(first_trade) as first_trade,
          MAX(last_trade) as last_trade
        FROM pm_wallet_market_omega
        GROUP BY wallet_address
      )
      SELECT
        wallet_address,
        markets as markets_traded,
        trades as total_trades,
        ROUND(volume, 2) as total_volume,
        ROUND(fees, 2) as total_fees,
        ROUND(pnl_net, 2) as total_pnl_net,
        ROUND(pnl_gross, 2) as total_pnl_gross,
        ROUND(pos_returns, 2) as total_positive_returns,
        ROUND(neg_returns, 2) as total_negative_returns,
        ROUND(
          CASE
            WHEN neg_returns > 0 THEN pos_returns / neg_returns
            WHEN pos_returns > 0 THEN 999.0
            ELSE 0.0
          END,
          2
        ) as omega_ratio,
        ROUND(wins * 100.0 / markets, 2) as win_rate,
        ROUND(pnl_net / markets, 2) as avg_pnl_per_market,
        ROUND(
          CASE
            WHEN volume > 0 THEN (pnl_net / volume) * 100.0
            ELSE 0.0
          END,
          2
        ) as roi_pct,
        ROUND(
          pnl_net / (SQRT(markets) * pnl_stddev + 0.01),
          2
        ) as sharpe_approx,
        ROUND(external_markets * 100.0 / markets, 2) as external_market_pct,
        first_trade as first_trade_ts,
        last_trade as last_trade_ts,
        dateDiff('day', first_trade, last_trade) as days_active
      FROM wallet_aggregates
    `
  });

  console.log('✅ pm_wallet_omega_stats created');
  console.log('');

  // Step 3: Test queries
  console.log('Step 3: Testing views...');
  console.log('');

  // Test market-level view
  const marketTest = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_market_positions,
        COUNT(DISTINCT wallet_address) as distinct_wallets,
        COUNT(DISTINCT condition_id) as distinct_markets
      FROM pm_wallet_market_omega
    `,
    format: 'JSONEachRow'
  });

  const marketStats = await marketTest.json();
  console.log('pm_wallet_market_omega stats:');
  console.table(marketStats);
  console.log('');

  // Test wallet-level view
  const walletTest = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_wallets,
        ROUND(AVG(omega_ratio), 2) as avg_omega,
        ROUND(AVG(win_rate), 2) as avg_win_rate,
        ROUND(SUM(total_pnl_net), 2) as total_pnl,
        COUNT(CASE WHEN omega_ratio > 1 THEN 1 END) as wallets_omega_gt_1
      FROM pm_wallet_omega_stats
    `,
    format: 'JSONEachRow'
  });

  const walletStats = await walletTest.json();
  console.log('pm_wallet_omega_stats stats:');
  console.table(walletStats);
  console.log('');

  // Show top Omega wallets
  console.log('Top 10 Wallets by Omega Ratio:');
  console.log('');

  const topOmega = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        markets_traded,
        total_pnl_net,
        total_volume,
        omega_ratio,
        win_rate,
        roi_pct
      FROM pm_wallet_omega_stats
      WHERE markets_traded >= 5  -- Minimum 5 markets for statistical significance
        AND total_volume >= 1000   -- Minimum $1k volume
      ORDER BY omega_ratio DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const topWallets = await topOmega.json();
  console.table(topWallets.map((w: any) => ({
    wallet: w.wallet_address.substring(0, 12) + '...',
    markets: w.markets_traded,
    pnl: `$${parseFloat(w.total_pnl_net).toLocaleString()}`,
    volume: `$${parseFloat(w.total_volume).toLocaleString()}`,
    omega: parseFloat(w.omega_ratio).toFixed(2),
    win_rate: `${w.win_rate}%`,
    roi: `${w.roi_pct}%`
  })));

  console.log('');
  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ Omega views created successfully');
  console.log('');
  console.log('Views:');
  console.log('  1. pm_wallet_market_omega - Per wallet per market Omega stats');
  console.log('  2. pm_wallet_omega_stats - Aggregated wallet-level Omega ratios');
  console.log('');
  console.log('Key Metrics:');
  console.log('  - omega_ratio: Positive returns / Negative returns (higher is better)');
  console.log('  - win_rate: % of markets with positive P&L');
  console.log('  - roi_pct: Return on investment as %');
  console.log('  - sharpe_approx: Simplified Sharpe ratio');
  console.log('  - external_market_pct: % of markets with external trades');
  console.log('');
  console.log('Usage:');
  console.log('  SELECT * FROM pm_wallet_omega_stats WHERE omega_ratio > 2 ORDER BY total_pnl_net DESC');
  console.log('');
}

main().catch((error) => {
  console.error('❌ View creation failed:', error);
  process.exit(1);
});
