#!/usr/bin/env tsx
/**
 * Phase 2: Configure Aggressive Merge Settings
 *
 * Optimizes merge behavior to minimize duplicate window for source tables.
 *
 * Duration: 1 minute
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('⚙️  Configuring Aggressive Merge Settings\n');

  try {
    // pm_canonical_fills_v4 - merge every hour
    console.log('Configuring pm_canonical_fills_v4...');
    await clickhouse.command({
      query: `
        ALTER TABLE pm_canonical_fills_v4
        MODIFY SETTING
          merge_with_ttl_timeout = 3600,
          max_bytes_to_merge_at_max_space_in_pool = 161061273600,
          number_of_free_entries_in_pool_to_lower_max_size_of_merge = 0
      `,
      clickhouse_settings: { max_execution_time: 60 },
    });
    console.log('✓ pm_canonical_fills_v4 merge settings updated\n');

    // pm_trade_fifo_roi_v3 - merge every 30 min
    console.log('Configuring pm_trade_fifo_roi_v3...');
    await clickhouse.command({
      query: `
        ALTER TABLE pm_trade_fifo_roi_v3
        MODIFY SETTING
          merge_with_ttl_timeout = 1800,
          max_bytes_to_merge_at_max_space_in_pool = 107374182400
      `,
      clickhouse_settings: { max_execution_time: 60 },
    });
    console.log('✓ pm_trade_fifo_roi_v3 merge settings updated\n');

    // pm_trader_events_v2 - merge every 2 hours (legacy, less critical)
    console.log('Configuring pm_trader_events_v2...');
    await clickhouse.command({
      query: `
        ALTER TABLE pm_trader_events_v2
        MODIFY SETTING
          merge_with_ttl_timeout = 7200,
          max_bytes_to_merge_at_max_space_in_pool = 107374182400
      `,
      clickhouse_settings: { max_execution_time: 60 },
    });
    console.log('✓ pm_trader_events_v2 merge settings updated\n');

    console.log('════════════════════════════════════════════════════');
    console.log('✅ Merge Settings Configured!');
    console.log('════════════════════════════════════════════════════');
    console.log('Tables will merge more aggressively going forward.');
    console.log('\nNext step: Run 03-migrate-queries.sh to update all queries\n');

  } catch (error: any) {
    console.error('\n❌ Error configuring merge settings:', error.message);
    throw error;
  }
}

main().catch(console.error);
