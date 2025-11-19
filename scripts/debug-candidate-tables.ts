import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function debugCandidateTables() {
  console.log('Debugging Candidate Tables\n');

  const candidateTables = [
    'vw_trades_canonical',
    'trade_direction_assignments',
    'trades_cid_map_v2_merged',
    'trades_cid_map_v2_twd'
  ];

  for (const table of candidateTables) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Table: ${table}`);
    console.log('='.repeat(60));

    try {
      // Check if table exists
      const existsResult = await clickhouse.query({
        query: `
          SELECT count() as exists
          FROM system.tables
          WHERE database = currentDatabase()
            AND name = '${table}'
        `,
        format: 'JSONEachRow'
      });
      const exists = await existsResult.json();

      if (exists[0].exists === 0) {
        console.log('✗ Table does NOT exist');
        continue;
      }

      console.log('✓ Table exists');

      // Get row count
      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM ${table}`,
        format: 'JSONEachRow'
      });
      const count = await countResult.json();
      console.log(`  Rows: ${count[0].cnt}`);

      // Get schema
      const schemaResult = await clickhouse.query({
        query: `DESCRIBE ${table}`,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json();

      const keyColumns = schema
        .filter(col =>
          col.name.includes('transaction_hash') ||
          col.name.includes('wallet') ||
          col.name.includes('condition_id')
        )
        .map(col => `${col.name} (${col.type})`);

      console.log(`  Key columns:`, keyColumns);

      // Check for overlapping transaction hashes
      const overlapResult = await clickhouse.query({
        query: `
          SELECT count() as overlap_count
          FROM ${table}
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024)
        `,
        format: 'JSONEachRow'
      });
      const overlap = await overlapResult.json();
      console.log(`  Overlapping tx_hashes: ${overlap[0].overlap_count}`);

      // Sample a few rows
      const sampleResult = await clickhouse.query({
        query: `SELECT * FROM ${table} LIMIT 2`,
        format: 'JSONEachRow'
      });
      const sample = await sampleResult.json();
      console.log(`  Sample row keys:`, Object.keys(sample[0] || {}));

    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
    }
  }
}

debugCandidateTables()
  .then(() => {
    console.log('\n✓ Debug complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
