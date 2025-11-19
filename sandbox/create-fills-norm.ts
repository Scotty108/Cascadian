import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const SCALE = 1000000; // 1e6 for size normalization

export async function createFillsNormTable(): Promise<void> {
  console.log('📊 Creating normalized fills table...');

  try {
    // Create the normalized fills table
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.fills_norm (
          wallet String,
          token_hex String,
          condition_id_64 String,
          outcome_idx Int32,
          side LowCardinality(String),
          qty Float64,
          px Float64,
          fee Float64,
          timestamp DateTime,
          tx_hash String,
          market_slug Nullable(String)
        )
        ENGINE = MergeTree()
        ORDER BY (wallet, condition_id_64, outcome_idx, timestamp)
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    // Populate the table with normalized data
    await clickhouse.query({
      query: `
        INSERT INTO sandbox.fills_norm
        WITH f0 AS (
          SELECT
            CASE
              WHEN proxy_wallet != '' THEN lower(CAST(proxy_wallet AS String))
              ELSE lower(CAST(user_eoa AS String))
            END AS wallet,
            lower(CAST(asset_id AS String)) AS token_hex,
            CAST(side AS String) AS side,
            size / ${SCALE} AS qty,      -- Normalize size from micros to dollars
            price / 1 AS px,             -- Price already in 0-1 range
            (size / ${SCALE}) * (fee_rate_bps / 10000.0) AS fee, -- Fee on normalized size
            timestamp,
            tx_hash,
            market_slug
          FROM default.clob_fills
          WHERE (
            lower(CAST(proxy_wallet AS String)) = lower('${WALLET}')
            OR lower(CAST(user_eoa AS String)) = lower('${WALLET}')
          )
        )
        SELECT
          f0.wallet,
          f0.token_hex,
          coalesce(
            t.condition_id_64,
            CAST(CAST(b.market_hex64 AS String), 'String')
          ) AS condition_id_64,
          coalesce(t.outcome_idx, 0) AS outcome_idx,
          f0.side,
          f0.qty,
          f0.px,
          f0.fee,
          f0.timestamp,
          f0.tx_hash,
          f0.market_slug
        FROM f0
        LEFT JOIN sandbox.token_cid_map t
          ON t.token_hex = f0.token_hex
        LEFT JOIN sandbox.ctf_market_identity b
          ON b.ctf_hex64 = f0.token_hex
      `,
      format: 'JSONEachRow'
    });

    // Get stats and show sample data
    const stats = await clickhouse.query({
      query: 'SELECT count() as total, countIf(condition_id_64 = \'\' OR condition_id_64 IS NULL) AS unmapped FROM sandbox.fills_norm',
      format: 'JSONEachRow'
    });
    const statsData = await stats.json();
    console.log(`✅ fills_norm created with ${statsData[0].total} rows`);
    console.log(`   Unmapped tokens: ${statsData[0].unmapped}`);

    // Show sample data
    console.log('\n🔍 Sample normalized fills:');
    const sample = await clickhouse.query({
      query: `
        SELECT
          side,
          qty,
          px,
          fee,
          outcome_idx,
          condition_id_64,
          token_hex
        FROM sandbox.fills_norm
        ORDER BY timestamp
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sampleData = await sample.json();

    console.log('Side | Qty | Price | Fee | Outcome');
    console.log(''.padEnd(40, '-'));

    sampleData.forEach((row: any) => {
      console.log(`${row.side.padEnd(8)} | ${row.qty.toFixed(3).padStart(7)} | ${row.px.toFixed(3).padStart(5)} | ${row.fee.toFixed(3).padStart(5)} | ${row.outcome_idx}`);
    });

    // Show market slug mapping
    console.log('\n🔍 Market slug mapping:');
    const slugSample = await clickhouse.query({
      query: `
        SELECT market_slug, condition_id_64, count() as cnt
        FROM sandbox.fills_norm
        WHERE market_slug IS NOT NULL
        GROUP BY market_slug, condition_id_64
        ORDER BY cnt DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const slugData = await slugSample.json();
    slugData.forEach((row: any) => {
      console.log(`  ${row.market_slug}: ${row.condition_id_64.slice(0, 10)}... (${row.cnt} trades)`);
    });

    console.log('\n✅ fills_norm table created and populated successfully!');

  } catch (error) {
    console.error('❌ fills_norm creation failed:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createFillsNormTable()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}