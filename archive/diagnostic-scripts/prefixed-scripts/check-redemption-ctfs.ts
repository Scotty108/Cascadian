import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REDEMPTION CTF IDs vs RESOLUTION DATA');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get unique CTF IDs from redemptions
  const query = await clickhouse.query({
    query: `
      WITH redemptions AS (
        SELECT DISTINCT token_id
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
      )
      SELECT DISTINCT
        lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 62, '0') AS condition_id_ctf
      FROM redemptions
    `,
    format: 'JSONEachRow'
  });

  const redemptionCtfs: any[] = await query.json();

  console.log(`Unique CTF IDs from redemptions: ${redemptionCtfs.length}\n`);

  // Check each in token_per_share_payout
  let found = 0;
  let notFound = 0;

  console.log('Checking each redemption CTF ID:\n');

  for (const row of redemptionCtfs) {
    const ctfId = row.condition_id_ctf;

    const checkQuery = await clickhouse.query({
      query: `
        SELECT condition_id_ctf, length(coalesce(pps, [])) AS pps_len
        FROM token_per_share_payout
        WHERE condition_id_ctf = '${ctfId}'
      `,
      format: 'JSONEachRow'
    });
    const result = await checkQuery.json();

    if (result.length > 0 && result[0].pps_len > 0) {
      found++;
      console.log(`✅ ${ctfId.substring(0, 20)}... - HAS resolution data`);
    } else if (result.length > 0) {
      console.log(`⚠️  ${ctfId.substring(0, 20)}... - EXISTS but EMPTY pps array`);
    } else {
      notFound++;
      console.log(`❌ ${ctfId.substring(0, 20)}... - NOT FOUND in token_per_share_payout`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`   Found with data: ${found} / ${redemptionCtfs.length}`);
  console.log(`   Not found: ${notFound} / ${redemptionCtfs.length}`);
  console.log(`   Coverage: ${(found / redemptionCtfs.length * 100).toFixed(1)}%\n`);

  if (notFound > 0) {
    console.log('⚠️  ISSUE: Some redemption CTF IDs are missing from token_per_share_payout!\n');
    console.log('This means:');
    console.log('   1. These are positions the wallet acquired outside CLOB (direct transfers)');
    console.log('   2. The resolution data exists but not indexed properly');
    console.log('   3. Or the CTF ID decoding is incorrect\n');
  }

  // Cross-check: are any of these in wallet_token_flows?
  console.log('Cross-check: Are redemption CTF IDs in wallet_token_flows?\n');

  for (const row of redemptionCtfs.slice(0, 5)) {
    const ctfId = row.condition_id_ctf;

    const flowQuery = await clickhouse.query({
      query: `
        SELECT condition_id_ctf, net_shares
        FROM wallet_token_flows
        WHERE lower(wallet) = lower('${wallet}')
          AND condition_id_ctf = '${ctfId}'
      `,
      format: 'JSONEachRow'
    });
    const flow = await flowQuery.json();

    if (flow.length > 0) {
      console.log(`✅ ${ctfId.substring(0, 20)}... - IS in wallet_token_flows (${flow[0].net_shares} shares)`);
    } else {
      console.log(`❌ ${ctfId.substring(0, 20)}... - NOT in wallet_token_flows (acquired outside CLOB)`);
    }
  }

  console.log();
}

main().catch(console.error);
