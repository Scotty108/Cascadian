#!/usr/bin/env tsx
/**
 * Migration: Add Missing Columns to pm_market_metadata
 *
 * Adds all the missing data points from Gamma API:
 * - Resolution data (winning_outcome, resolution_source)
 * - Market depth (liquidity, spread, bid/ask)
 * - Full outcomes array
 * - Event grouping
 * - Timestamps
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function migrateSchema() {
  console.log('\n🔄 MIGRATING pm_market_metadata SCHEMA');
  console.log('='.repeat(60));

  const columns = [
    'liquidity_usdc Float64',
    'outcomes Array(String)',
    'outcome_prices String',
    'winning_outcome String',
    'resolution_source String',
    'enable_order_book UInt8',
    'order_price_min_tick_size Float64',
    'notifications_enabled UInt8',
    'event_id String',
    'group_slug String',
    'rewards_min_size Float64',
    'rewards_max_spread Float64',
    'spread Float64',
    'best_bid Float64',
    'best_ask Float64',
    'start_date Nullable(DateTime64(3))',
    'created_at Nullable(DateTime64(3))',
    'updated_at Nullable(DateTime64(3))',
  ];

  for (const column of columns) {
    const [name] = column.split(' ');
    try {
      console.log(`  Adding column: ${name}...`);
      await clickhouse.command({
        query: `ALTER TABLE pm_market_metadata ADD COLUMN IF NOT EXISTS ${column}`,
      });
      console.log(`  ✅ ${name}`);
    } catch (error: any) {
      console.error(`  ❌ Failed to add ${name}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Schema migration complete!');
  console.log('='.repeat(60));
}

migrateSchema()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
