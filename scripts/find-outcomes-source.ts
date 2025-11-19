import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('FINDING OUTCOMES ARRAY SOURCES\n');

  // Check if we have market metadata with outcomes
  console.log('1. Checking gamma_markets_extended for outcomes:');
  console.log('-'.repeat(80));
  const gammaCheck = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        outcomes,
        question,
        market_id
      FROM default.gamma_markets_extended
      WHERE arraySize(outcomes) > 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const gammaData = await gammaCheck.json();
  console.log(JSON.stringify(gammaData, null, 2));

  const gammaStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_markets,
        countIf(arraySize(outcomes) > 0) as with_outcomes,
        countIf(arraySize(outcomes) = 2) as binary_markets,
        countIf(arraySize(outcomes) > 2) as multi_outcome_markets
      FROM default.gamma_markets_extended
    `,
    format: 'JSONEachRow'
  });
  const gammaStatsData = await gammaStats.json();
  console.log('\nGamma markets stats:', gammaStatsData[0]);

  // Check coverage between staging_resolutions_union and gamma_markets_extended
  console.log('\n2. Coverage analysis:');
  console.log('-'.repeat(80));
  const coverage = await clickhouse.query({
    query: `
      WITH
        resolution_markets AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_hex
          FROM default.staging_resolutions_union
          WHERE winning_outcome IS NOT NULL AND winning_outcome != ''
        ),
        gamma_markets AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_hex
          FROM default.gamma_markets_extended
          WHERE arraySize(outcomes) > 0
        )
      SELECT
        (SELECT count() FROM resolution_markets) as resolutions_with_winner,
        (SELECT count() FROM gamma_markets) as gamma_with_outcomes,
        (SELECT count() FROM resolution_markets WHERE cid_hex IN (SELECT cid_hex FROM gamma_markets)) as can_build_payout_vectors
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log(coverageData[0]);

  // Show example join
  console.log('\n3. Example join (resolution + outcomes):');
  console.log('-'.repeat(80));
  const example = await clickhouse.query({
    query: `
      SELECT
        r.cid,
        r.winning_outcome,
        g.outcomes,
        indexOf(g.outcomes, r.winning_outcome) as winning_index,
        g.question
      FROM default.staging_resolutions_union r
      INNER JOIN default.gamma_markets_extended g
        ON lower(replaceAll(r.cid, '0x', '')) = lower(replaceAll(g.condition_id, '0x', ''))
      WHERE r.winning_outcome IS NOT NULL
        AND r.winning_outcome != ''
        AND arraySize(g.outcomes) > 0
        AND indexOf(g.outcomes, r.winning_outcome) > 0
      ORDER BY r.priority DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const exampleData = await example.json();
  console.log(JSON.stringify(exampleData, null, 2));
}

main().catch(console.error);
