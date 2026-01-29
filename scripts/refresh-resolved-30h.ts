#!/usr/bin/env npx tsx
/**
 * Refresh Resolved Positions - Last 30 Hours
 * 
 * Adds newly resolved positions to pm_trade_fifo_roi_v3_mat_deduped
 * Runs in parallel with unresolved workers
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const LOOKBACK_HOURS = 36; // Cover the 29.5 hour gap + buffer

async function refreshResolvedPositions() {
  console.log('🔄 Refreshing Resolved Positions (Last 36 Hours)\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  const startTime = Date.now();

  // Step 1: Get recently resolved conditions
  console.log(`1️⃣ Finding conditions resolved in last ${LOOKBACK_HOURS} hours...`);
  
  const conditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND condition_id NOT IN (
          SELECT DISTINCT condition_id
          FROM pm_trade_fifo_roi_v3_mat_deduped
        )
    `,
    format: 'JSONEachRow'
  });
  const conditions = await conditionsResult.json() as { condition_id: string }[];

  console.log(`   ✅ Found ${conditions.length} newly resolved conditions\n`);
  
  if (conditions.length === 0) {
    console.log('✅ No new resolutions to add - table is already up to date!\n');
    return;
  }

  // Step 2: Process in batches of 50 conditions
  console.log('2️⃣ Processing resolved positions...');
  const BATCH_SIZE = 50;
  let totalInserted = 0;

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map(c => `'${c.condition_id}'`).join(',');

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);
    console.log(`   Batch ${batchNum}/${totalBatches}...`);

    await clickhouse.query({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_deduped
        SELECT
          tx_hash, wallet, condition_id, outcome_index,
          any(entry_time) as entry_time,
          any(resolved_at) as resolved_at,
          any(cost_usd) as cost_usd,
          any(tokens) as tokens,
          any(tokens_sold_early) as tokens_sold_early,
          any(tokens_held) as tokens_held,
          any(exit_value) as exit_value,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(pct_sold_early) as pct_sold_early,
          any(is_maker) as is_maker,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3
        WHERE condition_id IN (${conditionList})
        GROUP BY tx_hash, wallet, condition_id, outcome_index
      `,
      request_timeout: 300000,  // 5 minutes per batch
      clickhouse_settings: {
        max_execution_time: 300 as any,
        max_memory_usage: 10000000000 as any
      }
    });
    
    totalInserted += batch.length;
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log(`\n✅ Refresh Complete!`);
  console.log(`   Processed: ${conditions.length} conditions`);
  console.log(`   Time: ${elapsed} minutes\n`);

  // Verify freshness
  const checkResult = await clickhouse.query({
    query: `
      SELECT max(resolved_at) as latest
      FROM pm_trade_fifo_roi_v3_mat_deduped
    `,
    format: 'JSONEachRow'
  });
  const { latest } = (await checkResult.json())[0];
  const hoursOld = (new Date() - new Date(latest)) / 1000 / 60 / 60;

  console.log(`📊 Table freshness: ${latest} (${hoursOld.toFixed(1)}h old)\n`);
}

refreshResolvedPositions().catch(console.error);
