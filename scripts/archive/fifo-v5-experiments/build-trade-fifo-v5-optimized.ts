#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - Optimized Closed Positions Backfill
 *
 * Optimized 2-phase approach:
 * 1. Identify all closed positions in ONE scan (temp table)
 * 2. Insert them into FIFO table (fast)
 *
 * Expected runtime: 15-20 minutes for all history
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('🔨 Building FIFO V5 (Optimized Closed Positions)\n');

  const startTime = Date.now();

  try {
    // Step 1: Identify ALL closed positions in one scan
    console.log('Step 1: Identifying closed positions...');
    console.log('(This scans canonical_fills once to find net_tokens ≈ 0)\n');

    const step1Start = Date.now();

    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3
        SELECT
          concat('closed_', wallet, '_', condition_id, '_', toString(outcome_index)) as tx_hash,
          wallet,
          condition_id,
          outcome_index,
          first_trade as entry_time,
          0 as tokens,
          abs(total_cost) as cost_usd,
          abs(total_tokens_sold) as tokens_sold_early,
          0 as tokens_held,
          total_proceeds as exit_value,
          total_proceeds - abs(total_cost) as pnl_usd,
          CASE
            WHEN abs(total_cost) > 0 THEN (total_proceeds - abs(total_cost)) / abs(total_cost)
            ELSE 0
          END as roi,
          100 as pct_sold_early,
          any(is_maker) as is_maker,
          last_trade as resolved_at,
          0 as is_short,
          1 as is_closed
        FROM (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            sum(tokens_delta) as net_tokens,
            sumIf(usdc_delta, usdc_delta < 0) as total_cost,
            sumIf(usdc_delta, usdc_delta > 0) as total_proceeds,
            sumIf(tokens_delta, tokens_delta < 0) as total_tokens_sold,
            min(event_time) as first_trade,
            max(event_time) as last_trade,
            any(is_maker) as is_maker
          FROM pm_canonical_fills_v4_deduped
          WHERE source = 'clob'
          GROUP BY wallet, condition_id, outcome_index
          HAVING abs(net_tokens) < 0.01  -- Closed (effectively zero)
            AND total_proceeds > 0  -- Must have sold
            AND total_cost < 0  -- Must have bought
        )
        -- Only insert if market NOT resolved
        WHERE NOT EXISTS (
          SELECT 1
          FROM pm_condition_resolutions r
          WHERE r.condition_id = condition_id
            AND r.is_deleted = 0
            AND r.payout_numerators != ''
        )
      `,
      clickhouse_settings: {
        max_execution_time: 1800, // 30 minutes
        max_memory_usage: 15000000000, // 15GB
        max_threads: 8,
      },
    });

    const step1Duration = ((Date.now() - step1Start) / 1000 / 60).toFixed(1);
    console.log(`✓ Closed positions identified and inserted (${step1Duration} min)\n`);

    // Step 2: Count results
    console.log('Step 2: Counting results...');
    const countResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_closed,
          count(DISTINCT wallet) as unique_wallets,
          round(sum(pnl_usd), 0) as total_pnl,
          min(entry_time) as earliest,
          max(resolved_at) as latest
        FROM pm_trade_fifo_roi_v3
        WHERE is_closed = 1
      `,
      format: 'JSONEachRow',
    });
    const stats = (await countResult.json())[0];

    const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log('════════════════════════════════════════════════════');
    console.log('✅ FIFO V5 Build Complete!');
    console.log('════════════════════════════════════════════════════');
    console.log(`Total closed positions: ${stats.total_closed.toLocaleString()}`);
    console.log(`Unique wallets: ${stats.unique_wallets.toLocaleString()}`);
    console.log(`Total PnL: $${stats.total_pnl.toLocaleString()}`);
    console.log(`Date range: ${stats.earliest} to ${stats.latest}`);
    console.log(`Duration: ${totalDuration} minutes`);
    console.log('\nNext: Run verification script to test FuelHydrantBoss\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

main().catch(console.error);
