#!/usr/bin/env npx tsx
/**
 * Compute CLOB Wallet Pool Metrics
 *
 * Uses a CASCADING FILTER PIPELINE for efficiency:
 * 1. Stage 1: Active in last N days (cheap time filter)
 * 2. Stage 2: Min trades threshold (cheap count)
 * 3. Stage 3: Min volume threshold (cheap sum)
 * 4. Stage 4: Full metrics computation (expensive - only on filtered candidates)
 *
 * This approach scales to the full 1.8M wallet universe by filtering cheaply first.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { computeClobWalletMetrics, ClobWalletMetrics } from '../lib/pnl/clobWalletMetrics';

interface FilterConfig {
  daysActive: number;      // Stage 1: Recent activity
  minTrades: number;       // Stage 2: Minimum trade count
  maxTrades: number;       // Stage 2b: Maximum trade count (filter out bots)
  minVolumeUsd: number;    // Stage 3: Minimum trading volume
  processLimit: number;    // How many wallets to process (for metrics computation)
}

interface WalletCandidate {
  wallet: string;
  trades: number;
  volume_usd: number;
  last_trade_time: Date;
}

interface StageStats {
  stage: number;
  name: string;
  input_count: number;
  output_count: number;
  duration_ms: number;
}

/**
 * Cascading filter pipeline - each stage is cheaper than the next.
 * All filtering happens in a single optimized ClickHouse query.
 */
async function findClobWallets(config: FilterConfig): Promise<{ candidates: WalletCandidate[], stats: StageStats[] }> {
  const stats: StageStats[] = [];
  const startTime = Date.now();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.daysActive);

  // Single optimized query with all cheap filters
  // ClickHouse executes predicates in order, so time filter runs first (indexed)
  const query = `
    WITH deduped AS (
      -- Stage 1: Time filter + basic aggregation
      SELECT
        event_id,
        any(trader_wallet) as trader_wallet,
        any(toFloat64(usdc_amount)) / 1e6 as usdc,
        any(trade_time) as trade_time_val
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= toDateTime('${cutoffDate.toISOString().slice(0, 19).replace('T', ' ')}')
      GROUP BY event_id
    ),
    wallet_agg AS (
      SELECT
        trader_wallet as wallet,
        count() as trades,
        sum(usdc) as volume_usd,
        max(trade_time_val) as last_trade_time
      FROM deduped
      GROUP BY trader_wallet
      -- Stage 2: Min/Max trades filter
      HAVING trades >= ${config.minTrades}
        AND trades <= ${config.maxTrades}
        -- Stage 3: Min volume filter
        AND volume_usd >= ${config.minVolumeUsd}
    )
    SELECT
      wallet,
      trades,
      volume_usd,
      last_trade_time
    FROM wallet_agg
    ORDER BY volume_usd DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const queryDuration = Date.now() - startTime;

  // Record stage stats (we can't measure intermediate counts in single query, but report final)
  stats.push({
    stage: 1,
    name: `Active last ${config.daysActive} days`,
    input_count: -1, // Unknown without separate query
    output_count: -1,
    duration_ms: 0,
  });
  stats.push({
    stage: 2,
    name: `Min ${config.minTrades} trades`,
    input_count: -1,
    output_count: -1,
    duration_ms: 0,
  });
  stats.push({
    stage: 3,
    name: `Min $${config.minVolumeUsd.toLocaleString()} volume`,
    input_count: -1,
    output_count: rows.length,
    duration_ms: queryDuration,
  });

  const candidates = rows.map(r => ({
    wallet: r.wallet,
    trades: +r.trades,
    volume_usd: +r.volume_usd,
    last_trade_time: new Date(r.last_trade_time),
  }));

  return { candidates, stats };
}

// Parse command line args for filter configuration
function parseArgs(): FilterConfig {
  const args = process.argv.slice(2);
  const config: FilterConfig = {
    daysActive: 10,       // Default: active in last 10 days
    minTrades: 10,        // Default: minimum 10 trades
    maxTrades: 1000000,   // Default: no max trades filter
    minVolumeUsd: 0,      // Default: no volume filter
    processLimit: 500,    // Default: process top 500 by volume
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--days' && args[i + 1]) {
      config.daysActive = parseInt(args[++i], 10);
    } else if (arg === '--min-trades' && args[i + 1]) {
      config.minTrades = parseInt(args[++i], 10);
    } else if (arg === '--max-trades' && args[i + 1]) {
      config.maxTrades = parseInt(args[++i], 10);
    } else if (arg === '--min-volume' && args[i + 1]) {
      config.minVolumeUsd = parseFloat(args[++i]);
    } else if (arg === '--process' && args[i + 1]) {
      config.processLimit = parseInt(args[++i], 10);
    } else if (arg === '--help') {
      console.log(`
