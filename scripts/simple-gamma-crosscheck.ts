#!/usr/bin/env tsx
/**
 * Simple cross-check: Gamma closed markets vs existing resolutions
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

async function simpleCheck() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GAMMA API → RESOLUTION DATA CROSS-CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Count closed markets from Gamma
    console.log('1️⃣  Gamma API closed markets:\n');
    const gammaResult = await ch.query({
      query: `
        SELECT
          count() as closed_count,
          count(DISTINCT condition_id) as unique_conditions
        FROM default.api_markets_staging
        WHERE closed = true
      `,
      format: 'JSONEachRow'
    });
    const gamma = await gammaResult.json();
    console.log(`Closed markets: ${parseInt(gamma[0].closed_count).toLocaleString()}`);
    console.log(`Unique conditions: ${parseInt(gamma[0].unique_conditions).toLocaleString()}\n`);

    // Step 2: Count existing resolutions
    console.log('2️⃣  Existing resolution data:\n');
    const resolutionsResult = await ch.query({
      query: `
        SELECT count(DISTINCT condition_id) as count, 'market_resolutions_final' as source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT count(DISTINCT condition_id) as count, 'resolutions_external_ingest' as source
        FROM default.resolutions_external_ingest
      `,
      format: 'JSONEachRow'
    });
    const resolutions = await resolutionsResult.json();
    resolutions.forEach((r: any) => {
      console.log(`${r.source}: ${parseInt(r.count).toLocaleString()}`);
    });
    console.log('');

    // Step 3: Find matches (closed markets that have resolution data)
    console.log('3️⃣  Matching (closed + have resolution data):\n');
    const matchesResult = await ch.query({
      query: `
        SELECT count(DISTINCT g.condition_id) as match_count
        FROM default.api_markets_staging g
        WHERE g.closed = true
          AND (
            EXISTS (
              SELECT 1 FROM default.market_resolutions_final r
              WHERE lower(replaceAll(r.condition_id, '0x', '')) = g.condition_id
            )
            OR EXISTS (
              SELECT 1 FROM default.resolutions_external_ingest r
              WHERE lower(replaceAll(r.condition_id, '0x', '')) = g.condition_id
            )
          )
      `,
      format: 'JSONEachRow'
    });
    const matches = await matchesResult.json();
    const matchCount = parseInt(matches[0].match_count);
    console.log(`Markets with both (closed + resolution data): ${matchCount.toLocaleString()}\n`);

    // Step 4: Calculate gap
    const closedCount = parseInt(gamma[0].closed_count);
    const missingCount = closedCount - matchCount;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    const coveragePct = ((matchCount / closedCount) * 100).toFixed(2);

    console.log(`📊 Gamma API Coverage:`);
    console.log(`   Closed markets: ${closedCount.toLocaleString()}`);
    console.log(`   With resolution data: ${matchCount.toLocaleString()} (${coveragePct}%)`);
    console.log(`   Missing resolution data: ${missingCount.toLocaleString()} (${(100 - parseFloat(coveragePct)).toFixed(2)}%)\n`);

    if (matchCount >= 1000) {
      console.log(`✅ GOOD: ${matchCount.toLocaleString()} markets ready to export`);
      console.log(`   → Can immediately export to resolved-from-gamma.json\n`);
    }

    if (missingCount > 0) {
      console.log(`⚠️  NEED: ${missingCount.toLocaleString()} closed markets need resolution backfill`);
      console.log(`   → Require API calls or blockchain lookups for payout data\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

simpleCheck();
