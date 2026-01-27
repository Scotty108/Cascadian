#!/usr/bin/env npx tsx
/**
 * Find Best Equal-Weight Copy Trade Wallet (Last 30 Days)
 *
 * For equal-weight copy trading, profit = sum(ROI across all trades)
 * This is equivalent to: total_trades × avg_roi
 *
 * Filters:
 * - Active in last 30 days
 * - Min 10 trades (meaningful sample)
 * - Min 60% win rate
 * - Min $5 position size
 * - Positive edge per trade (EV > 0)
 * - Ranked by total ROI sum (best for equal-weight copy trading)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function findBestCopyTrade30Days() {
  console.log('=== Finding Best Equal-Weight Copy Trade Wallet (Last 30 Days) ===\n');

  const tradersResult = await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet,
          count() as total_trades,
          uniq(condition_id) as unique_markets,
          countIf(pnl_usd > 0) as wins,
          countIf(pnl_usd <= 0) as losses,
          round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,
          countIf(pnl_usd > 0) / count() as win_rate_decimal,

          -- Overall PnL metrics
          sum(pnl_usd) as total_pnl,
          sumIf(pnl_usd, pnl_usd > 0) as gross_wins,
          sumIf(pnl_usd, pnl_usd < 0) as gross_losses,

          -- ROI metrics
          sum(roi) as total_roi_sum,  -- KEY METRIC for equal-weight copy trading
          round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
          round(median(roi) * 100, 1) as median_roi_pct,
          round(stddevPop(roi) * 100, 1) as roi_stddev,

          -- EV calculation components
          medianIf(roi, pnl_usd > 0) as median_win_roi,
          abs(medianIf(roi, pnl_usd <= 0)) as median_loss_roi,

          -- Position sizing
          round(avg(abs(cost_usd)), 0) as avg_position_size,
          round(sum(abs(cost_usd)), 0) as total_volume,

          -- Frequency metrics
          dateDiff('day', min(resolved_at), max(resolved_at)) as trading_days,
          round(count() / nullIf(dateDiff('day', min(resolved_at), max(resolved_at)), 0), 1) as trades_per_day,

          -- Hold time
          round(avg(dateDiff('hour', entry_time, resolved_at)) / 24.0, 2) as avg_hold_days,
          round(avg(dateDiff('hour', entry_time, resolved_at)), 1) as avg_hold_hours,

          -- Consistency
          countIf(is_short = 1) as short_trades,
          round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

          -- Recency
          max(resolved_at) as last_trade,
          dateDiff('day', max(resolved_at), now()) as days_since_last,
          dateDiff('hour', max(resolved_at), now()) as hours_since_last
        FROM pm_trade_fifo_roi_v3
        WHERE abs(cost_usd) >= 5
          AND resolved_at >= now() - INTERVAL 30 DAY  -- Last 30 days only
        GROUP BY wallet
        HAVING total_trades >= 10          -- Min 10 trades
          AND win_rate_pct >= 60           -- Min 60% win rate
          AND days_since_last <= 30        -- Active in last 30 days
      )
      SELECT
        wallet,
        total_trades,
        unique_markets,
        wins,
        losses,
        win_rate_pct,
        round(total_pnl, 0) as total_pnl,

        -- Equal-weight copy trade metrics
        round(total_roi_sum, 4) as total_roi_sum,
        round(total_roi_sum * 100, 2) as total_roi_sum_pct,

        -- EV calculation
        round((win_rate_decimal * median_win_roi) - ((1 - win_rate_decimal) * median_loss_roi), 4) as edge_per_trade,
        round(((win_rate_decimal * median_win_roi) - ((1 - win_rate_decimal) * median_loss_roi)) * 100, 2) as edge_per_trade_pct,

        -- Capital velocity
        avg_hold_days,
        round(
          if(avg_hold_days > 0,
            ((win_rate_decimal * median_win_roi) - ((1 - win_rate_decimal) * median_loss_roi)) / avg_hold_days,
            ((win_rate_decimal * median_win_roi) - ((1 - win_rate_decimal) * median_loss_roi)) * trades_per_day
          ),
          4
        ) as compounding_score,

        round(gross_wins, 0) as gross_wins,
        round(gross_losses, 0) as gross_losses,
        round(median_win_roi * 100, 1) as median_win_roi_pct,
        round(median_loss_roi * 100, 1) as median_loss_roi_pct,
        avg_roi_pct,
        median_roi_pct,
        roi_stddev,
        avg_position_size,
        total_volume,
        trading_days,
        trades_per_day,
        avg_hold_hours,
        short_pct,
        last_trade,
        days_since_last,
        hours_since_last
      FROM wallet_stats
      WHERE edge_per_trade > 0  -- Positive EV only
      ORDER BY total_roi_sum DESC  -- Best for equal-weight copy trading
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const traders = (await tradersResult.json()) as any[];

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria');
    return;
  }

  console.log(`✓ Found ${traders.length} wallets for equal-weight copy trading (last 30 days)\n`);
  console.log('=== BEST EQUAL-WEIGHT COPY TRADE WALLETS (Last 30 Days) ===\n');
  console.log('Ranked by total ROI sum (profit if you copy every trade with equal capital)\n');

  traders.slice(0, 20).forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);
    const hoursAgo = w.hours_since_last < 24 ? `${w.hours_since_last}h ago` : `${w.days_since_last}d ago`;

    // Calculate what you'd make with $100 per trade
    const profit100PerTrade = (w.total_roi_sum * 100).toFixed(2);

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   💰 Equal-Weight Profit: $${profit100PerTrade} (with $100/trade)`);
    console.log(`   📊 Total ROI Sum: ${w.total_roi_sum_pct}% across ${w.total_trades} trades`);
    console.log(`   🎯 Edge/Trade: ${w.edge_per_trade_pct}% | Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L)`);
    console.log(`   🚀 Compounding Score: ${w.compounding_score.toFixed(4)}`);
    console.log(`   🎨 Markets: ${w.unique_markets} | Avg ROI: ${w.avg_roi_pct}%`);
    console.log(`   📈 Median Win: ${w.median_win_roi_pct}% | Median Loss: -${w.median_loss_roi_pct}%`);
    console.log(`   ⚡ Frequency: ${tradeFreq} | Hold Time: ${w.avg_hold_days} days avg`);
    console.log(`   💵 Their Avg Position: $${w.avg_position_size} | Their PnL: $${w.total_pnl.toLocaleString()}`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${hoursAgo})`);
  });

  // Summary
  console.log('\n\n🎯 ANSWER: BEST EQUAL-WEIGHT COPY TRADE (Last 30 Days)\n');
  const best = traders[0];
  const profit100 = (best.total_roi_sum * 100).toFixed(2);
  const profit1000 = (best.total_roi_sum * 1000).toFixed(2);

  console.log(`Wallet: ${best.wallet}`);
  console.log(`\nIf you equal-weight copy traded this wallet:`);
  console.log(`   - With $100 per trade: $${profit100} profit`);
  console.log(`   - With $1,000 per trade: $${profit1000} profit`);
  console.log(`\nStats:`);
  console.log(`   - Trades: ${best.total_trades} trades across ${best.unique_markets} markets`);
  console.log(`   - Win Rate: ${best.win_rate_pct}% (${best.wins}W-${best.losses}L)`);
  console.log(`   - Edge per Trade: ${best.edge_per_trade_pct}%`);
  console.log(`   - Avg ROI: ${best.avg_roi_pct}% | Median ROI: ${best.median_roi_pct}%`);
  console.log(`   - Compounding Score: ${best.compounding_score.toFixed(4)}`);
  console.log(`   - Hold Time: ${best.avg_hold_days} days avg`);
  console.log(`   - Last Trade: ${hoursAgo}`);
  console.log(`\nTheir actual PnL: $${best.total_pnl.toLocaleString()} (with avg $${best.avg_position_size}/trade)`);

  // Export to CSV
  console.log('\n\n📄 EXPORTING TO CSV...\n');
  const csv = [
    'wallet,total_roi_sum_pct,profit_with_100_per_trade,edge_per_trade_pct,compounding_score,unique_markets,total_trades,wins,losses,win_rate_pct,total_pnl,median_win_roi_pct,median_loss_roi_pct,avg_roi_pct,median_roi_pct,avg_position_size,total_volume,avg_hold_days,trades_per_day,short_pct,last_trade,hours_since_last',
    ...traders.map(w =>
      `${w.wallet},${w.total_roi_sum_pct},${(w.total_roi_sum * 100).toFixed(2)},${w.edge_per_trade_pct},${w.compounding_score},${w.unique_markets},${w.total_trades},${w.wins},${w.losses},${w.win_rate_pct},${w.total_pnl},${w.median_win_roi_pct},${w.median_loss_roi_pct},${w.avg_roi_pct},${w.median_roi_pct},${w.avg_position_size},${w.total_volume},${w.avg_hold_days},${w.trades_per_day},${w.short_pct},${w.last_trade},${w.hours_since_last}`
    )
  ].join('\n');

  const fs = require('fs');
  const csvPath = '/Users/scotty/Projects/Cascadian-app/best-copy-trade-30d.csv';
  fs.writeFileSync(csvPath, csv);
  console.log(`✅ Exported ${traders.length} wallets to: ${csvPath}`);
}

findBestCopyTrade30Days().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
