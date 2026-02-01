#!/usr/bin/env npx tsx
/**
 * Phase 2 Morning Summary
 *
 * Shows what happened overnight with the Phase 2 build
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { existsSync, readFileSync } from 'fs';
import { clickhouse } from '../lib/clickhouse/client';

async function summary() {
  console.log('☀️  Phase 2 Morning Summary\n');
  console.log('⏰ Current time:', new Date().toLocaleString());
  console.log('');

  // 1. Current table stats
  console.log('📊 Current Table Status\n');

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          uniq(wallet) as total_wallets,
          formatReadableQuantity(count()) as total_rows,
          countIf(resolved_at IS NOT NULL) as resolved,
          countIf(resolved_at IS NULL) as unresolved,
          sum(pnl_usd) / 1000000 as total_pnl_millions
        FROM pm_trade_fifo_roi_v3_mat_unified
      `,
      format: 'JSONEachRow'
    });
    const stats = (await result.json())[0];

    const phase1Wallets = 290412;
    const phase2Wallets = stats.total_wallets - phase1Wallets;
    const targetWallets = 1990000;
    const pctComplete = (stats.total_wallets / targetWallets * 100).toFixed(1);

    console.log(`   Total wallets: ${stats.total_wallets.toLocaleString()} / ${targetWallets.toLocaleString()} (${pctComplete}%)`);
    console.log(`   Phase 1: ${phase1Wallets.toLocaleString()} wallets (original)`);
    console.log(`   Phase 2: ${phase2Wallets.toLocaleString()} wallets (added overnight)`);
    console.log(`   Total rows: ${stats.total_rows}`);
    console.log(`   Resolved: ${stats.resolved.toLocaleString()}`);
    console.log(`   Unresolved: ${stats.unresolved.toLocaleString()}`);
    console.log(`   Total PnL: $${stats.total_pnl_millions.toFixed(2)}M`);
    console.log('');

    if (stats.total_wallets >= targetWallets * 0.95) {
      console.log('✅ Phase 2 appears COMPLETE!\n');
    } else if (phase2Wallets > 100000) {
      console.log('⚙️  Phase 2 in progress...\n');
    } else {
      console.log('⚠️  Phase 2 may have stalled. Check logs below.\n');
    }
  } catch (error) {
    console.error('❌ Error querying table:', error);
    console.log('');
  }

  // 2. Worker status
  console.log('👷 Worker Status\n');

  const workerConfigs = [
    { workers: 12, logPrefix: 'worker-', logSuffix: '-phase2.log' },
    { workers: 6, logPrefix: 'worker-', logSuffix: '-phase2-6w.log' },
    { workers: 3, logPrefix: 'worker-', logSuffix: '-phase2-3w.log' }
  ];

  let activeConfig = null;
  for (const config of workerConfigs) {
    const firstLog = `/tmp/${config.logPrefix}0${config.logSuffix}`;
    if (existsSync(firstLog)) {
      activeConfig = config;
      break;
    }
  }

  if (!activeConfig) {
    console.log('   ⚠️  No worker logs found. Build may not have started.\n');
  } else {
    console.log(`   Active configuration: ${activeConfig.workers} workers\n`);

    let completedCount = 0;
    let failedCount = 0;
    let runningCount = 0;

    for (let i = 0; i < activeConfig.workers; i++) {
      const logFile = `/tmp/${activeConfig.logPrefix}${i}${activeConfig.logSuffix}`;

      if (!existsSync(logFile)) {
        console.log(`   Worker ${i + 1}: ⚠️  No log file`);
        continue;
      }

      const content = readFileSync(logFile, 'utf8');

      if (content.includes('complete in')) {
        const match = content.match(/complete in ([\d.]+) minutes/);
        const duration = match ? match[1] : '?';
        console.log(`   Worker ${i + 1}: ✅ Complete (${duration} min)`);
        completedCount++;
      } else if (content.includes('ERROR') || content.includes('failed')) {
        console.log(`   Worker ${i + 1}: ❌ Failed`);
        failedCount++;
      } else if (content.includes('Processing')) {
        console.log(`   Worker ${i + 1}: ⚙️  Running...`);
        runningCount++;
      } else {
        console.log(`   Worker ${i + 1}: ❓ Unknown status`);
      }
    }

    console.log('');
    console.log(`   Summary: ${completedCount} completed, ${runningCount} running, ${failedCount} failed`);
    console.log('');
  }

  // 3. Main log summary
  console.log('📋 Build Log Summary\n');

  const mainLogs = [
    'phase2-build-12workers.log',
    'phase2-build-6workers.log',
    'phase2-build-3workers.log'
  ];

  for (const log of mainLogs) {
    if (existsSync(log)) {
      const content = readFileSync(log, 'utf8');
      const lines = content.split('\n');
      const lastLines = lines.slice(-20).join('\n');

      console.log(`   ${log}:`);
      console.log('   ' + '─'.repeat(58));
      console.log(lastLines.split('\n').map(l => `   ${l}`).join('\n'));
      console.log('');
      break;
    }
  }

  // 4. Recommendations
  console.log('💡 Next Steps\n');

  try {
    const result = await clickhouse.query({
      query: `SELECT uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unified`,
      format: 'JSONEachRow'
    });
    const stats = (await result.json())[0];

    if (stats.wallets >= 1900000) {
      console.log('   ✅ Phase 2 complete! Run verification:');
      console.log('      npx tsx scripts/verify-unified-phase2.ts\n');
      console.log('   Then optimize the table:');
      console.log('      OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL\n');
    } else if (stats.wallets > 500000) {
      console.log('   ⚙️  Build in progress. Monitor with:');
      console.log('      npx tsx scripts/monitor-phase2.ts\n');
    } else {
      console.log('   ⚠️  Build may have stalled. Check logs:');
      console.log('      tail -100 /tmp/worker-0-phase2.log\n');
      console.log('   Or restart manually:');
      console.log('      npx tsx scripts/build-unified-phase2-orchestrate.ts\n');
    }
  } catch (error) {
    console.error('   ❌ Error checking status\n');
  }
}

summary().catch(console.error);
