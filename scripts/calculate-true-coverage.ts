import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const host = process.env.CLICKHOUSE_HOST;
const username = process.env.CLICKHOUSE_USER || 'default';
const password = process.env.CLICKHOUSE_PASSWORD;
const database = process.env.CLICKHOUSE_DATABASE || 'default';

if (!host || !password) {
  throw new Error('Missing ClickHouse credentials. Set CLICKHOUSE_HOST and CLICKHOUSE_PASSWORD in .env.local');
}

const client = createClient({
  url: host,
  username,
  password,
  database,
  request_timeout: 180000,
  compression: { request: true, response: true },
});

async function calculateTrueCoverage() {
  console.log('=== TRUE COVERAGE CALCULATION ===\n');

  // Step 1: Get total unique transaction universe
  console.log('Step 1: Calculating total unique transaction universe...');

  const totalTxQuery = `
    SELECT uniqExact(tx_hash) as total_unique_txs
    FROM (
      SELECT transaction_hash as tx_hash FROM vw_trades_canonical WHERE transaction_hash != ''
      UNION DISTINCT
      SELECT transaction_hash as tx_hash FROM trades_raw_enriched_final WHERE transaction_hash != ''
      UNION DISTINCT
      SELECT tx_hash FROM trade_direction_assignments WHERE tx_hash != ''
      UNION DISTINCT
      SELECT tx_hash FROM trades_with_direction WHERE tx_hash != ''
      UNION DISTINCT
      SELECT transaction_hash as tx_hash FROM trades_raw WHERE transaction_hash != ''
    )
  `;

  const totalResult = await client.query({ query: totalTxQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json();
  const totalTxs = totalData[0]?.total_unique_txs || 0;

  console.log(`Total unique transactions across all sources: ${Number(totalTxs).toLocaleString()}\n`);

  // Step 2: Calculate valid condition_id coverage
  console.log('Step 2: Calculating recoverable transactions with valid condition_ids...');

  const coverageQuery = `
    WITH valid_condition_ids AS (
      SELECT DISTINCT transaction_hash as tx_hash
      FROM vw_trades_canonical
      WHERE transaction_hash != ''
        AND condition_id_norm != ''
        AND condition_id_norm != concat('0x', repeat('0',64))
        AND length(replaceAll(condition_id_norm, '0x', '')) = 64

      UNION DISTINCT

      SELECT DISTINCT transaction_hash as tx_hash
      FROM trades_raw_enriched_final
      WHERE transaction_hash != ''
        AND condition_id != ''
        AND condition_id IS NOT NULL
        AND condition_id != 'null'

      UNION DISTINCT

      SELECT DISTINCT tx_hash
      FROM trade_direction_assignments
      WHERE tx_hash != ''
        AND condition_id_norm != ''
        AND condition_id_norm != concat('0x', repeat('0',64))
        AND length(replaceAll(condition_id_norm, '0x', '')) = 64
    )
    SELECT count() as recoverable_txs FROM valid_condition_ids
  `;

  const coverageResult = await client.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverageData = await coverageResult.json();
  const recoverableTxs = coverageData[0]?.recoverable_txs || 0;

  const coveragePct = totalTxs > 0 ? (Number(recoverableTxs) / Number(totalTxs) * 100) : 0;

  console.log(`Recoverable transactions: ${Number(recoverableTxs).toLocaleString()}`);
  console.log(`Transaction coverage: ${coveragePct.toFixed(2)}%\n`);

  // Step 3: Calculate per-wallet coverage
  console.log('Step 3: Calculating per-wallet coverage...');

  const walletCoverageQuery = `
    WITH wallet_coverage AS (
      SELECT
        wallet_address_norm,
        count() as total_trades,
        countIf(
          condition_id_norm != ''
          AND condition_id_norm != concat('0x', repeat('0',64))
          AND length(replaceAll(condition_id_norm, '0x', '')) = 64
        ) as valid_trades,
        round(valid_trades / total_trades * 100, 2) as coverage_pct
      FROM vw_trades_canonical
      WHERE wallet_address_norm != ''
      GROUP BY wallet_address_norm
      HAVING total_trades > 0
    )
    SELECT
      countIf(coverage_pct >= 80) as wallets_80pct_plus,
      countIf(coverage_pct >= 90) as wallets_90pct_plus,
      countIf(coverage_pct >= 95) as wallets_95pct_plus,
      count() as total_wallets,
      round(wallets_80pct_plus / total_wallets * 100, 2) as wallet_coverage_80_pct,
      round(wallets_90pct_plus / total_wallets * 100, 2) as wallet_coverage_90_pct,
      round(wallets_95pct_plus / total_wallets * 100, 2) as wallet_coverage_95_pct
    FROM wallet_coverage
  `;

  const walletResult = await client.query({ query: walletCoverageQuery, format: 'JSONEachRow' });
  const walletData = await walletResult.json();
  const walletStats = walletData[0] || {};

  console.log(`Wallets with ≥80% coverage: ${Number(walletStats.wallets_80pct_plus || 0).toLocaleString()} / ${Number(walletStats.total_wallets || 0).toLocaleString()} (${walletStats.wallet_coverage_80_pct || 0}%)`);
  console.log(`Wallets with ≥90% coverage: ${Number(walletStats.wallets_90pct_plus || 0).toLocaleString()} / ${Number(walletStats.total_wallets || 0).toLocaleString()} (${walletStats.wallet_coverage_90_pct || 0}%)`);
  console.log(`Wallets with ≥95% coverage: ${Number(walletStats.wallets_95pct_plus || 0).toLocaleString()} / ${Number(walletStats.total_wallets || 0).toLocaleString()} (${walletStats.wallet_coverage_95_pct || 0}%)\n`);

  // Step 4: Breakdown by source table
  console.log('Step 4: Coverage breakdown by source table...');

  const sourceBreakdown = await Promise.all([
    client.query({
      query: `
        SELECT
          countIf(condition_id_norm != '' AND condition_id_norm != concat('0x', repeat('0',64))) as valid,
          count() as total,
          round(valid / total * 100, 2) as pct
        FROM vw_trades_canonical
      `,
      format: 'JSONEachRow'
    }),
    client.query({
      query: `
        SELECT
          countIf(condition_id != '' AND condition_id IS NOT NULL AND condition_id != 'null') as valid,
          count() as total,
          round(valid / total * 100, 2) as pct
        FROM trades_raw_enriched_final
      `,
      format: 'JSONEachRow'
    }),
    client.query({
      query: `
        SELECT
          countIf(condition_id_norm != '' AND condition_id_norm != concat('0x', repeat('0',64))) as valid,
          count() as total,
          round(valid / total * 100, 2) as pct
        FROM trade_direction_assignments
      `,
      format: 'JSONEachRow'
    })
  ]);

  const canonicalStats = (await sourceBreakdown[0].json())[0] || {};
  const enrichedStats = (await sourceBreakdown[1].json())[0] || {};
  const tdaStats = (await sourceBreakdown[2].json())[0] || {};

  console.log('vw_trades_canonical:');
  console.log(`  Valid: ${Number(canonicalStats.valid || 0).toLocaleString()} / ${Number(canonicalStats.total || 0).toLocaleString()} (${canonicalStats.pct || 0}%)`);
  console.log('trades_raw_enriched_final:');
  console.log(`  Valid: ${Number(enrichedStats.valid || 0).toLocaleString()} / ${Number(enrichedStats.total || 0).toLocaleString()} (${enrichedStats.pct || 0}%)`);
  console.log('trade_direction_assignments:');
  console.log(`  Valid: ${Number(tdaStats.valid || 0).toLocaleString()} / ${Number(tdaStats.total || 0).toLocaleString()} (${tdaStats.pct || 0}%)\n`);

  // Step 5: Final verdict
  console.log('=== VERDICT ===\n');

  let verdict = '';
  let recommendation = '';

  if (coveragePct >= 85 && (walletStats.wallet_coverage_80_pct || 0) >= 80) {
    verdict = '✅ PHASE 1 SUFFICIENT';
    recommendation = 'Proceed with Phase 1 approach. Coverage is adequate for production fact_trades_v1.';
  } else if (coveragePct >= 70 && coveragePct < 85) {
    verdict = '⚠️ PHASE 1 ACCEPTABLE (WITH CAVEATS)';
    recommendation = 'Phase 1 provides reasonable coverage. Consider Phase 2 blockchain backfill for remaining gaps after initial launch.';
  } else {
    verdict = '❌ PHASE 1 INSUFFICIENT';
    recommendation = 'Coverage too low. Blockchain backfill (Phase 2) required before building fact_trades_v1.';
  }

  console.log(`Verdict: ${verdict}`);
  console.log(`\nTransaction Coverage: ${coveragePct.toFixed(2)}%`);
  console.log(`Wallet Coverage (≥80%): ${walletStats.wallet_coverage_80_pct || 0}%`);
  console.log(`Wallet Coverage (≥90%): ${walletStats.wallet_coverage_90_pct || 0}%`);
  console.log(`\nRecommendation: ${recommendation}`);

  await client.close();
}

calculateTrueCoverage().catch(console.error);
