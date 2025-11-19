#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

/**
 * PHASE 6: Drop Bad Wallet Metric Tables
 * Target: Wallet tables built from bad source data (trades_raw, etc.)
 * Risk: LOW - these contain static/bad data from dropped source tables
 *
 * Evidence:
 * - Contain problematic wallet address 0x00000000000050ba7c429821e6d66429452ba168
 * - Built from source tables already dropped in Phase 2
 * - User confirmed: "wallet_realized_pnl_final is not good or real numbers"
 * - User confirmed: "wallet_metrics" and "wallets_dim" are "not real or useful"
 */

const BAD_WALLET_TABLES = [
  // Old version
  'default.wallet_metrics_v1',           // 986K rows - old version, superseded

  // Confirmed bad data by user + analysis
  'default.wallet_realized_pnl_final',   // 935K rows - user: "not good or real numbers"
  'default.wallet_metrics',              // 996K rows - user: "not real or useful"
  'default.wallets_dim',                 // 65K rows - user: "not real or useful"
];

async function cleanupBadWalletTables() {
  console.log('PHASE 6: Cleanup Bad Wallet Metric Tables\n');
  console.log('═'.repeat(80));
  console.log(`Target: ${BAD_WALLET_TABLES.length} wallet tables with bad data`);
  console.log('Risk: LOW - contains static/bad data from dropped source tables\n');

  console.log('⚠️  WARNING: These tables contain data from bad source tables');
  console.log('   Evidence: Problematic wallet 0x00000000000050ba7c...');
  console.log('   User confirmed: Not real/useful data\n');

  console.log('Tables to be dropped:');
  console.log('  - wallet_metrics_v1 (old version)');
  console.log('  - wallet_realized_pnl_final (confirmed bad by user)');
  console.log('  - wallet_metrics (confirmed bad by user)');
  console.log('  - wallets_dim (confirmed bad by user)\n');

  // Show what we're keeping
  console.log('Tables to KEEP (for now):');
  console.log('  ✅ cascadian_clean.system_wallet_map (23.2M rows - production mapping)');
  console.log('  ✅ wallet_metrics_complete (1M rows - review after backfill)');
  console.log('  ✅ realized_pnl_by_market_final (13.7M rows - may need rebuild)');
  console.log('  ✅ wallet_pnl_summary_final (935K rows - rebuild after backfill)');
  console.log('  ✅ wallet_metrics_daily (14.3M rows - materialized view)');
  console.log('  ✅ wallet_metrics_30d (12.8K rows - materialized view)\n');

  let dropped = 0;
  let skipped = 0;
  let errors = 0;
  let freedSpace = 0;

  console.log('Dropping tables...\n');

  for (const table of BAD_WALLET_TABLES) {
    try {
      // Get size before dropping
      const sizeQuery = await client.query({
        query: `
          SELECT formatReadableSize(total_bytes) AS size
          FROM system.tables
          WHERE database = '${table.split('.')[0]}' AND name = '${table.split('.')[1]}'
        `,
        format: 'JSONEachRow',
      });

      const sizeResult = await sizeQuery.json<any[]>();
      const size = sizeResult.length > 0 ? sizeResult[0].size : 'unknown';

      await client.exec({
        query: `DROP TABLE IF EXISTS ${table}`,
      });

      console.log(`✓ Dropped ${table} (${size})`);
      dropped++;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unknown table')) {
        console.log(`ℹ️  ${table} already doesn't exist`);
        skipped++;
      } else {
        console.error(`✗ Error dropping ${table}:`, err);
        errors++;
      }
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('PHASE 6 COMPLETE!\n');
  console.log(`Dropped: ${dropped} tables`);
  console.log(`Skipped (doesn't exist): ${skipped} tables`);
  console.log(`Errors: ${errors}`);
  console.log('\nSpace freed: ~102 MiB (estimate)\n');

  console.log('Next steps:');
  console.log('  1. After backfill completes, check if wallet_metrics_complete updates');
  console.log('  2. Consider rebuilding realized_pnl_by_market_final from clean data');
  console.log('  3. Rebuild wallet_pnl_summary_final from vw_trades_canonical + resolutions');
  console.log('  4. Review materialized views for correctness\n');

  await client.close();
}

cleanupBadWalletTables().catch(console.error);
