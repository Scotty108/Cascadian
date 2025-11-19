import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client';

async function diagnoseFactTradesClean() {
  console.log('=== Phase 4C: Diagnosing fact_trades_clean Zero Matches ===\n');

  // Test 1: Does fact_trades_clean have data at all?
  console.log('Test 1: fact_trades_clean basic stats...\n');

  try {
    const statsResult = await clickhouse.query({
      query: `
        SELECT
          count() AS total_rows,
          count(DISTINCT tx_hash) AS unique_tx_hashes,
          count(DISTINCT cid) AS unique_condition_ids,
          count(DISTINCT wallet_address) AS unique_wallets,
          min(block_time) AS earliest_trade,
          max(block_time) AS latest_trade
        FROM fact_trades_clean
      `,
      format: 'JSONEachRow'
    });

    const stats = await statsResult.json();
    console.log('fact_trades_clean stats:');
    console.log(JSON.stringify(stats, null, 2));
  } catch (e) {
    console.error('Stats error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 2: Sample tx_hash format from fact_trades_clean
  console.log('Test 2: tx_hash format in fact_trades_clean...\n');

  try {
    const formatResult = await clickhouse.query({
      query: `
        SELECT
          tx_hash,
          length(tx_hash) AS hash_length,
          substring(tx_hash, 1, 10) AS hash_prefix,
          cid,
          wallet_address
        FROM fact_trades_clean
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const formats = await formatResult.json();
    console.log('Sample tx_hash formats:');
    console.log(JSON.stringify(formats, null, 2));
  } catch (e) {
    console.error('Format test error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 3: Sample tx_hash format from orphans
  console.log('Test 3: transaction_hash format in tmp_v3_orphans_oct2024...\n');

  try {
    const orphanFormatResult = await clickhouse.query({
      query: `
        SELECT
          transaction_hash,
          length(transaction_hash) AS hash_length,
          substring(transaction_hash, 1, 10) AS hash_prefix,
          wallet_address,
          market_id
        FROM tmp_v3_orphans_oct2024
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const orphanFormats = await orphanFormatResult.json();
    console.log('Sample orphan transaction_hash formats:');
    console.log(JSON.stringify(orphanFormats, null, 2));
  } catch (e) {
    console.error('Orphan format test error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 4: Do ANY orphan tx_hashes exist in fact_trades_clean?
  console.log('Test 4: Direct overlap check...\n');

  try {
    const overlapResult = await clickhouse.query({
      query: `
        SELECT
          count(DISTINCT o.transaction_hash) AS total_orphan_hashes,
          countIf(ftc.tx_hash IS NOT NULL) AS found_in_fact_trades,
          round(100.0 * countIf(ftc.tx_hash IS NOT NULL) / count(DISTINCT o.transaction_hash), 2) AS overlap_pct
        FROM (
          SELECT DISTINCT transaction_hash
          FROM tmp_v3_orphans_oct2024
        ) o
        LEFT JOIN (
          SELECT DISTINCT tx_hash
          FROM fact_trades_clean
        ) ftc
        ON o.transaction_hash = ftc.tx_hash
      `,
      format: 'JSONEachRow'
    });

    const overlap = await overlapResult.json();
    console.log('Overlap check:');
    console.log(JSON.stringify(overlap, null, 2));
  } catch (e) {
    console.error('Overlap test error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 5: Check if fact_trades_clean covers October 2024
  console.log('Test 5: fact_trades_clean temporal coverage...\n');

  try {
    const temporalResult = await clickhouse.query({
      query: `
        SELECT
          toYYYYMM(block_time) AS month,
          count() AS trade_count,
          count(DISTINCT tx_hash) AS unique_txs,
          count(DISTINCT cid) AS unique_conditions
        FROM fact_trades_clean
        WHERE block_time >= '2024-10-01' AND block_time < '2024-11-01'
        GROUP BY month
        ORDER BY month
      `,
      format: 'JSONEachRow'
    });

    const temporal = await temporalResult.json();
    console.log('October 2024 coverage in fact_trades_clean:');
    console.log(JSON.stringify(temporal, null, 2));
  } catch (e) {
    console.error('Temporal test error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 6: What time range do orphans cover?
  console.log('Test 6: Orphan temporal coverage...\n');

  try {
    const orphanTemporalResult = await clickhouse.query({
      query: `
        SELECT
          min(block_time) AS earliest_orphan,
          max(block_time) AS latest_orphan,
          count() AS total_orphans,
          count(DISTINCT transaction_hash) AS unique_txs
        FROM tmp_v3_orphans_oct2024
      `,
      format: 'JSONEachRow'
    });

    const orphanTemporal = await orphanTemporalResult.json();
    console.log('Orphan time range:');
    console.log(JSON.stringify(orphanTemporal, null, 2));
  } catch (e) {
    console.error('Orphan temporal test error:', e);
  }

  console.log('\n=== Phase 4C Complete ===');
}

diagnoseFactTradesClean().catch(console.error);
