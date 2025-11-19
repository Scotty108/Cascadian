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

async function checkZeroMarketIds() {
  console.log('\n🔍 Checking for ALL-ZERO market_ids in trades_with_direction');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Checking different zero formats:');
  const zeroFormats = await client.query({
    query: `
      SELECT
        count() as total_rows,
        
        -- 66-char with 0x prefix
        countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as zeros_66_char,
        
        -- 64-char without prefix
        countIf(market_id = '0000000000000000000000000000000000000000000000000000000000000000') as zeros_64_char,
        
        -- Any length that's all zeros (flexible check)
        countIf(replaceAll(market_id, '0', '') IN ('', 'x')) as all_zeros_flexible,
        
        -- Blank
        countIf(market_id = '') as blank,
        
        -- "12"
        countIf(market_id = '12') as is_twelve,
        
        -- Length 64 or 66 but not all zeros
        countIf(
          length(market_id) IN (64, 66) 
          AND replaceAll(replaceAll(market_id, '0', ''), 'x', '') != ''
        ) as looks_valid
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  const data: any = (await zeroFormats.json())[0];
  console.log(`   Total rows: ${parseInt(data.total_rows).toLocaleString()}`);
  console.log(`   Zeros (66-char): ${parseInt(data.zeros_66_char).toLocaleString()}`);
  console.log(`   Zeros (64-char): ${parseInt(data.zeros_64_char).toLocaleString()}`);
  console.log(`   All zeros (flexible): ${parseInt(data.all_zeros_flexible).toLocaleString()}`);
  console.log(`   Blank: ${parseInt(data.blank).toLocaleString()}`);
  console.log(`   "12": ${parseInt(data.is_twelve).toLocaleString()}`);
  console.log(`   Looks valid: ${parseInt(data.looks_valid).toLocaleString()}`);

  console.log('\n2️⃣ Sample market_ids to understand formats:');
  const sample = await client.query({
    query: `
      SELECT
        market_id,
        length(market_id) as len,
        condition_id_norm,
        usd_value
      FROM trades_with_direction
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await sample.json());

  console.log('\n3️⃣ Distribution of market_id lengths:');
  const lengths = await client.query({
    query: `
      SELECT
        length(market_id) as len,
        count() as count,
        any(market_id) as sample
      FROM trades_with_direction
      GROUP BY len
      ORDER BY count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log(await lengths.json());

  console.log('\n4️⃣ CRITICAL: Total "bad" market_ids:');
  const badTotal = await client.query({
    query: `
      SELECT
        count() as total_bad,
        total_bad * 100.0 / (SELECT count() FROM trades_with_direction) as bad_pct,
        
        sum(usd_value) as bad_volume,
        bad_volume * 100.0 / (SELECT sum(usd_value) FROM trades_with_direction) as bad_volume_pct
        
      FROM trades_with_direction
      WHERE 
        market_id = ''
        OR market_id = '12'
        OR market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
        OR market_id = '0000000000000000000000000000000000000000000000000000000000000000'
        OR (length(market_id) > 10 AND replaceAll(replaceAll(market_id, '0', ''), 'x', '') = '')
    `,
    format: 'JSONEachRow',
  });
  const badData: any = (await badTotal.json())[0];
  console.log(`   Total bad market_ids: ${parseInt(badData.total_bad).toLocaleString()} (${parseFloat(badData.bad_pct).toFixed(1)}%)`);
  console.log(`   Bad volume: $${parseFloat(badData.bad_volume).toLocaleString()} (${parseFloat(badData.bad_volume_pct).toFixed(1)}%)`);

  console.log('\n5️⃣ Can we recover ALL bad market_ids from mappings?');
  const recovery = await client.query({
    query: `
      SELECT
        count() as total_bad,
        countIf(m.market_id IS NOT NULL) as can_recover_from_mapping,
        can_recover_from_mapping * 100.0 / total_bad as recovery_pct
      FROM trades_with_direction t
      LEFT JOIN market_id_mapping m
        ON lower(substring(t.condition_id_norm, 3)) = lower(substring(m.condition_id, 3))
      WHERE 
        t.market_id = ''
        OR t.market_id = '12'
        OR t.market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
        OR t.market_id = '0000000000000000000000000000000000000000000000000000000000000000'
        OR (length(t.market_id) > 10 AND replaceAll(replaceAll(t.market_id, '0', ''), 'x', '') = '')
    `,
    format: 'JSONEachRow',
  });
  const recovData: any = (await recovery.json())[0];
  console.log(`   Total with bad market_id: ${parseInt(recovData.total_bad).toLocaleString()}`);
  console.log(`   Can recover from mapping: ${parseInt(recovData.can_recover_from_mapping).toLocaleString()} (${parseFloat(recovData.recovery_pct).toFixed(1)}%)`);

  console.log('\n6️⃣ Most importantly: Can we calculate P&L for ALL trades (even with bad market_ids)?');
  const pnlCheck = await client.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(r.condition_id_norm IS NOT NULL) as can_join_to_resolutions,
        countIf(r.winning_index IS NOT NULL) as has_resolution_outcome,
        has_resolution_outcome * 100.0 / total_trades as pnl_coverage_pct
      FROM trades_with_direction t
      LEFT JOIN market_resolutions_final r
        ON lower(substring(t.condition_id_norm, 3)) = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });
  const pnlData: any = (await pnlCheck.json())[0];
  console.log(`   Total trades: ${parseInt(pnlData.total_trades).toLocaleString()}`);
  console.log(`   Can join to resolutions: ${parseInt(pnlData.can_join_to_resolutions).toLocaleString()}`);
  console.log(`   Has resolution (can calculate P&L): ${parseInt(pnlData.has_resolution_outcome).toLocaleString()} (${parseFloat(pnlData.pnl_coverage_pct).toFixed(1)}%)`);

  await client.close();
}

checkZeroMarketIds().catch(console.error);
