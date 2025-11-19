#!/usr/bin/env npx tsx
/**
 * ERC-1155 Backfill Progress Monitor
 *
 * Displays real-time progress every 30 seconds
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TARGET = 10_000_000;
const CHECKPOINT_FILE = 'blockchain-backfill-checkpoint.json';

async function checkProgress() {
  try {
    // Get current row count
    const count = await ch.query({
      query: `SELECT COUNT(*) as count FROM default.erc1155_transfers`,
      format: 'JSONEachRow'
    });
    const countData = (await count.json())[0];
    const total = parseInt(countData.count);
    const pct = (total / TARGET * 100).toFixed(1);

    // Get block range
    const range = await ch.query({
      query: `
        SELECT
          MIN(block_number) as min_block,
          MAX(block_number) as max_block
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow'
    });
    const rangeData = (await range.json())[0];

    // Read checkpoint
    let checkpointData = null;
    if (fs.existsSync(CHECKPOINT_FILE)) {
      try {
        const raw = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
        checkpointData = JSON.parse(raw);
      } catch (e) {}
    }

    // Display
    console.clear();
    console.log('\n' + '═'.repeat(80));
    console.log('ERC-1155 BACKFILL PROGRESS MONITOR');
    console.log('═'.repeat(80));
    console.log();
    console.log(`📊 DATABASE STATE:`);
    console.log(`  Rows:     ${total.toLocaleString()} / ${TARGET.toLocaleString()} (${pct}%)`);
    console.log(`  Blocks:   ${parseInt(rangeData.min_block).toLocaleString()} → ${parseInt(rangeData.max_block).toLocaleString()}`);
    console.log();

    if (checkpointData && checkpointData.workers) {
      console.log(`👷 WORKER PROGRESS:`);
      const workers = Object.entries(checkpointData.workers)
        .map(([id, data]: [string, any]) => ({
          id: parseInt(id),
          block: data.lastBlock,
          events: data.eventsProcessed
        }))
        .sort((a, b) => a.id - b.id);

      const totalEvents = workers.reduce((sum, w) => sum + w.events, 0);

      for (const worker of workers) {
        const bar = '█'.repeat(Math.floor(worker.events / 100));
        console.log(`  Worker ${worker.id.toString().padStart(2)}: ${worker.events.toString().padStart(6)} events  ${bar}`);
      }
      console.log();
      console.log(`  Total events processed: ${totalEvents.toLocaleString()}`);
    }

    console.log();
    console.log(`⏱️  Checking again in 30 seconds...`);
    console.log(`   (Target: 10M rows | ETA: ~30-40 min)`);
    console.log();

    if (total >= TARGET) {
      console.log('✅ TARGET REACHED! Backfill complete.');
      console.log();
      console.log('Next steps:');
      console.log('  1. npx tsx build-system-wallet-map-v2.ts');
      console.log('  2. npx tsx build-fact-trades.ts');
      console.log('  3. npx tsx build-pnl-views.ts');
      console.log();
      process.exit(0);
    }

  } catch (error: any) {
    console.error('Error checking progress:', error.message);
  }
}

async function main() {
  console.log('Starting progress monitor...\n');

  // Check immediately, then every 30 seconds
  await checkProgress();

  setInterval(async () => {
    await checkProgress();
  }, 30000);
}

main().catch(console.error);
