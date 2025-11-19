#!/usr/bin/env npx tsx

/**
 * Patch gamma_markets with Missing Markets
 *
 * Purpose: Discover all condition_id/token_id pairs in clob_fills that are
 *          missing from gamma_markets and insert them.
 *
 * Why: Goldsky ingestion queries by token_id from gamma_markets. If a market
 *      isn't in gamma_markets, it will never be queried and fills are lost.
 *
 * Runtime: ~30 seconds to 2 minutes depending on data volume
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from '../lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('GAMMA_MARKETS PATCH - RECOVER MISSING MARKETS');
  console.log('='.repeat(80));
  console.log('');

  try {
    // Step 1: Check current state
    console.log('Step 1: Analyzing current coverage...');
    console.log('-'.repeat(80));

    const beforeGammaResult = await client.query({
      query: 'SELECT COUNT(*) as count FROM gamma_markets',
      format: 'JSONEachRow'
    });
    const beforeGammaData = await beforeGammaResult.json<{ count: string }[]>();
    const beforeGammaCount = parseInt(beforeGammaData[0].count);
    console.log(`  gamma_markets rows: ${beforeGammaCount.toLocaleString()}`);

    const beforeClobResult = await client.query({
      query: 'SELECT COUNT(DISTINCT condition_id) as count FROM clob_fills',
      format: 'JSONEachRow'
    });
    const beforeClobData = await beforeClobResult.json<{ count: string }[]>();
    const beforeClobCount = parseInt(beforeClobData[0].count);
    console.log(`  Unique markets in clob_fills: ${beforeClobCount.toLocaleString()}`);

    // Step 2: Count missing markets
    console.log('');
    console.log('Step 2: Identifying missing markets...');
    console.log('-'.repeat(80));

    const missingResult = await client.query({
      query: `
        SELECT COUNT(*) as missing_count
        FROM (
          SELECT DISTINCT condition_id
          FROM clob_fills
          WHERE condition_id NOT IN (
            SELECT condition_id FROM gamma_markets
          )
        )
      `,
      format: 'JSONEachRow'
    });
    const missingData = await missingResult.json<{ missing_count: string }[]>();
    const missingCount = parseInt(missingData[0].missing_count);

    console.log(`  Markets in clob_fills but NOT in gamma_markets: ${missingCount.toLocaleString()}`);
    console.log(`  Coverage gap: ${(missingCount / beforeClobCount * 100).toFixed(1)}%`);

    if (missingCount === 0) {
      console.log('');
      console.log('✅ No missing markets found - gamma_markets is complete!');
      console.log('');
      await client.close();
      return;
    }

    // Step 3: Sample missing markets
    console.log('');
    console.log('Step 3: Sampling missing markets...');
    console.log('-'.repeat(80));

    const sampleResult = await client.query({
      query: `
        SELECT
          cf.condition_id,
          cf.asset_id as token_id,
          COUNT(*) as fill_count,
          SUM(abs(price * size / 1000000)) as volume
        FROM clob_fills cf
        WHERE cf.condition_id NOT IN (
          SELECT condition_id FROM gamma_markets
        )
        GROUP BY cf.condition_id, cf.asset_id
        ORDER BY fill_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json<any[]>();

    console.log('  Top 10 missing markets by fill count:');
    samples.forEach((s, idx) => {
      console.log(`    ${idx + 1}. ${s.condition_id.slice(0, 12)}... - ${s.fill_count} fills, $${parseFloat(s.volume).toLocaleString()} volume`);
    });

    // Step 4: Execute patch
    console.log('');
    console.log('Step 4: Patching gamma_markets...');
    console.log('-'.repeat(80));

    console.log(`  Inserting ${missingCount.toLocaleString()} missing markets...`);

    const insertStartTime = Date.now();
    await client.exec({
      query: `
        INSERT INTO gamma_markets (
          condition_id,
          token_id,
          question,
          description,
          outcome,
          outcomes_json,
          end_date,
          category,
          tags_json,
          closed,
          archived,
          fetched_at
        )
        SELECT DISTINCT
          cf.condition_id,
          cf.asset_id as token_id,
          'Recovered from clob_fills' as question,
          '' as description,
          '' as outcome,
          '[]' as outcomes_json,
          '2099-12-31' as end_date,
          'Unknown' as category,
          '[]' as tags_json,
          0 as closed,
          0 as archived,
          now() as fetched_at
        FROM clob_fills cf
        WHERE cf.condition_id NOT IN (
          SELECT condition_id FROM gamma_markets
        )
      `
    });
    const insertDuration = Date.now() - insertStartTime;

    console.log(`  ✅ Insert completed in ${(insertDuration / 1000).toFixed(1)}s`);

    // Step 5: Verify patch
    console.log('');
    console.log('Step 5: Verifying patch...');
    console.log('-'.repeat(80));

    const afterGammaResult = await client.query({
      query: 'SELECT COUNT(*) as count FROM gamma_markets',
      format: 'JSONEachRow'
    });
    const afterGammaData = await afterGammaResult.json<{ count: string }[]>();
    const afterGammaCount = parseInt(afterGammaData[0].count);

    const afterMissingResult = await client.query({
      query: `
        SELECT COUNT(*) as missing_count
        FROM (
          SELECT DISTINCT condition_id
          FROM clob_fills
          WHERE condition_id NOT IN (
            SELECT condition_id FROM gamma_markets
          )
        )
      `,
      format: 'JSONEachRow'
    });
    const afterMissingData = await afterMissingResult.json<{ missing_count: string }[]>();
    const afterMissingCount = parseInt(afterMissingData[0].missing_count);

    console.log(`  gamma_markets rows: ${beforeGammaCount.toLocaleString()} → ${afterGammaCount.toLocaleString()} (+${(afterGammaCount - beforeGammaCount).toLocaleString()})`);
    console.log(`  Missing markets: ${missingCount.toLocaleString()} → ${afterMissingCount.toLocaleString()}`);

    if (afterMissingCount === 0) {
      console.log(`  ✅ SUCCESS: All markets now cataloged!`);
    } else {
      console.log(`  ⚠️  ${afterMissingCount} markets still missing (possible race condition)`);
    }

    // Step 6: Calculate coverage improvement
    console.log('');
    console.log('Step 6: Coverage analysis...');
    console.log('-'.repeat(80));

    const coverageResult = await client.query({
      query: `
        SELECT
          (SELECT COUNT(DISTINCT condition_id) FROM clob_fills) as total_markets_in_fills,
          (SELECT COUNT(*) FROM gamma_markets) as total_markets_in_gamma,
          (SELECT COUNT(DISTINCT condition_id) FROM clob_fills
           WHERE condition_id IN (SELECT condition_id FROM gamma_markets)) as covered_markets
      `,
      format: 'JSONEachRow'
    });
    const coverageData = await coverageResult.json<any[]>();
    const coverage = coverageData[0];

    const coveragePct = (parseInt(coverage.covered_markets) / parseInt(coverage.total_markets_in_fills) * 100).toFixed(1);

    console.log(`  Total markets with fills: ${parseInt(coverage.total_markets_in_fills).toLocaleString()}`);
    console.log(`  Markets now in gamma_markets: ${parseInt(coverage.total_markets_in_gamma).toLocaleString()}`);
    console.log(`  Coverage: ${coveragePct}%`);

    // Summary
    console.log('');
    console.log('='.repeat(80));
    console.log('PATCH COMPLETE');
    console.log('='.repeat(80));
    console.log('');
    console.log('📊 Summary:');
    console.log(`  • Discovered ${missingCount.toLocaleString()} missing markets`);
    console.log(`  • Inserted into gamma_markets`);
    console.log(`  • Coverage: ${coveragePct}%`);
    console.log('');
    console.log('✅ Next Steps:');
    console.log('  1. Re-run Goldsky ingestion to fetch fills for newly discovered markets');
    console.log('  2. Command: RESUME_FROM_MARKET=171008 WORKER_COUNT=8 npx tsx scripts/ingest-goldsky-fills-parallel.ts');
    console.log('  3. Expected: 5-10M additional fills');
    console.log('  4. ETA: 4-6 hours');
    console.log('');

    await client.close();

  } catch (error) {
    console.error('\n❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
