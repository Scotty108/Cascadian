#!/usr/bin/env npx tsx
/**
 * Phase 2 Progress Monitor
 *
 * Monitors Phase 2 build progress in real-time
 * Shows wallet count and estimated completion
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function monitor() {
  console.log('📊 Phase 2 Progress Monitor\n');
  console.log('Press Ctrl+C to exit\n');

  const TARGET_WALLETS = 1990000;
  const PHASE1_WALLETS = 290000;
  const PHASE2_TARGET = TARGET_WALLETS - PHASE1_WALLETS;

  let lastWalletCount = 0;
  let lastCheckTime = Date.now();

  while (true) {
    try {
      const result = await clickhouse.query({
        query: `
          SELECT
            uniq(wallet) as total_wallets,
            formatReadableQuantity(count()) as total_rows,
            round(uniq(wallet) * 100.0 / ${TARGET_WALLETS}, 1) as pct_complete
          FROM pm_trade_fifo_roi_v3_mat_unified
        `,
        format: 'JSONEachRow'
      });
      const stats = (await result.json())[0];

      const currentTime = Date.now();
      const elapsedMinutes = (currentTime - lastCheckTime) / 1000 / 60;
      const walletDelta = stats.total_wallets - lastWalletCount;
      const walletsPerHour = elapsedMinutes > 0 ? (walletDelta / elapsedMinutes) * 60 : 0;

      const phase2Wallets = stats.total_wallets - PHASE1_WALLETS;
      const phase2Pct = (phase2Wallets / PHASE2_TARGET * 100).toFixed(1);

      console.clear();
      console.log('📊 Phase 2 Progress Monitor\n');
      console.log(`⏰ ${new Date().toLocaleString()}\n`);
      console.log('─'.repeat(60));
      console.log(`Total Wallets:     ${stats.total_wallets.toLocaleString()} / ${TARGET_WALLETS.toLocaleString()} (${stats.pct_complete}%)`);
      console.log(`Phase 2 Progress:  ${phase2Wallets.toLocaleString()} / ${PHASE2_TARGET.toLocaleString()} (${phase2Pct}%)`);
      console.log(`Total Rows:        ${stats.total_rows}`);
      console.log('─'.repeat(60));

      if (walletDelta > 0) {
        console.log(`Rate:              ${walletsPerHour.toFixed(0)} wallets/hour`);
        const remainingWallets = TARGET_WALLETS - stats.total_wallets;
        const hoursRemaining = remainingWallets / walletsPerHour;
        const completionTime = new Date(Date.now() + hoursRemaining * 60 * 60 * 1000);
        console.log(`ETA:               ${hoursRemaining.toFixed(1)} hours (${completionTime.toLocaleString()})`);
      } else {
        console.log('Rate:              Calculating...');
      }

      console.log('─'.repeat(60));
      console.log('\nLogs: /tmp/worker-{0-11}-phase2.log');
      console.log('Main log: phase2-build-12workers.log');

      lastWalletCount = stats.total_wallets;
      lastCheckTime = currentTime;

      // Check completion
      if (stats.total_wallets >= TARGET_WALLETS * 0.95) {
        console.log('\n✅ Phase 2 appears complete! Run verification:\n');
        console.log('   npx tsx scripts/verify-unified-phase2.ts\n');
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 60000)); // Check every minute
    } catch (error) {
      console.error('Error checking progress:', error);
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

monitor().catch(console.error);
