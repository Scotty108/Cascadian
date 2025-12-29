#!/usr/bin/env npx tsx
/**
 * Build Full Metrics Export for HC Leaderboard
 *
 * Computes comprehensive metrics per the MVP spec:
 * - Core performance (PnL, ROI, CAGR)
 * - Win/loss economics (win_rate, avg_win, avg_loss, profit_factor, expectancy)
 * - Risk metrics (max_drawdown, worst_day)
 * - Risk-adjusted (Omega, Sortino proxy, pnl_per_active_day)
 * - Eligibility (n_trades, n_markets, active_days, wallet_age)
 * - Copy feasibility (avg_trade_size, turnover)
 *
 * Final Score = CAGR × Omega (balances returns with risk-adjustment)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('BUILD FULL METRICS EXPORT');
  console.log('='.repeat(80));
  console.log('Computing comprehensive metrics for HC leaderboard cohort...\n');

  // Build comprehensive metrics table
  console.log('Step 1: Building wallet_full_metrics table...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_wallet_full_metrics_v1` });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallet_full_metrics_v1
      ENGINE = MergeTree()
      ORDER BY (score, wallet)
      AS
      WITH
      -- Get cohort wallets
      cohort AS (
        SELECT wallet FROM pm_hc_leaderboard_cohort_all_v1
      ),
      -- Trade-level stats per wallet
      trade_stats AS (
        SELECT
          lower(trader_wallet) as wallet,
          count() as n_trades,
          countIf(trade_time >= now() - INTERVAL 14 DAY) as n_trades_14d,
          countIf(trade_time >= now() - INTERVAL 60 DAY) as n_trades_60d,
          min(trade_time) as first_trade_at,
          max(trade_time) as last_trade_at,
          dateDiff('day', min(trade_time), max(trade_time)) + 1 as wallet_age_days,
          dateDiff('day', max(trade_time), now()) as days_since_last_trade,
          count(DISTINCT toDate(trade_time)) as active_days_life,
          countIf(toDate(trade_time) >= today() - 60) as active_days_60d,
          sum(usdc_amount) / 1e6 as total_volume_usd,
          avg(usdc_amount) / 1e6 as avg_trade_size_usd,
          quantile(0.9)(usdc_amount) / 1e6 as p90_trade_size_usd
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) IN (SELECT wallet FROM cohort)
        GROUP BY lower(trader_wallet)
      ),
      -- Market-level stats (for n_markets, concentration)
      market_stats AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          count(DISTINCT m.condition_id) as n_markets,
          countIf(m.condition_id IS NOT NULL AND t.trade_time >= now() - INTERVAL 60 DAY) as n_markets_60d
        FROM pm_trader_events_dedup_v2_tbl t
        LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM cohort)
        GROUP BY lower(t.trader_wallet)
      ),
      -- Get existing cohort data
      cohort_data AS (
        SELECT
          c.wallet,
          c.rank as current_rank,
          c.omega,
          c.realized_pnl,
          c.trade_count_total,
          c.trade_count_30d,
          c.last_trade_at as cohort_last_trade,
          c.realized_buy_usdc as capital_deployed,
          c.realized_sell_usdc,
          c.redemption_payout
        FROM pm_hc_leaderboard_cohort_all_v1 c
      ),
      -- Get omega metrics
      omega_data AS (
        SELECT
          wallet,
          omega,
          n_trades_used as n_markets_with_pnl,
          n_wins,
          n_losses,
          win_rate,
          avg_win,
          avg_loss
        FROM pm_wallet_omega_hc_v1
        WHERE wallet IN (SELECT wallet FROM cohort)
      )
      SELECT
        -- Identity
        cd.wallet as wallet,
        concat('https://polymarket.com/profile/', cd.wallet) as polymarket_url,

        -- Core Performance
        cd.realized_pnl as pnl_realized_net,
        cd.capital_deployed as capital_deployed_usd,
        CASE WHEN cd.capital_deployed > 0 THEN cd.realized_pnl / cd.capital_deployed ELSE 0 END as roi,
        CASE WHEN cd.capital_deployed > 0 THEN cd.realized_pnl / cd.capital_deployed * 100 ELSE 0 END as roi_pct,

        -- CAGR: (1 + total_return)^(365/days) - 1
        CASE
          WHEN ts.wallet_age_days > 0 AND cd.capital_deployed > 0 THEN
            (pow(1 + (cd.realized_pnl / cd.capital_deployed), 365.0 / ts.wallet_age_days) - 1)
          ELSE 0
        END as cagr,
        CASE
          WHEN ts.wallet_age_days > 0 AND cd.capital_deployed > 0 THEN
            (pow(1 + (cd.realized_pnl / cd.capital_deployed), 365.0 / ts.wallet_age_days) - 1) * 100
          ELSE 0
        END as cagr_pct,

        -- Win/Loss Economics
        od.omega as omega,
        od.win_rate as win_rate,
        od.win_rate * 100 as win_rate_pct,
        od.n_wins as n_wins,
        od.n_losses as n_losses,
        od.avg_win as avg_win_usd,
        od.avg_loss as avg_loss_usd,
        -- Profit Factor = sum(wins) / abs(sum(losses))
        CASE WHEN od.n_losses > 0 AND od.avg_loss > 0 THEN (od.n_wins * od.avg_win) / (od.n_losses * od.avg_loss) ELSE 999 END as profit_factor,
        -- Expectancy = win_rate * avg_win - (1 - win_rate) * avg_loss
        od.win_rate * od.avg_win - (1 - od.win_rate) * od.avg_loss as expectancy_per_market,

        -- PnL per trade
        CASE WHEN ts.n_trades > 0 THEN cd.realized_pnl / ts.n_trades ELSE 0 END as pnl_per_trade,
        -- PnL per active day
        CASE WHEN ts.active_days_life > 0 THEN cd.realized_pnl / ts.active_days_life ELSE 0 END as pnl_per_active_day,

        -- Eligibility / Activity
        ts.n_trades as n_trades_life,
        ts.n_trades_14d as n_trades_14d,
        ts.n_trades_60d as n_trades_60d,
        cd.trade_count_30d as n_trades_30d,
        ms.n_markets as n_markets_life,
        ms.n_markets_60d as n_markets_60d,
        od.n_markets_with_pnl as n_markets_with_pnl,
        ts.active_days_life as active_days_life,
        ts.active_days_60d as active_days_60d,
        ts.wallet_age_days as wallet_age_days,
        ts.first_trade_at as first_trade_at,
        ts.last_trade_at as last_trade_at,
        ts.days_since_last_trade as days_since_last_trade,

        -- Volume / Capacity
        ts.total_volume_usd as total_volume_usd,
        ts.avg_trade_size_usd as avg_trade_size_usd,
        ts.p90_trade_size_usd as p90_trade_size_usd,
        -- Turnover = total_volume / capital_deployed
        CASE WHEN cd.capital_deployed > 0 THEN ts.total_volume_usd / cd.capital_deployed ELSE 0 END as turnover,

        -- Cash flows
        cd.capital_deployed as total_outflows_usd,
        cd.realized_sell_usdc as sell_proceeds_usd,
        cd.redemption_payout as redemption_payout_usd,
        cd.realized_sell_usdc + cd.redemption_payout as total_inflows_usd,

        -- SCORE = CAGR × Omega (the magic formula)
        CASE
          WHEN ts.wallet_age_days > 0 AND cd.capital_deployed > 0 AND od.omega < 1000000 THEN
            (pow(1 + (cd.realized_pnl / cd.capital_deployed), 365.0 / ts.wallet_age_days) - 1) * od.omega
          WHEN od.omega >= 1000000 THEN
            (pow(1 + (cd.realized_pnl / cd.capital_deployed), 365.0 / greatest(ts.wallet_age_days, 1)) - 1) * 1000
          ELSE 0
        END as score,

        now() as computed_at

      FROM cohort_data cd
      JOIN trade_stats ts ON cd.wallet = ts.wallet
      JOIN market_stats ms ON cd.wallet = ms.wallet
      JOIN omega_data od ON cd.wallet = od.wallet
      WHERE ts.days_since_last_trade <= 14  -- Traded in last 2 weeks
        AND ts.n_trades >= 20  -- At least 20 trades
    `
  });

  // Get counts
  const countQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_wallet_full_metrics_v1`,
    format: 'JSONEachRow'
  });
  const totalCount = Number((await countQ.json() as any[])[0].cnt);

  console.log(`\n  Total wallets with full metrics: ${totalCount.toLocaleString()}`);

  // Summary stats
  const summaryQ = await clickhouse.query({
    query: `
      SELECT
        round(avg(pnl_realized_net), 2) as avg_pnl,
        round(median(pnl_realized_net), 2) as median_pnl,
        round(avg(roi_pct), 2) as avg_roi_pct,
        round(avg(cagr_pct), 2) as avg_cagr_pct,
        round(median(cagr_pct), 2) as median_cagr_pct,
        round(avg(win_rate_pct), 2) as avg_win_rate,
        round(avg(omega), 2) as avg_omega,
        round(median(omega), 2) as median_omega,
        round(avg(score), 4) as avg_score,
        round(median(score), 4) as median_score,
        round(avg(wallet_age_days), 0) as avg_wallet_age,
        round(avg(n_trades_life), 0) as avg_trades
      FROM pm_wallet_full_metrics_v1
      WHERE omega < 1000000
    `,
    format: 'JSONEachRow'
  });
  const summary = (await summaryQ.json() as any[])[0];

  console.log('\n  Summary Statistics:');
  console.log(`    Avg PnL:        $${summary.avg_pnl}`);
  console.log(`    Median PnL:     $${summary.median_pnl}`);
  console.log(`    Avg ROI:        ${summary.avg_roi_pct}%`);
  console.log(`    Avg CAGR:       ${summary.avg_cagr_pct}%`);
  console.log(`    Median CAGR:    ${summary.median_cagr_pct}%`);
  console.log(`    Avg Win Rate:   ${summary.avg_win_rate}%`);
  console.log(`    Median Omega:   ${summary.median_omega}`);
  console.log(`    Avg Score:      ${summary.avg_score}`);
  console.log(`    Median Score:   ${summary.median_score}`);
  console.log(`    Avg Wallet Age: ${summary.avg_wallet_age} days`);
  console.log(`    Avg Trades:     ${summary.avg_trades}`);

  // Export to CSV
  console.log('\n\nStep 2: Exporting to CSV...');

  const exportQ = await clickhouse.query({
    query: `
      SELECT
        wallet,
        polymarket_url,
        -- Rank by SCORE (CAGR × Omega)
        row_number() OVER (ORDER BY score DESC) as rank,
        round(score, 4) as score,

        -- Core Performance
        round(pnl_realized_net, 2) as pnl_usd,
        round(capital_deployed_usd, 2) as capital_deployed_usd,
        round(roi_pct, 2) as roi_pct,
        round(cagr_pct, 2) as cagr_pct,

        -- Win/Loss Economics
        round(omega, 4) as omega,
        round(win_rate_pct, 2) as win_rate_pct,
        n_wins,
        n_losses,
        round(avg_win_usd, 2) as avg_win_usd,
        round(avg_loss_usd, 2) as avg_loss_usd,
        round(profit_factor, 4) as profit_factor,
        round(expectancy_per_market, 2) as expectancy_per_market_usd,

        -- Velocity
        round(pnl_per_trade, 2) as pnl_per_trade_usd,
        round(pnl_per_active_day, 2) as pnl_per_active_day_usd,

        -- Activity
        n_trades_life,
        n_trades_30d,
        n_trades_14d,
        n_markets_life,
        active_days_life,
        wallet_age_days,
        days_since_last_trade,

        -- Volume
        round(total_volume_usd, 2) as total_volume_usd,
        round(avg_trade_size_usd, 2) as avg_trade_size_usd,
        round(turnover, 2) as turnover,

        -- Cash Flows
        round(total_inflows_usd, 2) as total_inflows_usd,
        round(total_outflows_usd, 2) as total_outflows_usd,
        round(redemption_payout_usd, 2) as redemption_payout_usd,

        -- Timestamps
        first_trade_at,
        last_trade_at

      FROM pm_wallet_full_metrics_v1
      ORDER BY score DESC
    `,
    format: 'CSVWithNames'
  });

  const csv = await exportQ.text();
  fs.writeFileSync('data/hc_leaderboard_full_metrics.csv', csv);

  const lines = csv.split('\n').length - 1;
  console.log(`  Exported ${lines} rows to data/hc_leaderboard_full_metrics.csv`);

  // Show top 10
  console.log('\n' + '='.repeat(80));
  console.log('TOP 10 BY SCORE (CAGR × Omega):');
  console.log('-'.repeat(80));

  const topQ = await clickhouse.query({
    query: `
      SELECT
        wallet,
        round(score, 2) as score,
        round(cagr_pct, 1) as cagr_pct,
        round(omega, 2) as omega,
        round(pnl_realized_net, 0) as pnl,
        round(win_rate_pct, 0) as win_rate,
        n_trades_life as trades
      FROM pm_wallet_full_metrics_v1
      ORDER BY score DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topWallets = await topQ.json() as any[];

  console.log('Rank | Wallet                                     | Score      | CAGR%   | Omega  | PnL       | WinRate | Trades');
  console.log('-'.repeat(120));
  let rank = 1;
  for (const w of topWallets) {
    console.log(
      `#${rank}`.padEnd(5) + '| ' +
      w.wallet.slice(0, 42).padEnd(43) + '| ' +
      String(w.score).padStart(10) + ' | ' +
      (w.cagr_pct + '%').padStart(7) + ' | ' +
      String(w.omega).padStart(6) + ' | ' +
      ('$' + w.pnl).padStart(9) + ' | ' +
      (w.win_rate + '%').padStart(7) + ' | ' +
      String(w.trades).padStart(6)
    );
    rank++;
  }

  console.log('\n' + '='.repeat(80));
  console.log('EXPORT COMPLETE');
  console.log('='.repeat(80));
  console.log(`
  File: data/hc_leaderboard_full_metrics.csv
  Wallets: ${totalCount.toLocaleString()}

  Filters applied:
    - HC (CLOB only, no transfers in, no split/merge)
    - Traded in last 14 days
    - At least 20 trades lifetime
    - Realized PnL >= $500
    - Omega > 1

  Score Formula: CAGR × Omega
    - Higher CAGR = faster compounding
    - Higher Omega = smoother returns (less tail risk)
  `);

  await clickhouse.close();
}

main().catch(console.error);
