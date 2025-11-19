#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  // Get actual block coverage
  const result = await ch.query({
    query: `
      SELECT
        MIN(block_number) as min_block,
        MAX(block_number) as max_block,
        COUNT(*) as total_rows,
        COUNT(DISTINCT block_number) as unique_blocks
      FROM default.erc1155_transfers
    `,
    format: 'JSONEachRow'
  });

  const data = (await result.json())[0];
  const minBlock = parseInt(data.min_block);
  const maxBlock = parseInt(data.max_block);
  const totalRows = parseInt(data.total_rows);
  const uniqueBlocks = parseInt(data.unique_blocks);

  // Constants
  const START_BLOCK = 37_515_000;
  const TARGET_BLOCK = 78_836_000;  // Current chain height

  // Calculate coverage and projections
  const blocksScanned = maxBlock - minBlock;
  const blocksRemaining = TARGET_BLOCK - maxBlock;
  const percentComplete = (maxBlock - START_BLOCK) / (TARGET_BLOCK - START_BLOCK) * 100;

  // Row density (rows per block on average)
  const rowsPerBlock = totalRows / blocksScanned;

  // Projection to completion
  const projectedFinalRows = Math.floor(totalRows + (blocksRemaining * rowsPerBlock));

  console.log('BACKFILL PROJECTION ANALYSIS');
  console.log('='.repeat(80));
  console.log();
  console.log('Current State:');
  console.log(`  Rows collected: ${totalRows.toLocaleString()}`);
  console.log(`  Blocks scanned: ${minBlock.toLocaleString()} → ${maxBlock.toLocaleString()}`);
  console.log(`  Block span: ${blocksScanned.toLocaleString()} blocks`);
  console.log(`  Unique blocks with transfers: ${uniqueBlocks.toLocaleString()}`);
  console.log();
  console.log('Progress:');
  console.log(`  Target block: ${TARGET_BLOCK.toLocaleString()}`);
  console.log(`  Blocks remaining: ${blocksRemaining.toLocaleString()}`);
  console.log(`  Percent complete: ${percentComplete.toFixed(1)}%`);
  console.log();
  console.log('Row Density:');
  console.log(`  Avg rows/block: ${rowsPerBlock.toFixed(2)}`);
  console.log(`  Blocks with transfers: ${(uniqueBlocks / blocksScanned * 100).toFixed(1)}%`);
  console.log();
  console.log('Projection:');
  console.log(`  Expected final rows: ${projectedFinalRows.toLocaleString()}`);
  console.log();
  console.log('Confidence Levels:');

  // Calculate confidence intervals based on current data
  const conservative = Math.floor(projectedFinalRows * 0.85);
  const mostLikely = projectedFinalRows;
  const optimistic = Math.floor(projectedFinalRows * 1.15);

  console.log(`  Conservative (85%): ${conservative.toLocaleString()} rows`);
  console.log(`  Most likely (100%): ${mostLikely.toLocaleString()} rows`);
  console.log(`  Optimistic (115%): ${optimistic.toLocaleString()} rows`);
  console.log();

  if (conservative >= 10_000_000) {
    console.log('✅ HIGHLY CONFIDENT: Will exceed 10M rows (even at 85% projection)');
  } else if (mostLikely >= 10_000_000) {
    console.log('✅ CONFIDENT: Will exceed 10M rows (at current rate)');
  } else {
    console.log('⚠️  UNCERTAIN: May not reach 10M rows');
  }

  await ch.close();
}

main().catch(console.error);
