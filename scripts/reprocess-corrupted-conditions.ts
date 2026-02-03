#!/usr/bin/env npx tsx
/**
 * Reprocess corrupted conditions from Feb 1-2, 2026
 * These had misaligned columns in pm_trade_fifo_roi_v3
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const BATCH_SIZE = 50;

async function main() {
  console.log('=== REPROCESS CORRUPTED CONDITIONS ===');

  // Get affected condition_ids from temp table
  const conditionsResult = await clickhouse.query({
    query: `SELECT condition_id FROM _temp_missing_conditions`,
    format: 'JSONEachRow',
  });
  const conditions: { condition_id: string }[] = await conditionsResult.json();
  console.log(`Found ${conditions.length} conditions to reprocess`);

  // Process in batches
  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map((c) => `'${c.condition_id}'`).join(',');

    console.log(
      `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(conditions.length / BATCH_SIZE)} (${batch.length} conditions)...`
    );

    // FIFO calculation for LONG positions
    // payout_numerators is stored as JSON string like "[1,0]", parse with JSONExtract
    const longQuery = `
      INSERT INTO pm_trade_fifo_roi_v3
      WITH
        -- Get fills for these conditions
        fills AS (
          SELECT
            f.tx_hash,
            f.wallet,
            f.condition_id,
            f.outcome_index,
            f.event_time as entry_time,
            f.tokens_delta as tokens,
            f.usdc_delta as cost_usd,
            CASE WHEN f.is_maker = 1 THEN 1 ELSE 0 END as is_maker
          FROM pm_canonical_fills_v4 f
          WHERE f.condition_id IN (${conditionList})
            AND f.tokens_delta > 0
            AND f.source != 'negrisk'
        ),
        -- Get resolutions for these conditions
        resolutions AS (
          SELECT
            condition_id,
            resolved_at,
            JSONExtract(payout_numerators, 'Array(UInt8)') as payout_arr
          FROM pm_condition_resolutions
          WHERE condition_id IN (${conditionList})
        ),
        -- Calculate net position per wallet/condition/outcome
        positions AS (
          SELECT
            f.wallet,
            f.condition_id,
            f.outcome_index,
            any(f.tx_hash) as tx_hash,
            min(f.entry_time) as entry_time,
            sum(f.tokens) as tokens,
            sum(f.cost_usd) as cost_usd,
            max(f.is_maker) as is_maker,
            any(r.resolved_at) as resolved_at,
            any(r.payout_arr) as payout_arr
          FROM fills f
          INNER JOIN resolutions r ON f.condition_id = r.condition_id
          GROUP BY f.wallet, f.condition_id, f.outcome_index
        )
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        tokens,
        cost_usd,
        0 as tokens_sold_early,
        tokens as tokens_held,
        CASE
          WHEN arrayElement(payout_arr, outcome_index + 1) > 0
          THEN tokens
          ELSE 0
        END as exit_value,
        CASE
          WHEN arrayElement(payout_arr, outcome_index + 1) > 0
          THEN tokens - cost_usd
          ELSE -cost_usd
        END as pnl_usd,
        CASE
          WHEN cost_usd > 0
          THEN (CASE
            WHEN arrayElement(payout_arr, outcome_index + 1) > 0
            THEN (tokens - cost_usd) / cost_usd
            ELSE -1
          END)
          ELSE 0
        END as roi,
        0 as pct_sold_early,
        is_maker,
        resolved_at,
        0 as is_short,
        1 as is_closed
      FROM positions
      WHERE tokens > 0 AND cost_usd > 0 AND resolved_at IS NOT NULL
    `;

    try {
      await clickhouse.command({ query: longQuery });
      console.log(`  LONG positions inserted`);
    } catch (err) {
      console.error(`  Error processing LONG:`, err);
    }

    // SHORT positions (negative token delta = short)
    const shortQuery = `
      INSERT INTO pm_trade_fifo_roi_v3
      WITH
        fills AS (
          SELECT
            f.wallet,
            f.condition_id,
            f.outcome_index,
            f.event_time as entry_time,
            -f.tokens_delta as tokens,
            -f.usdc_delta as proceeds_usd,
            CASE WHEN f.is_maker = 1 THEN 1 ELSE 0 END as is_maker
          FROM pm_canonical_fills_v4 f
          WHERE f.condition_id IN (${conditionList})
            AND f.tokens_delta < 0
            AND f.source != 'negrisk'
        ),
        resolutions AS (
          SELECT
            condition_id,
            resolved_at,
            JSONExtract(payout_numerators, 'Array(UInt8)') as payout_arr
          FROM pm_condition_resolutions
          WHERE condition_id IN (${conditionList})
        ),
        positions AS (
          SELECT
            f.wallet,
            f.condition_id,
            f.outcome_index,
            min(f.entry_time) as entry_time,
            sum(f.tokens) as tokens,
            sum(f.proceeds_usd) as proceeds_usd,
            max(f.is_maker) as is_maker,
            any(r.resolved_at) as resolved_at,
            any(r.payout_arr) as payout_arr
          FROM fills f
          INNER JOIN resolutions r ON f.condition_id = r.condition_id
          GROUP BY f.wallet, f.condition_id, f.outcome_index
        )
      SELECT
        concat('short_', wallet, '_', condition_id, '_', toString(outcome_index), '_', toString(toUnixTimestamp(entry_time))) as tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        tokens,
        proceeds_usd as cost_usd,
        0 as tokens_sold_early,
        0 as tokens_held,
        proceeds_usd as exit_value,
        CASE
          WHEN arrayElement(payout_arr, outcome_index + 1) > 0
          THEN proceeds_usd - tokens
          ELSE proceeds_usd
        END as pnl_usd,
        CASE
          WHEN tokens > 0
          THEN (CASE
            WHEN arrayElement(payout_arr, outcome_index + 1) > 0
            THEN (proceeds_usd - tokens) / tokens
            ELSE proceeds_usd / tokens
          END)
          ELSE 0
        END as roi,
        0 as pct_sold_early,
        is_maker,
        resolved_at,
        1 as is_short,
        1 as is_closed
      FROM positions
      WHERE tokens > 0 AND proceeds_usd > 0 AND resolved_at IS NOT NULL
    `;

    try {
      await clickhouse.command({ query: shortQuery });
      console.log(`  SHORT positions inserted`);
    } catch (err) {
      console.error(`  Error processing SHORT:`, err);
    }
  }

  // Get final stats
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(cost_usd > 100000000) as still_corrupted,
        max(resolved_at) as max_resolved
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow',
  });
  const stats = await statsResult.json();
  console.log('\n=== FINAL STATS ===');
  console.log(stats[0]);

  // Clean up temp table
  await clickhouse.command({ query: `DROP TABLE IF EXISTS _temp_missing_conditions` });
  console.log('\nTemp table cleaned up');
}

main().catch(console.error);
