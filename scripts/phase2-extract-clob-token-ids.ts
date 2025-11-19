import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function extractClobTokenIds() {
  console.log('\n🔍 EXTRACTING CLOB TOKEN IDS FROM ID_BRIDGE METADATA\n');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Sample metadata to understand structure:\n');

  const sampleQuery = `
    SELECT
      condition_id_norm,
      market_id,
      JSONExtractString(metadata, 'clobTokenIds') as clob_token_ids_raw
    FROM id_bridge
    WHERE metadata != ''
    LIMIT 3
  `;

  const sampleResult = await clickhouse.query({
    query: sampleQuery,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json();

  console.log('Sample extractions:');
  samples.forEach((row: any, i: number) => {
    console.log(`\n${i + 1}. Condition: ${row.condition_id_norm.substring(0, 16)}...`);
    console.log(`   Market ID: ${row.market_id}`);
    console.log(`   Token IDs: ${row.clob_token_ids_raw}`);
  });

  console.log('\n2️⃣ Count markets with clobTokenIds in metadata:\n');

  const countQuery = `
    SELECT
      count() as total_rows,
      countIf(JSONExtractString(metadata, 'clobTokenIds') != '') as with_clob_tokens,
      countIf(JSONExtractString(metadata, 'clobTokenIds') != '[]') as with_filled_tokens,
      round(with_filled_tokens / total_rows * 100, 2) as pct_filled
    FROM id_bridge
  `;

  const countResult = await clickhouse.query({
    query: countQuery,
    format: 'JSONEachRow'
  });
  const count = await countResult.json();

  console.log(`Total rows: ${count[0].total_rows}`);
  console.log(`With clobTokenIds field: ${count[0].with_clob_tokens}`);
  console.log(`With filled tokens: ${count[0].with_filled_tokens}`);
  console.log(`Percentage: ${count[0].pct_filled}%`);

  console.log('\n3️⃣ Extract and flatten all clobTokenIds:\n');

  // Use arrayJoin to flatten the JSON array of token IDs
  const extractQuery = `
    WITH parsed AS (
      SELECT
        condition_id_norm,
        JSONExtractString(metadata, 'clobTokenIds') as tokens_json,
        JSONExtractArrayRaw(tokens_json) as token_array
      FROM id_bridge
      WHERE tokens_json != '' AND tokens_json != '[]'
    )
    SELECT
      condition_id_norm,
      replaceAll(replaceAll(arrayJoin(token_array), '"', ''), '\\\\', '') as token_id,
      rowNumberInAllBlocks() as outcome_index
    FROM parsed
    LIMIT 10
  `;

  try {
    const extractResult = await clickhouse.query({
      query: extractQuery,
      format: 'JSONEachRow'
    });
    const extracted = await extractResult.json();

    console.log('Sample extracted tokens:');
    console.table(extracted);

    console.log('\n4️⃣ Test if extracted tokens match unmapped asset_ids:\n');

    const matchTestQuery = `
      WITH
        parsed AS (
          SELECT
            condition_id_norm,
            JSONExtractString(metadata, 'clobTokenIds') as tokens_json,
            JSONExtractArrayRaw(tokens_json) as token_array
          FROM id_bridge
          WHERE tokens_json != '' AND tokens_json != '[]'
        ),
        flattened AS (
          SELECT
            condition_id_norm,
            replaceAll(replaceAll(arrayJoin(token_array), '"', ''), '\\\\', '') as token_id,
            rowNumberInBlock() as outcome_index
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
        countIf(asset_id IN (SELECT token_id FROM flattened)) as found_in_id_bridge,
        round(found_in_id_bridge / total_unmapped_tested * 100, 2) as match_pct
      FROM unmapped
    `;

    const matchResult = await clickhouse.query({
      query: matchTestQuery,
      format: 'JSONEachRow'
    });
    const match = await matchResult.json();

    console.log(`Unmapped tested: ${match[0].total_unmapped_tested}`);
    console.log(`Found in id_bridge: ${match[0].found_in_id_bridge}`);
    console.log(`Match rate: ${match[0].match_pct}%`);

    if (parseFloat(match[0].match_pct) > 50) {
      console.log('\n✅ BREAKTHROUGH! High match rate found!');

      console.log('\n5️⃣ Count total extractable tokens:\n');

      const totalTokensQuery = `
        WITH
          parsed AS (
            SELECT
              JSONExtractString(metadata, 'clobTokenIds') as tokens_json,
              JSONExtractArrayRaw(tokens_json) as token_array
            FROM id_bridge
            WHERE tokens_json != '' AND tokens_json != '[]'
          )
        SELECT
          count() as markets_with_tokens,
          sum(length(token_array)) as total_tokens
        FROM parsed
      `;

      const totalResult = await clickhouse.query({
        query: totalTokensQuery,
        format: 'JSONEachRow'
      });
      const total = await totalResult.json();

      console.log(`Markets with tokens: ${total[0].markets_with_tokens}`);
      console.log(`Total extractable tokens: ${total[0].total_tokens}`);

      console.log('\n6️⃣ Calculate potential coverage improvement:\n');

      const coverageQuery = `
        WITH
          parsed AS (
            SELECT
              condition_id_norm,
              JSONExtractString(metadata, 'clobTokenIds') as tokens_json,
              JSONExtractArrayRaw(tokens_json) as token_array
            FROM id_bridge
            WHERE tokens_json != '' AND tokens_json != '[]'
          ),
          flattened AS (
            SELECT
              condition_id_norm,
              replaceAll(replaceAll(arrayJoin(token_array), '"', ''), '\\\\', '') as token_id,
              rowNumberInBlock() as outcome_index
            FROM parsed
          )
        SELECT
          count() as total_fills,
          countIf(asset_id IN (SELECT token_id FROM ctf_token_map WHERE token_id != '')) as currently_mapped,
          countIf(asset_id IN (SELECT token_id FROM flattened)) as would_be_mapped_with_id_bridge,
          countIf(
            asset_id IN (SELECT token_id FROM ctf_token_map WHERE token_id != '') OR
            asset_id IN (SELECT token_id FROM flattened)
          ) as total_after_merge,
          round(currently_mapped / total_fills * 100, 2) as current_coverage,
          round(total_after_merge / total_fills * 100, 2) as coverage_after_merge,
          round((total_after_merge - currently_mapped) / total_fills * 100, 2) as improvement
        FROM clob_fills
        WHERE asset_id != ''
      `;

      const coverageResult = await clickhouse.query({
        query: coverageQuery,
        format: 'JSONEachRow'
      });
      const coverage = await coverageResult.json();

      console.log(`Current coverage: ${coverage[0].current_coverage}%`);
      console.log(`Coverage after merge: ${coverage[0].coverage_after_merge}%`);
      console.log(`Improvement: +${coverage[0].improvement}%`);

      if (parseFloat(coverage[0].coverage_after_merge) >= 95) {
        console.log('\n🎯 TARGET ACHIEVED! Can reach ≥95% coverage with id_bridge!');
      } else if (parseFloat(coverage[0].coverage_after_merge) >= 90) {
        console.log('\n⚠️ Close to target (90-95%) - may need additional source');
      } else {
        console.log('\n⚠️ Below 90% coverage - need additional data sources');
      }
    } else {
      console.log('\n❌ Low match rate - id_bridge tokens do not match unmapped asset_ids');
    }

  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
}

extractClobTokenIds().catch(console.error);
