import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const SCALE = 1000000;

export async function createWorkingFillsNorm(): Promise<void> {
  console.log('📊 Creating working fills_norm_fixed table with proper mapping...');

  try {
    // Create the table with mapping
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.fills_norm_fixed_v2 (
          wallet String,
          token_decimal String,
          token_hex String,
          condition_id_64 String,
          outcome_idx Int32,
          side LowCardinality(String),
          qty Float64,
          px Float64,
          fee Float64,
          timestamp DateTime,
          tx_hash String,
          market_slug Nullable(String),
          mapping_source String
        )
        ENGINE = MergeTree()
        ORDER BY (wallet, condition_id_64, outcome_idx, timestamp)
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    console.log('Creating populated table with mapping...');

    // Use a simpler approach that handles outcomes properly
    await clickhouse.query({
      query: `
        INSERT INTO sandbox.fills_norm_fixed_v2
        SELECT
          CASE
            WHEN proxy_wallet != '' THEN lower(CAST(proxy_wallet AS String))
            ELSE lower(CAST(user_eoa AS String))
          END AS wallet,
          CAST(asset_id AS String) AS token_decimal,
          lower(hex(toUInt256(asset_id))) AS token_hex,
          -- Use condition_id if available, otherwise try token mapping
          multiIf(
            condition_id != '', lower(replaceAll(condition_id, '0x', '')),
            t.condition_id_64 IS NOT NULL, t.condition_id_64,
            ''
          ) AS condition_id_64,
          -- Use outcome if condition_id exists, otherwise from token mapping or 0
          multiIf(
            condition_id != '' AND outcome != '', assumeNotNull(toInt32OrNull(outcome)),
            t.condition_id_64 IS NOT NULL, t.outcome_idx,
            0
          ) AS outcome_idx,
          CAST(side AS String) AS side,
          size / ${SCALE} AS qty,
          price / 1 AS px,
          (size / ${SCALE}) * (fee_rate_bps / 10000.0) AS fee,
          timestamp,
          tx_hash,
          market_slug,
          multiIf(
            condition_id != '', 'condition_id',
            t.condition_id_64 IS NOT NULL, 'token_mapping',
            'unmapped'
          ) AS mapping_source
        FROM default.clob_fills f
        LEFT JOIN sandbox.token_cid_map t
          ON t.token_hex = lower(hex(toUInt256(f.asset_id)))
        WHERE (
          lower(CAST(f.proxy_wallet AS String)) = lower('${WALLET}')
          OR lower(CAST(f.user_eoa AS String)) = lower('${WALLET}')
        )
      `,
      format: 'JSONEachRow'
    });

    // Show final stats
    const finalStats = await clickhouse.query({
      query: `SELECT
          count() as total,
          countIf(mapping_source != 'unmapped') as mapped,
          countIf(mapping_source = 'unmapped') as unmapped,
          countIf(condition_id_64 != '') as has_condition,
          side,
          count() as cnt,
          sum(qty) as total_qty,
          avg(px) as avg_px,
          sum(fee) as total_fees
        FROM sandbox.fills_norm_fixed_v2
        GROUP BY side WITH TOTALS
        ORDER BY side
      `,
      format: 'JSONEachRow'
    });
    const finalData = await finalStats.json();

    console.log(`✅ fills_norm_fixed_v2 created successfully!`);
    console.log('Final statistics:');

    finalData.forEach((row: any) => {
      if (row.side) {
        const fee_rate = (row.total_fees / (row.total_qty * row.avg_px)) * 100;
        console.log(`  ${row.side}: ${row.cnt} trades, total qty: ${row.total_qty.toFixed(2)}, avg price: $${row.avg_px.toFixed(3)}, ` +
                   `total fees: $${row.total_fees.toFixed(4)}, fee rate: ${fee_rate.toFixed(2)}%`);
      }
    });

    // Show mapping source breakdown
    const mappingStats = await clickhouse.query({
      query: `
        SELECT
          mapping_source,
          count() as total_trades,
          round(count() * 100.0 / sum(count()) OVER (), 1) as pct
        FROM sandbox.fills_norm_fixed_v2
        GROUP BY mapping_source
        ORDER BY total_trades DESC
      `,
      format: 'JSONEachRow'
    });
    const mappingData = await mappingStats.json();

    console.log('\nMapping source breakdown:');
    mappingData.forEach((row: any) => {
      console.log(`  ${row.mapping_source}: ${row.total_trades} trades (${row.pct}%)`);
    });

    // Show sample with matches
    const sampleMapped = await clickhouse.query({
      query: `
        SELECT
          token_decimal,
          token_hex,
          condition_id_64,
          outcome_idx,
          mapping_source,
          side,
          qty,
          px,
          fee,
          market_slug
        FROM sandbox.fills_norm_fixed_v2
        WHERE mapping_source != 'unmapped'
        LIMIT 3
      `,
      format: 'JSONEachRow'
    });
    const sampleData = await sampleMapped.json();

    console.log('\nSample trades with condition mapping:');
    console.log('Token → Hex → ConditionID:Outcome (Source | Side | Qty | Px)');
    sampleData.forEach((row: any) => {
      console.log(`  ${row.token_decimal.slice(0, 12)} → ${row.token_hex.slice(0, 20)} → ${row.condition_id_64.slice(0, 20)}:${row.outcome_idx}` +
                  ` (${row.mapping_source.padEnd(12)} | ${row.side} | ${row.qty.toFixed(3)} | ${row.px.toFixed(3)})`);
    });

    console.log('\n✅ Working normalization and mapping complete!');

  } catch (error) {
    console.error('❌ fills_norm_fixed_v2 creation failed:', error);
    throw error;
  }
}

createWorkingFillsNorm().catch(console.error);