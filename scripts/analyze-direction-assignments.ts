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

async function analyze() {
  console.log('\n🎯 DEEP DIVE: trade_direction_assignments (129M rows)');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Data Quality:');
  const quality = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(condition_id_norm != '' AND length(condition_id_norm) = 64) as has_valid_condition_id,
        countIf(direction != 'UNKNOWN') as has_known_direction,
        countIf(confidence = 'HIGH') as high_confidence,
        countIf(has_both_legs = true) as has_both_legs,
        countIf(usdc_out > 0 OR usdc_in > 0) as has_usdc_flow,
        countIf(tokens_out > 0 OR tokens_in > 0) as has_token_flow
      FROM trade_direction_assignments
    `,
    format: 'JSONEachRow',
  });
  console.log(await quality.json());

  console.log('\n2️⃣ Direction Breakdown:');
  const dirBreakdown = await client.query({
    query: `
      SELECT
        direction,
        count() as count,
        count() * 100.0 / (SELECT count() FROM trade_direction_assignments) as pct
      FROM trade_direction_assignments
      GROUP BY direction
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await dirBreakdown.json());

  console.log('\n3️⃣ Confidence Breakdown:');
  const confBreakdown = await client.query({
    query: `
      SELECT
        confidence,
        count() as count,
        count() * 100.0 / (SELECT count() FROM trade_direction_assignments) as pct
      FROM trade_direction_assignments
      GROUP BY confidence
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await confBreakdown.json());

  console.log('\n4️⃣ Can we join to resolutions?');
  const joinTest = await client.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(r.condition_id_norm IS NOT NULL) as trades_with_resolution,
        countIf(r.winning_outcome != '') as trades_with_winner
      FROM trade_direction_assignments t
      LEFT JOIN market_resolutions_final r
        ON t.condition_id_norm = r.condition_id_norm
      WHERE t.condition_id_norm != ''
        AND length(t.condition_id_norm) = 64
    `,
    format: 'JSONEachRow',
  });
  console.log(await joinTest.json());

  console.log('\n5️⃣ Sample trades:');
  const sample = await client.query({
    query: `
      SELECT
        wallet_address,
        condition_id_norm,
        direction,
        confidence,
        usdc_in,
        usdc_out,
        tokens_in,
        tokens_out,
        has_both_legs
      FROM trade_direction_assignments
      WHERE condition_id_norm != ''
        AND direction != 'UNKNOWN'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  console.log(await sample.json());

  console.log('\n6️⃣ Comparison to trades_with_direction:');
  const comparison = await client.query({
    query: `
      SELECT
        'trade_direction_assignments' as source,
        count() as rows,
        count(DISTINCT wallet_address) as wallets,
        count(DISTINCT tx_hash) as txs,
        countIf(condition_id_norm != '' AND length(condition_id_norm) = 64) as valid_condition_ids
      FROM trade_direction_assignments

      UNION ALL

      SELECT
        'trades_with_direction' as source,
        count() as rows,
        count(DISTINCT wallet_address) as wallets,
        count(DISTINCT tx_hash) as txs,
        countIf(condition_id_norm != '' AND length(condition_id_norm) = 64) as valid_condition_ids
      FROM trades_with_direction

      ORDER BY rows DESC
    `,
    format: 'JSONEachRow',
  });
  console.log(await comparison.json());

  await client.close();
}

analyze().catch(console.error);
