#!/usr/bin/env npx tsx
/**
 * Monitor ERC-1155 backfill until completion
 * Tracks progress and alerts on major milestones
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function getRowCount(): Promise<number> {
  const ch = getClickHouseClient();
  try {
    const result = await ch.query({
      query: 'SELECT COUNT(*) as count FROM default.erc1155_transfers',
      format: 'JSONEachRow'
    });
    const data = await result.json<any[]>();
    await ch.close();
    return parseInt(data[0].count);
  } catch (e) {
    await ch.close();
    throw e;
  }
}

async function main() {
  console.log('\n' + '═'.repeat(100));
  console.log('ERC-1155 BACKFILL COMPLETION MONITOR');
  console.log('═'.repeat(100) + '\n');

  const targets = [10500000, 11000000, 11500000, 12000000, 12500000, 13000000];
  const startTime = Date.now();

  let lastCount = 0;
  let lastTime = startTime;

  while (true) {
    try {
      const count = await getRowCount();
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000 / 60; // minutes
      const rowsPerMin = elapsed > 0 ? (count - lastCount) / elapsed : 0;

      // Format output
      const pct = ((count / 13000000) * 100).toFixed(1);
      const remaining = 13000000 - count;
      const etaMins = rowsPerMin > 0 ? Math.round(remaining / rowsPerMin) : 0;

      console.log(`[${new Date().toLocaleTimeString()}] ${count.toLocaleString()} rows (${pct}%) | +${rowsPerMin.toFixed(0)}/min | ETA: ${etaMins}m`);

      // Check milestones
      for (const target of targets) {
        if (lastCount < target && count >= target) {
          console.log(`\n🎯 MILESTONE: Reached ${target.toLocaleString()} rows!\n`);
        }
      }

      lastCount = count;
      lastTime = now;

      // Check if complete (assuming 13M is max)
      if (count >= 13000000) {
        console.log('\n' + '═'.repeat(100));
        console.log('✅ BACKFILL COMPLETE!');
        console.log('═'.repeat(100));
        console.log(`Final count: ${count.toLocaleString()} rows`);
        const totalTime = (now - startTime) / 1000 / 60 / 60;
        console.log(`Total time: ${totalTime.toFixed(1)} hours\n`);
        process.exit(0);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second interval
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, 60000)); // Wait longer on error
    }
  }
}

main().catch(console.error);
