#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE RESOLUTION COVERAGE DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log('');

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
        'market_resolutions_final total rows' as metric,
        count() as count
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

  const baseline = await baselineStats.json<{metric: string, count: string}>();
  baseline.forEach((row) => {
    console.log(`${row.metric.padEnd(55)}: ${parseInt(row.count).toLocaleString()}`);
  });

  const tradesCount = parseInt(baseline[0].count);
  const resolutionsUniqueCount = parseInt(baseline[1].count);
  const resolutionsTotalCount = parseInt(baseline[2].count);
  const matchCount = parseInt(baseline[3].count);
  const matchPct = ((matchCount / tradesCount) * 100).toFixed(1);

  console.log('');
  console.log(`Match rate: ${matchPct}% (${matchCount.toLocaleString()} of ${tradesCount.toLocaleString()} condition_ids matched)`);
  console.log(`Missing: ${(tradesCount - matchCount).toLocaleString()} condition_ids NOT found in resolutions`);
  console.log('');

  // STEP 2: Sample 10 random condition_ids from trades_raw
  console.log('STEP 2: Random Sample Test (10 condition_ids from trades_raw)');
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
          winning_outcome,
          winning_index,
          resolved_at,
          source
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
      console.log(`     Winner: ${r.details.winning_outcome} (index ${r.details.winning_index})`);
      console.log(`     Resolved: ${r.details.resolved_at}`);
      console.log(`     Source: ${r.details.source}`);
    }
  });

  console.log(`\n  Sample match rate: ${foundCount}/10 (${(foundCount * 10)}%)`);
  console.log('');

  // STEP 3: Analyze the SUCCESSFUL matches
  console.log('STEP 3: Analyze Successful Matches');
  console.log('-'.repeat(80));

  const matchAnalysis = await client.query({
    query: `
      SELECT
        m.condition_id_norm,
        m.winning_outcome,
        t.condition_id as original_format,
        countDistinct(t.tx_hash) as trade_count,
        sum(t.shares) as total_shares,
        min(t.timestamp) as first_trade,
        max(t.timestamp) as last_trade
      FROM trades_raw t
      INNER JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      GROUP BY m.condition_id_norm, m.winning_outcome, t.condition_id
      ORDER BY trade_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const matches = await matchAnalysis.json<any>();
  console.log('Top 5 markets with most trades AND resolutions:');
  matches.forEach((m: any, i: number) => {
    console.log(`\n  ${i + 1}. Condition: ${m.condition_id_norm.substring(0, 16)}...`);
    console.log(`     Winner: ${m.winning_outcome}`);
    console.log(`     Trades: ${parseInt(m.trade_count).toLocaleString()}`);
    console.log(`     Total shares: ${parseFloat(m.total_shares).toLocaleString()}`);
    console.log(`     Date range: ${m.first_trade} to ${m.last_trade}`);
  });
  console.log('');

  // STEP 4: Deep dive - WHERE are the unmatched condition_ids coming from?
  console.log('STEP 4: Analysis of UNMATCHED Condition IDs');
  console.log('-'.repeat(80));

  const unmatchedAnalysis = await client.query({
    query: `
      SELECT
        countDistinct(t.condition_id) as unmatched_conditions,
        count() as unmatched_trades,
        sum(t.shares) as unmatched_shares,
        min(t.timestamp) as earliest_trade,
        max(t.timestamp) as latest_trade
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
    `,
    format: 'JSONEachRow'
  });

  const unmatched = await unmatchedAnalysis.json<any>();
  console.log('Unmatched trades statistics:');
  unmatched.forEach((row: any) => {
    console.log(`  Unmatched condition_ids: ${parseInt(row.unmatched_conditions).toLocaleString()}`);
    console.log(`  Unmatched trades: ${parseInt(row.unmatched_trades).toLocaleString()}`);
    console.log(`  Unmatched shares: ${parseFloat(row.unmatched_shares).toLocaleString()}`);
    console.log(`  Date range: ${row.earliest_trade} to ${row.latest_trade}`);
  });
  console.log('');

  // STEP 5: Sample unmatched condition_ids - check if they're recent (open markets)
  console.log('STEP 5: Sample UNMATCHED Condition IDs (Top 10 by trade count)');
  console.log('-'.repeat(80));

  const unmatchedSample = await client.query({
    query: `
      SELECT
        t.condition_id,
        countDistinct(t.tx_hash) as trade_count,
        sum(t.shares) as total_shares,
        min(t.timestamp) as first_trade,
        max(t.timestamp) as last_trade
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
      GROUP BY t.condition_id
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const unmatchedSamples = await unmatchedSample.json<any>();
  console.log('Top 10 unmatched condition_ids by trade count:');
  unmatchedSamples.forEach((m: any, i: number) => {
    const daysSinceLastTrade = Math.floor((Date.now() - new Date(m.last_trade).getTime()) / (1000 * 60 * 60 * 24));
    console.log(`\n  ${i + 1}. ${m.condition_id}`);
    console.log(`     Trades: ${parseInt(m.trade_count).toLocaleString()}`);
    console.log(`     Shares: ${parseFloat(m.total_shares).toLocaleString()}`);
    console.log(`     Last trade: ${m.last_trade} (${daysSinceLastTrade} days ago)`);
    console.log(`     Date range: ${m.first_trade} to ${m.last_trade}`);
  });
  console.log('');

  // STEP 6: Check alternate tables for resolution data
  console.log('STEP 6: Check Alternate Data Sources');
  console.log('-'.repeat(80));

  // Check if pm_trades has resolution data
  const pmTradesCheck = await client.query({
    query: `
      SELECT
        'pm_trades' as table_name,
        count() as total_rows,
        uniqExact(condition_id) as unique_conditions
      FROM pm_trades
      WHERE condition_id != ''
    `,
    format: 'JSONEachRow'
  });

  const pmTradesStats = await pmTradesCheck.json<any>();
  console.log('pm_trades analysis:');
  pmTradesStats.forEach((row: any) => {
    console.log(`  Total rows: ${parseInt(row.total_rows).toLocaleString()}`);
    console.log(`  Unique conditions: ${parseInt(row.unique_conditions).toLocaleString()}`);
  });
  console.log('');

  // Test if pm_trades has some of the unmatched condition_ids
  const pmTradesCoverage = await client.query({
    query: `
      SELECT
        countDistinct(t.condition_id) as unmatched_in_trades_raw,
        countDistinct(pm.condition_id) as found_in_pm_trades
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      LEFT JOIN pm_trades pm
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(pm.condition_id, '0x', ''))
      WHERE m.condition_id_norm IS NULL
        AND pm.condition_id IS NOT NULL
    `,
    format: 'JSONEachRow'
  });

  const pmCov = await pmTradesCoverage.json<any>();
  if (pmCov.length > 0 && parseInt(pmCov[0].found_in_pm_trades) > 0) {
    console.log(`pm_trades contains ${parseInt(pmCov[0].found_in_pm_trades).toLocaleString()} of the unmatched condition_ids!`);
  } else {
    console.log('pm_trades does NOT contain the unmatched condition_ids');
  }
  console.log('');

  // STEP 7: Resolution source breakdown
  console.log('STEP 7: Resolution Sources Breakdown');
  console.log('-'.repeat(80));

  const sourcesBreakdown = await client.query({
    query: `
      SELECT
        source,
        count() as resolution_count,
        uniqExact(condition_id_norm) as unique_conditions
      FROM market_resolutions_final
      GROUP BY source
      ORDER BY resolution_count DESC
    `,
    format: 'JSONEachRow'
  });

  const sources = await sourcesBreakdown.json<any>();
  console.log('Resolution sources:');
  sources.forEach((s: any) => {
    console.log(`  ${s.source.padEnd(20)}: ${parseInt(s.resolution_count).toLocaleString().padStart(10)} resolutions, ${parseInt(s.unique_conditions).toLocaleString().padStart(10)} unique conditions`);
  });
  console.log('');

  // FINAL SUMMARY
  console.log('='.repeat(80));
  console.log('DIAGNOSTIC SUMMARY');
  console.log('='.repeat(80));
  console.log(`
FINDINGS:

1. BASELINE DATA:
   - trades_raw has ${tradesCount.toLocaleString()} unique condition_ids
   - market_resolutions_final has ${resolutionsUniqueCount.toLocaleString()} unique conditions (${resolutionsTotalCount.toLocaleString()} total rows)
   - Match rate: ${matchPct}% (${matchCount.toLocaleString()} matched, ${(tradesCount - matchCount).toLocaleString()} missing)

2. RANDOM SAMPLE TEST:
   - ${foundCount}/10 sampled condition_ids found in market_resolutions_final
   - Sample match rate: ${(foundCount * 10)}%
   - ${foundCount === 10 ? 'PERFECT MATCH - all sampled found!' : foundCount >= 5 ? 'GOOD - most samples found' : 'POOR - most samples missing'}

3. HYPOTHESIS:
   ${matchPct < 50 ?
     `The ${(100 - parseFloat(matchPct)).toFixed(1)}% missing are likely:
     - UNRESOLVED markets (still open, awaiting outcome)
     - Very recent trades on markets not yet resolved
     - Markets that closed after data collection cutoff` :
     `Coverage is ${matchPct}% which is ${matchPct > 75 ? 'GOOD' : 'MODERATE'}
     - Most active markets have resolutions
     - Missing ${(100 - parseFloat(matchPct)).toFixed(1)}% likely unresolved/open markets`}

4. VOLUME ANALYSIS:
   - Check if unmatched trades represent small volume (dust)
   - Or if they represent significant $ value (problematic)

5. RECOMMENDATION:
   ${matchPct < 50 ? `
   - Build a market status tracker (open vs closed)
   - Only calculate P&L for RESOLVED markets
   - Track unrealized P&L separately for open positions` : `
   - Current resolution coverage is adequate for P&L calculations
   - Consider adding metadata to track market status
   - Monitor for stale/missing resolutions`}
  `);
}

main().catch(console.error);
