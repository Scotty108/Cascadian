#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 60000,
});

async function investigate() {
  console.log('\n🔍 SMOKING GUN #1: trades_dedup_mat_new');
  console.log('=' .repeat(80));
  
  const dedup = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(condition_id != '' AND length(condition_id) = 64) as has_valid_condition_id,
        countIf(market_id != '0x0000000000000000000000000000000000000000000000000000000000000000') as has_valid_market_id,
        countIf(transaction_hash != '') as has_tx_hash,
        min(timestamp) as earliest_trade,
        max(timestamp) as latest_trade
      FROM trades_dedup_mat_new
    `,
    format: 'JSONEachRow',
  });
  console.log(await dedup.json());

  console.log('\n🔍 SMOKING GUN #2: market_resolutions_final');
  console.log('=' .repeat(80));
  
  const resolutions = await client.query({
    query: `
      SELECT
        count() as total_markets,
        countIf(condition_id_norm != '') as has_condition_id,
        countIf(winning_outcome != '') as has_winning_outcome,
        countIf(length(payout_numerators) > 0) as has_payout_vector
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow',
  });
  console.log(await resolutions.json());

  console.log('\n🔍 Comparison: trades_dedup_mat_new vs trades_with_direction');
  console.log('=' .repeat(80));
  
  const comparison = await client.query({
    query: `
      SELECT
        'trades_dedup_mat_new' as table_name,
        count() as row_count,
        countIf(condition_id != '' AND length(condition_id) = 64) as valid_condition_ids,
        count(DISTINCT wallet_address) as unique_wallets,
        count(DISTINCT transaction_hash) as unique_tx_hashes
      FROM trades_dedup_mat_new

      UNION ALL

      SELECT
        'trades_with_direction' as table_name,
        count() as row_count,
        countIf(condition_id_norm != '' AND length(condition_id_norm) = 64) as valid_condition_ids,
        count(DISTINCT wallet_address) as unique_wallets,
        count(DISTINCT tx_hash) as unique_tx_hashes
      FROM trades_with_direction

      ORDER BY row_count DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await comparison.json());

  console.log('\n🔍 Can we join trades_dedup_mat_new to resolutions?');
  console.log('=' .repeat(80));
  
  const joinTest = await client.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(r.condition_id_norm IS NOT NULL) as trades_with_resolution,
        countIf(r.winning_outcome != '') as trades_with_winner,
        sum(t.usd_value) as total_volume_usd
      FROM trades_dedup_mat_new t
      LEFT JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow',
  });
  console.log(await joinTest.json());

  console.log('\n🔍 Table sizes:');
  console.log('=' .repeat(80));

  const sizes = await client.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('trades_raw', 'trades_dedup_mat_new', 'trades_with_direction')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await sizes.json());

  console.log('\n🔍 CRITICAL: What format are condition_ids in trades_dedup_mat_new?');
  console.log('=' .repeat(80));

  const formatCheck = await client.query({
    query: `
      SELECT
        condition_id,
        length(condition_id) as len,
        lower(replaceAll(condition_id, '0x', '')) as normalized,
        length(lower(replaceAll(condition_id, '0x', ''))) as norm_len
      FROM trades_dedup_mat_new
      WHERE condition_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  console.log(await formatCheck.json());

  await client.close();
}

investigate().catch(console.error);
