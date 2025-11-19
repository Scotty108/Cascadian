#!/usr/bin/env npx tsx
/**
 * Fill Missing Wallet Metric Rows
 *
 * Ensures every wallet has exactly 4 rows (one per time window).
 * Inserts 0-value rows for windows where wallet had no trades.
 *
 * Expected runtime: 30-60 seconds
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('FILLING MISSING WALLET METRIC ROWS');
  console.log('═'.repeat(100) + '\n');

  try {
    const nowDate = new Date();
    const now = nowDate.toISOString().slice(0, 19).replace('T', ' ');

    // Step 1: Get complete list of ALL unique wallets across all time windows
    console.log('1️⃣  Getting complete list of unique wallets...\n');

    const allWalletsQuery = `
      CREATE OR REPLACE VIEW default.all_unique_wallets AS
      SELECT DISTINCT wallet_address
      FROM default.wallet_metrics
    `;
    await ch.query({ query: allWalletsQuery });

    const walletCountQuery = `SELECT count() as total FROM default.all_unique_wallets`;
    const walletCountResult = await ch.query({ query: walletCountQuery, format: 'JSONEachRow' });
    const walletCountData = await walletCountResult.json<any[]>();
    const totalUniqueWallets = parseInt(walletCountData[0].total);

    console.log(`   Found ${totalUniqueWallets.toLocaleString()} unique wallets\n`);

    // Step 2: For each time window, insert 0-value rows for wallets that don't have that window yet
    console.log('2️⃣  Filling missing rows per window...\n');

    const windows = ['30d', '90d', '180d', 'lifetime'];

    for (const window of windows) {
      console.log(`   Processing ${window} window...`);

      const fillSQL = `
        INSERT INTO default.wallet_metrics
        SELECT
          w.wallet_address,
          '${window}' as time_window,
          0 as realized_pnl,
          0 as unrealized_payout,
          0 as roi_pct,
          0 as win_rate,
          0 as sharpe_ratio,
          0 as omega_ratio,
          0 as total_trades,
          0 as markets_traded,
          toDateTime('${now}') as calculated_at,
          toDateTime('${now}') as updated_at
        FROM default.all_unique_wallets w
        LEFT JOIN (
          SELECT wallet_address
          FROM default.wallet_metrics
          WHERE time_window = '${window}'
        ) existing
        ON w.wallet_address = existing.wallet_address
        WHERE existing.wallet_address IS NULL
      `;

      const startTime = Date.now();
      const result = await ch.query({ query: fillSQL });
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Check total rows for this window
      const countQuery = `
        SELECT count() as total_rows
        FROM default.wallet_metrics
        WHERE time_window = '${window}'
      `;
      const countResult = await ch.query({ query: countQuery, format: 'JSONEachRow' });
      const countData = await countResult.json<any[]>();
      const totalRows = parseInt(countData[0].total_rows);
      const addedRows = totalRows === totalUniqueWallets ? 0 : (totalUniqueWallets - totalRows);

      console.log(`     • Added ${addedRows.toLocaleString()} rows (now ${totalRows.toLocaleString()} total) (${elapsed}s)\n`);
    }

    // Verify final row count
    console.log('Verifying final row count...\n');

    const verifyQuery = `
      SELECT
        count(DISTINCT wallet_address) as unique_wallets,
        count() as total_rows
      FROM default.wallet_metrics
    `;

    const verifyResult = await ch.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json<any[]>();

    const uniqueWallets = parseInt(verifyData[0].unique_wallets);
    const totalRows = parseInt(verifyData[0].total_rows);
    const expectedRows = uniqueWallets * 4;

    console.log(`Final Stats:`);
    console.log(`  • Unique wallets: ${uniqueWallets.toLocaleString()}`);
    console.log(`  • Total rows: ${totalRows.toLocaleString()}`);
    console.log(`  • Expected: ${expectedRows.toLocaleString()} (${uniqueWallets.toLocaleString()} × 4)`);
    console.log(`  • Status: ${totalRows === expectedRows ? '✅ PASS' : `⚠️ Mismatch`}\n`);

    console.log('═'.repeat(100));
    console.log('MISSING ROWS FILLED');
    console.log('═'.repeat(100) + '\n');

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
