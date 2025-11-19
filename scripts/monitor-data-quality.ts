#!/usr/bin/env npx tsx

/**
 * Data Quality Monitoring Script
 *
 * Runs resolution coverage and Polymarket parity tests on a schedule.
 * Logs results to MONITORING_LOG.json and alerts on degradation.
 *
 * Usage:
 *   npx tsx monitor-data-quality.ts [--continuous] [--interval=300]
 *
 * Options:
 *   --continuous: Run continuously (default: single run)
 *   --interval: Seconds between runs (default: 300 = 5 minutes)
 *   --alert-threshold: Coverage drop % to trigger alert (default: 5)
 *
 * Cron example (run every hour):
 *   0 * * * * cd /path/to/project && npx tsx monitor-data-quality.ts >> logs/monitoring.log 2>&1
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';

interface MonitoringResult {
  timestamp: string;
  resolution_coverage: {
    total_traded_markets: number;
    resolved_markets: number;
    coverage_pct: number;
    unresolved_markets: number;
  };
  wallet_parity: {
    wallet_address: string;
    polymarket_positions: number;
    our_positions: number;
    coverage_pct: number;
    match_quality: string;
  }[];
  dim_markets_stats: {
    total_markets: number;
    with_market_id_pct: number;
    with_resolved_at_pct: number;
    with_category_pct: number;
  };
  status: 'ok' | 'degraded' | 'critical';
  alerts: string[];
}

interface MonitoringLog {
  runs: MonitoringResult[];
  last_run: string;
  baseline?: MonitoringResult;
}

const MONITORING_LOG_PATH = resolve(process.cwd(), 'MONITORING_LOG.json');
const ALERT_THRESHOLD = parseFloat(process.argv.find(arg => arg.startsWith('--alert-threshold='))?.split('=')[1] || '5');

async function getResolutionCoverage(): Promise<MonitoringResult['resolution_coverage']> {
  const tradedResult = await clickhouse.query({
    query: `
      SELECT uniqExact(condition_id_norm) as total_markets
      FROM default.trade_direction_assignments
      WHERE length(replaceAll(condition_id_norm, '0x', '')) = 64
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });

  const tradedData = await tradedResult.json<Array<{ total_markets: string }>>();
  const totalTradedMarkets = parseInt(tradedData[0].total_markets);

  const resolvedResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as resolved_count
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow'
  });

  const resolvedData = await resolvedResult.json<Array<{ resolved_count: string }>>();
  const resolvedCount = parseInt(resolvedData[0].resolved_count);

  return {
    total_traded_markets: totalTradedMarkets,
    resolved_markets: resolvedCount,
    coverage_pct: (resolvedCount / totalTradedMarkets * 100),
    unresolved_markets: totalTradedMarkets - resolvedCount
  };
}

async function getWalletParity(): Promise<MonitoringResult['wallet_parity']> {
  // Test wallet: 0x4ce73141dbfce41e65db3723e31059a730f0abad
  const testWallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

  const result = await clickhouse.query({
    query: `
      SELECT uniqExact(condition_id_norm) as unique_markets
      FROM default.trade_direction_assignments
      WHERE wallet_address = '${testWallet}'
        AND length(replaceAll(condition_id_norm, '0x', '')) = 64
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<{ unique_markets: string }>>();
  const ourPositions = parseInt(data[0].unique_markets);

  // Expected from Polymarket UI: 2,816 positions
  const polymarketPositions = 2816;
  const coveragePct = (ourPositions / polymarketPositions * 100);

  return [{
    wallet_address: testWallet,
    polymarket_positions: polymarketPositions,
    our_positions: ourPositions,
    coverage_pct: coveragePct,
    match_quality: coveragePct >= 95 ? '✅ Excellent' :
                   coveragePct >= 80 ? '✅ Good' :
                   coveragePct >= 50 ? '⚠️  Fair' :
                   '❌ Poor'
  }];
}

async function getDimMarketsStats(): Promise<MonitoringResult['dim_markets_stats']> {
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(market_id != '') as with_market_id,
        countIf(resolved_at IS NOT NULL) as with_resolved_at,
        countIf(category != '') as with_category
      FROM default.dim_markets
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const d = data[0];
  const total = parseInt(d.total);

  return {
    total_markets: total,
    with_market_id_pct: (parseInt(d.with_market_id) / total * 100),
    with_resolved_at_pct: (parseInt(d.with_resolved_at) / total * 100),
    with_category_pct: (parseInt(d.with_category) / total * 100)
  };
}

function loadMonitoringLog(): MonitoringLog {
  if (existsSync(MONITORING_LOG_PATH)) {
    const content = readFileSync(MONITORING_LOG_PATH, 'utf-8');
    return JSON.parse(content);
  }
  return { runs: [], last_run: '' };
}

function saveMonitoringLog(log: MonitoringLog) {
  writeFileSync(MONITORING_LOG_PATH, JSON.stringify(log, null, 2));
}

function compareWithBaseline(current: MonitoringResult, baseline: MonitoringResult | undefined): string[] {
  const alerts: string[] = [];

  if (!baseline) return alerts;

  // Check resolution coverage degradation
  const resolutionDrop = baseline.resolution_coverage.coverage_pct - current.resolution_coverage.coverage_pct;
  if (resolutionDrop > ALERT_THRESHOLD) {
    alerts.push(`⚠️  Resolution coverage dropped ${resolutionDrop.toFixed(1)}% (${baseline.resolution_coverage.coverage_pct.toFixed(1)}% → ${current.resolution_coverage.coverage_pct.toFixed(1)}%)`);
  }

  // Check wallet parity degradation
  const walletDrop = baseline.wallet_parity[0].coverage_pct - current.wallet_parity[0].coverage_pct;
  if (walletDrop > ALERT_THRESHOLD) {
    alerts.push(`⚠️  Wallet coverage dropped ${walletDrop.toFixed(1)}% (${baseline.wallet_parity[0].coverage_pct.toFixed(1)}% → ${current.wallet_parity[0].coverage_pct.toFixed(1)}%)`);
  }

  // Check wallet parity improvement (ERC1155 backfill completed?)
  const walletGain = current.wallet_parity[0].coverage_pct - baseline.wallet_parity[0].coverage_pct;
  if (walletGain > 50) {
    alerts.push(`🎉 Wallet coverage IMPROVED ${walletGain.toFixed(1)}% (${baseline.wallet_parity[0].coverage_pct.toFixed(1)}% → ${current.wallet_parity[0].coverage_pct.toFixed(1)}%) - ERC1155 backfill likely complete!`);
  }

  // Check dim_markets stats
  const marketIdDrop = baseline.dim_markets_stats.with_market_id_pct - current.dim_markets_stats.with_market_id_pct;
  if (marketIdDrop > ALERT_THRESHOLD) {
    alerts.push(`⚠️  Market ID coverage dropped ${marketIdDrop.toFixed(1)}%`);
  }

  return alerts;
}

async function runMonitoring(): Promise<MonitoringResult> {
  console.log(`🔍 Running data quality monitoring at ${new Date().toISOString()}\n`);

  // Gather metrics
  const [resolutionCoverage, walletParity, dimMarketsStats] = await Promise.all([
    getResolutionCoverage(),
    getWalletParity(),
    getDimMarketsStats()
  ]);

  // Load previous runs
  const log = loadMonitoringLog();
  const baseline = log.baseline || log.runs[log.runs.length - 1];

  // Create current result
  const result: MonitoringResult = {
    timestamp: new Date().toISOString(),
    resolution_coverage: resolutionCoverage,
    wallet_parity: walletParity,
    dim_markets_stats: dimMarketsStats,
    status: 'ok',
    alerts: []
  };

  // Compare with baseline
  result.alerts = compareWithBaseline(result, baseline);

  // Determine status
  if (result.alerts.some(a => a.includes('⚠️'))) {
    result.status = 'degraded';
  }
  if (result.wallet_parity[0].coverage_pct < 5 || result.resolution_coverage.coverage_pct < 50) {
    result.status = 'critical';
  }

  // Print results
  console.log('📊 Resolution Coverage:');
  console.log(`   Total traded markets: ${resolutionCoverage.total_traded_markets.toLocaleString()}`);
  console.log(`   Resolved markets: ${resolutionCoverage.resolved_markets.toLocaleString()}`);
  console.log(`   Coverage: ${resolutionCoverage.coverage_pct.toFixed(1)}%`);
  console.log(`   Unresolved: ${resolutionCoverage.unresolved_markets.toLocaleString()}\n`);

  console.log('👛 Wallet Parity (Test: 0x4ce73141):');
  console.log(`   Polymarket positions: ${walletParity[0].polymarket_positions.toLocaleString()}`);
  console.log(`   Our positions: ${walletParity[0].our_positions.toLocaleString()}`);
  console.log(`   Coverage: ${walletParity[0].coverage_pct.toFixed(1)}%`);
  console.log(`   Quality: ${walletParity[0].match_quality}\n`);

  console.log('🗂️  dim_markets Stats:');
  console.log(`   Total markets: ${dimMarketsStats.total_markets.toLocaleString()}`);
  console.log(`   With market_id: ${dimMarketsStats.with_market_id_pct.toFixed(1)}%`);
  console.log(`   With resolved_at: ${dimMarketsStats.with_resolved_at_pct.toFixed(1)}%`);
  console.log(`   With category: ${dimMarketsStats.with_category_pct.toFixed(1)}%\n`);

  console.log(`Status: ${result.status.toUpperCase()}\n`);

  // Print alerts
  if (result.alerts.length > 0) {
    console.log('🚨 ALERTS:');
    result.alerts.forEach(alert => console.log(`   ${alert}`));
    console.log();
  }

  // Save to log
  log.runs.push(result);
  log.last_run = result.timestamp;

  // Set baseline on first run
  if (!log.baseline && log.runs.length === 1) {
    log.baseline = result;
    console.log('✅ Baseline established for future comparisons\n');
  }

  saveMonitoringLog(log);
  console.log(`✅ Monitoring log updated: ${MONITORING_LOG_PATH}\n`);

  return result;
}

async function main() {
  const continuous = process.argv.includes('--continuous');
  const interval = parseInt(process.argv.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '300') * 1000;

  if (continuous) {
    console.log(`🔄 Running in continuous mode (interval: ${interval/1000}s)\n`);

    while (true) {
      await runMonitoring();
      console.log(`⏳ Waiting ${interval/1000}s until next run...\n`);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  } else {
    await runMonitoring();
  }
}

main().catch(console.error);
