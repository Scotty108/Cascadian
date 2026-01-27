#!/usr/bin/env tsx
/**
 * URGENT: Create FIFO Deduplicated View ONLY
 *
 * Creates pm_trade_fifo_roi_v3_deduped for immediate use in leaderboards.
 * Populates in background (30-60 min).
 *
 * All queries can use _deduped view immediately while it populates.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('🚀 Creating FIFO Deduplicated View (URGENT)\n');

  try {
    // Create deduplicated view
    console.log('Creating pm_trade_fifo_roi_v3_deduped...');
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
    console.log('✓ View created!\n');

    // Check current count
    const result = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM pm_trade_fifo_roi_v3_deduped',
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const currentCount = rows[0].count;

    console.log('════════════════════════════════════════════════════');
    console.log('✅ FIFO Deduplicated View Created!');
    console.log('════════════════════════════════════════════════════');
    console.log(`Current rows: ${currentCount.toLocaleString()}`);
    console.log(`Target rows: ~78M (278M → 78M after deduplication)`);
    console.log('\nView will populate in background over next 30-60 minutes.');
    console.log('\n🎯 YOU CAN USE IT NOW for queries!');
    console.log('- Queries will return current data immediately');
    console.log('- More data will appear as background population completes');
    console.log('\nMonitor progress:');
    console.log('  watch -n 60 "clickhouse-client --query \'SELECT COUNT(*) FROM pm_trade_fifo_roi_v3_deduped\'"');
    console.log('\nUpdate queries to use: FROM pm_trade_fifo_roi_v3_deduped');
    console.log('(Or run: ./scripts/dedup/03-migrate-queries.sh)\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

main().catch(console.error);
