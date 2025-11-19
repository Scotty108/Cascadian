#!/usr/bin/env npx tsx
/**
 * ERC-1155 Milestone Monitor
 *
 * Reports at 1M, 5M, 10M row milestones with:
 * - Row count
 * - Null-condition rate
 * - Latest block height
 * - Triggers pipeline execution at 10M
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const MILESTONES = [1_000_000, 5_000_000, 10_000_000];
const reported = new Set<number>();

async function checkMilestone() {
  try {
    // Get row count
    const countResult = await ch.query({
      query: `SELECT COUNT(*) as count FROM default.erc1155_transfers`,
      format: 'JSONEachRow'
    });
    const countData = (await countResult.json())[0];
    const total = parseInt(countData.count);

    // Get null-condition rate and block range
    const statsResult = await ch.query({
      query: `
        SELECT
          COUNT(*) as total,
          countIf(token_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
                  OR token_id = ''
                  OR length(token_id) < 64) as null_conditions,
          MAX(block_number) as max_block,
          MIN(block_number) as min_block
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow'
    });
    const stats = (await statsResult.json())[0];
    const nullRate = (parseInt(stats.null_conditions) / parseInt(stats.total) * 100).toFixed(2);

    // Check if we crossed a milestone
    for (const milestone of MILESTONES) {
      if (total >= milestone && !reported.has(milestone)) {
        reported.add(milestone);

        console.log('\n' + '🎯'.repeat(40));
        console.log(`MILESTONE REACHED: ${(milestone / 1_000_000).toFixed(0)}M ROWS`);
        console.log('🎯'.repeat(40));
        console.log();
        console.log(`📊 Stats:`);
        console.log(`  Total rows:           ${total.toLocaleString()}`);
        console.log(`  Null-condition rate:  ${nullRate}%`);
        console.log(`  Block range:          ${parseInt(stats.min_block).toLocaleString()} → ${parseInt(stats.max_block).toLocaleString()}`);
        console.log(`  Block span:           ${(parseInt(stats.max_block) - parseInt(stats.min_block)).toLocaleString()} blocks`);
        console.log();

        if (milestone === 10_000_000) {
          console.log('✅ TARGET REACHED! Starting pipeline execution...\n');
          console.log('Pipeline sequence:');
          console.log('  1. Regenerate mapping tables (build-system-wallet-map-v2.ts)');
          console.log('  2. Build fact_trades (build-fact-trades.ts)');
          console.log('  3. Build P&L views (build-pnl-views.ts)');
          console.log('  4. Test wallets (test-total-pnl-three-wallets.ts)');
          console.log('  5. Cleanup obsolete tables');
          console.log();

          // Exit so main process can trigger pipeline
          await ch.close();
          process.exit(0);
        }
      }
    }

  } catch (error: any) {
    console.error('Error checking milestone:', error.message);
  }
}

async function main() {
  console.log('📍 Milestone monitor started...');
  console.log('   Watching for: 1M, 5M, 10M rows\n');

  // Check every 15 seconds
  setInterval(async () => {
    await checkMilestone();
  }, 15000);

  // Check immediately
  await checkMilestone();
}

main().catch(console.error);
