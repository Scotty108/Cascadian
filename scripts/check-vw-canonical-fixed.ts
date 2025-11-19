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
  request_timeout: 120000,
});

async function checkView() {
  console.log('\n🔍 Checking vw_trades_canonical market_id_norm quality');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Checking for "0x" market_id_norm:');
  const oxCheck = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(market_id_norm = '0x') as just_0x,
        countIf(market_id_norm = '') as blank,
        countIf(market_id_norm = '0x' OR market_id_norm = '') as blank_or_0x,
        countIf(market_id_norm = '12') as is_twelve,
        countIf(length(market_id_norm) = 2) as len_2,
        countIf(length(market_id_norm) < 10) as len_under_10,
        countIf(length(market_id_norm) >= 64) as looks_valid
      FROM vw_trades_canonical
    `,
    format: 'JSONEachRow',
  });
  const data: any = (await oxCheck.json())[0];
  console.log(`   Total rows: ${parseInt(data.total_rows).toLocaleString()}`);
  console.log(`   Just "0x": ${parseInt(data.just_0x).toLocaleString()}`);
  console.log(`   Blank: ${parseInt(data.blank).toLocaleString()}`);
  console.log(`   Blank or "0x": ${parseInt(data.blank_or_0x).toLocaleString()}`);
  console.log(`   "12": ${parseInt(data.is_twelve).toLocaleString()}`);
  console.log(`   Length = 2: ${parseInt(data.len_2).toLocaleString()}`);
  console.log(`   Length < 10: ${parseInt(data.len_under_10).toLocaleString()}`);
  console.log(`   Looks valid (len >= 64): ${parseInt(data.looks_valid).toLocaleString()}`);

  console.log('\n2️⃣ Sample rows with "0x" or blank market_id_norm:');
  const sample = await client.query({
    query: `
      SELECT
        market_id_norm,
        condition_id_norm,
        wallet_address_norm,
        usd_value,
        timestamp
      FROM vw_trades_canonical
      WHERE market_id_norm = '0x' OR market_id_norm = '' OR length(market_id_norm) < 10
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await sample.json());

  console.log('\n3️⃣ Distribution of short market_id_norm values:');
  const dist = await client.query({
    query: `
      SELECT
        market_id_norm,
        length(market_id_norm) as len,
        count() as count
      FROM vw_trades_canonical
      WHERE length(market_id_norm) < 10
      GROUP BY market_id_norm, len
      ORDER BY count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await dist.json());

  console.log('\n4️⃣ Volume impact:');
  const volume = await client.query({
    query: `
      SELECT
        sum(usd_value) as total_volume,
        sumIf(usd_value, market_id_norm = '0x' OR market_id_norm = '' OR length(market_id_norm) < 10) as bad_volume,
        bad_volume * 100.0 / total_volume as bad_pct
      FROM vw_trades_canonical
    `,
    format: 'JSONEachRow',
  });
  const volData: any = (await volume.json())[0];
  console.log(`   Total volume: $${parseFloat(volData.total_volume).toLocaleString()}`);
  console.log(`   Bad market_id volume: $${parseFloat(volData.bad_volume).toLocaleString()} (${parseFloat(volData.bad_pct).toFixed(1)}%)`);

  await client.close();
}

checkView().catch(console.error);
