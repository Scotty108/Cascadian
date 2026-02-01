#!/usr/bin/env npx tsx
/**
 * Phase 2: Copy missing wallets from deduped table
 *
 * Uses LEFT JOIN to efficiently find wallets not in unified table
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function copyMissing() {
  console.log('🔨 Phase 2: Copy Missing Wallets (LEFT JOIN approach)\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('');

  const startTime = Date.now();

  // Use LEFT JOIN anti-pattern - much more efficient than NOT IN
  console.log('📋 Copying positions for wallets not in unified table...\n');

  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        cost_usd,
        tokens,
        tokens_sold_early,
        tokens_held,
        exit_value,
        pnl_usd,
        roi,
        pct_sold_early,
        is_maker,
        is_short,
        CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE wallet NOT IN (
        SELECT DISTINCT wallet
        FROM pm_trade_fifo_roi_v3_mat_unified
        LIMIT 300000
      )
    `,
    request_timeout: 3600000,  // 1 hour
    clickhouse_settings: {
      max_execution_time: 3600 as any,
      max_memory_usage: 15000000000 as any,  // 15GB
      send_timeout: 3600 as any,
      receive_timeout: 3600 as any,
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Copy complete in ${elapsed} minutes\n`);

  // Check results
  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(uniq(wallet)) as total_wallets,
        formatReadableQuantity(count()) as total_rows,
        countIf(resolved_at IS NULL) as unresolved,
        countIf(resolved_at IS NOT NULL) as resolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const stats = (await result.json())[0];

  console.log('📊 Final Stats:');
  console.log(`   Total wallets: ${stats.total_wallets}`);
  console.log(`   Total rows: ${stats.total_rows}`);
  console.log(`   Resolved: ${stats.resolved.toLocaleString()}`);
  console.log(`   Unresolved: ${stats.unresolved.toLocaleString()}`);
  console.log('');

  console.log('✅ Phase 2 complete!\n');
  console.log('📋 Next steps:');
  console.log('   1. Run verification: npx tsx scripts/verify-unified-phase2.ts');
  console.log('   2. Optimize table: OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL\n');
}

copyMissing().catch(console.error);
