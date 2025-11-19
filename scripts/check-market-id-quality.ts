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

async function checkMarketIds() {
  console.log('\n🔍 CRITICAL: Market ID quality in trades_with_direction');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Market ID quality breakdown:');
  const quality = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(market_id = '') as blank,
        countIf(market_id = '12') as is_twelve,
        countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as is_zeros,
        countIf(length(market_id) > 20 AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000') as looks_valid,
        
        -- Percentage breakdown
        blank * 100.0 / total_rows as blank_pct,
        is_twelve * 100.0 / total_rows as twelve_pct,
        is_zeros * 100.0 / total_rows as zeros_pct,
        looks_valid * 100.0 / total_rows as valid_pct
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  const data: any = (await quality.json())[0];
  console.log(`   Total rows: ${parseInt(data.total_rows).toLocaleString()}`);
  console.log(`   Blank market_id: ${parseInt(data.blank).toLocaleString()} (${parseFloat(data.blank_pct).toFixed(1)}%)`);
  console.log(`   "12" market_id: ${parseInt(data.is_twelve).toLocaleString()} (${parseFloat(data.twelve_pct).toFixed(1)}%)`);
  console.log(`   All zeros: ${parseInt(data.is_zeros).toLocaleString()} (${parseFloat(data.zeros_pct).toFixed(1)}%)`);
  console.log(`   Looks valid: ${parseInt(data.looks_valid).toLocaleString()} (${parseFloat(data.valid_pct).toFixed(1)}%)`);

  console.log('\n2️⃣ Can we recover market_id from condition_id?');
  console.log('   Checking if we can join to market_id_mapping...');
  
  const recovery = await client.query({
    query: `
      SELECT
        count() as trades_without_market_id,
        countIf(m.market_id IS NOT NULL) as can_recover_from_mapping,
        can_recover_from_mapping * 100.0 / trades_without_market_id as recovery_pct
      FROM trades_with_direction t
      LEFT JOIN market_id_mapping m
        ON lower(substring(t.condition_id_norm, 3)) = lower(substring(m.condition_id, 3))
      WHERE t.market_id = '' OR t.market_id = '12' OR t.market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const recovData: any = (await recovery.json())[0];
  console.log(`   Trades with bad market_id: ${parseInt(recovData.trades_without_market_id).toLocaleString()}`);
  console.log(`   Can recover from mapping: ${parseInt(recovData.can_recover_from_mapping).toLocaleString()} (${parseFloat(recovData.recovery_pct).toFixed(1)}%)`);

  console.log('\n3️⃣ Sample bad market_ids with condition_id:');
  const sample = await client.query({
    query: `
      SELECT
        t.tx_hash,
        t.wallet_address,
        t.market_id as current_market_id,
        t.condition_id_norm,
        t.usd_value,
        m.market_id as recoverable_market_id
      FROM trades_with_direction t
      LEFT JOIN market_id_mapping m
        ON lower(substring(t.condition_id_norm, 3)) = lower(substring(m.condition_id, 3))
      WHERE t.market_id = '' OR t.market_id = '12' OR t.market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await sample.json());

  console.log('\n4️⃣ Volume impact of bad market_ids:');
  const volumeImpact = await client.query({
    query: `
      SELECT
        sum(usd_value) as total_volume,
        sumIf(usd_value, market_id = '' OR market_id = '12' OR market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as bad_market_volume,
        bad_market_volume * 100.0 / total_volume as bad_pct
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  const volData: any = (await volumeImpact.json())[0];
  console.log(`   Total volume: $${parseFloat(volData.total_volume).toLocaleString()}`);
  console.log(`   Volume with bad market_id: $${parseFloat(volData.bad_market_volume).toLocaleString()} (${parseFloat(volData.bad_pct).toFixed(1)}%)`);

  console.log('\n5️⃣ CRITICAL: For wallet P&L, do we need market_id?');
  console.log('   Checking if we can calculate P&L without market_id...');
  
  const pnlTest = await client.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(r.condition_id_norm IS NOT NULL) as has_resolution,
        countIf(r.winning_index IS NOT NULL) as can_calculate_pnl,
        can_calculate_pnl * 100.0 / total_trades as pnl_coverage_pct
      FROM trades_with_direction t
      LEFT JOIN market_resolutions_final r
        ON lower(substring(t.condition_id_norm, 3)) = r.condition_id_norm
      WHERE t.market_id = '' OR t.market_id = '12' OR t.market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const pnlData: any = (await pnlTest.json())[0];
  console.log(`   Trades with bad market_id: ${parseInt(pnlData.total_trades).toLocaleString()}`);
  console.log(`   Can join to resolutions: ${parseInt(pnlData.has_resolution).toLocaleString()}`);
  console.log(`   Can calculate P&L: ${parseInt(pnlData.can_calculate_pnl).toLocaleString()} (${parseFloat(pnlData.pnl_coverage_pct).toFixed(1)}%)`);

  await client.close();
}

checkMarketIds().catch(console.error);
