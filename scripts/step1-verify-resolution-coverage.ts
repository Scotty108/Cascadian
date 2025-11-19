#!/usr/bin/env tsx
/**
 * Step 1: Verify complete resolution coverage and refresh truth view
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000,
});

async function verifyAndRefresh() {
  console.log('================================================================================');
  console.log('📊 STEP 1: VERIFY RESOLUTION COVERAGE & REFRESH TRUTH VIEW');
  console.log('================================================================================\n');

  // 1. Check market_resolutions_final
  console.log('1️⃣ Checking market_resolutions_final...');
  const marketRes = await ch.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT condition_id_norm) as unique_conditions,
        countIf(length(payout_numerators) > 0) as with_payouts,
        min(resolved_at) as earliest,
        max(resolved_at) as latest
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow',
  });
  const marketData = await marketRes.json<any>();
  console.log('   Total rows:', marketData[0].total_rows);
  console.log('   Unique conditions:', marketData[0].unique_conditions);
  console.log('   With payouts:', marketData[0].with_payouts);
  console.log('   Date range:', marketData[0].earliest, 'to', marketData[0].latest);

  // 2. Check resolutions_external_ingest
  console.log('\n2️⃣ Checking resolutions_external_ingest...');
  const externalRes = await ch.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT condition_id) as unique_conditions,
        min(resolved_at) as earliest,
        max(resolved_at) as latest
      FROM default.resolutions_external_ingest
    `,
    format: 'JSONEachRow',
  });
  const externalData = await externalRes.json<any>();
  console.log('   Total rows:', externalData[0].total_rows);
  console.log('   Unique conditions:', externalData[0].unique_conditions);
  console.log('   Date range:', externalData[0].earliest, 'to', externalData[0].latest);

  // 3. Calculate total unique conditions
  console.log('\n3️⃣ Calculating total unique conditions across both tables...');
  const totalRes = await ch.query({
    query: `
      SELECT count(DISTINCT condition_id) as total_unique
      FROM (
        SELECT condition_id_norm as condition_id FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id FROM default.resolutions_external_ingest
      )
    `,
    format: 'JSONEachRow',
  });
  const totalData = await totalRes.json<any>();
  console.log('   Total unique conditions:', totalData[0].total_unique);
  console.log('   ✅ Status:', parseInt(totalData[0].total_unique) >= 130000 ? 'EXCEEDS DUNE BASELINE' : 'BELOW BASELINE');

  // 4. Check if vw_resolutions_truth exists
  console.log('\n4️⃣ Checking vw_resolutions_truth view...');
  try {
    const viewCheck = await ch.query({
      query: `SELECT count() as cnt FROM default.vw_resolutions_truth LIMIT 1`,
      format: 'JSONEachRow',
    });
    console.log('   ✅ View exists');

    // Check view coverage
    const viewCoverage = await ch.query({
      query: `
        SELECT
          count() as total_rows,
          count(DISTINCT condition_id_norm) as unique_conditions,
          countIf(source = 'blockchain') as from_blockchain,
          countIf(source = 'goldsky-api') as from_goldsky
        FROM default.vw_resolutions_truth
      `,
      format: 'JSONEachRow',
    });
    const viewData = await viewCoverage.json<any>();
    console.log('   View rows:', viewData[0].total_rows);
    console.log('   Unique conditions:', viewData[0].unique_conditions);
    console.log('   From blockchain:', viewData[0].from_blockchain);
    console.log('   From goldsky:', viewData[0].from_goldsky);
  } catch (e: any) {
    console.log('   ❌ View does not exist or is broken:', e.message);
    console.log('\n5️⃣ Creating vw_resolutions_truth view...');

    await ch.command({
      query: `
        CREATE OR REPLACE VIEW default.vw_resolutions_truth AS
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index,
          resolved_at,
          source,
          updated_at as fetched_at
        FROM default.market_resolutions_final
        WHERE length(payout_numerators) > 0

        UNION ALL

        SELECT
          condition_id as condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index,
          resolved_at,
          source,
          fetched_at
        FROM default.resolutions_external_ingest
      `,
    });

    console.log('   ✅ View created successfully');

    // Re-check coverage
    const newViewCoverage = await ch.query({
      query: `
        SELECT
          count() as total_rows,
          count(DISTINCT condition_id_norm) as unique_conditions
        FROM default.vw_resolutions_truth
      `,
      format: 'JSONEachRow',
    });
    const newViewData = await newViewCoverage.json<any>();
    console.log('   New view rows:', newViewData[0].total_rows);
    console.log('   Unique conditions:', newViewData[0].unique_conditions);
  }

  console.log('\n================================================================================');
  console.log('✅ STEP 1 COMPLETE - RESOLUTION COVERAGE VERIFIED');
  console.log('================================================================================');

  await ch.close();
}

verifyAndRefresh().catch(console.error);
