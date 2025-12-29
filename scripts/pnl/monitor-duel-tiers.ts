/**
 * Monitor DUEL Tier Distribution
 *
 * Outputs current tier distribution and detects significant changes.
 * Run daily or after major data updates to track coverage quality.
 *
 * Usage:
 *   npx tsx scripts/pnl/monitor-duel-tiers.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const TABLE_NAME = 'wallet_duel_metrics_latest';

interface TierStats {
  tier: string;
  wallet_count: number;
  rankable_count: number;
  avg_usdc_coverage: number;
  avg_trade_coverage: number;
  total_economic_pnl: number;
  avg_economic_pnl: number;
  median_economic_pnl: number;
  total_volume: number;
}

interface CoverageStats {
  avg_coverage: number;
  min_coverage: number;
  max_coverage: number;
  p10_coverage: number;
  p50_coverage: number;
  p90_coverage: number;
}

function formatUSD(value: number): string {
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function getTierDistribution(): Promise<TierStats[]> {
  const query = `
    SELECT
      rankability_tier as tier,
      count() as wallet_count,
      countIf(is_rankable = 1) as rankable_count,
      round(avg(usdc_coverage_pct), 2) as avg_usdc_coverage,
      round(avg(trade_coverage_pct), 2) as avg_trade_coverage,
      round(sum(realized_economic), 2) as total_economic_pnl,
      round(avg(realized_economic), 2) as avg_economic_pnl,
      round(median(realized_economic), 2) as median_economic_pnl,
      round(sum(total_volume), 2) as total_volume
    FROM ${TABLE_NAME} FINAL
    GROUP BY rankability_tier
    ORDER BY rankability_tier
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as TierStats[];
}

async function getCoverageStats(): Promise<CoverageStats> {
  const query = `
    SELECT
      round(avg(usdc_coverage_pct), 2) as avg_coverage,
      round(min(usdc_coverage_pct), 2) as min_coverage,
      round(max(usdc_coverage_pct), 2) as max_coverage,
      round(quantile(0.10)(usdc_coverage_pct), 2) as p10_coverage,
      round(quantile(0.50)(usdc_coverage_pct), 2) as p50_coverage,
      round(quantile(0.90)(usdc_coverage_pct), 2) as p90_coverage
    FROM ${TABLE_NAME} FINAL
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return ((await result.json()) as CoverageStats[])[0];
}

async function getDataFreshness(): Promise<{ oldest: string; newest: string; avgAgeHours: number }> {
  const query = `
    SELECT
      min(computed_at) as oldest,
      max(computed_at) as newest,
      round(avg(dateDiff('hour', computed_at, now())), 1) as avg_age_hours
    FROM ${TABLE_NAME} FINAL
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0];
  return {
    oldest: row.oldest,
    newest: row.newest,
    avgAgeHours: Number(row.avg_age_hours),
  };
}

async function getRankabilityBreakdown(): Promise<void> {
  // Why are some wallets not rankable?
  const query = `
    SELECT
      CASE
        WHEN is_clob_only = 0 THEN 'CTF-active (not CLOB-only)'
        WHEN clob_trade_count < 10 THEN 'Insufficient trades (<10)'
        WHEN rankability_tier = 'C' THEN 'Low coverage (Tier C)'
        ELSE 'Unknown'
      END as reason,
      count() as wallet_count
    FROM ${TABLE_NAME} FINAL
    WHERE is_rankable = 0
    GROUP BY reason
    ORDER BY wallet_count DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('\nNon-Rankable Wallet Breakdown:');
  console.log('| Reason                            | Count   |');
  console.log('|-----------------------------------|---------|');
  for (const row of rows) {
    console.log(`| ${row.reason.padEnd(33)} | ${String(row.wallet_count).padStart(7)} |`);
  }
}

async function getTopMovers(): Promise<void> {
  // Top 5 by absolute PnL in each direction
  const topWinnersQuery = `
    SELECT wallet_address, realized_economic, total_volume, rankability_tier
    FROM ${TABLE_NAME} FINAL
    WHERE is_rankable = 1
    ORDER BY realized_economic DESC
    LIMIT 5
  `;

  const topLosersQuery = `
    SELECT wallet_address, realized_economic, total_volume, rankability_tier
    FROM ${TABLE_NAME} FINAL
    WHERE is_rankable = 1
    ORDER BY realized_economic ASC
    LIMIT 5
  `;

  const winnersResult = await clickhouse.query({ query: topWinnersQuery, format: 'JSONEachRow' });
  const winners = (await winnersResult.json()) as any[];

  const losersResult = await clickhouse.query({ query: topLosersQuery, format: 'JSONEachRow' });
  const losers = (await losersResult.json()) as any[];

  console.log('\nTop 5 Winners (Rankable):');
  console.log('| Wallet (12)      | Economic PnL   | Volume         | Tier |');
  console.log('|------------------|----------------|----------------|------|');
  for (const w of winners) {
    console.log(
      `| ${w.wallet_address.slice(0, 12)}..    | ${formatUSD(w.realized_economic).padStart(14)} | ${formatUSD(w.total_volume).padStart(14)} |   ${w.rankability_tier}  |`
    );
  }

  console.log('\nTop 5 Losers (Rankable):');
  console.log('| Wallet (12)      | Economic PnL   | Volume         | Tier |');
  console.log('|------------------|----------------|----------------|------|');
  for (const l of losers) {
    console.log(
      `| ${l.wallet_address.slice(0, 12)}..    | ${formatUSD(l.realized_economic).padStart(14)} | ${formatUSD(l.total_volume).padStart(14)} |   ${l.rankability_tier}  |`
    );
  }
}

async function main() {
  console.log('='.repeat(100));
  console.log('DUEL METRICS MONITORING REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(100));

  // Check if table exists
  const checkQuery = `SELECT count() as cnt FROM system.tables WHERE name = '${TABLE_NAME}'`;
  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const tableExists = ((await checkResult.json()) as any[])[0]?.cnt > 0;

  if (!tableExists) {
    console.log(`\nERROR: Table ${TABLE_NAME} does not exist.`);
    console.log('Run: npx tsx scripts/pnl/build-duel-metrics-table.ts');
    return;
  }

  // Data freshness
  const freshness = await getDataFreshness();
  console.log('\n--- Data Freshness ---');
  console.log(`Oldest entry: ${freshness.oldest}`);
  console.log(`Newest entry: ${freshness.newest}`);
  console.log(`Average age: ${freshness.avgAgeHours} hours`);

  // Tier distribution
  const tiers = await getTierDistribution();
  const totalWallets = tiers.reduce((s, t) => s + Number(t.wallet_count), 0);
  const totalRankable = tiers.reduce((s, t) => s + Number(t.rankable_count), 0);

  console.log('\n--- Tier Distribution ---');
  console.log(`Total wallets: ${totalWallets.toLocaleString()}`);
  console.log(`Total rankable: ${totalRankable.toLocaleString()} (${((totalRankable / totalWallets) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('| Tier | Wallets | Rankable | Avg USDC Cov | Avg Trade Cov | Median Econ PnL |');
  console.log('|------|---------|----------|--------------|---------------|-----------------|');
  for (const t of tiers) {
    console.log(
      `|   ${t.tier}  | ${String(t.wallet_count).padStart(7)} | ${String(t.rankable_count).padStart(8)} | ${String(t.avg_usdc_coverage + '%').padStart(12)} | ${String(t.avg_trade_coverage + '%').padStart(13)} | ${formatUSD(t.median_economic_pnl).padStart(15)} |`
    );
  }

  // Coverage percentiles
  const coverage = await getCoverageStats();
  console.log('\n--- USDC Coverage Percentiles ---');
  console.log(`P10: ${coverage.p10_coverage}%`);
  console.log(`P50 (median): ${coverage.p50_coverage}%`);
  console.log(`P90: ${coverage.p90_coverage}%`);
  console.log(`Range: ${coverage.min_coverage}% - ${coverage.max_coverage}%`);

  // Non-rankable breakdown
  await getRankabilityBreakdown();

  // Top movers
  await getTopMovers();

  // Alerts
  console.log('\n--- Alerts ---');
  const alerts: string[] = [];

  // Alert: Data staleness
  if (freshness.avgAgeHours > 24) {
    alerts.push(`DATA STALE: Average entry age is ${freshness.avgAgeHours} hours (>24h threshold)`);
  }

  // Alert: Low rankable percentage
  const rankablePct = (totalRankable / totalWallets) * 100;
  if (rankablePct < 50) {
    alerts.push(`LOW RANKABLE: Only ${rankablePct.toFixed(1)}% of wallets are rankable (<50% threshold)`);
  }

  // Alert: Tier C dominance
  const tierC = tiers.find((t) => t.tier === 'C');
  if (tierC) {
    const tierCPct = (Number(tierC.wallet_count) / totalWallets) * 100;
    if (tierCPct > 30) {
      alerts.push(`HIGH TIER C: ${tierCPct.toFixed(1)}% of wallets are Tier C (>30% threshold)`);
    }
  }

  if (alerts.length === 0) {
    console.log('No alerts - all metrics within normal ranges.');
  } else {
    for (const alert of alerts) {
      console.log(`[ALERT] ${alert}`);
    }
  }

  console.log('\n' + '='.repeat(100));
}

main().catch(console.error);
