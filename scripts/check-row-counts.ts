#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Row Count Comparison: pm_trades vs pm_trades_with_external vs pm_trades_complete\n');
  console.log('='.repeat(80));
  console.log('');

  // Overall counts
  const tables = ['pm_trades', 'pm_trades_with_external', 'pm_trades_complete'];
  const counts = [];

  for (const table of tables) {
    const query = await clickhouse.query({
      query: `SELECT COUNT(*) as count FROM ${table}`,
      format: 'JSONEachRow'
    });
    const result = await query.json<any>();
    counts.push({
      table,
      total_rows: parseInt(result[0].count)
    });
  }

  console.log('Overall Row Counts:');
  console.table(counts);
  console.log('');

  // Breakdown by data_source
  console.log('Breakdown by data_source:');
  console.log('-'.repeat(80));
  console.log('');

  for (const table of ['pm_trades_with_external', 'pm_trades_complete']) {
    console.log(`${table}:`);
    const query = await clickhouse.query({
      query: `
        SELECT
          data_source,
          COUNT(*) as count,
          COUNT(DISTINCT wallet_address) as wallets,
          COUNT(DISTINCT condition_id) as markets
        FROM ${table}
        GROUP BY data_source
        ORDER BY count DESC
      `,
      format: 'JSONEachRow'
    });
    const result = await query.json();
    console.table(result);
    console.log('');
  }

  // Check for duplicates
  console.log('Duplicate Check:');
  console.log('-'.repeat(80));
  console.log('');

  const dupQuery = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        side,
        shares,
        price,
        COUNT(*) as duplicate_count
      FROM pm_trades_complete
      GROUP BY wallet_address, condition_id, outcome_index, side, shares, price
      HAVING duplicate_count > 1
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const dups = await dupQuery.json();

  if (dups.length === 0) {
    console.log('✅ No duplicates found!');
  } else {
    console.log(`⚠️  Found ${dups.length} duplicate trade groups:`);
    console.table(dups);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Summary:');
  console.log('='.repeat(80));
  console.log('');

  const pm_trades_count = counts.find(c => c.table === 'pm_trades')!.total_rows;
  const with_external_count = counts.find(c => c.table === 'pm_trades_with_external')!.total_rows;
  const complete_count = counts.find(c => c.table === 'pm_trades_complete')!.total_rows;

  console.log(`pm_trades (CLOB only): ${pm_trades_count.toLocaleString()}`);
  console.log(`pm_trades_with_external (UNION): ${with_external_count.toLocaleString()}`);
  console.log(`pm_trades_complete (interface): ${complete_count.toLocaleString()}`);
  console.log('');

  const external_count = with_external_count - pm_trades_count;
  console.log(`External trades added: ${external_count.toLocaleString()}`);
  console.log('');

  if (with_external_count === complete_count) {
    console.log('✅ pm_trades_with_external and pm_trades_complete have same row count');
  } else {
    console.log(`⚠️  Row count mismatch: ${with_external_count} vs ${complete_count}`);
  }

  if (external_count === 46) {
    console.log('✅ Expected 46 external trades confirmed');
  } else {
    console.log(`⚠️  Expected 46 external trades, found ${external_count}`);
  }

  console.log('');
}

main().catch(console.error);
