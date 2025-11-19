#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('='.repeat(100));
  console.log('FINAL COMPREHENSIVE RESOLUTION COVERAGE DIAGNOSTIC');
  console.log('='.repeat(100));
  console.log('');

  // STEP 1: Baseline Statistics
  console.log('STEP 1: Baseline Statistics');
  console.log('-'.repeat(100));

  const baseline1 = await client.query({
    query: `SELECT uniqExact(condition_id) as count FROM trades_raw WHERE condition_id != ''`,
    format: 'JSONEachRow'
  });
  const tradesCount = parseInt((await baseline1.json<any>())[0].count);

  const baseline2 = await client.query({
    query: `SELECT uniqExact(condition_id_norm) as count FROM market_resolutions_final`,
    format: 'JSONEachRow'
  });
  const resolutionsUniqueCount = parseInt((await baseline2.json<any>())[0].count);

  const baseline3 = await client.query({
    query: `SELECT count() as count FROM market_resolutions_final`,
    format: 'JSONEachRow'
  });
  const resolutionsTotalCount = parseInt((await baseline3.json<any>())[0].count);

  const baseline4 = await client.query({
    query: `
      SELECT uniqExact(t.condition_id) as count
      FROM trades_raw t
      INNER JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const matchCount = parseInt((await baseline4.json<any>())[0].count);

  const matchPct = ((matchCount / tradesCount) * 100).toFixed(1);
  const missingCount = tradesCount - matchCount;
  const missingPct = ((missingCount / tradesCount) * 100).toFixed(1);

  console.log(`trades_raw unique condition_ids (non-empty)    : ${tradesCount.toLocaleString()}`);
  console.log(`market_resolutions_final unique condition_ids  : ${resolutionsUniqueCount.toLocaleString()}`);
  console.log(`market_resolutions_final total rows            : ${resolutionsTotalCount.toLocaleString()}`);
  console.log(`Matched condition_ids                          : ${matchCount.toLocaleString()}`);
  console.log(`Unmatched condition_ids                        : ${missingCount.toLocaleString()}`);
  console.log('');
  console.log(`Match rate    : ${matchPct}%`);
  console.log(`Missing rate  : ${missingPct}%`);
  console.log('');

  // STEP 2: Sample 20 random condition_ids
  console.log('STEP 2: Random Sample Test (20 condition_ids from trades_raw)');
  console.log('-'.repeat(100));

  const sampleQuery = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM trades_raw
      WHERE condition_id != ''
        AND condition_id NOT LIKE 'token_%'
      ORDER BY rand()
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleQuery.json<{ condition_id: string }>();

  let foundCount = 0;
  const results: any[] = [];

  for (const sample of samples) {
    const normalized = sample.condition_id.toLowerCase().replace('0x', '');

    const checkQuery = await client.query({
      query: `
        SELECT condition_id_norm, winning_outcome, winning_index, resolved_at, source
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

  console.log('Results (showing first 10):');
  results.slice(0, 10).forEach((r, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${r.condition_id.substring(0, 66)}`);
    console.log(`      Found: ${r.found ? 'YES ✓' : 'NO ✗'}${r.found ? ` | Winner: ${r.details.winning_outcome} (idx ${r.details.winning_index}) | Source: ${r.details.source}` : ''}`);
  });

  console.log(`\n  Sample match rate: ${foundCount}/20 (${((foundCount / 20) * 100).toFixed(0)}%)`);
  console.log('');

  // STEP 3: Analyze matched vs unmatched by VOLUME
  console.log('STEP 3: Volume Analysis - Matched vs Unmatched');
  console.log('-'.repeat(100));

  const volumeAnalysis = await client.query({
    query: `
      SELECT
        CASE
          WHEN m.condition_id_norm IS NOT NULL THEN 'MATCHED'
          ELSE 'UNMATCHED'
        END as status,
        count() as trade_count,
        sum(t.usd_value) as total_usd,
        avg(t.usd_value) as avg_usd,
        uniqExact(t.condition_id) as unique_conditions
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE t.condition_id != ''
      GROUP BY status
    `,
    format: 'JSONEachRow'
  });

  const volumeStats = await volumeAnalysis.json<any>();
  console.log('Trade volume breakdown:');
  volumeStats.forEach((s: any) => {
    const pct = (parseInt(s.trade_count) / volumeStats.reduce((sum: number, x: any) => sum + parseInt(x.trade_count), 0) * 100).toFixed(1);
    console.log(`\n  ${s.status}:`);
    console.log(`    Trades          : ${parseInt(s.trade_count).toLocaleString()} (${pct}%)`);
    console.log(`    Total USD       : $${parseFloat(s.total_usd).toLocaleString()}`);
    console.log(`    Avg trade size  : $${parseFloat(s.avg_usd).toFixed(2)}`);
    console.log(`    Unique markets  : ${parseInt(s.unique_conditions).toLocaleString()}`);
  });
  console.log('');

  // STEP 4: Analyze unmatched by recency
  console.log('STEP 4: Unmatched Trades - Recency Analysis');
  console.log('-'.repeat(100));

  const recencyAnalysis = await client.query({
    query: `
      SELECT
        CASE
          WHEN toDate(t.timestamp) >= today() - INTERVAL 7 DAY THEN 'Last 7 days'
          WHEN toDate(t.timestamp) >= today() - INTERVAL 30 DAY THEN 'Last 30 days'
          WHEN toDate(t.timestamp) >= today() - INTERVAL 90 DAY THEN 'Last 90 days'
          ELSE 'Older than 90 days'
        END as period,
        count() as trade_count,
        uniqExact(t.condition_id) as unique_conditions,
        sum(t.usd_value) as total_usd
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
        AND t.condition_id != ''
      GROUP BY period
      ORDER BY 
        CASE period
          WHEN 'Last 7 days' THEN 1
          WHEN 'Last 30 days' THEN 2
          WHEN 'Last 90 days' THEN 3
          ELSE 4
        END
    `,
    format: 'JSONEachRow'
  });

  const recency = await recencyAnalysis.json<any>();
  console.log('Unmatched trades by time period:');
  recency.forEach((r: any) => {
    console.log(`\n  ${r.period}:`);
    console.log(`    Trades          : ${parseInt(r.trade_count).toLocaleString()}`);
    console.log(`    Unique markets  : ${parseInt(r.unique_conditions).toLocaleString()}`);
    console.log(`    Total USD       : $${parseFloat(r.total_usd).toLocaleString()}`);
  });
  console.log('');

  // STEP 5: Top unmatched markets
  console.log('STEP 5: Top 10 Unmatched Markets (by trade count)');
  console.log('-'.repeat(100));

  const topUnmatched = await client.query({
    query: `
      SELECT
        t.condition_id,
        count() as trade_count,
        sum(t.usd_value) as total_usd,
        min(t.timestamp) as first_trade,
        max(t.timestamp) as last_trade,
        uniqExact(t.wallet_address) as unique_wallets
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
        AND t.condition_id != ''
        AND t.condition_id NOT LIKE 'token_%'
      GROUP BY t.condition_id
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const topUnmatchedMarkets = await topUnmatched.json<any>();
  topUnmatchedMarkets.forEach((m: any, i: number) => {
    const daysSinceLast = Math.floor((Date.now() - new Date(m.last_trade).getTime()) / (1000 * 60 * 60 * 24));
    console.log(`\n  ${i + 1}. ${m.condition_id.substring(0, 66)}`);
    console.log(`     Trades: ${parseInt(m.trade_count).toLocaleString()} | USD: $${parseFloat(m.total_usd).toLocaleString()} | Wallets: ${parseInt(m.unique_wallets).toLocaleString()}`);
    console.log(`     Last trade: ${m.last_trade} (${daysSinceLast} days ago)`);
  });
  console.log('');

  // STEP 6: Resolution source breakdown
  console.log('STEP 6: Resolution Sources in market_resolutions_final');
  console.log('-'.repeat(100));

  const sources = await client.query({
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

  const sourcesData = await sources.json<any>();
  sourcesData.forEach((s: any) => {
    const pct = (parseInt(s.resolution_count) / resolutionsTotalCount * 100).toFixed(1);
    console.log(`  ${s.source.padEnd(25)}: ${parseInt(s.resolution_count).toLocaleString().padStart(10)} rows (${pct.padStart(5)}%) | ${parseInt(s.unique_conditions).toLocaleString().padStart(10)} unique conditions`);
  });
  console.log('');

  // STEP 7: Check if condition_id format is the issue
  console.log('STEP 7: Condition ID Format Analysis');
  console.log('-'.repeat(100));

  const formatAnalysis = await client.query({
    query: `
      SELECT
        CASE
          WHEN condition_id LIKE '0x%' THEN 'Hex (0x prefix)'
          WHEN condition_id LIKE 'token_%' THEN 'Token ID format'
          WHEN length(condition_id) = 64 THEN 'Hex (no prefix)'
          WHEN condition_id = '' THEN 'Empty'
          ELSE 'Other'
        END as format,
        count() as trade_count,
        uniqExact(condition_id) as unique_ids
      FROM trades_raw
      GROUP BY format
      ORDER BY trade_count DESC
    `,
    format: 'JSONEachRow'
  });

  const formatData = await formatAnalysis.json<any>();
  console.log('Condition ID formats in trades_raw:');
  formatData.forEach((f: any) => {
    console.log(`  ${f.format.padEnd(25)}: ${parseInt(f.trade_count).toLocaleString().padStart(10)} trades | ${parseInt(f.unique_ids).toLocaleString().padStart(10)} unique IDs`);
  });
  console.log('');

  // FINAL SUMMARY
  console.log('='.repeat(100));
  console.log('EXECUTIVE SUMMARY');
  console.log('='.repeat(100));

  const matchedVolume = volumeStats.find((v: any) => v.status === 'MATCHED');
  const unmatchedVolume = volumeStats.find((v: any) => v.status === 'UNMATCHED');

  console.log(`
CRITICAL FINDINGS:

1. COVERAGE STATISTICS:
   - Total unique condition_ids in trades_raw: ${tradesCount.toLocaleString()}
   - Matched with resolutions: ${matchCount.toLocaleString()} (${matchPct}%)
   - Unmatched (NO resolution): ${missingCount.toLocaleString()} (${missingPct}%)

2. RANDOM SAMPLE VERIFICATION:
   - Tested 20 random condition_ids
   - Found ${foundCount}/20 (${((foundCount / 20) * 100).toFixed(0)}%) in market_resolutions_final
   - This ${Math.abs(foundCount / 20 * 100 - parseFloat(matchPct)) < 15 ? 'CONFIRMS' : 'CONTRADICTS'} the ${matchPct}% baseline match rate

3. VOLUME IMPACT:
   - Matched trades: ${matchedVolume ? `${parseInt(matchedVolume.trade_count).toLocaleString()} trades, $${parseFloat(matchedVolume.total_usd).toLocaleString()}` : 'N/A'}
   - Unmatched trades: ${unmatchedVolume ? `${parseInt(unmatchedVolume.trade_count).toLocaleString()} trades, $${parseFloat(unmatchedVolume.total_usd).toLocaleString()}` : 'N/A'}

4. ROOT CAUSE HYPOTHESIS:
   ${parseFloat(missingPct) > 50 ? `
   🚨 CRITICAL: ${missingPct}% of condition_ids have NO resolution data
   
   Likely causes:
   a) UNRESOLVED MARKETS - Trades on markets still open/awaiting outcome
   b) DATA COLLECTION GAP - Resolution data not backfilled completely
   c) MARKET STATUS MISSING - No tracking of open vs closed markets
   
   Impact on P&L:
   - Cannot calculate realized P&L for ${missingPct}% of markets
   - Affects ${unmatchedVolume ? parseInt(unmatchedVolume.trade_count).toLocaleString() : 'unknown'} trades
   - Represents $${unmatchedVolume ? parseFloat(unmatchedVolume.total_usd).toLocaleString() : 'unknown'} in volume
   ` : `
   ✓ Coverage at ${matchPct}% is ${parseFloat(matchPct) > 75 ? 'GOOD' : 'MODERATE'}
   - Most active markets have resolutions
   - Missing ${missingPct}% likely unresolved/open markets
   `}

5. IMMEDIATE ACTION REQUIRED:
   ${parseFloat(missingPct) > 50 ? `
   [ ] Backfill resolution data for historical markets
   [ ] Add market status tracking (open/closed/resolved)
   [ ] Build separate unrealized P&L calculation for open positions
   [ ] Query Polymarket API for missing resolutions
   [ ] Validate data pipeline completeness
   ` : `
   [ ] Add market status metadata
   [ ] Track unrealized P&L for open positions
   [ ] Monitor for stale resolutions
   `}

6. DATA QUALITY SCORE: ${parseFloat(matchPct) >= 80 ? 'A (Excellent)' : parseFloat(matchPct) >= 60 ? 'B (Good)' : parseFloat(matchPct) >= 40 ? 'C (Fair)' : 'F (Poor)'}
  `);
}

main().catch(console.error);
