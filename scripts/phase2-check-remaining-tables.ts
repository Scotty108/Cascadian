import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkRemainingTables() {
  console.log('\n🔍 CHECKING REMAINING TOKEN TABLES\n');
  console.log('='.repeat(80));

  const tablesToCheck = [
    { name: 'cascadian_clean.token_condition_market_map', rows: 227838 },
    { name: 'default.merged_market_mapping', rows: 41306 },
    { name: 'default.legacy_token_condition_map', rows: 17136 }
  ];

  for (const tableInfo of tablesToCheck) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n📋 TABLE: ${tableInfo.name} (${tableInfo.rows.toLocaleString()} rows)\n`);

    try {
      // Get schema
      const schemaQuery = `DESCRIBE TABLE ${tableInfo.name}`;
      const schemaResult = await clickhouse.query({
        query: schemaQuery,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json();

      console.log('Schema:');
      schema.forEach((col: any) => {
        console.log(`  ${col.name.padEnd(30)} ${col.type}`);
      });

      // Get sample data
      const sampleQuery = `SELECT * FROM ${tableInfo.name} LIMIT 5`;
      const sampleResult = await clickhouse.query({
        query: sampleQuery,
        format: 'JSONEachRow'
      });
      const samples = await sampleResult.json();

      console.log('\nSample data:');
      if (samples.length > 0) {
        console.table(samples);
      } else {
        console.log('  (No data)');
      }

      // Look for token_id columns
      const hasTokenId = schema.some((col: any) =>
        col.name.toLowerCase().includes('token') &&
        col.name.toLowerCase().includes('id')
      );

      if (hasTokenId) {
        console.log('\n🔍 Testing for token_id match with unmapped asset_ids:\n');

        // Try to find the right token column
        const tokenColumns = schema
          .filter((col: any) => col.name.toLowerCase().includes('token'))
          .map((col: any) => col.name);

        console.log(`  Token columns found: ${tokenColumns.join(', ')}`);

        for (const col of tokenColumns) {
          try {
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
                  SELECT DISTINCT ${col} FROM ${tableInfo.name} WHERE ${col} != ''
                )) as found_in_table,
                round(found_in_table / total_unmapped * 100, 2) as match_pct
              FROM unmapped
            `;

            const matchResult = await clickhouse.query({
              query: matchQuery,
              format: 'JSONEachRow'
            });
            const match = await matchResult.json();

            console.log(`\n  Column: ${col}`);
            console.log(`    Unmapped tested: ${match[0].total_unmapped}`);
            console.log(`    Found in table: ${match[0].found_in_table}`);
            console.log(`    Match rate: ${match[0].match_pct}%`);

            if (parseFloat(match[0].match_pct) > 10) {
              console.log('    ✅ Significant match found!');

              // Calculate coverage improvement
              const coverageQuery = `
                WITH all_tokens AS (
                  SELECT token_id FROM ctf_token_map WHERE token_id != ''
                  UNION DISTINCT
                  SELECT ${col} as token_id FROM ${tableInfo.name} WHERE ${col} != ''
                )
                SELECT
                  count() as total_fills,
                  countIf(asset_id IN (SELECT token_id FROM all_tokens)) as covered,
                  round(covered / total_fills * 100, 2) as coverage_pct
                FROM clob_fills
                WHERE asset_id != ''
              `;

              const coverageResult = await clickhouse.query({
                query: coverageQuery,
                format: 'JSONEachRow'
              });
              const coverage = await coverageResult.json();

              console.log(`    Coverage if merged: ${coverage[0].coverage_pct}%`);
            }
          } catch (e: any) {
            console.log(`    Error testing ${col}: ${e.message}`);
          }
        }
      }

    } catch (e: any) {
      console.log(`❌ Error: ${e.message}`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('\n🎯 FINAL ANALYSIS:\n');

  // Calculate best possible coverage with all sources
  const finalQuery = `
    WITH
      id_bridge_tokens AS (
        SELECT
          replaceAll(replaceAll(arrayJoin(JSONExtractArrayRaw(JSONExtractString(metadata, 'clobTokenIds'))), '"', ''), '\\\\', '') as token_id
        FROM id_bridge
        WHERE JSONExtractString(metadata, 'clobTokenIds') != ''
      ),
      all_tokens AS (
        SELECT token_id FROM ctf_token_map WHERE token_id != ''
        UNION DISTINCT
        SELECT token_id FROM id_bridge_tokens
      ),
      unmapped_tokens AS (
        SELECT DISTINCT asset_id
        FROM clob_fills
        WHERE asset_id NOT IN (SELECT token_id FROM all_tokens)
      )
    SELECT
      -- Total metrics
      (SELECT count() FROM clob_fills WHERE asset_id != '') as total_fills,
      (SELECT uniq(asset_id) FROM clob_fills WHERE asset_id != '') as total_unique_tokens,

      -- Current state
      (SELECT count() FROM clob_fills WHERE asset_id IN (SELECT token_id FROM ctf_token_map WHERE token_id != '')) as currently_mapped_fills,
      (SELECT uniq(token_id) FROM ctf_token_map WHERE token_id != '') as currently_mapped_tokens,

      -- After id_bridge
      (SELECT count() FROM clob_fills WHERE asset_id IN (SELECT token_id FROM all_tokens)) as after_id_bridge_fills,
      (SELECT count() FROM all_tokens) as after_id_bridge_tokens,

      -- Unmapped
      (SELECT count() FROM unmapped_tokens) as unmapped_tokens,
      (SELECT count() FROM clob_fills WHERE asset_id IN (SELECT asset_id FROM unmapped_tokens)) as unmapped_fills,

      -- Percentages
      round(currently_mapped_fills / total_fills * 100, 2) as current_fill_coverage,
      round(after_id_bridge_fills / total_fills * 100, 2) as best_fill_coverage,
      round(currently_mapped_tokens / total_unique_tokens * 100, 2) as current_token_coverage,
      round(after_id_bridge_tokens / total_unique_tokens * 100, 2) as best_token_coverage
  `;

  try {
    const finalResult = await clickhouse.query({
      query: finalQuery,
      format: 'JSONEachRow'
    });
    const final = await finalResult.json();

    console.log('Total metrics:');
    console.log(`  Total fills: ${parseInt(final[0].total_fills).toLocaleString()}`);
    console.log(`  Total unique tokens: ${parseInt(final[0].total_unique_tokens).toLocaleString()}`);
    console.log('');
    console.log('Current state (ctf_token_map only):');
    console.log(`  Mapped fills: ${parseInt(final[0].currently_mapped_fills).toLocaleString()} (${final[0].current_fill_coverage}%)`);
    console.log(`  Mapped tokens: ${parseInt(final[0].currently_mapped_tokens).toLocaleString()} (${final[0].current_token_coverage}%)`);
    console.log('');
    console.log('Best case (ctf_token_map + id_bridge):');
    console.log(`  Mapped fills: ${parseInt(final[0].after_id_bridge_fills).toLocaleString()} (${final[0].best_fill_coverage}%)`);
    console.log(`  Mapped tokens: ${parseInt(final[0].after_id_bridge_tokens).toLocaleString()} (${final[0].best_token_coverage}%)`);
    console.log('');
    console.log('Remaining gap:');
    console.log(`  Unmapped tokens: ${parseInt(final[0].unmapped_tokens).toLocaleString()}`);
    console.log(`  Unmapped fills: ${parseInt(final[0].unmapped_fills).toLocaleString()}`);
    console.log(`  Gap to 95% target: ${(95 - parseFloat(final[0].best_fill_coverage)).toFixed(2)}%`);
    console.log('');

    if (parseFloat(final[0].best_fill_coverage) >= 95) {
      console.log('✅ TARGET ACHIEVED! Can reach ≥95% coverage!');
    } else if (parseFloat(final[0].best_fill_coverage) >= 90) {
      console.log('⚠️ Close to target (90-95%) but below goal');
    } else {
      console.log('❌ CANNOT REACH 95% TARGET with available data');
      console.log('   External data source required (Polymarket CLOB API, Dune Analytics, etc.)');
    }

  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
}

checkRemainingTables().catch(console.error);
