#!/usr/bin/env npx tsx
/**
 * Phase 2: Finish last wallets in batches
 *
 * Uses LEFT JOIN with batching to avoid memory limits
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function finishBatched() {
  console.log('🔨 Phase 2: Finish Last Wallets (Batched)\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log('');

  const startTime = Date.now();
  let totalInserted = 0;
  let batch = 0;

  while (true) {
    batch++;
    console.log(`📦 Processing batch ${batch}...`);

    const batchStart = Date.now();

    // Get next 100K wallets from deduped that aren't in unified (using LIMIT to avoid memory)
    const result = await clickhouse.query({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          d.tx_hash,
          d.wallet,
          d.condition_id,
          d.outcome_index,
          d.entry_time,
          d.resolved_at,
          d.cost_usd,
          d.tokens,
          d.tokens_sold_early,
          d.tokens_held,
          d.exit_value,
          d.pnl_usd,
          d.roi,
          d.pct_sold_early,
          d.is_maker,
          d.is_short,
          CASE WHEN d.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
        FROM pm_trade_fifo_roi_v3_mat_deduped d
        WHERE wallet IN (
          SELECT wallet FROM (
            SELECT DISTINCT wallet
            FROM pm_trade_fifo_roi_v3_mat_deduped
            WHERE wallet NOT IN (
              SELECT DISTINCT wallet FROM pm_trade_fifo_roi_v3_mat_unified LIMIT 2000000
            )
            LIMIT 50000
          )
        )
      `,
      request_timeout: 600000,
      clickhouse_settings: {
        max_execution_time: 600 as any,
        max_memory_usage: 15000000000 as any,
      }
    });

    const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(`   ✅ Batch ${batch} complete (${batchElapsed}s)\n`);

    // Check if we're done
    const checkResult = await clickhouse.query({
      query: `
        SELECT count(DISTINCT wallet) as missing
        FROM pm_trade_fifo_roi_v3_mat_deduped
        WHERE wallet NOT IN (
          SELECT DISTINCT wallet FROM pm_trade_fifo_roi_v3_mat_unified LIMIT 2000000
        )
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const stats = (await checkResult.json())[0];

    console.log(`   Remaining wallets: ${stats.missing.toLocaleString()}\n`);

    if (stats.missing === 0) {
      console.log('✅ All wallets processed!\n');
      break;
    }

    if (batch >= 10) {
      console.log('⚠️  Reached max batches (10). May need manual intervention.\n');
      break;
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Batched copy complete in ${totalElapsed} minutes\n`);

  // Final stats
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(uniq(wallet)) as total_wallets,
        formatReadableQuantity(count()) as total_rows
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const finalStats = (await finalResult.json())[0];

  console.log('📊 Final Stats:');
  console.log(`   Total wallets: ${finalStats.total_wallets}`);
  console.log(`   Total rows: ${finalStats.total_rows}`);
  console.log('');
}

finishBatched().catch(console.error);
