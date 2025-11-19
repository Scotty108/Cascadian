import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('='.repeat(80));
  console.log('ANALYZING TEXT-ONLY RESOLUTION TABLES');
  console.log('='.repeat(80));

  // 1. Analyze staging_resolutions_union structure
  console.log('\n1. STAGING_RESOLUTIONS_UNION STRUCTURE');
  console.log('-'.repeat(80));

  const sample = await clickhouse.query({
    query: `SELECT * FROM default.staging_resolutions_union LIMIT 5`,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json();
  console.log('Sample rows:');
  console.log(JSON.stringify(sampleData, null, 2));

  const stats = await clickhouse.query({
    query: `
      SELECT
        count() as rows,
        count(DISTINCT cid) as unique_markets,
        countIf(winning_outcome != '' AND winning_outcome IS NOT NULL) as with_winner
      FROM default.staging_resolutions_union
    `,
    format: 'JSONEachRow'
  });
  const statsData = await stats.json();
  console.log('\nStats:', statsData[0]);

  // 2. Check api_ctf_bridge structure
  console.log('\n2. API_CTF_BRIDGE STRUCTURE');
  console.log('-'.repeat(80));

  const ctfSample = await clickhouse.query({
    query: `SELECT * FROM default.api_ctf_bridge LIMIT 5`,
    format: 'JSONEachRow'
  });
  const ctfData = await ctfSample.json();
  console.log('Sample rows:');
  console.log(JSON.stringify(ctfData, null, 2));

  const ctfStats = await clickhouse.query({
    query: `
      SELECT
        count() as rows,
        count(DISTINCT condition_id) as unique_markets,
        countIf(outcome != '' AND outcome IS NOT NULL) as with_outcome
      FROM default.api_ctf_bridge
    `,
    format: 'JSONEachRow'
  });
  const ctfStatsData = await ctfStats.json();
  console.log('\nStats:', ctfStatsData[0]);

  // 3. Create payout vector view for staging_resolutions_union
  console.log('\n3. CREATING PAYOUT VECTOR VIEW (staging_resolutions_union)');
  console.log('-'.repeat(80));

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_from_staging AS
      SELECT
        lower(replaceAll(cid, '0x', '')) AS cid_hex,
        1 AS resolved,
        indexOf(outcomes, winning_outcome) - 1 AS winning_index,
        arrayMap(i -> if(i = winning_index + 1, 1, 0), arrayEnumerate(outcomes)) AS payout_numerators,
        1 AS payout_denominator,
        outcomes,
        winning_outcome,
        updated_at AS resolved_at,
        source,
        priority
      FROM default.staging_resolutions_union
      WHERE winning_outcome IS NOT NULL
        AND winning_outcome != ''
        AND arraySize(outcomes) > 0
        AND indexOf(outcomes, winning_outcome) > 0
    `
  });
  console.log('✓ Created cascadian_clean.vw_resolutions_from_staging');

  // Validate the view
  const viewSample = await clickhouse.query({
    query: `SELECT * FROM cascadian_clean.vw_resolutions_from_staging LIMIT 5`,
    format: 'JSONEachRow'
  });
  const viewData = await viewSample.json();
  console.log('\nView sample:');
  console.log(JSON.stringify(viewData, null, 2));

  const viewStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT cid_hex) as unique_markets,
        countIf(arraySize(payout_numerators) = 2) as binary_payouts,
        countIf(arraySize(payout_numerators) > 2) as multi_payouts,
        countIf(winning_index >= 0) as valid_index
      FROM cascadian_clean.vw_resolutions_from_staging
    `,
    format: 'JSONEachRow'
  });
  const viewStatsData = await viewStats.json();
  console.log('\nView stats:', viewStatsData[0]);

  // 4. Calculate new coverage (markets not in market_resolutions_final)
  console.log('\n4. COVERAGE IMPROVEMENT ANALYSIS');
  console.log('-'.repeat(80));

  const coverage = await clickhouse.query({
    query: `
      WITH
        existing_markets AS (
          SELECT DISTINCT lower(condition_id_norm) as cid_hex
          FROM default.market_resolutions_final
          WHERE resolved = 1
        ),
        new_markets AS (
          SELECT DISTINCT cid_hex
          FROM cascadian_clean.vw_resolutions_from_staging
          WHERE cid_hex NOT IN (SELECT cid_hex FROM existing_markets)
        )
      SELECT
        (SELECT count() FROM existing_markets) as existing_resolved_markets,
        (SELECT count() FROM new_markets) as additional_markets_from_staging,
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.vw_resolutions_from_staging) as total_staging_markets,
        round((SELECT count() FROM new_markets) * 100.0 / (SELECT count() FROM existing_markets), 2) as pct_improvement
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log('\nCoverage analysis:', coverageData[0]);

  // 5. Quality validation
  console.log('\n5. QUALITY VALIDATION');
  console.log('-'.repeat(80));

  const quality = await clickhouse.query({
    query: `
      SELECT
        countIf(arraySize(payout_numerators) = 0) as empty_arrays,
        countIf(arraySize(payout_numerators) != arraySize(outcomes)) as length_mismatch,
        countIf(winning_index < 0) as negative_index,
        countIf(winning_index >= arraySize(outcomes)) as index_out_of_bounds,
        countIf(arrayElement(payout_numerators, winning_index + 1) != 1) as winner_not_one,
        countIf(arraySum(payout_numerators) != 1) as sum_not_one
      FROM cascadian_clean.vw_resolutions_from_staging
    `,
    format: 'JSONEachRow'
  });
  const qualityData = await quality.json();
  console.log('\nQuality checks:', qualityData[0]);

  // Sample 10 rows for manual inspection
  const validation = await clickhouse.query({
    query: `
      SELECT
        cid_hex,
        outcomes,
        winning_outcome,
        winning_index,
        payout_numerators,
        payout_denominator
      FROM cascadian_clean.vw_resolutions_from_staging
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const validationData = await validation.json();
  console.log('\nSample validation (10 rows):');
  validationData.forEach((row, i) => {
    console.log(`\n${i + 1}. ${row.cid_hex.substring(0, 12)}...`);
    console.log(`   Outcomes: [${row.outcomes.join(', ')}]`);
    console.log(`   Winner: "${row.winning_outcome}" (index ${row.winning_index})`);
    console.log(`   Payout: [${row.payout_numerators.join(', ')}] / ${row.payout_denominator}`);
  });

  // 6. Edge cases analysis
  console.log('\n6. EDGE CASES & ISSUES');
  console.log('-'.repeat(80));

  const edgeCases = await clickhouse.query({
    query: `
      SELECT
        'Missing from view (filtered out)' as issue,
        count() as count
      FROM default.staging_resolutions_union
      WHERE NOT (
        winning_outcome IS NOT NULL
        AND winning_outcome != ''
        AND arraySize(outcomes) > 0
        AND indexOf(outcomes, winning_outcome) > 0
      )

      UNION ALL

      SELECT
        'Winner not in outcomes array' as issue,
        countIf(
          winning_outcome IS NOT NULL
          AND winning_outcome != ''
          AND arraySize(outcomes) > 0
          AND indexOf(outcomes, winning_outcome) = 0
        ) as count
      FROM default.staging_resolutions_union

      UNION ALL

      SELECT
        'Empty outcomes array' as issue,
        countIf(arraySize(outcomes) = 0) as count
      FROM default.staging_resolutions_union

      UNION ALL

      SELECT
        'No winning outcome' as issue,
        countIf(winning_outcome IS NULL OR winning_outcome = '') as count
      FROM default.staging_resolutions_union
    `,
    format: 'JSONEachRow'
  });
  const edgeCasesData = await edgeCases.json();
  console.log('\nEdge cases found:');
  edgeCasesData.forEach(row => {
    console.log(`  - ${row.issue}: ${row.count}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
