import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('='.repeat(80));
  console.log('MIDPRICE BUG DIAGNOSIS');
  console.log('='.repeat(80));

  // 1. Check total midprices available
  console.log('\n1. MIDPRICE DATA AVAILABILITY:');
  const midpriceCountResult = await client.query({
    query: `
      SELECT
        count(*) as total_midprices,
        countIf(midprice > 0) as nonzero_midprices,
        min(last_updated) as oldest_update,
        max(last_updated) as newest_update
      FROM cascadian_clean.midprices_latest
    `,
    format: 'JSONEachRow',
  });
  const midpriceStats = await midpriceCountResult.json<any>();
  console.log(`  Total midprices: ${midpriceStats[0].total_midprices.toLocaleString()}`);
  console.log(`  Non-zero midprices: ${midpriceStats[0].nonzero_midprices.toLocaleString()}`);
  console.log(`  Oldest update: ${midpriceStats[0].oldest_update}`);
  console.log(`  Newest update: ${midpriceStats[0].newest_update}`);

  // 2. Sample midprices
  console.log('\n2. SAMPLE MIDPRICE DATA:');
  const sampleMidpricesResult = await client.query({
    query: `
      SELECT market_cid, midprice, last_updated
      FROM cascadian_clean.midprices_latest
      WHERE midprice > 0
      ORDER BY last_updated DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const sampleMidprices = await sampleMidpricesResult.json<any>();
  sampleMidprices.forEach((m: any) => {
    const cidShort = m.market_cid.slice(0, 20);
    console.log(`  ${cidShort}... | $${m.midprice} | ${m.last_updated}`);
  });

  // 3. Check wallet's open positions
  console.log('\n3. WALLET OPEN POSITIONS:');
  const posResult = await client.query({
    query: `
      SELECT
        p.market_cid,
        p.outcome,
        p.qty,
        p.avg_cost,
        p.midprice as view_midprice,
        length(p.market_cid) as cid_length
      FROM cascadian_clean.vw_positions_open p
      WHERE lower(p.wallet) = lower('${WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const positions = await posResult.json<any>();
  console.log(`  Found ${positions.length} open positions for wallet`);
  positions.forEach((p: any, i: number) => {
    const cidShort = p.market_cid.slice(0, 20);
    console.log(`  ${i+1}. ${cidShort}... | view_midprice: $${p.midprice} | cid_len: ${p.cid_length}`);
  });

  // 4. Try manual join - check if midprices exist for wallet's positions
  console.log('\n4. MANUAL JOIN TEST (positions WITH midprices):');
  const manualJoinResult = await client.query({
    query: `
      SELECT
        p.market_cid,
        p.qty,
        p.avg_cost,
        m.midprice as actual_midprice,
        m.last_updated,
        length(p.market_cid) as pos_cid_len,
        length(m.market_cid) as mid_cid_len
      FROM cascadian_clean.vw_positions_open p
      INNER JOIN cascadian_clean.midprices_latest m
        ON p.market_cid = m.market_cid
      WHERE lower(p.wallet) = lower('${WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const joined = await manualJoinResult.json<any>();
  console.log(`  Successfully joined: ${joined.length} positions`);
  joined.forEach((j: any, i: number) => {
    const cidShort = j.market_cid.slice(0, 20);
    console.log(`  ${i+1}. ${cidShort}... | actual_midprice: $${j.actual_midprice} | pos_len: ${j.pos_cid_len} | mid_len: ${j.mid_cid_len}`);
  });

  // 5. Check for CID format mismatch
  console.log('\n5. CONDITION_ID FORMAT CHECK:');
  const posCidFormatResult = await client.query({
    query: `
      SELECT DISTINCT
        market_cid,
        length(market_cid) as len,
        substring(market_cid, 1, 2) as prefix
      FROM cascadian_clean.vw_positions_open
      WHERE lower(wallet) = lower('${WALLET}')
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const posCidFormat = await posCidFormatResult.json<any>();
  console.log('\n  Positions CID format:');
  posCidFormat.forEach((c: any) => {
    console.log(`    "${c.market_cid}" | length: ${c.len} | prefix: "${c.prefix}"`);
  });

  const midCidFormatResult = await client.query({
    query: `
      SELECT DISTINCT
        market_cid,
        length(market_cid) as len,
        substring(market_cid, 1, 2) as prefix
      FROM cascadian_clean.midprices_latest
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const midCidFormat = await midCidFormatResult.json<any>();
  console.log('\n  Midprices CID format:');
  midCidFormat.forEach((c: any) => {
    console.log(`    "${c.market_cid}" | length: ${c.len} | prefix: "${c.prefix}"`);
  });

  // 6. Final diagnosis
  console.log('\n\n' + '='.repeat(80));
  console.log('ROOT CAUSE:');
  console.log('='.repeat(80));

  if (joined.length > 0) {
    console.log('✓ Midprices CAN join successfully with positions');
    console.log('⚠ ISSUE: The vw_positions_open view is NOT using the midprices_latest table correctly');
    console.log('  Fix: Update the view definition to properly join on midprices_latest');
  } else if (posCidFormat[0].prefix !== midCidFormat[0].prefix) {
    console.log('✗ CID FORMAT MISMATCH');
    console.log(`  Positions use: "${posCidFormat[0].prefix}..." prefix (length ${posCidFormat[0].len})`);
    console.log(`  Midprices use: "${midCidFormat[0].prefix}..." prefix (length ${midCidFormat[0].len})`);
    console.log('  Fix: Normalize CIDs before joining (remove/add 0x prefix)');
  } else {
    console.log('✗ No midprices found for any wallet positions');
    console.log('  This wallet may only have positions in very old/inactive markets');
  }

  await client.close();
}

main().catch(console.error);
