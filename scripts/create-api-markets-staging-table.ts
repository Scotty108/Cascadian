#!/usr/bin/env tsx
/**
 * Create api_markets_staging table for Gamma API market backfill
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

async function createTable() {
  console.log('\n📊 Creating api_markets_staging table...\n');

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS default.api_markets_staging (
      -- Primary identifiers
      condition_id String COMMENT 'Condition ID (normalized: lowercase, no 0x, 64 chars)',
      market_slug LowCardinality(String) COMMENT 'Market slug (URL-friendly)',

      -- Market metadata
      question String COMMENT 'Market question/title',
      description String DEFAULT '' COMMENT 'Market description',
      outcomes Array(String) COMMENT 'Outcome names (Yes/No/candidate names)',

      -- Status flags
      active Bool COMMENT 'True if market is active (not archived)',
      closed Bool COMMENT 'True if trading is closed',
      resolved Bool DEFAULT false COMMENT 'True if market has been resolved',
      winning_outcome Nullable(UInt8) COMMENT 'Winning outcome index (0-based)',

      -- Dates
      end_date Nullable(DateTime) COMMENT 'Market end date',

      -- Volume and liquidity
      volume Float64 DEFAULT 0 COMMENT 'Total volume in USD',
      liquidity Float64 DEFAULT 0 COMMENT 'Current liquidity in USD',

      -- Audit
      timestamp DateTime DEFAULT now() COMMENT 'When this row was inserted'
    )
    ENGINE = ReplacingMergeTree(timestamp)
    ORDER BY condition_id
    COMMENT 'Staging table for Gamma API market universe';
  `;

  try {
    await ch.command({ query: createTableQuery });
    console.log('✅ Table created successfully\n');

    // Verify
    const result = await ch.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          formatReadableSize(total_bytes) as size
        FROM system.tables
        WHERE database = 'default' AND name = 'api_markets_staging'
      `,
      format: 'JSONEachRow'
    });

    const tables = await result.json();
    console.log('Table info:', JSON.stringify(tables[0], null, 2));

  } catch (error) {
    console.error('❌ Error creating table:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

createTable();
