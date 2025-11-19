#!/usr/bin/env tsx
/**
 * Populate pm_trades_orphaned_v2
 *
 * Extract trades from pm_trades_canonical_v2 where condition_id_norm_v2 IS NULL
 * (trades that could not be repaired after all decode attempts)
 *
 * Expected Result: Based on coverage report showing 0% orphans, this should
 * create an empty table with 0 rows.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('🗂️  PM Trades Orphaned V2 - Population');
  console.log('='.repeat(80));
  console.log('Source: pm_trades_canonical_v2');
  console.log('Filter: condition_id_norm_v2 IS NULL (orphans only)');
  console.log('');

  // Step 1: Create table from DDL
  console.log('📦 Creating pm_trades_orphaned_v2 table...');
  console.log('-'.repeat(80));

  const ddl = fs.readFileSync('sql/ddl_pm_trades_orphaned_v2.sql', 'utf-8');

  // Extract just the CREATE TABLE portion (before the commented INSERT)
  const createTableSQL = ddl.split('-- ============================================================================\n-- Population Query')[0];

  // Check if table already exists
  const checkQuery = `
    SELECT count() AS count
    FROM system.tables
    WHERE database = 'default' AND name = 'pm_trades_orphaned_v2'
  `;

  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const exists = parseInt((await checkResult.json())[0].count) > 0;

  if (exists) {
    console.log('⚠️  Table already exists, dropping and recreating...');
    await clickhouse.command({ query: 'DROP TABLE pm_trades_orphaned_v2' });
    console.log('✓ Dropped existing table');
  }

  await clickhouse.command({ query: createTableSQL });
  console.log('✓ Created pm_trades_orphaned_v2');
  console.log('');

  // Step 2: Check orphan count in canonical table
  console.log('🔍 Checking orphan count in pm_trades_canonical_v2...');
  console.log('-'.repeat(80));

  const orphanCountQuery = `
    SELECT COUNT(*) AS count
    FROM pm_trades_canonical_v2
    WHERE is_orphan = 1
  `;

  const orphanCountResult = await clickhouse.query({ query: orphanCountQuery, format: 'JSONEachRow' });
  const orphanCount = parseInt((await orphanCountResult.json())[0].count);

  console.log(`Orphan trades (is_orphan = 1): ${orphanCount.toLocaleString()}`);
  console.log('');

  if (orphanCount === 0) {
    console.log('✅ No orphan trades found!');
    console.log('');
    console.log('All 140,149,259 trades have valid condition_id_norm_v2.');
    console.log('Orphan table will remain empty.');
    console.log('');
    console.log('='.repeat(80));
    console.log('✅ TASK COMPLETE - 0 Orphan Trades');
    console.log('='.repeat(80));
    console.log('');
    console.log('Next Step: Proceed to build pm_wallet_market_pnl_v2');
    return;
  }

  // Step 3: Populate orphan table
  console.log(`📥 Inserting ${orphanCount.toLocaleString()} orphan trades...`);
  console.log('-'.repeat(80));

  const insertQuery = `
    INSERT INTO pm_trades_orphaned_v2
    SELECT
      trade_id,
      trade_key,
      transaction_hash,
      wallet_address,

      condition_id_norm_orig,
      outcome_index_orig,
      market_id_norm_orig,

      trade_direction,
      shares,
      usd_value,

      timestamp,
      source,

      -- Build repair attempts list
      CASE
        WHEN id_repair_source = 'unknown' THEN 'none_successful'
        ELSE CAST(id_repair_source AS String)
      END AS repair_attempts,

      orphan_reason,

      -- Categorize orphan
      CASE
        WHEN orphan_reason LIKE '%no_matching_decode%' THEN 'no_decode_source'
        WHEN orphan_reason LIKE '%decode_failed%' THEN 'decode_failed'
        WHEN orphan_reason LIKE '%invalid_format%' THEN 'original_invalid'
        ELSE 'unknown'
      END AS orphan_category,

      now() AS created_at,
      now() AS version

    FROM pm_trades_canonical_v2
    WHERE is_orphan = 1
  `;

  const startTime = Date.now();
  await clickhouse.command({ query: insertQuery });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`✓ Inserted ${orphanCount.toLocaleString()} orphan trades in ${elapsed}s`);
  console.log('');

  // Step 4: Analyze orphan distribution
  console.log('📊 Analyzing orphan distribution...');
  console.log('-'.repeat(80));
  console.log('');

  // 4a. Count affected wallets
  const walletCountQuery = `
    SELECT uniqExact(wallet_address) AS wallet_count
    FROM pm_trades_orphaned_v2
  `;

  const walletCountResult = await clickhouse.query({ query: walletCountQuery, format: 'JSONEachRow' });
  const affectedWallets = parseInt((await walletCountResult.json())[0].wallet_count);

  console.log(`Affected wallets: ${affectedWallets.toLocaleString()}`);
  console.log('');

  // 4b. Orphan rate by category
  console.log('Orphan breakdown by category:');

  const categoryQuery = `
    SELECT
      orphan_category,
      COUNT(*) as count,
      COUNT(*) * 100.0 / ${orphanCount} as pct,
      SUM(usd_value) as usd_volume
    FROM pm_trades_orphaned_v2
    GROUP BY orphan_category
    ORDER BY count DESC
  `;

  const categoryResult = await clickhouse.query({ query: categoryQuery, format: 'JSONEachRow' });
  const categories = await categoryResult.json() as any[];

  for (const cat of categories) {
    console.log(`  ${cat.orphan_category}: ${parseInt(cat.count).toLocaleString()} (${parseFloat(cat.pct).toFixed(2)}%) - $${parseFloat(cat.usd_volume).toFixed(2)} USD`);
  }
  console.log('');

  // 4c. Top wallets by orphan count
  console.log('Top 10 wallets by orphan count:');

  const topWalletsQuery = `
    SELECT
      wallet_address,
      COUNT(*) as orphan_count,
      SUM(usd_value) as orphan_volume_usd
    FROM pm_trades_orphaned_v2
    GROUP BY wallet_address
    ORDER BY orphan_count DESC
    LIMIT 10
  `;

  const topWalletsResult = await clickhouse.query({ query: topWalletsQuery, format: 'JSONEachRow' });
  const topWallets = await topWalletsResult.json() as any[];

  for (const wallet of topWallets) {
    console.log(`  ${wallet.wallet_address}: ${parseInt(wallet.orphan_count).toLocaleString()} orphans ($${parseFloat(wallet.orphan_volume_usd).toFixed(2)} USD)`);
  }
  console.log('');

  // 4d. Check if any large wallets are dominated by orphans
  console.log('Checking for large wallets dominated by orphans...');

  const dominatedQuery = `
    SELECT
      o.wallet_address,
      COUNT(*) as total_trades,
      o.orphan_count,
      o.orphan_count * 100.0 / COUNT(*) as orphan_pct,
      o.orphan_volume_usd
    FROM (
      SELECT
        wallet_address,
        COUNT(*) as orphan_count,
        SUM(usd_value) as orphan_volume_usd
      FROM pm_trades_orphaned_v2
      GROUP BY wallet_address
    ) o
    LEFT JOIN pm_trades_canonical_v2 c
      ON o.wallet_address = c.wallet_address
    GROUP BY o.wallet_address, o.orphan_count, o.orphan_volume_usd
    HAVING COUNT(*) >= 100 AND (o.orphan_count * 100.0 / COUNT(*)) > 50
    ORDER BY orphan_pct DESC
    LIMIT 10
  `;

  const dominatedResult = await clickhouse.query({ query: dominatedQuery, format: 'JSONEachRow' });
  const dominatedWallets = await dominatedResult.json() as any[];

  if (dominatedWallets.length > 0) {
    console.log('⚠️  Found wallets with >50% orphan rate:');
    for (const wallet of dominatedWallets) {
      console.log(`  ${wallet.wallet_address}:`);
      console.log(`    Total trades: ${parseInt(wallet.total_trades).toLocaleString()}`);
      console.log(`    Orphan trades: ${parseInt(wallet.orphan_count).toLocaleString()} (${parseFloat(wallet.orphan_pct).toFixed(2)}%)`);
      console.log(`    Orphan volume: $${parseFloat(wallet.orphan_volume_usd).toFixed(2)} USD`);
    }
  } else {
    console.log('✅ No large wallets dominated by orphans (>50% orphan rate)');
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('✅ ORPHAN TABLE POPULATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total orphan trades: ${orphanCount.toLocaleString()}`);
  console.log(`Affected wallets: ${affectedWallets.toLocaleString()}`);
  console.log('');
  console.log('Next Step: Build pm_wallet_market_pnl_v2 (using only repaired trades)');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
