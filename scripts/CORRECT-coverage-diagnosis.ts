#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('CORRECTED COVERAGE DIAGNOSIS: THE REAL NUMBERS');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Count DISTINCT traded markets (excluding zero condition IDs)
  console.log('1. COUNTING TRADED MARKETS');
  console.log('─'.repeat(80));

  const tradedQuery = await client.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as total_traded
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const traded = (await tradedQuery.json<any[]>())[0];
  console.log(`Total distinct traded markets: ${traded.total_traded.toLocaleString()}`);
  console.log();

  // Step 2: Count DISTINCT markets WITH resolutions
  console.log('2. COUNTING MARKETS WITH RESOLUTIONS');
  console.log('─'.repeat(80));

  const withResQuery = await client.query({
    query: `
      SELECT count(DISTINCT t.condition_id_norm) as with_resolutions
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON t.condition_id_norm = concat('0x', r.condition_id_norm)
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND r.payout_denominator > 0
    `,
    format: 'JSONEachRow',
  });
  const withRes = (await withResQuery.json<any[]>())[0];
  console.log(`Markets with resolutions: ${withRes.with_resolutions.toLocaleString()}`);
  console.log();

  // Step 3: Calculate actual coverage
  const missing = traded.total_traded - withRes.with_resolutions;
  const coveragePct = (100 * withRes.with_resolutions / traded.total_traded).toFixed(1);

  console.log('═'.repeat(80));
  console.log('REAL COVERAGE NUMBERS');
  console.log('═'.repeat(80));
  console.log();
  console.log(`Total traded markets:        ${traded.total_traded.toLocaleString()}`);
  console.log(`Markets with resolutions:    ${withRes.with_resolutions.toLocaleString()}`);
  console.log(`Markets WITHOUT resolutions: ${missing.toLocaleString()}`);
  console.log(`Coverage:                    ${coveragePct}%`);
  console.log();

  // Step 4: Sample 20 missing markets and check API
  console.log('═'.repeat(80));
  console.log('SAMPLING 20 MISSING MARKETS FROM POLYMARKET API');
  console.log('═'.repeat(80));
  console.log();

  const missingQuery = await client.query({
    query: `
      SELECT DISTINCT t.condition_id_norm
      FROM default.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r
        ON t.condition_id_norm = concat('0x', r.condition_id_norm)
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND r.condition_id_norm IS NULL
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const missingIds = await missingQuery.json<Array<{condition_id_norm: string}>>();

  let resolved = 0;
  let unresolved = 0;
  let notFound = 0;
  let repeating = 0;

  console.log('Checking 20 missing markets...');
  console.log();

  for (const {condition_id_norm} of missingIds) {
    const cleanId = condition_id_norm.replace('0x', '');
    const url = `https://gamma-api.polymarket.com/markets?id=${cleanId}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        notFound++;
        console.log(`  ❌ NOT FOUND: ${condition_id_norm.substring(0, 20)}...`);
        continue;
      }

      const data = await response.json();
      if (!data || data.length === 0) {
        notFound++;
        console.log(`  ❌ NO DATA: ${condition_id_norm.substring(0, 20)}...`);
        continue;
      }

      const market = data[0];
      const hasWinner = market.outcome && market.outcome !== '';
      const question = (market.question || '').toLowerCase();
      const isRepeating = question.includes('daily') ||
                         question.includes('weekly') ||
                         question.includes('monthly') ||
                         question.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);

      if (hasWinner) {
        resolved++;
        if (isRepeating) repeating++;
        console.log(`  ✅ RESOLVED: ${market.question?.substring(0, 60)}...`);
      } else {
        unresolved++;
        console.log(`  ⏸️  UNRESOLVED: ${market.question?.substring(0, 60)}...`);
      }
    } catch (e) {
      notFound++;
      console.log(`  ❌ ERROR: ${condition_id_norm.substring(0, 20)}...`);
    }

    await new Promise(r => setTimeout(r, 50));
  }

  console.log();
  console.log('SAMPLE RESULTS:');
  console.log(`  Resolved:    ${resolved} (${(100*resolved/20).toFixed(0)}%)`);
  console.log(`    Of which repeating: ${repeating}`);
  console.log(`  Unresolved:  ${unresolved} (${(100*unresolved/20).toFixed(0)}%)`);
  console.log(`  Not found:   ${notFound} (${(100*notFound/20).toFixed(0)}%)`);
  console.log();

  // Step 5: Extrapolate to full dataset
  const estimatedResolved = Math.round(missing * (resolved / 20));
  const estimatedUnresolved = Math.round(missing * (unresolved / 20));
  const estimatedNotFound = Math.round(missing * (notFound / 20));

  console.log('═'.repeat(80));
  console.log('EXTRAPOLATED TO FULL DATASET');
  console.log('═'.repeat(80));
  console.log();
  console.log(`Of ${missing.toLocaleString()} missing markets:`);
  console.log(`  Likely RESOLVED (recoverable):   ~${estimatedResolved.toLocaleString()} (${(100*resolved/20).toFixed(0)}%)`);
  console.log(`  Likely UNRESOLVED (still open):  ~${estimatedUnresolved.toLocaleString()} (${(100*unresolved/20).toFixed(0)}%)`);
  console.log(`  Likely NOT FOUND (deleted):      ~${estimatedNotFound.toLocaleString()} (${(100*notFound/20).toFixed(0)}%)`);
  console.log();

  const maxPossibleCoverage = (100 * (withRes.with_resolutions + estimatedResolved) / traded.total_traded).toFixed(1);

  console.log('MAXIMUM ACHIEVABLE COVERAGE:');
  console.log(`  Current coverage:    ${coveragePct}%`);
  console.log(`  Maximum possible:    ~${maxPossibleCoverage}%`);
  console.log(`  Improvement potential: +${(parseFloat(maxPossibleCoverage) - parseFloat(coveragePct)).toFixed(1)}%`);
  console.log();

  // Step 6: Final diagnosis
  console.log('═'.repeat(80));
  console.log('FINAL DIAGNOSIS');
  console.log('═'.repeat(80));
  console.log();

  if (resolved > 5) {
    console.log('🚨 SMOKING GUN:');
    console.log(`   ${(100*resolved/20).toFixed(0)}% of missing markets ARE RESOLVED in the API!`);
    console.log('   This means we can recover substantial coverage via API backfill!');
    console.log();
    console.log('RECOMMENDED ACTION:');
    console.log('   Run targeted API backfill for the ~171K missing condition IDs');
    console.log(`   Expected recovery: ~${estimatedResolved.toLocaleString()} markets`);
    console.log(`   New coverage target: ~${maxPossibleCoverage}%`);
  } else {
    console.log('✅ CONFIRMED:');
    console.log('   Most missing markets are either unresolved or deleted.');
    console.log(`   Current ${coveragePct}% coverage is close to maximum achievable.`);
    console.log();
    console.log('EXPLANATION:');
    console.log('   - You CANNOT calculate P&L for unresolved markets (still open)');
    console.log('   - Deleted markets were likely spam or test markets');
    console.log('   - Current coverage is sufficient for P&L calculations');
  }

  await client.close();
}

main().catch(console.error);
