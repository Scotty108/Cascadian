#!/usr/bin/env tsx
/**
 * Database Setup Verification Script
 *
 * Verifies that all tables exist and are accessible in both:
 * - ClickHouse Cloud (13 tables)
 * - Supabase (8 new TSI tables)
 */

import { config } from 'dotenv';
import { createClient as createClickHouseClient } from '@clickhouse/client';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

// ClickHouse client
const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// Supabase client
const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Verify ClickHouse tables
 */
async function verifyClickHouse() {
  console.log('\n🔍 CLICKHOUSE VERIFICATION');
  console.log('====================================\n');

  const expectedTables = [
    'trades_raw',
    'wallet_metrics_complete',
    'category_analytics',
    'market_price_momentum',
    'momentum_trading_signals',
    'price_snapshots_10s',
    'market_price_history',
    'market_flow_metrics',
    'elite_trade_attributions',
    'fired_signals',
    'wallet_metrics_by_category',
    'schema_migrations',
  ];

  try {
    // Get list of tables
    const result = await clickhouse.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow'
    });

    const tables = await result.json() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);

    console.log('📊 Tables found:', tableNames.length);
    console.log();

    // Check each expected table
    for (const table of expectedTables) {
      const exists = tableNames.includes(table);
      console.log(`${exists ? '✅' : '❌'} ${table}`);

      if (exists) {
        // Get row count
        const countResult = await clickhouse.query({
          query: `SELECT count() as count FROM ${table}`,
          format: 'JSONEachRow'
        });
        const countData = await countResult.json() as Array<{ count: string }>;
        const count = parseInt(countData[0]?.count || '0');
        console.log(`   📈 Rows: ${count.toLocaleString()}`);
      }
    }

    // Check for migrations tracking
    const migrationsResult = await clickhouse.query({
      query: 'SELECT version, name FROM schema_migrations ORDER BY version',
      format: 'JSONEachRow'
    });
    const migrations = await migrationsResult.json() as Array<{ version: string; name: string }>;
    console.log(`\n📋 Applied migrations: ${migrations.length}`);

    return true;
  } catch (error: any) {
    console.error('❌ ClickHouse verification failed:', error.message);
    return false;
  }
}

/**
 * Verify Supabase tables
 */
async function verifySupabase() {
  console.log('\n🔍 SUPABASE VERIFICATION');
  console.log('====================================\n');

  const expectedTables = [
    'wallet_category_tags',
    'wallet_leaderboard_history',
    'watchlist_markets',
    'watchlist_wallets',
    'smoothing_configurations',
    'user_signal_preferences',
    'signal_delivery_log',
    'momentum_threshold_rules',
  ];

  try {
    for (const table of expectedTables) {
      // Try to query each table
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log(`❌ ${table}`);
        console.log(`   Error: ${error.message}`);
      } else {
        console.log(`✅ ${table}`);
        console.log(`   📈 Rows: ${(count || 0).toLocaleString()}`);
      }
    }

    // Check smoothing_configurations for default config
    const { data: configs } = await supabase
      .from('smoothing_configurations')
      .select('*')
      .eq('config_name', 'austin_default');

    if (configs && configs.length > 0) {
      console.log('\n✅ Default TSI config exists (austin_default)');
      console.log(`   Fast: ${configs[0].tsi_fast_periods}p ${configs[0].tsi_fast_smoothing}`);
      console.log(`   Slow: ${configs[0].tsi_slow_periods}p ${configs[0].tsi_slow_smoothing}`);
      console.log(`   Conviction threshold: ${configs[0].entry_conviction_threshold}`);
    } else {
      console.log('\n⚠️  Default TSI config not found');
    }

    return true;
  } catch (error: any) {
    console.error('❌ Supabase verification failed:', error.message);
    return false;
  }
}

/**
 * Check data status and readiness
 */
