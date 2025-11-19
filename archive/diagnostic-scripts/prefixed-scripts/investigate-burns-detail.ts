import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const MISSING_CTFS = [
  '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
  '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
  '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
  '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
  '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('INVESTIGATE BURNS FOR MISSING CTFs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${WALLET}\n`);

  // First, let's check the schema of erc1155_transfers
  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE erc1155_transfers`,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaQuery.json();
  const hasCtfHex64 = schema.some(s => s.name === 'ctf_hex64');

  console.log('Table schema check:');
  console.log(`  Has ctf_hex64 column: ${hasCtfHex64}\n`);

  if (!hasCtfHex64) {
    console.log('Schema columns:');
    schema.forEach(s => console.log(`  ${s.name} (${s.type})`));
    console.log('\n❌ Table does not have ctf_hex64 column.\n');
    console.log('Will need to decode token_id to get CTF ID.\n');

    // Decode token_id approach
    const decodeQuery = await clickhouse.query({
      query: `
        SELECT
          lower(hex(bitShiftRight(CAST(token_id AS UInt256), 8))) AS ctf_hex64,
          token_id,
          value AS amount,
          block_timestamp,
          tx_hash AS transaction_hash,
          to_address AS to
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${WALLET}')
          AND lower(to_address) = '0x0000000000000000000000000000000000000000'
        ORDER BY block_timestamp DESC
        LIMIT 100
      `,
      format: 'JSONEachRow'
    });

    const allBurns: any[] = await decodeQuery.json();

    // Filter for our target CTFs
    const burns = allBurns.filter(b =>
      MISSING_CTFS.includes(b.ctf_hex64.padStart(64, '0'))
    );

    console.log(`Found ${burns.length} burns for these 5 CTF IDs (out of ${allBurns.length} total burns)\n`);

    if (burns.length === 0) {
      console.log('❌ No burns found for these specific CTFs.\n');
      return;
    }

    console.log('Burn details:\n');

    for (const burn of burns) {
      const ctfPadded = burn.ctf_hex64.padStart(64, '0');
      console.log(`CTF: ${ctfPadded.substring(0, 20)}...`);
      console.log(`   Token ID: ${burn.token_id}`);
      console.log(`   Amount: ${parseFloat(burn.amount).toLocaleString()}`);
      console.log(`   Date: ${new Date(burn.block_timestamp * 1000).toISOString()}`);
      console.log(`   To: ${burn.to}`);
      console.log(`   Tx: ${burn.transaction_hash}`);
      console.log();
    }

    return;
  }

  // Query burns for these CTF IDs
  const burnsQuery = await clickhouse.query({
    query: `
      SELECT
        ctf_hex64,
        token_id,
        amount,
        block_timestamp,
        transaction_hash,
        to_address
      FROM erc1155_transfers
      WHERE lower(from_address) = lower('${WALLET}')
        AND lower(to_address) = '0x0000000000000000000000000000000000000000'
        AND ctf_hex64 IN (${MISSING_CTFS.map(c => `'${c}'`).join(', ')})
      ORDER BY block_timestamp DESC
    `,
    format: 'JSONEachRow'
  });

  const burns: any[] = await burnsQuery.json();

  console.log(`Found ${burns.length} burns for these 5 CTF IDs\n`);

  if (burns.length === 0) {
    console.log('❌ No burns found. These CTFs may not belong to this wallet.\n');
    return;
  }

  console.log('Burn details:\n');

  for (const burn of burns) {
    console.log(`CTF: ${burn.ctf_hex64.substring(0, 20)}...`);
    console.log(`   Token ID: ${burn.token_id}`);
    console.log(`   Amount: ${parseFloat(burn.amount).toLocaleString()}`);
    console.log(`   Date: ${new Date(burn.block_timestamp * 1000).toISOString()}`);
    console.log(`   To: ${burn.to_address}`);
    console.log(`   Tx: ${burn.transaction_hash}`);
    console.log();
  }

  // Now check if these burns are in our redemption tracking
  console.log('Checking redemption tracking...\n');

  const redemptionsQuery = await clickhouse.query({
    query: `
      SELECT
        ctf_hex64,
        shares_burned,
        has_payout_data,
        redemption_value,
        condition_id_64
      FROM wallet_burns_by_ctf
      WHERE lower(wallet) = lower('${WALLET}')
        AND ctf_hex64 IN (${MISSING_CTFS.map(c => `'${c}'`).join(', ')})
    `,
    format: 'JSONEachRow'
  });

  const redemptions: any[] = await redemptionsQuery.json();

  console.log(`Found ${redemptions.length} redemption records\n`);

  if (redemptions.length > 0) {
    for (const r of redemptions) {
      console.log(`CTF: ${r.ctf_hex64.substring(0, 20)}...`);
      console.log(`   Shares burned: ${parseFloat(r.shares_burned).toLocaleString()}`);
      console.log(`   Has payout data: ${r.has_payout_data}`);
      console.log(`   Redemption value: $${parseFloat(r.redemption_value || 0).toLocaleString()}`);
      console.log(`   Condition ID: ${r.condition_id_64?.substring(0, 20) || 'NULL'}...`);
      console.log();
    }
  }

  // Check the bridge mapping for these CTFs
  console.log('Checking bridge mappings...\n');

  const bridgeQuery = await clickhouse.query({
    query: `
      SELECT
        ctf_hex64,
        market_hex64,
        source,
        vote_count
      FROM ctf_to_market_bridge_mat
      WHERE ctf_hex64 IN (${MISSING_CTFS.map(c => `'${c}'`).join(', ')})
    `,
    format: 'JSONEachRow'
  });

  const bridges: any[] = await bridgeQuery.json();

  console.log(`Found ${bridges.length} bridge mappings\n`);

  if (bridges.length > 0) {
    for (const b of bridges) {
      console.log(`CTF: ${b.ctf_hex64.substring(0, 20)}...`);
      console.log(`   Market: ${b.market_hex64.substring(0, 20)}...`);
      console.log(`   Same as CTF: ${b.ctf_hex64 === b.market_hex64 ? 'YES (identity fallback)' : 'NO (proper mapping)'}`);
      console.log(`   Source: ${b.source}`);
      console.log(`   Vote count: ${b.vote_count}`);
      console.log();
    }
  }

  // Check if there's resolution data for the market IDs
  console.log('Checking for resolution data...\n');

  const marketIds = bridges.map(b => b.market_hex64);

  if (marketIds.length > 0) {
    const resolutionsQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          resolved_at
        FROM market_resolutions_final
        WHERE condition_id_norm IN (${marketIds.map(m => `'${m}'`).join(', ')})
      `,
      format: 'JSONEachRow'
    });

    const resolutions: any[] = await resolutionsQuery.json();

    console.log(`Found ${resolutions.length} resolutions\n`);

    if (resolutions.length > 0) {
      for (const r of resolutions) {
        console.log(`Market: ${r.condition_id_norm.substring(0, 20)}...`);
        console.log(`   Payouts: ${r.payout_numerators}`);
        console.log(`   Denominator: ${r.payout_denominator}`);
        console.log(`   Resolved: ${r.resolved_at}`);
        console.log();
      }
    } else {
      console.log('❌ No resolution data found\n');
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CONCLUSION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (burns.length > 0 && redemptions.every(r => parseFloat(r.redemption_value || 0) === 0)) {
    console.log('These burns represent token discards, not redemptions:');
    console.log('- Wallet sent tokens to zero address');
    console.log('- No payout data exists (markets never resolved)');
    console.log('- No redemption value calculated\n');

    console.log('This explains the P&L gap:');
    console.log('- UI may count these as "potential winnings"');
    console.log('- Backend correctly shows $0 (no resolution data)');
    console.log('- Gap will persist until markets resolve (if ever)\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
