#!/usr/bin/env npx tsx
/**
 * Phase 2 Simple Approach: Just copy remaining wallets from dedupe table
 *
 * Much faster than recalculating - just copy existing FIFO data
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function simpleCopy() {
  console.log('🔨 Phase 2: Simple Copy Approach\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('');

  // Just copy all wallets from deduped table that aren't in unified table
  console.log('📋 Copying resolved positions from pm_trade_fifo_roi_v3_mat_deduped...\n');

  const startTime = Date.now();

  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT *
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
      max_memory_usage: 10000000000 as any,
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Copy complete in ${elapsed} minutes\n`);

  // Check results
  const result = await clickhouse.query({
    query: `
      SELECT
        uniq(wallet) as total_wallets,
        formatReadableQuantity(count()) as total_rows
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const stats = (await result.json())[0];

  console.log('📊 Final Stats:');
  console.log(`   Total wallets: ${stats.total_wallets.toLocaleString()}`);
  console.log(`   Total rows: ${stats.total_rows}`);
  console.log('');
}

simpleCopy().catch(console.error);
