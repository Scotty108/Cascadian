/**
 * Print diff between engine results and API baseline
 * This is the fast validation query - runs in seconds
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const engine = process.argv[2] || 'V1';

  console.log(`\n=== Engine ${engine} vs API Baseline ===\n`);

  // Main diff query
  const diffQuery = `
    SELECT
      v.cohort_tag,
      r.wallet,
      b.pnl AS api,
      r.pnl_total AS engine,
      round(r.pnl_total - b.pnl, 2) AS diff,
      round(abs(r.pnl_total - b.pnl) / greatest(abs(b.pnl), 1) * 100, 1) AS rel_err_pct,
      r.runtime_ms,
      r.status
    FROM pm_pnl_engine_results_v1 r
    JOIN pm_pnl_baseline_api_v1 b ON r.wallet = b.wallet
    JOIN pm_validation_wallets_v1 v ON r.wallet = v.wallet
    WHERE r.engine = '${engine}'
    ORDER BY abs(r.pnl_total - b.pnl) DESC
    LIMIT 50
  `;

  const result = await clickhouse.query({ query: diffQuery, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  // Print top offenders
  console.log('Top 20 Offenders (by absolute diff):');
  console.log('─'.repeat(100));
  console.log(
    'Wallet'.padEnd(14) +
    'Cohort'.padEnd(22) +
    'API'.padStart(12) +
    'Engine'.padStart(12) +
    'Diff'.padStart(12) +
    'Err%'.padStart(10) +
    'ms'.padStart(8) +
    'Status'.padStart(10)
  );
  console.log('─'.repeat(100));

  for (const row of rows.slice(0, 20)) {
    const status = row.rel_err_pct < 10 ? '✅' : row.rel_err_pct < 50 ? '⚠️' : '❌';
    console.log(
      (row.wallet.slice(0, 12) + '..').padEnd(14) +
      row.cohort_tag.padEnd(22) +
      ('$' + Number(row.api).toFixed(2)).padStart(12) +
      ('$' + Number(row.engine).toFixed(2)).padStart(12) +
      ('$' + Number(row.diff).toFixed(2)).padStart(12) +
      (Number(row.rel_err_pct).toFixed(1) + '%').padStart(10) +
      String(row.runtime_ms).padStart(8) +
      (row.status + ' ' + status).padStart(10)
    );
  }

  // Summary stats by cohort
  const summaryQuery = `
    SELECT
      v.cohort_tag,
      count() as total,
      countIf(abs(r.pnl_total - b.pnl) / greatest(abs(b.pnl), 1) < 0.10) as within_10pct,
      countIf(abs(r.pnl_total - b.pnl) / greatest(abs(b.pnl), 1) < 0.25) as within_25pct,
      countIf(r.status = 'timeout') as timeouts,
      round(avg(abs(r.pnl_total - b.pnl) / greatest(abs(b.pnl), 1) * 100), 1) as avg_err_pct,
      round(median(r.runtime_ms), 0) as median_runtime_ms
    FROM pm_pnl_engine_results_v1 r
    JOIN pm_pnl_baseline_api_v1 b ON r.wallet = b.wallet
    JOIN pm_validation_wallets_v1 v ON r.wallet = v.wallet
    WHERE r.engine = '${engine}'
    GROUP BY v.cohort_tag
    ORDER BY v.cohort_tag
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summaryRows = await summaryResult.json() as any[];

  console.log('\n\nSummary by Cohort:');
  console.log('─'.repeat(90));
  console.log(
    'Cohort'.padEnd(25) +
    'Total'.padStart(8) +
    '<10%'.padStart(8) +
    '<25%'.padStart(8) +
    'Timeout'.padStart(10) +
    'AvgErr%'.padStart(10) +
    'Med.ms'.padStart(10) +
    'Accuracy'.padStart(12)
  );
  console.log('─'.repeat(90));

  let totalWallets = 0;
  let totalPassing = 0;

  for (const row of summaryRows) {
    const accuracy = ((row.within_10pct / row.total) * 100).toFixed(1);
    const status = Number(accuracy) >= 70 ? '✅' : Number(accuracy) >= 50 ? '⚠️' : '❌';
    totalWallets += row.total;
    totalPassing += row.within_10pct;

    console.log(
      row.cohort_tag.padEnd(25) +
      String(row.total).padStart(8) +
      String(row.within_10pct).padStart(8) +
      String(row.within_25pct).padStart(8) +
      String(row.timeouts).padStart(10) +
      (Number(row.avg_err_pct).toFixed(1) + '%').padStart(10) +
      String(row.median_runtime_ms).padStart(10) +
      (accuracy + '% ' + status).padStart(12)
    );
  }

  console.log('─'.repeat(90));
  const overallAccuracy = ((totalPassing / totalWallets) * 100).toFixed(1);
  console.log(`OVERALL: ${totalPassing}/${totalWallets} (${overallAccuracy}%) within 10% error\n`);
}

main().catch(console.error);
