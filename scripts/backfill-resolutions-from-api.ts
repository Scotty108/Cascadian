#!/usr/bin/env npx tsx
/**
 * Backfill Market Resolutions from Polymarket API
 *
 * Fetches resolution data for missing markets from Polymarket API
 * and inserts into market_resolutions_final table.
 *
 * Usage: npx tsx backfill-resolutions-from-api.ts <input-file.json>
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
const BATCH_SIZE = 100; // Process 100 markets at a time
const CHECKPOINT_EVERY = 1000; // Save checkpoint every 1000 markets
const RATE_LIMIT_DELAY = 100; // ms between API requests

interface Market {
  condition_id: string;
  last_trade: string;
  trade_count: number;
}

interface CheckpointData {
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  last_condition_id: string;
  timestamp: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMarketData(conditionId: string): Promise<any> {
  try {
    const url = `${POLYMARKET_API}/markets?condition_id=${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Market not found
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Gamma API returns array of markets
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    return data[0]; // Return first market
  } catch (error: any) {
    console.error(`  ✗ Error fetching ${conditionId.substring(0, 10)}...: ${error.message}`);
    return null;
  }
}

async function insertResolution(conditionId: string, marketData: any): Promise<boolean> {
  try {
    // Check if market is resolved
    if (!marketData.closed || !marketData.payout_numerators) {
      return false; // Market still open or no payout data
    }

    const payoutNumerators = marketData.payout_numerators;
    const payoutDenominator = 1.0; // Polymarket uses normalized payouts

    // Determine winning outcome
    const winningIndex = payoutNumerators.findIndex((p: number) => p > 0);
    const winningOutcome = winningIndex >= 0 ? marketData.outcomes?.[winningIndex] : null;

    await ch.insert({
      table: 'default.market_resolutions_final',
      values: [{
        condition_id_norm: conditionId.toLowerCase().replace('0x', ''),
        market_slug: marketData.market_slug || '',
        question: marketData.question || '',
        payout_numerators: payoutNumerators,
        payout_denominator: payoutDenominator,
        winning_outcome: winningOutcome,
        resolved_at: marketData.end_date_iso ? new Date(marketData.end_date_iso) : new Date(),
        source: 'polymarket_api',
        created_at: new Date()
      }],
      format: 'JSONEachRow'
    });

    return true;
  } catch (error: any) {
    console.error(`  ✗ Insert error for ${conditionId.substring(0, 10)}...: ${error.message}`);
    return false;
  }
}

function saveCheckpoint(filename: string, checkpoint: CheckpointData) {
  writeFileSync(filename, JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint(filename: string): CheckpointData | null {
  if (!existsSync(filename)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filename, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error('\n❌ Error: Please provide input file');
    console.error('Usage: npx tsx backfill-resolutions-from-api.ts <input-file.json>\n');
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`\n❌ Error: File not found: ${inputFile}\n`);
    process.exit(1);
  }

  console.log('\n🔄 BACKFILLING RESOLUTIONS FROM POLYMARKET API\n');
  console.log('═'.repeat(80));

  // Load input file
  const input = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const markets: Market[] = input.markets;

  console.log(`\n📁 Input: ${inputFile}`);
  console.log(`   Markets to process: ${markets.length.toLocaleString()}`);
  console.log(`   Description: ${input.description}\n`);

  // Check for existing checkpoint
  const checkpointFile = inputFile.replace('.json', '-checkpoint.json');
  let checkpoint = loadCheckpoint(checkpointFile);

  let startIndex = 0;
  if (checkpoint) {
    console.log(`\n⚡ Resuming from checkpoint:`);
    console.log(`   Processed: ${checkpoint.processed.toLocaleString()}`);
    console.log(`   Successful: ${checkpoint.successful.toLocaleString()}`);
    console.log(`   Failed: ${checkpoint.failed.toLocaleString()}`);
    console.log(`   Skipped: ${checkpoint.skipped.toLocaleString()}\n`);

    startIndex = checkpoint.processed;
  } else {
    checkpoint = {
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      last_condition_id: '',
      timestamp: new Date().toISOString()
    };
  }

  // Process markets
  const startTime = Date.now();
  let lastCheckpointTime = startTime;

  for (let i = startIndex; i < markets.length; i++) {
    const market = markets[i];
    const progress = ((i + 1) / markets.length * 100).toFixed(1);

    // Progress update every 100 markets
    if (i % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = i / elapsed;
      const remaining = (markets.length - i) / rate;

      console.log(`\n[${progress}%] Processing ${i + 1}/${markets.length} (${rate.toFixed(1)}/sec, ~${(remaining/60).toFixed(0)}min remaining)`);
    }

    // Fetch market data
    const marketData = await fetchMarketData(market.condition_id);

    if (!marketData) {
      checkpoint.failed++;
      if (i % 100 === 0) {
        console.log(`  ✗ ${market.condition_id.substring(0, 16)}... - Not found`);
      }
    } else {
      const inserted = await insertResolution(market.condition_id, marketData);

      if (inserted) {
        checkpoint.successful++;
        if (i % 100 === 0) {
          console.log(`  ✓ ${market.condition_id.substring(0, 16)}... - Resolved`);
        }
      } else {
        checkpoint.skipped++;
        if (i % 100 === 0) {
          console.log(`  ○ ${market.condition_id.substring(0, 16)}... - Still open`);
        }
      }
    }

    checkpoint.processed = i + 1;
    checkpoint.last_condition_id = market.condition_id;
    checkpoint.timestamp = new Date().toISOString();

    // Save checkpoint
    if (checkpoint.processed % CHECKPOINT_EVERY === 0) {
      saveCheckpoint(checkpointFile, checkpoint);

      const checkpointElapsed = (Date.now() - lastCheckpointTime) / 1000;
      console.log(`\n💾 Checkpoint saved (${CHECKPOINT_EVERY} markets in ${checkpointElapsed.toFixed(0)}s)`);
      lastCheckpointTime = Date.now();
    }

    // Rate limiting
    await sleep(RATE_LIMIT_DELAY);
  }

  // Final checkpoint
  saveCheckpoint(checkpointFile, checkpoint);

  // Summary
  const totalElapsed = (Date.now() - startTime) / 1000;

  console.log('\n' + '═'.repeat(80));
  console.log('📊 BACKFILL COMPLETE\n');
  console.log(`Total processed: ${checkpoint.processed.toLocaleString()}`);
  console.log(`✓ Successfully inserted: ${checkpoint.successful.toLocaleString()}`);
  console.log(`✗ Failed/not found: ${checkpoint.failed.toLocaleString()}`);
  console.log(`○ Skipped (still open): ${checkpoint.skipped.toLocaleString()}`);
  console.log(`\nTime elapsed: ${(totalElapsed / 60).toFixed(1)} minutes`);
  console.log(`Average rate: ${(checkpoint.processed / totalElapsed).toFixed(1)} markets/sec`);

  const successRate = (checkpoint.successful / checkpoint.processed * 100).toFixed(1);
  console.log(`\nSuccess rate: ${successRate}%`);

  console.log('\n🎯 Next steps:');
  console.log('1. Validate P&L coverage improved:');
  console.log('   npx tsx -e "SELECT COUNT(*) as resolved FROM vw_wallet_pnl_calculated WHERE payout_denominator > 0"');
  console.log('\n2. If satisfied, run Phase 2:');
  console.log('   npx tsx backfill-resolutions-from-api.ts missing-resolutions-priority-2-medium.json\n');

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
