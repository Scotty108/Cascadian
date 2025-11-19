#!/usr/bin/env npx tsx
/**
 * Export Wallet Metrics to CSV (Flat Structure)
 *
 * Creates a flat CSV file with one row per wallet/time_window combination.
 * Columns: wallet_address, time_window, realized_pnl, roi_pct, omega_ratio, ...
 *
 * Output: exports/wallet_metrics_flat_TIMESTAMP.csv
 * Format: RFC 4180 compliant, UTF-8 with BOM
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('EXPORTING WALLET METRICS TO CSV (FLAT)');
  console.log('═'.repeat(100) + '\n');

  try {
    // Ensure exports directory exists
    const exportsDir = resolve(process.cwd(), 'exports');
    mkdirSync(exportsDir, { recursive: true });

    console.log('1️⃣  Fetching wallet metrics from database...\n');

    const query = `
      SELECT
        wallet_address,
        time_window,
        realized_pnl,
        unrealized_payout,
        roi_pct,
        win_rate,
        sharpe_ratio,
        omega_ratio,
        total_trades,
        markets_traded,
        calculated_at
      FROM default.wallet_metrics
      ORDER BY wallet_address, time_window
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const rows = await result.json<any[]>();

    console.log(`   ✅ Fetched ${rows.length.toLocaleString()} rows\n`);

    // Build CSV
    console.log('2️⃣  Building CSV...\n');

    const headers = [
      'wallet_address',
      'time_window',
      'realized_pnl',
      'unrealized_payout',
      'roi_pct',
      'win_rate',
      'sharpe_ratio',
      'omega_ratio',
      'total_trades',
      'markets_traded',
      'calculated_at'
    ];

    let csv = headers.join(',') + '\n';

    rows.forEach(row => {
      const values = [
        row.wallet_address,
        row.time_window,
        parseFloat(row.realized_pnl).toFixed(2),
        parseFloat(row.unrealized_payout).toFixed(2),
        parseFloat(row.roi_pct).toFixed(2),
        parseFloat(row.win_rate).toFixed(4),
        parseFloat(row.sharpe_ratio).toFixed(4),
        parseFloat(row.omega_ratio).toFixed(4),
        parseInt(row.total_trades),
        parseInt(row.markets_traded),
        row.calculated_at
      ];

      csv += values.join(',') + '\n';
    });

    console.log(`   ✅ Built CSV with ${rows.length.toLocaleString()} rows\n`);

    // Write to file with UTF-8 BOM
    console.log('3️⃣  Writing to file...\n');

    const timestamp = new Date().toISOString();
    const filename = `wallet_metrics_flat_${timestamp.replace(/[:.]/g, '-')}.csv`;
    const filepath = resolve(exportsDir, filename);

    // Add UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    writeFileSync(filepath, BOM + csv, 'utf-8');

    const fileSizeMB = (Buffer.byteLength(csv) / (1024 * 1024)).toFixed(2);

    console.log(`   ✅ Wrote ${filepath}`);
    console.log(`   File size: ${fileSizeMB} MB\n`);

    // Summary
    console.log('═'.repeat(100));
    console.log('EXPORT COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ Wallet metrics exported to CSV (flat structure)\n`);
    console.log(`Export details:\n`);
    console.log(`  • File: ${filename}`);
    console.log(`  • Rows: ${rows.length.toLocaleString()}`);
    console.log(`  • Columns: ${headers.length}`);
    console.log(`  • File size: ${fileSizeMB} MB`);
    console.log(`  • Format: UTF-8 with BOM, RFC 4180 compliant\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