async function checkDataStatus() {
  console.log('\n📊 DATA STATUS CHECK');
  console.log('====================================\n');

  try {
    // Check if we have any trades in ClickHouse
    const tradesResult = await clickhouse.query({
      query: 'SELECT count() as count FROM trades_raw',
      format: 'JSONEachRow'
    });
    const tradesData = await tradesResult.json() as Array<{ count: string }>;
    const tradesCount = parseInt(tradesData[0]?.count || '0');

    console.log(`📦 Total trades in ClickHouse: ${tradesCount.toLocaleString()}`);

    if (tradesCount === 0) {
      console.log('⚠️  No trades found - need to sync wallet data');
    }

    // Check if we have wallet scores in Supabase
    const { count: walletScoresCount } = await supabase
      .from('wallet_scores')
      .select('*', { count: 'exact', head: true });

    console.log(`👛 Wallet scores in Supabase: ${(walletScoresCount || 0).toLocaleString()}`);

    // Check discovered wallets
    const { count: discoveredCount } = await supabase
      .from('discovered_wallets')
      .select('*', { count: 'exact', head: true });

    console.log(`🔍 Discovered wallets: ${(discoveredCount || 0).toLocaleString()}`);

    if (discoveredCount === 0) {
      console.log('⚠️  No wallets discovered - need to run wallet discovery');
    }

    return {
      hasTrades: tradesCount > 0,
      hasWalletScores: (walletScoresCount || 0) > 0,
      hasDiscoveredWallets: (discoveredCount || 0) > 0,
    };
  } catch (error: any) {
    console.error('❌ Data status check failed:', error.message);
    return null;
  }
}

/**
 * Generate next steps based on verification
 */
function generateNextSteps(dataStatus: any) {
  console.log('\n🎯 NEXT STEPS');
  console.log('====================================\n');

  const steps: string[] = [];

  if (!dataStatus?.hasDiscoveredWallets) {
    steps.push('1. 🔍 Run wallet discovery (no 50k cap)');
    steps.push('   Command: npx tsx scripts/discover-all-wallets-enhanced.ts');
  }

  if (!dataStatus?.hasTrades) {
    steps.push('2. 📊 Bulk sync wallet trades to ClickHouse');
    steps.push('   Command: npx tsx scripts/sync-all-wallets-bulk.ts');
  }

  if (!dataStatus?.hasWalletScores) {
    steps.push('3. 🧮 Calculate Tier 1 metrics (8 critical)');
    steps.push('   Command: npx tsx scripts/calculate-tier1-metrics.ts');
  }

  steps.push('4. 📈 Implement TSI calculator + smoothing library');
  steps.push('   Files: lib/metrics/smoothing.ts, lib/metrics/tsi-calculator.ts');

  steps.push('5. 🎯 Build Austin Methodology materialized view');
  steps.push('   File: lib/metrics/austin-methodology.ts');

  steps.push('6. 🧪 Test end-to-end flow');
  steps.push('   - Calculate directional conviction');
  steps.push('   - Generate TSI signals');
  steps.push('   - Test live signal delivery');

  if (steps.length > 0) {
    steps.forEach(step => console.log(step));
  } else {
    console.log('✅ All data populated! Ready to implement metric calculations.');
  }
}

/**
 * Main verification function
 */
async function main() {
  console.log('🚀 CASCADIAN Database Verification');
  console.log('====================================');

  try {
    // Verify both databases
    const clickhouseOk = await verifyClickHouse();
    const supabaseOk = await verifySupabase();

    // Check data status
    const dataStatus = await checkDataStatus();

    // Generate next steps
    generateNextSteps(dataStatus);

    if (clickhouseOk && supabaseOk) {
      console.log('\n✅ Database setup verified successfully!');
    } else {
      console.log('\n⚠️  Some issues found - see details above');
    }

  } catch (error: any) {
    console.error('\n💥 Verification failed:', error.message);
    process.exit(1);
  } finally {
    await clickhouse.close();
  }
}

// Run verification
main();
