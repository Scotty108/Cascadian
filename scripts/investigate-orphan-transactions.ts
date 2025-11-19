import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function investigateOrphanTransactions() {
  console.log('Investigating Orphan Transactions\n');
  console.log('='.repeat(80) + '\n');

  // Get sample transaction hashes from orphans
  console.log('1. Sample orphan transaction hashes:');
  const orphanSample = await clickhouse.query({
    query: `
      SELECT DISTINCT transaction_hash
      FROM tmp_v3_orphans_oct2024
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const orphanTxs = await orphanSample.json();
  console.log(JSON.stringify(orphanTxs, null, 2));

  const sampleTx = orphanTxs[0].transaction_hash;
  console.log(`\n2. Using sample tx: ${sampleTx}\n`);

  // Check where this transaction exists
  const tables = [
    'pm_trades_canonical_v3_sandbox',
    'vw_trades_canonical',
    'trades_cid_map_v2_merged',
    'trades_cid_map_v2_twd',
    'pm_clob_fills',
    'pm_erc1155_flats',
    'trades_with_direction'
  ];

  console.log('3. Checking which tables contain this transaction:\n');

  for (const table of tables) {
    try {
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
        console.log(`   ${table.padEnd(35)} - Table does not exist`);
        continue;
      }

      const countResult = await clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM ${table}
          WHERE transaction_hash = '${sampleTx}'
        `,
        format: 'JSONEachRow'
      });
      const count = await countResult.json();
      console.log(`   ${table.padEnd(35)} - ${count[0].cnt} rows`);

      if (count[0].cnt > 0) {
        // Get a sample
        const sampleResult = await clickhouse.query({
          query: `SELECT * FROM ${table} WHERE transaction_hash = '${sampleTx}' LIMIT 1`,
          format: 'JSONEachRow'
        });
        const sample = await sampleResult.json();
        console.log(`      Sample: ${JSON.stringify(sample[0]).substring(0, 200)}...`);
      }
    } catch (error) {
      console.log(`   ${table.padEnd(35)} - Error: ${error.message.substring(0, 80)}`);
    }
  }

  // Check total orphan distribution by id_repair_source
  console.log('\n4. Orphan distribution by id_repair_source:');
  const distResult = await clickhouse.query({
    query: `
      SELECT
        id_repair_source,
        count() as cnt,
        count(DISTINCT transaction_hash) as unique_txs
      FROM tmp_v3_orphans_oct2024
      GROUP BY id_repair_source
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const dist = await distResult.json();
  console.log(JSON.stringify(dist, null, 2));

  // Check if there are any orphans with different repair sources
  console.log('\n5. Checking if orphans came from specific sources:');
  const sourceCheckResult = await clickhouse.query({
    query: `
      SELECT
        source,
        count() as cnt
      FROM pm_trades_canonical_v3_sandbox
      WHERE toYYYYMM(timestamp) = 202410
        AND (condition_id_norm_v2 IS NULL
             OR condition_id_norm_v2 = ''
             OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000')
      GROUP BY source
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const sourceCheck = await sourceCheckResult.json();
  console.log(JSON.stringify(sourceCheck, null, 2));

  // Check total October 2024 coverage in v3_sandbox vs candidate tables
  console.log('\n6. October 2024 coverage comparison:');
  console.log('   v3_sandbox total rows:');
  const v3TotalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(condition_id_norm_v2 IS NOT NULL AND condition_id_norm_v2 != '' AND length(condition_id_norm_v2) = 64) as with_cid,
        countIf(condition_id_norm_v2 IS NULL OR condition_id_norm_v2 = '' OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000') as orphans
      FROM pm_trades_canonical_v3_sandbox
      WHERE toYYYYMM(timestamp) = 202410
    `,
    format: 'JSONEachRow'
  });
  const v3Total = await v3TotalResult.json();
  console.log(`     Total: ${v3Total[0].total}, With CID: ${v3Total[0].with_cid}, Orphans: ${v3Total[0].orphans}`);

  // Check how many October 2024 transactions exist in vw_trades_canonical
  console.log('   vw_trades_canonical October 2024 coverage:');
  const vtcOctResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        count(DISTINCT transaction_hash) as unique_txs
      FROM vw_trades_canonical
      WHERE toYYYYMM(timestamp) = 202410
    `,
    format: 'JSONEachRow'
  });
  const vtcOct = await vtcOctResult.json();
  console.log(`     Total: ${vtcOct[0].total}, Unique TXs: ${vtcOct[0].unique_txs}`);
}

investigateOrphanTransactions()
  .then(() => {
    console.log('\n✓ Investigation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
