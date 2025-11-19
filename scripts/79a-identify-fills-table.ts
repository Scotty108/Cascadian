#!/usr/bin/env tsx
/**
 * Identify Authoritative CLOB Fills Table
 *
 * Finds and inspects the primary CLOB fills table for pm_trades.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔍 Identifying Authoritative CLOB Fills Table');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Find candidate fills tables
  console.log('Step 1: Finding candidate CLOB fills tables...');
  console.log('');

  const tablesQuery = await clickhouse.query({
    query: `
      SELECT
        name,
        total_rows,
        formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND (
          name LIKE '%fill%'
          OR name LIKE '%clob%'
          OR name LIKE '%trade%'
        )
        AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const tables = await tablesQuery.json();
  console.log('Candidate Tables:');
  console.table(tables);
  console.log('');

  // Step 2: Inspect clob_fills schema
  console.log('Step 2: Inspecting clob_fills schema...');
  console.log('');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE TABLE clob_fills`,
    format: 'JSONEachRow'
  });

  const schema = await schemaQuery.json();
  console.log('clob_fills Schema:');
  console.table(schema);
  console.log('');

  // Step 3: Sample rows
  console.log('Step 3: Sample rows from clob_fills...');
  console.log('');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        *
      FROM clob_fills
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json();
  console.log('Sample Rows:');
  console.log(JSON.stringify(samples, null, 2));
  console.log('');

  // Step 4: Key stats
  console.log('Step 4: Key statistics...');
  console.log('');

  const statsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_fills,
        COUNT(DISTINCT asset_id) as distinct_assets,
        MIN(timestamp) as earliest_fill,
        MAX(timestamp) as latest_fill,
        COUNT(DISTINCT maker_address) as distinct_makers,
        COUNT(DISTINCT taker_address) as distinct_takers
      FROM clob_fills
    `,
    format: 'JSONEachRow'
  });

  const stats = await statsQuery.json();
  console.log('clob_fills Statistics:');
  console.table(stats);
  console.log('');

  console.log('='.repeat(60));
  console.log('✅ RECOMMENDATION');
  console.log('='.repeat(60));
  console.log('');
  console.log('Use clob_fills as the authoritative CLOB fills table for pm_trades');
  console.log('');
  console.log('Key Fields Identified:');
  console.log('  - Trade ID: (check sample for actual column name)');
  console.log('  - Asset ID: asset_id');
  console.log('  - Timestamp: timestamp');
  console.log('  - Wallets: maker_address, taker_address');
  console.log('  - Trade Details: (check sample for price, size, side columns)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Investigation failed:', error);
  process.exit(1);
});
