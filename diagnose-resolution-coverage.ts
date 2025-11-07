#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

/**
 * COMPREHENSIVE RESOLUTION COVERAGE DIAGNOSTIC
 *
 * Tests the 24.7% match rate claim by:
 * 1. Sampling 10 random condition_ids from trades_raw
 * 2. Testing each against market_resolutions_final in all formats
 * 3. Analyzing the 57,655 successful matches
 * 4. Checking alternate data sources
 * 5. Schema analysis for clues
 */

import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('=== RESOLUTION COVERAGE DIAGNOSTIC ===\n');

  // STEP 1: Verify the baseline statistics
  console.log('STEP 1: Baseline Statistics');
  console.log('-'.repeat(80));

  const baselineStats = await client.query({
    query: `
      SELECT
        'trades_raw unique condition_ids' as metric,
        uniqExact(condition_id) as count
      FROM trades_raw

      UNION ALL

      SELECT
        'market_resolutions_final unique condition_id_norm' as metric,
        uniqExact(condition_id_norm) as count
      FROM market_resolutions_final

      UNION ALL

      SELECT
        'Matches (normalized join)' as metric,
        uniqExact(t.condition_id) as count
      FROM trades_raw t
      INNER JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const baseline = await baselineStats.json();
  baseline.forEach((row: any) => {
    console.log(`${row.metric}: ${row.count.toLocaleString()}`);
  });

  const tradesCount = baseline[0].count;
  const resolutionsCount = baseline[1].count;
  const matchCount = baseline[2].count;
  const matchPct = ((matchCount / tradesCount) * 100).toFixed(1);

  console.log(`\nMatch rate: ${matchPct}% (${matchCount.toLocaleString()} / ${tradesCount.toLocaleString()})`);
  console.log('');

  // STEP 2: Sample 10 random condition_ids from trades_raw
  console.log('STEP 2: Random Sample Test (10 condition_ids)');
  console.log('-'.repeat(80));

  const sampleQuery = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM trades_raw
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json<{ condition_id: string }>();

  console.log('Testing these condition_ids:');
  samples.forEach((s, i) => console.log(`  ${i + 1}. ${s.condition_id}`));
  console.log('');

  // Test each sample against market_resolutions_final
  let foundCount = 0;
  const results: any[] = [];

  for (const sample of samples) {
    const normalized = sample.condition_id.toLowerCase().replace('0x', '');

    const checkQuery = await client.query({
      query: `
        SELECT
          condition_id_norm,
          market_slug,
          question,
          winning_index,
          resolution_datetime
        FROM market_resolutions_final
        WHERE condition_id_norm = '${normalized}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const found = await checkQuery.json();
    const isFound = found.length > 0;

    if (isFound) foundCount++;

    results.push({
      condition_id: sample.condition_id,
      normalized,
      found: isFound,
      details: isFound ? found[0] : null
    });
  }

  console.log('Results:');
  results.forEach((r, i) => {
    console.log(`\n  ${i + 1}. ${r.condition_id}`);
    console.log(`     Normalized: ${r.normalized}`);
    console.log(`     Found: ${r.found ? 'YES ✓' : 'NO ✗'}`);
    if (r.found) {
      console.log(`     Market: ${r.details.market_slug}`);
      console.log(`     Question: ${r.details.question.substring(0, 60)}...`);
      console.log(`     Winner: ${r.details.winning_index}`);
    }
  });

  console.log(`\n  Sample match rate: ${foundCount}/10 (${(foundCount * 10)}%)`);
  console.log('');

  // STEP 3: Analyze the SUCCESSFUL matches - what do they look like?
  console.log('STEP 3: Analyze Successful Matches');
  console.log('-'.repeat(80));

  const matchAnalysis = await client.query({
    query: `
      SELECT
        m.market_slug,
        m.question,
        m.condition_id_norm,
        t.condition_id as original_format,
        countDistinct(t.tx_hash) as trade_count,
        sum(t.shares) as total_shares,
        min(t.timestamp) as first_trade,
        max(t.timestamp) as last_trade
      FROM trades_raw t
      INNER JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      GROUP BY m.market_slug, m.question, m.condition_id_norm, t.condition_id
      ORDER BY trade_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const matches = await matchAnalysis.json();
  console.log('Top 5 markets with most trades AND resolutions:');
  matches.forEach((m: any, i: number) => {
    console.log(`\n  ${i + 1}. ${m.market_slug}`);
    console.log(`     Question: ${m.question.substring(0, 60)}...`);
    console.log(`     Condition ID: ${m.condition_id_norm}`);
    console.log(`     Trades: ${m.trade_count.toLocaleString()}`);
    console.log(`     Total shares: ${parseFloat(m.total_shares).toLocaleString()}`);
  });
  console.log('');

  // STEP 4: Check alternate tables for resolution data
  console.log('STEP 4: Check Alternate Data Sources');
  console.log('-'.repeat(80));

  // Check if pm_trades has resolution data
  const pmTradesCheck = await client.query({
    query: `
      SELECT
        'pm_trades' as table_name,
        count() as total_rows,
        uniqExact(condition_id) as unique_conditions,
        countIf(winning_outcome IS NOT NULL) as rows_with_winning_outcome,
        countIf(payout IS NOT NULL) as rows_with_payout
      FROM pm_trades
      WHERE condition_id != ''
    `,
    format: 'JSONEachRow'
  });

  const pmTradesStats = await pmTradesCheck.json();
  console.log('pm_trades analysis:');
  pmTradesStats.forEach((row: any) => {
    console.log(`  Total rows: ${row.total_rows.toLocaleString()}`);
    console.log(`  Unique conditions: ${row.unique_conditions.toLocaleString()}`);
    console.log(`  Rows with winning_outcome: ${row.rows_with_winning_outcome.toLocaleString()}`);
    console.log(`  Rows with payout: ${row.rows_with_payout.toLocaleString()}`);
  });
  console.log('');

  // Check trades_dedup_mat
  const dedupCheck = await client.query({
    query: `
      SELECT
        'trades_dedup_mat' as table_name,
        count() as total_rows,
        uniqExact(condition_id) as unique_conditions
      FROM trades_dedup_mat
      WHERE condition_id != ''
    `,
    format: 'JSONEachRow'
  });

  const dedupStats = await dedupCheck.json();
  console.log('trades_dedup_mat analysis:');
  dedupStats.forEach((row: any) => {
    console.log(`  Total rows: ${row.total_rows.toLocaleString()}`);
    console.log(`  Unique conditions: ${row.unique_conditions.toLocaleString()}`);
  });
  console.log('');

  // STEP 5: Schema analysis
  console.log('STEP 5: Schema Analysis');
  console.log('-'.repeat(80));

  const tradesSchema = await client.query({
    query: `
      SELECT
        name,
        type,
        comment
      FROM system.columns
      WHERE database = 'polymarket'
        AND table = 'trades_raw'
        AND (name LIKE '%condition%' OR name LIKE '%market%' OR name LIKE '%resolution%')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  console.log('trades_raw relevant columns:');
  const tradesColumns = await tradesSchema.json();
  tradesColumns.forEach((col: any) => {
    console.log(`  ${col.name} (${col.type})`);
    if (col.comment) console.log(`    Comment: ${col.comment}`);
  });
  console.log('');

  const resolutionsSchema = await client.query({
    query: `
      SELECT
        name,
        type,
        comment
      FROM system.columns
      WHERE database = 'polymarket'
        AND table = 'market_resolutions_final'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  console.log('market_resolutions_final columns:');
  const resColumns = await resolutionsSchema.json();
  resColumns.forEach((col: any) => {
    console.log(`  ${col.name} (${col.type})`);
    if (col.comment) console.log(`    Comment: ${col.comment}`);
  });
  console.log('');

  // STEP 6: Deep dive - WHERE are the unmatched condition_ids coming from?
  console.log('STEP 6: Source Analysis of Unmatched Condition IDs');
  console.log('-'.repeat(80));

  const unmatchedAnalysis = await client.query({
    query: `
      SELECT
        countDistinct(t.condition_id) as unmatched_conditions,
        count() as unmatched_trades,
        sum(t.shares) as unmatched_shares,
        min(t.timestamp) as earliest_trade,
        max(t.timestamp) as latest_trade,
        uniqExact(t.market_slug) as unique_markets
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
    `,
    format: 'JSONEachRow'
  });

  const unmatched = await unmatchedAnalysis.json();
  console.log('Unmatched trades analysis:');
  unmatched.forEach((row: any) => {
    console.log(`  Unmatched condition_ids: ${row.unmatched_conditions.toLocaleString()}`);
    console.log(`  Unmatched trades: ${row.unmatched_trades.toLocaleString()}`);
    console.log(`  Unmatched shares: ${parseFloat(row.unmatched_shares).toLocaleString()}`);
    console.log(`  Date range: ${row.earliest_trade} to ${row.latest_trade}`);
    console.log(`  Unique markets: ${row.unique_markets.toLocaleString()}`);
  });
  console.log('');

  // STEP 7: Sample unmatched markets - are they OPEN markets?
  console.log('STEP 7: Sample Unmatched Markets');
  console.log('-'.repeat(80));

  const unmatchedSample = await client.query({
    query: `
      SELECT
        t.condition_id,
        t.market_slug,
        countDistinct(t.tx_hash) as trade_count,
        min(t.timestamp) as first_trade,
        max(t.timestamp) as last_trade
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
      GROUP BY t.condition_id, t.market_slug
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const unmatchedSamples = await unmatchedSample.json();
  console.log('Top 10 unmatched markets by trade count:');
  unmatchedSamples.forEach((m: any, i: number) => {
    console.log(`\n  ${i + 1}. ${m.market_slug}`);
    console.log(`     Condition ID: ${m.condition_id}`);
    console.log(`     Trades: ${m.trade_count}`);
    console.log(`     Date range: ${m.first_trade} to ${m.last_trade}`);
  });
  console.log('');

  // FINAL SUMMARY
  console.log('='.repeat(80));
  console.log('DIAGNOSTIC SUMMARY');
  console.log('='.repeat(80));
  console.log(`
1. BASELINE CONFIRMED:
   - trades_raw has ${tradesCount.toLocaleString()} unique condition_ids
   - market_resolutions_final has ${resolutionsCount.toLocaleString()} unique condition_id_norm
   - Match rate: ${matchPct}% (${matchCount.toLocaleString()} matched)
   - Missing: ${(tradesCount - matchCount).toLocaleString()} condition_ids

2. RANDOM SAMPLE TEST:
   - ${foundCount}/10 sampled condition_ids found in market_resolutions_final
   - Sample match rate: ${(foundCount * 10)}%

3. HYPOTHESIS:
   ${foundCount < 3 ?
     'The missing 75% are likely UNRESOLVED markets (still open)' :
     'The sample suggests better coverage than baseline - possible data skew'}

4. NEXT STEPS:
   - Check if unmatched markets are currently OPEN (not yet resolved)
   - Verify market_resolutions_final is only storing CLOSED markets
   - Consider building a separate tracking table for open positions
  `);

  await client.close();
}

main().catch(console.error);
