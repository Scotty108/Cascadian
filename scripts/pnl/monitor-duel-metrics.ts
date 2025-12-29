/**
 * DUEL Metrics Monitoring Script
 *
 * Daily monitoring for copy-trading grade metrics:
 * - Tier distribution drift (A+B %) day over day
 * - Median and p10 USDC coverage
 * - Distribution of abs(unmapped_net_cashflow) for rankable wallets
 * - Count of rankable wallets with trades_30d > 0
 * - Parity check sample
 *
 * Usage:
 *   npx tsx scripts/pnl/monitor-duel-metrics.ts [--days N]
 *
 * Run daily to catch silent regressions in data quality.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { createDuelEngine } from '../../lib/pnl/duelEngine';

const HISTORY_TABLE = 'wallet_duel_metrics_history';
const CLASSIFICATION_TABLE = 'wallet_classification_latest';

interface DailySnapshot {
  date: string;
  total_wallets: number;
  rankable_wallets: number;
  tier_a_count: number;
  tier_b_count: number;
  tier_c_count: number;
  tier_ab_pct: number;
  median_usdc_coverage: number;
  p10_usdc_coverage: number;
  avg_unmapped_cashflow_abs: number;
  max_unmapped_cashflow_abs: number;
  active_30d_count: number;
  active_30d_pct: number;
}

async function getTierDistribution(): Promise<{
  total: number;
  tier_a: number;
  tier_b: number;
  tier_c: number;
  tier_ab_pct: number;
}> {
  const query = `
    WITH latest AS (
      SELECT
        wallet_address,
        argMax(rankability_tier, computed_at) as tier,
        argMax(is_rankable, computed_at) as is_rankable
      FROM ${HISTORY_TABLE}
      GROUP BY wallet_address
    )
    SELECT
      count() as total,
      countIf(tier = 'A') as tier_a,
      countIf(tier = 'B') as tier_b,
      countIf(tier = 'C') as tier_c,
      round(countIf(tier IN ('A', 'B')) * 100.0 / count(), 2) as tier_ab_pct
    FROM latest
    WHERE is_rankable = 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0] || {};

  return {
    total: Number(row.total) || 0,
    tier_a: Number(row.tier_a) || 0,
    tier_b: Number(row.tier_b) || 0,
    tier_c: Number(row.tier_c) || 0,
    tier_ab_pct: Number(row.tier_ab_pct) || 0,
  };
}

async function getCoverageStats(): Promise<{
  median_usdc: number;
  p10_usdc: number;
  median_trade: number;
  p10_trade: number;
}> {
  const query = `
    WITH latest AS (
      SELECT
        wallet_address,
        argMax(usdc_coverage_pct, computed_at) as usdc_cov,
        argMax(trade_coverage_pct, computed_at) as trade_cov,
        argMax(is_rankable, computed_at) as is_rankable
      FROM ${HISTORY_TABLE}
      GROUP BY wallet_address
    )
    SELECT
      quantile(0.5)(usdc_cov) as median_usdc,
      quantile(0.1)(usdc_cov) as p10_usdc,
      quantile(0.5)(trade_cov) as median_trade,
      quantile(0.1)(trade_cov) as p10_trade
    FROM latest
    WHERE is_rankable = 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0] || {};

  return {
    median_usdc: Number(row.median_usdc) || 0,
    p10_usdc: Number(row.p10_usdc) || 0,
    median_trade: Number(row.median_trade) || 0,
    p10_trade: Number(row.p10_trade) || 0,
  };
}

async function getUnmappedCashflowStats(): Promise<{
  avg_abs: number;
  max_abs: number;
  p90_abs: number;
  p99_abs: number;
  over_200_count: number;
}> {
  const query = `
    WITH latest AS (
      SELECT
        wallet_address,
        argMax(abs(unmapped_net_cashflow), computed_at) as unmapped_abs,
        argMax(is_rankable, computed_at) as is_rankable
      FROM ${HISTORY_TABLE}
      GROUP BY wallet_address
    )
    SELECT
      round(avg(unmapped_abs), 2) as avg_abs,
      round(max(unmapped_abs), 2) as max_abs,
      round(quantile(0.9)(unmapped_abs), 2) as p90_abs,
      round(quantile(0.99)(unmapped_abs), 2) as p99_abs,
      countIf(unmapped_abs > 200) as over_200_count
    FROM latest
    WHERE is_rankable = 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0] || {};

  return {
    avg_abs: Number(row.avg_abs) || 0,
    max_abs: Number(row.max_abs) || 0,
    p90_abs: Number(row.p90_abs) || 0,
    p99_abs: Number(row.p99_abs) || 0,
    over_200_count: Number(row.over_200_count) || 0,
  };
}

async function getActivityStats(): Promise<{
  active_30d_count: number;
  active_30d_pct: number;
  total_volume_30d: number;
  avg_trades_30d: number;
}> {
  const query = `
    WITH latest AS (
      SELECT
        wallet_address,
        argMax(trades_30d, computed_at) as trades_30d,
        argMax(volume_30d, computed_at) as volume_30d,
        argMax(is_rankable, computed_at) as is_rankable
      FROM ${HISTORY_TABLE}
      GROUP BY wallet_address
    )
    SELECT
      countIf(trades_30d > 0) as active_30d_count,
      round(countIf(trades_30d > 0) * 100.0 / count(), 2) as active_30d_pct,
      round(sum(volume_30d), 2) as total_volume_30d,
      round(avg(trades_30d), 1) as avg_trades_30d
    FROM latest
    WHERE is_rankable = 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0] || {};

  return {
    active_30d_count: Number(row.active_30d_count) || 0,
    active_30d_pct: Number(row.active_30d_pct) || 0,
    total_volume_30d: Number(row.total_volume_30d) || 0,
    avg_trades_30d: Number(row.avg_trades_30d) || 0,
  };
}

async function getHistoricalTrend(days: number): Promise<DailySnapshot[]> {
  // Get daily snapshots for trend analysis
  const query = `
    WITH daily AS (
      SELECT
        toDate(computed_at) as day,
        wallet_address,
        argMax(rankability_tier, computed_at) as tier,
        argMax(usdc_coverage_pct, computed_at) as usdc_cov,
        argMax(abs(unmapped_net_cashflow), computed_at) as unmapped_abs,
        argMax(trades_30d, computed_at) as trades_30d,
        argMax(is_rankable, computed_at) as is_rankable
      FROM ${HISTORY_TABLE}
      WHERE computed_at >= now() - INTERVAL ${days} DAY
      GROUP BY toDate(computed_at), wallet_address
    )
    SELECT
      day,
      count() as total_wallets,
      countIf(is_rankable = 1) as rankable_wallets,
      countIf(tier = 'A' AND is_rankable = 1) as tier_a,
      countIf(tier = 'B' AND is_rankable = 1) as tier_b,
      countIf(tier = 'C' AND is_rankable = 1) as tier_c,
      round(countIf(tier IN ('A', 'B') AND is_rankable = 1) * 100.0 / countIf(is_rankable = 1), 2) as tier_ab_pct,
      round(quantileIf(0.5)(usdc_cov, is_rankable = 1), 2) as median_usdc,
      round(quantileIf(0.1)(usdc_cov, is_rankable = 1), 2) as p10_usdc,
      round(avgIf(unmapped_abs, is_rankable = 1), 2) as avg_unmapped_abs,
      round(maxIf(unmapped_abs, is_rankable = 1), 2) as max_unmapped_abs,
      countIf(trades_30d > 0 AND is_rankable = 1) as active_30d
    FROM daily
    GROUP BY day
    ORDER BY day DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    date: r.day,
    total_wallets: Number(r.total_wallets),
    rankable_wallets: Number(r.rankable_wallets),
    tier_a_count: Number(r.tier_a),
    tier_b_count: Number(r.tier_b),
    tier_c_count: Number(r.tier_c),
    tier_ab_pct: Number(r.tier_ab_pct),
    median_usdc_coverage: Number(r.median_usdc),
    p10_usdc_coverage: Number(r.p10_usdc),
    avg_unmapped_cashflow_abs: Number(r.avg_unmapped_abs),
    max_unmapped_cashflow_abs: Number(r.max_unmapped_abs),
    active_30d_count: Number(r.active_30d),
    active_30d_pct: Number(r.rankable_wallets) > 0 ? (Number(r.active_30d) * 100) / Number(r.rankable_wallets) : 0,
  }));
}

async function runParityCheck(sampleSize: number = 10): Promise<{
  checked: number;
  passed: number;
  failed: number;
  failures: Array<{ wallet: string; stored: number; fresh: number; delta: number }>;
}> {
  // Get random sample of recently computed wallets
  const sampleQuery = `
    SELECT wallet_address, realized_economic
    FROM ${HISTORY_TABLE}
    WHERE computed_at >= now() - INTERVAL 24 HOUR
    ORDER BY rand()
    LIMIT ${sampleSize}
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = (await sampleResult.json()) as any[];

  if (samples.length === 0) {
    return { checked: 0, passed: 0, failed: 0, failures: [] };
  }

  const engine = createDuelEngine();
  const failures: Array<{ wallet: string; stored: number; fresh: number; delta: number }> = [];
  let passed = 0;

  for (const sample of samples) {
    try {
      const fresh = await engine.compute(sample.wallet_address);
      const delta = Math.abs(fresh.realized_economic - Number(sample.realized_economic));

      if (delta <= 0.01) {
        passed++;
      } else {
        failures.push({
          wallet: sample.wallet_address,
          stored: Number(sample.realized_economic),
          fresh: fresh.realized_economic,
          delta,
        });
      }
    } catch (err: any) {
      console.error(`Parity check error for ${sample.wallet_address}: ${err.message}`);
    }
  }

  return {
    checked: samples.length,
    passed,
    failed: failures.length,
    failures,
  };
}

async function checkInvariants(): Promise<{
  trade_sum_mismatches: number;
  usdc_sum_mismatches: number;
  invalid_win_rates: number;
  samples_checked: number;
}> {
  // Check invariants on sample of 1000 wallets
  const query = `
    WITH latest AS (
      SELECT
        wallet_address,
        argMax(mapped_trades, computed_at) as mapped_trades,
        argMax(unmapped_trades, computed_at) as unmapped_trades,
        argMax(total_trades, computed_at) as total_trades,
        argMax(mapped_usdc, computed_at) as mapped_usdc,
        argMax(unmapped_usdc, computed_at) as unmapped_usdc,
        argMax(total_usdc, computed_at) as total_usdc,
        argMax(market_win_rate, computed_at) as market_win_rate,
        argMax(markets_won, computed_at) as markets_won,
        argMax(markets_lost, computed_at) as markets_lost,
        argMax(is_rankable, computed_at) as is_rankable
      FROM ${HISTORY_TABLE}
      GROUP BY wallet_address
    )
    SELECT
      countIf(mapped_trades + unmapped_trades != total_trades AND is_rankable = 1) as trade_mismatches,
      countIf(abs(mapped_usdc + unmapped_usdc - total_usdc) > 0.01 AND is_rankable = 1) as usdc_mismatches,
      countIf((market_win_rate < 0 OR market_win_rate > 1) AND is_rankable = 1) as invalid_rates,
      countIf(is_rankable = 1) as total_checked
    FROM latest
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0] || {};

  return {
    trade_sum_mismatches: Number(row.trade_mismatches) || 0,
    usdc_sum_mismatches: Number(row.usdc_mismatches) || 0,
    invalid_win_rates: Number(row.invalid_rates) || 0,
    samples_checked: Number(row.total_checked) || 0,
  };
}

function formatUSD(value: number): string {
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;

  console.log('='.repeat(100));
  console.log('DUEL METRICS MONITORING REPORT');
  console.log('='.repeat(100));
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('');

  // Current state
  console.log('CURRENT STATE');
  console.log('-'.repeat(50));

  const tierDist = await getTierDistribution();
  console.log(`\nTier Distribution (Rankable Only):`);
  console.log(`  Total Rankable: ${tierDist.total.toLocaleString()}`);
  console.log(`  Tier A: ${tierDist.tier_a.toLocaleString()} (${((tierDist.tier_a / tierDist.total) * 100).toFixed(1)}%)`);
  console.log(`  Tier B: ${tierDist.tier_b.toLocaleString()} (${((tierDist.tier_b / tierDist.total) * 100).toFixed(1)}%)`);
  console.log(`  Tier A+B: ${tierDist.tier_ab_pct}%`);

  const coverageStats = await getCoverageStats();
  console.log(`\nData Coverage:`);
  console.log(`  Median USDC Coverage: ${coverageStats.median_usdc.toFixed(2)}%`);
  console.log(`  P10 USDC Coverage: ${coverageStats.p10_usdc.toFixed(2)}%`);
  console.log(`  Median Trade Coverage: ${coverageStats.median_trade.toFixed(2)}%`);
  console.log(`  P10 Trade Coverage: ${coverageStats.p10_trade.toFixed(2)}%`);

  const unmappedStats = await getUnmappedCashflowStats();
  console.log(`\nUnmapped Cashflow (Rankable Only):`);
  console.log(`  Avg |unmapped|: ${formatUSD(unmappedStats.avg_abs)}`);
  console.log(`  Max |unmapped|: ${formatUSD(unmappedStats.max_abs)}`);
  console.log(`  P90 |unmapped|: ${formatUSD(unmappedStats.p90_abs)}`);
  console.log(`  P99 |unmapped|: ${formatUSD(unmappedStats.p99_abs)}`);
  console.log(`  Over $200: ${unmappedStats.over_200_count}`);

  const activityStats = await getActivityStats();
  console.log(`\n30-Day Activity:`);
  console.log(`  Active Wallets: ${activityStats.active_30d_count.toLocaleString()} (${activityStats.active_30d_pct}%)`);
  console.log(`  Total Volume 30d: ${formatUSD(activityStats.total_volume_30d)}`);
  console.log(`  Avg Trades 30d: ${activityStats.avg_trades_30d}`);

  // Historical trend
  console.log('\n');
  console.log('HISTORICAL TREND (Last ' + days + ' days)');
  console.log('-'.repeat(50));

  const trend = await getHistoricalTrend(days);
  if (trend.length > 0) {
    console.log('\n| Date       | Rankable | Tier A+B % | Med USDC | P10 USDC | Active 30d |');
    console.log('|------------|----------|------------|----------|----------|------------|');
    for (const day of trend.slice(0, 14)) {
      console.log(
        `| ${day.date} | ${String(day.rankable_wallets).padStart(8)} | ${String(day.tier_ab_pct + '%').padStart(10)} | ${String(day.median_usdc_coverage.toFixed(1) + '%').padStart(8)} | ${String(day.p10_usdc_coverage.toFixed(1) + '%').padStart(8)} | ${String(day.active_30d_count).padStart(10)} |`
      );
    }

    // Check for drift
    if (trend.length >= 2) {
      const latest = trend[0];
      const previous = trend[1];
      const tierDrift = latest.tier_ab_pct - previous.tier_ab_pct;
      const coverageDrift = latest.median_usdc_coverage - previous.median_usdc_coverage;

      if (Math.abs(tierDrift) > 5) {
        console.log(`\n⚠️  ALERT: Tier A+B drift of ${tierDrift > 0 ? '+' : ''}${tierDrift.toFixed(1)}% day-over-day`);
      }
      if (Math.abs(coverageDrift) > 2) {
        console.log(
          `\n⚠️  ALERT: Median USDC coverage drift of ${coverageDrift > 0 ? '+' : ''}${coverageDrift.toFixed(1)}% day-over-day`
        );
      }
    }
  }

  // Invariant checks
  console.log('\n');
  console.log('INVARIANT CHECKS');
  console.log('-'.repeat(50));

  const invariants = await checkInvariants();
  console.log(`\nChecked ${invariants.samples_checked.toLocaleString()} rankable wallets:`);
  console.log(`  Trade sum mismatches: ${invariants.trade_sum_mismatches}`);
  console.log(`  USDC sum mismatches: ${invariants.usdc_sum_mismatches}`);
  console.log(`  Invalid win rates: ${invariants.invalid_win_rates}`);

  if (
    invariants.trade_sum_mismatches > 0 ||
    invariants.usdc_sum_mismatches > 0 ||
    invariants.invalid_win_rates > 0
  ) {
    console.log('\n⚠️  ALERT: Invariant violations detected!');
  } else {
    console.log('\n✅ All invariants pass');
  }

  // Parity check
  console.log('\n');
  console.log('PARITY SPOT CHECK');
  console.log('-'.repeat(50));

  const parity = await runParityCheck(10);
  console.log(`\nChecked ${parity.checked} wallets:`);
  console.log(`  Passed: ${parity.passed}`);
  console.log(`  Failed: ${parity.failed}`);

  if (parity.failures.length > 0) {
    console.log('\nParity failures:');
    for (const f of parity.failures) {
      console.log(`  ${f.wallet}: stored=${formatUSD(f.stored)}, fresh=${formatUSD(f.fresh)}, Δ=${formatUSD(f.delta)}`);
    }
    console.log('\n⚠️  ALERT: Parity failures detected - possible logic drift');
  } else if (parity.checked > 0) {
    console.log('\n✅ All parity checks pass');
  }

  console.log('\n' + '='.repeat(100));
}

main().catch(console.error);
