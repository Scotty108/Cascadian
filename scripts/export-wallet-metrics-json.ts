#!/usr/bin/env npx tsx
/**
 * Export Wallet Metrics to JSON (Nested Structure)
 *
 * Creates a nested JSON structure organized by wallet address:
 * {
 *   "0xwallet1": {
 *     "lifetime": { realized_pnl: ..., roi_pct: ..., ... },
 *     "180d": { ... },
 *     "90d": { ... },
 *     "30d": { ... }
 *   },
 *   "0xwallet2": { ... }
 * }
 *
 * Output: exports/wallet_metrics_TIMESTAMP.json
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createWriteStream, mkdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('EXPORTING WALLET METRICS TO JSON (NESTED)');
  console.log('═'.repeat(100) + '\n');

  try {
    // Ensure exports directory exists
    const exportsDir = resolve(process.cwd(), 'exports');
    mkdirSync(exportsDir, { recursive: true });

    console.log('1️⃣  Fetching wallet metrics from database (top 1000 wallets by P&L)...\n');

    // Get top 1000 wallets by lifetime realized_pnl
    const topWalletsQuery = `
      SELECT wallet_address
      FROM default.wallet_metrics
      WHERE time_window = 'lifetime'
      ORDER BY realized_pnl DESC
      LIMIT 1000
    `;

    const topWalletsResult = await ch.query({ query: topWalletsQuery, format: 'JSONEachRow' });
    const topWallets = await topWalletsResult.json<any[]>();
    const walletList = topWallets.map(w => w.wallet_address);

    console.log(`   Selected top ${walletList.length} wallets\n`);

    // Fetch metrics for these wallets
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
      WHERE wallet_address IN (${walletList.map(w => `'${w}'`).join(',')})
      ORDER BY wallet_address, time_window
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const rows = await result.json<any[]>();

    console.log(`   ✅ Fetched ${rows.length.toLocaleString()} rows for ${walletList.length} wallets\n`);

    // Write to file using streaming
    console.log('2️⃣  Writing to file (streaming)...\n');

    const timestamp = new Date().toISOString();
    const filename = `wallet_metrics_${timestamp.replace(/[:.]/g, '-')}.json`;
    const filepath = resolve(exportsDir, filename);

    const stream = createWriteStream(filepath, { encoding: 'utf-8' });

    // Write metadata
    stream.write('{\n');
    stream.write('  "metadata": {\n');
    stream.write(`    "exported_at": "${timestamp}",\n`);
    stream.write(`    "total_wallets": ${walletList.length},\n`);
    stream.write(`    "total_rows": ${rows.length},\n`);
    stream.write('    "time_windows": ["30d", "90d", "180d", "lifetime"],\n');
    stream.write('    "schema_version": "1.0",\n');
    stream.write('    "note": "Top 1000 wallets by lifetime realized P&L"\n');
    stream.write('  },\n');
    stream.write('  "data": {\n');

    // Group by wallet and write
    let currentWallet = '';
    let walletData: Record<string, any> = {};
    let firstWallet = true;

    rows.forEach((row, index) => {
      if (row.wallet_address !== currentWallet) {
        // Write previous wallet if exists
        if (currentWallet !== '') {
          if (!firstWallet) stream.write(',\n');
          stream.write(`    "${currentWallet}": ${JSON.stringify(walletData)}`);
          firstWallet = false;
        }

        currentWallet = row.wallet_address;
        walletData = {};
      }

      walletData[row.time_window] = {
        realized_pnl: parseFloat(row.realized_pnl),
        unrealized_payout: parseFloat(row.unrealized_payout),
        roi_pct: parseFloat(row.roi_pct),
        win_rate: parseFloat(row.win_rate),
        sharpe_ratio: parseFloat(row.sharpe_ratio),
        omega_ratio: parseFloat(row.omega_ratio),
        total_trades: parseInt(row.total_trades),
        markets_traded: parseInt(row.markets_traded),
        calculated_at: row.calculated_at
      };
    });

    // Write final wallet
    if (currentWallet !== '') {
      if (!firstWallet) stream.write(',\n');
      stream.write(`    "${currentWallet}": ${JSON.stringify(walletData)}\n`);
    }

    stream.write('  }\n');
    stream.write('}\n');
    stream.end();

    // Wait for stream to finish
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    const fs = require('fs');
    const stats = fs.statSync(filepath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`   ✅ Wrote ${filepath}`);
    console.log(`   File size: ${fileSizeMB} MB\n`);

    // Summary
    console.log('═'.repeat(100));
    console.log('EXPORT COMPLETE');
    console.log('═'.repeat(100));
    console.log(`\n✅ Wallet metrics exported to JSON (nested structure)\n`);
    console.log(`Export details:\n`);
    console.log(`  • File: ${filename}`);
    console.log(`  • Wallets: ${walletList.length.toLocaleString()} (top 1000 by P&L)`);
    console.log(`  • Total rows: ${rows.length.toLocaleString()}`);
    console.log(`  • File size: ${fileSizeMB} MB`);
    console.log(`  • Format: UTF-8 JSON\n`);

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
