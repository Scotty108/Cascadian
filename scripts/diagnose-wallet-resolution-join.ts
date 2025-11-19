#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n═══ DIAGNOSING WALLET + RESOLUTION JOIN ═══\n');

  // Step 1: Check positions exist
  const pos = await ch.query({
    query: `SELECT count(*) as cnt FROM cascadian_clean.vw_positions_open WHERE lower(wallet) = lower('${wallet}')`,
    format: 'JSONEachRow',
  });
  const posData = await pos.json<any[]>();
  console.log(`1. Positions in vw_positions_open: ${posData[0].cnt}`);

  // Step 2: Check resolutions table
  const res = await ch.query({
    query: 'SELECT count(*) as cnt FROM cascadian_clean.vw_resolutions_unified',
    format: 'JSONEachRow',
  });
  const resData = await res.json<any[]>();
  console.log(`2. Resolutions in vw_resolutions_unified: ${resData[0].cnt}`);

  // Step 3: Sample market_cids from positions
  const samplePos = await ch.query({
    query: `SELECT market_cid, outcome FROM cascadian_clean.vw_positions_open WHERE lower(wallet) = lower('${wallet}') LIMIT 3`,
    format: 'JSONEachRow',
  });
  const samplePosData = await samplePos.json<any[]>();
  console.log(`\n3. Sample market_cids from positions:`);
  for (const row of samplePosData) {
    console.log(`   ${row.market_cid} (outcome ${row.outcome})`);
  }

  // Step 4: Sample cid_hex from resolutions
  const sampleRes = await ch.query({
    query: 'SELECT cid_hex FROM cascadian_clean.vw_resolutions_unified LIMIT 3',
    format: 'JSONEachRow',
  });
  const sampleResData = await sampleRes.json<any[]>();
  console.log(`\n4. Sample cid_hex from resolutions:`);
  for (const row of sampleResData) {
    console.log(`   ${row.cid_hex}`);
  }

  // Step 5: Try direct join
  const directJoin = await ch.query({
    query: `
      SELECT count(*) as cnt
      FROM cascadian_clean.vw_positions_open p
      INNER JOIN cascadian_clean.vw_resolutions_unified r
        ON p.market_cid = r.cid_hex
      WHERE lower(p.wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow',
  });
  const djData = await directJoin.json<any[]>();
  console.log(`\n5. Direct join (market_cid = cid_hex): ${djData[0].cnt} matches`);

  // Step 6: Check if positions' markets exist in resolutions
  const marketCheck = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT market_cid
        FROM cascadian_clean.vw_positions_open
        WHERE lower(wallet) = lower('${wallet}')
      )
      SELECT
        count(*) as total_markets,
        countIf(r.cid_hex IS NOT NULL) as found_in_resolutions
      FROM wallet_markets w
      LEFT JOIN cascadian_clean.vw_resolutions_unified r
        ON w.market_cid = r.cid_hex
    `,
    format: 'JSONEachRow',
  });
  const mcData = await marketCheck.json<any[]>();
  console.log(`\n6. Market-level check:`);
  console.log(`   Wallet has ${mcData[0].total_markets} unique markets`);
  console.log(`   Found in resolutions: ${mcData[0].found_in_resolutions}`);
  console.log(`   Coverage: ${(parseInt(mcData[0].found_in_resolutions) / parseInt(mcData[0].total_markets) * 100).toFixed(1)}%`);

  // Step 7: Check one specific market
  if (samplePosData.length > 0) {
    const testMarket = samplePosData[0].market_cid;
    const specificCheck = await ch.query({
      query: `
        SELECT count(*) as cnt
        FROM cascadian_clean.vw_resolutions_unified
        WHERE cid_hex = '${testMarket}'
      `,
      format: 'JSONEachRow',
    });
    const scData = await specificCheck.json<any[]>();
    console.log(`\n7. Specific market check (${testMarket.substring(0, 20)}...):`);
    console.log(`   Found in resolutions: ${scData[0].cnt > 0 ? 'YES' : 'NO'}`);
  }

  console.log('\n═'.repeat(40));
  console.log('DIAGNOSIS COMPLETE\n');

  await ch.close();
}

main().catch(console.error);
