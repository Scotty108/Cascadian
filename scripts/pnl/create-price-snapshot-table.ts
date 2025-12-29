/**
 * Create price snapshot table for benchmark validation
 *
 * This table stores Gamma prices at the time benchmarks are captured,
 * enabling accurate validation without benchmark drift.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();

  console.log('Creating pm_benchmark_price_snapshots table...\n');

  // Create the price snapshot table
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS pm_benchmark_price_snapshots (
      benchmark_set_id String,
      condition_id String,
      outcome_index Int64,
      gamma_price Float64,
      fetched_at DateTime,
      inserted_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(inserted_at)
    ORDER BY (benchmark_set_id, condition_id, outcome_index)
  `;

  await client.command({ query: createTableQuery });
  console.log('✓ Created pm_benchmark_price_snapshots table');

  // Verify table exists
  const verifyQuery = `DESCRIBE pm_benchmark_price_snapshots`;
  const result = await client.query({ query: verifyQuery, format: 'JSONEachRow' });
  const cols = await result.json() as any[];

  console.log('\nTable schema:');
  for (const c of cols) {
    console.log(`  ${c.name}: ${c.type}`);
  }

  // Also add benchmark_set_id column to pm_ui_pnl_benchmarks_v1 if missing
  console.log('\nChecking pm_ui_pnl_benchmarks_v1 schema...');
  const benchSchema = await client.query({
    query: 'DESCRIBE pm_ui_pnl_benchmarks_v1',
    format: 'JSONEachRow'
  });
  const benchCols = await benchSchema.json() as any[];
  const colNames = benchCols.map((c: any) => c.name);

  console.log('Current columns:', colNames.join(', '));

  if (!colNames.includes('benchmark_set_id')) {
    console.log('\n⚠ benchmark_set_id column missing - using benchmark_set instead');
  }
}

main().catch(console.error);