CLOB Wallet Pool Metrics - Cascading Filter Pipeline

Usage: npx tsx scripts/compute-clob-wallet-pool.ts [options]

Options:
  --days N           Active in last N days (default: 10)
  --min-trades N     Minimum trade count (default: 10)
  --max-trades N     Maximum trade count (default: unlimited)
  --min-volume N     Minimum volume in USD (default: 0)
  --process N        Number of wallets to process for full metrics (default: 500)
  --help             Show this help

The script first finds ALL qualifying wallets, then processes the top N by volume.

Examples:
  # Default: Last 10 days, >10 trades, process top 500 by volume
  npx tsx scripts/compute-clob-wallet-pool.ts

  # Process more wallets
  npx tsx scripts/compute-clob-wallet-pool.ts --process 2000

  # Filter to high volume wallets only
  npx tsx scripts/compute-clob-wallet-pool.ts --min-volume 10000 --process 1000

  # Active traders: Last 3 days, >50 trades
  npx tsx scripts/compute-clob-wallet-pool.ts --days 3 --min-trades 50
`);
      process.exit(0);
    }
  }

  return config;
}

async function main() {
  const filterConfig = parseArgs();

  console.log('='.repeat(80));
  console.log('CLOB Wallet Pool Metrics - Cascading Filter Pipeline');
  console.log('='.repeat(80));
  console.log('');
  console.log('Filter Configuration:');
  console.log(`  Active in last: ${filterConfig.daysActive} days`);
  console.log(`  Min trades:     ${filterConfig.minTrades}`);
  console.log(`  Max trades:     ${filterConfig.maxTrades.toLocaleString()}`);
  console.log(`  Min volume:     $${filterConfig.minVolumeUsd.toLocaleString()}`);
  console.log(`  Process limit:  ${filterConfig.processLimit} (top by volume)`);
  console.log('');

  // Stage 1-3: Find candidates using cascading filters (cheap predicates first)
  console.log('Stages 1-3: Applying cascading filters...');
  const startFilter = Date.now();
  const { candidates, stats } = await findClobWallets(filterConfig);
  const filterDuration = Date.now() - startFilter;
  console.log(`  Filter query completed in ${filterDuration}ms`);
  console.log(`  Found ${candidates.length.toLocaleString()} qualifying wallets`);
  console.log('');

  // Show top candidates by volume before processing
  if (candidates.length > 0) {
    console.log('Top 10 candidates by volume:');
    for (const c of candidates.slice(0, 10)) {
      console.log(`  ${c.wallet.substring(0, 10)}...${c.wallet.slice(-6)} | vol=$${c.volume_usd.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(12)} | trades=${c.trades}`);
    }
    console.log('');
  }

  // Stage 4: Compute full metrics for top N candidates (expensive - only on limited set)
  const walletsToProcess = candidates.slice(0, filterConfig.processLimit);
  console.log(`Stage 4: Computing full metrics for ${walletsToProcess.length.toLocaleString()} of ${candidates.length.toLocaleString()} wallets...`);
  console.log('');

  const results: ClobWalletMetrics[] = [];
  let processed = 0;
  let errors = 0;
  let negativePnl = 0;
  const startMetrics = Date.now();

  for (const candidate of walletsToProcess) {
    try {
      const metrics = await computeClobWalletMetrics(candidate.wallet);

      // Filter to positive PnL
      if (metrics.performance.total_pnl > 0) {
        results.push(metrics);
      } else {
        negativePnl++;
      }
    } catch (e) {
      errors++;
    }

    processed++;
    if (processed % 25 === 0 || processed === walletsToProcess.length) {
      const elapsed = ((Date.now() - startMetrics) / 1000).toFixed(1);
      const rate = (processed / parseFloat(elapsed)).toFixed(1);
      console.log(`  Processed ${processed}/${walletsToProcess.length} wallets (${results.length} positive PnL, ${negativePnl} negative, ${errors} errors) [${elapsed}s, ${rate}/s]`);
    }
  }

  const metricsDuration = Date.now() - startMetrics;
  console.log('');
  console.log(`FINAL SUMMARY`);
  console.log('='.repeat(40));
  console.log(`  Total qualifying:     ${candidates.length.toLocaleString()}`);
  console.log(`  Wallets processed:    ${walletsToProcess.length.toLocaleString()}`);
  console.log(`  Positive PnL:     ${results.length}`);
  console.log(`  Negative PnL:     ${negativePnl}`);
  console.log(`  Errors:           ${errors}`);
  console.log('');

  if (results.length === 0) {
    console.log('No positive PnL wallets found.');
    process.exit(0);
  }

  // Sort by PnL descending
  results.sort((a, b) => b.performance.total_pnl - a.performance.total_pnl);

  // Print top 20 wallets
  console.log('Top 20 Positive PnL CLOB Wallets:');
  console.log('='.repeat(80));
  console.log('');

  for (const m of results.slice(0, 20)) {
    console.log(`Wallet: ${m.wallet}`);
    console.log(`  Type: ${m.wallet_type} | Method: ${m.pnl_method}`);
    console.log(`  Strategy: ${m.fingerprint.strategy_type}`);
    console.log('');
    console.log(`  PERFORMANCE`);
    console.log(`    PnL: $${m.performance.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`    Win Rate: ${(m.performance.win_rate * 100).toFixed(1)}% (${m.performance.wins}W/${m.performance.losses}L)`);
    console.log(`    ROI: ${(m.performance.roi_mean * 100).toFixed(1)}%`);
    console.log(`    Expectancy: ${(m.performance.expectancy * 100).toFixed(2)}%`);
    console.log('');
    console.log(`  EDGE & SKILL`);
    console.log(`    Entry Price: ${m.edge.avg_entry_price.toFixed(3)}`);
    console.log(`    Win Entry Edge: ${(m.edge.avg_win_entry_edge * 100).toFixed(1)}%`);
    console.log(`    Skill Score: ${m.edge.skill_score.toFixed(3)}`);
    console.log('');
    console.log(`  RISK`);
    console.log(`    Sharpe: ${m.risk.sharpe_proxy.toFixed(2)} | Sortino: ${m.risk.sortino_proxy.toFixed(2)}`);
    console.log(`    Max DD: $${m.risk.max_drawdown_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${(m.risk.max_drawdown_pct * 100).toFixed(1)}%)`);
    console.log('');
    console.log(`  CONSISTENCY`);
    console.log(`    Max Win Streak: ${m.consistency.max_win_streak} | Max Loss Streak: ${m.consistency.max_loss_streak}`);
    console.log(`    ROI Consistency: ${(m.consistency.roi_consistency * 100).toFixed(1)}%`);
    console.log('');
    console.log(`  FINGERPRINT`);
    console.log(`    Maker/Taker: ${(m.fingerprint.maker_ratio * 100).toFixed(0)}%/${(m.fingerprint.taker_ratio * 100).toFixed(0)}%`);
    console.log(`    Position HHI: ${m.fingerprint.position_concentration_hhi.toFixed(3)}`);
    console.log(`    Positions/Day: ${m.fingerprint.avg_positions_per_day.toFixed(2)}`);
    console.log('');
    console.log('-'.repeat(80));
  }

  // Aggregate stats
  console.log('');
  console.log('AGGREGATE STATISTICS (Positive PnL Wallets)');
  console.log('='.repeat(80));

  const avgPnl = results.reduce((sum, m) => sum + m.performance.total_pnl, 0) / results.length;
  const avgWinRate = results.reduce((sum, m) => sum + m.performance.win_rate, 0) / results.length;
  const avgRoi = results.reduce((sum, m) => sum + m.performance.roi_mean, 0) / results.length;
  const avgSharpe = results.reduce((sum, m) => sum + m.risk.sharpe_proxy, 0) / results.length;
  const avgSkillScore = results.reduce((sum, m) => sum + m.edge.skill_score, 0) / results.length;

  // Strategy type distribution
  const strategyDist: Record<string, number> = {};
  for (const m of results) {
    strategyDist[m.fingerprint.strategy_type] = (strategyDist[m.fingerprint.strategy_type] || 0) + 1;
  }

  console.log('');
  console.log(`  Total Wallets:    ${results.length}`);
  console.log(`  Total PnL:        $${results.reduce((sum, m) => sum + m.performance.total_pnl, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Avg PnL:          $${avgPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Avg Win Rate:     ${(avgWinRate * 100).toFixed(1)}%`);
  console.log(`  Avg ROI:          ${(avgRoi * 100).toFixed(1)}%`);
  console.log(`  Avg Sharpe:       ${avgSharpe.toFixed(2)}`);
  console.log(`  Avg Skill Score:  ${avgSkillScore.toFixed(3)}`);
  console.log('');
  console.log('  Strategy Distribution:');
  for (const [strategy, count] of Object.entries(strategyDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${strategy.padEnd(20)} ${count} (${(count / results.length * 100).toFixed(1)}%)`);
  }

  console.log('');
  console.log('TIMING:');
  console.log(`  Filter stages (1-3): ${filterDuration}ms`);
  console.log(`  Metrics stage (4):   ${(metricsDuration / 1000).toFixed(1)}s`);
  console.log(`  Total time:          ${((filterDuration + metricsDuration) / 1000).toFixed(1)}s`);
  console.log('');
  console.log('Done!');

  process.exit(0);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
