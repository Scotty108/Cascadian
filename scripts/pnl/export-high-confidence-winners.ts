/**
 * Export High-Confidence Realized Winners
 *
 * Produces a CSV of wallets suitable for copy-trading, passing all filters:
 * - external_sells_ratio <= 0.05 (minimal external token activity)
 * - open_exposure_ratio <= 0.25 (mostly resolved positions)
 * - taker_ratio <= 0.15 (primarily maker trades - replicable)
 * - trade_count >= 50 (sufficient history)
 * - realized_pnl > 0 (actually profitable on closed positions)
 *
 * Output: exports/high_confidence_realized_winners_YYYYMMDD.csv
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

interface ExportRow {
  wallet: string;
  realized_pnl: number;
  engine_pnl: number;
  trade_count: number;
  profit_factor: number;
  external_sells_ratio: number;
  open_exposure_ratio: number;
  taker_ratio: number;
  computed_at: string;
}

// Export criteria - keep in sync with docs/ops/pnl_jobs.md
const EXPORT_QUERY = `
SELECT
  wallet,
  realized_pnl,
  engine_pnl,
  trade_count,
  profit_factor,
  external_sells_ratio,
  open_exposure_ratio,
  taker_ratio,
  toString(computed_at) as computed_at
FROM pm_wallet_engine_pnl_cache FINAL
WHERE external_sells_ratio <= 0.05
  AND open_exposure_ratio <= 0.25
  AND taker_ratio <= 0.15
  AND trade_count >= 50
  AND realized_pnl > 0
ORDER BY realized_pnl DESC
`;

async function main() {
  const client = getClickHouseClient();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  console.log('=== EXPORT HIGH-CONFIDENCE REALIZED WINNERS ===\n');

  // Ensure exports directory exists
  const exportsDir = path.join(process.cwd(), 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // Run query
  console.log('Running export query...');
  const result = await client.query({
    query: EXPORT_QUERY,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as ExportRow[];

  console.log(`Found ${rows.length} wallets passing all criteria\n`);

  if (rows.length === 0) {
    console.log('No wallets to export. Exiting.');
    return;
  }

  // Generate CSV
  const headers = [
    'wallet',
    'realized_pnl',
    'engine_pnl',
    'trade_count',
    'profit_factor',
    'external_sells_ratio',
    'open_exposure_ratio',
    'taker_ratio',
    'computed_at',
  ];

  const csvLines = [headers.join(',')];
  for (const row of rows) {
    csvLines.push([
      row.wallet,
      row.realized_pnl.toFixed(2),
      row.engine_pnl.toFixed(2),
      row.trade_count,
      row.profit_factor.toFixed(4),
      row.external_sells_ratio.toFixed(6),
      row.open_exposure_ratio.toFixed(6),
      row.taker_ratio.toFixed(6),
      row.computed_at,
    ].join(','));
  }

  const csvContent = csvLines.join('\n');
  const csvPath = path.join(exportsDir, `high_confidence_realized_winners_${date}.csv`);
  fs.writeFileSync(csvPath, csvContent);

  console.log(`Exported to: ${csvPath}`);
  console.log(`Total rows: ${rows.length}`);

  // Summary stats
  const totalRealizedPnl = rows.reduce((sum, r) => sum + r.realized_pnl, 0);
  const avgRealizedPnl = totalRealizedPnl / rows.length;
  const medianRealizedPnl = rows[Math.floor(rows.length / 2)]?.realized_pnl || 0;

  console.log('\n=== SUMMARY ===');
  console.log(`Total realized PnL: $${(totalRealizedPnl / 1000).toFixed(1)}k`);
  console.log(`Average realized PnL: $${avgRealizedPnl.toFixed(0)}`);
  console.log(`Median realized PnL: $${medianRealizedPnl.toFixed(0)}`);

  // Top 10 preview
  console.log('\nTop 10 by realized PnL:');
  for (const r of rows.slice(0, 10)) {
    const realized = `$${(r.realized_pnl / 1000).toFixed(1)}k`;
    const tkr = `${(r.taker_ratio * 100).toFixed(1)}%`;
    console.log(`  ${r.wallet.slice(0, 16)}.. | R=${realized.padStart(9)} | tkr=${tkr.padStart(5)} | ${r.trade_count} trades`);
  }

  // Also save query for reference
  const queryPath = path.join(exportsDir, `high_confidence_realized_winners_${date}_query.sql`);
  fs.writeFileSync(queryPath, `-- Export query for high_confidence_realized_winners_${date}.csv\n${EXPORT_QUERY}`);
  console.log(`\nQuery saved to: ${queryPath}`);
}

main().catch(console.error);
