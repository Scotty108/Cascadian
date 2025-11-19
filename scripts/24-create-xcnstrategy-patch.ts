import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function createXcnstrategyPatch() {
  console.log('=== Creating xcnstrategy Trade Patch ===\n');
  console.log('Goal: Add 604 missing trades from vw_trades_canonical to v3\n');

  // Step 1: Get schema of pm_trades_canonical_v3
  console.log('Step 1: Getting pm_trades_canonical_v3 schema...\n');

  const schemaQuery = `DESCRIBE pm_trades_canonical_v3`;
  const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
  const schema = await schemaResult.json<any[]>();

  console.log('pm_trades_canonical_v3 schema:');
  schema.forEach(col => {
    console.log(`  ${col.name.padEnd(35)} ${col.type}`);
  });
  console.log('');

  // Step 2: Identify missing trades
  console.log('Step 2: Identifying missing trades...\n');

  const missingQuery = `
    WITH
      v3_trades AS (
        SELECT DISTINCT transaction_hash
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${EOA}')
      ),
      vw_trades AS (
        SELECT DISTINCT transaction_hash
        FROM vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${EOA}')
      )
    SELECT
      (SELECT count() FROM vw_trades) AS vw_count,
      (SELECT count() FROM v3_trades) AS v3_count,
      (SELECT count() FROM vw_trades WHERE transaction_hash NOT IN (SELECT transaction_hash FROM v3_trades)) AS missing_count
  `;

  const missingResult = await clickhouse.query({ query: missingQuery, format: 'JSONEachRow' });
  const missingData = await missingResult.json<any[]>();

  console.log(`vw_trades_canonical count: ${missingData[0].vw_count}`);
  console.log(`pm_trades_canonical_v3 count: ${missingData[0].v3_count}`);
  console.log(`Missing trades: ${missingData[0].missing_count}`);
  console.log('');

  // Step 3: Create patch table
  console.log('Step 3: Creating tmp_xcnstrategy_trades_patch_v3...\n');

  const dropQuery = `DROP TABLE IF EXISTS tmp_xcnstrategy_trades_patch_v3`;
  await clickhouse.command({ query: dropQuery });

  const createQuery = `
    CREATE TABLE tmp_xcnstrategy_trades_patch_v3
    (
      trade_key String,
      wallet_address String,
      transaction_hash String,
      timestamp DateTime,
      market_id_norm String,
      condition_id_norm_v3 String,
      outcome_index_v3 Int16,
      trade_direction Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3),
      shares Decimal(18, 8),
      usd_value Decimal(18, 2),
      price Decimal(18, 8),
      patched_from String,
      created_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree()
    ORDER BY (wallet_address, timestamp, trade_key)
  `;

  await clickhouse.command({ query: createQuery });
  console.log('✅ Table created\n');

  // Step 4: Populate patch table with missing trades (normalized condition_id)
  console.log('Step 4: Populating patch table with normalized condition_ids...\n');

  const insertQuery = `
    INSERT INTO tmp_xcnstrategy_trades_patch_v3
    (
      trade_key,
      wallet_address,
      transaction_hash,
      timestamp,
      market_id_norm,
      condition_id_norm_v3,
      outcome_index_v3,
      trade_direction,
      shares,
      usd_value,
      price,
      patched_from
    )
    SELECT
      trade_key,
      wallet_address_norm AS wallet_address,
      transaction_hash,
      timestamp,
      market_id_norm,
      lower(replace(condition_id_norm, '0x', '')) AS condition_id_norm_v3,
      outcome_index AS outcome_index_v3,
      trade_direction,
      shares,
      usd_value,
      entry_price AS price,
      'vw_trades_canonical' AS patched_from
    FROM vw_trades_canonical
    WHERE lower(wallet_address_norm) = lower('${EOA}')
      AND transaction_hash NOT IN (
        SELECT transaction_hash
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${EOA}')
      )
      AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
  `;

  await clickhouse.command({ query: insertQuery });
  console.log('✅ Patch table populated\n');

  // Step 5: Verify patch table
  console.log('Step 5: Verifying patch table...\n');

  const verifyQuery = `
    SELECT
      count() AS total_rows,
      countIf(length(condition_id_norm_v3) = 64) AS normalized_count,
      countIf(length(condition_id_norm_v3) != 64) AS wrong_length_count,
      min(timestamp) AS earliest_trade,
      max(timestamp) AS latest_trade
    FROM tmp_xcnstrategy_trades_patch_v3
  `;

  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const verify = await verifyResult.json<any[]>();

  console.log(`Total rows in patch: ${verify[0].total_rows}`);
  console.log(`Normalized (64 chars): ${verify[0].normalized_count}`);
  console.log(`Wrong length: ${verify[0].wrong_length_count}`);
  console.log(`Date range: ${verify[0].earliest_trade} to ${verify[0].latest_trade}`);
  console.log('');

  // Sample patch records
  const sampleQuery = `
    SELECT
      trade_key,
      condition_id_norm_v3,
      length(condition_id_norm_v3) AS len,
      trade_direction,
      shares,
      usd_value,
      timestamp
    FROM tmp_xcnstrategy_trades_patch_v3
    ORDER BY timestamp DESC
    LIMIT 5
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json<any[]>();

  console.log('Sample patch records:');
  samples.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.timestamp} | ${s.trade_direction} | ${Number(s.shares).toFixed(2)} @ $${Number(s.usd_value).toFixed(2)}`);
    console.log(`      condition_id: ${s.condition_id_norm_v3} (len=${s.len})`);
  });
  console.log('');

  // Step 6: Create union test view
  console.log('Step 6: Creating vw_trades_canonical_v3_xcnstrategy_test...\n');

  const dropViewQuery = `DROP VIEW IF EXISTS vw_trades_canonical_v3_xcnstrategy_test`;
  await clickhouse.command({ query: dropViewQuery });

  const createViewQuery = `
    CREATE VIEW vw_trades_canonical_v3_xcnstrategy_test AS
    SELECT
      trade_key,
      wallet_address,
      transaction_hash,
      timestamp,
      market_id_norm,
      condition_id_norm_v3,
      outcome_index_v3,
      trade_direction,
      shares,
      usd_value,
      price,
      'pm_trades_canonical_v3' AS source
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')

    UNION ALL

    SELECT
      trade_key,
      wallet_address,
      transaction_hash,
      timestamp,
      market_id_norm,
      condition_id_norm_v3,
      outcome_index_v3,
      trade_direction,
      shares,
      usd_value,
      price,
      patched_from AS source
    FROM tmp_xcnstrategy_trades_patch_v3
  `;

  await clickhouse.command({ query: createViewQuery });
  console.log('✅ Union test view created\n');

  // Step 7: Verify union view
  console.log('Step 7: Verifying union view...\n');

  const unionVerifyQuery = `
    SELECT
      source,
      count() AS trade_count
    FROM vw_trades_canonical_v3_xcnstrategy_test
    GROUP BY source
    ORDER BY trade_count DESC
  `;

  const unionVerifyResult = await clickhouse.query({ query: unionVerifyQuery, format: 'JSONEachRow' });
  const unionVerify = await unionVerifyResult.json<any[]>();

  console.log('Trade counts by source:');
  unionVerify.forEach(row => {
    console.log(`  ${row.source}: ${row.trade_count} trades`);
  });

  const totalUnion = unionVerify.reduce((sum, row) => sum + Number(row.trade_count), 0);
  console.log(`  ────────────────────────────────`);
  console.log(`  TOTAL: ${totalUnion} trades`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('✅ PATCH COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('Created:');
  console.log('  - tmp_xcnstrategy_trades_patch_v3 (patch table)');
  console.log('  - vw_trades_canonical_v3_xcnstrategy_test (union view)');
  console.log('');
  console.log(`Expected total trades: ${missingData[0].vw_count}`);
  console.log(`Actual total trades: ${totalUnion}`);
  console.log(`Match: ${totalUnion === Number(missingData[0].vw_count) ? '✅' : '❌'}`);
  console.log('');
  console.log('Next: Run scripts/25-xcnstrategy-pnl-from-union.ts to calculate PnL');
  console.log('');
}

createXcnstrategyPatch().catch(console.error);
