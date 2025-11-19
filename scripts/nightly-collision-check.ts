#!/usr/bin/env tsx
/**
 * Nightly Collision Check
 * Monitors for:
 * 1. Attribution conflicts (duplicate tx_hash with different wallets)
 * 2. ETL duplicates (same trade_id appearing multiple times)
 * 3. Empty condition_id orphans
 *
 * Run via cron:
 * 0 1 * * * cd /Users/scotty/Projects/Cascadian-app && npx tsx scripts/nightly-collision-check.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkDailyCollisions() {
  const checkDate = new Date().toISOString().split('T')[0];
  console.log(`🛡️  Running nightly collision check for ${checkDate}...\n`);

  // 1. Check for ETL duplicates (same trade_id)
  console.log('Step 1: Checking for ETL duplicates (same trade_id)...');
  const duplicatesResult = await clickhouse.query({
    query: `
      WITH daily_duplicates AS (
        SELECT
          trade_id,
          count() AS duplicate_count,
          sum(usd_value) AS total_value
        FROM pm_trades_canonical_v3
        WHERE created_at >= now() - INTERVAL 1 DAY
        GROUP BY trade_id
        HAVING duplicate_count > 1
      )
      SELECT
        count() AS new_duplicates,
        sum(total_value) AS affected_volume,
        max(duplicate_count) AS max_duplicates_per_trade
      FROM daily_duplicates
    `,
    format: 'JSONEachRow'
  });
  const duplicates = (await duplicatesResult.json<any>())[0];

  console.log(`New ETL duplicates: ${duplicates.new_duplicates}`);
  console.log(`Affected volume: $${Math.round(duplicates.affected_volume || 0).toLocaleString()}`);
  console.log(`Max duplicates per trade: ${duplicates.max_duplicates_per_trade || 0}`);

  // 2. Check for attribution conflicts (tx_hash with multiple wallets)
  console.log('\n\nStep 2: Checking for attribution conflicts...');
  const conflictsResult = await clickhouse.query({
    query: `
      WITH daily_collisions AS (
        SELECT
          transaction_hash,
          groupArray(wallet_address) AS wallets,
          count() AS wallet_count,
          sum(usd_value) AS total_value
        FROM pm_trades_canonical_v3
        WHERE created_at >= now() - INTERVAL 1 DAY
        GROUP BY transaction_hash
        HAVING wallet_count > 1
      )
      SELECT
        count() AS new_conflicts,
        sum(total_value) AS affected_volume,
        groupArray(transaction_hash) AS conflict_tx_hashes
      FROM daily_collisions
    `,
    format: 'JSONEachRow'
  });
  const conflicts = (await conflictsResult.json<any>())[0];

  console.log(`New attribution conflicts: ${conflicts.new_conflicts}`);
  console.log(`Affected volume: $${Math.round(conflicts.affected_volume || 0).toLocaleString()}`);

  // 3. Check for empty condition_id (orphans)
  console.log('\n\nStep 3: Checking for empty condition_id orphans...');
  const orphansResult = await clickhouse.query({
    query: `
      SELECT
        countIf(condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS daily_orphans,
        count() AS daily_total,
        round(100.0 * daily_orphans / daily_total, 2) AS orphan_pct,
        sumIf(usd_value, condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS orphan_volume
      FROM pm_trades_canonical_v3
      WHERE created_at >= now() - INTERVAL 1 DAY
    `,
    format: 'JSONEachRow'
  });
  const orphans = (await orphansResult.json<any>())[0];

  console.log(`New orphan trades: ${orphans.daily_orphans.toLocaleString()}`);
  console.log(`Orphan percentage: ${orphans.orphan_pct}%`);
  console.log(`Orphan volume: $${Math.round(orphans.orphan_volume || 0).toLocaleString()}`);

  // 4. Log to monitoring table
  const shouldAlert = duplicates.new_duplicates > 0 ||
                      conflicts.new_conflicts > 0 ||
                      orphans.orphan_pct > 35;

  if (shouldAlert || duplicates.new_duplicates > 0 || conflicts.new_conflicts > 0) {
    console.log('\n\n⚠️  ALERT: Issues detected, logging to monitoring table...');

    const logEntry = {
      check_date: checkDate,
      new_conflicts: conflicts.new_conflicts,
      affected_volume: conflicts.affected_volume || 0,
      conflict_tx_hashes: conflicts.conflict_tx_hashes || [],
      conflict_details: JSON.stringify({
        etl_duplicates: duplicates,
        attribution_conflicts: conflicts,
        orphan_stats: orphans
      })
    };

    try {
      await clickhouse.insert({
        table: 'pm_collision_monitor_log',
        values: [logEntry],
        format: 'JSONEachRow'
      });
      console.log('✅ Logged to pm_collision_monitor_log');
    } catch (error) {
      console.error('❌ Failed to log to monitoring table:', error);
    }

    // Print alert summary
    console.log('\n\n🚨 ALERT SUMMARY:');
    if (duplicates.new_duplicates > 0) {
      console.log(`   ❌ ETL DUPLICATES: ${duplicates.new_duplicates} trades ($${Math.round(duplicates.affected_volume).toLocaleString()})`);
    }
    if (conflicts.new_conflicts > 0) {
      console.log(`   ❌ ATTRIBUTION CONFLICTS: ${conflicts.new_conflicts} transactions ($${Math.round(conflicts.affected_volume).toLocaleString()})`);
    }
    if (orphans.orphan_pct > 35) {
      console.log(`   ❌ HIGH ORPHAN RATE: ${orphans.orphan_pct}% (threshold: 35%)`);
    }
  } else {
    console.log('\n\n✅ No issues detected. All systems normal.');
  }

  return {
    date: checkDate,
    duplicates,
    conflicts,
    orphans,
    alert: shouldAlert
  };
}

checkDailyCollisions().catch(console.error);
