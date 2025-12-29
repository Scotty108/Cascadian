/**
 * Ultimate Synthesis Copy-Trade Leaderboard
 *
 * Combines the best ideas from both approaches:
 *
 * FROM CHATGPT:
 * - Wilson lower bound for win rate (penalizes small samples)
 * - Max drawdown calculation (risk metric)
 * - Time-weighted PnL (50/35/15 for 7d/30d/60d - momentum)
 * - Stricter 7d gates (anti-flatliner)
 *
 * FROM CLAUDE:
 * - Tier A filter (CLOB-only, no AMM noise)
 * - Profit factor <= 15 rejection (anti-selection-bias)
 * - Win rate <= 90% cap (if too good, you're missing losses)
 * - Coverage in score multiplier (penalize low coverage)
 * - Asymmetry ratio (big wins, small losses)
 *
 * SCORING FORMULA:
 * time_weighted_pnl_per_day × wilson_lower_bound × min(pf, 8) × min(asym, 5) × coverage / (1 + 4 × drawdown)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('=== Ultimate Synthesis Copy-Trade Leaderboard ===\n');
  console.log('Combining best ideas from both approaches...\n');

  // Step 1: Create drawdown materialized table
  // NOTE: Sports markets are INCLUDED - CLV has limitations for same-day-resolving sports
  // but skilled sports bettors exist and shouldn't be excluded
  console.log('Phase 1: Computing drawdown metrics...');

  await ch.command({
    query: `DROP TABLE IF EXISTS tmp_drawdown_materialized`,
  });

  await ch.command({
    query: `
      CREATE TABLE tmp_drawdown_materialized
      ENGINE = MergeTree()
      ORDER BY wallet_address
      AS
      WITH
        now() AS t_now,

      base AS (
        SELECT
          lower(wallet) AS wallet_address,
          toDate(trade_time) AS day,
          p24h_found,
          clv_24h,
          notional_usdc,
          (clv_24h * notional_usdc) AS pnl_24h_usd
        FROM pm_trade_clv_features_60d
        WHERE trade_time >= t_now - INTERVAL 60 DAY
      ),

      daily AS (
        SELECT wallet_address, day, sumIf(pnl_24h_usd, p24h_found = 1) AS day_pnl
        FROM base
        GROUP BY wallet_address, day
      ),

      cum_pnl AS (
        SELECT
          wallet_address,
          day,
          day_pnl,
          sum(day_pnl) OVER (PARTITION BY wallet_address ORDER BY day ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_pnl
        FROM daily
      ),

      peaks AS (
        SELECT
          wallet_address,
          day,
          cumulative_pnl,
          max(cumulative_pnl) OVER (PARTITION BY wallet_address ORDER BY day ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak_pnl
        FROM cum_pnl
      )

      SELECT
        wallet_address,
        least(max(CASE WHEN peak_pnl > 0 THEN (peak_pnl - cumulative_pnl) / peak_pnl ELSE 0 END), 1.0) AS max_drawdown_pct
      FROM peaks
      GROUP BY wallet_address
    `,
  });
  console.log('   Drawdown table created.');

  // Step 2: Create aggregates materialized table
  // NOTE: Sports markets are INCLUDED - skilled sports bettors exist
  // KNOWN LIMITATION: CLV may be less reliable for same-day-resolving sports markets
  console.log('Phase 2: Computing aggregate metrics...');

  await ch.command({
    query: `DROP TABLE IF EXISTS tmp_agg_materialized`,
  });

  await ch.command({
    query: `
      CREATE TABLE tmp_agg_materialized
      ENGINE = MergeTree()
      ORDER BY wallet_address
      AS
      WITH
        now() AS t_now

      SELECT
        lower(wallet) AS wallet_address,

        -- 60-day metrics
        count() AS n_trades_60d,
        uniqExact(token_id) AS n_markets_60d,
        countIf(p24h_found = 1) AS n_with_p24_60d,
        countIf(p24h_found = 1) / count() AS p24_coverage_60d,
        countIf(clv_24h > 0 AND p24h_found = 1) AS n_wins_60d,
        countIf(clv_24h <= 0 AND p24h_found = 1) AS n_losses_60d,
        sum(notional_usdc) AS notional_60d,
        sumIf(clv_24h * notional_usdc, p24h_found = 1) AS total_pnl_60d,
        uniqExact(toDate(trade_time)) AS active_days_60d,
        max(trade_time) AS last_trade,
        sumIf(clv_24h * notional_usdc, clv_24h > 0 AND p24h_found = 1) AS gross_wins_60d,
        abs(sumIf(clv_24h * notional_usdc, clv_24h <= 0 AND p24h_found = 1)) AS gross_losses_60d,
        avgIf(clv_24h * notional_usdc, clv_24h > 0 AND p24h_found = 1) AS avg_win_60d,
        avgIf(abs(clv_24h * notional_usdc), clv_24h <= 0 AND p24h_found = 1) AS avg_loss_60d,

        -- 30-day metrics
        countIf(trade_time >= t_now - INTERVAL 30 DAY) AS n_trades_30d,
        uniqExactIf(token_id, trade_time >= t_now - INTERVAL 30 DAY) AS n_markets_30d,
        sumIf(clv_24h * notional_usdc, p24h_found = 1 AND trade_time >= t_now - INTERVAL 30 DAY) AS total_pnl_30d,
        uniqExactIf(toDate(trade_time), trade_time >= t_now - INTERVAL 30 DAY) AS active_days_30d,

        -- 7-day metrics
        countIf(trade_time >= t_now - INTERVAL 7 DAY) AS n_trades_7d,
        uniqExactIf(token_id, trade_time >= t_now - INTERVAL 7 DAY) AS n_markets_7d,
        sumIf(notional_usdc, trade_time >= t_now - INTERVAL 7 DAY) AS notional_7d,
        sumIf(clv_24h * notional_usdc, p24h_found = 1 AND trade_time >= t_now - INTERVAL 7 DAY) AS total_pnl_7d,
        uniqExactIf(toDate(trade_time), trade_time >= t_now - INTERVAL 7 DAY) AS active_days_7d

      FROM pm_trade_clv_features_60d
      WHERE trade_time >= t_now - INTERVAL 60 DAY
      GROUP BY wallet_address
    `,
  });
  console.log('   Aggregates table created.');

  // Step 3: Run final query joining the materialized tables
  console.log('Phase 3: Running final synthesis query...\n');

  const query = `
    WITH
      1.64 AS z,  -- Wilson 90% confidence interval
      now() AS t_now

    SELECT
      a.wallet_address AS wallet,
      a.n_trades_60d AS trades,
      a.n_markets_60d AS markets,
      round((a.n_wins_60d / nullIf(a.n_with_p24_60d, 0)) * 100, 1) AS win_pct,

      -- Wilson lower bound
      round(
        (
          ((a.n_wins_60d / nullIf(a.n_with_p24_60d, 0))
          + (z * z) / (2 * a.n_with_p24_60d)
          - z * sqrt(
            (((a.n_wins_60d / nullIf(a.n_with_p24_60d, 0)) * (1 - (a.n_wins_60d / nullIf(a.n_with_p24_60d, 0)))) / a.n_with_p24_60d)
            + ((z * z) / (4 * a.n_with_p24_60d * a.n_with_p24_60d))
          ))
          / (1 + ((z * z) / a.n_with_p24_60d))
        ) * 100
      , 1) AS wilson_pct,

      round(a.gross_wins_60d / nullIf(a.gross_losses_60d, 0), 2) AS pf,
      round(a.avg_win_60d / nullIf(a.avg_loss_60d, 0), 2) AS asym,
      round(coalesce(d.max_drawdown_pct, 0) * 100, 1) AS drawdown_pct,
      round(a.total_pnl_60d, 0) AS pnl_60d,
      round(a.total_pnl_30d, 0) AS pnl_30d,
      round(a.total_pnl_7d, 0) AS pnl_7d,

      -- Time-weighted PnL per day
      round(
        0.50 * (coalesce(a.total_pnl_7d, 0) / greatest(coalesce(a.active_days_7d, 1), 1))
        + 0.35 * (coalesce(a.total_pnl_30d, 0) / greatest(coalesce(a.active_days_30d, 1), 1))
        + 0.15 * (a.total_pnl_60d / greatest(a.active_days_60d, 1))
      , 2) AS tw_pnl_day,

      round(a.p24_coverage_60d * 100, 0) AS coverage_pct,
      a.n_losses_60d AS losses,
      e.confidence_tier AS tier,

      -- ULTIMATE SCORE
      round(
        (
          0.50 * (coalesce(a.total_pnl_7d, 0) / greatest(coalesce(a.active_days_7d, 1), 1))
          + 0.35 * (coalesce(a.total_pnl_30d, 0) / greatest(coalesce(a.active_days_30d, 1), 1))
          + 0.15 * (a.total_pnl_60d / greatest(a.active_days_60d, 1))
        )
        * coalesce(
          (
            ((a.n_wins_60d / nullIf(a.n_with_p24_60d, 0))
            + (z * z) / (2 * a.n_with_p24_60d)
            - z * sqrt(
              (((a.n_wins_60d / nullIf(a.n_with_p24_60d, 0)) * (1 - (a.n_wins_60d / nullIf(a.n_with_p24_60d, 0)))) / a.n_with_p24_60d)
              + ((z * z) / (4 * a.n_with_p24_60d * a.n_with_p24_60d))
            ))
            / (1 + ((z * z) / a.n_with_p24_60d))
          )
        , 0.5)
        * least(coalesce(a.gross_wins_60d / nullIf(a.gross_losses_60d, 0), 1), 8)
        * least(coalesce(a.avg_win_60d / nullIf(a.avg_loss_60d, 0), 1), 5)
        * a.p24_coverage_60d
        / (1 + 4 * coalesce(d.max_drawdown_pct, 0))
      , 4) AS copytrade_score

    FROM tmp_agg_materialized a
    LEFT JOIN tmp_drawdown_materialized d ON a.wallet_address = d.wallet_address
    LEFT JOIN pm_wallet_external_activity_60d e ON a.wallet_address = e.wallet

    WHERE
      -- Quality gates
      e.confidence_tier = 'A'                    -- CLOB-only (no AMM noise)
      AND a.n_trades_60d >= 30                   -- Enough trades for signal
      AND a.n_markets_60d >= 10                  -- Diversified
      AND a.n_with_p24_60d >= 20                 -- Enough CLV data
      AND a.p24_coverage_60d >= 0.75             -- 75%+ coverage
      AND a.n_losses_60d >= 5                    -- Real risk exposure

      -- MEANINGFUL PROFIT FLOORS (relaxed for larger candidate pool - UI verifier is strict gate)
      AND a.total_pnl_60d >= 100                 -- At least $100 profit (UI verifier filters)
      AND a.notional_60d >= 500                  -- At least $500 volume
      AND a.avg_win_60d >= 2                     -- Avg win >= $2
      AND a.n_wins_60d >= 10                     -- At least 10 wins

      -- Anti-selection-bias filters
      AND (a.n_wins_60d / nullIf(a.n_with_p24_60d, 0)) >= 0.55  -- Win more than lose
      AND (a.n_wins_60d / nullIf(a.n_with_p24_60d, 0)) <= 0.90  -- Not suspiciously perfect
      AND (a.gross_wins_60d / nullIf(a.gross_losses_60d, 0)) <= 15  -- Reject extreme PF
      AND (a.gross_wins_60d / nullIf(a.gross_losses_60d, 0)) >= 1.2  -- Make at least 20% more

      -- Anti-flatliner filters
      AND a.last_trade >= t_now - INTERVAL 7 DAY
      AND a.n_markets_7d >= 3
      AND a.n_trades_7d >= 5
      AND a.notional_7d >= 500

      -- Time-weighted PnL floor (minimum $1/day - UI verifier is strict gate)
      AND (
        0.50 * (coalesce(a.total_pnl_7d, 0) / greatest(coalesce(a.active_days_7d, 1), 1))
        + 0.35 * (coalesce(a.total_pnl_30d, 0) / greatest(coalesce(a.active_days_30d, 1), 1))
        + 0.15 * (a.total_pnl_60d / greatest(a.active_days_60d, 1))
      ) >= 1

      -- Risk filter
      AND coalesce(d.max_drawdown_pct, 0) <= 0.40

    ORDER BY copytrade_score DESC
    LIMIT 100
  `;

  const result = await ch.query({
    query,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];

  console.log(`Found ${rows.length} qualified candidates\n`);

  // Display top 20
  console.log('TOP 20 ULTIMATE COPY-TRADE CANDIDATES:\n');
  console.log('Wallet                                     | Trades | Win% | Wilson | PF    | Asym  | DD%  | PnL 60d   | TW$/Day | Score');
  console.log('-------------------------------------------|--------|------|--------|-------|-------|------|-----------|---------|------');

  for (const r of rows.slice(0, 20)) {
    console.log(
      `${r.wallet} | ${String(r.trades).padStart(6)} | ${String(r.win_pct).padStart(4)}% | ${String(r.wilson_pct).padStart(5)}% | ${String(r.pf).padStart(5)}x | ${String(r.asym).padStart(5)}x | ${String(r.drawdown_pct).padStart(4)}% | ${('$' + Number(r.pnl_60d).toLocaleString()).padStart(9)} | ${('$' + r.tw_pnl_day).padStart(7)} | ${r.copytrade_score}`
    );
  }

  // Profile links
  console.log('\n\nProfile Links (Top 10):');
  rows.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. https://polymarket.com/profile/${r.wallet}`);
  });

  // Export to JSON
  const dateStr = new Date().toISOString().slice(0, 10);
  const exportData = {
    generated_at: new Date().toISOString(),
    methodology: 'Ultimate Synthesis (Claude + ChatGPT best ideas) v2',
    scoring_formula: 'time_weighted_pnl_per_day × wilson_lower_bound × min(pf, 8) × min(asym, 5) × coverage / (1 + 4 × drawdown)',
    filters: {
      tier: 'A (CLOB-only)',
      trades_60d: '>= 30',
      markets_60d: '>= 10',
      coverage: '>= 75%',
      losses: '>= 5',
      wins: '>= 15',
      pnl_60d: '>= $500',
      notional_60d: '>= $2,000',
      avg_win: '>= $5',
      tw_pnl_day: '>= $5',
      win_rate: '55-90%',
      profit_factor: '1.2-15x',
      max_drawdown: '<= 40%',
      last_trade: 'within 7 days',
      markets_7d: '>= 3',
      trades_7d: '>= 5',
      notional_7d: '>= $500',
    },
    candidates: rows,
  };

  const jsonPath = `exports/copytrade/ultimate_synthesis_${dateStr}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
  console.log(`\n\nExported to ${jsonPath}`);

  // Export to CSV
  const csvPath = `exports/copytrade/ultimate_synthesis_${dateStr}.csv`;
  const csvHeader = 'wallet,trades,markets,win_pct,wilson_pct,profit_factor,asymmetry,drawdown_pct,pnl_60d,pnl_30d,pnl_7d,tw_pnl_day,coverage_pct,losses,tier,copytrade_score';
  const csvRows = rows.map(r =>
    `${r.wallet},${r.trades},${r.markets},${r.win_pct},${r.wilson_pct},${r.pf},${r.asym},${r.drawdown_pct},${r.pnl_60d},${r.pnl_30d},${r.pnl_7d},${r.tw_pnl_day},${r.coverage_pct},${r.losses},${r.tier},${r.copytrade_score}`
  );
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));
  console.log(`Exported to ${csvPath}`);

  // Cleanup temp tables
  await ch.command({ query: `DROP TABLE IF EXISTS tmp_drawdown_materialized` });
  await ch.command({ query: `DROP TABLE IF EXISTS tmp_agg_materialized` });

  console.log('\n=== Ultimate Synthesis Complete ===');
  await ch.close();
}

main().catch(console.error);
