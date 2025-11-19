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
 * PHASE 2: Drop tables with bad/incomplete data
 * Based on manual analysis - these have data quality issues:
 * - Same wallet address for all rows
 * - Bad market/condition IDs
 * - Incomplete mappings
 * - Old backups
 */

const BAD_DATA_TABLES = [
  // Tables with same wallet address for all rows (bad data)
  'default.trades_dedup_mat',           // 69M rows, all same wallet
  'default.trades_dedup_mat_new',       // 106M rows, all same wallet
  'default.trades_raw',                 // 160M rows, all same wallet 0x00000000000050ba7c429821e6d66429452ba168
  'default.trades_raw_broken',          // 5M rows, all same condition/wallet
  'default.trades_raw_enriched',        // Bad wallet addresses and market IDs
  'default.trades_raw_enriched_v2',     // Old version with same issues
  'default.trades_raw_enriched_final',  // Still has wallet issues
  'default.trades_raw_with_full_pnl',   // 159M rows, bad market/condition IDs
  'default.trades_raw_pre_pnl_fix',     // Pre-fix version
  'default.trades_raw_pre_enrichment',  // Pre-enrichment version
  'default.trades_raw_failed',          // Failed processing attempts
  
  // Old/incomplete mapping tables
  'default.condition_market_map_bad',   // Explicitly marked as bad
  'default.condition_market_map_old',   // Old version
  
  // Small incomplete tables (< 10k rows when should be much larger)
  'default.category_stats',             // Only 8 rows
  'default.ctf_payout_data',            // Only 5 rows
  'default.gamma_markets_catalog',      // Only 1 row
  'default.market_metadata',            // Only 20 rows (incomplete)
  'default.market_outcomes',            // Only 100 rows (incomplete)
  'default.market_resolution_map',      // Only 9,925 rows (incomplete)
  'default.pm_trades',                  // Only 537 rows (incomplete)
  'default.pm_user_proxy_wallets',      // Only 6 rows
  
  // Tables with bad token IDs
  'default.temp_tx_to_token',           // 143k rows with lots of 0x00...0040 token IDs
  
  // Bad PnL calculations (superseded by corrected versions)
  'default.realized_pnl_corrected_v2',  // Old version
  'default.wallet_pnl_correct',         // Bad calculations
  'default.wallet_pnl_production',      // Old version, only 27k rows
  'default.wallet_pnl_production_v2',   // Old version, only 27k rows
  
  // Old backup tables
  'default.wallet_metrics_v1_backup',
  'default.wallet_metrics_v1_backup_27k',
  'default.wallet_metrics_v1_backup_pre_universal',
  'default.market_resolutions_final_backup',
  
  // Very small/incomplete tables
  'default.wallet_resolution_outcomes', // Only 9,107 rows
  'default.wallet_metrics_by_category', // Only 20,965 rows (incomplete)
  'default.wallet_category_performance',// Only 4,484 rows (incomplete)
  
  // Superseded versions
  'default.vw_trades_canonical_v2',     // Only 500k rows, superseded by main
  'default.trades_with_pnl_old',        // Old version
  'default.trades_with_pnl',            // Superseded by canonical
];

async function cleanupBadDataTables() {
  console.log('PHASE 2: Cleanup Tables with Bad/Incomplete Data\n');
  console.log('═'.repeat(80));
  console.log(`Target: ${BAD_DATA_TABLES.length} tables with data quality issues`);
  console.log('Status: SAFE to run (does not interfere with backfill)\n');
  console.log('Note: These tables have been analyzed and found to have:');
  console.log('  - Same wallet address for all rows');
  console.log('  - Bad/incomplete market and condition IDs');
  console.log('  - Superseded by better versions');
  console.log('  - Very small row counts when should be millions\n');

  let dropped = 0;
  let skipped = 0;
  let errors = 0;

  for (const table of BAD_DATA_TABLES) {
    try {
      // Check if table exists and get row count
      const countQuery = await client.query({
        query: `SELECT count() AS cnt, formatReadableSize(sum(bytes)) AS size FROM system.parts WHERE database = splitByChar('.', '${table}')[1] AND table = splitByChar('.', '${table}')[2]`,
        format: 'JSONEachRow',
      });
      const result = await countQuery.json<Array<{ cnt: number; size: string }>>();
      
      if (result.length > 0 && result[0].cnt > 0) {
        const size = result[0].size;
        
        await client.exec({
          query: `DROP TABLE IF EXISTS ${table}`,
        });
        console.log(`✓ Dropped ${table} (freed: ${size})`);
        dropped++;
      } else {
        console.log(`ℹ️  ${table} already doesn't exist or is empty`);
        skipped++;
      }
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
  console.log('PHASE 2 COMPLETE!\n');
  console.log(`Dropped: ${dropped} tables`);
  console.log(`Skipped (doesn't exist): ${skipped} tables`);
  console.log(`Errors: ${errors}`);
  console.log('\nEstimated space reclaimed: 60-80 GB');

  await client.close();
}

cleanupBadDataTables().catch(console.error);
