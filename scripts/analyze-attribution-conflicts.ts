#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

async function analyzeAttributionConflicts() {
  console.log('🔍 Analyzing Attribution Conflicts...\n');

  // Step 1: Create snapshot of conflicts
  console.log('Step 1: Creating conflict snapshot...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS tmp_conflicts_snapshot_20251116
      ENGINE = MergeTree()
      ORDER BY transaction_hash
      AS
      SELECT
        transaction_hash,
        groupArray(wallet_address) AS conflicting_wallets,
        count() AS wallet_count,
        sum(usd_value) AS total_value,
        min(created_at) AS first_seen,
        max(created_at) AS last_seen,
        any(condition_id_norm_v3) AS condition_id,
        any(trade_direction) AS direction,
        any(shares) AS shares,
        any(usd_value) AS value_per_trade
      FROM pm_trades_canonical_v3
      GROUP BY transaction_hash
      HAVING wallet_count > 1
    `
  });
  console.log('✅ Conflict snapshot created\n');

  // Step 2: Count total conflicts
  const countResult = await clickhouse.query({
    query: 'SELECT count() AS total_conflicts FROM tmp_conflicts_snapshot_20251116',
    format: 'JSONEachRow'
  });
  const { total_conflicts } = (await countResult.json<any>())[0];
  console.log(`📊 Total conflicted transactions: ${total_conflicts.toLocaleString()}\n`);

  // Step 3: Severity analysis
  console.log('Step 3: Analyzing conflict severity...');
  const severityResult = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN wallet_count > 10 THEN 'CRITICAL'
          WHEN wallet_count > 5 THEN 'HIGH'
          WHEN wallet_count > 2 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS severity,
        count() AS conflict_count,
        sum(total_value) AS affected_volume,
        round(avg(wallet_count), 2) AS avg_wallets_per_tx,
        max(wallet_count) AS max_wallets_per_tx
      FROM tmp_conflicts_snapshot_20251116
      GROUP BY severity
      ORDER BY
        CASE severity
          WHEN 'CRITICAL' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
        END
    `,
    format: 'JSONEachRow'
  });
  const severityData = await severityResult.json<any>();

  console.log('\n📊 Conflict Severity Breakdown:');
  console.log('Severity   | Conflicts | Affected Volume | Avg Wallets | Max Wallets');
  console.log('-----------|-----------|----------------|-------------|-------------');

  let totalVolume = 0;
  for (const row of severityData) {
    totalVolume += parseFloat(row.affected_volume);
    console.log(
      `${row.severity.padEnd(10)} | ${String(row.conflict_count).padStart(9)} | $${String(Math.round(row.affected_volume).toLocaleString()).padStart(13)} | ${String(row.avg_wallets_per_tx).padStart(11)} | ${String(row.max_wallets_per_tx).padStart(11)}`
    );
  }
  console.log('-----------|-----------|----------------|-------------|-------------');
  console.log(`TOTAL                  | $${Math.round(totalVolume).toLocaleString()}`);

  // Step 4: Sample worst offenders
  console.log('\n📋 Top 10 Worst Conflicts:');
  const worstResult = await clickhouse.query({
    query: `
      SELECT
        transaction_hash,
        wallet_count,
        total_value,
        condition_id,
        direction,
        arrayStringConcat(conflicting_wallets, ', ') AS wallets_preview
      FROM tmp_conflicts_snapshot_20251116
      ORDER BY wallet_count DESC, total_value DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const worstConflicts = await worstResult.json<any>();

  for (const conflict of worstConflicts) {
    console.log(`\nTx: ${conflict.transaction_hash}`);
    console.log(`   Wallets: ${conflict.wallet_count} | Value: $${Math.round(conflict.total_value).toLocaleString()}`);
    console.log(`   Direction: ${conflict.direction} | CID: ${conflict.condition_id?.substring(0, 16)}...`);
    console.log(`   Wallets: ${conflict.wallets_preview.substring(0, 100)}${conflict.wallets_preview.length > 100 ? '...' : ''}`);
  }

  // Step 5: Calculate dedup impact
  console.log('\n\n📊 Deduplication Impact Analysis:');
  const impactResult = await clickhouse.query({
    query: `
      SELECT
        count() AS total_conflicted_txs,
        sum(wallet_count) AS total_duplicate_trades,
        sum(wallet_count - 1) AS trades_to_remove,
        sum(total_value * (wallet_count - 1)) AS volume_to_archive
      FROM tmp_conflicts_snapshot_20251116
    `,
    format: 'JSONEachRow'
  });
  const impact = (await impactResult.json<any>())[0];

  console.log(`Total conflicted transactions: ${impact.total_conflicted_txs.toLocaleString()}`);
  console.log(`Total duplicate trades: ${impact.total_duplicate_trades.toLocaleString()}`);
  console.log(`Trades to remove (keep 1 per tx): ${impact.trades_to_remove.toLocaleString()}`);
  console.log(`Volume to archive: $${Math.round(impact.volume_to_archive).toLocaleString()}`);

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total_conflicts: total_conflicts,
      total_volume: totalVolume,
      trades_to_remove: impact.trades_to_remove,
      volume_to_archive: impact.volume_to_archive
    },
    severity: severityData,
    worst_offenders: worstConflicts
  };

  writeFileSync(
    '/tmp/conflict-analysis-report.json',
    JSON.stringify(report, null, 2)
  );

  console.log('\n✅ Analysis complete! Report saved to /tmp/conflict-analysis-report.json');

  return report;
}

analyzeAttributionConflicts().catch(console.error);
