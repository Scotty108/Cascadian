import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function investigate() {
  console.log('=== STEP 1: VERIFY THE SAMPLE ===\n');

  // Get a sample condition_id from trades_raw
  const sampleResult = await client.query({
    query: `SELECT condition_id FROM trades_raw WHERE condition_id != '' LIMIT 1`,
    format: 'JSONEachRow'
  });
  const sampleRows = await sampleResult.json();
  const SAMPLE_ID = sampleRows[0]?.condition_id || '';

  console.log(`Sample condition_id: ${SAMPLE_ID}`);
  console.log(`Length: ${SAMPLE_ID.length}`);
  console.log(`Prefix: ${SAMPLE_ID.substring(0, 2)}`);
  console.log(`Suffix: ${SAMPLE_ID.substring(SAMPLE_ID.length - 2)}\n`);

  // Test 1: Exact match
  const test1 = await client.query({
    query: `SELECT COUNT(*) as cnt FROM market_resolutions_final WHERE condition_id_norm = '${SAMPLE_ID}'`,
    format: 'JSONEachRow'
  });
  const test1Data = await test1.json();
  console.log(`Test 1 - Exact match: ${test1Data[0].cnt}`);

  // Test 2: Normalized match
  const normalized = SAMPLE_ID.toLowerCase().replace('0x', '');
  const test2 = await client.query({
    query: `SELECT COUNT(*) as cnt FROM market_resolutions_final WHERE condition_id_norm = '${normalized}'`,
    format: 'JSONEachRow'
  });
  const test2Data = await test2.json();
  console.log(`Test 2 - Normalized match (${normalized}): ${test2Data[0].cnt}`);

  // Test 3: Any partial match or similar patterns
  const test3 = await client.query({
    query: `SELECT COUNT(*) as cnt FROM market_resolutions_final WHERE condition_id_norm LIKE '%${normalized.substring(10, 40)}%'`,
    format: 'JSONEachRow'
  });
  const test3Data = await test3.json();
  console.log(`Test 3 - Partial substring match: ${test3Data[0].cnt}\n`);

  console.log('=== STEP 2: ANALYZE THE 25% THAT DO MATCH ===\n');

  // Get 5 matching condition_ids
  const matching = await client.query({
    query: `
      SELECT DISTINCT t.condition_id
      FROM trades_raw t
      INNER JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.condition_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const matchingData = await matching.json();
  console.log('MATCHING condition_ids:');
  matchingData.forEach((row: any, idx: number) => {
    console.log(`  ${idx + 1}. ${row.condition_id} (len: ${row.condition_id.length})`);
  });

  // Get 5 non-matching condition_ids
  const nonMatching = await client.query({
    query: `
      SELECT DISTINCT t.condition_id
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.condition_id != '' AND r.condition_id_norm IS NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const nonMatchingData = await nonMatching.json();
  console.log('\nNON-MATCHING condition_ids:');
  nonMatchingData.forEach((row: any, idx: number) => {
    console.log(`  ${idx + 1}. ${row.condition_id} (len: ${row.condition_id.length})`);
  });

  console.log('\n=== STEP 3: UNDERSTAND market_resolutions_final SOURCE ===\n');

  const stats = await client.query({
    query: `
      SELECT
        COUNT(*) as total_resolutions,
        COUNT(DISTINCT condition_id_norm) as unique_conditions,
        MAX(resolved_at) as latest_resolution,
        MIN(resolved_at) as earliest_resolution,
        COUNT(CASE WHEN is_resolved = 1 THEN 1 END) as resolved_count,
        COUNT(CASE WHEN is_resolved = 0 THEN 1 END) as unresolved_count
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow'
  });
  const statsData = await stats.json();
  console.log('market_resolutions_final statistics:');
  console.log(JSON.stringify(statsData[0], null, 2));

  const schema = await client.query({
    query: `SHOW CREATE TABLE market_resolutions_final`,
    format: 'TabSeparated'
  });
  const schemaText = await schema.text();
  console.log('\nTable schema (first 1000 chars):');
  console.log(schemaText.substring(0, 1000));

  console.log('\n=== STEP 4: CHECK FOR ALTERNATIVE RESOLUTION SOURCES ===\n');

  const resTables = await client.query({
    query: `SHOW TABLES LIKE '%resolution%'`,
    format: 'JSONEachRow'
  });
  const resTablesData = await resTables.json();
  console.log('Tables containing "resolution":');
  resTablesData.forEach((row: any) => console.log(`  - ${Object.values(row)[0]}`));

  const marketTables = await client.query({
    query: `SHOW TABLES LIKE '%market%'`,
    format: 'JSONEachRow'
  });
  const marketTablesData = await marketTables.json();
  console.log('\nTables containing "market":');
  marketTablesData.forEach((row: any) => console.log(`  - ${Object.values(row)[0]}`));

  // Check counts for resolution-related tables
  console.log('\nRow counts for resolution tables:');
  const tablesToCheck = resTablesData.map((row: any) => Object.values(row)[0] as string);
  for (const table of tablesToCheck) {
    try {
      const count = await client.query({
        query: `SELECT COUNT(*) as cnt FROM ${table}`,
        format: 'JSONEachRow'
      });
      const countData = await count.json();
      console.log(`  ${table}: ${Number(countData[0].cnt).toLocaleString()} rows`);
    } catch (err: any) {
      console.log(`  ${table}: Error - ${err.message}`);
    }
  }

  console.log('\n=== STEP 5: COMPARE COVERAGE ===\n');

  const coverage = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT t.condition_id) as conditions_in_trades,
        COUNT(DISTINCT CASE WHEN r.condition_id_norm IS NOT NULL THEN t.condition_id END) as conditions_with_resolution,
        COUNT(DISTINCT CASE WHEN r.condition_id_norm IS NULL THEN t.condition_id END) as conditions_without_resolution,
        ROUND(conditions_with_resolution / conditions_in_trades * 100, 2) as coverage_pct
      FROM (
        SELECT DISTINCT condition_id FROM trades_raw WHERE condition_id != ''
      ) t
      LEFT JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log('Coverage analysis:');
  console.log(JSON.stringify(coverageData[0], null, 2));

  // Additional: Check if non-matching conditions are recent (unresolved markets)
  console.log('\n=== STEP 6: TEMPORAL ANALYSIS ===\n');

  const temporal = await client.query({
    query: `
      SELECT
        toStartOfMonth(timestamp) as month,
        COUNT(DISTINCT condition_id) as total_conditions,
        COUNT(DISTINCT CASE WHEN r.condition_id_norm IS NOT NULL THEN t.condition_id END) as matched_conditions,
        ROUND(matched_conditions / total_conditions * 100, 2) as match_pct
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.condition_id != ''
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `,
    format: 'JSONEachRow'
  });
  const temporalData = await temporal.json();
  console.log('Match rate by month (most recent 12 months):');
  temporalData.forEach((row: any) => {
    console.log(`  ${row.month}: ${row.total_conditions} conditions, ${row.matched_conditions} matched (${row.match_pct}%)`);
  });

  await client.close();
}

investigate().catch(console.error);
