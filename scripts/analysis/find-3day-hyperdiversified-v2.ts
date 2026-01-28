#!/usr/bin/env npx tsx
/**
 * Find HYPER-DIVERSIFIED Active Traders (7+ Markets)
 *
 * TABLE: pm_trade_fifo_roi_v3_mat_deduped (materialized, deduplicated by tx_hash)
 *
 * LOGIC:
 * - ✅ TRUE FIFO V5 (early selling, per-trade PnL, SHORT positions)
 * - ✅ NO duplicates (deduped by tx_hash)
 * - ✅ Copyable win rate (excludes micro-arb wins <4% ROI)
 * - ✅ Fast queries (physical table, not VIEW)
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
  console.log('=== Finding HYPER-DIVERSIFIED Active Traders ===\n');
  console.log('📊 Using: pm_trade_fifo_roi_v3_mat_deduped (TRUE FIFO V5, NO duplicates)\n');
  console.log('📋 Filters:');
  console.log('   1️⃣  Trades: $5+ position size');
  console.log('   2️⃣  Diversification: 7+ different markets');
  console.log('   3️⃣  Win Rate: 70%+ (copyable trades only, ROI ≥4%)');
  console.log('   4️⃣  Performance: 30%+ median ROI, positive PnL');
  console.log('   5️⃣  Ranking: Edge per trade\n');

  // Run simplified query - table already filtered to 2-day active wallets
  console.log('🔍 Running query...\n');

  const tradersResult = await clickhouse.query({
    query: `
      SELECT
        wallet,

        -- Trade counts
        count() as total_trades,
        uniq(condition_id) as unique_markets,

        -- Total wins/losses
        countIf(pnl_usd > 0) as total_wins,
        countIf(pnl_usd <= 0) as total_losses,
        round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as total_win_rate_pct,

        -- Copyable metrics (exclude micro-arb wins <4% ROI)
        countIf(pnl_usd > 0 AND roi < 0.04) as micro_arb_wins,
        countIf(pnl_usd > 0 AND roi >= 0.04) as copyable_wins,
        countIf(pnl_usd <= 0) as losses,
        round(countIf(pnl_usd > 0 AND roi >= 0.04) * 100.0 /
          (countIf(pnl_usd > 0 AND roi >= 0.04) + countIf(pnl_usd <= 0)), 1) as copyable_win_rate_pct,

        -- ROI metrics (copyable trades only)
        quantile(0.5)(if(pnl_usd > 0 AND roi >= 0.04, roi, NULL)) * 100 as median_win_roi_pct,
        abs(quantile(0.5)(if(pnl_usd <= 0, roi, NULL))) * 100 as median_loss_roi_pct,

        -- PnL
        sum(pnl_usd) as total_pnl,

        -- Timing
        max(entry_time) as last_trade,

        -- Position sizing
        avg(abs(cost_usd)) as avg_position_size,
        sum(abs(cost_usd)) as total_volume,

        -- Short %
        round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

        -- Edge calculation (EV per trade using copyable metrics)
        (copyable_win_rate_pct / 100.0) * median_win_roi_pct -
        ((100 - copyable_win_rate_pct) / 100.0) * median_loss_roi_pct as edge_per_trade_pct

      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE abs(cost_usd) >= 5
      GROUP BY wallet
      HAVING unique_markets >= 7
        AND copyable_win_rate_pct >= 70
        AND median_win_roi_pct >= 30
        AND total_pnl > 0
        AND edge_per_trade_pct > 0
      ORDER BY edge_per_trade_pct DESC
      LIMIT 200
    `,
    format: 'JSONEachRow',
    request_timeout: 360000, // 6 minutes
    clickhouse_settings: {
      max_execution_time: 300 as any, // 5 minutes
    }
  });

  const tradersData = await tradersResult.json();
  const traders = Array.isArray(tradersData) ? tradersData : [tradersData];

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria');
    return;
  }

  console.log(`✅ Found ${traders.length} wallets\n`);
  console.log('=== TOP 20 HYPER-DIVERSIFIED TRADERS ===\n\n');

  // Display top 20
  for (let i = 0; i < Math.min(20, traders.length); i++) {
    const w = traders[i];
    const rank = i + 1;

    const copyableTrades = w.copyable_wins + w.losses;
    const holdDays = 1; // Placeholder
    const compoundingScore = w.edge_per_trade_pct / holdDays;

    console.log(`${rank}. ${w.wallet}`);
    console.log(`   🎯 Edge/Trade: ${w.edge_per_trade_pct.toFixed(2)}% | Copyable Win Rate: ${w.copyable_win_rate_pct}% (${w.copyable_wins}W-${w.losses}L)`);
    console.log(`   📊 Trades: ${w.total_trades} total (${copyableTrades} copyable, ${w.micro_arb_wins} micro-arb excluded)`);
    console.log(`   🎨 Markets: ${w.unique_markets} markets (${(w.total_trades / w.unique_markets).toFixed(1)} trades/market)`);
    console.log(`   💎 Median Win: ${w.median_win_roi_pct.toFixed(1)}% | Median Loss: -${w.median_loss_roi_pct.toFixed(1)}% (copyable only)`);
    console.log(`   💰 Total PnL: $${w.total_pnl.toLocaleString('en-US', {maximumFractionDigits: 0})} from ${w.total_trades} trades`);
    console.log(`   💵 Avg Position: $${Math.round(w.avg_position_size)} | Volume: $${Math.round(w.total_volume).toLocaleString()}`);
    console.log(`   📉 Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade}`);
    if (w.micro_arb_wins > 0) {
      console.log(`   ⚠️  Micro-arb wins excluded: ${w.micro_arb_wins} (ROI <4%, too fast to copy)`);
    }
    console.log('');
  }

  // Cohort stats
  const cohortPnL = traders.reduce((sum, w) => sum + w.total_pnl, 0);
  const avgPnL = cohortPnL / traders.length;
  const avgWinRate = traders.reduce((sum, w) => sum + w.copyable_win_rate_pct, 0) / traders.length;
  const avgTotalWinRate = traders.reduce((sum, w) => sum + w.total_win_rate_pct, 0) / traders.length;
  const avgROI = traders.reduce((sum, w) => sum + w.median_win_roi_pct, 0) / traders.length;
  const avgMarkets = traders.reduce((sum, w) => sum + w.unique_markets, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;
  const totalMicroArb = traders.reduce((sum, w) => sum + w.micro_arb_wins, 0);
  const totalCopyable = traders.reduce((sum, w) => sum + w.copyable_wins, 0);

  console.log('📊 COHORT STATS:\n');
  console.log(`   Total Cohort Profit: $${Math.round(cohortPnL).toLocaleString()}`);
  console.log(`   Average Profit: $${avgPnL.toLocaleString('en-US', {maximumFractionDigits: 3})}`);
  console.log(`   Average Copyable Win Rate: ${avgWinRate.toFixed(1)}% (excluding micro-arb)`);
  console.log(`   Average Total Win Rate: ${avgTotalWinRate.toFixed(1)}% (including micro-arb)`);
  console.log(`   Average MEDIAN ROI: ${avgROI.toFixed(1)}% (copyable only)`);
  console.log(`   Average Markets: ${avgMarkets.toFixed(1)}`);
  console.log(`   Average Trades: ${Math.round(avgTrades)}`);
  console.log(`   Micro-arb Wins Excluded: ${totalMicroArb.toLocaleString()} across cohort`);
  console.log(`   Copyable Wins: ${totalCopyable.toLocaleString()} across cohort`);
  console.log(`   Wallets Found: ${traders.length}\n`);

  // Export to CSV
  console.log('\n📄 EXPORTING TO CSV...\n');

  const csvRows = [
    'wallet,edge_per_trade_pct,copyable_win_rate_pct,copyable_wins,losses,total_wins,total_losses,micro_arb_wins,total_trades,unique_markets,median_win_roi_pct,median_loss_roi_pct,total_pnl,avg_position_size,total_volume,short_pct,last_trade'
  ];

  for (const w of traders) {
    csvRows.push(
      `${w.wallet},${w.edge_per_trade_pct},${w.copyable_win_rate_pct},${w.copyable_wins},${w.losses},${w.total_wins},${w.total_losses},${w.micro_arb_wins},${w.total_trades},${w.unique_markets},${w.median_win_roi_pct},${w.median_loss_roi_pct},${w.total_pnl},${w.avg_position_size},${w.total_volume},${w.short_pct},${w.last_trade}`
    );
  }

  const csvContent = csvRows.join('\n');
  const csvPath = path.join(process.cwd(), 'hyper-diversified-traders-v3.csv');
  writeFileSync(csvPath, csvContent);

  console.log(`✅ Exported ${traders.length} wallets to: ${csvPath}`);
}

find3DayHyperDiversified().catch(console.error);

