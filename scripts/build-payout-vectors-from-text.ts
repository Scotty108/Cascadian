import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('='.repeat(80));
  console.log('BUILD PAYOUT VECTORS FROM TEXT OUTCOMES');
  console.log('='.repeat(80));

  // Step 1: Analyze coverage between resolutions and gamma_markets
  console.log('\n1. COVERAGE ANALYSIS');
  console.log('-'.repeat(80));

  const coverage = await clickhouse.query({
    query: `
      WITH
        resolutions AS (
          SELECT DISTINCT
            lower(replaceAll(cid, '0x', '')) as cid_hex,
            winning_outcome
          FROM default.staging_resolutions_union
          WHERE winning_outcome IS NOT NULL AND winning_outcome != ''
        ),
        gamma AS (
          SELECT DISTINCT
            lower(replaceAll(condition_id, '0x', '')) as cid_hex,
            JSONExtractArrayRaw(outcomes_json) as outcomes_array
          FROM default.gamma_markets
          WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        )
      SELECT
        (SELECT count() FROM resolutions) as total_resolutions,
        (SELECT count() FROM gamma) as gamma_with_outcomes,
        (SELECT count() FROM resolutions WHERE cid_hex IN (SELECT cid_hex FROM gamma)) as can_join,
        round((SELECT count() FROM resolutions WHERE cid_hex IN (SELECT cid_hex FROM gamma)) * 100.0 / (SELECT count() FROM resolutions), 2) as pct_can_join
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log(coverageData[0]);

  // Step 2: Create payout vector view by joining resolutions with gamma_markets
  console.log('\n2. CREATING PAYOUT VECTOR VIEW');
  console.log('-'.repeat(80));

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_from_staging AS
      WITH parsed_outcomes AS (
        SELECT
          lower(replaceAll(condition_id, '0x', '')) as cid_hex,
          JSONExtractArrayRaw(outcomes_json) as outcomes_raw,
          arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\\\', '')), JSONExtractArrayRaw(outcomes_json)) as outcomes
        FROM default.gamma_markets
        WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
      )
      SELECT
        r.cid as condition_id,
        lower(replaceAll(r.cid, '0x', '')) as cid_hex,
        1 AS resolved,
        indexOf(p.outcomes, r.winning_outcome) - 1 AS winning_index,
        arrayMap(i -> if(i = indexOf(p.outcomes, r.winning_outcome), 1, 0), arrayEnumerate(p.outcomes)) AS payout_numerators,
        1 AS payout_denominator,
        p.outcomes,
        r.winning_outcome,
        r.updated_at AS resolved_at,
        r.source,
        r.priority
      FROM default.staging_resolutions_union r
      INNER JOIN parsed_outcomes p
        ON lower(replaceAll(r.cid, '0x', '')) = p.cid_hex
      WHERE r.winning_outcome IS NOT NULL
        AND r.winning_outcome != ''
        AND length(p.outcomes) > 0
        AND indexOf(p.outcomes, r.winning_outcome) > 0
    `
  });
  console.log('Created view: cascadian_clean.vw_resolutions_from_staging');

  // Step 3: Validate the view
  console.log('\n3. VIEW VALIDATION');
  console.log('-'.repeat(80));

  const viewStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT cid_hex) as unique_markets,
        countIf(length(payout_numerators) = 2) as binary_markets,
        countIf(length(payout_numerators) > 2) as multi_outcome_markets,
        countIf(winning_index >= 0) as valid_index,
        countIf(winning_index < 0) as negative_index
      FROM cascadian_clean.vw_resolutions_from_staging
    `,
    format: 'JSONEachRow'
  });
  const viewStatsData = await viewStats.json();
  console.log(viewStatsData[0]);

  // Step 4: Show sample data
  console.log('\n4. SAMPLE DATA (First 10 rows)');
  console.log('-'.repeat(80));

  const sample = await clickhouse.query({
    query: `
      SELECT
        cid_hex,
        outcomes,
        winning_outcome,
        winning_index,
        payout_numerators,
        source
      FROM cascadian_clean.vw_resolutions_from_staging
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json();
  sampleData.forEach((row, i) => {
    console.log(`\n${i + 1}. ${row.cid_hex.substring(0, 16)}...`);
    console.log(`   Outcomes: [${row.outcomes.join(', ')}]`);
    console.log(`   Winner: "${row.winning_outcome}" (index ${row.winning_index})`);
    console.log(`   Payout: [${row.payout_numerators.join(', ')}]`);
    console.log(`   Source: ${row.source}`);
  });

  // Step 5: Quality checks
  console.log('\n5. QUALITY CHECKS');
  console.log('-'.repeat(80));

  const quality = await clickhouse.query({
    query: `
      SELECT
        countIf(length(payout_numerators) = 0) as empty_arrays,
        countIf(length(payout_numerators) != length(outcomes)) as length_mismatch,
        countIf(winning_index < 0) as negative_index,
        countIf(winning_index >= length(outcomes)) as index_out_of_bounds,
        countIf(arraySum(payout_numerators) != 1) as sum_not_one,
        countIf(winning_index >= 0 AND arrayElement(payout_numerators, winning_index + 1) != 1) as winner_not_marked
      FROM cascadian_clean.vw_resolutions_from_staging
    `,
    format: 'JSONEachRow'
  });
  const qualityData = await quality.json();
  console.log('Issues found:');
  Object.entries(qualityData[0]).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  // Step 6: Calculate coverage improvement
  console.log('\n6. COVERAGE IMPROVEMENT ANALYSIS');
  console.log('-'.repeat(80));

  const improvement = await clickhouse.query({
    query: `
      WITH
        existing AS (
          SELECT DISTINCT lower(condition_id_norm) as cid_hex
          FROM default.market_resolutions_final
        ),
        new_from_view AS (
          SELECT DISTINCT cid_hex
          FROM cascadian_clean.vw_resolutions_from_staging
          WHERE cid_hex NOT IN (SELECT cid_hex FROM existing)
        ),
        total_new AS (
          SELECT DISTINCT cid_hex
          FROM cascadian_clean.vw_resolutions_from_staging
        )
      SELECT
        (SELECT count() FROM existing) as existing_resolved,
        (SELECT count() FROM total_new) as total_in_new_view,
        (SELECT count() FROM new_from_view) as additional_markets,
        round((SELECT count() FROM new_from_view) * 100.0 / (SELECT count() FROM existing), 2) as pct_improvement
    `,
    format: 'JSONEachRow'
  });
  const improvementData = await improvement.json();
  console.log(improvementData[0]);

  // Step 7: Edge cases
  console.log('\n7. EDGE CASES & MISSING DATA');
  console.log('-'.repeat(80));

  const edgeCases = await clickhouse.query({
    query: `
      WITH
        resolutions AS (
          SELECT
            lower(replaceAll(cid, '0x', '')) as cid_hex,
            winning_outcome
          FROM default.staging_resolutions_union
          WHERE winning_outcome IS NOT NULL AND winning_outcome != ''
        ),
        gamma AS (
          SELECT
            lower(replaceAll(condition_id, '0x', '')) as cid_hex,
            arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\\\', '')), JSONExtractArrayRaw(outcomes_json)) as outcomes
          FROM default.gamma_markets
          WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        )
      SELECT
        'Resolutions without gamma metadata' as issue,
        count() as count
      FROM resolutions r
      WHERE r.cid_hex NOT IN (SELECT cid_hex FROM gamma)

      UNION ALL

      SELECT
        'Winner not in outcomes array' as issue,
        count() as count
      FROM resolutions r
      INNER JOIN gamma g ON r.cid_hex = g.cid_hex
      WHERE indexOf(g.outcomes, r.winning_outcome) = 0
    `,
    format: 'JSONEachRow'
  });
  const edgeCasesData = await edgeCases.json();
  edgeCasesData.forEach(row => {
    console.log(`  ${row.issue}: ${row.count}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));
  console.log('\nNext steps:');
  console.log('1. Review quality checks (should be all zeros)');
  console.log('2. Investigate edge cases if count > 0');
  console.log('3. Consider using this view to enrich market_resolutions_final');
  console.log('4. Create similar view for api_ctf_bridge if needed');
}

main().catch(console.error);
