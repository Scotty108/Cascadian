#!/usr/bin/env tsx
/**
 * Populate Closed Positions Table
 *
 * Identifies all positions where:
 * - net_tokens = 0 (fully exited)
 * - Market is still open (no resolution)
 *
 * This captures ~$7k missing PnL for wallets like FuelHydrantBoss.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('🔄 Populating Closed Positions Table\n');

  try {
    const startTime = Date.now();

    console.log('Analyzing canonical fills to find closed positions...');
    console.log('(This scans all fills to calculate net_tokens per position)\n');

    await clickhouse.command({
      query: `
        INSERT INTO pm_closed_positions_v1
        SELECT
          wallet,
          condition_id,
          outcome_index,

          -- Position metrics
          sumIf(tokens_delta, tokens_delta > 0) as total_tokens_bought,
          abs(sumIf(tokens_delta, tokens_delta < 0)) as total_tokens_sold,
          sum(tokens_delta) as net_tokens,

          -- Cash flow
          abs(sumIf(usdc_delta, usdc_delta < 0)) as total_cash_in,
          sumIf(usdc_delta, usdc_delta > 0) as total_cash_out,
          sum(usdc_delta) as net_cash_flow,

          -- Trade counts
          countIf(tokens_delta > 0) as buy_count,
          countIf(tokens_delta < 0) as sell_count,
          count() as total_fills,

          -- Timestamps
          min(event_time) as first_trade,
          max(event_time) as last_trade,
          max(event_time) as closed_at, -- When position closed (last trade)

          -- Market status (check if resolution exists)
          if(r.payout_numerators IS NULL, 1, 0) as market_open,

          -- Version
          toUnixTimestamp(now()) * 1000 as _version,
          now() as _updated_at

        FROM pm_canonical_fills_v4_deduped f
        LEFT JOIN pm_condition_resolutions r
          ON f.condition_id = r.condition_id AND r.is_deleted = 0
        WHERE f.source = 'clob'
        GROUP BY wallet, condition_id, outcome_index
        HAVING abs(net_tokens) < 0.01  -- Effectively zero (account for float precision)
          AND market_open = 1            -- Market still open
          AND total_fills >= 2           -- At least bought and sold
      `,
      clickhouse_settings: {
        max_execution_time: 600, // 10 minutes
        max_memory_usage: 10000000000, // 10GB
        max_threads: 8,
      },
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`✓ Populated in ${duration} min\n`);

    // Check results
    const result = await clickhouse.query({
      query: `
        SELECT
          count() as total_closed_positions,
          count(DISTINCT wallet) as unique_wallets,
          round(sum(net_cash_flow), 0) as total_realized_pnl,
          round(avg(net_cash_flow), 0) as avg_pnl_per_position,
          min(closed_at) as earliest_close,
          max(closed_at) as latest_close
        FROM pm_closed_positions_current
      `,
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as any[];
    const stats = rows[0];

    console.log('════════════════════════════════════════════════════');
    console.log('✅ Closed Positions Populated!');
    console.log('════════════════════════════════════════════════════');
    console.log(`Total closed positions: ${stats.total_closed_positions.toLocaleString()}`);
    console.log(`Unique wallets: ${stats.unique_wallets.toLocaleString()}`);
    console.log(`Total realized PnL: $${stats.total_realized_pnl.toLocaleString()}`);
    console.log(`Avg PnL per position: $${stats.avg_pnl_per_position.toLocaleString()}`);
    console.log(`Date range: ${stats.earliest_close} to ${stats.latest_close}`);
    console.log('\nNext step: Test with FuelHydrantBoss wallet to verify fix\n');

  } catch (error: any) {
    console.error('\n❌ Error populating table:', error.message);
    throw error;
  }
}

main().catch(console.error);
