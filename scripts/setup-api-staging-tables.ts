#!/usr/bin/env tsx
/**
 * Phase 2: Setup API Staging Tables
 * Creates ClickHouse tables for CLOB (off-chain order book) data
 *
 * Tables created:
 * 1. clob_fills_staging - Off-chain order book fills
 * 2. api_positions_staging - Current positions from API
 * 3. api_markets_staging - Market metadata from API
 * 4. api_trades_staging - User trade history from API
 *
 * Runtime: ~30 seconds
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('Setting up API staging tables for Phase 2 CLOB backfill...\n');

  try {
    // Table 1: CLOB Fills (off-chain order book fills)
    console.log('Creating clob_fills_staging...');
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS default.clob_fills_staging (
          id String,
          market String,
          asset_id String,
          maker_address String,
          taker_address String,
          side Enum8('BUY' = 1, 'SELL' = 2),
          size Float64,
          price Float64,
          fee_rate_bps UInt16,
          timestamp DateTime,
          transaction_hash String,
          maker_orders Array(String),
          source LowCardinality(String) DEFAULT 'clob_api',
          created_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(created_at)
        ORDER BY (maker_address, taker_address, timestamp, id)
      `,
    });
    console.log('✅ clob_fills_staging created\n');

    // Table 2: API Positions (current holdings from API)
    console.log('Creating api_positions_staging...');
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS default.api_positions_staging (
          wallet_address String,
          market String,
          condition_id String,
          asset_id String,
          outcome UInt8,
          size Float64,
          entry_price Nullable(Float64),
          timestamp DateTime,
          source LowCardinality(String) DEFAULT 'api_positions',
          created_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(created_at)
        ORDER BY (wallet_address, market, outcome, timestamp)
      `,
    });
    console.log('✅ api_positions_staging created\n');

    // Table 3: API Markets (market metadata from API)
    console.log('Creating api_markets_staging...');
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS default.api_markets_staging (
          condition_id String,
          market_slug String,
          question String,
          description String,
          outcomes Array(String),
          active Boolean,
          closed Boolean,
          resolved Boolean,
          winning_outcome Nullable(UInt8),
          end_date Nullable(DateTime),
          volume Float64,
          liquidity Float64,
          timestamp DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(timestamp)
        ORDER BY (condition_id, timestamp)
      `,
    });
    console.log('✅ api_markets_staging created\n');

    // Table 4: API Trades (user trade history from API)
    console.log('Creating api_trades_staging...');
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS default.api_trades_staging (
          id String,
          wallet_address String,
          market String,
          asset_id String,
          side Enum8('BUY' = 1, 'SELL' = 2),
          size Float64,
          price Float64,
          timestamp DateTime,
          transaction_hash String,
          fee_amount Float64,
          source LowCardinality(String) DEFAULT 'api_trades',
          created_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(created_at)
        ORDER BY (wallet_address, timestamp, id)
      `,
    });
    console.log('✅ api_trades_staging created\n');

    // Verify tables exist
    console.log('Verifying tables...');
    const result = await ch.query({
      query: `
        SELECT
          name,
          engine,
          total_rows
        FROM system.tables
        WHERE database = 'default'
          AND name IN ('clob_fills_staging', 'api_positions_staging', 'api_markets_staging', 'api_trades_staging')
        ORDER BY name
      `,
      format: 'JSONEachRow',
    });

    const tables = await result.json();
    console.log('\nTables created successfully:');
    console.log(JSON.stringify(tables, null, 2));

    console.log('\n✅ Phase 2 infrastructure setup complete!');
    console.log('\nNext steps:');
    console.log('1. Run backfill-clob-trades-comprehensive.ts to fetch CLOB fills');
    console.log('2. Run backfill-api-positions.ts to fetch current positions');
    console.log('3. Run map-api-to-canonical.ts to normalize IDs');
    console.log('4. Run create-unified-trades-view.ts to merge with blockchain data');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

main();
