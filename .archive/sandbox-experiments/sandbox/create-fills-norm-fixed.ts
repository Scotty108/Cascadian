import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const SCALE = 1000000; // 1e6 for size normalization

export async function createFillsWithAdvancedMapping(): Promise<void> {
  console.log('📊 Creating enhanced fills table with advanced mapping...');

  try {
    // Create a new table with better mapping approach
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.fills_norm_fixed (
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
          mapping_source String DEFAULT 'unknown'
        )
        ENGINE = MergeTree()
        ORDER BY (wallet, condition_id_64, outcome_idx, timestamp)
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    console.log('Building advanced mapping query...');

    // Simple approach first - manually convert asset_id to hex
    await clickhouse.query({
      query: `
        INSERT INTO sandbox.fills_norm_fixed
        WITH fills_normalized AS (
          SELECT
            CASE
              WHEN proxy_wallet != '' THEN lower(CAST(proxy_wallet AS String))
              ELSE lower(CAST(user_eoa AS String))
            END AS wallet,
            CAST(asset_id AS String) AS token_decimal,
            CAST(side AS String) AS side,
            size / ${SCALE} AS qty,
            price / 1 AS px,
            (size / ${SCALE}) * (fee_rate_bps / 10000.0) AS fee,
            timestamp,
            tx_hash,
            market_slug,
            condition_id,
            outcome
          FROM default.clob_fills
          WHERE (
            lower(CAST(proxy_wallet AS String)) = lower('${WALLET}')
            OR lower(CAST(user_eoa AS String)) = lower('${WALLET}')
          )
        ),
        token_converter AS (
          SELECT
            wallet,
            token_decimal,
            replaceAll(hex(CAST(token_decimal, 'UInt256')), '0x', '') AS token_hex,  -- Convert to hex
            side,
            qty,
            px,
            fee,
            timestamp,
            tx_hash,
            market_slug,
            condition_id,
            outcome
          FROM fills_normalized
        ),
        best_mappings AS (
          SELECT
            tc.wallet,
            tc.token_decimal,
            tc.token_hex,
            -- Try hierarchy of mapping sources
            multiIf(
              -- 1. Direct token mapping from decimal → hex
              t1.token_hex IS NOT NULL, (t1.condition_id_64, t1.outcome_idx, 'token_map'),
              -- 2. CTF bridge mapping fallback
              b2.ctf_hex64 IS NOT NULL, (b2.market_hex64, 0, 'ctf_bridge'),
              -- 3. Create placeholder from condition_id if we have one
              tc.condition_id != '', (lower(replaceAll(tc.condition_id, '0x', '')),
                                     assumeNotNull(toInt32OrNull(tc.outcome)),
                                     'condition_id'),
              -- 4. Leave as unmapped if nothing works
              ('', 0, 'unmapped')
            ) as mapping_tuple,
            tc.side,
            tc.qty,
            tc.px,
            tc.fee,
            tc.timestamp,
            tc.tx_hash,
            tc.market_slug
          FROM token_converter tc
          LEFT JOIN sandbox.token_cid_map t1 ON t1.token_hex = tc.token_hex
          LEFT JOIN sandbox.ctf_market_identity b2 ON b2.ctf_hex64 = tc.token_hex
        )
        SELECT
          wallet,
          token_decimal,
          token_hex,
          assumeNotNull(mapping_tuple.1) AS condition_id_64,
          assumeNotNull(mapping_tuple.2) AS outcome_idx,
          side,
          qty,
          px,
          fee,
          timestamp,
          tx_hash,
          market_slug,
          assumeNotNull(mapping_tuple.3) AS mapping_source
        FROM best_mappings
      `,
      format: 'JSONEachRow'
    });

    // Get summary stats
    const stats = await clickhouse.query({
      query: `
        SELECT
          count() as total,
          sum(count()) OVER () as total_trades,
          mapping_source,
          count() as cnt
        FROM sandbox.fills_norm_fixed
        GROUP BY mapping_source
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const statsData = await stats.json();

    console.log(`✅ fills_norm_fixed created with ${statsData[0]?.total_trades || 0} total rows`);
    console.log('  Mapping breakdown:');
    statsData.forEach((row: any) => {
      console.log(`    - ${row.mapping_source}: ${row.cnt} trades`);
    });

    // Check mapping coverage
    const coverage = await clickhouse.query({
      query: `
        SELECT
          count() as total,
          countIf(condition_id_64 != '') as mapped,
          countIf(condition_id_64 = '') as unmapped,
          round(countIf(condition_id_64 != '') * 100.0 / count(), 1) as coverage_pct
        FROM sandbox.fills_norm_fixed
      `,
      format: 'JSONEachRow'
    });
    const coverageData = await coverage.json();
    console.log(`\n📊 Mapping coverage: ${coverageData[0].coverage_pct}% (${coverageData[0].mapped}/${coverageData[0].total} trades)`);

    // Show sample mapping results
    console.log('\n🔍 Sample mapping results:');
    const sample = await clickhouse.query({
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
          fee
        FROM sandbox.fills_norm_fixed
        WHERE mapping_source != 'unmapped'
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const sampleData = await sample.json();

    console.log('Decimal → Hex → CID:Outcome (source | side | qty | px | fee)');
    console.log(''.padEnd(95, '-'));
    sampleData.forEach((row: any) => {
      const decimalStr = row.token_decimal.slice(0, 15);
      const hexStr = row.token_hex.slice(0, 20);
      const conditionStr = row.condition_id_64.slice(0, 15);
      console.log(`${decimalStr}... → ${hexStr}... → ${conditionStr}:${row.outcome_idx}` +
                    ` (${row.mapping_source.padEnd(12)} | ${row.side.padEnd(4)} | ${row.qty.toFixed(3).padStart(7)} | ${row.px.toFixed(3)} | ${row.fee.toFixed(4)})`);
    });

    // Show unmapped cases
    const unmapped = await clickhouse.query({
      query: `
        SELECT
          token_decimal,
          token_hex,
          side,
          qty,
          px
        FROM sandbox.fills_norm_fixed
        WHERE mapping_source = 'unmapped'
        LIMIT 3
      `,
      format: 'JSONEachRow'
    });
    const unmappedData = await unmapped.json();

    if (unmappedData.length > 0) {
      console.log(`\n❌ Sample unmapped trades:`);
      unmappedData.forEach((row: any) => {
        console.log(`  ${row.token_decimal.slice(0, 15)}... → ${row.token_hex.slice(0, 20)}... → (unmapped | ${row.side} | ${row.qty.toFixed(3)})`);
      });
    }

    console.log('\n✅ Enhanced fills_norm_fixed table created successfully!');

  } catch (error) {
    console.error('❌ fills_norm_fixed creation failed:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createFillsWithAdvancedMapping()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

// Already exported in the function declaration