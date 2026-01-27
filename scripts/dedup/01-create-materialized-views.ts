#!/usr/bin/env tsx
/**
 * Phase 1: Create Deduplicated Materialized Views
 *
 * Creates materialized views that auto-deduplicate on write for:
 * - pm_canonical_fills_v4_deduped
 * - pm_trade_fifo_roi_v3_deduped
 * - pm_trader_events_v2_deduped
 *
 * After this, ALL production queries should use _deduped views.
 *
 * Duration: 30-60 minutes (views populate in background)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('🔨 Creating Deduplicated Materialized Views\n');
  console.log('This creates the views immediately, but population happens in background.\n');

  try {
    // Step 1: pm_canonical_fills_v4_deduped
    console.log('Step 1: Creating pm_canonical_fills_v4_deduped...');
    await clickhouse.command({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS pm_canonical_fills_v4_deduped
        ENGINE = ReplacingMergeTree(_version)
        PARTITION BY toYYYYMM(event_time)
        ORDER BY (wallet, condition_id, outcome_index, event_time, fill_id)
        SETTINGS index_granularity = 8192
        AS
        SELECT
          fill_id,
          wallet,
          condition_id,
          outcome_index,
          any(event_time) as event_time,
          any(block_number) as block_number,
          any(tx_hash) as tx_hash,
          any(tokens_delta) as tokens_delta,
          any(usdc_delta) as usdc_delta,
          any(source) as source,
          any(is_self_fill) as is_self_fill,
          any(is_maker) as is_maker,
          max(_version) as _version
        FROM pm_canonical_fills_v4
        GROUP BY fill_id, wallet, condition_id, outcome_index
      `,
      clickhouse_settings: { max_execution_time: 120 },
    });
    console.log('✓ pm_canonical_fills_v4_deduped created\n');

    // Step 2: pm_trade_fifo_roi_v3_deduped
    console.log('Step 2: Creating pm_trade_fifo_roi_v3_deduped...');
    await clickhouse.command({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS pm_trade_fifo_roi_v3_deduped
        ENGINE = ReplacingMergeTree()
        PARTITION BY toYYYYMM(resolved_at)
        ORDER BY (wallet, condition_id, outcome_index, entry_time)
        SETTINGS index_granularity = 8192
        AS
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(tx_hash) as tx_hash,
          any(entry_time) as entry_time,
          any(tokens) as tokens,
          any(cost_usd) as cost_usd,
          any(tokens_sold_early) as tokens_sold_early,
          any(tokens_held) as tokens_held,
          any(exit_value) as exit_value,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(pct_sold_early) as pct_sold_early,
          any(is_maker) as is_maker,
          any(resolved_at) as resolved_at,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3
        GROUP BY wallet, condition_id, outcome_index
      `,
      clickhouse_settings: { max_execution_time: 120 },
    });
    console.log('✓ pm_trade_fifo_roi_v3_deduped created\n');

    // Step 3: pm_trader_events_v2_deduped
    console.log('Step 3: Creating pm_trader_events_v2_deduped...');
    await clickhouse.command({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS pm_trader_events_v2_deduped
        ENGINE = ReplacingMergeTree()
        PARTITION BY toYYYYMM(trade_time)
        ORDER BY (trader_wallet, token_id, event_time, event_id)
        SETTINGS index_granularity = 8192
        AS
        SELECT
          event_id,
          trader_wallet,
          token_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount,
          any(trade_time) as trade_time,
          any(event_time) as event_time,
          any(transaction_hash) as transaction_hash,
          any(block_number) as block_number,
          any(role) as role,
          any(is_deleted) as is_deleted
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY event_id, trader_wallet, token_id
      `,
      clickhouse_settings: { max_execution_time: 120 },
    });
    console.log('✓ pm_trader_events_v2_deduped created\n');

    console.log('════════════════════════════════════════════════════');
    console.log('✅ All Materialized Views Created!');
    console.log('════════════════════════════════════════════════════');
    console.log('Views will populate in background over next 30-60 minutes.');
    console.log('\nCheck population progress:');
    console.log('  SELECT COUNT(*) FROM pm_canonical_fills_v4_deduped');
    console.log('  SELECT COUNT(*) FROM pm_trade_fifo_roi_v3_deduped');
    console.log('  SELECT COUNT(*) FROM pm_trader_events_v2_deduped');
    console.log('\nNext step: Run 02-configure-merge-settings.ts\n');

  } catch (error: any) {
    console.error('\n❌ Error creating views:', error.message);
    throw error;
  }
}

main().catch(console.error);
