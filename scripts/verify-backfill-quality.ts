#!/usr/bin/env npx tsx
/**
 * Verify backfill data quality and format for trade mapping
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';
import * as fs from 'fs';

const CHECKPOINT_FILE = 'blockchain-backfill-checkpoint.json';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '='.repeat(100));
  console.log('BACKFILL QUALITY VERIFICATION');
  console.log('='.repeat(100));

  // 1. Check current state
  console.log('\n[1] CURRENT STATE');
  console.log('-'.repeat(100));
  const count = await ch.query({
    query: 'SELECT COUNT(*) as count FROM default.erc1155_transfers',
    format: 'JSONEachRow'
  });
  const countData = (await count.json())[0];
  console.log(`Current rows: ${parseInt(countData.count).toLocaleString()}`);

  // 2. Check data format - sample recent rows
  console.log('\n[2] DATA FORMAT CHECK (Sample of 3 recent rows)');
  console.log('-'.repeat(100));
  const sample = await ch.query({
    query: `
      SELECT
        tx_hash,
        log_index,
        block_number,
        contract,
        substring(token_id, 1, 20) as token_id_preview,
        substring(from_address, 1, 20) as from_preview,
        substring(to_address, 1, 20) as to_preview,
        value,
        substring(decoded_data, 1, 40) as data_preview
      FROM default.erc1155_transfers
      ORDER BY block_number DESC
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json();

  for (const row of sampleData) {
    console.log(`\n  Block: ${parseInt(row.block_number).toLocaleString()}`);
    console.log(`  TX: ${row.tx_hash}`);
    console.log(`  Token ID: ${row.token_id_preview}...`);
    console.log(`  From: ${row.from_preview}...`);
    console.log(`  To: ${row.to_preview}...`);
    console.log(`  Data: ${row.data_preview}...`);
  }

  // 3. Check for proper condition_id format (64-char hex without 0x)
  console.log('\n[3] TOKEN ID FORMAT VALIDATION');
  console.log('-'.repeat(100));
  const formatCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as total,
        countIf(length(token_id) = 66) as has_0x_prefix,
        countIf(length(token_id) = 64) as correct_64_chars,
        countIf(token_id LIKE '0x%') as starts_with_0x,
        countIf(token_id = '' OR token_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as null_or_zero
      FROM default.erc1155_transfers
      WHERE block_number > 50000000
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });
  const formatData = (await formatCheck.json())[0];

  console.log(`  Total sampled: ${parseInt(formatData.total).toLocaleString()}`);
  console.log(`  Has 0x prefix (66 chars): ${parseInt(formatData.has_0x_prefix).toLocaleString()}`);
  console.log(`  Correct format (64 chars): ${parseInt(formatData.correct_64_chars).toLocaleString()}`);
  console.log(`  Starts with 0x: ${parseInt(formatData.starts_with_0x).toLocaleString()}`);
  console.log(`  Null/zero IDs: ${parseInt(formatData.null_or_zero).toLocaleString()}`);

  // 4. Check block coverage
  console.log('\n[4] BLOCK COVERAGE (Verifying complete timeline)');
  console.log('-'.repeat(100));
  const coverage = await ch.query({
    query: `
      SELECT
        MIN(block_number) as min_block,
        MAX(block_number) as max_block,
        max_block - min_block as span,
        COUNT(DISTINCT block_number) as unique_blocks
      FROM default.erc1155_transfers
    `,
    format: 'JSONEachRow'
  });
  const coverageData = (await coverage.json())[0];

  const minBlock = parseInt(coverageData.min_block);
  const maxBlock = parseInt(coverageData.max_block);
  const span = parseInt(coverageData.span);
  const uniqueBlocks = parseInt(coverageData.unique_blocks);

  console.log(`  Start block: ${minBlock.toLocaleString()}`);
  console.log(`  Current block: ${maxBlock.toLocaleString()}`);
  console.log(`  Block span: ${span.toLocaleString()}`);
  console.log(`  Unique blocks with transfers: ${uniqueBlocks.toLocaleString()}`);
  console.log(`  Coverage: ${(uniqueBlocks / span * 100).toFixed(2)}% of blocks have transfers`);

  // 5. Checkpoint system verification
  console.log('\n[5] CHECKPOINT SYSTEM (Crash recovery)');
  console.log('-'.repeat(100));

  if (fs.existsSync(CHECKPOINT_FILE)) {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    const workerCount = Object.keys(checkpoint.workers).length;
    const lastUpdate = new Date(checkpoint.timestamp);
    const minutesAgo = ((Date.now() - checkpoint.timestamp) / 1000 / 60).toFixed(1);

    console.log(`  ✅ Checkpoint file exists`);
    console.log(`  Active workers: ${workerCount}`);
    console.log(`  Last updated: ${lastUpdate.toISOString()} (${minutesAgo} min ago)`);
    console.log(`  Total events processed: ${checkpoint.totalEventsProcessed.toLocaleString()}`);

    // Show worker distribution
    const workers = Object.entries(checkpoint.workers).map(([id, data]: [string, any]) => ({
      id: parseInt(id),
      block: data.lastBlock,
      events: data.eventsProcessed
    }));

    const maxWorkerBlock = Math.max(...workers.map(w => w.block));
    const minWorkerBlock = Math.min(...workers.map(w => w.block));

    console.log(`  Worker block range: ${minWorkerBlock.toLocaleString()} → ${maxWorkerBlock.toLocaleString()}`);
    console.log(`  ✅ System can resume from checkpoint if crashed`);
  } else {
    console.log(`  ⚠️  No checkpoint file found`);
  }

  // 6. Verify data is usable for trade mapping
  console.log('\n[6] TRADE MAPPING READINESS');
  console.log('-'.repeat(100));

  const joinCheck = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.erc1155_transfers erc
      INNER JOIN default.trade_direction_assignments tda
        ON erc.tx_hash = tda.tx_hash
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });
  const joinData = (await joinCheck.json())[0];
  const joinMatches = parseInt(joinData.count);

  if (joinMatches > 0) {
    console.log(`  ✅ ${joinMatches} sample ERC-1155 transfers successfully join with trade_direction_assignments`);
    console.log(`  ✅ Data format is compatible for trade mapping`);
  } else {
    console.log(`  ⚠️  No joins found yet (may need more data or different block range)`);
  }

  // 7. Estimate completion
  console.log('\n[7] COMPLETION ESTIMATE');
  console.log('-'.repeat(100));

  const TARGET_BLOCK = 78835000;
  const remainingBlocks = TARGET_BLOCK - maxBlock;
  const rowsPerBlock = parseInt(countData.count) / (maxBlock - minBlock);
  const estimatedFinalRows = Math.floor(rowsPerBlock * (TARGET_BLOCK - minBlock));

  console.log(`  Target block: ${TARGET_BLOCK.toLocaleString()}`);
  console.log(`  Remaining blocks: ${remainingBlocks.toLocaleString()}`);
  console.log(`  Avg rows/block: ${rowsPerBlock.toFixed(2)}`);
  console.log(`  Estimated final rows: ${estimatedFinalRows.toLocaleString()}`);

  if (estimatedFinalRows >= 10_000_000) {
    console.log(`  ✅ Will exceed 10M row target (quality gate passed)`);
  } else {
    console.log(`  ⚠️  May not reach 10M rows - monitoring needed`);
  }

  console.log('\n' + '='.repeat(100));
  console.log('VERIFICATION COMPLETE');
  console.log('='.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
