#!/usr/bin/env npx tsx
/**
 * Backfill Market Resolutions - BATCHED VERSION (5-10x faster)
 * 
 * Uses batch API requests to fetch multiple markets at once
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const POLYMARKET_API = 'https://gamma-api.polymarket.com';
const BATCH_SIZE = 20; // Fetch 20 markets per API call
const CHECKPOINT_EVERY = 1000;
const RATE_LIMIT_DELAY = 50; // Faster since we're batching

interface Market { condition_id: string; last_trade: string; trade_count: number; }
interface CheckpointData {
  processed: number; successful: number; failed: number; skipped: number;
  last_condition_id: string; timestamp: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBatchMarketData(conditionIds: string[]): Promise<any[]> {
  try {
    // Batch request with comma-separated condition_ids
    const ids = conditionIds.join(',');
    const url = `${POLYMARKET_API}/markets?condition_id=${ids}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error: any) {
    console.error(`  ✗ Batch error: ${error.message}`);
    return [];
  }
}

async function insertResolutions(markets: any[]): Promise<{ successful: number; skipped: number }> {
  const rows: any[] = [];

  for (const marketData of markets) {
    if (!marketData.closed || !marketData.payout_numerators) {
      continue; // Skip open markets
    }

    const conditionId = marketData.conditionId || marketData.condition_id;
    if (!conditionId) continue;

    const payoutNumerators = marketData.payout_numerators;
    const winningIndex = payoutNumerators.findIndex((p: number) => p > 0);

    rows.push({
      condition_id_norm: conditionId.toLowerCase().replace('0x', ''),
      market_slug: marketData.market_slug || marketData.slug || '',
      question: marketData.question || '',
      payout_numerators: payoutNumerators,
      payout_denominator: 1.0,
      winning_outcome: winningIndex >= 0 ? marketData.outcomes?.[winningIndex] : null,
      resolved_at: marketData.end_date_iso ? new Date(marketData.end_date_iso) : new Date(),
      source: 'polymarket_api_batch',
      created_at: new Date()
    });
  }

  if (rows.length > 0) {
    try {
      await ch.insert({
        table: 'default.market_resolutions_final',
        values: rows,
        format: 'JSONEachRow'
      });
    } catch (error: any) {
      console.error(`  ✗ Insert error: ${error.message}`);
      return { successful: 0, skipped: markets.length };
    }
  }

  return {
    successful: rows.length,
    skipped: markets.length - rows.length
  };
}

function saveCheckpoint(filename: string, checkpoint: CheckpointData) {
  writeFileSync(filename, JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint(filename: string): CheckpointData | null {
  if (!existsSync(filename)) return null;
  try {
    return JSON.parse(readFileSync(filename, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const inputFile = process.argv[2];

  if (!inputFile || !existsSync(inputFile)) {
    console.error('\n❌ Usage: npx tsx backfill-resolutions-batched.ts <input-file.json>\n');
    process.exit(1);
  }

  console.log('\n🚀 BATCHED RESOLUTION BACKFILL (5-10x FASTER)\n');
  console.log('═'.repeat(80));

  const input = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const markets: Market[] = input.markets;

  console.log(`\n📁 Input: ${inputFile}`);
  console.log(`   Markets: ${markets.length.toLocaleString()}`);
  console.log(`   Batch size: ${BATCH_SIZE} markets/request`);
  console.log(`   Expected speedup: 5-10x\n`);

  const checkpointFile = inputFile.replace('.json', '-batched-checkpoint.json');
  let checkpoint = loadCheckpoint(checkpointFile) || {
    processed: 0, successful: 0, failed: 0, skipped: 0,
    last_condition_id: '', timestamp: new Date().toISOString()
  };

  let startIndex = checkpoint.processed;
  if (startIndex > 0) {
    console.log(`\n⚡ Resuming from ${startIndex.toLocaleString()} markets\n`);
  }

  const startTime = Date.now();
  let lastCheckpointTime = startTime;

  for (let i = startIndex; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, Math.min(i + BATCH_SIZE, markets.length));
    const batchIds = batch.map(m => m.condition_id);
    const progress = ((i + batch.length) / markets.length * 100).toFixed(1);

    // Fetch batch
    const marketDataList = await fetchBatchMarketData(batchIds);

    // Insert batch
    const result = await insertResolutions(marketDataList);

    checkpoint.processed = i + batch.length;
    checkpoint.successful += result.successful;
    checkpoint.skipped += result.skipped;
    checkpoint.failed += (batch.length - marketDataList.length);
    checkpoint.last_condition_id = batch[batch.length - 1].condition_id;
    checkpoint.timestamp = new Date().toISOString();

    // Progress update every 100 markets
    if (i % 100 === 0 || i + batch.length >= markets.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = checkpoint.processed / elapsed;
      const remaining = (markets.length - checkpoint.processed) / rate;

      console.log(`[${progress}%] ${checkpoint.processed.toLocaleString()}/${markets.length.toLocaleString()} ` +
        `| ✓${checkpoint.successful.toLocaleString()} ○${checkpoint.skipped.toLocaleString()} ✗${checkpoint.failed.toLocaleString()} ` +
        `| ${rate.toFixed(1)}/sec | ~${(remaining/60).toFixed(0)}min`);
    }

    // Checkpoint
    if (checkpoint.processed % CHECKPOINT_EVERY < BATCH_SIZE) {
      saveCheckpoint(checkpointFile, checkpoint);
    }

    // Rate limiting
    await sleep(RATE_LIMIT_DELAY);
  }

  saveCheckpoint(checkpointFile, checkpoint);

  const totalElapsed = (Date.now() - startTime) / 1000;
  console.log('\n' + '═'.repeat(80));
  console.log('📊 COMPLETE\n');
  console.log(`Processed: ${checkpoint.processed.toLocaleString()}`);
  console.log(`✓ Successful: ${checkpoint.successful.toLocaleString()}`);
  console.log(`✗ Failed: ${checkpoint.failed.toLocaleString()}`);
  console.log(`○ Skipped: ${checkpoint.skipped.toLocaleString()}`);
  console.log(`\nTime: ${(totalElapsed / 60).toFixed(1)} minutes`);
  console.log(`Rate: ${(checkpoint.processed / totalElapsed).toFixed(1)} markets/sec`);
  console.log(`Success rate: ${(checkpoint.successful / checkpoint.processed * 100).toFixed(1)}%`);
  console.log('\n' + '═'.repeat(80) + '\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
