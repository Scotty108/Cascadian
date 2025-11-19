import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function tokenFormatAnalysis() {
  console.log('\n🔍 TOKEN FORMAT ANALYSIS\n');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Sample asset_ids from clob_fills:\n');

  const clobSampleQuery = `
    SELECT DISTINCT asset_id
    FROM clob_fills
    WHERE asset_id != ''
    LIMIT 10
  `;

  const clobSampleResult = await clickhouse.query({
    query: clobSampleQuery,
    format: 'JSONEachRow'
  });
  const clobSamples = await clobSampleResult.json();

  console.log('   clob_fills.asset_id format:');
  clobSamples.forEach((row: any, i: number) => {
    const aid = row.asset_id;
    console.log(`   ${i+1}. Length: ${aid.length}, Prefix: ${aid.substring(0, 10)}..., Format: ${aid.match(/^0x/) ? 'hex' : 'decimal'}`);
  });

  console.log('\n2️⃣ Sample token_ids from erc1155_transfers:\n');

  const erc1155SampleQuery = `
    SELECT DISTINCT token_id
    FROM erc1155_transfers
    WHERE token_id != ''
    LIMIT 10
  `;

  const erc1155SampleResult = await clickhouse.query({
    query: erc1155SampleQuery,
    format: 'JSONEachRow'
  });
  const erc1155Samples = await erc1155SampleResult.json();

  console.log('   erc1155_transfers.token_id format:');
  erc1155Samples.forEach((row: any, i: number) => {
    const tid = row.token_id;
    console.log(`   ${i+1}. Length: ${tid.length}, Value: ${tid.substring(0, 66)}...`);
  });

  console.log('\n3️⃣ Sample token_ids from ctf_token_map:\n');

  const ctfSampleQuery = `
    SELECT DISTINCT token_id
    FROM ctf_token_map
    WHERE token_id != ''
    LIMIT 10
  `;

  const ctfSampleResult = await clickhouse.query({
    query: ctfSampleQuery,
    format: 'JSONEachRow'
  });
  const ctfSamples = await ctfSampleResult.json();

  console.log('   ctf_token_map.token_id format:');
  ctfSamples.forEach((row: any, i: number) => {
    const tid = row.token_id;
    console.log(`   ${i+1}. Length: ${tid.length}, Prefix: ${tid.substring(0, 10)}..., Format: ${tid.match(/^0x/) ? 'hex' : 'decimal'}`);
  });

  console.log('\n4️⃣ Testing direct join (erc1155_transfers.token_id = clob_fills.asset_id):\n');

  const directJoinQuery = `
    SELECT count() as match_count
    FROM clob_fills cf
    INNER JOIN erc1155_transfers et ON cf.asset_id = et.token_id
    WHERE cf.asset_id != ''
    LIMIT 1
  `;

  try {
    const directJoinResult = await clickhouse.query({
      query: directJoinQuery,
      format: 'JSONEachRow'
    });
    const directJoin = await directJoinResult.json();
    console.log(`   Direct join matches: ${directJoin[0].match_count}`);
  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n5️⃣ Testing conversion: hex(toUInt256(erc1155.token_id)) = clob_fills.asset_id:\n');

  const conversionTestQuery = `
    SELECT
      et.token_id as erc1155_token,
      lower(hex(toUInt256OrZero(et.token_id))) as erc1155_as_hex,
      cf.asset_id as clob_asset,
      erc1155_as_hex = clob_asset as matches
    FROM erc1155_transfers et
    INNER JOIN clob_fills cf ON lower(hex(toUInt256OrZero(et.token_id))) = cf.asset_id
    WHERE et.token_id != ''
      AND cf.asset_id != ''
    LIMIT 5
  `;

  try {
    const conversionResult = await clickhouse.query({
      query: conversionTestQuery,
      format: 'JSONEachRow'
    });
    const conversion = await conversionResult.json();

    if (conversion.length > 0) {
      console.log('   ✅ MATCH FOUND with conversion!\n');
      console.table(conversion);
    } else {
      console.log('   ❌ No matches with conversion');
    }
  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n6️⃣ Count potential matches with conversion:\n');

  const countMatchesQuery = `
    SELECT
      countIf(cf.asset_id IN (
        SELECT DISTINCT lower(hex(toUInt256OrZero(token_id)))
        FROM erc1155_transfers
        WHERE token_id != ''
      )) as matched_fills,
      count() as total_fills,
      round(matched_fills / total_fills * 100, 2) as match_pct
    FROM clob_fills cf
    WHERE cf.asset_id != ''
  `;

  try {
    const countResult = await clickhouse.query({
      query: countMatchesQuery,
      format: 'JSONEachRow'
    });
    const count = await countResult.json();

    console.log(`   Matched fills: ${parseInt(count[0].matched_fills).toLocaleString()}`);
    console.log(`   Total fills: ${parseInt(count[0].total_fills).toLocaleString()}`);
    console.log(`   Match rate: ${count[0].match_pct}%`);
  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 CONCLUSION:\n');
  console.log('Will use conversion: lower(hex(toUInt256(erc1155.token_id))) = clob_fills.asset_id\n');
}

tokenFormatAnalysis().catch(console.error);
