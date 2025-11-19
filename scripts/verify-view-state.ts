#!/usr/bin/env npx tsx
/**
 * Verify current state of vw_wallet_pnl_calculated
 * Check if it exists, what its coverage is, and whether it needs rebuilding
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('\n=== VERIFYING vw_wallet_pnl_calculated STATE ===\n');

  // Check if view exists
  console.log('1. Checking if view exists...\n');
  try {
    const viewCheck = await clickhouse.query({
      query: `SELECT COUNT(*) as cnt FROM default.vw_wallet_pnl_calculated LIMIT 1`,
      format: 'JSONEachRow'
    });
    const viewData = await viewCheck.json();
    console.log('✅ View exists\n');
  } catch (e: any) {
    console.log('❌ View does not exist');
    console.log('   Need to run update-pnl-views-with-mapping.ts\n');
    return;
  }

  // Check global coverage
  console.log('2. Global coverage check...\n');
  const globalStats = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        ROUND(100.0 * COUNT(realized_pnl_usd) / COUNT(*), 2) as coverage_pct,
        SUM(realized_pnl_usd) as total_pnl
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });
  const global = await globalStats.json();
  console.log(`Total positions: ${parseInt(global[0].total_positions).toLocaleString()}`);
  console.log(`Resolved positions: ${parseInt(global[0].resolved_positions).toLocaleString()}`);
  console.log(`Coverage: ${global[0].coverage_pct}%`);
  console.log(`Total P&L: $${parseFloat(global[0].total_pnl || 0).toLocaleString()}\n`);

  // Check pilot wallet (0x9155e8cf)
  console.log('3. Pilot wallet (0x9155e8cf) check...\n');
  const walletCheck = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        ROUND(100.0 * COUNT(realized_pnl_usd) / COUNT(*), 2) as coverage_pct,
        SUM(realized_pnl_usd) as total_pnl
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad'
    `,
    format: 'JSONEachRow'
  });
  const wallet = await walletCheck.json();
  console.log(`Total positions: ${parseInt(wallet[0].total_positions).toLocaleString()}`);
  console.log(`Resolved positions: ${parseInt(wallet[0].resolved_positions).toLocaleString()}`);
  console.log(`Coverage: ${wallet[0].coverage_pct}%`);
  console.log(`Total P&L: $${parseFloat(wallet[0].total_pnl || 0).toLocaleString()}\n`);

  // Check mapping table
  console.log('4. Mapping table status...\n');
  const mappingCheck = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM default.legacy_token_condition_map`,
    format: 'JSONEachRow'
  });
  const mapping = await mappingCheck.json();
  console.log(`Mappings available: ${parseInt(mapping[0].cnt).toLocaleString()}\n`);

  // Check vw_wallet_pnl_closed for comparison
  console.log('5. vw_wallet_pnl_closed comparison...\n');
  try {
    const closedCheck = await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT wallet) as unique_wallets,
          COUNT(*) as total_positions,
          SUM(realized_pnl_usd) as total_pnl
        FROM cascadian_clean.vw_wallet_pnl_closed
      `,
      format: 'JSONEachRow'
    });
    const closed = await closedCheck.json();
    console.log(`Unique wallets: ${parseInt(closed[0].unique_wallets).toLocaleString()}`);
    console.log(`Total positions: ${parseInt(closed[0].total_positions).toLocaleString()}`);
    console.log(`Total P&L: $${parseFloat(closed[0].total_pnl || 0).toLocaleString()}\n`);
  } catch (e: any) {
    console.log('❌ vw_wallet_pnl_closed does not exist\n');
  }

  // Assessment
  console.log('=== ASSESSMENT ===\n');
  if (parseFloat(global[0].coverage_pct) < 5) {
    console.log('❌ PROBLEM: Coverage dropped below 5%');
    console.log('   Likely cause: View was rebuilt with mapping-only logic');
    console.log('   Solution: Rebuild view with LEFT JOIN + COALESCE\n');
  } else if (parseFloat(global[0].coverage_pct) < 15) {
    console.log('⚠️  WARNING: Coverage below 15% (was 11.88%)');
    console.log('   Mapping may have been applied incorrectly');
    console.log('   Recommend: Rebuild view\n');
  } else if (parseFloat(wallet[0].coverage_pct) === 0) {
    console.log('⚠️  WARNING: Pilot wallet has 0% coverage');
    console.log('   Mappings may not be applied correctly');
    console.log('   Recommend: Rebuild view\n');
  } else {
    console.log('✅ View looks healthy');
    console.log(`   Global coverage: ${global[0].coverage_pct}%`);
    console.log(`   Pilot wallet coverage: ${wallet[0].coverage_pct}%\n`);
  }

  console.log('Next: Wait for Claude 2 resolution backfill, then rerun update-pnl-views-with-mapping.ts\n');
}

main().catch(console.error);
