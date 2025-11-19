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

async function verifyActualCoverage() {
  console.log('\n🔍 CRITICAL CHECK: Do we ACTUALLY have complete coverage?');
  console.log('='.repeat(80));
  console.log('trades_with_direction has 33.6M txs, trades_raw has 32.4M txs');
  console.log('If direction has MORE, maybe we already have everything?\n');

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';

  console.log('1️⃣ Transaction comparison for this wallet:');
  const txComparison = await client.query({
    query: `
      SELECT
        'trades_raw' as source,
        count(DISTINCT transaction_hash) as unique_txs,
        count(*) as total_rows
      FROM trades_raw
      WHERE wallet_address = {wallet:String}
        AND transaction_hash != ''
        AND length(transaction_hash) = 66

      UNION ALL

      SELECT
        'trades_with_direction' as source,
        count(DISTINCT tx_hash) as unique_txs,
        count(*) as total_rows
      FROM trades_with_direction
      WHERE wallet_address = {wallet:String}
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  console.log(await txComparison.json());

  console.log('\n2️⃣ Are the "missing" txs actually just duplicates in trades_raw?');
  const dupAnalysis = await client.query({
    query: `
      WITH raw_unique AS (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash != ''
          AND length(transaction_hash) = 66
      ),
      direction_unique AS (
        SELECT DISTINCT tx_hash
        FROM trades_with_direction
        WHERE wallet_address = {wallet:String}
      )
      SELECT
        (SELECT count() FROM raw_unique) as unique_in_raw,
        (SELECT count() FROM direction_unique) as unique_in_direction,

        -- Missing from direction
        (SELECT count()
         FROM raw_unique r
         WHERE r.transaction_hash NOT IN (SELECT tx_hash FROM direction_unique)
        ) as missing_from_direction,

        -- Extra in direction (not in raw)
        (SELECT count()
         FROM direction_unique d
         WHERE d.tx_hash NOT IN (SELECT transaction_hash FROM raw_unique)
        ) as extra_in_direction
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const dupData: any = (await dupAnalysis.json())[0];

  console.log(`   Unique txs in trades_raw: ${parseInt(dupData.unique_in_raw).toLocaleString()}`);
  console.log(`   Unique txs in trades_with_direction: ${parseInt(dupData.unique_in_direction).toLocaleString()}`);
  console.log(`   Missing from direction: ${parseInt(dupData.missing_from_direction).toLocaleString()}`);
  console.log(`   Extra in direction (not in raw): ${parseInt(dupData.extra_in_direction).toLocaleString()}\n`);

  if (parseInt(dupData.missing_from_direction) === 0) {
    console.log('✅✅✅ JACKPOT! trades_with_direction has 100% coverage!');
    console.log('   The "missing" transactions were just duplicate rows in trades_raw!');
    console.log('   You can calculate PnL RIGHT NOW!\n');
  } else {
    console.log(`❌ Still missing ${parseInt(dupData.missing_from_direction).toLocaleString()} UNIQUE transactions.\n`);

    // Sample the actual missing unique txs
    console.log('3️⃣ Sample of ACTUALLY missing unique transactions:');
    const missingUnique = await client.query({
      query: `
        WITH raw_unique AS (
          SELECT DISTINCT transaction_hash
          FROM trades_raw
          WHERE wallet_address = {wallet:String}
            AND transaction_hash != ''
            AND length(transaction_hash) = 66
        ),
        direction_unique AS (
          SELECT DISTINCT tx_hash
          FROM trades_with_direction
          WHERE wallet_address = {wallet:String}
        )
        SELECT transaction_hash
        FROM raw_unique
        WHERE transaction_hash NOT IN (SELECT tx_hash FROM direction_unique)
        LIMIT 10
      `,
      query_params: { wallet: topWallet },
      format: 'JSONEachRow',
    });
    console.log(await missingUnique.json());
  }

  console.log('\n4️⃣ Global picture - ALL wallets:');
  const globalCheck = await client.query({
    query: `
      WITH raw_unique AS (
        SELECT DISTINCT transaction_hash, wallet_address
        FROM trades_raw
        WHERE transaction_hash != ''
          AND length(transaction_hash) = 66
      ),
      direction_unique AS (
        SELECT DISTINCT tx_hash, wallet_address
        FROM trades_with_direction
      )
      SELECT
        (SELECT count() FROM raw_unique) as unique_in_raw,
        (SELECT count() FROM direction_unique) as unique_in_direction,

        (SELECT count()
         FROM raw_unique r
         WHERE NOT EXISTS (
           SELECT 1 FROM direction_unique d
           WHERE d.tx_hash = r.transaction_hash
             AND d.wallet_address = r.wallet_address
         )
        ) as missing_from_direction
    `,
    format: 'JSONEachRow',
  });
  const globalData: any = (await globalCheck.json())[0];

  console.log(`   Unique tx+wallet pairs in trades_raw: ${parseInt(globalData.unique_in_raw).toLocaleString()}`);
  console.log(`   Unique tx+wallet pairs in trades_with_direction: ${parseInt(globalData.unique_in_direction).toLocaleString()}`);
  console.log(`   Missing from direction: ${parseInt(globalData.missing_from_direction).toLocaleString()}\n`);

  if (parseInt(globalData.missing_from_direction) === 0) {
    console.log('🎉🎉🎉 COMPLETE COVERAGE ACHIEVED!');
    console.log('   All wallets have 100% of their transactions!');
    console.log('   Ready to calculate PnL!\n');
  } else {
    const missingPct = (parseInt(globalData.missing_from_direction) * 100.0 / parseInt(globalData.unique_in_raw));
    console.log(`❌ Still missing ${parseInt(globalData.missing_from_direction).toLocaleString()} unique tx+wallet pairs (${missingPct.toFixed(1)}%)\n`);
  }

  await client.close();
}

verifyActualCoverage().catch(console.error);
