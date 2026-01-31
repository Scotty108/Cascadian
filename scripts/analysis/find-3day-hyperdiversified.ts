#!/usr/bin/env npx tsx
/**
 * Find HYPER-DIVERSIFIED Active Traders (Last 3 Days, 7+ Markets)
 *
 * Filters:
 * - Active in last 3 days
 * - High win rate (>70%)
 * - HIGH MEDIAN ROI (>30%)
 * - TRADES 7+ DIFFERENT MARKETS (hyper-diversification)
 * - Min position size $5 (reduced from $10)
 * - POSITIVE TOTAL PNL (filters out wallets with good edge but bad position sizing)
 * - NO minimum trades filter
 * - EXCLUDES MICRO-ARBERS: Wallets with >10% trades at extreme probabilities
 *   (YES >0.95 or NO <0.05)
 * - Ranked by EV per trade
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function find3DayHyperDiversified() {
  console.log('=== Finding HYPER-DIVERSIFIED Active Traders (Ranked by EV/trade, Win Rate) ===\n');

  const tradersResult = await clickhouse.query({
    query: `
      WITH
      -- CRITICAL: Deduplicate FIFO table first (278M → 78M rows)
      deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(entry_time) as entry_time,
          any(resolved_at) as resolved_at,
          any(cost_usd) as cost_usd,
          any(tokens) as tokens,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3
        GROUP BY wallet, condition_id, outcome_index
      ),
      micro_arb_wallets AS (
        -- Identify wallets with >10% micro-arb trades
        -- Micro-arb = YES trades at >0.95 or NO trades at <0.05
        SELECT
          wallet,
          countIf(
            is_short = 0 AND tokens > 0 AND
            ((outcome_index = 0 AND (cost_usd / tokens) > 0.95) OR   -- YES > 95%
             (outcome_index = 1 AND (cost_usd / tokens) < 0.05))      -- NO < 5%
          ) AS micro_arb_count,
          countIf(is_short = 0 AND tokens > 0) AS total_long_trades,
          round(micro_arb_count * 100.0 / nullIf(total_long_trades, 0), 1) AS micro_arb_pct
        FROM deduped_fifo
        WHERE abs(cost_usd) >= 5
        GROUP BY wallet
        HAVING total_long_trades > 0 AND micro_arb_pct > 10  -- Exclude if >10% micro-arb
      ),
      wallet_stats AS (
        SELECT
          wallet,
          count() as total_trades,
          uniq(condition_id) as unique_markets,  -- Market diversity
          countIf(pnl_usd > 0) as wins,
          countIf(pnl_usd <= 0) as losses,
          round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,
          countIf(pnl_usd > 0) / count() as win_rate_decimal,  -- For EV calculation

          -- Overall PnL metrics
          sum(pnl_usd) as total_pnl,
          sumIf(pnl_usd, pnl_usd > 0) as gross_wins,
          sumIf(pnl_usd, pnl_usd < 0) as gross_losses,

          -- ROI metrics (MEDIAN is key!)
          round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
          round(median(roi) * 100, 1) as median_roi_pct,
          round(stddevPop(roi) * 100, 1) as roi_stddev,

          -- EV calculation components
          medianIf(roi, pnl_usd > 0) as median_win_roi,  -- R_w (decimal)
          abs(medianIf(roi, pnl_usd <= 0)) as median_loss_roi,  -- R_l (decimal, positive)

          -- Position sizing
          round(avg(abs(cost_usd)), 0) as avg_position_size,
          round(sum(abs(cost_usd)), 0) as total_volume,

          -- Frequency metrics
          dateDiff('day', min(resolved_at), max(resolved_at)) as trading_days,
          round(count() / nullIf(dateDiff('day', min(resolved_at), max(resolved_at)), 0), 1) as trades_per_day,

          -- Hold time (capital velocity)
          round(avg(dateDiff('hour', entry_time, resolved_at)) / 24.0, 2) as avg_hold_days,
          round(avg(dateDiff('hour', entry_time, resolved_at)), 1) as avg_hold_hours,
          round(median(dateDiff('hour', entry_time, resolved_at)), 1) as median_hold_hours,

          -- Consistency
          countIf(is_short = 1) as short_trades,
          round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

          -- Recency
          max(resolved_at) as last_trade,
          dateDiff('day', max(resolved_at), now()) as days_since_last,
          dateDiff('hour', max(resolved_at), now()) as hours_since_last
        FROM deduped_fifo
        WHERE abs(cost_usd) >= 5  -- Min $5 position size (reduced from $10)
          AND wallet NOT IN (SELECT wallet FROM micro_arb_wallets)  -- FILTER OUT MICRO-ARBERS
        GROUP BY wallet
        HAVING unique_markets > 7           -- MORE THAN 7 MARKETS (increased from 5)
          AND win_rate_pct >= 70           -- HIGH WIN RATE (70%+)
          AND median_roi_pct >= 30         -- HIGH MEDIAN ROI (30%+)
          AND days_since_last <= 3         -- ACTIVE IN LAST 3 DAYS!
          AND total_pnl > 0                -- POSITIVE TOTAL PNL (filters out bad position sizers)
          -- NO minimum trades filter
      )
      SELECT
        wallet,
        total_trades,
        unique_markets,
        wins,
        losses,
        win_rate_pct,
        round(total_pnl, 0) as total_pnl,

        -- EV calculation: EV = (W × R_w) - ((1 - W) × R_l)
        round((win_rate_decimal * median_win_roi) - ((1 - win_rate_decimal) * median_loss_roi), 4) as edge_per_trade,
        round(((win_rate_decimal * median_win_roi) - ((1 - win_rate_decimal) * median_loss_roi)) * 100, 2) as edge_per_trade_pct,

        -- Capital velocity
        avg_hold_days,

        -- Compounding score: EV / avg_hold_days (with fallback)
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
        median_hold_hours,
        short_pct,
        last_trade,
        days_since_last,
        hours_since_last
      FROM wallet_stats
      WHERE edge_per_trade > 0  -- Safety gate: EV > 0
      ORDER BY edge_per_trade DESC, win_rate_pct DESC
      LIMIT 200
    `,
    format: 'JSONEachRow'
  });

  const traders = (await tradersResult.json()) as any[];

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria');
    console.log('   Criteria: >7 markets, >70% win rate, >30% MEDIAN ROI, active in last 3 days');
    console.log('   POSITIVE total PnL, $5 min position, NO minimum trades');
    console.log('   EXCLUDES: Wallets with >10% micro-arb trades (YES >95% or NO <5%)');
    return;
  }

  console.log(`✓ Found ${traders.length} HYPER-DIVERSIFIED traders (last 3 days, 7+ markets, NO micro-arbers)\n`);
  console.log('=== HYPER-DIVERSIFIED TRADERS (Ranked by EV per Trade, Micro-Arbers Excluded) ===\n');

  traders.forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const holdTime = w.avg_hold_hours < 24 ? `${w.avg_hold_hours}h` : `${(w.avg_hold_hours / 24).toFixed(1)}d`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);
    const hoursAgo = w.hours_since_last < 24 ? `${w.hours_since_last}h ago` : `${w.days_since_last}d ago`;
    const tradesPerMarket = (w.total_trades / w.unique_markets).toFixed(1);

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   🎯 Edge/Trade: ${w.edge_per_trade_pct}% | Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L)`);
    console.log(`   🚀 Compounding Score: ${w.compounding_score.toFixed(4)} (EV/hold_days)`);
    console.log(`   🎨 Markets: ${w.unique_markets} markets (${tradesPerMarket} trades/market)`);
    console.log(`   📊 Median Win: ${w.median_win_roi_pct}% | Median Loss: -${w.median_loss_roi_pct}%`);
    console.log(`   💰 Total PnL: $${w.total_pnl.toLocaleString()} from ${w.total_trades} trades`);
    console.log(`   ⚡ Frequency: ${tradeFreq} | Hold Time: ${w.avg_hold_days} days avg`);
    console.log(`   💵 Avg Position: $${w.avg_position_size} | Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${hoursAgo})`);
  });

  // Show top recommendations
  console.log('\n\n🎯 TOP RECOMMENDATIONS (7+ MARKETS, MICRO-ARBERS EXCLUDED):\n');

  // Highest MEDIAN ROI
  const topMedianROI = traders[0];
  console.log(`💎 HIGHEST MEDIAN ROI:`);
  console.log(`   Wallet: ${topMedianROI.wallet}`);
  console.log(`   Markets: ${topMedianROI.unique_markets} | Median ROI: ${topMedianROI.median_roi_pct}%`);
  console.log(`   Win Rate: ${topMedianROI.win_rate_pct}% (${topMedianROI.wins}W-${topMedianROI.losses}L)`);
  console.log(`   Profit: $${topMedianROI.total_pnl.toLocaleString()}`);
  console.log(`   Last: ${topMedianROI.hours_since_last}h ago\n`);

  // Most diversified
  const mostDiversified = traders.reduce((prev, curr) =>
    (curr.unique_markets > prev.unique_markets) ? curr : prev
  );
  console.log(`🎨 MOST DIVERSIFIED:`);
  console.log(`   Wallet: ${mostDiversified.wallet}`);
  console.log(`   Markets: ${mostDiversified.unique_markets} | Trades: ${mostDiversified.total_trades}`);
  console.log(`   Median ROI: ${mostDiversified.median_roi_pct}% | Win Rate: ${mostDiversified.win_rate_pct}%`);
  console.log(`   Profit: $${mostDiversified.total_pnl.toLocaleString()}`);
  console.log(`   Last: ${mostDiversified.hours_since_last}h ago\n`);

  // Most profitable
  const topProfit = traders.reduce((prev, curr) =>
    (curr.total_pnl > prev.total_pnl) ? curr : prev
  );
  console.log(`💰 MOST PROFITABLE:`);
  console.log(`   Wallet: ${topProfit.wallet}`);
  console.log(`   Profit: $${topProfit.total_pnl.toLocaleString()}`);
  console.log(`   Markets: ${topProfit.unique_markets} | Median ROI: ${topProfit.median_roi_pct}% | Win Rate: ${topProfit.win_rate_pct}%`);
  console.log(`   Last: ${topProfit.hours_since_last}h ago\n`);

  // Most active (highest trade count)
  const mostActive = traders.reduce((prev, curr) =>
    (curr.total_trades > prev.total_trades) ? curr : prev
  );
  console.log(`🔥 MOST ACTIVE:`);
  console.log(`   Wallet: ${mostActive.wallet}`);
  console.log(`   Trades: ${mostActive.total_trades} across ${mostActive.unique_markets} markets (${(mostActive.total_trades / mostActive.unique_markets).toFixed(1)}/market)`);
  console.log(`   Median ROI: ${mostActive.median_roi_pct}% | Win Rate: ${mostActive.win_rate_pct}%`);
  console.log(`   Profit: $${mostActive.total_pnl.toLocaleString()}`);
  console.log(`   Last: ${mostActive.hours_since_last}h ago\n`);

  // Smallest account (for reference)
  const smallestProfit = traders.reduce((prev, curr) =>
    (curr.total_pnl < prev.total_pnl) ? curr : prev
  );
  console.log(`📉 SMALLEST PROFIT (still meets all criteria):`);
  console.log(`   Wallet: ${smallestProfit.wallet}`);
  console.log(`   Profit: $${smallestProfit.total_pnl.toLocaleString()}`);
  console.log(`   Markets: ${smallestProfit.unique_markets} | Median ROI: ${smallestProfit.median_roi_pct}% | Win Rate: ${smallestProfit.win_rate_pct}%`);
  console.log(`   Trades: ${smallestProfit.total_trades}`);
  console.log(`   Last: ${smallestProfit.hours_since_last}h ago\n`);

  // Summary stats
  console.log('\n📊 COHORT STATS (7+ MARKETS, MICRO-ARBERS EXCLUDED):');
  const avgProfit = traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length;
  const avgWinRate = traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length;
  const avgMedianROI = traders.reduce((sum, w) => sum + w.median_roi_pct, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;
  const avgMarkets = traders.reduce((sum, w) => sum + w.unique_markets, 0) / traders.length;

  console.log(`   Total Cohort Profit: $${traders.reduce((sum, w) => sum + w.total_pnl, 0).toLocaleString()}`);
  console.log(`   Average Profit: $${avgProfit.toLocaleString()}`);
  console.log(`   Average Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`   Average MEDIAN ROI: ${avgMedianROI.toFixed(1)}%`);
  console.log(`   Average Markets: ${avgMarkets.toFixed(1)}`);
  console.log(`   Average Trades: ${avgTrades.toFixed(0)}`);
  console.log(`   Wallets Found: ${traders.length}`);

  // Export to CSV
  console.log('\n\n📄 EXPORTING TO CSV...\n');
  const csv = [
    'wallet,edge_per_trade_pct,compounding_score,unique_markets,total_trades,wins,losses,win_rate_pct,total_pnl,median_win_roi_pct,median_loss_roi_pct,median_roi_pct,avg_roi_pct,roi_stddev,avg_position_size,total_volume,avg_hold_days,trades_per_day,avg_hold_hours,short_pct,last_trade,hours_since_last',
    ...traders.map(w =>
      `${w.wallet},${w.edge_per_trade_pct},${w.compounding_score},${w.unique_markets},${w.total_trades},${w.wins},${w.losses},${w.win_rate_pct},${w.total_pnl},${w.median_win_roi_pct},${w.median_loss_roi_pct},${w.median_roi_pct},${w.avg_roi_pct},${w.roi_stddev},${w.avg_position_size},${w.total_volume},${w.avg_hold_days},${w.trades_per_day},${w.avg_hold_hours},${w.short_pct},${w.last_trade},${w.hours_since_last}`
    )
  ].join('\n');

  const fs = require('fs');
  const csvPath = '/Users/scotty/Projects/Cascadian-app/hyper-diversified-3day-traders.csv';
  fs.writeFileSync(csvPath, csv);
  console.log(`✅ Exported ${traders.length} wallets to: ${csvPath}`);
}

find3DayHyperDiversified().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
