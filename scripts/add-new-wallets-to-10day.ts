#!/usr/bin/env npx tsx
/**
 * Add New Wallets to 10day Table (with Full History)
 *
 * Finds wallets that became active in the last day and adds their FULL trade history.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_10DAY = 'pm_trade_fifo_roi_v3_mat_unified_10day';
const TABLE_SOURCE = 'pm_trade_fifo_roi_v3';

async function findNewWallets() {
  console.log('\n🔍 Finding New Wallets...\n');

  // Wallets active in last day that aren't in 10day table yet
  const result = await clickhouse.query({
    query: `
      SELECT count() as new_wallets
      FROM (
        SELECT DISTINCT wallet
        FROM ${TABLE_SOURCE}
        WHERE entry_time >= now() - INTERVAL 1 DAY
      ) new_active
      WHERE wallet NOT IN (
        SELECT DISTINCT wallet
        FROM ${TABLE_10DAY}
      )
    `,
    format: 'JSONEachRow',
  });
  const { new_wallets } = (await result.json())[0];

  console.log(`   Found ${new_wallets.toLocaleString()} new wallets active in last day\n`);

  return new_wallets;
}

async function addWalletsFullHistory() {
  console.log('\n📥 Adding Full History for New Wallets...\n');

  const startTime = Date.now();

  // Insert FULL history for wallets active in last day
  await clickhouse.command({
    query: `
      INSERT INTO ${TABLE_10DAY}
      SELECT
        v.tx_hash,
        v.wallet,
        v.condition_id,
        v.outcome_index,
        v.entry_time,
        v.resolved_at,
        v.cost_usd,
        v.tokens,
        v.tokens_sold_early,
        v.tokens_held,
        v.exit_value,
        v.pnl_usd,
        v.roi,
        v.pct_sold_early,
        v.is_maker,
        v.is_short,
        CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
      FROM ${TABLE_SOURCE} v
      WHERE v.wallet IN (
        -- Wallets active in last day
        SELECT DISTINCT wallet
        FROM ${TABLE_SOURCE}
        WHERE entry_time >= now() - INTERVAL 1 DAY
      )
      AND v.wallet NOT IN (
        -- That don't already exist in 10day
        SELECT DISTINCT wallet
        FROM ${TABLE_10DAY}
      )
    `,
    clickhouse_settings: {
      max_execution_time: 600,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log(`   ✅ Added full history in ${elapsed} minutes\n`);

  return elapsed;
}

async function verifyUpdate() {
  console.log('\n✅ Verifying Update...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(uniq(wallet)) as total_wallets,
        formatReadableQuantity(count()) as total_positions,
        min(entry_time) as oldest_trade,
        max(entry_time) as newest_trade
      FROM ${TABLE_10DAY}
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Updated Table:');
  console.log(`     Total wallets: ${stats.total_wallets}`);
  console.log(`     Total positions: ${stats.total_positions}`);
  console.log(`     Date range: ${stats.oldest_trade} → ${stats.newest_trade}`);
  console.log('');

  return stats;
}

async function main() {
  console.log('🔄 ADD NEW WALLETS TO 10DAY TABLE');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('═'.repeat(70));

  try {
    // Find new wallets
    const newWallets = await findNewWallets();

    if (newWallets === 0) {
      console.log('✅ No new wallets to add - table is current!\n');
      process.exit(0);
    }

    // Add their full history
    const elapsed = await addWalletsFullHistory();

    // Verify
    const stats = await verifyUpdate();

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n✅ Added ${newWallets.toLocaleString()} new wallets with full history`);
    console.log(`   Runtime: ${elapsed} minutes`);
    console.log(`\n📊 Final Stats:`);
    console.log(`   Total wallets: ${stats.total_wallets}`);
    console.log(`   Total positions: ${stats.total_positions}`);
    console.log('\n💡 10day table now includes:');
    console.log('   - All wallets active in last 10 days (when created) + last 1 day (added)');
    console.log('   - Full trade history for all those wallets');
    console.log('   - Up-to-date resolutions\n');

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
