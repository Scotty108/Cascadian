#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function diagnoseEmptyOutcomes() {
  console.log('='.repeat(80));
  console.log('DIAGNOSIS: Empty winning_outcome in market_resolutions_final');
  console.log('='.repeat(80));
  console.log();

  // Check distribution of empty vs populated winning_outcome
  const distQuery = `
    SELECT
      winning_outcome = '' as is_empty,
      count() as count,
      count() * 100.0 / (SELECT count() FROM market_resolutions_final) as percentage
    FROM market_resolutions_final
    GROUP BY is_empty
    ORDER BY is_empty
  `;

  console.log('📊 Distribution of winning_outcome values:');
  const distResult = await client.query({ query: distQuery, format: 'JSONEachRow' });
  const dist: any[] = await distResult.json();
  console.table(dist);

  // Sample rows with empty winning_outcome
  console.log('\n🔍 Sample rows with EMPTY winning_outcome:');
  const emptySampleQuery = `
    SELECT *
    FROM market_resolutions_final
    WHERE winning_outcome = ''
    LIMIT 10
  `;

  const emptySampleResult = await client.query({ query: emptySampleQuery, format: 'JSONEachRow' });
  const emptySamples: any[] = await emptySampleResult.json();
  console.table(emptySamples);

  // Sample rows with populated winning_outcome
  console.log('\n✅ Sample rows with POPULATED winning_outcome:');
  const populatedSampleQuery = `
    SELECT *
    FROM market_resolutions_final
    WHERE winning_outcome != ''
    LIMIT 10
  `;

  const populatedSampleResult = await client.query({ query: populatedSampleQuery, format: 'JSONEachRow' });
  const populatedSamples: any[] = await populatedSampleResult.json();
  console.table(populatedSamples);

  // Check if empty outcomes correlate with source
  console.log('\n📦 Empty outcomes by data source:');
  const sourceQuery = `
    SELECT
      source,
      countIf(winning_outcome = '') as empty_count,
      countIf(winning_outcome != '') as populated_count,
      count() as total,
      (empty_count * 100.0 / total) as empty_percentage
    FROM market_resolutions_final
    GROUP BY source
    ORDER BY empty_percentage DESC
  `;

  const sourceResult = await client.query({ query: sourceQuery, format: 'JSONEachRow' });
  const sourceData: any[] = await sourceResult.json();
  console.table(sourceData);

  // Check if empty outcomes correlate with resolved_at being NULL
  console.log('\n📅 Empty outcomes vs resolved_at status:');
  const resolvedQuery = `
    SELECT
      winning_outcome = '' as is_empty,
      resolved_at IS NULL as resolved_at_null,
      count() as count
    FROM market_resolutions_final
    GROUP BY is_empty, resolved_at_null
    ORDER BY is_empty, resolved_at_null
  `;

  const resolvedResult = await client.query({ query: resolvedQuery, format: 'JSONEachRow' });
  const resolvedData: any[] = await resolvedResult.json();
  console.table(resolvedData);

  console.log('\n='.repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(80));

  await client.close();
}

diagnoseEmptyOutcomes()
  .then(() => {
    console.log('\n✅ Complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
