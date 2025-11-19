#!/usr/bin/env npx tsx

/**
 * Monitor Goldsky CLOB Fills Ingestion Progress
 *
 * Shows real-time progress of the parallel ingestion including:
 * - Fill count and market coverage
 * - Processing rate and ETA
 * - Error tracking
 * - Checkpoint status
 */

import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import fs from 'fs/promises';

config({ path: resolve(process.cwd(), '.env.local') });

interface Checkpoint {
  lastProcessedMarket: number;
  marketsProcessed: number;
  fillsIngested: number;
  timestamp: string;
}

async function main() {
  console.log('═'.repeat(80));
  console.log('GOLDSKY INGESTION PROGRESS MONITOR');
  console.log('═'.repeat(80));
  console.log(`Time: ${new Date().toLocaleString()}\n`);

  // Load checkpoint
  let checkpoint: Checkpoint | null = null;
  try {
    const data = await fs.readFile('tmp/goldsky-fills-checkpoint.json', 'utf-8');
    checkpoint = JSON.parse(data);
  } catch {
    console.log('⚠️  No checkpoint file found\n');
  }

  // Get current database state
  const [fillsResult, catalogResult] = await Promise.all([
    clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_fills,
          COUNT(DISTINCT condition_id) as markets_with_fills
        FROM clob_fills
      `,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: 'SELECT COUNT(DISTINCT token_id) as total_markets FROM gamma_markets',
      format: 'JSONEachRow'
    })
  ]);

  const fills = await fillsResult.json();
  const catalog = await catalogResult.json();

  const totalFills = parseInt(fills[0].total_fills);
  const marketsWithFills = parseInt(fills[0].markets_with_fills);
  const totalMarkets = parseInt(catalog[0].total_markets);
  const coveragePct = (marketsWithFills / totalMarkets * 100).toFixed(2);
  const gap = totalMarkets - marketsWithFills;

  // Display current status
  console.log('DATABASE STATUS:');
  console.log('─'.repeat(80));
  console.log(`Total fills:        ${totalFills.toLocaleString()}`);
  console.log(`Markets with fills: ${marketsWithFills.toLocaleString()} / ${totalMarkets.toLocaleString()} (${coveragePct}%)`);
  console.log(`Markets remaining:  ${gap.toLocaleString()}`);
  console.log();

  if (checkpoint) {
    console.log('CHECKPOINT STATUS:');
    console.log('─'.repeat(80));
    console.log(`Markets processed:  ${checkpoint.marketsProcessed.toLocaleString()}`);
    console.log(`Fills ingested:     ${checkpoint.fillsIngested.toLocaleString()}`);
    console.log(`Last update:        ${new Date(checkpoint.timestamp).toLocaleString()}`);

    // Calculate time since checkpoint
    const checkpointTime = new Date(checkpoint.timestamp).getTime();
    const now = Date.now();
    const minutesSinceCheckpoint = (now - checkpointTime) / 1000 / 60;

    if (minutesSinceCheckpoint < 60) {
      console.log(`Time since update:  ${minutesSinceCheckpoint.toFixed(1)} minutes`);
    } else {
      console.log(`Time since update:  ${(minutesSinceCheckpoint / 60).toFixed(1)} hours`);
    }

    // Calculate processing rate
    if (checkpoint.marketsProcessed > 0) {
      const rate = checkpoint.marketsProcessed / minutesSinceCheckpoint;
      const remainingMarkets = totalMarkets - marketsWithFills;
      const etaMinutes = remainingMarkets / rate;

      console.log();
      console.log('ESTIMATED COMPLETION:');
      console.log('─'.repeat(80));
      console.log(`Processing rate:    ${rate.toFixed(1)} markets/min`);

      if (etaMinutes < 60) {
        console.log(`ETA:                ${etaMinutes.toFixed(0)} minutes`);
      } else {
        console.log(`ETA:                ${(etaMinutes / 60).toFixed(1)} hours`);
      }
    }
  }

  console.log();
  console.log('═'.repeat(80));

  // Check if process is still running
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync('ps aux | grep "ingest-goldsky-fills-parallel" | grep -v grep');
    if (stdout) {
      console.log('✅ Ingestion process is RUNNING');
    }
  } catch {
    console.log('⚠️  Ingestion process NOT FOUND - may have completed or crashed');
  }

  console.log('═'.repeat(80) + '\n');
}

main().catch(console.error);
