#!/usr/bin/env npx tsx
/**
 * Monitor Resolution Backfill Progress
 *
 * Tracks coverage improvements in real-time as the backfill runs
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface Snapshot {
  timestamp: string;
  total_resolutions: number;
  pnl_coverage_pct: number;
  resolved_positions: number;
  total_positions: number;
}

async function getSnapshot(): Promise<Snapshot> {
  // Get resolution count
  const resCount = await ch.query({
    query: `
      SELECT COUNT(DISTINCT condition_id_norm) as total
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
    `,
    format: 'JSONEachRow'
  });
  const resData = await resCount.json<any>();

  // Get P&L coverage
  const coverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved,
        ROUND(resolved / total_positions * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });
  const covData = await coverage.json<any>();

  return {
    timestamp: new Date().toISOString(),
    total_resolutions: parseInt(resData[0].total),
    pnl_coverage_pct: parseFloat(covData[0].coverage_pct),
    resolved_positions: parseInt(covData[0].resolved),
    total_positions: parseInt(covData[0].total_positions)
  };
}

async function checkCheckpoint(): Promise<any> {
  const checkpointFile = 'missing-resolutions-priority-1-old-checkpoint.json';

  if (!existsSync(checkpointFile)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(checkpointFile, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  console.log('\n📊 BACKFILL PROGRESS MONITOR\n');
  console.log('═'.repeat(80));
  console.log('Press Ctrl+C to exit\n');

  let baseline: Snapshot | null = null;

  // Get initial snapshot
  baseline = await getSnapshot();
  console.log(`\n🎯 BASELINE (${new Date().toLocaleTimeString()})`);
  console.log(`   Resolutions: ${baseline.total_resolutions.toLocaleString()}`);
  console.log(`   P&L Coverage: ${baseline.pnl_coverage_pct}%`);
  console.log(`   Resolved Positions: ${baseline.resolved_positions.toLocaleString()}/${baseline.total_positions.toLocaleString()}\n`);

  // Monitor loop
  setInterval(async () => {
    try {
      const snapshot = await getSnapshot();
      const checkpoint = await checkCheckpoint();

      const resDelta = snapshot.total_resolutions - baseline!.total_resolutions;
      const covDelta = (snapshot.pnl_coverage_pct - baseline!.pnl_coverage_pct).toFixed(2);
      const posDelta = snapshot.resolved_positions - baseline!.resolved_positions;

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`⏰ ${new Date().toLocaleTimeString()}`);

      if (checkpoint) {
        const progress = (checkpoint.processed / 71161 * 100).toFixed(2);
        const elapsed = (Date.now() - new Date(checkpoint.timestamp).getTime()) / 1000;
        const rate = checkpoint.processed / Math.max(elapsed, 1);
        const remaining = (71161 - checkpoint.processed) / rate;

        console.log(`\n⚙️  BACKFILL JOB`);
        console.log(`   ${checkpoint.processed.toLocaleString()}/71,161 (${progress}%)`);
        console.log(`   ✓ ${checkpoint.successful.toLocaleString()} | ✗ ${checkpoint.failed.toLocaleString()} | ○ ${checkpoint.skipped.toLocaleString()}`);
        console.log(`   ${rate.toFixed(1)}/sec | ETA: ~${(remaining / 60).toFixed(0)}min`);
      }

      console.log(`\n📈 IMPACT`);
      console.log(`   Resolutions: ${snapshot.total_resolutions.toLocaleString()} (+${resDelta.toLocaleString()})`);
      console.log(`   Coverage: ${snapshot.pnl_coverage_pct}% (${covDelta > 0 ? '+' : ''}${covDelta}%)`);
      console.log(`   Positions: ${snapshot.resolved_positions.toLocaleString()} (+${posDelta.toLocaleString()})`);
    } catch (error: any) {
      console.error('Error:', error.message);
    }
  }, 30000); // Every 30 seconds
}

main();
