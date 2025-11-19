import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('='.repeat(80));
  console.log('INVESTIGATING OUTCOME TEXT MISMATCHES');
  console.log('='.repeat(80));

  // 1. Sample mismatches
  console.log('\n1. SAMPLE MISMATCHES (20 examples)');
  console.log('-'.repeat(80));

  const samples = await clickhouse.query({
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
            arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\\\', '')),
                     JSONExtractArrayRaw(outcomes_json)) as outcomes
          FROM default.gamma_markets
          WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        )
      SELECT
        r.cid_hex,
        r.winning_outcome,
        g.outcomes,
        lower(r.winning_outcome) as winner_lower,
        arrayMap(x -> lower(x), g.outcomes) as outcomes_lower,
        indexOf(g.outcomes, r.winning_outcome) as exact_match_pos,
        indexOf(arrayMap(x -> lower(x), g.outcomes), lower(r.winning_outcome)) as case_insensitive_pos
      FROM resolutions r
      INNER JOIN gamma g ON r.cid_hex = g.cid_hex
      WHERE indexOf(g.outcomes, r.winning_outcome) = 0
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const samplesData = await samples.json();

  samplesData.forEach((row, i) => {
    console.log(`\n${i + 1}. ${row.cid_hex.substring(0, 16)}...`);
    console.log(`   Winner text: "${row.winning_outcome}"`);
    console.log(`   Outcomes: [${row.outcomes.join(', ')}]`);
    console.log(`   Exact match: ${row.exact_match_pos === 0 ? 'NO' : 'YES at ' + row.exact_match_pos}`);
    console.log(`   Case-insensitive match: ${row.case_insensitive_pos === 0 ? 'NO' : 'YES at ' + row.case_insensitive_pos}`);
  });

  // 2. Categorize mismatch types
  console.log('\n\n2. MISMATCH CATEGORIZATION');
  console.log('-'.repeat(80));

  const categories = await clickhouse.query({
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
            arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\\\', '')),
                     JSONExtractArrayRaw(outcomes_json)) as outcomes
          FROM default.gamma_markets
          WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        ),
        mismatches AS (
          SELECT
            r.cid_hex,
            r.winning_outcome,
            g.outcomes,
            indexOf(arrayMap(x -> lower(x), g.outcomes), lower(r.winning_outcome)) as case_insensitive_pos
          FROM resolutions r
          INNER JOIN gamma g ON r.cid_hex = g.cid_hex
          WHERE indexOf(g.outcomes, r.winning_outcome) = 0
        )
      SELECT
        CASE
          WHEN case_insensitive_pos > 0 THEN 'Case mismatch (fixable with lower())'
          ELSE 'True mismatch (needs fuzzy matching or aliases)'
        END as category,
        count() as count,
        round(count() * 100.0 / (SELECT count() FROM mismatches), 2) as pct
      FROM mismatches
      GROUP BY category
    `,
    format: 'JSONEachRow'
  });
  const categoriesData = await categories.json();
  console.log(categoriesData);

  // 3. Common mismatch patterns
  console.log('\n3. COMMON MISMATCH PATTERNS');
  console.log('-'.repeat(80));

  const patterns = await clickhouse.query({
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
            arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\\\', '')),
                     JSONExtractArrayRaw(outcomes_json)) as outcomes
          FROM default.gamma_markets
          WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        ),
        mismatches AS (
          SELECT
            r.winning_outcome,
            g.outcomes
          FROM resolutions r
          INNER JOIN gamma g ON r.cid_hex = g.cid_hex
          WHERE indexOf(g.outcomes, r.winning_outcome) = 0
            AND indexOf(arrayMap(x -> lower(x), g.outcomes), lower(r.winning_outcome)) = 0
        )
      SELECT
        winning_outcome,
        arrayElement(outcomes, 1) as first_outcome,
        arrayElement(outcomes, 2) as second_outcome,
        count() as frequency
      FROM mismatches
      GROUP BY winning_outcome, outcomes
      ORDER BY frequency DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });
  const patternsData = await patterns.json();
  console.log('\nTop 30 true mismatches by frequency:');
  patternsData.forEach((row, i) => {
    console.log(`${(i + 1).toString().padStart(3)}. [${row.frequency.toString().padStart(5)}x] "${row.winning_outcome}" vs [${row.first_outcome}, ${row.second_outcome}]`);
  });

  // 4. Calculate potential recovery with case-insensitive matching
  console.log('\n\n4. RECOVERY POTENTIAL');
  console.log('-'.repeat(80));

  const recovery = await clickhouse.query({
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
            arrayMap(x -> trim(replaceAll(replaceAll(x, '"', ''), '\\\\', '')),
                     JSONExtractArrayRaw(outcomes_json)) as outcomes
          FROM default.gamma_markets
          WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        ),
        all_joined AS (
          SELECT
            r.cid_hex,
            indexOf(g.outcomes, r.winning_outcome) as exact_match,
            indexOf(arrayMap(x -> lower(x), g.outcomes), lower(r.winning_outcome)) as case_match
          FROM resolutions r
          INNER JOIN gamma g ON r.cid_hex = g.cid_hex
        )
      SELECT
        countIf(exact_match > 0) as exact_matches,
        countIf(exact_match = 0 AND case_match > 0) as case_mismatch_recoverable,
        countIf(exact_match = 0 AND case_match = 0) as true_mismatches,
        count() as total
      FROM all_joined
    `,
    format: 'JSONEachRow'
  });
  const recoveryData = await recovery.json();
  console.log(recoveryData[0]);
  console.log(`\nRecovery rate with case-insensitive matching: ${
    Math.round(recoveryData[0].case_mismatch_recoverable * 100 / recoveryData[0].total * 100) / 100
  }%`);

  console.log('\n' + '='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
