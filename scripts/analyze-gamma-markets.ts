#!/usr/bin/env tsx
/**
 * Analyze Gamma API markets to find resolved markets with payout data
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function analyzeMarkets() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GAMMA API MARKET ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // 1. Overall statistics
    console.log('1️⃣  OVERALL STATISTICS:\n');
    const statsResult = await ch.query({
      query: `
        SELECT
          count() as total_markets,
          countIf(active = true) as active_markets,
          countIf(closed = true) as closed_markets,
          countIf(resolved = true) as resolved_markets,
          countIf(closed = true AND resolved = false) as closed_but_not_resolved,
          count(DISTINCT condition_id) as unique_conditions
        FROM default.api_markets_staging
      `,
      format: 'JSONEachRow'
    });
    const stats = await statsResult.json();
    console.log(`Total markets: ${parseInt(stats[0].total_markets).toLocaleString()}`);
    console.log(`Active: ${parseInt(stats[0].active_markets).toLocaleString()}`);
    console.log(`Closed: ${parseInt(stats[0].closed_markets).toLocaleString()}`);
    console.log(`Resolved: ${parseInt(stats[0].resolved_markets).toLocaleString()}`);
    console.log(`Closed but not resolved: ${parseInt(stats[0].closed_but_not_resolved).toLocaleString()}`);
    console.log(`Unique conditions: ${parseInt(stats[0].unique_conditions).toLocaleString()}\n`);

    // 2. Check for markets with resolution data in our existing tables
    console.log('2️⃣  CROSS-CHECK WITH EXISTING RESOLUTION DATA:\n');
    const crossCheckResult = await ch.query({
      query: `
        WITH
        gamma_closed AS (
          SELECT DISTINCT condition_id
          FROM default.api_markets_staging
          WHERE closed = true
        ),
        existing_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as condition_id
          FROM default.market_resolutions_final
          UNION DISTINCT
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as condition_id
          FROM default.resolutions_external_ingest
        )
        SELECT
          (SELECT count() FROM gamma_closed) as gamma_closed_count,
          (SELECT count() FROM existing_resolutions) as existing_resolutions_count,
          count() as markets_with_both,
          (SELECT count() FROM gamma_closed) - count() as gamma_closed_missing_resolutions
        FROM gamma_closed g
        INNER JOIN existing_resolutions r ON g.condition_id = r.condition_id
      `,
      format: 'JSONEachRow'
    });
    const crossCheck = await crossCheckResult.json();
    console.log(`Gamma closed markets: ${parseInt(crossCheck[0].gamma_closed_count).toLocaleString()}`);
    console.log(`Markets with existing resolution data: ${parseInt(crossCheck[0].markets_with_both).toLocaleString()}`);
    console.log(`Gamma closed markets MISSING resolutions: ${parseInt(crossCheck[0].gamma_closed_missing_resolutions).toLocaleString()}\n`);

    // 3. Sample of closed markets that already have resolution data
    console.log('3️⃣  SAMPLE: Closed markets WITH resolution data (ready to export):\n');
    const sampleWithResResult = await ch.query({
      query: `
        WITH
        gamma_markets AS (
          SELECT
            condition_id,
            question,
            closed,
            resolved
          FROM default.api_markets_staging
          WHERE closed = true
        ),
        existing_resolutions AS (
          SELECT
            lower(replaceAll(condition_id, '0x', '')) as condition_id,
            payout_numerators,
            payout_denominator
          FROM default.market_resolutions_final
          UNION ALL
          SELECT
            lower(replaceAll(condition_id, '0x', '')) as condition_id,
            payout_numerators,
            payout_denominator
          FROM default.resolutions_external_ingest
        )
        SELECT
          substring(g.condition_id, 1, 16) as cid_short,
          substring(g.question, 1, 60) as question_short,
          g.closed,
          g.resolved,
          r.payout_numerators,
          r.payout_denominator
        FROM gamma_markets g
        INNER JOIN existing_resolutions r ON g.condition_id = r.condition_id
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sampleWith = await sampleWithResResult.json();
    sampleWith.forEach((row: any, i: number) => {
      console.log(`${i + 1}. ${row.cid_short}...`);
      console.log(`   Question: ${row.question_short}`);
      console.log(`   Closed: ${row.closed} | Resolved flag: ${row.resolved}`);
      console.log(`   Payout: [${row.payout_numerators}] / ${row.payout_denominator}\n`);
    });

    // 4. Sample of closed markets WITHOUT resolution data (need API fetch)
    console.log('4️⃣  SAMPLE: Closed markets WITHOUT resolution data (need backfill):\n');
    const sampleWithoutResResult = await ch.query({
      query: `
        WITH
        gamma_closed AS (
          SELECT
            condition_id,
            question,
            closed
          FROM default.api_markets_staging
          WHERE closed = true
        ),
        existing_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as condition_id
          FROM default.market_resolutions_final
          UNION DISTINCT
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as condition_id
          FROM default.resolutions_external_ingest
        )
        SELECT
          substring(g.condition_id, 1, 16) as cid_short,
          substring(g.question, 1, 60) as question_short,
          g.closed
        FROM gamma_closed g
        LEFT JOIN existing_resolutions r ON g.condition_id = r.condition_id
        WHERE r.condition_id IS NULL
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sampleWithout = await sampleWithoutResResult.json();
    sampleWithout.forEach((row: any, i: number) => {
      console.log(`${i + 1}. ${row.cid_short}...`);
      console.log(`   Question: ${row.question_short}`);
      console.log(`   Closed: ${row.closed}\n`);
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    const missingCount = parseInt(crossCheck[0].gamma_closed_missing_resolutions);
    const withDataCount = parseInt(crossCheck[0].markets_with_both);

    console.log(`✅ GOOD NEWS: ${withDataCount.toLocaleString()} closed markets already have resolution data`);
    console.log(`   → Can export these immediately to resolved-from-gamma.json`);
    console.log('');
    console.log(`⚠️  NEED BACKFILL: ${missingCount.toLocaleString()} closed markets missing resolution data`);
    console.log(`   → Need to fetch payout vectors from API or blockchain\n`);

  } catch (error) {
    console.error('❌ Error analyzing markets:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

analyzeMarkets();
