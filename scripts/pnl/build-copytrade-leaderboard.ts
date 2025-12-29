/**
 * Build Copy-Trade Leaderboard
 *
 * Finds asymmetric super forecasters:
 * - Consistently profitable (win rate > 55%)
 * - Big wins, small losses (profit factor > 1.5)
 * - High profit per trade
 * - Fast to profit (short hold times)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function main() {
  console.log('=== Building Copy-Trade Leaderboard ===\n');

  // Create the view with asymmetric metrics
  console.log('1. Creating copy-trade metrics view...');
  await ch.command({
    query: `
      CREATE OR REPLACE VIEW pm_wallet_copytrade_candidates AS
      WITH trade_stats AS (
        SELECT
          wallet,
          count() as total_trades,
          uniqExact(token_id) as unique_markets,

          -- Win/loss counts (based on CLV direction)
          countIf(clv_24h > 0 AND p24h_found = 1) as wins,
          countIf(clv_24h <= 0 AND p24h_found = 1) as losses,
          countIf(p24h_found = 1) as resolved_trades,

          -- Win rate
          countIf(clv_24h > 0 AND p24h_found = 1) / nullIf(countIf(p24h_found = 1), 0) as win_rate,

          -- Average win size (in $ terms)
          avgIf(clv_24h * notional_usdc, clv_24h > 0 AND p24h_found = 1) as avg_win_dollars,

          -- Average loss size (absolute value, in $ terms)
          avgIf(abs(clv_24h * notional_usdc), clv_24h <= 0 AND p24h_found = 1) as avg_loss_dollars,

          -- Profit factor = gross wins / gross losses
          sumIf(clv_24h * notional_usdc, clv_24h > 0 AND p24h_found = 1) /
            nullIf(abs(sumIf(clv_24h * notional_usdc, clv_24h <= 0 AND p24h_found = 1)), 0) as profit_factor,

          -- Total profit (notional-weighted CLV, in $)
          sumIf(clv_24h * notional_usdc, p24h_found = 1) as total_profit,

          -- Profit per trade (expectancy)
          sumIf(clv_24h * notional_usdc, p24h_found = 1) / nullIf(countIf(p24h_found = 1), 0) as profit_per_trade,

          -- Volume
          sum(notional_usdc) as total_volume,

          -- Coverage
          countIf(p24h_found = 1) / count() as coverage,

          -- Median entry price (prefer low entries = more upside)
          median(entry_price) as median_entry,

          -- Activity
          max(trade_time) as last_trade,
          min(trade_time) as first_trade,
          uniqExact(toDate(trade_time)) as active_days,

          -- PnL per day (FAST MONEY - primary ranking metric)
          sumIf(clv_24h * notional_usdc, p24h_found = 1) / nullIf(uniqExact(toDate(trade_time)), 0) as pnl_per_day

        FROM pm_trade_clv_features_60d
        GROUP BY wallet
        HAVING
          count() >= 30                      -- 30+ trades (more signal)
          AND uniqExact(token_id) >= 10      -- 10+ markets (diversified)
          AND countIf(p24h_found = 1) >= 20  -- 20+ with price data
          AND countIf(p24h_found = 1) / count() >= 0.75  -- 75%+ coverage
          AND countIf(clv_24h <= 0 AND p24h_found = 1) >= 5  -- At least 5 losses (real risk)
      )
      SELECT
        t.*,
        e.confidence_tier,
        e.external_activity_ratio,

        -- Asymmetry ratio (want > 1 = wins bigger than losses)
        t.avg_win_dollars / nullIf(t.avg_loss_dollars, 0) as asymmetry_ratio,

        -- Copy-Trade Score v2:
        -- Primary: pnl_per_day (fast money)
        -- Secondary: win_rate * profit_factor
        -- Caps to prevent division artifacts
        -- Weight by total profit (log scale for normalization)
        t.pnl_per_day
          * t.win_rate
          * least(coalesce(t.profit_factor, 1), 10)
          * least(coalesce(t.avg_win_dollars / nullIf(t.avg_loss_dollars, 0), 1), 5)
        as copytrade_score

      FROM trade_stats t
      LEFT JOIN pm_wallet_external_activity_60d e ON t.wallet = e.wallet
      WHERE t.last_trade >= now() - INTERVAL 30 DAY
        AND t.win_rate >= 0.55           -- Win more than 55%
        AND t.profit_factor >= 1.2       -- Make 20%+ more than lose
        AND t.profit_factor < 1000       -- Cap absurd ratios (div by tiny loss)
        AND t.total_profit >= 50         -- At least $50 profit (real money)
        AND t.losses >= 3                -- Had at least 3 losses (not just lucky)
      ORDER BY copytrade_score DESC
    `,
  });
  console.log('   Done.\n');

  // Get pool stats
  console.log('2. Pool statistics:');
  const statsQ = await ch.query({
    query: `
      SELECT
        count() as total,
        countIf(confidence_tier = 'A') as tier_a,
        avg(win_rate) as avg_win_rate,
        avg(profit_factor) as avg_profit_factor,
        avg(asymmetry_ratio) as avg_asymmetry,
        avg(profit_per_trade) as avg_profit_per_trade
      FROM pm_wallet_copytrade_candidates
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsQ.json())[0] as any;

  console.log(`   Total eligible: ${Number(stats.total).toLocaleString()}`);
  console.log(`   Tier A (CLOB-only): ${Number(stats.tier_a).toLocaleString()}`);
  console.log(`   Avg win rate: ${(stats.avg_win_rate * 100).toFixed(1)}%`);
  console.log(`   Avg profit factor: ${stats.avg_profit_factor?.toFixed(2)}x`);
  console.log(`   Avg asymmetry: ${stats.avg_asymmetry?.toFixed(2)}x`);
  console.log(`   Avg profit/trade: $${stats.avg_profit_per_trade?.toFixed(2)}`);

  // Top 15 copy-trade candidates
  console.log('\n3. Top 15 Copy-Trade Candidates:\n');
  const topQ = await ch.query({
    query: `
      SELECT
        wallet,
        total_trades as trades,
        unique_markets as markets,
        round(win_rate * 100, 0) as win_pct,
        round(profit_factor, 1) as pf,
        round(asymmetry_ratio, 1) as asym,
        round(profit_per_trade, 2) as ppt,
        round(total_profit, 0) as total_pnl,
        round(total_volume, 0) as volume,
        confidence_tier as tier,
        round(copytrade_score, 2) as score
      FROM pm_wallet_copytrade_candidates
      WHERE confidence_tier = 'A'
      ORDER BY copytrade_score DESC
      LIMIT 15
    `,
    format: 'JSONEachRow',
  });
  const top = await topQ.json() as any[];

  console.log('Wallet                                     | Trades | Mkts | Win% | PF   | Asym | $/Trade | Total P&L | Score');
  console.log('-------------------------------------------|--------|------|------|------|------|---------|-----------|------');

  for (const r of top) {
    console.log(
      `${r.wallet} | ${String(r.trades).padStart(6)} | ${String(r.markets).padStart(4)} | ${String(r.win_pct).padStart(3)}% | ${String(r.pf).padStart(4)}x | ${String(r.asym).padStart(4)}x | ${('$' + r.ppt).padStart(7)} | ${('$' + Number(r.total_pnl).toLocaleString()).padStart(9)} | ${r.score}`
    );
  }

  console.log('\n\nProfile Links:');
  top.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. https://polymarket.com/profile/${r.wallet}`);
  });

  console.log('\n=== Copy-Trade Leaderboard Ready ===');
  await ch.close();
}

main().catch(console.error);
