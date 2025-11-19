/**
 * DIAGNOSE JOIN FAILURE
 *
 * Why can't we join clob_fills to erc1155_transfers?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSE JOIN FAILURE');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check 1: How many fills do we have?
  console.log('📊 Checking clob_fills...\n');

  const fillsCountQuery = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM clob_fills
      WHERE proxy_wallet = '${TARGET_WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const fillsCount: any = (await fillsCountQuery.json())[0];
  console.log(`Total fills: ${fillsCount.count}\n`);

  // Check 2: How many ERC1155 transfers for this wallet?
  console.log('📊 Checking erc1155_transfers...\n');

  const transfersCountQuery = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM erc1155_transfers
      WHERE from_address = '${TARGET_WALLET}'
         OR to_address = '${TARGET_WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const transfersCount: any = (await transfersCountQuery.json())[0];
  console.log(`Total ERC1155 transfers: ${transfersCount.count}\n`);

  // Check 3: Sample tx_hash from each table
  console.log('📊 Sample tx_hashes from clob_fills:\n');

  const sampleFillsQuery = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        timestamp,
        asset_id,
        side
      FROM clob_fills
      WHERE proxy_wallet = '${TARGET_WALLET}'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const sampleFills: any[] = await sampleFillsQuery.json();
  for (const f of sampleFills) {
    console.log(`  ${f.tx_hash} (${f.timestamp})`);
  }

  console.log('\n📊 Sample tx_hashes from erc1155_transfers:\n');

  const sampleTransfersQuery = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        block_timestamp,
        token_id,
        from_address,
        to_address
      FROM erc1155_transfers
      WHERE from_address = '${TARGET_WALLET}'
         OR to_address = '${TARGET_WALLET}'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const sampleTransfers: any[] = await sampleTransfersQuery.json();
  for (const t of sampleTransfers) {
    console.log(`  ${t.tx_hash} (${t.block_timestamp})`);
    console.log(`    from: ${t.from_address}`);
    console.log(`    to: ${t.to_address}\n`);
  }

  // Check 4: Try to find ANY matching tx_hash
  console.log('🔍 Checking for tx_hash overlap...\n');

  const overlapQuery = await clickhouse.query({
    query: `
      SELECT COUNT(*) as overlap_count
      FROM clob_fills f
      INNER JOIN erc1155_transfers e
        ON f.tx_hash = e.tx_hash
      WHERE f.proxy_wallet = '${TARGET_WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const overlap: any = (await overlapQuery.json())[0];
  console.log(`Fills with matching tx_hash: ${overlap.overlap_count}\n`);

  if (overlap.overlap_count === 0) {
    console.log('❌ ZERO OVERLAP - tx_hash does not match between tables\n');
    console.log('Possible causes:');
    console.log('  1. clob_fills contains API-level transaction IDs');
    console.log('  2. erc1155_transfers contains blockchain transaction hashes');
    console.log('  3. Different data sources (CLOB API vs blockchain indexer)\n');
  }

  // Check 5: What ARE the asset_ids in clob_fills?
  console.log('📊 Checking asset_id format in clob_fills...\n');

  const assetIdsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        asset_id,
        length(asset_id) as id_length
      FROM clob_fills
      WHERE proxy_wallet = '${TARGET_WALLET}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const assetIds: any[] = await assetIdsQuery.json();
  console.log('Sample asset_ids:\n');
  for (const a of assetIds) {
    console.log(`  ${a.asset_id} (${a.id_length} chars)`);
  }

  // Check 6: Can we find THESE asset_ids as token_ids in ERC1155?
  console.log('\n🔍 Checking if asset_ids exist as token_ids...\n');

  let found = 0;
  for (const a of assetIds.slice(0, 5)) {
    // Convert decimal asset_id to hex
    const hex = BigInt(a.asset_id).toString(16);
    const token_id_hex = '0x' + hex.padStart(64, '0');

    const checkQuery = await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM erc1155_transfers
        WHERE token_id = '${token_id_hex}'
      `,
      format: 'JSONEachRow'
    });

    const check: any = (await checkQuery.json())[0];

    if (check.count > 0) {
      console.log(`  ✅ ${token_id_hex.substring(0, 20)}... found (${check.count} transfers)`);
      found++;
    } else {
      console.log(`  ❌ ${token_id_hex.substring(0, 20)}... NOT found`);
    }
  }

  console.log(`\nFound ${found}/${assetIds.slice(0, 5).length} asset_ids as token_ids\n`);

  // Check 7: If asset_id IS token_id, we can decode directly!
  if (found > 0) {
    console.log('✅ BREAKTHROUGH: asset_id appears to BE the token_id (as decimal)!\n');
    console.log('This means:');
    console.log('  1. We do NOT need to join to erc1155_transfers');
    console.log('  2. We CAN decode asset_id directly');
    console.log('  3. BUT the outcome_index we saw before was wrong\n');

    console.log('Testing decode on sample asset_id:\n');

    const sampleAssetId = assetIds[0].asset_id;
    console.log(`Sample asset_id: ${sampleAssetId}\n`);

    // Convert to hex
    const hex = BigInt(sampleAssetId).toString(16);
    const token_id_hex = '0x' + hex.padStart(64, '0');

    console.log(`Converted to hex: ${token_id_hex}\n`);

    // Decode
    const decodeQuery = await clickhouse.query({
      query: `
        SELECT
          lpad(lower(hex(bitShiftRight(toUInt256('${token_id_hex}'), 8))), 64, '0') as condition_id,
          toUInt8(bitAnd(toUInt256('${token_id_hex}'), 255)) as outcome_index
      `,
      format: 'JSONEachRow'
    });

    const decoded: any = (await decodeQuery.json())[0];
    console.log(`Decoded condition_id: ${decoded.condition_id}`);
    console.log(`Decoded outcome_index: ${decoded.outcome_index}\n`);

    // Check resolution
    const resQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          outcome_count,
          payout_numerators
        FROM market_resolutions_final
        WHERE condition_id_norm = '${decoded.condition_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const res: any[] = await resQuery.json();
    if (res.length > 0) {
      console.log('✅ Resolution found!');
      console.log(`  Outcome count: ${res[0].outcome_count}`);
      console.log(`  Payout array: ${JSON.stringify(res[0].payout_numerators)}`);
      console.log(`  Outcome index: ${decoded.outcome_index}`);

      if (decoded.outcome_index < res[0].outcome_count) {
        console.log(`  ✅ Outcome index VALID\n`);
      } else {
        console.log(`  ❌ Outcome index OUT OF RANGE\n`);
      }
    } else {
      console.log('❌ Resolution NOT found\n');
    }
  }

  console.log('✅ DIAGNOSIS COMPLETE\n');
}

main().catch(console.error);
