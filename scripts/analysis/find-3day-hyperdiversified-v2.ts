#!/usr/bin/env npx tsx
/**
 * Find HYPER-DIVERSIFIED Active Traders (Last 3 Days, 7+ Markets)
 *
 * FIXED ISSUES:
 * - ✅ DEDUPLICATES pm_trade_fifo_roi_v3 (278M → 78M rows) - ACCURATE RESULTS
 * - Uses entry_time (when trade was PLACED) instead of resolved_at
 * - Excludes micro-arb wins (ROI <4%) from win rate calculation
 * - Shows copyable metrics for realistic copy trading performance
 *
 * Step-by-Step Filtering Logic:
 * 1. Base dataset: All trades with $5+ position size
 * 2. Activity filter: Wallets that PLACED trades in last 3 days (using entry_time)
 * 3. Micro-arb detection: Identify wins with ROI <4% (too fast/small to copy)
 * 4. Diversification filter: Only wallets trading 7+ different markets
 * 5. Performance filters: 70%+ copyable win rate, 30%+ median ROI, positive PnL
 * 6. Edge calculation: Compute EV per trade using copyable trades only
 * 7. Ranking: Sort by edge per trade descending
 *
 * KEY METRIC: "Copyable Win Rate"
 * - Excludes wins with ROI <4% (micro-arb trades that can't be copied)
 * - All losses still count
 * - Example: 17 total wins (3 micro-arb, 14 copyable) + 3 losses = 82% copyable win rate
 * - This reflects realistic performance for copy trading
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { writeFileSync } from 'fs';
import path from 'path';

async function find3DayHyperDiversified() {
  console.log('=== Finding HYPER-DIVERSIFIED Active Traders (Copyable Win Rate) ===\n');
  console.log('📋 Filter Pipeline:');
  console.log('   1️⃣  Base: All trades with $5+ position size');
  console.log('   2️⃣  Activity: Wallets that PLACED trades in last 3 days (entry_time)');
  console.log('   3️⃣  Micro-arb: Identify wins with ROI <4% (excluded from win rate)');
  console.log('   4️⃣  Diversification: 7+ different markets');
  console.log('   5️⃣  Performance: 70%+ COPYABLE win rate, 30%+ median ROI, positive PnL');
  console.log('   6️⃣  Edge: Positive EV per trade (based on copyable metrics)');
  console.log('   7️⃣  Ranking: Sort by edge per trade\n');
  console.log('💡 Key: "Copyable Win Rate" excludes wins <4% ROI (too fast/small to copy)\n');

  // Step 1: Get filter statistics
  console.log('🔍 Running filter pipeline diagnostics...\n');

  const diagnosticsResult = await clickhouse.query({
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
          any(is_short) as is_short,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi
        FROM pm_trade_fifo_roi_v3
        GROUP BY wallet, condition_id, outcome_index
      ),
      -- Step 1: Base dataset
      base_trades AS (
        SELECT wallet, entry_time, resolved_at, cost_usd, tokens, outcome_index, is_short, condition_id, pnl_usd, roi
        FROM deduped_fifo
        WHERE abs(cost_usd) >= 5
      ),
      base_wallets AS (
        SELECT
          uniq(wallet) as wallet_count,
          count() as total_trades
        FROM base_trades
      ),

      -- Step 2: Activity filter (entry_time - when trade was PLACED)
      active_wallets AS (
        SELECT DISTINCT wallet
        FROM base_trades
        WHERE entry_time >= now() - INTERVAL 3 DAY
      ),
      active_stats AS (
        SELECT
          uniq(wallet) as wallet_count,
          countIf(entry_time >= now() - INTERVAL 3 DAY) as active_trades,
          countIf(resolved_at >= now() - INTERVAL 3 DAY AND entry_time < now() - INTERVAL 3 DAY) as resolved_recently_but_old_trades
        FROM base_trades
      ),

      -- Step 3: Micro-arb detection
      micro_arb_wallets AS (
        SELECT
          wallet,
          countIf(
            is_short = 0 AND tokens > 0 AND
            ((outcome_index = 0 AND (cost_usd / tokens) > 0.95) OR
             (outcome_index = 1 AND (cost_usd / tokens) < 0.05))
          ) AS micro_arb_count,
          countIf(is_short = 0 AND tokens > 0) AS total_long_trades,
          round(micro_arb_count * 100.0 / nullIf(total_long_trades, 0), 1) AS micro_arb_pct
        FROM base_trades
        WHERE wallet IN (SELECT wallet FROM active_wallets)
        GROUP BY wallet
        HAVING total_long_trades > 0 AND micro_arb_pct > 10
      ),
      after_micro_arb AS (
        SELECT uniq(wallet) as wallet_count
        FROM base_trades
        WHERE wallet IN (SELECT wallet FROM active_wallets)
          AND wallet NOT IN (SELECT wallet FROM micro_arb_wallets)
      ),

      -- Step 4: Diversification filter
      diversified_wallets AS (
        SELECT wallet, uniq(condition_id) as unique_markets
        FROM base_trades
        WHERE wallet IN (SELECT wallet FROM active_wallets)
          AND wallet NOT IN (SELECT wallet FROM micro_arb_wallets)
        GROUP BY wallet
        HAVING unique_markets > 7
      ),

      -- Step 5: Performance filters
      performance_wallets AS (
        SELECT
          wallet,
          count() as total_trades,
          uniq(condition_id) as unique_markets,
          round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,
          round(median(roi) * 100, 1) as median_roi_pct,
          sum(pnl_usd) as total_pnl
        FROM base_trades
        WHERE wallet IN (SELECT wallet FROM diversified_wallets)
        GROUP BY wallet
        HAVING win_rate_pct >= 70
          AND median_roi_pct >= 30
          AND total_pnl > 0
      )

      SELECT
        (SELECT wallet_count FROM base_wallets) as step1_base_wallets,
        (SELECT total_trades FROM base_wallets) as step1_total_trades,
        (SELECT wallet_count FROM active_stats) as step2_active_wallets,
        (SELECT active_trades FROM active_stats) as step2_active_trades,
        (SELECT resolved_recently_but_old_trades FROM active_stats) as step2_stale_positions,
        (SELECT uniq(wallet) FROM micro_arb_wallets) as step3_micro_arb_filtered,
        (SELECT wallet_count FROM after_micro_arb) as step3_remaining,
        (SELECT uniq(wallet) FROM diversified_wallets) as step4_diversified,
        (SELECT uniq(wallet) FROM performance_wallets) as step5_performance_pass
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 900 as any, // 15 minutes for deduplication
    }
  });

  const diagnostics = (await diagnosticsResult.json())[0] as any;

  console.log('📊 Filter Pipeline Results:\n');
  console.log(`   1️⃣  Base dataset: ${diagnostics.step1_base_wallets.toLocaleString()} wallets, ${diagnostics.step1_total_trades.toLocaleString()} trades`);
  console.log(`   2️⃣  Activity filter (entry_time): ${diagnostics.step2_active_wallets.toLocaleString()} wallets`);
  console.log(`      ⚠️  Old positions resolved recently: ${diagnostics.step2_stale_positions.toLocaleString()} trades (would be false positives!)`);
  console.log(`   3️⃣  Micro-arb filter: Removed ${diagnostics.step3_micro_arb_filtered.toLocaleString()} wallets → ${diagnostics.step3_remaining.toLocaleString()} remaining`);
  console.log(`   4️⃣  Diversification (7+ markets): ${diagnostics.step4_diversified.toLocaleString()} wallets`);
  console.log(`   5️⃣  Performance filters: ${diagnostics.step5_performance_pass.toLocaleString()} wallets\n`);

  // Step 2: Run main query with fixed logic
  const tradersResult = await clickhouse.query({
    query: `
      WITH
      -- CRITICAL: Deduplicate FIFO table first (278M → 78M rows)
      deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(tx_hash) as tx_hash,
          any(entry_time) as entry_time,
          any(resolved_at) as resolved_at,
          any(cost_usd) as cost_usd,
          any(tokens) as tokens,
          any(tokens_sold_early) as tokens_sold_early,
          any(tokens_held) as tokens_held,
          any(exit_value) as exit_value,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(pct_sold_early) as pct_sold_early,
          any(is_maker) as is_maker,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3
        GROUP BY wallet, condition_id, outcome_index
      ),
      -- STEP 1: Base dataset with minimum position size
      base_trades AS (
        SELECT *
        FROM deduped_fifo
        WHERE abs(cost_usd) >= 5
      ),

      -- STEP 2: Activity filter - wallets that PLACED trades in last 3 days
      -- CRITICAL: Using entry_time (when trade was placed), NOT resolved_at (when market resolved)
      active_wallets AS (
        SELECT DISTINCT wallet
        FROM base_trades
        WHERE entry_time >= now() - INTERVAL 3 DAY
      ),

      -- STEP 3: Micro-arb filter
      micro_arb_wallets AS (
        SELECT
          wallet,
          countIf(
            is_short = 0 AND tokens > 0 AND
            ((outcome_index = 0 AND (cost_usd / tokens) > 0.95) OR   -- YES > 95%
             (outcome_index = 1 AND (cost_usd / tokens) < 0.05))      -- NO < 5%
          ) AS micro_arb_count,
          countIf(is_short = 0 AND tokens > 0) AS total_long_trades,
          round(micro_arb_count * 100.0 / nullIf(total_long_trades, 0), 1) AS micro_arb_pct
        FROM base_trades
        WHERE wallet IN (SELECT wallet FROM active_wallets)
        GROUP BY wallet
        HAVING total_long_trades > 0 AND micro_arb_pct > 10
      ),

      -- STEP 4 & 5: Calculate wallet statistics and apply filters
      wallet_stats AS (
        SELECT
          wallet,
          count() as total_trades,
          uniq(condition_id) as unique_markets,

          -- TOTAL metrics (all trades)
          countIf(pnl_usd > 0) as total_wins,
          countIf(pnl_usd <= 0) as total_losses,
          round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as total_win_rate_pct,

          -- COPYABLE metrics (exclude wins with ROI <4%)
          -- Micro-arb = wins with ROI <4% (too small/fast to copy)
          countIf(pnl_usd > 0 AND roi < 0.04) as micro_arb_wins,
          countIf(pnl_usd > 0 AND roi >= 0.04) as copyable_wins,
          countIf(pnl_usd <= 0) as losses,

          -- Copyable win rate (what matters for copy trading)
          round(countIf(pnl_usd > 0 AND roi >= 0.04) * 100.0 / (countIf(pnl_usd > 0 AND roi >= 0.04) + countIf(pnl_usd <= 0)), 1) as win_rate_pct,
          countIf(pnl_usd > 0 AND roi >= 0.04) / (countIf(pnl_usd > 0 AND roi >= 0.04) + countIf(pnl_usd <= 0)) as win_rate_decimal,

          -- PnL metrics (all trades)
          sum(pnl_usd) as total_pnl,
          sumIf(pnl_usd, pnl_usd > 0) as gross_wins,
          sumIf(pnl_usd, pnl_usd < 0) as gross_losses,

          -- ROI metrics (copyable trades only)
          round(sumIf(roi, roi >= 0.04 OR pnl_usd <= 0) * 100.0 / countIf(roi >= 0.04 OR pnl_usd <= 0), 1) as avg_roi_pct,
          round(medianIf(roi, roi >= 0.04 OR pnl_usd <= 0) * 100, 1) as median_roi_pct,
          round(stddevPopIf(roi, roi >= 0.04 OR pnl_usd <= 0) * 100, 1) as roi_stddev,

          -- EV calculation components (copyable trades only)
          medianIf(roi, pnl_usd > 0 AND roi >= 0.04) as median_win_roi,
          abs(medianIf(roi, pnl_usd <= 0)) as median_loss_roi,

          -- Position sizing
          round(avg(abs(cost_usd)), 0) as avg_position_size,
          round(sum(abs(cost_usd)), 0) as total_volume,

          -- Frequency metrics
          dateDiff('day', min(entry_time), max(entry_time)) as trading_days,
          round(count() / nullIf(dateDiff('day', min(entry_time), max(entry_time)), 0), 1) as trades_per_day,

          -- Hold time
          round(avg(dateDiff('hour', entry_time, resolved_at)) / 24.0, 2) as avg_hold_days,
          round(avg(dateDiff('hour', entry_time, resolved_at)), 1) as avg_hold_hours,
          round(median(dateDiff('hour', entry_time, resolved_at)), 1) as median_hold_hours,

          -- Shorts
          countIf(is_short = 1) as short_trades,
          round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

          -- Recency - FIXED: Using entry_time instead of resolved_at
          max(entry_time) as last_trade_placed,
          max(resolved_at) as last_market_resolved,
          dateDiff('day', max(entry_time), now()) as days_since_last_trade,
          dateDiff('hour', max(entry_time), now()) as hours_since_last_trade
        FROM base_trades
        WHERE wallet IN (SELECT wallet FROM active_wallets)
          AND wallet NOT IN (SELECT wallet FROM micro_arb_wallets)
        GROUP BY wallet
        HAVING unique_markets > 7           -- STEP 4: Diversification
          AND win_rate_pct >= 70           -- STEP 5: Performance
          AND median_roi_pct >= 30
          AND total_pnl > 0
      )

      -- STEP 6: Calculate edge metrics
      SELECT
        wallet,
        total_trades,
        unique_markets,

        -- Total metrics (all trades)
        total_wins,
        total_losses,
        total_win_rate_pct,

        -- Copyable metrics (excluding micro-arb wins)
        micro_arb_wins,
        copyable_wins,
        losses,
        win_rate_pct as copyable_win_rate_pct,
        round(total_pnl, 0) as total_pnl,

        -- Edge calculation
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
        median_hold_hours,
        short_pct,
        last_trade_placed,
        last_market_resolved,
        days_since_last_trade,
        hours_since_last_trade
      FROM wallet_stats
      WHERE edge_per_trade > 0  -- STEP 6: Safety gate
      ORDER BY edge_per_trade DESC, win_rate_pct DESC
      LIMIT 200
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 900 as any, // 15 minutes for deduplication
    }
  });

  const tradersData = await tradersResult.json();
  const traders = Array.isArray(tradersData) ? tradersData : [tradersData];

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria');
    return;
  }

  console.log(`✅ Found ${traders.length} wallets passing all filters\n`);
  console.log('=== TOP 20 HYPER-DIVERSIFIED TRADERS ===\n');

  traders.slice(0, 20).forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);
    const hoursAgo = w.hours_since_last_trade < 24 ? `${w.hours_since_last_trade}h ago` : `${w.days_since_last_trade}d ago`;
    const tradesPerMarket = (w.total_trades / w.unique_markets).toFixed(1);
    const copyableTrades = w.copyable_wins + w.losses;

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   🎯 Edge/Trade: ${w.edge_per_trade_pct}% | Copyable Win Rate: ${w.copyable_win_rate_pct}% (${w.copyable_wins}W-${w.losses}L)`);
    console.log(`   🚀 Compounding Score: ${w.compounding_score.toFixed(4)} (EV/hold_days)`);
    console.log(`   📊 Trades: ${w.total_trades} total (${copyableTrades} copyable, ${w.micro_arb_wins} micro-arb excluded)`);
    console.log(`   🎨 Markets: ${w.unique_markets} markets (${tradesPerMarket} trades/market)`);
    console.log(`   💎 Median Win: ${w.median_win_roi_pct}% | Median Loss: -${w.median_loss_roi_pct}% (copyable only)`);
    console.log(`   💰 Total PnL: $${w.total_pnl.toLocaleString()}`);
    console.log(`   ⚡ Frequency: ${tradeFreq} | Hold Time: ${w.avg_hold_days} days avg`);
    console.log(`   💵 Avg Position: $${w.avg_position_size} | Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade Placed: ${w.last_trade_placed} (${hoursAgo})`);
    if (w.micro_arb_wins > 0) {
      console.log(`   ⚠️  Micro-arb wins excluded: ${w.micro_arb_wins} (ROI <4%, too fast to copy)`);
    }
  });

  // Summary stats
  console.log('\n\n📊 COHORT STATS:\n');
  const avgProfit = traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length;
  const avgCopyableWinRate = traders.reduce((sum, w) => sum + w.copyable_win_rate_pct, 0) / traders.length;
  const avgTotalWinRate = traders.reduce((sum, w) => sum + w.total_win_rate_pct, 0) / traders.length;
  const avgMedianROI = traders.reduce((sum, w) => sum + w.median_roi_pct, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;
  const avgMarkets = traders.reduce((sum, w) => sum + w.unique_markets, 0) / traders.length;
  const totalMicroArb = traders.reduce((sum, w) => sum + w.micro_arb_wins, 0);
  const totalCopyable = traders.reduce((sum, w) => sum + w.copyable_wins, 0);

  console.log(`   Total Cohort Profit: $${traders.reduce((sum, w) => sum + w.total_pnl, 0).toLocaleString()}`);
  console.log(`   Average Profit: $${avgProfit.toLocaleString()}`);
  console.log(`   Average Copyable Win Rate: ${avgCopyableWinRate.toFixed(1)}% (excluding micro-arb)`);
  console.log(`   Average Total Win Rate: ${avgTotalWinRate.toFixed(1)}% (including micro-arb)`);
  console.log(`   Average MEDIAN ROI: ${avgMedianROI.toFixed(1)}% (copyable only)`);
  console.log(`   Average Markets: ${avgMarkets.toFixed(1)}`);
  console.log(`   Average Trades: ${avgTrades.toFixed(0)}`);
  console.log(`   Micro-arb Wins Excluded: ${totalMicroArb.toLocaleString()} across cohort`);
  console.log(`   Copyable Wins: ${totalCopyable.toLocaleString()} across cohort`);
  console.log(`   Wallets Found: ${traders.length}`);

  // Export to CSV
  console.log('\n\n📄 EXPORTING TO CSV...\n');
  const csv = [
    'wallet,edge_per_trade_pct,compounding_score,unique_markets,total_trades,total_wins,total_losses,total_win_rate_pct,copyable_wins,losses,micro_arb_wins,copyable_win_rate_pct,total_pnl,median_win_roi_pct,median_loss_roi_pct,median_roi_pct,avg_roi_pct,roi_stddev,avg_position_size,total_volume,avg_hold_days,trades_per_day,avg_hold_hours,short_pct,last_trade_placed,last_market_resolved,days_since_last_trade,hours_since_last_trade',
    ...traders.map(w =>
      `${w.wallet},${w.edge_per_trade_pct},${w.compounding_score},${w.unique_markets},${w.total_trades},${w.total_wins},${w.total_losses},${w.total_win_rate_pct},${w.copyable_wins},${w.losses},${w.micro_arb_wins},${w.copyable_win_rate_pct},${w.total_pnl},${w.median_win_roi_pct},${w.median_loss_roi_pct},${w.median_roi_pct},${w.avg_roi_pct},${w.roi_stddev},${w.avg_position_size},${w.total_volume},${w.avg_hold_days},${w.trades_per_day},${w.avg_hold_hours},${w.short_pct},${w.last_trade_placed},${w.last_market_resolved},${w.days_since_last_trade},${w.hours_since_last_trade}`
    )
  ].join('\n');

  const csvPath = path.resolve(process.cwd(), 'hyper-diversified-3day-traders-v2.csv');
  writeFileSync(csvPath, csv, 'utf8');
  console.log(`✅ Exported ${traders.length} wallets to: ${csvPath}\n`);
}

find3DayHyperDiversified().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
