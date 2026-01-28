#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - TRUE FIFO for Closed Positions
 *
 * Extends V4 FIFO logic to include UNRESOLVED markets.
 * Uses EXACT SAME cost-basis tracking as V4, just different filter.
 *
 * Key difference from V4:
 * - V4: WHERE payout_numerators != '' (resolved only)
 * - V5: WHERE payout_numerators IS NULL (unresolved only) AND net_tokens ≈ 0 (closed)
 *
 * Runtime: ~30-45 minutes for all closed positions
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const BATCH_SIZE = 100; // Small batches to avoid timeout

async function getUnresolvedClosedConditions(): Promise<string[]> {
  console.log('Finding unresolved markets with closed positions...\n');

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT f.condition_id
      FROM pm_canonical_fills_v4_deduped f
      LEFT JOIN pm_condition_resolutions r
        ON f.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE f.source = 'clob'
        AND (r.payout_numerators IS NULL OR r.payout_numerators = '')
      GROUP BY f.condition_id
      HAVING abs(sum(f.tokens_delta)) < 0.01  -- At least one closed position
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as { condition_id: string }[];
  console.log(`Found ${rows.length} unresolved markets with closed positions\n`);
  return rows.map(r => r.condition_id);
}

async function processConditionBatch(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  // EXACT SAME FIFO LOGIC as V4, just for unresolved markets
  const query = `
    INSERT INTO pm_trade_fifo_roi_v3
    SELECT
      tx_hash,
      wallet,
      condition_id,
      outcome_index,
      entry_time,
      tokens,
      cost_usd,
      tokens_sold_early,
      tokens_held,
      exit_value,
      exit_value - cost_usd as pnl_usd,
      CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
      CASE
        WHEN (total_tokens_sold + tokens_held) > 0 THEN
          tokens_sold_early / (total_tokens_sold + tokens_held) * 100
        ELSE 0
      END as pct_sold_early,
      is_maker_flag as is_maker,
      resolved_at,
      0 as is_short,
      1 as is_closed  -- Mark as closed position
    FROM (
      SELECT
        buy.*,
        coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
        coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) as cumsum_before,
        -- For closed positions, no payout (tokens all sold)
        least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0))) as tokens_sold_early,
        buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
          ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0))) as tokens_held,
        -- Exit value: (tokens sold × avg sell price) + (tokens held × 0 since not resolved)
        CASE
          WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
            least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
              ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0))) * (coalesce(sells.total_sell_proceeds, 0) / coalesce(sells.total_tokens_sold, 1))
          ELSE 0
        END as exit_value
      FROM (
        SELECT
          f.fill_id as tx_hash,
          f.wallet,
          f.condition_id,
          f.outcome_index,
          f.event_time as entry_time,
          f.tokens_delta as tokens,
          abs(f.usdc_delta) as cost_usd,
          f.is_maker as is_maker_flag,
          max(f.event_time) OVER (PARTITION BY f.wallet, f.condition_id, f.outcome_index) as resolved_at
        FROM pm_canonical_fills_v4_deduped f
        WHERE f.condition_id IN (${conditionList})
          AND f.source = 'clob'
          AND f.tokens_delta > 0  -- Only buys
        ORDER BY f.wallet, f.condition_id, f.outcome_index, f.event_time
      ) buy
      LEFT JOIN (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          abs(sum(tokens_delta)) as total_tokens_sold,
          sum(usdc_delta) as total_sell_proceeds
        FROM pm_canonical_fills_v4_deduped
        WHERE condition_id IN (${conditionList})
          AND source = 'clob'
          AND tokens_delta < 0  -- Only sells
        GROUP BY wallet, condition_id, outcome_index
      ) sells ON buy.wallet = sells.wallet
        AND buy.condition_id = sells.condition_id
        AND buy.outcome_index = sells.outcome_index
    )
    -- Only insert if position is CLOSED (all tokens sold)
    WHERE tokens_held = 0 OR abs(tokens_held) < 0.01
  `;

  await clickhouse.command({
    query,
    clickhouse_settings: {
      max_execution_time: 300,
      max_memory_usage: 8000000000,
      max_threads: 6,
      optimize_read_in_window_order: 1,
    },
  });

  // Count inserted
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trade_fifo_roi_v3
      WHERE condition_id IN (${conditionList})
        AND is_closed = 1
    `,
    format: 'JSONEachRow',
  });
  const rows = await countResult.json() as any[];
  return rows[0]?.cnt || 0;
}

async function main() {
  console.log('🔨 Building FIFO V5 (TRUE FIFO for Closed Positions)\n');

  const startTime = Date.now();

  try {
    // Get all unresolved conditions with closed positions
    const conditionIds = await getUnresolvedClosedConditions();

    if (conditionIds.length === 0) {
      console.log('No closed positions found. Exiting.\n');
      return;
    }

    let totalInserted = 0;
    const totalBatches = Math.ceil(conditionIds.length / BATCH_SIZE);

    console.log(`Processing ${conditionIds.length} conditions in ${totalBatches} batches...\n`);

    for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = conditionIds.slice(i, i + BATCH_SIZE);

      process.stdout.write(`[${batchNum}/${totalBatches}] Processing ${batch.length} conditions... `);

      try {
        const count = await processConditionBatch(batch);
        totalInserted += count;
        console.log(`✓ ${count} FIFO rows`);
      } catch (error: any) {
        console.log(`✗ ${error.message}`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log('\n════════════════════════════════════════════════════');
    console.log('✅ FIFO V5 Build Complete!');
    console.log('════════════════════════════════════════════════════');
    console.log(`Total FIFO rows inserted: ${totalInserted.toLocaleString()}`);
    console.log(`Duration: ${duration} minutes`);
    console.log('\nNext: Run verification script to test FuelHydrantBoss\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

main().catch(console.error);
