#!/usr/bin/env tsx
/**
 * Build PnL Snapshot for Dome Comparison (Task R1 & R2)
 *
 * Determines safe comparison window and selects 2 wallets for Dome API validation.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('📸 Building PnL Snapshot for Dome Comparison');
  console.log('='.repeat(60));
  console.log('');

  // ========================================================================
  // TASK R1: Determine Safe Comparison Window
  // ========================================================================

  console.log('Task R1: Determining safe comparison cutoff...');
  console.log('-'.repeat(60));
  console.log('');

  // Step 1: Get max block_time from pm_trades
  const maxBlockTimeQuery = await clickhouse.query({
    query: 'SELECT max(block_time) AS max_block_time FROM pm_trades',
    format: 'JSONEachRow'
  });

  const maxBlockTimeResult = await maxBlockTimeQuery.json();
  const maxBlockTime = new Date(maxBlockTimeResult[0].max_block_time);

  console.log(`Max block_time in pm_trades: ${maxBlockTime.toISOString()}`);
  console.log('');

  // Step 2: Compute comparison_cutoff_ts as max_block_time - 5 days
  const CUTOFF_BUFFER_DAYS = 5;
  const comparison_cutoff_ts = new Date(maxBlockTime);
  comparison_cutoff_ts.setDate(comparison_cutoff_ts.getDate() - CUTOFF_BUFFER_DAYS);

  console.log(`Comparison cutoff (max - ${CUTOFF_BUFFER_DAYS} days): ${comparison_cutoff_ts.toISOString()}`);
  console.log('');

  // Step 3: Count resolved markets before cutoff
  // Format cutoff as ClickHouse DateTime (YYYY-MM-DD HH:MM:SS)
  const cutoffFormatted = comparison_cutoff_ts.toISOString().replace('T', ' ').substring(0, 19);

  const marketCountQuery = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT condition_id) as resolved_markets_before_cutoff
      FROM pm_markets
      WHERE status = 'resolved'
        AND market_type = 'binary'
        AND resolved_at <= '${cutoffFormatted}'
    `,
    format: 'JSONEachRow'
  });

  const marketCount = await marketCountQuery.json();
  const resolvedMarketsCount = marketCount[0]?.resolved_markets_before_cutoff || 0;
  console.log(`Resolved binary markets before cutoff: ${parseInt(resolvedMarketsCount).toLocaleString()}`);
  console.log('');

  // Count distinct wallets with PnL in this window
  const walletCountQuery = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT w.wallet_address) as wallets_with_pnl
      FROM pm_wallet_market_pnl_resolved w
      INNER JOIN pm_markets m
        ON w.condition_id = m.condition_id
      WHERE m.status = 'resolved'
        AND m.market_type = 'binary'
        AND m.resolved_at <= '${cutoffFormatted}'
    `,
    format: 'JSONEachRow'
  });

  const walletCount = await walletCountQuery.json();
  const walletsWithPnlCount = walletCount[0]?.wallets_with_pnl || 0;
  console.log(`Wallets with PnL in this window: ${parseInt(walletsWithPnlCount).toLocaleString()}`);
  console.log('');

  // ========================================================================
  // TASK R2: Build PnL Snapshot and Select 2 Wallets
  // ========================================================================

  console.log('Task R2: Building PnL snapshot for comparison...');
  console.log('-'.repeat(60));
  console.log('');

  // Drop existing snapshot if exists
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_wallet_pnl_snapshot_for_dome'
  });

  // Create snapshot view
  console.log('Creating pm_wallet_pnl_snapshot_for_dome view...');
  await clickhouse.command({
    query: `
      CREATE VIEW pm_wallet_pnl_snapshot_for_dome AS
      SELECT
        w.wallet_address,
        w.condition_id,
        w.pnl_net,
        w.gross_notional,
        w.total_trades,
        m.winning_outcome_index,
        m.resolved_at
      FROM pm_wallet_market_pnl_resolved w
      INNER JOIN pm_markets m
        ON w.condition_id = m.condition_id
      WHERE m.status = 'resolved'
        AND m.market_type = 'binary'
        AND m.resolved_at <= '${cutoffFormatted}'
    `
  });
  console.log('✅ Snapshot view created');
  console.log('');

  // ========================================================================
  // Select Wallet 1: xcnstrategy
  // ========================================================================

  console.log('Selecting Wallet 1: xcnstrategy...');
  const XCNSTRATEGY_ADDRESS = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const xcnWalletQuery = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        SUM(pnl_net) as wallet_pnl_net,
        COUNT(DISTINCT condition_id) as markets_count,
        COUNT(DISTINCT CASE WHEN pnl_net != 0 THEN condition_id END) as markets_with_nonzero_pnl
      FROM pm_wallet_pnl_snapshot_for_dome
      WHERE wallet_address = '${XCNSTRATEGY_ADDRESS}'
      GROUP BY wallet_address
    `,
    format: 'JSONEachRow'
  });

  const xcnWallet = await xcnWalletQuery.json();

  if (xcnWallet.length === 0 || !xcnWallet[0]?.wallet_address) {
    console.log(`⚠️  xcnstrategy wallet (${XCNSTRATEGY_ADDRESS}) not found in snapshot`);
    console.log('   This wallet may not have PnL in the filtered time window.');
    console.log('');
  } else {
    console.log(`✅ xcnstrategy wallet found:`);
    console.log(`   Address: ${xcnWallet[0].wallet_address}`);
    console.log(`   PnL Net: $${parseFloat(xcnWallet[0].wallet_pnl_net || 0).toLocaleString()}`);
    console.log(`   Markets (total): ${parseInt(xcnWallet[0].markets_count || 0)}`);
    console.log(`   Markets (nonzero PnL): ${parseInt(xcnWallet[0].markets_with_nonzero_pnl || 0)}`);
    console.log('');
  }

  // ========================================================================
  // Select Wallet 2: Top Positive Wallet (non-system)
  // ========================================================================

  console.log('Selecting Wallet 2: Top positive wallet...');

  // System wallet patterns to exclude
  const SYSTEM_WALLET_PATTERNS = [
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead'
  ];

  const topWalletQuery = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        SUM(pnl_net) as wallet_pnl_net,
        COUNT(DISTINCT condition_id) as markets_count,
        COUNT(DISTINCT CASE WHEN pnl_net != 0 THEN condition_id END) as markets_with_nonzero_pnl
      FROM pm_wallet_pnl_snapshot_for_dome
      WHERE wallet_address NOT IN (${SYSTEM_WALLET_PATTERNS.map(w => `'${w}'`).join(', ')})
        AND wallet_address != '${XCNSTRATEGY_ADDRESS}'
      GROUP BY wallet_address
      HAVING wallet_pnl_net > 0
      ORDER BY wallet_pnl_net DESC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const topWallet = await topWalletQuery.json();

  if (topWallet.length === 0 || !topWallet[0]?.wallet_address) {
    console.log('⚠️  No top positive wallet found (excluding xcnstrategy and system wallets)');
    console.log('');
  } else {
    console.log(`✅ Top positive wallet found:`);
    console.log(`   Address: ${topWallet[0].wallet_address}`);
    console.log(`   PnL Net: $${parseFloat(topWallet[0].wallet_pnl_net || 0).toLocaleString()}`);
    console.log(`   Markets (total): ${parseInt(topWallet[0].markets_count || 0)}`);
    console.log(`   Markets (nonzero PnL): ${parseInt(topWallet[0].markets_with_nonzero_pnl || 0)}`);
    console.log('');
  }

  // ========================================================================
  // SUMMARY
  // ========================================================================

  console.log('='.repeat(60));
  console.log('📋 SNAPSHOT SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Comparison Cutoff: ${comparison_cutoff_ts.toISOString()}`);
  console.log(`Resolved Markets: ${parseInt(resolvedMarketsCount).toLocaleString()}`);
  console.log(`Wallets with PnL: ${parseInt(walletsWithPnlCount).toLocaleString()}`);
  console.log('');
  console.log('Selected Wallets for Dome Comparison:');
  console.log('');

  let selectedCount = 0;

  if (xcnWallet.length > 0 && xcnWallet[0]?.wallet_address) {
    selectedCount++;
    console.log(`${selectedCount}. xcnstrategy (${XCNSTRATEGY_ADDRESS})`);
    console.log(`   PnL: $${parseFloat(xcnWallet[0].wallet_pnl_net || 0).toLocaleString()}`);
  }

  if (topWallet.length > 0 && topWallet[0]?.wallet_address) {
    selectedCount++;
    const topAddr = topWallet[0].wallet_address;
    console.log(`${selectedCount}. Top Wallet (${topAddr.substring(0, 10)}...)`);
    console.log(`   PnL: $${parseFloat(topWallet[0].wallet_pnl_net || 0).toLocaleString()}`);
  }

  console.log('');
  console.log(`Total wallets selected: ${selectedCount}`);
  console.log('');
  console.log('✅ Snapshot ready for Dome API comparison');
  console.log('   Run scripts/99-compare-pnl-with-dome.ts next');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Snapshot creation failed:', error);
  process.exit(1);
});
