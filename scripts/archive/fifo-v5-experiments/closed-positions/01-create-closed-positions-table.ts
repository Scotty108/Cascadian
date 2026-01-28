#!/usr/bin/env tsx
/**
 * Create Closed Positions Tracking Table
 *
 * Tracks positions where:
 * - Trader has net_tokens = 0 (fully exited)
 * - Market is NOT resolved yet (payout_numerators = NULL)
 * - Captures realized PnL that FIFO misses
 *
 * This is the missing piece causing $7k+ PnL discrepancies.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('🔨 Creating Closed Positions Tracking Table\n');

  try {
    // Step 1: Create the table
    console.log('Step 1: Creating pm_closed_positions_v1...');
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS pm_closed_positions_v1
        (
          wallet String,
          condition_id String,
          outcome_index UInt8,

          -- Position metrics
          total_tokens_bought Float64,
          total_tokens_sold Float64,
          net_tokens Float64, -- Should be 0 for closed positions

          -- Cash flow (this is the realized PnL)
          total_cash_in Float64,  -- Money spent buying
          total_cash_out Float64, -- Money received selling
          net_cash_flow Float64,  -- Realized PnL

          -- Trade counts
          buy_count UInt32,
          sell_count UInt32,
          total_fills UInt32,

          -- Timestamps
          first_trade DateTime,
          last_trade DateTime,
          closed_at DateTime, -- When net_tokens became 0

          -- Market info
          market_open UInt8,  -- 1 if market still open, 0 if resolved

          -- Version for updates
          _version UInt64,
          _updated_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(_version)
        PARTITION BY toYYYYMM(closed_at)
        ORDER BY (wallet, condition_id, outcome_index)
        SETTINGS index_granularity = 8192
      `,
      clickhouse_settings: { max_execution_time: 60 },
    });
    console.log('✓ pm_closed_positions_v1 created\n');

    // Step 2: Create view for easy querying
    console.log('Step 2: Creating pm_closed_positions_current view...');
    await clickhouse.command({
      query: `
        CREATE VIEW IF NOT EXISTS pm_closed_positions_current AS
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(total_tokens_bought) as total_tokens_bought,
          any(total_tokens_sold) as total_tokens_sold,
          any(net_tokens) as net_tokens,
          any(total_cash_in) as total_cash_in,
          any(total_cash_out) as total_cash_out,
          any(net_cash_flow) as net_cash_flow,
          any(buy_count) as buy_count,
          any(sell_count) as sell_count,
          any(total_fills) as total_fills,
          any(first_trade) as first_trade,
          any(last_trade) as last_trade,
          any(closed_at) as closed_at,
          any(market_open) as market_open,
          max(_version) as _version,
          any(_updated_at) as _updated_at
        FROM pm_closed_positions_v1
        GROUP BY wallet, condition_id, outcome_index
      `,
      clickhouse_settings: { max_execution_time: 60 },
    });
    console.log('✓ pm_closed_positions_current view created\n');

    console.log('════════════════════════════════════════════════════');
    console.log('✅ Closed Positions Table Created!');
    console.log('════════════════════════════════════════════════════');
    console.log('\nNext step: Run 02-populate-closed-positions.ts to backfill data\n');

  } catch (error: any) {
    console.error('\n❌ Error creating table:', error.message);
    throw error;
  }
}

main().catch(console.error);
