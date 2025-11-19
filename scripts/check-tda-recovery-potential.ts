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

async function checkTDARecovery() {
  console.log('\n🔍 CRITICAL CHECK: Can trade_direction_assignments recover missing data?');
  console.log('='.repeat(80));

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';

  console.log('1️⃣ Does trade_direction_assignments have the missing transactions?');
  const tdaCoverage = await client.query({
    query: `
      WITH missing_from_direction AS (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
          )
          AND transaction_hash != ''
          AND length(transaction_hash) = 66
      )
      SELECT
        (SELECT count() FROM missing_from_direction) as total_missing,
        count(DISTINCT t.tx_hash) as found_in_tda,
        countIf(t.condition_id_norm != '' AND length(t.condition_id_norm) >= 64) as has_valid_condition_id,
        countIf(t.direction != 'UNKNOWN') as has_direction,
        countIf(t.confidence = 'HIGH') as high_confidence,

        found_in_tda * 100.0 / total_missing as coverage_pct,
        has_valid_condition_id * 100.0 / found_in_tda as valid_condition_pct
      FROM missing_from_direction m
      LEFT JOIN trade_direction_assignments t ON m.transaction_hash = t.tx_hash
        AND t.wallet_address = {wallet:String}
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const tdaData: any = (await tdaCoverage.json())[0];

  console.log(`   Missing from trades_with_direction: ${parseInt(tdaData.total_missing).toLocaleString()}`);
  console.log(`   Found in trade_direction_assignments: ${parseInt(tdaData.found_in_tda).toLocaleString()} (${parseFloat(tdaData.coverage_pct).toFixed(1)}%)`);
  console.log(`   Has valid condition_id: ${parseInt(tdaData.has_valid_condition_id).toLocaleString()} (${parseFloat(tdaData.valid_condition_pct).toFixed(1)}%)`);
  console.log(`   Has direction: ${parseInt(tdaData.has_direction).toLocaleString()}`);
  console.log(`   High confidence: ${parseInt(tdaData.high_confidence).toLocaleString()}\n`);

  if (parseFloat(tdaData.valid_condition_pct) > 90) {
    console.log('✅ JACKPOT! trade_direction_assignments has valid condition_ids!');
    console.log('   We can recover from this table in MINUTES!\n');

    console.log('2️⃣ Sample recovery from trade_direction_assignments:');
    const sample = await client.query({
      query: `
        WITH missing_from_direction AS (
          SELECT DISTINCT transaction_hash
          FROM trades_raw
          WHERE wallet_address = {wallet:String}
            AND transaction_hash NOT IN (
              SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
            )
          LIMIT 10
        )
        SELECT
          t.tx_hash,
          t.condition_id_norm,
          length(t.condition_id_norm) as cond_len,
          t.market_id,
          t.direction,
          t.confidence,
          t.usd_value,
          t.shares
        FROM missing_from_direction m
        INNER JOIN trade_direction_assignments t ON m.transaction_hash = t.tx_hash
          AND t.wallet_address = {wallet:String}
        WHERE t.condition_id_norm != ''
          AND length(t.condition_id_norm) >= 64
        LIMIT 10
      `,
      query_params: { wallet: topWallet },
      format: 'JSONEachRow',
    });
    console.log(await sample.json());

    console.log('\n3️⃣ FAST RECOVERY STRATEGY:');
    console.log('   ✅ Simply INSERT missing rows from trade_direction_assignments into trades_with_direction');
    console.log('   ⚡ Time: 5-10 minutes');
    console.log('   ✅ Result: 100% wallet coverage!\n');

  } else {
    console.log('❌ trade_direction_assignments also has no valid condition_ids.');
    console.log('   Blockchain backfill IS necessary.\n');

    console.log('2️⃣ Sample of what\'s in trade_direction_assignments:');
    const sample = await client.query({
      query: `
        WITH missing_from_direction AS (
          SELECT DISTINCT transaction_hash
          FROM trades_raw
          WHERE wallet_address = {wallet:String}
            AND transaction_hash NOT IN (
              SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
            )
          LIMIT 10
        )
        SELECT
          t.tx_hash,
          t.condition_id_norm,
          length(t.condition_id_norm) as cond_len,
          t.market_id,
          t.direction,
          t.usd_value
        FROM missing_from_direction m
        INNER JOIN trade_direction_assignments t ON m.transaction_hash = t.tx_hash
          AND t.wallet_address = {wallet:String}
        LIMIT 10
      `,
      query_params: { wallet: topWallet },
      format: 'JSONEachRow',
    });
    console.log(await sample.json());
  }

  console.log('\n4️⃣ Global picture - can we recover ALL missing transactions?');
  const globalRecovery = await client.query({
    query: `
      WITH all_missing AS (
        SELECT DISTINCT r.transaction_hash, r.wallet_address
        FROM trades_raw r
        WHERE r.transaction_hash NOT IN (
          SELECT DISTINCT tx_hash FROM trades_with_direction
        )
        AND r.transaction_hash != ''
        AND length(r.transaction_hash) = 66
      )
      SELECT
        (SELECT count() FROM all_missing) as total_missing,
        count(DISTINCT t.tx_hash) as found_in_tda,
        countIf(t.condition_id_norm != '' AND length(t.condition_id_norm) >= 64) as has_valid_condition,

        found_in_tda * 100.0 / total_missing as coverage_pct,
        has_valid_condition * 100.0 / found_in_tda as valid_pct
      FROM all_missing m
      LEFT JOIN trade_direction_assignments t
        ON m.transaction_hash = t.tx_hash
        AND m.wallet_address = t.wallet_address
    `,
    format: 'JSONEachRow',
  });
  const globalData: any = (await globalRecovery.json())[0];

  console.log(`   Total missing unique transactions: ${parseInt(globalData.total_missing).toLocaleString()}`);
  console.log(`   Found in trade_direction_assignments: ${parseInt(globalData.found_in_tda).toLocaleString()} (${parseFloat(globalData.coverage_pct).toFixed(1)}%)`);
  console.log(`   Has valid condition_id: ${parseInt(globalData.has_valid_condition).toLocaleString()} (${parseFloat(globalData.valid_pct).toFixed(1)}%)\n`);

  if (parseFloat(globalData.valid_pct) > 90 && parseFloat(globalData.coverage_pct) > 90) {
    console.log('🎉 AMAZING! We can recover from trade_direction_assignments!');
    console.log('   Blockchain backfill NOT needed!\n');
  } else if (parseFloat(globalData.coverage_pct) > 90) {
    console.log('⚠️  trade_direction_assignments has the transactions but no valid condition_ids.');
    console.log('   Blockchain backfill IS needed to get condition_ids.\n');
  } else {
    console.log('❌ trade_direction_assignments doesn\'t have complete coverage either.');
    console.log('   Blockchain backfill IS needed.\n');
  }

  await client.close();
}

checkTDARecovery().catch(console.error);
