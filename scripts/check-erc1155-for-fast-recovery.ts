#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function checkFastRecovery() {
  console.log('\n⚡ CRITICAL QUESTION: Can we recover in MINUTES instead of HOURS?');
  console.log('='.repeat(80));
  console.log('Checking if erc1155_transfers already has the blockchain data...\n');

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';

  console.log('1️⃣ Do we already have ERC1155 events for "missing" transactions?');
  const erc1155Check = await client.query({
    query: `
      WITH missing_txs AS (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
          )
          AND transaction_hash != ''
          AND length(transaction_hash) = 66
        LIMIT 1000
      )
      SELECT
        (SELECT count() FROM missing_txs) as total_missing_txs,
        count(DISTINCT e.tx_hash) as found_in_erc1155,
        count(*) as total_erc1155_events,
        found_in_erc1155 * 100.0 / total_missing_txs as coverage_rate
      FROM missing_txs m
      LEFT JOIN erc1155_transfers e ON m.transaction_hash = e.tx_hash
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const erc1155Data: any = (await erc1155Check.json())[0];
  console.log(`   Missing transactions sampled: ${parseInt(erc1155Data.total_missing_txs).toLocaleString()}`);
  console.log(`   Found in erc1155_transfers: ${parseInt(erc1155Data.found_in_erc1155).toLocaleString()}`);
  console.log(`   Total ERC1155 events: ${parseInt(erc1155Data.total_erc1155_events).toLocaleString()}`);
  console.log(`   Coverage rate: ${parseFloat(erc1155Data.coverage_rate).toFixed(1)}%\n`);

  if (parseFloat(erc1155Data.coverage_rate) > 90) {
    console.log('🎉 JACKPOT! We already have the blockchain data!');
    console.log('   We can extract condition_ids from token_ids in MINUTES!\n');

    console.log('2️⃣ Sample recovery - extracting condition_id from token_ids:');
    const sampleRecovery = await client.query({
      query: `
        WITH missing_txs AS (
          SELECT DISTINCT transaction_hash, wallet_address
          FROM trades_raw
          WHERE wallet_address = {wallet:String}
            AND transaction_hash NOT IN (
              SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
            )
          LIMIT 10
        )
        SELECT
          e.tx_hash,
          e.token_id,
          lower(substring(hex(e.token_id), 1, 64)) as condition_id_from_token,
          length(lower(substring(hex(e.token_id), 1, 64))) as condition_id_len,
          v.usd_value,
          v.shares,
          v.market_id_norm
        FROM missing_txs m
        INNER JOIN erc1155_transfers e ON m.transaction_hash = e.tx_hash
        LEFT JOIN vw_trades_canonical v ON m.transaction_hash = v.transaction_hash
          AND m.wallet_address = v.wallet_address_norm
        WHERE e.token_id != 0
        LIMIT 10
      `,
      query_params: { wallet: topWallet },
      format: 'JSONEachRow',
    });
    console.log('Sample extracted condition_ids:');
    console.log(await sampleRecovery.json());

    console.log('\n3️⃣ FAST RECOVERY STRATEGY:');
    console.log('   ✅ Step 1: Extract condition_ids from erc1155_transfers.token_id (5 min)');
    console.log('   ✅ Step 2: Join with vw_trades_canonical for trade data (2 min)');
    console.log('   ✅ Step 3: Insert into trades_with_direction (3 min)');
    console.log('   ⚡ TOTAL TIME: ~10 minutes vs 18-27 hours!\n');

  } else {
    console.log('❌ ERC1155 data not fetched yet.');
    console.log('   Blockchain backfill IS necessary (18-27 hours).\n');

    console.log('2️⃣ What about the current blockchain backfill?');
    console.log('   Checking erc1155_transfers table size...');
    const tableSize = await client.query({
      query: `SELECT count(*) as total_events FROM erc1155_transfers`,
      format: 'JSONEachRow',
    });
    const sizeData: any = (await tableSize.json())[0];
    console.log(`   Current ERC1155 events in database: ${parseInt(sizeData.total_events).toLocaleString()}\n`);
  }

  console.log('4️⃣ Overall picture - ALL wallets:');
  const overall = await client.query({
    query: `
      WITH all_missing_txs AS (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE transaction_hash NOT IN (
          SELECT DISTINCT tx_hash FROM trades_with_direction
        )
        AND transaction_hash != ''
        AND length(transaction_hash) = 66
      )
      SELECT
        (SELECT count() FROM all_missing_txs) as total_missing,
        count(DISTINCT e.tx_hash) as found_in_erc1155,
        count(*) as total_events,
        found_in_erc1155 * 100.0 / total_missing as coverage_rate
      FROM all_missing_txs m
      LEFT JOIN erc1155_transfers e ON m.transaction_hash = e.tx_hash
    `,
    format: 'JSONEachRow',
  });
  const overallData: any = (await overall.json())[0];
  console.log(`   Total missing unique transactions: ${parseInt(overallData.total_missing).toLocaleString()}`);
  console.log(`   Found in erc1155_transfers: ${parseInt(overallData.found_in_erc1155).toLocaleString()}`);
  console.log(`   Coverage rate: ${parseFloat(overallData.coverage_rate).toFixed(1)}%\n`);

  if (parseFloat(overallData.coverage_rate) > 90) {
    console.log('🚀 READY FOR FAST RECOVERY!');
    console.log('   We can recover ALL missing trades in ~10 minutes!\n');
  } else {
    console.log('⏳ Blockchain backfill in progress...');
    console.log(`   Still need to fetch ${parseInt(overallData.total_missing) - parseInt(overallData.found_in_erc1155)} transactions\n`);
  }

  await client.close();
}

checkFastRecovery().catch(console.error);
