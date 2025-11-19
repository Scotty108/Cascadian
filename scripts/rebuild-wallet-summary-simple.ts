#!/usr/bin/env npx tsx

/**
 * Rebuild wallet_pnl_summary_final from realized_pnl_by_market_final
 *
 * Simple aggregation: SUM(realized_pnl_usd) per wallet
 * Runtime: ~30 seconds
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('═'.repeat(80));
  console.log('REBUILD: wallet_pnl_summary_final');
  console.log('═'.repeat(80));
  console.log('Strategy: Aggregate from realized_pnl_by_market_final');
  console.log('Runtime: ~30 seconds\n');

  const startTime = Date.now();

  // Step 1: Create new summary table
  console.log('[1/4] Creating new wallet summary table...');

  await clickhouse.query({
    query: `DROP TABLE IF EXISTS wallet_pnl_summary_new`
  });

  await clickhouse.query({
    query: `
      CREATE TABLE wallet_pnl_summary_new
      ENGINE = MergeTree()
      ORDER BY wallet
      AS
      SELECT
        wallet,
        SUM(realized_pnl_usd) AS total_realized_pnl_usd,
        COUNT(DISTINCT condition_id_norm) AS markets_traded,
        COUNT(*) AS position_count
      FROM realized_pnl_by_market_final
      GROUP BY wallet
    `
  });

  console.log('   ✅ New table created\n');

  // Step 2: Verify row counts
  console.log('[2/4] Verifying row counts...');

  const newResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as cnt,
        COUNT(DISTINCT wallet) as wallets
      FROM wallet_pnl_summary_new
    `,
    format: 'JSONEachRow'
  });

  const newData = await newResult.json();
  console.log(`   New table: ${parseInt(newData[0].cnt).toLocaleString()} rows | ${parseInt(newData[0].wallets).toLocaleString()} wallets\n`);

  // Step 3: Atomic swap
  console.log('[3/4] Atomic table swap...');

  // Drop old backup if exists
  await clickhouse.query({
    query: `DROP TABLE IF EXISTS wallet_pnl_summary_backup`
  });

  // Backup old table if it exists
  try {
    await clickhouse.query({
      query: `RENAME TABLE wallet_pnl_summary_final TO wallet_pnl_summary_backup`
    });
  } catch {
    console.log('   (No old table to backup)');
  }

  // Rename new to final
  await clickhouse.query({
    query: `RENAME TABLE wallet_pnl_summary_new TO wallet_pnl_summary_final`
  });

  console.log('   ✅ Swap complete\n');

  // Step 4: Sample verification
  console.log('[4/4] Sample wallet P&L entries...');

  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        total_realized_pnl_usd,
        markets_traded
      FROM wallet_pnl_summary_final
      ORDER BY abs(total_realized_pnl_usd) DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json();
  console.log('   Top wallets by P&L:');
  samples.forEach((s: any) => {
    console.log(`     ${s.wallet.substring(0, 12)}... → $${parseFloat(s.total_realized_pnl_usd).toFixed(2)} (${s.markets_traded} markets)`);
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log();
  console.log('═'.repeat(80));
  console.log('✅ REBUILD COMPLETE');
  console.log('═'.repeat(80));
  console.log(`Total time: ${duration} seconds`);
  console.log(`Wallets: ${parseInt(newData[0].wallets).toLocaleString()}`);
  console.log(`Markets: ${parseInt(newData[0].cnt).toLocaleString()}`);
  console.log();
  console.log('💾 Backup: wallet_pnl_summary_backup (if existed)');
  console.log('═'.repeat(80));
}

main().catch(console.error);
