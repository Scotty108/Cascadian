#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('Creating ClickHouse tables directly...\n')

  // Add missing columns to trades_raw
  console.log('1. Adding missing columns to trades_raw...')
  try {
    await clickhouse.command({
      query: `ALTER TABLE trades_raw ADD COLUMN IF NOT EXISTS realized_pnl_usd Float64 DEFAULT 0.0`
    })
    console.log('   ✅ Added realized_pnl_usd')
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('   ✅ realized_pnl_usd already exists')
    } else {
      console.log('   ⚠️ ', error.message)
    }
  }

  try {
    await clickhouse.command({
      query: `ALTER TABLE trades_raw ADD COLUMN IF NOT EXISTS is_resolved UInt8 DEFAULT 0`
    })
    console.log('   ✅ Added is_resolved')
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('   ✅ is_resolved already exists')
    } else {
      console.log('   ⚠️ ', error.message)
    }
  }

  // Create condition_market_map
  console.log('\n2. Creating condition_market_map...')
  try {
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS condition_market_map (
          condition_id String,
          market_id String,
          event_id String,
          canonical_category String,
          raw_tags Array(String),
          ingested_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(ingested_at)
        ORDER BY (condition_id)
        SETTINGS index_granularity = 8192
      `
    })
    console.log('   ✅ Created condition_market_map')
  } catch (error: any) {
    console.log('   ⚠️ ', error.message)
  }

  // Create markets_dim
  console.log('\n3. Creating markets_dim...')
  try {
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS markets_dim (
          market_id String,
          question String,
          event_id String,
          ingested_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(ingested_at)
        ORDER BY (market_id)
        SETTINGS index_granularity = 8192
      `
    })
    console.log('   ✅ Created markets_dim')
  } catch (error: any) {
    console.log('   ⚠️ ', error.message)
  }

  // Create events_dim
  console.log('\n4. Creating events_dim...')
  try {
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS events_dim (
          event_id String,
          canonical_category String,
          raw_tags Array(String),
          title String,
          ingested_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(ingested_at)
        ORDER BY (event_id)
        SETTINGS index_granularity = 8192
      `
    })
    console.log('   ✅ Created events_dim')
  } catch (error: any) {
    console.log('   ⚠️ ', error.message)
  }

  console.log('\n✅ Table creation complete!')
}

main()
