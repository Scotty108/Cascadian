#!/usr/bin/env tsx
/**
 * V3 Daily Monitoring Script - V2 vs V3 PnL Comparison
 *
 * Compares V2 and V3 PnL views daily to detect regressions or anomalies
 *
 * Alert Thresholds:
 * - Position delta > 10%
 * - Absolute PnL delta > $100k
 *
 * Output: /tmp/v3_daily_monitoring_{date}.txt
 *
 * Recommended Schedule: Daily at midnight PST via cron
 * Example cron: 0 0 * * * /path/to/scripts/monitor-v3-daily-diff.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

interface DailyComparison {
  date: string;
  v2_positions: number;
  v3_positions: number;
  v2_realized_pnl: number;
  v3_realized_pnl: number;
  position_delta: number;
  position_delta_pct: number;
  pnl_delta: number;
  pnl_delta_pct: number;
  alert: boolean;
  alert_reason?: string;
}

const POSITION_DELTA_THRESHOLD = 0.10; // 10%
const PNL_DELTA_THRESHOLD = 100000; // $100k

async function getDailyComparison(date: string): Promise<DailyComparison> {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateStr = nextDate.toISOString().split('T')[0];

  // V2 query
  const v2Query = `
    SELECT
      COUNT(*) as position_count,
      SUM(realized_pnl_usd) as total_pnl
    FROM pm_wallet_market_pnl_v2
    WHERE
      first_trade_at >= {date:String}
      AND first_trade_at < {next_date:String}
  `;

  // V3 query
  const v3Query = `
    SELECT
      COUNT(*) as position_count,
      SUM(realized_pnl_usd) as total_pnl
    FROM vw_wallet_market_pnl_v3
    WHERE
      first_trade_at >= {date:String}
      AND first_trade_at < {next_date:String}
  `;

  const params = {
    date,
    next_date: nextDateStr,
  };

  const [v2Result, v3Result] = await Promise.all([
    clickhouse.query({ query: v2Query, query_params: params, format: 'JSONEachRow' }),
    clickhouse.query({ query: v3Query, query_params: params, format: 'JSONEachRow' }),
  ]);

  const v2Data = await v2Result.json() as any[];
  const v3Data = await v3Result.json() as any[];

  const v2Positions = parseInt(v2Data[0]?.position_count || '0');
  const v3Positions = parseInt(v3Data[0]?.position_count || '0');
  const v2Pnl = parseFloat(v2Data[0]?.total_pnl || '0');
  const v3Pnl = parseFloat(v3Data[0]?.total_pnl || '0');

  const positionDelta = v3Positions - v2Positions;
  const positionDeltaPct = v2Positions > 0 ? (positionDelta / v2Positions) : 0;
  const pnlDelta = v3Pnl - v2Pnl;
  const pnlDeltaPct = v2Pnl !== 0 ? (pnlDelta / Math.abs(v2Pnl)) : 0;

  // Alert logic
  let alert = false;
  const alertReasons: string[] = [];

  if (positionDeltaPct < -POSITION_DELTA_THRESHOLD) {
    alert = true;
    alertReasons.push(`Position delta ${(positionDeltaPct * 100).toFixed(2)}% < -10%`);
  }

  if (Math.abs(pnlDelta) > PNL_DELTA_THRESHOLD) {
    alert = true;
    alertReasons.push(`Absolute PnL delta $${Math.abs(pnlDelta).toLocaleString()} > $100k`);
  }

  return {
    date,
    v2_positions: v2Positions,
    v3_positions: v3Positions,
    v2_realized_pnl: v2Pnl,
    v3_realized_pnl: v3Pnl,
    position_delta: positionDelta,
    position_delta_pct: positionDeltaPct,
    pnl_delta: pnlDelta,
    pnl_delta_pct: pnlDeltaPct,
    alert,
    alert_reason: alertReasons.length > 0 ? alertReasons.join('; ') : undefined,
  };
}

async function main() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  console.log('═'.repeat(80));
  console.log('V3 Daily Monitoring - V2 vs V3 PnL Comparison');
  console.log('═'.repeat(80));
  console.log(`Date: ${dateStr} (PST)`);
  console.log('');

  // Compare last 7 days
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  console.log(`Comparing V2 vs V3 for last 7 days...\n`);

  const comparisons: DailyComparison[] = [];

  for (const day of days) {
    const comparison = await getDailyComparison(day);
    comparisons.push(comparison);
  }

  // Print results
  console.log('═'.repeat(80));
  console.log('DAILY COMPARISON RESULTS');
  console.log('═'.repeat(80));
  console.log('');

  console.log('Date          V2 Pos    V3 Pos    Delta    Delta%    V2 PnL        V3 PnL        Delta     Alert');
  console.log('─'.repeat(120));

  let alertCount = 0;

  for (const comp of comparisons) {
    const date = comp.date;
    const v2Pos = comp.v2_positions.toString().padStart(8);
    const v3Pos = comp.v3_positions.toString().padStart(8);
    const delta = comp.position_delta.toString().padStart(8);
    const deltaPct = (comp.position_delta_pct * 100).toFixed(1).padStart(7) + '%';
    const v2Pnl = `$${comp.v2_realized_pnl.toFixed(2)}`.padStart(14);
    const v3Pnl = `$${comp.v3_realized_pnl.toFixed(2)}`.padStart(14);
    const pnlDelta = `$${comp.pnl_delta.toFixed(2)}`.padStart(12);
    const alertFlag = comp.alert ? '⚠️ ALERT' : '✅';

    console.log(`${date}  ${v2Pos}  ${v3Pos}  ${delta}  ${deltaPct}  ${v2Pnl}  ${v3Pnl}  ${pnlDelta}  ${alertFlag}`);

    if (comp.alert) {
      console.log(`  └─ ${comp.alert_reason}`);
      alertCount++;
    }
  }

  console.log('─'.repeat(120));
  console.log('');

  // Summary statistics
  const totalV2Positions = comparisons.reduce((sum, c) => sum + c.v2_positions, 0);
  const totalV3Positions = comparisons.reduce((sum, c) => sum + c.v3_positions, 0);
  const totalV2Pnl = comparisons.reduce((sum, c) => sum + c.v2_realized_pnl, 0);
  const totalV3Pnl = comparisons.reduce((sum, c) => sum + c.v3_realized_pnl, 0);

  console.log('═'.repeat(80));
  console.log('7-DAY SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Total V2 Positions: ${totalV2Positions.toLocaleString()}`);
  console.log(`Total V3 Positions: ${totalV3Positions.toLocaleString()}`);
  console.log(`Position Improvement: +${(totalV3Positions - totalV2Positions).toLocaleString()}`);
  console.log('');
  console.log(`Total V2 PnL: $${totalV2Pnl.toFixed(2)}`);
  console.log(`Total V3 PnL: $${totalV3Pnl.toFixed(2)}`);
  console.log(`PnL Delta: $${(totalV3Pnl - totalV2Pnl).toFixed(2)}`);
  console.log('');
  console.log(`Alert Count: ${alertCount} / ${comparisons.length} days`);
  console.log(`Status: ${alertCount === 0 ? '✅ ALL CLEAR' : '⚠️ ALERTS DETECTED'}`);
  console.log('');

  // Generate report
  const reportLines: string[] = [];
  reportLines.push('# V3 Daily Monitoring Report');
  reportLines.push('');
  reportLines.push(`**Date:** ${dateStr} (PST)`);
  reportLines.push(`**Period:** Last 7 days`);
  reportLines.push(`**Status:** ${alertCount === 0 ? '✅ ALL CLEAR' : `⚠️ ${alertCount} ALERTS`}`);
  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');
  reportLines.push('## Daily Comparison');
  reportLines.push('');
  reportLines.push('| Date | V2 Positions | V3 Positions | Delta | Delta % | V2 PnL | V3 PnL | PnL Delta | Alert |');
  reportLines.push('|------|--------------|--------------|-------|---------|--------|--------|-----------|-------|');

  for (const comp of comparisons) {
    const alertIcon = comp.alert ? '⚠️' : '✅';
    reportLines.push(`| ${comp.date} | ${comp.v2_positions.toLocaleString()} | ${comp.v3_positions.toLocaleString()} | +${comp.position_delta.toLocaleString()} | +${(comp.position_delta_pct * 100).toFixed(1)}% | $${comp.v2_realized_pnl.toFixed(2)} | $${comp.v3_realized_pnl.toFixed(2)} | $${comp.pnl_delta.toFixed(2)} | ${alertIcon} |`);

    if (comp.alert && comp.alert_reason) {
      reportLines.push(`| | | | | | | | | ${comp.alert_reason} |`);
    }
  }

  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');
  reportLines.push('## 7-Day Summary');
  reportLines.push('');
  reportLines.push(`- **Total V2 Positions:** ${totalV2Positions.toLocaleString()}`);
  reportLines.push(`- **Total V3 Positions:** ${totalV3Positions.toLocaleString()}`);
  reportLines.push(`- **Position Improvement:** +${(totalV3Positions - totalV2Positions).toLocaleString()} (+${(((totalV3Positions - totalV2Positions) / totalV2Positions) * 100).toFixed(2)}%)`);
  reportLines.push('');
  reportLines.push(`- **Total V2 PnL:** $${totalV2Pnl.toFixed(2)}`);
  reportLines.push(`- **Total V3 PnL:** $${totalV3Pnl.toFixed(2)}`);
  reportLines.push(`- **PnL Delta:** $${(totalV3Pnl - totalV2Pnl).toFixed(2)}`);
  reportLines.push('');
  reportLines.push(`- **Alert Count:** ${alertCount} / ${comparisons.length} days`);
  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');
  reportLines.push('## Alert Thresholds');
  reportLines.push('');
  reportLines.push(`- Position delta < -${(POSITION_DELTA_THRESHOLD * 100).toFixed(0)}%`);
  reportLines.push(`- Absolute PnL delta > $${PNL_DELTA_THRESHOLD.toLocaleString()}`);
  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');
  reportLines.push('**Generated:** ' + new Date().toISOString());
  reportLines.push('**Script:** scripts/monitor-v3-daily-diff.ts');
  reportLines.push('');

  const reportPath = `/tmp/v3_daily_monitoring_${dateStr}.txt`;
  fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');

  console.log('═'.repeat(80));
  console.log(`Report written to: ${reportPath}`);
  console.log('═'.repeat(80));
  console.log('');

  if (alertCount > 0) {
    console.log('⚠️  ALERTS DETECTED - Review required before production rollout');
    process.exit(1);
  } else {
    console.log('✅ All checks passed - V3 trending stable');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Error running daily monitoring:', error);
  process.exit(1);
});
