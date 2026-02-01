#!/usr/bin/env npx tsx
/**
 * Phase 2: Final simple batch - just insert remaining without checking
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function finalSimple() {
  console.log('🔨 Phase 2: Final Simple Batch\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('');

  const startTime = Date.now();

  // Just insert next 50K wallets worth of data without complex checks
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
      WHERE wallet > (
        SELECT max(wallet) FROM pm_trade_fifo_roi_v3_mat_unified
      )
      LIMIT 10000000
    `,
    request_timeout: 600000,
    clickhouse_settings: {
      max_execution_time: 600 as any,
      max_memory_usage: 15000000000 as any,
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Insert complete in ${elapsed} minutes\n`);
  console.log('📊 Phase 2 should be complete or very close!\n');
  console.log('Run morning summary to check: npx tsx scripts/phase2-morning-summary.ts\n');
}

finalSimple().catch(console.error);
