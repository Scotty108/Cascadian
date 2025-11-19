import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkAllBridgeTables() {
  console.log('\n🔍 COMPREHENSIVE BRIDGE TABLE ANALYSIS\n');
  console.log('='.repeat(80));

  const tables = [
    'api_ctf_bridge',
    'token_to_cid_bridge',
    'resolutions_by_cid',
    'resolutions_src_api',
    'id_bridge'
  ];

  for (const table of tables) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n📋 TABLE: ${table}\n`);

    try {
      // Check if exists
      const existsQuery = `SELECT count() as cnt FROM ${table} LIMIT 1`;
      await clickhouse.query({ query: existsQuery, format: 'JSONEachRow' });
      console.log('✅ Table exists\n');

      // Get schema
      console.log('Schema:');
      const schemaQuery = `DESCRIBE TABLE ${table}`;
      const schemaResult = await clickhouse.query({
        query: schemaQuery,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json();
      schema.forEach((col: any) => {
        console.log(`  ${col.name.padEnd(30)} ${col.type}`);
      });

      // Get stats
      console.log('\nStats:');
      const statsQuery = `
        SELECT
          count() as total_rows,
          formatReadableSize(sum(data_compressed_bytes)) as size
        FROM system.parts
        WHERE database = currentDatabase()
          AND table = '${table}'
          AND active
      `;
      const statsResult = await clickhouse.query({
        query: statsQuery,
        format: 'JSONEachRow'
      });
      const stats = await statsResult.json();
      if (stats.length > 0 && stats[0].total_rows) {
        console.log(`  Total rows: ${stats[0].total_rows}`);
        console.log(`  Size: ${stats[0].size}`);
      }

      // Get actual row count
      const countQuery = `SELECT count() as cnt FROM ${table}`;
      const countResult = await clickhouse.query({
        query: countQuery,
        format: 'JSONEachRow'
      });
      const count = await countResult.json();
      console.log(`  Actual rows: ${count[0].cnt}`);

      // Sample data
      console.log('\nSample rows:');
      const sampleQuery = `SELECT * FROM ${table} LIMIT 3`;
      const sampleResult = await clickhouse.query({
        query: sampleQuery,
        format: 'JSONEachRow'
      });
      const samples = await sampleResult.json();

      if (samples.length > 0) {
        console.table(samples);
      } else {
        console.log('  (No data)');
      }

      // Check if it has unmapped asset_ids
      console.log('\n🔍 Checking for unmapped asset_ids...');

      // Try different column names
      const possibleColumns = ['asset_id', 'token_id', 'token_id_erc1155', 'ctf_token_id', 'token'];

      for (const col of possibleColumns) {
        try {
          const testQuery = `
            WITH unmapped AS (
              SELECT DISTINCT cf.asset_id
              FROM clob_fills cf
              WHERE cf.asset_id NOT IN (SELECT token_id FROM ctf_token_map)
              LIMIT 100
            )
            SELECT
              count() as total_unmapped,
              countIf(asset_id IN (
                SELECT DISTINCT ${col} FROM ${table} WHERE ${col} != ''
              )) as found_in_table,
              round(found_in_table / total_unmapped * 100, 2) as match_pct
            FROM unmapped
          `;

          const testResult = await clickhouse.query({
            query: testQuery,
            format: 'JSONEachRow'
          });
          const test = await testResult.json();

          if (parseInt(test[0].found_in_table) > 0) {
            console.log(`\n  ✅ FOUND MATCHES in column '${col}'!`);
            console.log(`     Unmapped tested: ${test[0].total_unmapped}`);
            console.log(`     Found in table: ${test[0].found_in_table}`);
            console.log(`     Match rate: ${test[0].match_pct}%`);
          }
        } catch (e: any) {
          // Column doesn't exist, skip
        }
      }

    } catch (e: any) {
      console.log(`❌ Error: ${e.message}`);
    }
  }

  console.log(`\n${'='.repeat(80)}\n`);
}

checkAllBridgeTables().catch(console.error);
