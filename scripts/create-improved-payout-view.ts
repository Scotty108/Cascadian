import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('='.repeat(80));
  console.log('CREATING IMPROVED PAYOUT VECTOR VIEW');
  console.log('='.repeat(80));

  // Step 1: Create view with case-insensitive matching and alias support
  console.log('\n1. CREATING ENHANCED VIEW WITH FUZZY MATCHING');
  console.log('-'.repeat(80));

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_enhanced AS
      WITH
        parsed_outcomes AS (
          SELECT
            lower(replaceAll(condition_id, '0x', '')) as cid_hex,
            arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\\\', '')),
                     JSONExtractArrayRaw(outcomes_json)) as outcomes,
            arrayMap(x -> lower(trim(replaceAll(replaceAll(x, '"', ''), '\\\\', ''))),
                     JSONExtractArrayRaw(outcomes_json)) as outcomes_lower
          FROM default.gamma_markets
          WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        ),
        winner_mapping AS (
          SELECT
            r.cid,
            lower(replaceAll(r.cid, '0x', '')) as cid_hex,
            r.winning_outcome,
            r.updated_at,
            r.source,
            r.priority,
            p.outcomes,
            p.outcomes_lower,
            -- Try exact match first
            indexOf(p.outcomes, r.winning_outcome) as exact_match_idx,
            -- Try case-insensitive match
            indexOf(p.outcomes_lower, lower(trim(r.winning_outcome))) as case_match_idx,
            -- Try alias mapping for common patterns
            CASE
              -- YES/NO aliases for Up/Down
              WHEN upper(trim(r.winning_outcome)) = 'YES' AND indexOf(p.outcomes_lower, 'up') > 0 THEN indexOf(p.outcomes_lower, 'up')
              WHEN upper(trim(r.winning_outcome)) = 'NO' AND indexOf(p.outcomes_lower, 'down') > 0 THEN indexOf(p.outcomes_lower, 'down')
              -- YES/NO aliases for Over/Under
              WHEN upper(trim(r.winning_outcome)) = 'YES' AND indexOf(p.outcomes_lower, 'over') > 0 THEN indexOf(p.outcomes_lower, 'over')
              WHEN upper(trim(r.winning_outcome)) = 'NO' AND indexOf(p.outcomes_lower, 'under') > 0 THEN indexOf(p.outcomes_lower, 'under')
              -- Trim trailing spaces (common issue)
              WHEN indexOf(p.outcomes_lower, lower(trim(r.winning_outcome))) > 0 THEN indexOf(p.outcomes_lower, lower(trim(r.winning_outcome)))
              ELSE 0
            END as alias_match_idx
          FROM default.staging_resolutions_union r
          INNER JOIN parsed_outcomes p ON lower(replaceAll(r.cid, '0x', '')) = p.cid_hex
          WHERE r.winning_outcome IS NOT NULL AND r.winning_outcome != ''
        )
      SELECT
        cid as condition_id,
        cid_hex,
        1 AS resolved,
        -- Use first successful match (exact > case > alias)
        CASE
          WHEN exact_match_idx > 0 THEN exact_match_idx - 1
          WHEN case_match_idx > 0 THEN case_match_idx - 1
          WHEN alias_match_idx > 0 THEN alias_match_idx - 1
          ELSE -1
        END as winning_index,
        -- Create payout vector
        arrayMap(i ->
          if(i = CASE
                    WHEN exact_match_idx > 0 THEN exact_match_idx
                    WHEN case_match_idx > 0 THEN case_match_idx
                    WHEN alias_match_idx > 0 THEN alias_match_idx
                    ELSE 0
                  END, 1, 0),
          arrayEnumerate(outcomes)) AS payout_numerators,
        1 AS payout_denominator,
        outcomes,
        winning_outcome,
        updated_at AS resolved_at,
        source,
        priority,
        -- Match quality indicator
        CASE
          WHEN exact_match_idx > 0 THEN 'exact'
          WHEN case_match_idx > 0 THEN 'case_insensitive'
          WHEN alias_match_idx > 0 THEN 'alias_mapped'
          ELSE 'no_match'
        END as match_quality
      FROM winner_mapping
      WHERE exact_match_idx > 0 OR case_match_idx > 0 OR alias_match_idx > 0
    `
  });
  console.log('✓ Created cascadian_clean.vw_resolutions_enhanced');

  // Step 2: Validate the enhanced view
  console.log('\n2. VALIDATION OF ENHANCED VIEW');
  console.log('-'.repeat(80));

  const stats = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT cid_hex) as unique_markets,
        countIf(match_quality = 'exact') as exact_matches,
        countIf(match_quality = 'case_insensitive') as case_matches,
        countIf(match_quality = 'alias_mapped') as alias_matches,
        countIf(winning_index >= 0) as valid_index,
        countIf(winning_index < 0) as invalid_index
      FROM cascadian_clean.vw_resolutions_enhanced
    `,
    format: 'JSONEachRow'
  });
  const statsData = await stats.json();
  console.log(statsData[0]);

  // Step 3: Quality checks
  console.log('\n3. QUALITY CHECKS');
  console.log('-'.repeat(80));

  const quality = await clickhouse.query({
    query: `
      SELECT
        countIf(length(payout_numerators) = 0) as empty_arrays,
        countIf(length(payout_numerators) != length(outcomes)) as length_mismatch,
        countIf(winning_index < 0) as negative_index,
        countIf(winning_index >= length(outcomes)) as index_out_of_bounds,
        countIf(arraySum(payout_numerators) != 1) as sum_not_one
      FROM cascadian_clean.vw_resolutions_enhanced
    `,
    format: 'JSONEachRow'
  });
  const qualityData = await quality.json();
  console.log('Issues found:');
  Object.entries(qualityData[0]).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  // Step 4: Show improvement over original view
  console.log('\n4. IMPROVEMENT ANALYSIS');
  console.log('-'.repeat(80));

  const improvement = await clickhouse.query({
    query: `
      SELECT
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.vw_resolutions_from_staging) as original_markets,
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.vw_resolutions_enhanced) as enhanced_markets,
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.vw_resolutions_enhanced) -
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.vw_resolutions_from_staging) as additional_markets
    `,
    format: 'JSONEachRow'
  });
  const improvementData = await improvement.json();
  console.log(improvementData[0]);

  // Step 5: Sample alias-matched markets
  console.log('\n5. SAMPLE ALIAS-MATCHED MARKETS');
  console.log('-'.repeat(80));

  const samples = await clickhouse.query({
    query: `
      SELECT
        cid_hex,
        winning_outcome,
        outcomes,
        winning_index,
        payout_numerators,
        match_quality
      FROM cascadian_clean.vw_resolutions_enhanced
      WHERE match_quality = 'alias_mapped'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const samplesData = await samples.json();
  samplesData.forEach((row, i) => {
    console.log(`\n${i + 1}. ${row.cid_hex.substring(0, 16)}...`);
    console.log(`   Winner: "${row.winning_outcome}" → [${row.outcomes.join(', ')}]`);
    console.log(`   Index: ${row.winning_index}, Payout: [${row.payout_numerators.join(', ')}]`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('ENHANCED VIEW CREATED SUCCESSFULLY');
  console.log('='.repeat(80));
}

main().catch(console.error);
