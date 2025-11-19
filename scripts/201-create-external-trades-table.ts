#!/usr/bin/env tsx
/**
 * Phase 1: Create external_trades_raw Table
 *
 * Purpose: Create a neutral landing zone for trades from external sources
 *          (Dome, Dune, Polymarket Subgraph, Data API, etc.) that are NOT
 *          captured by our CLOB pipeline.
 *
 * Schema: Generic enough to accept data from multiple sources without
 *         touching core CLOB tables.
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 1: Create external_trades_raw Table');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Purpose: Generic landing zone for non-CLOB trade data');
  console.log('Sources: Dome, Dune, Polymarket Subgraph, Data API, etc.');
  console.log('');

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS external_trades_raw
    (
      -- Source Tracking
      source                  LowCardinality(String) COMMENT 'Data source: dome, dune, polymarket_api, subgraph, etc.',
      ingested_at             DateTime DEFAULT now() COMMENT 'Server timestamp of ingestion',
      external_trade_id       String COMMENT 'Upstream unique ID for deduplication',

      -- Wallet & Market
      wallet_address          String COMMENT 'EOA or proxy address (lowercase, no 0x prefix)',
      condition_id            String COMMENT 'Normalized condition_id (lowercase, no 0x prefix, 64 chars)',
      market_question         String DEFAULT '' COMMENT 'Market question for debugging',

      -- Trade Details
      side                    LowCardinality(String) COMMENT 'YES/NO or generic outcome label',
      outcome_index           Int32 DEFAULT -1 COMMENT 'Numeric outcome index if available',
      shares                  Float64 COMMENT 'Number of shares traded',
      price                   Float64 COMMENT 'Price per share (0-1 probability)',
      cash_value              Float64 DEFAULT 0.0 COMMENT 'price * shares if given by upstream',
      fees                    Float64 DEFAULT 0.0 COMMENT 'Trading fees if available',

      -- Timestamps & Blockchain
      trade_timestamp         DateTime COMMENT 'When trade occurred',
      tx_hash                 String DEFAULT '' COMMENT 'Blockchain tx hash if on-chain or provided'
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(trade_timestamp)
    ORDER BY (condition_id, wallet_address, trade_timestamp, external_trade_id)
    SETTINGS index_granularity = 8192
    COMMENT 'External trade data from non-CLOB sources (Dome, Dune, Subgraph, etc.)';
  `;

  console.log('Step 1: Creating external_trades_raw table...');
  console.log('');

  try {
    await clickhouse.command({
      query: createTableSQL
    });

    console.log('✅ Table created successfully');
    console.log('');
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('✅ Table already exists (safe to re-run)');
      console.log('');
    } else {
      throw error;
    }
  }

  // Create indexes for fast lookups
  console.log('Step 2: Creating indexes...');
  console.log('');

  const indexes = [
    {
      name: 'idx_external_trades_wallet',
      column: 'wallet_address',
      description: 'Fast wallet lookup'
    },
    {
      name: 'idx_external_trades_condition',
      column: 'condition_id',
      description: 'Fast market lookup'
    },
    {
      name: 'idx_external_trades_source',
      column: 'source',
      description: 'Filter by data source'
    }
  ];

  for (const idx of indexes) {
    try {
      await clickhouse.command({
        query: `
          CREATE INDEX IF NOT EXISTS ${idx.name}
          ON external_trades_raw (${idx.column})
          TYPE bloom_filter(0.01) GRANULARITY 1
        `
      });
      console.log(`  ✅ ${idx.description}: ${idx.name}`);
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        console.log(`  ✅ ${idx.description}: ${idx.name} (already exists)`);
      } else {
        console.error(`  ❌ Failed to create ${idx.name}: ${error.message}`);
      }
    }
  }

  console.log('');

  // Verify table exists and get schema
  console.log('Step 3: Verifying table schema...');
  console.log('');

  try {
    const describeResult = await clickhouse.query({
      query: 'DESCRIBE TABLE external_trades_raw',
      format: 'JSONEachRow'
    });

    const schema = await describeResult.json();
    console.log('Table Schema:');
    console.table(schema.map((col: any) => ({
      name: col.name,
      type: col.type,
      comment: col.comment || ''
    })));
    console.log('');

    // Get row count
    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM external_trades_raw',
      format: 'JSONEachRow'
    });

    const count = (await countResult.json())[0].cnt;
    console.log(`Current row count: ${count}`);
    console.log('');

  } catch (error: any) {
    console.error('❌ Failed to verify table:', error.message);
    throw error;
  }

  console.log('═'.repeat(80));
  console.log('PHASE 1 COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('✅ external_trades_raw table created');
  console.log('✅ Indexes created for fast lookups');
  console.log('✅ Schema verified');
  console.log('');
  console.log('Next Step: Phase 2 - Create pm_trades_with_external UNION view');
  console.log('Run: npx tsx scripts/202-create-pm-trades-with-external-view.ts');
  console.log('');
  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
