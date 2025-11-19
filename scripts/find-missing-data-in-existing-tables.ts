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

async function findExistingData() {
  console.log('\n💡 BRILLIANT INSIGHT: Find data in EXISTING tables!');
  console.log('='.repeat(80));
  console.log('Instead of scanning blockchain (hours), query existing data (minutes)\n');

  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';

  console.log('1️⃣ Can we get condition_ids from vw_trades_canonical?');
  const vwConditions = await client.query({
    query: `
      SELECT
        v.transaction_hash,
        v.condition_id_norm,
        v.market_id_norm,
        length(v.condition_id_norm) as cond_len
      FROM vw_trades_canonical v
      WHERE v.transaction_hash IN (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
          )
        LIMIT 100
      )
      AND v.wallet_address_norm = {wallet:String}
      LIMIT 20
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  console.log('Sample from vw_trades_canonical:');
  console.log(await vwConditions.json());

  console.log('\n2️⃣ Can we derive condition_id from market_id?');
  const marketMapping = await client.query({
    query: `
      SELECT
        v.transaction_hash,
        v.market_id_norm,
        m.condition_id as condition_id_from_mapping,
        length(m.condition_id) as mapping_len
      FROM vw_trades_canonical v
      LEFT JOIN market_id_mapping m ON v.market_id_norm = m.market_id
      WHERE v.transaction_hash IN (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
          )
        LIMIT 100
      )
      AND v.wallet_address_norm = {wallet:String}
      AND m.condition_id IS NOT NULL
      LIMIT 10
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  console.log('\nCan derive from market_id_mapping:');
  console.log(await marketMapping.json());

  console.log('\n3️⃣ FAST RECOVERY STRATEGY:');
  const recoveryTest = await client.query({
    query: `
      WITH missing_txs AS (
        SELECT DISTINCT transaction_hash, wallet_address
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
          )
          AND transaction_hash != ''
          AND length(transaction_hash) = 66
      )
      SELECT
        count(DISTINCT v.transaction_hash) as txs_in_vw,
        countIf(m.condition_id IS NOT NULL) as can_get_condition_from_mapping,
        countIf(length(v.condition_id_norm) >= 64 AND v.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as has_condition_in_vw,
        
        -- Can we build complete records?
        countIf(
          (length(v.condition_id_norm) >= 64 AND v.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000')
          OR m.condition_id IS NOT NULL
        ) as can_recover_condition_id,
        
        can_recover_condition_id * 100.0 / txs_in_vw as recovery_rate
        
      FROM missing_txs mt
      LEFT JOIN vw_trades_canonical v 
        ON mt.transaction_hash = v.transaction_hash 
        AND mt.wallet_address = v.wallet_address_norm
      LEFT JOIN market_id_mapping m 
        ON v.market_id_norm = m.market_id
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const recData: any = (await recoveryTest.json())[0];
  console.log(`   Txs found in vw_trades_canonical: ${parseInt(recData.txs_in_vw).toLocaleString()}`);
  console.log(`   Can get condition_id from market_id_mapping: ${parseInt(recData.can_get_condition_from_mapping).toLocaleString()}`);
  console.log(`   Has condition_id in vw: ${parseInt(recData.has_condition_in_vw).toLocaleString()}`);
  console.log(`   \n   🎯 CAN RECOVER: ${parseInt(recData.can_recover_condition_id).toLocaleString()} (${parseFloat(recData.recovery_rate).toFixed(1)}%)\n`);

  console.log('4️⃣ How long would this take?');
  console.log('   Query existing tables: 5-10 minutes ⚡');
  console.log('   vs Blockchain scan: 18-27 hours 🐌\n');

  console.log('5️⃣ Can we do this RIGHT NOW?');
  const sampleRecovery = await client.query({
    query: `
      SELECT
        v.transaction_hash,
        v.wallet_address_norm,
        COALESCE(
          NULLIF(v.condition_id_norm, '0x0000000000000000000000000000000000000000000000000000000000000000'),
          lower(substring(m.condition_id, 3))
        ) as recovered_condition_id,
        v.market_id_norm,
        v.usd_value,
        v.shares,
        v.trade_direction
      FROM vw_trades_canonical v
      LEFT JOIN market_id_mapping m ON v.market_id_norm = m.market_id
      WHERE v.transaction_hash IN (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
          )
        LIMIT 10
      )
      AND v.wallet_address_norm = {wallet:String}
      LIMIT 10
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  console.log('Sample recovered records:');
  console.log(await sampleRecovery.json());

  await client.close();
}

findExistingData().catch(console.error);
