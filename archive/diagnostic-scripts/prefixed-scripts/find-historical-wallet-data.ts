/**
 * FIND HISTORICAL WALLET DATA
 *
 * Check if this wallet has earlier data in other tables
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIND HISTORICAL WALLET DATA');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check ERC1155 transfers (on-chain data should go back further)
  console.log('📊 Checking erc1155_transfers...\n');

  const erc1155Query = await clickhouse.query({
    query: `
      SELECT
        min(block_timestamp) as first_transfer,
        max(block_timestamp) as last_transfer,
        count(*) as total_transfers,
        count(DISTINCT token_id) as unique_tokens
      FROM erc1155_transfers
      WHERE from_address = '${TARGET_WALLET}'
         OR to_address = '${TARGET_WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const erc1155: any = (await erc1155Query.json())[0];

  if (erc1155.total_transfers > 0) {
    console.log(`✅ Found ERC1155 transfers!`);
    console.log(`  First: ${erc1155.first_transfer}`);
    console.log(`  Last: ${erc1155.last_transfer}`);
    console.log(`  Total: ${erc1155.total_transfers}`);
    console.log(`  Unique tokens: ${erc1155.unique_tokens}\n`);

    const firstERC = new Date(erc1155.first_transfer);
    const firstCLOB = new Date('2024-08-22');
    const gapDays = Math.floor((firstCLOB.getTime() - firstERC.getTime()) / (1000 * 60 * 60 * 24));

    if (gapDays > 0) {
      console.log(`⚠️  GAP: ${gapDays} days of ERC1155 data BEFORE clob_fills starts\n`);
    }
  } else {
    console.log(`❌ No ERC1155 transfers found\n`);
  }

  // Check if we have trades_raw (might have earlier data)
  console.log('📊 Checking if trades_raw exists...\n');

  try {
    const tradesRawQuery = await clickhouse.query({
      query: `
        SELECT
          min(timestamp) as first_trade,
          max(timestamp) as last_trade,
          count(*) as total_trades
        FROM trades_raw
        WHERE wallet = '${TARGET_WALLET}'
      `,
      format: 'JSONEachRow'
    });

    const tradesRaw: any = (await tradesRawQuery.json())[0];

    if (tradesRaw.total_trades > 0) {
      console.log(`✅ Found trades_raw!`);
      console.log(`  First: ${tradesRaw.first_trade}`);
      console.log(`  Last: ${tradesRaw.last_trade}`);
      console.log(`  Total: ${tradesRaw.total_trades}\n`);
    } else {
      console.log(`❌ No trades_raw found\n`);
    }
  } catch (e: any) {
    console.log(`❌ trades_raw table does not exist\n`);
  }

  // Check recent resolved positions that SHOULD be in our data
  console.log('📊 Checking for recently resolved markets (should be in our data)...\n');

  const recentResolvedQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        outcome_count,
        resolved_at
      FROM market_resolutions_final
      WHERE resolved_at >= '2024-08-22'
        AND resolved_at <= NOW()
      ORDER BY resolved_at DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const recentResolved: any[] = await recentResolvedQuery.json();

  console.log(`Found ${recentResolved.length} markets resolved since 2024-08-22:\n`);

  for (const r of recentResolved.slice(0, 5)) {
    console.log(`  ${r.condition_id_norm.substring(0, 30)}... (${r.resolved_at})`);
  }

  // Try to find fills for these resolved markets
  console.log('\n📊 Checking if our wallet has fills for recently resolved markets...\n');

  let foundResolved = 0;
  for (const r of recentResolved.slice(0, 20)) {
    const fillCheck = await clickhouse.query({
      query: `
        SELECT COUNT(*) as has_fill
        FROM clob_fills
        WHERE proxy_wallet = '${TARGET_WALLET}'
          AND lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') = '${r.condition_id_norm}'
      `,
      format: 'JSONEachRow'
    });

    const check: any = (await fillCheck.json())[0];
    if (check.has_fill > 0) {
      foundResolved++;
    }
  }

  console.log(`Our wallet has fills for ${foundResolved}/20 recently resolved markets\n`);

  if (foundResolved === 0) {
    console.log('❌ ANOMALY: Wallet has ZERO fills for recently resolved markets');
    console.log('   This suggests either:');
    console.log('   1. Wallet only trades on markets that stay open for long periods');
    console.log('   2. All of wallet\'s positions are on long-term prediction markets\n');
  }

  // Final summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`clob_fills: 194 fills, 45 assets, starts 2024-08-22`);

  if (erc1155.total_transfers > 0) {
    console.log(`erc1155_transfers: ${erc1155.total_transfers} transfers, ${erc1155.unique_tokens} tokens, starts ${erc1155.first_transfer}`);

    const erc1155First = new Date(erc1155.first_transfer);
    const clobFirst = new Date('2024-08-22');

    if (erc1155First < clobFirst) {
      console.log(`\n⚠️  RECOMMENDATION: Use ERC1155 data to fill the gap`);
      console.log(`   ERC1155 starts ${Math.floor((clobFirst.getTime() - erc1155First.getTime()) / (1000 * 60 * 60 * 24))} days earlier`);
      console.log(`   Can reconstruct historical positions from on-chain transfers\n`);
    }
  }

  console.log('✅ HISTORICAL DATA CHECK COMPLETE\n');
}

main().catch(console.error);
