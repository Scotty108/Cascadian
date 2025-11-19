#!/usr/bin/env npx tsx
import * as fs from 'fs';

// Read checkpoint
const checkpoint = JSON.parse(fs.readFileSync('blockchain-backfill-checkpoint.json', 'utf-8'));

const START_BLOCK = 37_515_000;
const TARGET_BLOCK = 78_836_000;
const TOTAL_BLOCKS = TARGET_BLOCK - START_BLOCK;
const WORKER_COUNT = 32;
const BLOCKS_PER_WORKER = Math.ceil(TOTAL_BLOCKS / WORKER_COUNT);

console.log('ACTUAL WORKER PROGRESS ANALYSIS');
console.log('='.repeat(80));
console.log();
console.log(`Total range: ${START_BLOCK.toLocaleString()} → ${TARGET_BLOCK.toLocaleString()}`);
console.log(`Total blocks: ${TOTAL_BLOCKS.toLocaleString()}`);
console.log(`Blocks per worker: ${BLOCKS_PER_WORKER.toLocaleString()}`);
console.log();

// Calculate each worker's assigned range and progress
let totalBlocksProcessed = 0;
let totalEvents = 0;

for (let i = 1; i <= WORKER_COUNT; i++) {
  const assignedStart = START_BLOCK + ((i - 1) * BLOCKS_PER_WORKER);
  const assignedEnd = i === WORKER_COUNT
    ? TARGET_BLOCK
    : START_BLOCK + (i * BLOCKS_PER_WORKER);

  const workerData = checkpoint.workers[i.toString()];
  if (workerData) {
    const currentBlock = workerData.lastBlock;
    const blocksProcessed = currentBlock - assignedStart;
    const assignedBlocks = assignedEnd - assignedStart;
    const percentComplete = (blocksProcessed / assignedBlocks * 100).toFixed(1);

    totalBlocksProcessed += blocksProcessed;
    totalEvents += workerData.eventsProcessed;

    console.log(`Worker ${i.toString().padStart(2)}: ${assignedStart.toLocaleString()} → ${assignedEnd.toLocaleString()} | ` +
      `At: ${currentBlock.toLocaleString()} (${percentComplete}%) | ` +
      `Events: ${workerData.eventsProcessed.toLocaleString()}`);
  }
}

console.log();
console.log('SUMMARY:');
console.log(`  Total blocks processed: ${totalBlocksProcessed.toLocaleString()} / ${TOTAL_BLOCKS.toLocaleString()}`);
console.log(`  Overall progress: ${(totalBlocksProcessed / TOTAL_BLOCKS * 100).toFixed(1)}%`);
console.log(`  Total events found: ${totalEvents.toLocaleString()}`);
console.log();

// Projection
const eventsPerBlock = totalEvents / totalBlocksProcessed;
const blocksRemaining = TOTAL_BLOCKS - totalBlocksProcessed;
const projectedAdditionalEvents = Math.floor(blocksRemaining * eventsPerBlock);
const projectedTotal = totalEvents + projectedAdditionalEvents;

console.log('PROJECTION:');
console.log(`  Events per block: ${eventsPerBlock.toFixed(3)}`);
console.log(`  Blocks remaining: ${blocksRemaining.toLocaleString()}`);
console.log(`  Expected additional events: ${projectedAdditionalEvents.toLocaleString()}`);
console.log(`  PROJECTED TOTAL: ${projectedTotal.toLocaleString()}`);
console.log();

if (projectedTotal >= 10_000_000) {
  console.log('✅ Will exceed 10M rows');
} else {
  console.log(`⚠️  Will fall short of 10M by ${(10_000_000 - projectedTotal).toLocaleString()} rows`);
}
