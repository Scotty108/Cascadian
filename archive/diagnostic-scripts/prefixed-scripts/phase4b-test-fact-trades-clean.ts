import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client';

async function testFactTradesClean() {
  console.log('=== Phase 4B: Testing fact_trades_clean (Corrected) ===\n');

  // Test 1: Coverage and wallet attribution
  console.log('Test 1: Coverage and wallet attribution...\n');

  try {
    const coverageResult = await clickhouse.query({
      query: `
        SELECT
          'fact_trades_clean' AS source,
          count() AS total_orphans,
          countIf(ftc.cid IS NOT NULL AND ftc.cid != '') AS has_cid,
          round(100.0 * countIf(ftc.cid IS NOT NULL AND ftc.cid != '') / count(), 2) AS potential_repair_pct,
          -- Check wallet attribution (C1's main concern)
          countIf(ftc.wallet_address = o.wallet_address) AS wallet_match,
          countIf(ftc.wallet_address != o.wallet_address AND ftc.cid IS NOT NULL) AS wallet_mismatch,
          round(100.0 * countIf(ftc.wallet_address = o.wallet_address) / countIf(ftc.cid IS NOT NULL), 2) AS wallet_match_pct
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN fact_trades_clean ftc
          ON o.transaction_hash = ftc.tx_hash
      `,
      format: 'JSONEachRow'
    });

    const coverage = await coverageResult.json();
    console.log('Coverage and wallet attribution:');
    console.log(JSON.stringify(coverage, null, 2));
  } catch (e) {
    console.error('Coverage test error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 2: Row inflation (multiple trades per tx_hash)
  console.log('Test 2: Row inflation check (multi-trade transactions)...\n');

  try {
    const inflationResult = await clickhouse.query({
      query: `
        SELECT
          ftc.tx_hash,
          count() AS trade_count,
          groupArray(ftc.cid) AS cids,
          groupArray(ftc.wallet_address) AS wallets,
          groupArray(ftc.direction) AS directions
        FROM tmp_v3_orphans_oct2024 o
        INNER JOIN fact_trades_clean ftc
          ON o.transaction_hash = ftc.tx_hash
        GROUP BY ftc.tx_hash
        HAVING trade_count > 1
        ORDER BY trade_count DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const inflation = await inflationResult.json();
    console.log(`Multi-trade transactions: ${inflation.length} found`);
    if (inflation.length > 0) {
      console.log('\nSample of transactions with multiple trades:');
      console.log(JSON.stringify(inflation.slice(0, 5), null, 2));
    }
  } catch (e) {
    console.error('Inflation test error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 3: Sample orphans with fact_trades_clean matches
  console.log('Test 3: Sample orphans with fact_trades_clean matches...\n');

  try {
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          o.transaction_hash,
          o.wallet_address AS orphan_wallet,
          ftc.cid,
          ftc.wallet_address AS ftc_wallet,
          ftc.direction,
          ftc.shares,
          ftc.price,
          (o.wallet_address = ftc.wallet_address) AS wallet_matches
        FROM tmp_v3_orphans_oct2024 o
        INNER JOIN fact_trades_clean ftc
          ON o.transaction_hash = ftc.tx_hash
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const samples = await sampleResult.json();
    console.log('Sample orphans with matches:');
    console.log(JSON.stringify(samples, null, 2));
  } catch (e) {
    console.error('Sample test error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Test 4: Compare fact_trades_clean vs trades_cid_map_v2_merged
  console.log('Test 4: Comparing fact_trades_clean vs trades_cid_map_v2_merged...\n');

  try {
    const comparisonResult = await clickhouse.query({
      query: `
        WITH ftc_coverage AS (
          SELECT
            count() AS total,
            countIf(ftc.cid IS NOT NULL) AS ftc_has_cid
          FROM tmp_v3_orphans_oct2024 o
          LEFT JOIN fact_trades_clean ftc ON o.transaction_hash = ftc.tx_hash
        ),
        map_coverage AS (
          SELECT
            count() AS total,
            countIf(m.condition_id IS NOT NULL) AS map_has_cid
          FROM tmp_v3_orphans_oct2024 o
          LEFT JOIN trades_cid_map_v2_merged m ON o.transaction_hash = m.tx_hash
        )
        SELECT
          'fact_trades_clean' AS source,
          ftc_coverage.ftc_has_cid AS can_repair,
          round(100.0 * ftc_coverage.ftc_has_cid / ftc_coverage.total, 2) AS repair_pct,
          'trades_cid_map_v2_merged' AS comparison_source,
          map_coverage.map_has_cid AS comparison_can_repair,
          round(100.0 * map_coverage.map_has_cid / map_coverage.total, 2) AS comparison_repair_pct
        FROM ftc_coverage, map_coverage
      `,
      format: 'JSONEachRow'
    });

    const comparison = await comparisonResult.json();
    console.log('Coverage comparison:');
    console.log(JSON.stringify(comparison, null, 2));
  } catch (e) {
    console.error('Comparison test error:', e);
  }

  console.log('\n=== Phase 4B Complete ===');
}

testFactTradesClean().catch(console.error);
