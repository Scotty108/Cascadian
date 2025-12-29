/**
 * Leaderboard Query for Trusted Cohort
 *
 * Queries pm_wallet_metrics_trusted_v1 to show top performers
 * for copy-trade ranking.
 *
 * Only includes wallets with:
 * - No external inventory (100% confidence in metrics)
 * - At least 3 resolved positions
 * - Positive realized PnL
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  fillCount: number;
  volumeUsdc: number;
  realizedPnl: number;
  resolvedPositions: number;
  wins: number;
  winRate: number;
  roiPct: number;
  avgPositionPnl: number;
}

async function getLeaderboard(
  sortBy: 'pnl' | 'roi' | 'win_rate' | 'volume' = 'pnl',
  limit: number = 50,
  minResolved: number = 5,
  minVolume: number = 1000
): Promise<LeaderboardEntry[]> {
  const orderColumn = {
    'pnl': 'realized_pnl',
    'roi': 'roi_pct',
    'win_rate': 'win_rate',
    'volume': 'volume_usdc'
  }[sortBy];

  const query = `
    SELECT
      wallet,
      fill_count,
      volume_usdc,
      realized_pnl,
      resolved_positions,
      wins,
      win_rate,
      roi_pct,
      avg_position_pnl
    FROM pm_wallet_metrics_trusted_v1
    WHERE realized_pnl > 0
      AND resolved_positions >= ${minResolved}
      AND volume_usdc >= ${minVolume}
    ORDER BY ${orderColumn} DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet,
    fillCount: Number(r.fill_count),
    volumeUsdc: Number(r.volume_usdc),
    realizedPnl: Number(r.realized_pnl),
    resolvedPositions: Number(r.resolved_positions),
    wins: Number(r.wins),
    winRate: Number(r.win_rate),
    roiPct: Number(r.roi_pct),
    avgPositionPnl: Number(r.avg_position_pnl)
  }));
}

async function main() {
  console.log('='.repeat(80));
  console.log('TRUSTED COHORT LEADERBOARD');
  console.log('='.repeat(80));

  // Check if table exists and has data
  const checkQuery = `SELECT count() as cnt FROM pm_wallet_metrics_trusted_v1 WHERE realized_pnl > 0`;
  let count = 0;
  try {
    const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
    count = (await checkResult.json() as any[])[0]?.cnt || 0;
  } catch {
    console.log('\nERROR: pm_wallet_metrics_trusted_v1 does not exist or is empty.');
    console.log('Run build-trusted-metrics-v1.ts first.');
    return;
  }

  console.log(`\nProfitable wallets in metrics table: ${count.toLocaleString()}`);

  // Top by PnL
  console.log('\n=== TOP 30 BY REALIZED PNL ===\n');
  const topPnl = await getLeaderboard('pnl', 30, 5, 1000);

  console.log(' # | wallet       | fills | volume      | PnL         | resolved | win% | ROI%');
  console.log('-'.repeat(90));

  for (const entry of topPnl) {
    const pnlStr = `$${entry.realizedPnl.toLocaleString()}`;
    const volStr = `$${entry.volumeUsdc.toLocaleString()}`;
    console.log(
      `${entry.rank.toString().padStart(2)} | ${entry.wallet.slice(0, 10)}... | ${entry.fillCount.toString().padStart(5)} | ${volStr.padStart(10)} | ${pnlStr.padStart(10)} | ${entry.resolvedPositions.toString().padStart(5)} | ${(entry.winRate * 100).toFixed(0)}% | ${entry.roiPct.toFixed(1)}%`
    );
  }

  // Top by ROI
  console.log('\n=== TOP 20 BY ROI (min $5K volume, 10+ resolved) ===\n');
  const topRoi = await getLeaderboard('roi', 20, 10, 5000);

  console.log(' # | wallet       | fills | volume      | PnL         | resolved | win% | ROI%');
  console.log('-'.repeat(90));

  for (const entry of topRoi) {
    const pnlStr = `$${entry.realizedPnl.toLocaleString()}`;
    const volStr = `$${entry.volumeUsdc.toLocaleString()}`;
    console.log(
      `${entry.rank.toString().padStart(2)} | ${entry.wallet.slice(0, 10)}... | ${entry.fillCount.toString().padStart(5)} | ${volStr.padStart(10)} | ${pnlStr.padStart(10)} | ${entry.resolvedPositions.toString().padStart(5)} | ${(entry.winRate * 100).toFixed(0)}% | ${entry.roiPct.toFixed(1)}%`
    );
  }

  // Top by Win Rate
  console.log('\n=== TOP 20 BY WIN RATE (min 20 resolved, $10K+ volume) ===\n');
  const topWinRate = await getLeaderboard('win_rate', 20, 20, 10000);

  console.log(' # | wallet       | fills | volume      | PnL         | resolved | win% | ROI%');
  console.log('-'.repeat(90));

  for (const entry of topWinRate) {
    const pnlStr = `$${entry.realizedPnl.toLocaleString()}`;
    const volStr = `$${entry.volumeUsdc.toLocaleString()}`;
    console.log(
      `${entry.rank.toString().padStart(2)} | ${entry.wallet.slice(0, 10)}... | ${entry.fillCount.toString().padStart(5)} | ${volStr.padStart(10)} | ${pnlStr.padStart(10)} | ${entry.resolvedPositions.toString().padStart(5)} | ${(entry.winRate * 100).toFixed(0)}% | ${entry.roiPct.toFixed(1)}%`
    );
  }

  // Summary stats
  console.log('\n=== COHORT SUMMARY ===');
  const summaryQuery = `
    SELECT
      count() as total_profitable,
      round(sum(realized_pnl), 0) as total_pnl,
      round(avg(realized_pnl), 0) as avg_pnl,
      round(avg(win_rate) * 100, 1) as avg_win_rate,
      round(avg(roi_pct), 1) as avg_roi
    FROM pm_wallet_metrics_trusted_v1
    WHERE realized_pnl > 0
      AND resolved_positions >= 5
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summary = (await summaryResult.json() as any[])[0];

  console.log(`\n  Profitable wallets (5+ resolved): ${summary?.total_profitable?.toLocaleString()}`);
  console.log(`  Total realized PnL: $${Number(summary?.total_pnl || 0).toLocaleString()}`);
  console.log(`  Average PnL: $${Number(summary?.avg_pnl || 0).toLocaleString()}`);
  console.log(`  Average win rate: ${summary?.avg_win_rate}%`);
  console.log(`  Average ROI: ${summary?.avg_roi}%`);
}

main().catch(console.error);
