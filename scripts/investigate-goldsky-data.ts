#!/usr/bin/env tsx
/**
 * Investigate why Goldsky only has 8,685 resolved conditions
 * when Dune Analytics shows 130-150K
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const GOLDSKY_ENDPOINT =
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function investigate() {
  console.log('🔍 INVESTIGATING GOLDSKY DATA DISCREPANCY\n');

  // 1. Check what we actually got
  console.log('1️⃣ Checking resolutions_external_ingest...');
  const externalResult = await ch.query({
    query: `
      SELECT
        count() as total,
        count(DISTINCT condition_id) as unique_conditions,
        min(resolved_at) as earliest,
        max(resolved_at) as latest
      FROM default.resolutions_external_ingest
    `,
    format: 'JSONEachRow',
  });
  const externalData = await externalResult.json<any>();
  console.log('   External ingest:', externalData[0]);

  // 2. Check market_resolutions_final for comparison
  console.log('\n2️⃣ Checking market_resolutions_final...');
  const marketResult = await ch.query({
    query: `
      SELECT
        count() as total,
        count(DISTINCT condition_id_norm) as unique_conditions,
        min(resolved_at) as earliest,
        max(resolved_at) as latest
      FROM default.market_resolutions_final
      WHERE length(payout_numerators) > 0
    `,
    format: 'JSONEachRow',
  });
  const marketData = await marketResult.json<any>();
  console.log('   Market resolutions final:', marketData[0]);

  // 3. Check overlap
  console.log('\n3️⃣ Checking overlap...');
  const overlapResult = await ch.query({
    query: `
      SELECT count() as overlap_count
      FROM default.resolutions_external_ingest e
      INNER JOIN default.market_resolutions_final m
        ON e.condition_id = m.condition_id_norm
    `,
    format: 'JSONEachRow',
  });
  const overlapData = await overlapResult.json<any>();
  console.log('   Overlap (same conditions in both tables):', overlapData[0].overlap_count);

  // 4. Check unique to each source
  console.log('\n4️⃣ Checking unique conditions...');
  const uniqueExternal = await ch.query({
    query: `
      SELECT count() as unique_to_external
      FROM default.resolutions_external_ingest e
      LEFT JOIN default.market_resolutions_final m
        ON e.condition_id = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
    `,
    format: 'JSONEachRow',
  });
  const uniqueExternalData = await uniqueExternal.json<any>();
  console.log('   Unique to Goldsky:', uniqueExternalData[0].unique_to_external);

  const uniqueMarket = await ch.query({
    query: `
      SELECT count() as unique_to_market
      FROM default.market_resolutions_final m
      LEFT JOIN default.resolutions_external_ingest e
        ON m.condition_id_norm = e.condition_id
      WHERE e.condition_id IS NULL
        AND length(m.payout_numerators) > 0
    `,
    format: 'JSONEachRow',
  });
  const uniqueMarketData = await uniqueMarket.json<any>();
  console.log('   Unique to market_resolutions_final:', uniqueMarketData[0].unique_to_market);

  // 5. Test Goldsky API directly for total count
  console.log('\n5️⃣ Testing Goldsky API pagination limits...');
  try {
    // Test if we can skip beyond 8685
    const query = `{
      conditions(
        first: 100
        skip: 8685
        where: {payouts_not: null}
        orderBy: id
        orderDirection: asc
      ) {
        id
      }
    }`;

    const response = await fetch(GOLDSKY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const result = await response.json();
    if (result.data?.conditions) {
      console.log(`   Can skip to 8685: ${result.data.conditions.length > 0 ? 'YES' : 'NO'}`);
      console.log(`   Found ${result.data.conditions.length} more conditions after skip=8685`);
    }
  } catch (e: any) {
    console.log('   Error testing pagination:', e.message);
  }

  // 6. Summary
  console.log('\n📊 SUMMARY:');
  const totalUnique =
    externalData[0].unique_conditions +
    uniqueMarketData[0].unique_to_market;
  console.log(`   Total unique payouts across both sources: ${totalUnique}`);
  console.log(`   Expected from Dune Analytics: 130,000 - 150,000`);
  console.log(`   Gap: ${150000 - totalUnique} payouts still missing`);

  await ch.close();
}

investigate().catch(console.error);
