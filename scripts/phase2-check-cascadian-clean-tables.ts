import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkCascadianCleanTables() {
  console.log('\n🔍 CHECKING CASCADIAN_CLEAN DATABASE TABLES\n');
  console.log('='.repeat(80));

  const tables = [
    'cascadian_clean.resolutions_src_api',
    'cascadian_clean.resolutions_by_cid',
    'cascadian_clean.token_to_cid_bridge'
  ];

  for (const fullTableName of tables) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n📋 TABLE: ${fullTableName}\n`);

    try {
      // Get schema
      const schemaQuery = `DESCRIBE TABLE ${fullTableName}`;
      const schemaResult = await clickhouse.query({
        query: schemaQuery,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json();

      console.log('Schema:');
      schema.forEach((col: any) => {
        console.log(`  ${col.name.padEnd(30)} ${col.type}`);
      });

      // Get row count
      const countQuery = `SELECT count() as cnt FROM ${fullTableName}`;
      const countResult = await clickhouse.query({
        query: countQuery,
        format: 'JSONEachRow'
      });
      const count = await countResult.json();

      console.log(`\nTotal rows: ${parseInt(count[0].cnt).toLocaleString()}`);

      // Sample data
      const sampleQuery = `SELECT * FROM ${fullTableName} LIMIT 3`;
      const sampleResult = await clickhouse.query({
        query: sampleQuery,
        format: 'JSONEachRow'
      });
      const samples = await sampleResult.json();

      console.log('\nSample rows:');
      if (samples.length > 0) {
        samples.forEach((row: any, i: number) => {
          console.log(`\n  Row ${i + 1}:`);
          Object.keys(row).forEach(key => {
            const val = String(row[key]);
            if (val.length > 100) {
              console.log(`    ${key}: ${val.substring(0, 100)}...`);
            } else {
              console.log(`    ${key}: ${val}`);
            }
          });
        });
      } else {
        console.log('  (No data)');
      }

      // Special handling for resolutions_src_api - check if it has clobTokenIds in metadata
      if (fullTableName === 'cascadian_clean.resolutions_src_api') {
        console.log('\n🔍 Checking for clobTokenIds in metadata:\n');

        // Check if metadata column exists and has clobTokenIds
        const hasMetadata = schema.some((col: any) => col.name === 'metadata');

        if (hasMetadata) {
          const metadataCheckQuery = `
            SELECT
              count() as total_rows,
              countIf(metadata != '') as with_metadata,
              countIf(metadata LIKE '%clobTokenIds%') as with_clob_tokens
            FROM ${fullTableName}
          `;

          const metaResult = await clickhouse.query({
            query: metadataCheckQuery,
            format: 'JSONEachRow'
          });
          const metaStats = await metaResult.json();

          console.log(`  Total rows: ${parseInt(metaStats[0].total_rows).toLocaleString()}`);
          console.log(`  With metadata: ${parseInt(metaStats[0].with_metadata).toLocaleString()}`);
          console.log(`  With clobTokenIds: ${parseInt(metaStats[0].with_clob_tokens).toLocaleString()}`);

          if (parseInt(metaStats[0].with_clob_tokens) > 0) {
            console.log('\n  ✅ Found clobTokenIds! Testing extraction:\n');

            const extractQuery = `
              SELECT
                condition_id,
                JSONExtractString(metadata, 'clobTokenIds') as clob_token_ids_raw
              FROM ${fullTableName}
              WHERE metadata LIKE '%clobTokenIds%'
              LIMIT 5
            `;

            const extractResult = await clickhouse.query({
              query: extractQuery,
              format: 'JSONEachRow'
            });
            const extracted = await extractResult.json();

            console.log('  Sample clobTokenIds:');
            extracted.forEach((row: any, i: number) => {
              console.log(`\n    ${i + 1}. Condition: ${row.condition_id}`);
              console.log(`       Tokens: ${row.clob_token_ids_raw}`);
            });

            // Test match with unmapped asset_ids
            console.log('\n  Testing match with unmapped asset_ids:\n');

            const matchQuery = `
              WITH
                parsed AS (
                  SELECT
                    condition_id,
                    JSONExtractString(metadata, 'clobTokenIds') as tokens_json,
                    JSONExtractArrayRaw(tokens_json) as token_array
                  FROM ${fullTableName}
                  WHERE tokens_json != '' AND tokens_json != '[]'
                ),
                flattened AS (
                  SELECT
                    condition_id,
                    replaceAll(replaceAll(arrayJoin(token_array), '"', ''), '\\\\', '') as token_id
                  FROM parsed
                ),
                unmapped AS (
                  SELECT DISTINCT asset_id
                  FROM clob_fills
                  WHERE asset_id NOT IN (SELECT token_id FROM ctf_token_map WHERE token_id != '')
                  LIMIT 1000
                )
              SELECT
                count() as total_unmapped_tested,
                countIf(asset_id IN (SELECT token_id FROM flattened)) as found_in_table,
                round(found_in_table / total_unmapped_tested * 100, 2) as match_pct
              FROM unmapped
            `;

            const matchResult = await clickhouse.query({
              query: matchQuery,
              format: 'JSONEachRow'
            });
            const match = await matchResult.json();

            console.log(`    Unmapped tested: ${match[0].total_unmapped_tested}`);
            console.log(`    Found in table: ${match[0].found_in_table}`);
            console.log(`    Match rate: ${match[0].match_pct}%`);

            if (parseFloat(match[0].match_pct) > 50) {
              console.log('\n    🎯 HIGH MATCH RATE! This table is valuable!');
            }
          }
        } else {
          console.log('  ℹ️  No metadata column found');
        }
      }

      // For token_to_cid_bridge, test match
      if (fullTableName === 'cascadian_clean.token_to_cid_bridge') {
        console.log('\n🔍 Testing token_hex match with unmapped asset_ids:\n');

        const matchQuery = `
          WITH unmapped AS (
            SELECT DISTINCT asset_id
            FROM clob_fills
            WHERE asset_id NOT IN (SELECT token_id FROM ctf_token_map WHERE token_id != '')
            LIMIT 1000
          )
          SELECT
            count() as total_unmapped,
            countIf(asset_id IN (
              SELECT DISTINCT token_hex FROM ${fullTableName} WHERE token_hex != ''
            )) as found_in_bridge,
            round(found_in_bridge / total_unmapped * 100, 2) as match_pct
          FROM unmapped
        `;

        const matchResult = await clickhouse.query({
          query: matchQuery,
          format: 'JSONEachRow'
        });
        const match = await matchResult.json();

        console.log(`  Unmapped tested: ${match[0].total_unmapped}`);
        console.log(`  Found in bridge: ${match[0].found_in_bridge}`);
        console.log(`  Match rate: ${match[0].match_pct}%`);
      }

    } catch (e: any) {
      console.log(`❌ Error: ${e.message}`);
    }
  }

  console.log(`\n${'='.repeat(80)}\n`);
}

checkCascadianCleanTables().catch(console.error);
