import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function comprehensiveTableSearch() {
  console.log('\n🔍 COMPREHENSIVE TABLE SEARCH FOR TOKEN MAPPINGS\n');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Find all tables with "metadata" column:\n');

  const metadataTablesQuery = `
    SELECT
      database,
      table,
      name as column_name,
      type as column_type
    FROM system.columns
    WHERE name = 'metadata'
      AND database IN ('default', 'cascadian_clean')
    ORDER BY database, table
  `;

  const metadataTablesResult = await clickhouse.query({
    query: metadataTablesQuery,
    format: 'JSONEachRow'
  });
  const metadataTables = await metadataTablesResult.json();

  console.log('Tables with metadata column:');
  console.table(metadataTables);

  console.log('\n2️⃣ Check each metadata table for clobTokenIds:\n');

  for (const row of metadataTables) {
    const fullTableName = `${row.database}.${row.table}`;
    console.log(`\nChecking ${fullTableName}...`);

    try {
      const checkQuery = `
        SELECT
          count() as total_rows,
          countIf(metadata != '') as with_metadata,
          countIf(metadata LIKE '%clobTokenIds%') as with_clob_tokens,
          round(with_clob_tokens / total_rows * 100, 2) as pct
        FROM ${fullTableName}
      `;

      const checkResult = await clickhouse.query({
        query: checkQuery,
        format: 'JSONEachRow'
      });
      const check = await checkResult.json();

      console.log(`  Total: ${parseInt(check[0].total_rows).toLocaleString()}`);
      console.log(`  With clobTokenIds: ${parseInt(check[0].with_clob_tokens).toLocaleString()} (${check[0].pct}%)`);

      if (parseInt(check[0].with_clob_tokens) > 0) {
        console.log('  ✅ Found clobTokenIds!');

        // Test match
        const matchQuery = `
          WITH
            parsed AS (
              SELECT
                JSONExtractString(metadata, 'clobTokenIds') as tokens_json,
                JSONExtractArrayRaw(tokens_json) as token_array
              FROM ${fullTableName}
              WHERE tokens_json != '' AND tokens_json != '[]'
            ),
            flattened AS (
              SELECT
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
            count() as tested,
            countIf(asset_id IN (SELECT token_id FROM flattened)) as found,
            round(found / tested * 100, 2) as match_pct
          FROM unmapped
        `;

        const matchResult = await clickhouse.query({
          query: matchQuery,
          format: 'JSONEachRow'
        });
        const match = await matchResult.json();

        console.log(`  Match rate: ${match[0].match_pct}%`);
      }
    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }

  console.log('\n3️⃣ Find all tables with names containing "token", "market", or "bridge":\n');

  const tokenTablesQuery = `
    SELECT
      database,
      name as table_name,
      engine,
      total_rows
    FROM system.tables
    WHERE (database = 'default' OR database = 'cascadian_clean')
      AND (
        name LIKE '%token%' OR
        name LIKE '%market%' OR
        name LIKE '%bridge%' OR
        name LIKE '%clob%'
      )
    ORDER BY total_rows DESC
  `;

  const tokenTablesResult = await clickhouse.query({
    query: tokenTablesQuery,
    format: 'JSONEachRow'
  });
  const tokenTables = await tokenTablesResult.json();

  console.log('Potentially relevant tables:');
  console.table(tokenTables);

  console.log('\n4️⃣ Calculate combined coverage from all sources:\n');

  // Combine id_bridge + api_ctf_bridge if both have tokens
  const combinedQuery = `
    WITH
      id_bridge_tokens AS (
        SELECT
          condition_id_norm,
          replaceAll(replaceAll(arrayJoin(JSONExtractArrayRaw(JSONExtractString(metadata, 'clobTokenIds'))), '"', ''), '\\\\', '') as token_id,
          rowNumberInBlock() as outcome_index
        FROM id_bridge
        WHERE JSONExtractString(metadata, 'clobTokenIds') != ''
          AND JSONExtractString(metadata, 'clobTokenIds') != '[]'
      ),
      all_tokens AS (
        SELECT token_id FROM ctf_token_map WHERE token_id != ''
        UNION DISTINCT
        SELECT token_id FROM id_bridge_tokens
      )
    SELECT
      count() as total_fills,
      countIf(asset_id IN (SELECT token_id FROM ctf_token_map WHERE token_id != '')) as current_mapped,
      countIf(asset_id IN (SELECT token_id FROM all_tokens)) as after_id_bridge,
      round(current_mapped / total_fills * 100, 2) as current_pct,
      round(after_id_bridge / total_fills * 100, 2) as after_pct,
      round((after_id_bridge - current_mapped) / total_fills * 100, 2) as improvement_pct
    FROM clob_fills
    WHERE asset_id != ''
  `;

  try {
    const combinedResult = await clickhouse.query({
      query: combinedQuery,
      format: 'JSONEachRow'
    });
    const combined = await combinedResult.json();

    console.log(`Current coverage: ${combined[0].current_pct}%`);
    console.log(`After merging id_bridge: ${combined[0].after_pct}%`);
    console.log(`Improvement: +${combined[0].improvement_pct}%`);
    console.log(`\nGap to 95% target: ${(95 - parseFloat(combined[0].after_pct)).toFixed(2)}%`);
  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n5️⃣ Check gamma_markets table for clobTokenIds in metadata:\n');

  try {
    const gammaQuery = `
      SELECT
        count() as total,
        countIf(metadata LIKE '%clobTokenIds%') as with_clob_tokens
      FROM gamma_markets
    `;

    const gammaResult = await clickhouse.query({
      query: gammaQuery,
      format: 'JSONEachRow'
    });
    const gamma = await gammaResult.json();

    console.log(`Total gamma_markets: ${parseInt(gamma[0].total).toLocaleString()}`);
    console.log(`With clobTokenIds: ${parseInt(gamma[0].with_clob_tokens).toLocaleString()}`);

    if (parseInt(gamma[0].with_clob_tokens) > 0) {
      console.log('\n✅ gamma_markets has clobTokenIds! Testing match...\n');

      const gammaMatchQuery = `
        WITH
          parsed AS (
            SELECT
              JSONExtractString(metadata, 'clobTokenIds') as tokens_json,
              JSONExtractArrayRaw(tokens_json) as token_array
            FROM gamma_markets
            WHERE tokens_json != '' AND tokens_json != '[]'
          ),
          flattened AS (
            SELECT
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
          count() as tested,
          countIf(asset_id IN (SELECT token_id FROM flattened)) as found,
          round(found / tested * 100, 2) as match_pct
        FROM unmapped
      `;

      const gammaMatchResult = await clickhouse.query({
        query: gammaMatchQuery,
        format: 'JSONEachRow'
      });
      const gammaMatch = await gammaMatchResult.json();

      console.log(`Match rate: ${gammaMatch[0].match_pct}%`);

      if (parseFloat(gammaMatch[0].match_pct) > 50) {
        console.log('\n🎯 BREAKTHROUGH! gamma_markets is valuable!');

        // Calculate combined coverage with gamma_markets
        const gammaCombinedQuery = `
          WITH
            id_bridge_tokens AS (
              SELECT
                replaceAll(replaceAll(arrayJoin(JSONExtractArrayRaw(JSONExtractString(metadata, 'clobTokenIds'))), '"', ''), '\\\\', '') as token_id
              FROM id_bridge
              WHERE JSONExtractString(metadata, 'clobTokenIds') != ''
            ),
            gamma_tokens AS (
              SELECT
                replaceAll(replaceAll(arrayJoin(JSONExtractArrayRaw(JSONExtractString(metadata, 'clobTokenIds'))), '"', ''), '\\\\', '') as token_id
              FROM gamma_markets
              WHERE JSONExtractString(metadata, 'clobTokenIds') != ''
            ),
            all_tokens AS (
              SELECT token_id FROM ctf_token_map WHERE token_id != ''
              UNION DISTINCT
              SELECT token_id FROM id_bridge_tokens
              UNION DISTINCT
              SELECT token_id FROM gamma_tokens
            )
          SELECT
            count() as total_fills,
            countIf(asset_id IN (SELECT token_id FROM all_tokens)) as covered,
            round(covered / total_fills * 100, 2) as coverage_pct
          FROM clob_fills
          WHERE asset_id != ''
        `;

        const gammaCombinedResult = await clickhouse.query({
          query: gammaCombinedQuery,
          format: 'JSONEachRow'
        });
        const gammaCombined = await gammaCombinedResult.json();

        console.log(`\nCombined coverage (ctf_token_map + id_bridge + gamma_markets): ${gammaCombined[0].coverage_pct}%`);

        if (parseFloat(gammaCombined[0].coverage_pct) >= 95) {
          console.log('🎉 TARGET ACHIEVED! ≥95% coverage possible!');
        }
      }
    }
  } catch (e: any) {
    console.log(`Error checking gamma_markets: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
}

comprehensiveTableSearch().catch(console.error);
