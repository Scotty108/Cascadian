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

async function investigateGap() {
  console.log('\n🚨 RE-INVESTIGATING THE 77M MISSING TRADES');
  console.log('='.repeat(80));
  console.log('User is RIGHT - we need to understand this gap better.\n');

  console.log('1️⃣ Table sizes:');
  const sizes = await client.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('trades_raw', 'trades_with_direction', 'vw_trades_canonical', 'trade_direction_assignments')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  const sizeData = await sizes.json();
  sizeData.forEach((row: any) => {
    console.log(`   ${row.name.padEnd(30)} ${parseInt(row.total_rows).toLocaleString()} rows`);
  });

  console.log('\n2️⃣ CRITICAL: What is vw_trades_canonical based on?');
  const viewDef = await client.query({
    query: `
      SELECT create_table_query
      FROM system.tables
      WHERE database = 'default'
        AND name = 'vw_trades_canonical'
    `,
    format: 'JSONEachRow',
  });
  const viewDefData: any = await viewDef.json();
  console.log('   View definition:', viewDefData[0]?.create_table_query || 'Not found');

  console.log('\n3️⃣ Comparing vw_trades_canonical vs trades_with_direction:');
  console.log('   Gap: 157M - 82M = 75M trades');
  console.log('   This is the "missing" 77M the user is concerned about!\n');

  console.log('4️⃣ Quality of the 75M "extra" rows in vw_trades_canonical:');
  const extraQuality = await client.query({
    query: `
      SELECT
        count() as rows_only_in_view,
        countIf(condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000') as has_zero_condition_id,
        countIf(market_id_norm = '0x' OR market_id_norm = '' OR length(market_id_norm) < 10) as has_bad_market_id,
        countIf(wallet_address_norm = '0x00000000000050ba7c429821e6d66429452ba168') as has_default_wallet,
        
        countIf(
          condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND length(condition_id_norm) >= 64
          AND market_id_norm != '0x'
          AND length(market_id_norm) >= 64
        ) as looks_real,
        
        sum(usd_value) as total_volume
        
      FROM vw_trades_canonical
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash FROM trades_with_direction
      )
    `,
    format: 'JSONEachRow',
  });
  const extraData: any = (await extraQuality.json())[0];
  console.log(`   Rows only in view: ${parseInt(extraData.rows_only_in_view).toLocaleString()}`);
  console.log(`   Has zero condition_id: ${parseInt(extraData.has_zero_condition_id).toLocaleString()} (${(extraData.has_zero_condition_id * 100 / extraData.rows_only_in_view).toFixed(1)}%)`);
  console.log(`   Has bad market_id: ${parseInt(extraData.has_bad_market_id).toLocaleString()} (${(extraData.has_bad_market_id * 100 / extraData.rows_only_in_view).toFixed(1)}%)`);
  console.log(`   Has default wallet: ${parseInt(extraData.has_default_wallet).toLocaleString()} (${(extraData.has_default_wallet * 100 / extraData.rows_only_in_view).toFixed(1)}%)`);
  console.log(`   \n   LOOKS REAL: ${parseInt(extraData.looks_real).toLocaleString()} (${(extraData.looks_real * 100 / extraData.rows_only_in_view).toFixed(1)}%)`);
  console.log(`   Volume: $${parseFloat(extraData.total_volume).toLocaleString()}`);

  console.log('\n5️⃣ Sample of "extra" trades that LOOK REAL:');
  const realExtra = await client.query({
    query: `
      SELECT
        transaction_hash,
        wallet_address_norm,
        market_id_norm,
        condition_id_norm,
        usd_value,
        timestamp
      FROM vw_trades_canonical
      WHERE transaction_hash NOT IN (SELECT DISTINCT tx_hash FROM trades_with_direction)
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND length(condition_id_norm) >= 64
        AND market_id_norm != '0x'
        AND length(market_id_norm) >= 64
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await realExtra.json());

  console.log('\n6️⃣ Can blockchain backfill recover these "extra" trades?');
  const backfillCheck = await client.query({
    query: `
      SELECT
        count() as extra_trades,
        count(DISTINCT transaction_hash) as unique_txs,
        countIf(length(transaction_hash) = 66) as has_valid_tx_hash
      FROM vw_trades_canonical
      WHERE transaction_hash NOT IN (SELECT DISTINCT tx_hash FROM trades_with_direction)
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const backfillData: any = (await backfillCheck.json())[0];
  console.log(`   Extra trades: ${parseInt(backfillData.extra_trades).toLocaleString()}`);
  console.log(`   Unique tx_hashes: ${parseInt(backfillData.unique_txs).toLocaleString()}`);
  console.log(`   Has valid tx_hash: ${parseInt(backfillData.has_valid_tx_hash).toLocaleString()} (${(backfillData.has_valid_tx_hash * 100 / backfillData.extra_trades).toFixed(1)}%)`);
  console.log('\n   ✅ If they have valid tx_hashes, blockchain backfill CAN recover them!');

  await client.close();
}

investigateGap().catch(console.error);
