#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function monitor() {
  console.log('📊 Timestamp Backfill Progress Monitor\n');

  //Check checkpoint
  if (fs.existsSync('tmp/fix-erc1155-timestamps.checkpoint.json')) {
    const checkpoint = JSON.parse(fs.readFileSync('tmp/fix-erc1155-timestamps.checkpoint.json', 'utf-8'));
    console.log(`Phase: ${checkpoint.phase}`);
    console.log(`Progress: ${checkpoint.fetchedBlocks.toLocaleString()} / ${checkpoint.totalBlocks.toLocaleString()} blocks`);
    console.log(`Percentage: ${((checkpoint.fetchedBlocks / checkpoint.totalBlocks) * 100).toFixed(2)}%`);
    
    const activeWorkers = Object.values(checkpoint.workers).filter((w: any) => !w.complete).length;
    console.log(`Active workers: ${activeWorkers} / 32`);
    console.log('');
  }

  // Check temp table
  const result = await clickhouse.query({
    query: 'SELECT count() as count FROM tmp_block_timestamps',
    format: 'JSONEachRow'
  });
  const data = await result.json<any>();
  console.log(`Timestamps fetched: ${parseInt(data[0].count).toLocaleString()}`);
}

monitor();
