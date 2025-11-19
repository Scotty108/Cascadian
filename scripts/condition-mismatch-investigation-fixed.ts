import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function investigate() {
  console.log('=== CONDITION_ID MISMATCH ROOT CAUSE INVESTIGATION ===\n');
  console.log('Main Claude Finding: 24.7% match rate (57,655 / 233,353 condition_ids)\n');

  console.log('=== STEP 1: VERIFY MAIN CLAUDE\'S SAMPLE ===\n');

  const SAMPLE_ID = '0x899fb9c20067e67711a5f5c71dd8e2ee541ce0d07fc868a2d31dd817fae15bac';
  console.log(`Testing Main Claude's sample: ${SAMPLE_ID}`);

  const test1 = await client.query({
    query: `SELECT COUNT(*) as cnt FROM market_resolutions_final WHERE condition_id_norm = '${SAMPLE_ID}'`,
    format: 'JSONEachRow'
  });
  const test1Data = await test1.json();
  console.log(`  Exact match: ${test1Data[0].cnt}`);

  const normalized = SAMPLE_ID.toLowerCase().replace('0x', '');
  const test2 = await client.query({
    query: `SELECT COUNT(*) as cnt FROM market_resolutions_final WHERE condition_id_norm = '${normalized}'`,
    format: 'JSONEachRow'
  });
  const test2Data = await test2.json();
  console.log(`  Normalized match: ${test2Data[0].cnt}`);
  console.log(`  Verdict: ${test2Data[0].cnt === '0' ? 'CONFIRMED - Sample does NOT exist in market_resolutions_final' : 'REJECTED - Sample DOES exist'}\n`);

  console.log('=== STEP 2: UNDERSTAND market_resolutions_final COMPOSITION ===\n');

  const stats = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id_norm) as unique_conditions,
        MAX(resolved_at) as latest_resolution,
        MIN(resolved_at) as earliest_resolution,
        COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as has_resolution_date,
        COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as no_resolution_date
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow'
  });
  const statsData = await stats.json();
  console.log('market_resolutions_final statistics:');
  console.log(`  Total rows: ${statsData[0].total_rows}`);
  console.log(`  Unique condition_ids: ${statsData[0].unique_conditions}`);
  console.log(`  Date range: ${statsData[0].earliest_resolution} to ${statsData[0].latest_resolution}`);
  console.log(`  With resolution date: ${statsData[0].has_resolution_date}`);
  console.log(`  Without resolution date: ${statsData[0].no_resolution_date}\n`);

  console.log('=== STEP 3: ANALYZE MATCHING vs NON-MATCHING PATTERNS ===\n');

  // Get 10 matching condition_ids
  const matching = await client.query({
    query: `
      SELECT DISTINCT t.condition_id, MIN(t.timestamp) as first_trade, MAX(t.timestamp) as last_trade
      FROM trades_raw t
      INNER JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.condition_id != ''
      GROUP BY t.condition_id
      ORDER BY first_trade DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const matchingData = await matching.json();
  console.log('MATCHING condition_ids (10 most recent):');
  matchingData.forEach((row: any, idx: number) => {
    console.log(`  ${idx + 1}. ${row.condition_id}`);
    console.log(`      First trade: ${row.first_trade}, Last trade: ${row.last_trade}`);
  });

  // Get 10 non-matching condition_ids - using a subquery to ensure we get non-matches
  const nonMatching = await client.query({
    query: `
      SELECT condition_id, MIN(timestamp) as first_trade, MAX(timestamp) as last_trade
      FROM trades_raw
      WHERE condition_id != ''
        AND lower(replaceAll(condition_id, '0x', '')) NOT IN (
          SELECT condition_id_norm FROM market_resolutions_final
        )
      GROUP BY condition_id
      ORDER BY first_trade DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const nonMatchingData = await nonMatching.json();
  console.log('\nNON-MATCHING condition_ids (10 most recent):');
  nonMatchingData.forEach((row: any, idx: number) => {
    console.log(`  ${idx + 1}. ${row.condition_id}`);
    console.log(`      First trade: ${row.first_trade}, Last trade: ${row.last_trade}`);
  });

  console.log('\n=== STEP 4: TEMPORAL ANALYSIS - IS THIS A TIME-BASED GAP? ===\n');

  const temporal = await client.query({
    query: `
      SELECT
        toStartOfMonth(timestamp) as month,
        COUNT(DISTINCT condition_id) as total_conditions,
        COUNT(DISTINCT CASE
          WHEN lower(replaceAll(condition_id, '0x', '')) IN (
            SELECT condition_id_norm FROM market_resolutions_final
          ) THEN condition_id
        END) as matched_conditions,
        ROUND(matched_conditions / total_conditions * 100, 2) as match_pct
      FROM trades_raw
      WHERE condition_id != ''
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `,
    format: 'JSONEachRow'
  });
  const temporalData = await temporal.json();
  console.log('Match rate by month (most recent 12):');
  temporalData.forEach((row: any) => {
    console.log(`  ${row.month}: ${row.total_conditions} total, ${row.matched_conditions} matched (${row.match_pct}%)`);
  });

  console.log('\n=== STEP 5: CHECK FOR ALTERNATIVE RESOLUTION TABLES ===\n');

  const resTables = await client.query({
    query: `SHOW TABLES LIKE '%resolution%'`,
    format: 'JSONEachRow'
  });
  const resTablesData = await resTables.json();
  console.log('\nAll resolution-related tables:');
  for (const row of resTablesData) {
    const tableName = Object.values(row)[0] as string;
    try {
      const count = await client.query({
        query: `SELECT COUNT(*) as cnt, COUNT(DISTINCT condition_id_norm) as unique_cond FROM ${tableName}`,
        format: 'JSONEachRow'
      });
      const countData = await count.json();
      console.log(`  ${tableName}: ${countData[0].cnt} rows, ${countData[0].unique_cond} unique condition_ids`);
    } catch (err: any) {
      console.log(`  ${tableName}: Error - ${err.message}`);
    }
  }

  console.log('\n=== STEP 6: COVERAGE VERIFICATION ===\n');

  const coverage = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id) as conditions_in_trades,
        COUNT(DISTINCT CASE
          WHEN lower(replaceAll(condition_id, '0x', '')) IN (
            SELECT condition_id_norm FROM market_resolutions_final
          ) THEN condition_id
        END) as conditions_with_resolution,
        ROUND(conditions_with_resolution / conditions_in_trades * 100, 2) as coverage_pct
      FROM trades_raw
      WHERE condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log('Overall coverage:');
  console.log(`  Total unique condition_ids in trades_raw: ${coverageData[0].conditions_in_trades}`);
  console.log(`  Condition_ids with resolutions: ${coverageData[0].conditions_with_resolution}`);
  console.log(`  Coverage percentage: ${coverageData[0].coverage_pct}%`);

  console.log('\n=== STEP 7: CHECK trades_raw SCHEMA ===\n');

  const tradesSchema = await client.query({
    query: `SHOW CREATE TABLE trades_raw`,
    format: 'TabSeparated'
  });
  const tradesSchemaText = await tradesSchema.text();
  console.log('\ntrades_raw schema (first 1500 chars):');
  console.log(tradesSchemaText.substring(0, 1500));

  await client.close();
}

investigate().catch(console.error);
