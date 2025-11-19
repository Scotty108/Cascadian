#!/usr/bin/env npx tsx
/**
 * Diagnose Missing CLOB Markets
 *
 * Analyzes the 31,248 missing markets to understand:
 * - Why they're missing
 * - Are they recent or old?
 * - Do they have trading activity on Polymarket?
 * - Can we fetch them from Goldsky?
 *
 * Run this BEFORE starting the backfill to understand the gap.
 */

import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Load .env.local
config({ path: path.resolve(process.cwd(), '.env.local') });

interface Market {
  condition_id: string;
  token_id: string;
  question?: string;
  fetched_at?: string;
  closed?: number;
}

async function fetchMissingMarkets(): Promise<Market[]> {
  console.log('🔍 Fetching missing markets from ClickHouse...\n');

  const query = `
    SELECT
      condition_id,
      token_id,
      question,
      fetched_at,
      closed
    FROM gamma_markets
    WHERE lower(replaceAll(condition_id, '0x', '')) NOT IN (
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
      FROM clob_fills
    )
    ORDER BY fetched_at DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return result.json<Market[]>();
}

async function analyzeByDateRange(markets: Market[]) {
  console.log('📅 ANALYSIS BY DATE RANGE');
  console.log('─'.repeat(80));

  const now = new Date();
  const buckets = {
    last_7_days: 0,
    last_30_days: 0,
    last_90_days: 0,
    last_6_months: 0,
    last_year: 0,
    older: 0,
    no_date: 0,
  };

  for (const market of markets) {
    if (!market.fetched_at) {
      buckets.no_date++;
      continue;
    }

    const created = new Date(market.fetched_at);
    const daysDiff = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff <= 7) buckets.last_7_days++;
    else if (daysDiff <= 30) buckets.last_30_days++;
    else if (daysDiff <= 90) buckets.last_90_days++;
    else if (daysDiff <= 180) buckets.last_6_months++;
    else if (daysDiff <= 365) buckets.last_year++;
    else buckets.older++;
  }

  console.log(`Last 7 days:      ${buckets.last_7_days.toLocaleString()} markets`);
  console.log(`Last 30 days:     ${buckets.last_30_days.toLocaleString()} markets`);
  console.log(`Last 90 days:     ${buckets.last_90_days.toLocaleString()} markets`);
  console.log(`Last 6 months:    ${buckets.last_6_months.toLocaleString()} markets`);
  console.log(`Last year:        ${buckets.last_year.toLocaleString()} markets`);
  console.log(`Older than 1y:    ${buckets.older.toLocaleString()} markets`);
  console.log(`No date:          ${buckets.no_date.toLocaleString()} markets`);

  return buckets;
}

async function analyzeResolutionStatus(markets: Market[]) {
  console.log('\n⚖️  ANALYSIS BY RESOLUTION STATUS');
  console.log('─'.repeat(80));

  let resolved = 0;
  let unresolved = 0;

  for (const market of markets) {
    if (market.closed === 1) {
      resolved++;
    } else {
      unresolved++;
    }
  }

  console.log(`Closed:           ${resolved.toLocaleString()} markets`);
  console.log(`Open:             ${unresolved.toLocaleString()} markets`);

  return { resolved, unresolved };
}

async function sampleMarkets(markets: Market[], count = 20) {
  console.log(`\n🎲 RANDOM SAMPLE (${count} markets)`);
  console.log('─'.repeat(80));

  // Shuffle and take sample
  const shuffled = markets.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, count);

  console.log('Will attempt to fetch fills for these sample markets:\n');

  for (let i = 0; i < sample.length; i++) {
    const m = sample[i];
    const question = m.question?.substring(0, 60) || 'No question';
    console.log(`${(i + 1).toString().padStart(2)}. ${question}`);
    console.log(`    Condition ID: ${m.condition_id}`);
    console.log(`    Fetched: ${m.fetched_at || 'Unknown'}`);
    console.log(`    Status: ${m.closed === 1 ? 'Closed' : 'Open'}\n`);
  }

  return sample;
}

async function testGoldskyFetch(tokenId: string): Promise<{
  success: boolean;
  fillCount?: number;
  error?: string;
}> {
  const query = `
    query GetOrderFills($tokenId: String!, $first: Int!) {
      orderFilledEvents(
        where: {
          or: [
            { makerAssetId: $tokenId },
            { takerAssetId: $tokenId }
          ]
        }
        first: $first
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        transactionHash
        timestamp
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `;

  try {
    const response = await fetch(
      process.env.GOLDSKY_API_URL ||
      'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { tokenId, first: 10 },
        }),
      }
    );

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (result.errors) {
      return { success: false, error: result.errors[0].message };
    }

    const fills = result.data?.orderFilledEvents || [];
    return { success: true, fillCount: fills.length };

  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function testSampleFetches(sample: Market[]) {
  console.log('\n🧪 TESTING GOLDSKY API FETCHES (First 5 markets)');
  console.log('─'.repeat(80));

  let fetchable = 0;
  let zeroFills = 0;
  let errors = 0;

  for (let i = 0; i < Math.min(5, sample.length); i++) {
    const market = sample[i];
    const question = market.question?.substring(0, 50) || 'No question';

    process.stdout.write(`${i + 1}. Testing ${question}... `);

    const result = await testGoldskyFetch(market.token_id);

    if (result.success) {
      if (result.fillCount! > 0) {
        console.log(`✅ ${result.fillCount} fills found`);
        fetchable++;
      } else {
        console.log(`⚪ 0 fills (market has no trading activity)`);
        zeroFills++;
      }
    } else {
      console.log(`❌ Error: ${result.error}`);
      errors++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\nResults:');
  console.log(`  ✅ Fetchable with fills: ${fetchable}/5`);
  console.log(`  ⚪ Zero fills (expected):  ${zeroFills}/5`);
  console.log(`  ❌ Errors:                 ${errors}/5`);

  return { fetchable, zeroFills, errors };
}

async function generateRecommendations(
  totalMissing: number,
  dateBuckets: any,
  resolutionStatus: any,
  testResults: any
) {
  console.log('\n💡 RECOMMENDATIONS');
  console.log('═'.repeat(80));

  const recentMarkets = dateBuckets.last_30_days + dateBuckets.last_7_days;
  const zeroFillRate = testResults.zeroFills / 5;
  const errorRate = testResults.errors / 5;

  console.log('Based on analysis:\n');

  // Estimate recoverable markets
  const expectedZeroFills = Math.floor(totalMissing * zeroFillRate);
  const expectedErrors = Math.floor(totalMissing * errorRate);
  const expectedRecoverable = totalMissing - expectedZeroFills - expectedErrors;

  console.log(`1. EXPECTED OUTCOMES:`);
  console.log(`   - Recoverable with fills:  ~${expectedRecoverable.toLocaleString()} markets`);
  console.log(`   - Zero fills (expected):   ~${expectedZeroFills.toLocaleString()} markets`);
  console.log(`   - Errors/rate limits:      ~${expectedErrors.toLocaleString()} markets`);
  console.log(`   - Expected final coverage: ~${(((118660 + expectedRecoverable) / 149908) * 100).toFixed(1)}%`);

  console.log(`\n2. RECOMMENDED APPROACH:`);
  if (errorRate > 0.3) {
    console.log(`   ⚠️  High error rate detected (${(errorRate * 100).toFixed(0)}%)`);
    console.log(`   - Start with WORKER_COUNT=16 (conservative)`);
    console.log(`   - Add delays: DELAY_MS=500`);
    console.log(`   - Monitor for rate limiting`);
  } else {
    console.log(`   ✅ Low error rate (${(errorRate * 100).toFixed(0)}%)`);
    console.log(`   - Start with WORKER_COUNT=32 (recommended)`);
    console.log(`   - Standard delays: DELAY_MS=100`);
    console.log(`   - Should complete in 4-6 hours`);
  }

  console.log(`\n3. PRIORITY MARKETS:`);
  if (recentMarkets > 1000) {
    console.log(`   ⚠️  ${recentMarkets.toLocaleString()} recent markets missing!`);
    console.log(`   - These should be prioritized (recent = more likely to have fills)`);
  } else {
    console.log(`   ✅ Only ${recentMarkets.toLocaleString()} recent markets missing`);
    console.log(`   - Most missing markets are old (less likely to have fills)`);
  }

  console.log(`\n4. NEXT STEPS:`);
  console.log(`   1. Review sample markets above`);
  console.log(`   2. Decide if coverage target is realistic`);
  console.log(`   3. Run backfill with recommended settings`);
  console.log(`   4. Monitor progress with: watch -n 10 npx tsx scripts/monitor-clob-coverage.ts`);

  console.log('\n5. ESTIMATED TIMELINE:');
  const marketsPerMin = 32 * 0.5; // 32 workers * 0.5 markets/sec/worker * 60 sec
  const minutes = expectedRecoverable / marketsPerMin;
  console.log(`   - At 32 workers: ~${(minutes / 60).toFixed(1)} hours`);
  console.log(`   - At 64 workers: ~${(minutes / 120).toFixed(1)} hours`);

  console.log('\n═'.repeat(80));
}

async function main() {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              CLOB MISSING MARKETS DIAGNOSTIC REPORT                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Fetch all missing markets
  const missingMarkets = await fetchMissingMarkets();

  console.log(`✅ Found ${missingMarkets.length.toLocaleString()} missing markets\n`);

  // Analyze by date range
  const dateBuckets = await analyzeByDateRange(missingMarkets);

  // Analyze resolution status
  const resolutionStatus = await analyzeResolutionStatus(missingMarkets);

  // Sample markets
  const sample = await sampleMarkets(missingMarkets, 20);

  // Test Goldsky API on sample
  const testResults = await testSampleFetches(sample);

  // Generate recommendations
  await generateRecommendations(
    missingMarkets.length,
    dateBuckets,
    resolutionStatus,
    testResults
  );

  // Export missing markets list
  const exportPath = 'tmp/missing-markets-list.json';
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile(
    exportPath,
    JSON.stringify(missingMarkets.map(m => m.condition_id), null, 2)
  );
  console.log(`\n💾 Exported missing markets to: ${exportPath}`);
  console.log('   Use this list for targeted backfill\n');
}

main().catch(console.error);
