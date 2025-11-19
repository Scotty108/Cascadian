import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FINAL BRIDGE CHECK: Finding Market IDs for Missing CTF IDs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const missingCtfs = [
    '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
    '00d83a0c96a8f37f914ea3e2dbda3149446ee40b3127f7a144cec584ae195d22',
    '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af'
  ];

  // Try condition_market_map
  console.log('1. Checking condition_market_map:\n');

  for (const ctf of missingCtfs) {
    const noLeadingZeros = ctf.replace(/^0+/, '');

    const checkQuery = await clickhouse.query({
      query: `
        SELECT condition_id, market_id
        FROM condition_market_map
        WHERE lower(condition_id) IN (lower('${ctf}'), lower('${noLeadingZeros}'))
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const result = await checkQuery.json();

    if (result.length > 0) {
      console.log(`✅ FOUND: ${ctf.substring(0, 20)}...`);
      console.log(`   Market ID: ${result[0].market_id}\n`);
    } else {
      console.log(`❌ NOT FOUND: ${ctf.substring(0, 20)}...\n`);
    }
  }

  // Try erc1155_condition_map
  console.log('2. Checking erc1155_condition_map:\n');

  for (const ctf of missingCtfs) {
    const noLeadingZeros = ctf.replace(/^0+/, '');

    const checkQuery = await clickhouse.query({
      query: `
        SELECT condition_id, market_address, token_id
        FROM erc1155_condition_map
        WHERE lower(condition_id) IN (lower('${ctf}'), lower('${noLeadingZeros}'))
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const result = await checkQuery.json();

    if (result.length > 0) {
      console.log(`✅ FOUND: ${ctf.substring(0, 20)}...`);
      console.log(`   Market address: ${result[0].market_address}`);
      console.log(`   Token ID: ${result[0].token_id.substring(0, 40)}...\n`);
    } else {
      console.log(`❌ NOT FOUND: ${ctf.substring(0, 20)}...\n`);
    }
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CONCLUSION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('If none of the above tables have these CTF IDs, then:');
  console.log('   1. These are truly ERC1155-only tokens (never traded on CLOB)');
  console.log('   2. They weren\'t ingested from any existing data pipeline');
  console.log('   3. We need to backfill from external source (Polymarket API)\n');

  console.log('RECOMMENDATION:');
  console.log('   Run the redemption value calculation WITH ONLY THE 2 CTF IDs');
  console.log('   that DO have resolution data, then report the gap to user.\n');
  console.log('   User can decide whether to backfill the remaining 8 CTF IDs.\n');
}

main().catch(console.error);
