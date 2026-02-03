/**
 * Fix SHORT Position ROI
 *
 * Fixes 12,486 SHORT positions with impossible ROI values (ROI < -1).
 * These have broken calculations where roi = -tokens_sold_early.
 *
 * SHORT position economics:
 * - Open SHORT: Sell tokens → receive USDC upfront
 * - Liability: If outcome WINS, you owe $1 per token
 * - Profit: If outcome LOSES, you keep the USDC (tokens become worthless)
 *
 * Correct formulas:
 * - cost_usd = tokens (liability = $1 per token)
 * - exit_value = tokens if outcome LOST, else 0
 * - pnl_usd = exit_value - cost_usd
 * - roi = pnl_usd / cost_usd
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function fixShortPositionRoi() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Fix SHORT Position ROI ===\n');

  // Step 1: Check current state
  const beforeResult = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(roi < -1) as broken_roi,
        countIf(is_short = 1) as total_shorts,
        countIf(is_short = 1 AND roi < -1) as broken_shorts
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const before = (await beforeResult.json() as any[])[0];
  console.log(`Before fix:`);
  console.log(`  Total rows: ${Number(before.total).toLocaleString()}`);
  console.log(`  Total SHORTs: ${Number(before.total_shorts).toLocaleString()}`);
  console.log(`  Broken ROI (< -1): ${Number(before.broken_roi).toLocaleString()}`);
  console.log(`  Broken SHORTs: ${Number(before.broken_shorts).toLocaleString()}\n`);

  if (Number(before.broken_shorts) === 0) {
    console.log('No broken SHORT positions to fix. Exiting.');
    return;
  }

  // Step 2: Create temp table with corrected values
  console.log('Step 1: Creating temp table with corrected values...');

  // First, drop temp table if exists
  await client.command({
    query: `DROP TABLE IF EXISTS _temp_short_fixes`,
  });

  // Create temp table with corrected calculations
  // SHORT position: if the shorted outcome LOST (payout_numerator = 0), you profit
  await client.command({
    query: `
      CREATE TABLE _temp_short_fixes ENGINE = Memory AS
      SELECT
        u.tx_hash,
        u.wallet,
        u.condition_id,
        u.outcome_index,
        u.entry_time,
        u.resolved_at,
        u.tokens,
        u.tokens as corrected_cost_usd,
        u.tokens_sold_early,
        u.tokens_held,
        -- exit_value: if shorted outcome LOST (payout=0), keep the tokens value; else lose everything
        multiIf(
          r.payout_numerators = '', 0,
          toUInt64OrZero(arrayElement(splitByChar(',', r.payout_numerators), toUInt8(u.outcome_index) + 1)) = 0, u.tokens,
          0
        ) as corrected_exit_value,
        u.pct_sold_early,
        u.is_maker,
        u.is_closed,
        u.is_short
      FROM pm_trade_fifo_roi_v3_mat_unified u
      INNER JOIN pm_condition_resolutions r ON u.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE u.is_short = 1 AND u.roi < -1
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Verify temp table
  const tempCount = await client.query({
    query: `SELECT count() as cnt FROM _temp_short_fixes`,
    format: 'JSONEachRow',
  });
  const tempRows = (await tempCount.json() as any[])[0].cnt;
  console.log(`  Created temp table with ${Number(tempRows).toLocaleString()} rows`);

  // Sample the corrections
  const sampleResult = await client.query({
    query: `
      SELECT
        condition_id,
        outcome_index,
        tokens,
        corrected_cost_usd,
        corrected_exit_value,
        corrected_exit_value - corrected_cost_usd as corrected_pnl,
        if(corrected_cost_usd > 0, (corrected_exit_value - corrected_cost_usd) / corrected_cost_usd, 0) as corrected_roi
      FROM _temp_short_fixes
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const samples = await sampleResult.json() as any[];
  console.log('\n  Sample corrections:');
  for (const s of samples) {
    console.log(`    condition=${s.condition_id.substring(0, 16)}... outcome=${s.outcome_index}`);
    console.log(`      tokens=${Number(s.tokens).toFixed(2)}, cost=${Number(s.corrected_cost_usd).toFixed(2)}, exit=${Number(s.corrected_exit_value).toFixed(2)}`);
    console.log(`      pnl=${Number(s.corrected_pnl).toFixed(2)}, roi=${Number(s.corrected_roi).toFixed(4)}`);
  }

  // Step 3: Delete corrupted rows
  console.log('\nStep 2: Deleting corrupted rows...');
  await client.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE is_short = 1 AND roi < -1
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Wait for mutation to complete
  console.log('  Waiting for mutation to complete...');
  let mutationComplete = false;
  let attempts = 0;
  while (!mutationComplete && attempts < 60) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const mutationCheck = await client.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
          AND is_done = 0
      `,
      format: 'JSONEachRow',
    });
    const pending = (await mutationCheck.json() as any[])[0].pending;
    if (Number(pending) === 0) {
      mutationComplete = true;
    }
    attempts++;
    if (attempts % 5 === 0) {
      console.log(`  Still waiting... (${attempts * 2}s)`);
    }
  }

  if (!mutationComplete) {
    console.log('  WARNING: Mutation may not be complete. Proceeding anyway.');
  } else {
    console.log('  Mutation complete.');
  }

  // Step 4: Insert corrected rows
  console.log('\nStep 3: Inserting corrected rows...');
  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        tokens,
        corrected_cost_usd as cost_usd,
        tokens_sold_early,
        tokens_held,
        corrected_exit_value as exit_value,
        corrected_exit_value - corrected_cost_usd as pnl_usd,
        if(corrected_cost_usd > 0, (corrected_exit_value - corrected_cost_usd) / corrected_cost_usd, 0) as roi,
        pct_sold_early,
        is_maker,
        is_closed,
        is_short
      FROM _temp_short_fixes
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });
  console.log(`  Inserted ${Number(tempRows).toLocaleString()} corrected rows`);

  // Step 5: Cleanup
  console.log('\nStep 4: Cleanup...');
  await client.command({
    query: `DROP TABLE IF EXISTS _temp_short_fixes`,
  });
  console.log('  Dropped temp table');

  // Step 6: Verification
  console.log('\nStep 5: Verification...');
  const afterResult = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(roi < -1) as broken_roi,
        countIf(is_short = 1) as total_shorts,
        countIf(is_short = 1 AND roi < -1) as broken_shorts,
        minIf(roi, is_short = 1) as min_short_roi,
        maxIf(roi, is_short = 1) as max_short_roi,
        avgIf(roi, is_short = 1) as avg_short_roi
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const after = (await afterResult.json() as any[])[0];

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(50)}`);
  console.log('RESULTS');
  console.log(`${'='.repeat(50)}`);
  console.log(`Total rows: ${Number(after.total).toLocaleString()}`);
  console.log(`Total SHORTs: ${Number(after.total_shorts).toLocaleString()}`);
  console.log(`Broken ROI (< -1): ${Number(after.broken_roi).toLocaleString()} (should be 0)`);
  console.log(`Broken SHORTs: ${Number(after.broken_shorts).toLocaleString()} (should be 0)`);
  console.log(`\nSHORT ROI Stats:`);
  console.log(`  Min ROI: ${Number(after.min_short_roi).toFixed(4)}`);
  console.log(`  Max ROI: ${Number(after.max_short_roi).toFixed(4)}`);
  console.log(`  Avg ROI: ${Number(after.avg_short_roi).toFixed(4)}`);
  console.log(`\nDuration: ${duration}s`);

  if (Number(after.broken_roi) === 0) {
    console.log('\n✓ SUCCESS: All ROI values are now valid (>= -1)');
  } else {
    console.log('\n✗ WARNING: Some broken ROI values remain');
  }
}

fixShortPositionRoi().catch(console.error);
