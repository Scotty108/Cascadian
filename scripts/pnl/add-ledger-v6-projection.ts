/**
 * Add projection to pm_unified_ledger_v6 for fast per-wallet queries
 *
 * This enables efficient candidate generation without 120s+ timeouts.
 * The projection orders data by (wallet, event_time) making GROUP BY wallet fast.
 *
 * Usage:
 *   npx tsx scripts/pnl/add-ledger-v6-projection.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();

  console.log('=== ADD PROJECTION TO pm_unified_ledger_v6 ===\n');

  // Check if projection already exists
  console.log('Checking existing projections...');
  const existingResult = await client.query({
    query: `
      SELECT name, type
      FROM system.data_skipping_indices
      WHERE table = 'pm_unified_ledger_v6' AND database = 'default'
    `,
    format: 'JSONEachRow',
  });
  const existing = await existingResult.json();
  console.log('Existing indices:', existing);

  // Check projections via system.projections
  const projResult = await client.query({
    query: `
      SELECT name, partition, rows, bytes_on_disk
      FROM system.projection_parts
      WHERE table = 'pm_unified_ledger_v6'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const projections = await projResult.json();
  console.log('Existing projection parts:', projections);

  // Add the projection
  console.log('\nAdding projection proj_by_wallet...');
  try {
    await client.command({
      query: `
        ALTER TABLE pm_unified_ledger_v6
        ADD PROJECTION IF NOT EXISTS proj_by_wallet
        (
          SELECT *
          ORDER BY (lower(wallet_address), event_time)
        )
      `,
    });
    console.log('✓ Projection added');
  } catch (err: any) {
    if (err.message?.includes('already exists')) {
      console.log('✓ Projection already exists');
    } else {
      throw err;
    }
  }

  // Materialize the projection
  console.log('\nMaterializing projection (this may take a few minutes)...');
  try {
    await client.command({
      query: `
        ALTER TABLE pm_unified_ledger_v6
        MATERIALIZE PROJECTION proj_by_wallet
      `,
    });
    console.log('✓ Projection materialized');
  } catch (err: any) {
    console.log('Materialize result:', err.message || 'Started');
  }

  // Check row count
  const countResult = await client.query({
    query: `SELECT count() as cnt FROM pm_unified_ledger_v6`,
    format: 'JSONEachRow',
  });
  const countRows = await countResult.json() as { cnt: string }[];
  console.log(`\nTable has ${Number(countRows[0].cnt).toLocaleString()} rows`);

  console.log('\nProjection setup initiated. Materialization runs in background.');
  console.log('You can check progress with:');
  console.log('  SELECT * FROM system.mutations WHERE table = \'pm_unified_ledger_v6\' AND is_done = 0');

  process.exit(0);
}

main().catch(console.error);
